import type { StudyErrorCode, StudyFailure } from './types.js'
import { holds, INTRINSICS, isError, isFiniteNumber, isObject } from '@orkestrel/contract'
import { STUDY_ERROR_BRAND } from './constants.js'
import { isStudyCause, isStudyErrorCode, isStudyLayer, isStudyRole } from './validators.js'

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
		INTRINSICS.define(this, STUDY_ERROR_BRAND, {
			value: this,
			enumerable: false,
			writable: false,
			configurable: true,
		})
		this.name = 'StudyError'
		this.code = code
		this.failure = failure
	}
}

/**
 * Narrows a caught value to a branded study error with valid failure attribution.
 * @remarks
 * Recognition combines the native `Error` base, a subclass prototype, a declared study code,
 * valid optional failure members, and an own {@link STUDY_ERROR_BRAND} descriptor whose value is
 * the error itself. Subclasses can replace the name.
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
	return holds(() => {
		if (!isError(value) || INTRINSICS.prototype(value) === INTRINSICS.error.prototype) return false
		const brand: unknown = INTRINSICS.describe(value, STUDY_ERROR_BRAND)?.value
		const code: unknown = INTRINSICS.reflect.read(value, 'code')
		const failure: unknown = INTRINSICS.reflect.read(value, 'failure')
		if (
			brand !== value ||
			!isStudyErrorCode(code) ||
			typeof INTRINSICS.reflect.read(value, 'name') !== 'string' ||
			typeof INTRINSICS.reflect.read(value, 'message') !== 'string'
		)
			return false
		if (failure === undefined) return true
		if (!isObject(failure)) return false
		const cause: unknown = INTRINSICS.reflect.read(failure, 'cause')
		const message: unknown = INTRINSICS.reflect.read(failure, 'message')
		const role: unknown = INTRINSICS.reflect.read(failure, 'role')
		const stop: unknown = INTRINSICS.reflect.read(failure, 'stop')
		if (
			!isStudyCause(cause) ||
			typeof message !== 'string' ||
			(role !== undefined && !isStudyRole(role))
		)
			return false
		if (stop === undefined) return true
		if (!isObject(stop)) return false
		const layer: unknown = INTRINSICS.reflect.read(stop, 'layer')
		const id: unknown = INTRINSICS.reflect.read(stop, 'id')
		const max: unknown = INTRINSICS.reflect.read(stop, 'max')
		const consumed: unknown = INTRINSICS.reflect.read(stop, 'consumed')
		return (
			isStudyLayer(layer) &&
			typeof id === 'string' &&
			(max === undefined || isFiniteNumber(max)) &&
			(consumed === undefined || isFiniteNumber(consumed))
		)
	})
}
