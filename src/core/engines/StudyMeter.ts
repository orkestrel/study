import type { StudyCharge, StudyTicket, StudyUsage } from '../types.js'
import type { StudyMeterInterface, StudyMeterOptions } from './types.js'
import { StudyError } from '../errors.js'
import { isStudyLimit, isStudyRole } from '../validators.js'
import { failureToStudyError } from './helpers.js'
import { StudyRequest } from './StudyRequest.js'

/** Admits request ceilings across every enclosing scope before dispatch. */
export class StudyMeter implements StudyMeterInterface {
	#options: StudyMeterOptions
	#pending = new Set<symbol>()
	#usage: readonly StudyUsage[] = []
	#closed = false

	/** Holds the goal's shared admission scopes.
	 * @param options - Request bound, enclosing scopes, and shared failure owner.
	 */
	constructor(options: StudyMeterOptions) {
		if (
			!isStudyLimit(options.request) ||
			options.request.calls !== 1 ||
			options.scopes.length === 0
		)
			throw new StudyError('CONFIG', 'Invalid request admission bounds')
		this.#options = { ...options, request: { ...options.request }, scopes: [...options.scopes] }
	}

	get signal(): AbortSignal {
		return this.#options.control.signal
	}
	get usage(): readonly StudyUsage[] {
		return Object.freeze([...this.#usage])
	}

	/** Reserves one request atomically across all enclosing allowances.
	 * @param charge - Safe integer token and byte ceilings with the request's role.
	 * @returns A request ticket that must settle before the goal completes.
	 * @throws Thrown before dispatch if the request exceeds available capacity.
	 */
	admit(charge: StudyCharge): StudyTicket {
		if (this.#closed) throw new StudyError('FAULT', 'Study meter is closed')
		if (this.#options.control.failure !== undefined)
			throw failureToStudyError(this.#options.control.failure)
		if (
			!isStudyRole(charge.role) ||
			!Number.isSafeInteger(charge.tokens) ||
			charge.tokens < 0 ||
			!Number.isSafeInteger(charge.bytes) ||
			charge.bytes < 0
		) {
			const failure = {
				cause: 'infrastructure',
				message: 'Request admission requires safe nonnegative ceilings',
				role: undefined,
			} as const
			this.#options.control.fail(failure)
			throw failureToStudyError(failure)
		}
		if (
			charge.tokens > this.#options.request.tokens ||
			charge.bytes > this.#options.request.bytes
		) {
			const failure = {
				cause: 'capacity',
				message: 'Request ceiling exceeds the request allowance',
				role: charge.role,
			} as const
			this.#options.control.fail(failure)
			throw failureToStudyError(failure)
		}
		for (const scope of this.#options.scopes) scope.check(charge)
		const id = Symbol('request')
		for (const scope of this.#options.scopes) scope.reserve(id, charge)
		this.#pending.add(id)
		return new StudyRequest({
			charge,
			duration: this.#options.request.duration,
			control: this.#options.control,
			settle: (usage) => {
				for (const scope of this.#options.scopes) scope.settle(id, usage)
				this.#pending.delete(id)
				this.#usage = [...this.#usage, usage]
			},
		})
	}

	/** Refuses unfinished requests before closing a goal's admission boundary. */
	close(): void {
		if (this.#closed) return
		this.#closed = true
		if (this.#pending.size > 0)
			this.#options.control.fail({
				cause: 'infrastructure',
				message: 'Goal completed with unsettled requests',
				role: undefined,
			})
	}
}
