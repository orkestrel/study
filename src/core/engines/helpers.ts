import type { StudyFailure } from '../types.js'
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
 * @returns Existing attribution or an infrastructure failure.
 */
export function readStudyFailure(error: unknown): StudyFailure {
	if (isStudyError(error) && error.failure !== undefined) return error.failure
	return {
		cause: 'infrastructure',
		message: isError(error) ? error.message : 'Study operation rejected without an Error',
		role: undefined,
	}
}
