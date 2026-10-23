import type { ArtifactErrorCode } from './types.js'
import { isInstance } from '@orkestrel/contract'

/** Reports an invalid or drifted artifact inventory. */
export class ArtifactError extends Error {
	readonly code: ArtifactErrorCode

	/** Records the refused artifact boundary.
	 * @param message - The specific refusal.
	 * @param code - The refused boundary. Default: ARTIFACT.
	 */
	constructor(message: string, code: ArtifactErrorCode = 'ARTIFACT') {
		super(message)
		this.name = 'ArtifactError'
		this.code = code
	}
}

/** Narrows a caught value to an artifact refusal.
 * @param value - The caught value.
 * @returns True if the value is an artifact error; false otherwise.
 */
export function isArtifactError(value: unknown): value is ArtifactError {
	return isInstance(value, ArtifactError)
}
