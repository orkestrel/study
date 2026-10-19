import type { BudgetInterface } from '@orkestrel/budget'
import type {
	StudyCharge,
	StudyFailure,
	StudyRole,
	StudyStop,
	StudyTicket,
	StudyUsage,
} from '../types.js'
import { isBudgetError } from '@orkestrel/budget'
import { attempt, isError, isNonEmptyString } from '@orkestrel/contract'
import { isStudyError, StudyError } from '../errors.js'
import { parseStudyReading } from '../parsers.js'

/** Converts an operational reading to its throwable boundary.
 * @param failure - The retained operational reading.
 * @returns An error preserving the reading's cause and responsibility.
 */
export function failureToStudyError(failure: StudyFailure): StudyError {
	return new StudyError(
		failure.cause === 'capacity' ? 'CAPACITY' : failure.cause === 'deadline' ? 'DEADLINE' : 'FAULT',
		failure.message,
		failure,
	)
}

/** Reads an operational error without inventing a task verdict.
 * @remarks
 * A branded `BudgetError` from any copy of the budget package reads as a `budget` stop, because the
 * error alone does not prove which budget object raised it; the Agent record names a `meter` stop.
 * An unbranded lookalike reads as an infrastructure failure.
 * @param error - The caught error.
 * @returns Existing attribution, the capacity a branded budget error names, the cause a bare
 * capacity or deadline code names, or an infrastructure failure.
 */
export function readStudyFailure(error: unknown): StudyFailure {
	if (isStudyError(error)) {
		const { failure, code, message } = error
		if (failure !== undefined) return failure
		if (code === 'CAPACITY') return { cause: 'capacity', message, role: undefined, stop: undefined }
		if (code === 'DEADLINE') return { cause: 'deadline', message, role: undefined, stop: undefined }
	}
	if (isBudgetError(error)) {
		const reading = attempt(() => {
			const context = error.context
			return {
				id: context.id,
				max: context.max,
				consumed: context.consumed,
				message: error.message,
			}
		})
		if (reading.success)
			return {
				cause: 'capacity',
				message: reading.value.message,
				role: undefined,
				stop: {
					layer: 'budget',
					id: isNonEmptyString(reading.value.id) ? reading.value.id : 'Agent budget',
					max: parseStudyReading(reading.value.max),
					consumed: parseStudyReading(reading.value.consumed),
				},
			}
	}
	return {
		cause: 'infrastructure',
		message: isError(error) ? error.message : 'Study operation rejected without an Error',
		role: undefined,
		stop: undefined,
	}
}

/**
 * Computes the stop of a request whose actual usage crossed the ceiling it was admitted under.
 * @param charge - The request's admitted ceilings
 * @param usage - The request's measured usage
 * @returns The `scope` stop for the first quantity, tokens then bytes, whose known usage exceeds its admitted ceiling; undefined when none does
 * @example
 * ```ts
 * computeStudyAdmittedStop({ role: 'agent', tokens: 10, bytes: 100 }, usage) // { layer: 'scope', id: 'Admitted tokens', max: 10, consumed: 12 }
 * ```
 */
export function computeStudyAdmittedStop(
	charge: StudyCharge,
	usage: StudyUsage,
): StudyStop | undefined {
	if (usage.tokens !== undefined && usage.tokens > charge.tokens)
		return { layer: 'scope', id: 'Admitted tokens', max: charge.tokens, consumed: usage.tokens }
	if (usage.bytes !== undefined && usage.bytes > charge.bytes)
		return { layer: 'scope', id: 'Admitted bytes', max: charge.bytes, consumed: usage.bytes }
	return undefined
}

/**
 * Computes the stop of a product the output allowances cannot hold.
 * @param bytes - The encoded size of the product's value
 * @param limit - The goal's byte allowance
 * @param outputs - The trial and series output budgets, in the order they refuse
 * @returns The `Goal bytes` stop when the goal allowance refuses, else the stop of the first budget whose remaining room is below the product, with its tally including the refused product; undefined when every allowance holds it
 * @example
 * ```ts
 * computeStudyOutputStop(2048, 1024, []) // { layer: 'scope', id: 'Goal bytes', max: 1024, consumed: 2048 }
 * ```
 */
export function computeStudyOutputStop(
	bytes: number,
	limit: number,
	outputs: ReadonlyArray<BudgetInterface<number>>,
): StudyStop | undefined {
	if (bytes > limit) return { layer: 'scope', id: 'Goal bytes', max: limit, consumed: bytes }
	const refusal = outputs.find((budget) => bytes > budget.remaining)
	return refusal === undefined
		? undefined
		: { layer: 'scope', id: refusal.id, max: refusal.max, consumed: refusal.consumed + bytes }
}

/**
 * Records an error that escaped admitted work as the failure of its ticket.
 * @param ticket - The admitted request whose work escaped
 * @param error - The caught value, read through `readStudyFailure`
 * @param role - The responsibility that replaces any role the reading carries; Default: the carried role, else the ticket's admitted role
 * @remarks
 * A ticket that already settled or whose signal aborted is left untouched, because its owner
 * already holds the failure. A remote ticket's aborted signal does not mean it settled locally,
 * so the parent's ownership is respected rather than inferred as local settlement. A refusal
 * thrown by the ticket's own settlement propagates.
 * @throws Thrown when the ticket's settlement refuses the failure.
 * @example Fail an escaped request
 * ```ts
 * import type { StudyTicket } from '@orkestrel/study'
 * import { failStudyTicket } from '@orkestrel/study'
 *
 * declare const ticket: StudyTicket
 *
 * failStudyTicket(ticket, new Error('Provider refused'), 'tool')
 * ```
 */
export function failStudyTicket(ticket: StudyTicket, error: unknown, role?: StudyRole): void {
	if (ticket.settled || ticket.signal.aborted) return
	const failure = readStudyFailure(error)
	ticket.fail(role === undefined ? failure : { ...failure, role })
}
