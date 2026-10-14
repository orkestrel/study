import { isInstance } from '@orkestrel/contract'

/** Reports an invalid or drifted artifact inventory. */
export class ArtifactError extends Error {
	readonly code = 'ARTIFACT' as const

	/** Records the refused artifact boundary.
	 * @param message - The specific refusal.
	 */
	constructor(message: string) {
		super(message)
		this.name = 'ArtifactError'
	}
}

/** Narrows a caught value to an artifact refusal.
 * @param value - The caught value.
 * @returns True if the value is an artifact error; false otherwise.
 */
export function isArtifactError(value: unknown): value is ArtifactError {
	return isInstance(value, ArtifactError)
}
