import type { StudyCharge, StudyUsage } from '../types.js'
import type { StudyScopeInterface, StudyScopeOptions } from './types.js'
import { Abort } from '@orkestrel/abort'
import { Budget } from '@orkestrel/budget'
import { Timeout } from '@orkestrel/timeout'
import { StudyError } from '../errors.js'
import { isStudyLimit } from '../validators.js'
import { failureToStudyError } from './helpers.js'

/** Reserves finite request ceilings around cumulative actual budgets and one deadline. */
export class StudyScope implements StudyScopeInterface {
	#options: StudyScopeOptions
	#calls: Budget<number>
	#tokens: Budget<number>
	#bytes: Budget<number>
	#timeout: Timeout
	#listeners = new Abort()
	readonly #pending = new Map<symbol, StudyCharge>()
	#started = performance.now()
	#closed = false

	/** Starts a timed scope with independent counters.
	 * @param options - Finite limit, shared failure owner, and diagnostic label.
	 */
	constructor(options: StudyScopeOptions) {
		if (!isStudyLimit(options.limit)) throw new StudyError('CONFIG', 'Invalid study scope limit')
		this.#options = { ...options, limit: { ...options.limit } }
		this.#calls = new Budget({ max: options.limit.calls, consumer: (value: number) => value })
		this.#tokens = new Budget({ max: options.limit.tokens, consumer: (value: number) => value })
		this.#bytes = new Budget({ max: options.limit.bytes, consumer: (value: number) => value })
		this.#timeout = new Timeout({ ms: options.limit.duration })
		this.#timeout.signal.addEventListener('abort', () => this.#expire(), {
			once: true,
			signal: this.#listeners.signal,
		})
		this.#timeout.start()
	}

	/** Checks cumulative consumption and every pending ceiling before admission.
	 * @param charge - One prospective request's ceilings.
	 * @throws Thrown when this scope cannot admit the request.
	 */
	check(charge?: StudyCharge): void {
		this.#checkTime()
		if (this.#closed) throw new StudyError('FAULT', 'Study scope is closed')
		const prior = this.#options.control.failure
		if (prior !== undefined) throw failureToStudyError(prior)
		if (charge === undefined) return
		const pending = [...this.#pending.values()]
		const tokens = pending.reduce((total, entry) => total + entry.tokens, 0)
		const bytes = pending.reduce((total, entry) => total + entry.bytes, 0)
		if (
			this.#calls.remaining - this.#pending.size < 1 ||
			this.#tokens.remaining - tokens < charge.tokens ||
			this.#bytes.remaining - bytes < charge.bytes
		) {
			const failure = {
				cause: 'capacity',
				message: `${this.#options.label} allowance cannot admit the request`,
				role: charge.role,
			} as const
			this.#options.control.fail(failure)
			throw failureToStudyError(failure)
		}
	}

	/** Reserves one request after the enclosing meter checked all scopes.
	 * @param id - The request's unique reservation identity.
	 * @param charge - Its admitted ceilings.
	 */
	reserve(id: symbol, charge: StudyCharge): void {
		if (this.#pending.has(id)) throw new StudyError('FAULT', 'Duplicate study reservation')
		this.#pending.set(id, { ...charge })
	}

	/** Commits known charges while retaining ceilings for missing measurements.
	 * @param id - The pending reservation identity.
	 * @param usage - The request's retained public measurements.
	 */
	settle(id: symbol, usage: StudyUsage): void {
		const charge = this.#pending.get(id)
		if (charge === undefined) throw new StudyError('FAULT', 'Study reservation is not pending')
		this.#pending.delete(id)
		this.#calls.consume(1)
		this.#tokens.consume(Math.min(charge.tokens, usage.tokens ?? charge.tokens))
		this.#bytes.consume(Math.min(charge.bytes, usage.bytes ?? charge.bytes))
	}

	/** Checks deadline attribution before clearing the timer. */
	close(): void {
		if (this.#closed) return
		this.#checkTime()
		this.#closed = true
		this.#listeners.abort()
		this.#timeout.clear()
	}

	#checkTime(): void {
		if (
			!this.#closed &&
			(this.#timeout.expired || performance.now() - this.#started >= this.#options.limit.duration)
		)
			this.#expire()
	}

	#expire(): void {
		this.#options.control.fail({
			cause: 'deadline',
			message: `${this.#options.label} deadline expired`,
			role: undefined,
		})
	}
}
