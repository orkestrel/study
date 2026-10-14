import type { StudyErrorCode, StudyFailure } from './types.js'
import { isInstance } from '@orkestrel/contract'

/** Reports a study contract or operational failure with a stable code. */
export class StudyError extends Error {
	readonly code: StudyErrorCode
	readonly failure: StudyFailure | undefined

	/**
	 * Records the failing boundary and optional operational attribution.
	 * @param code - The machine-readable boundary
	 * @param message - The specific failure
	 * @param failure - The optional operational reading
	 */
	constructor(code: StudyErrorCode, message: string, failure?: StudyFailure) {
		super(message)
		this.name = 'StudyError'
		this.code = code
		this.failure = failure
	}
}

/**
 * Narrows a caught value to an attributable study error.
 * @param value - The caught value
 * @returns True if the value is a study error; false otherwise
 * @example
 * ```ts
 * isStudyError(new StudyError('CONFIG', 'missing definition')) // true
 * ```
 */
export function isStudyError(value: unknown): value is StudyError {
	return isInstance(value, StudyError)
}
