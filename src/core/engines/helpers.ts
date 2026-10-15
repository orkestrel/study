import type { StudyFailure, StudyRole, StudyTicket } from '../types.js'
import { isError } from '@orkestrel/contract'
import { isStudyError, StudyError } from '../errors.js'

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
 * @param error - The caught error.
 * @returns Existing attribution, the cause a bare capacity or deadline code names, or an
 * infrastructure failure.
 */
export function readStudyFailure(error: unknown): StudyFailure {
	if (isStudyError(error)) {
		const { failure, code, message } = error
		if (failure !== undefined) return failure
		if (code === 'CAPACITY') return { cause: 'capacity', message, role: undefined }
		if (code === 'DEADLINE') return { cause: 'deadline', message, role: undefined }
	}
	return {
		cause: 'infrastructure',
		message: isError(error) ? error.message : 'Study operation rejected without an Error',
		role: undefined,
	}
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
