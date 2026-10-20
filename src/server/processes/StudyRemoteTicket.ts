import type { StudyFailure, StudyTicket, StudyUsage } from '@src/core'
import type { StudyRemoteTicketOptions } from './types.js'
import { StudyError } from '@src/core'

/** Transmits one settlement without inventing local admission authority. */
export class StudyRemoteTicket implements StudyTicket {
	#options: StudyRemoteTicketOptions
	#settled = false

	/** Owns the parent's ticket identity and composed cancellation.
	 * @param options - Transported ticket state and settlement callback, snapshotted at construction.
	 */
	constructor(options: StudyRemoteTicketOptions) {
		this.#options = { ...options }
	}
	get signal(): AbortSignal {
		return this.#options.signal
	}
	get settled(): boolean {
		return this.#settled
	}

	/** Sends actual usage for authoritative parent settlement.
	 * @param usage - Actual measured request usage.
	 */
	finish(usage: StudyUsage): void {
		this.#settle('finish', usage)
	}

	/** Sends operational failure while preserving unknown actual cost.
	 * @param failure - The first observed request failure.
	 */
	fail(failure: StudyFailure): void {
		this.#settle('fail', failure)
	}

	#settle(operation: 'finish' | 'fail', value: StudyUsage | StudyFailure): void {
		if (this.#settled) {
			this.#options.settle('fail', {
				cause: 'infrastructure',
				message: 'Worker ticket settled more than once',
				role: undefined,
				stop: undefined,
			})
			throw new StudyError('FAULT', 'Worker ticket settled more than once')
		}
		this.#settled = true
		this.#options.settle(operation, value)
	}
}
