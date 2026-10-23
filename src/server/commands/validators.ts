import type { StudyClosure } from './types.js'
import { isStudyDigest, isStudyName } from '@src/core'
import { holds, isRecord, isString } from '@orkestrel/contract'
import { isArtifactClosure } from '../artifacts/validators.js'
import { isStudyIdentity } from '../processes/validators.js'

/** Checks a closure publication before using its command inputs.
 * @param value - The decoded closure.json value.
 * @returns True if relocation, selectors, and both identities are declared; false otherwise.
 */
export function isStudyClosure(value: unknown): value is StudyClosure {
	return holds(
		() =>
			isRecord(value) &&
			isArtifactClosure(value.closure) &&
			isString(value.root) &&
			isString(value.entry) &&
			isStudyName(value.target) &&
			isStudyName(value.profile) &&
			isStudyIdentity(value.source) &&
			isStudyIdentity(value.identity) &&
			isStudyDigest(value.fingerprint),
	)
}
