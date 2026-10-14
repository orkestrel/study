import type { StudyDriverInterface, StudySessionInterface, StudyTrial } from '../../core/types.js'
import type { StudyProcessOptions } from './types.js'
import { StudyProcessSession } from './StudyProcessSession.js'

/** Opens one fresh native child for each scheduled trial. */
export class StudyProcessDriver implements StudyDriverInterface {
	#options: StudyProcessOptions

	/** Owns immutable resolved launch settings.
	 * @param options - Built entry, admitted identities and exclusive scratch parent.
	 */
	constructor(options: StudyProcessOptions) {
		this.#options = structuredClone(options)
	}

	/** Opens isolated child state and waits for its verified readiness.
	 * @param trial - The public scheduled trial.
	 * @param signal - Authoritative parent cancellation.
	 * @returns A ready process-backed session.
	 */
	async open(trial: StudyTrial, signal: AbortSignal): Promise<StudySessionInterface> {
		const session = new StudyProcessSession({ ...this.#options, trial, signal })
		try {
			await session.start()
			return session
		} catch (error) {
			await session.close().catch(() => undefined)
			throw error
		}
	}
}
