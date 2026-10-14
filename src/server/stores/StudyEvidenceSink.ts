import type { StudyEvidence } from '../../core/types.js'
import type { StudyCustodySinkInterface, StudyEvidenceOptions } from './types.js'
import { StudyError } from '../../core/errors.js'
import { encodeStudyJSON } from '../helpers.js'
import { isStudyCustodyEvidence } from './validators.js'

/** Retains admitted evidence in order and closes admission before terminal records. */
export class StudyEvidenceSink implements StudyCustodySinkInterface {
	readonly #options: StudyEvidenceOptions
	readonly #goals = new Map<string, number>()
	#bytes = 0
	#tail: Promise<void> = Promise.resolve()
	#closing: Promise<void> | undefined

	/**
	 * Records an already exclusively opened evidence file and its constraints.
	 * @param options - The owned descriptor, goal names, and byte admission bounds
	 */
	constructor(options: StudyEvidenceOptions) {
		this.#options = options
	}

	/**
	 * Admits exact encoded bytes before queuing an append in call order.
	 * @param evidence - The validated domain record
	 * @returns Nothing after the admitted append completes
	 * @throws StudyError - Thrown when admission is closed or a byte limit is exceeded
	 */
	append(evidence: StudyEvidence): Promise<void> {
		try {
			if (this.#closing !== undefined)
				throw new StudyError('CUSTODY', 'Evidence admission is closed')
			if (!isStudyCustodyEvidence(evidence) || !this.#options.goals.includes(evidence.goal))
				throw new StudyError('EVIDENCE', 'Evidence refers to an undeclared goal')
			const bytes = encodeStudyJSON(evidence)
			const used = (this.#goals.get(evidence.goal) ?? 0) + bytes.byteLength
			if (used > this.#options.goal || this.#bytes + bytes.byteLength > this.#options.trial)
				throw new StudyError('CAPACITY', 'Encoded evidence exceeds its allowance')
			this.#options.budget.reserve(bytes.byteLength)
			this.#goals.set(evidence.goal, used)
			this.#bytes += bytes.byteLength
			this.#tail = this.#tail.then(async () => {
				await this.#options.file.writeFile(bytes)
			})
			return this.#tail
		} catch (error) {
			return Promise.reject(error)
		}
	}

	/**
	 * Closes admission immediately and synchronizes all previously admitted writes.
	 * @returns Nothing when the evidence descriptor has closed
	 */
	close(): Promise<void> {
		this.#closing ??= this.#tail
			.then(async () => {
				await this.#options.file.sync()
			})
			.finally(async () => {
				await this.#options.file.close()
			})
		return this.#closing
	}
}
