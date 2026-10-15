import type { StudyFailure, StudyTicket, StudyUsage } from '../types.js'
import type { StudyRequestOptions } from './types.js'
import { Abort, linkSignal } from '@orkestrel/abort'
import { Timeout } from '@orkestrel/timeout'
import { StudyError } from '../errors.js'
import { isStudyUsage } from '../validators.js'
import { failureToStudyError } from './helpers.js'

/** Settles an admitted request once and propagates operational failure to its owner. */
export class StudyRequest implements StudyTicket {
	#options: StudyRequestOptions
	#timeout: Timeout
	#signal: AbortSignal
	#listeners = new Abort()
	#started = performance.now()
	#settled = false

	/** Starts the request deadline after its enclosing scopes reserve capacity.
	 * @param options - Admitted ceilings, request deadline, and settlement callback.
	 */
	constructor(options: StudyRequestOptions) {
		this.#options = { ...options, charge: { ...options.charge } }
		this.#timeout = new Timeout({ ms: options.duration })
		this.#signal = linkSignal(this.#timeout.signal, options.control.signal)
		this.#signal.addEventListener('abort', () => this.#abort(), {
			once: true,
			signal: this.#listeners.signal,
		})
		this.#timeout.start()
		if (this.#signal.aborted) this.#abort()
	}

	get signal(): AbortSignal {
		return this.#signal
	}
	get settled(): boolean {
		return this.#settled
	}

	/** Retains actual measurements and refuses invalid or excessive charges.
	 * @param usage - Measurements attributed to exactly this request.
	 * @throws Thrown when settlement is late, repeated, invalid, or beyond admission.
	 */
	finish(usage: StudyUsage): void {
		this.#checkPending()
		if (!isStudyUsage(usage) || usage.role !== this.#options.charge.role || usage.calls !== 1) {
			const failure = {
				cause: 'infrastructure',
				message: 'Request usage is invalid or misattributed',
				role: this.#options.charge.role,
			} as const
			this.fail(failure)
			throw failureToStudyError(failure)
		}
		const failure: StudyFailure | undefined =
			this.#timeout.expired ||
			performance.now() - this.#started >= this.#options.duration ||
			usage.duration > this.#options.duration
				? { cause: 'deadline', message: 'Request deadline expired', role: usage.role }
				: (usage.tokens !== undefined && usage.tokens > this.#options.charge.tokens) ||
					  (usage.bytes !== undefined && usage.bytes > this.#options.charge.bytes)
					? {
							cause: 'capacity',
							message: 'Request usage exceeded its admitted ceiling',
							role: usage.role,
						}
					: undefined
		this.#complete(usage)
		if (failure !== undefined) {
			this.#options.control.fail(failure)
			throw failureToStudyError(failure)
		}
	}

	/** Retains unknown cost conservatively and latches the first operational failure.
	 * @param failure - The operational request failure.
	 * @throws Thrown when this request was already settled.
	 */
	fail(failure: StudyFailure): void {
		this.#checkPending()
		this.#complete({
			role: this.#options.charge.role,
			calls: 1,
			tokens: undefined,
			bytes: undefined,
			duration: Math.ceil(performance.now() - this.#started),
		})
		this.#options.control.fail({ ...failure, role: failure.role ?? this.#options.charge.role })
	}

	#complete(usage: StudyUsage): void {
		this.#settled = true
		this.#listeners.abort()
		this.#timeout.clear()
		this.#options.settle(Object.freeze({ ...usage }))
	}

	#checkPending(): void {
		if (this.#settled) {
			this.#options.control.fail({
				cause: 'infrastructure',
				message: 'Request settlement is late or repeated',
				role: this.#options.charge.role,
			})
			throw new StudyError(
				'FAULT',
				'Request settlement is late or repeated',
				this.#options.control.failure,
			)
		}
	}

	#abort(): void {
		if (this.#settled) return
		this.fail(
			this.#options.control.failure ?? {
				cause: this.#timeout.expired ? 'deadline' : 'interrupted',
				message: this.#timeout.expired ? 'Request deadline expired' : 'Request interrupted',
				role: this.#options.charge.role,
			},
		)
	}
}
