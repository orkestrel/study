import type { StudyDriverInterface, StudySessionInterface, StudyTrial } from '@src/core'
import type {
	StudyProcessDriverOptions,
	StudyProcessOptions,
	StudyTrialPreparationFunction,
} from './types.js'
import { StudyError } from '@src/core'
import {
	readStudyPreparedDestination,
	readStudyReplayHistory,
	validateStudyCaptureDeclaration,
} from './helpers.js'
import { isStudyExchangeDestination } from './validators.js'
import { StudyProcessSession } from './StudyProcessSession.js'

/** Opens one fresh native child for each scheduled trial. */
export class StudyProcessDriver implements StudyDriverInterface {
	#options: StudyProcessOptions
	readonly #prepare: StudyTrialPreparationFunction | undefined

	/** Owns immutable resolved launch settings.
	 * @param options - Built entry, admitted identities and exclusive scratch parent.
	 */
	constructor(options: StudyProcessDriverOptions) {
		const { prepare, ...configuration } = options
		if (prepare !== undefined && typeof prepare !== 'function')
			throw new StudyError('CONFIG', 'Trial preparation must be callable')
		if (options.replay?.offline === true && prepare !== undefined)
			throw new StudyError('CONFIG', 'Offline replay cannot prepare external resources')
		this.#options = structuredClone(configuration)
		this.#prepare = prepare
	}

	/** Opens isolated child state and waits for its verified readiness.
	 * @param trial - The public scheduled trial.
	 * @param signal - Authoritative parent cancellation.
	 * @returns A ready process-backed session.
	 */
	async open(trial: StudyTrial, signal: AbortSignal): Promise<StudySessionInterface> {
		signal.throwIfAborted()
		const owned = structuredClone(trial)
		const destination = this.#options.exchanges?.[owned.id]
		if (this.#options.profile.record !== undefined && !isStudyExchangeDestination(destination))
			throw new StudyError('CONFIG', 'Recorded trial requires its reserved destination')
		if (this.#options.profile.record === undefined && destination !== undefined)
			throw new StudyError('CONFIG', 'Unrecorded trial cannot receive a sidecar')
		if (destination !== undefined)
			validateStudyCaptureDeclaration(destination.declaration, this.#options.profile, owned)
		if (this.#options.replay !== undefined) {
			if (destination === undefined) throw new StudyError('CONFIG', 'Replay requires a declaration')
			await readStudyReplayHistory(this.#options.replay, this.#options.profile, owned)
		}
		const prepared =
			this.#prepare === undefined
				? destination
				: readStudyPreparedDestination(
						destination,
						await this.#prepare(structuredClone(owned), signal, structuredClone(destination)),
					)
		signal.throwIfAborted()
		const session = new StudyProcessSession({
			...this.#options,
			trial: owned,
			signal,
			...(prepared === undefined ? {} : { exchanges: { [owned.id]: prepared } }),
		})
		try {
			await session.start()
			return session
		} catch (error) {
			await session.close().catch(() => undefined)
			throw error
		}
	}
}
