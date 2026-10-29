import type { ArtifactErrorCode } from './types.js'
import { holds, INTRINSICS, isString } from '@orkestrel/contract'
import { ARTIFACT_ERROR_BRAND, ARTIFACT_ERROR_CODES } from './constants.js'

/** Reports an invalid or drifted artifact inventory. */
export class ArtifactError extends Error {
	readonly code: ArtifactErrorCode

	/** Records the refused artifact boundary.
	 * @param message - The specific refusal.
	 * @param code - The refused boundary. Default: ARTIFACT.
	 */
	constructor(message: string, code: ArtifactErrorCode = 'ARTIFACT') {
		super(message)
		INTRINSICS.define(this, ARTIFACT_ERROR_BRAND, { value: this })
		this.name = 'ArtifactError'
		this.code = code
	}
}

/** Narrows a caught value to an artifact refusal.
 * @remarks
 * Recognizes subclasses and other module copies by an own identity brand and valid members.
 * The brand is a recognition marker. A transparent proxy, a look-alike without the brand,
 * throwing accessors, and revoked proxies return false.
 * @param value - The caught value.
 * @returns True if the value is an artifact error; false otherwise.
 */
export function isArtifactError(value: unknown): value is ArtifactError {
	return holds(() => {
		if (
			!(value instanceof INTRINSICS.error) ||
			INTRINSICS.prototype(value) === INTRINSICS.error.prototype
		)
			return false
		if (INTRINSICS.describe(value, ARTIFACT_ERROR_BRAND)?.value !== value) return false
		const code: unknown = INTRINSICS.reflect.read(value, 'code')
		const stack: unknown = INTRINSICS.reflect.read(value, 'stack')
		return (
			ARTIFACT_ERROR_CODES.some((candidate) => candidate === code) &&
			isString(INTRINSICS.reflect.read(value, 'message')) &&
			(stack === undefined || isString(stack))
		)
	})
}
