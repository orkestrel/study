import type { StudyErrorCode, StudyFailure } from './types.js'
import { holds, isError } from '@orkestrel/contract'
import { STUDY_ERROR_BRAND } from './constants.js'
import { isStudyErrorCode } from './validators.js'

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
		Object.defineProperty(this, STUDY_ERROR_BRAND, { value: this, configurable: true })
		this.name = 'StudyError'
		this.code = code
		this.failure = failure
	}
}

/**
 * Narrows a caught value to an attributable study error.
 * @remarks
 * Recognition combines the native `Error` base, a subclass prototype, the fixed name, a declared
 * study code, and an own {@link STUDY_ERROR_BRAND} descriptor whose value is the error itself.
 * The global key is recognized across package, ESM, CommonJS and captured module copies; it is
 * not unforgeable provenance. A transparent proxy is refused because its forwarded descriptor
 * stores the target, and an unbranded copy, an inherited brand, or a property-only lookalike
 * stays outside the type. Hostile property access returns false instead of throwing.
 * @param value - The caught value
 * @returns True if the value is a study error; false otherwise
 * @example
 * ```ts
 * isStudyError(new StudyError('CONFIG', 'missing definition')) // true
 * ```
 */
export function isStudyError(value: unknown): value is StudyError {
	return (
		isError(value) &&
		holds(
			() =>
				Object.getPrototypeOf(value) !== Error.prototype &&
				value.name === 'StudyError' &&
				Object.getOwnPropertyDescriptor(value, STUDY_ERROR_BRAND)?.value === value &&
				'code' in value &&
				isStudyErrorCode(value.code),
		)
	)
}
