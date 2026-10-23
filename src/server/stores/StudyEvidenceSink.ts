import type { StudyEvidence } from '@src/core'
import type { StudyCustodySinkInterface, StudyEvidenceSinkOptions } from './types.js'
import { StudyError } from '@src/core'
import { encodeStudyJSON } from '../helpers.js'
import { isStudyCustodyEvidence } from './validators.js'

/** Retains admitted evidence in order and closes admission before terminal records. */
export class StudyEvidenceSink implements StudyCustodySinkInterface {
	readonly #options: StudyEvidenceSinkOptions
	readonly #goals = new Map<string, number>()
	// The admitted writes not yet settled; a write joins when admitted and leaves when it settles, and each waits for every earlier one.
	readonly #writes = new Set<Promise<void>>()
	#bytes = 0
	// Wraps the first failed write so every later append and the close refuse with that failure.
	#fault: { readonly error: unknown } | undefined
	#closing: Promise<void> | undefined

	/**
	 * Owns the descriptor selection and constraints while retaining the live file and budget.
	 * @param options - The owned descriptor, goal names, and byte admission bounds
	 */
	constructor(options: StudyEvidenceSinkOptions) {
		this.#options = { ...options, goals: [...options.goals] }
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
			const trial = this.#bytes + bytes.byteLength
			if (used > this.#options.goal || trial > this.#options.trial) {
				const message = 'Encoded evidence exceeds its allowance'
				throw new StudyError('CAPACITY', message, {
					cause: 'capacity',
					message,
					role: undefined,
					stop:
						used > this.#options.goal
							? { layer: 'custody', id: 'Goal evidence', max: this.#options.goal, consumed: used }
							: {
									layer: 'custody',
									id: 'Trial evidence',
									max: this.#options.trial,
									consumed: trial,
								},
				})
			}
			this.#options.budget.reserve(bytes.byteLength)
			this.#goals.set(evidence.goal, used)
			this.#bytes += bytes.byteLength
			const previous = Promise.allSettled([...this.#writes])
			const write = previous.then(() => this.#write(bytes))
			this.#writes.add(write)
			void write.then(
				() => this.#writes.delete(write),
				() => this.#writes.delete(write),
			)
			return write
		} catch (error) {
			return Promise.reject(error)
		}
	}

	/**
	 * Closes admission immediately and synchronizes all previously admitted writes.
	 * @returns Nothing when the evidence descriptor has closed
	 */
	close(): Promise<void> {
		this.#closing ??= Promise.allSettled([...this.#writes])
			.then(async () => {
				if (this.#fault !== undefined) throw this.#fault.error
				await this.#options.file.sync()
			})
			.finally(async () => {
				await this.#options.file.close()
			})
		return this.#closing
	}

	// Writes after every earlier write settled, and refuses after any earlier write failed.
	async #write(bytes: Uint8Array): Promise<void> {
		if (this.#fault !== undefined) throw this.#fault.error
		try {
			await this.#options.file.writeFile(bytes)
		} catch (error) {
			this.#fault ??= { error }
			throw error
		}
	}
}
