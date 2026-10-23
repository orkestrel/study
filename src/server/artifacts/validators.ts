import type { ArtifactClosure, ArtifactLoaderOptions, ArtifactMember } from './types.js'
import { arrayOf, holds, isArray, isRecord, isString } from '@orkestrel/contract'
import { isStudyDigest } from '@src/core'
import { ARTIFACT_FILES, ARTIFACT_ROOTS } from './constants.js'
import { matchesArtifactCredential } from './helpers.js'

/** Checks whether a key names portable, non-credential members within a closure.
 * @param value - The untrusted slash-separated key.
 * @returns True if every segment is safe and contained; false otherwise.
 */
export function isArtifactKey(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value !== '' &&
		!/[\\<>:"|?*]/u.test(value) &&
		!Array.from(value).some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) &&
		value
			.split('/')
			.every(
				(name) =>
					name !== '' &&
					name !== '.' &&
					name !== '..' &&
					!/[. ]$/.test(name) &&
					!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) &&
					!matchesArtifactCredential(name),
			)
	)
}

/** Checks the bounded loader selections retained in a publication.
 * @param value - The decoded selections.
 * @returns True if required selections and optional groups have their declared shapes; false otherwise.
 */
export function isArtifactLoaderOptions(value: unknown): value is ArtifactLoaderOptions {
	return holds(
		() =>
			isRecord(value) &&
			arrayOf(isString)(value.entries) &&
			arrayOf(isString)(value.roots) &&
			value.entries.length <= ARTIFACT_FILES &&
			value.roots.length <= ARTIFACT_ROOTS &&
			(value.source === undefined ||
				(isRecord(value.source) && isString(value.source.root) && isString(value.source.entry))) &&
			(value.instrument === undefined || isString(value.instrument)) &&
			(value.excluded === undefined || arrayOf(isString)(value.excluded)) &&
			(value.assets === undefined ||
				(arrayOf(isString)(value.assets) && value.assets.length <= ARTIFACT_FILES)),
	)
}

/** Checks the exact file identity and provenance of a closure member.
 * @param value - The decoded member.
 * @returns True if the member has a safe key, source, digest and bounded size; false otherwise.
 */
export function isArtifactMember(value: unknown): value is ArtifactMember {
	return holds(
		() =>
			isRecord(value) &&
			isString(value.source) &&
			isArtifactKey(value.key) &&
			isStudyDigest(value.digest) &&
			typeof value.size === 'number' &&
			Number.isSafeInteger(value.size) &&
			value.size >= 0,
	)
}

/** Checks a bounded materialization record before any path is used.
 * @param value - The decoded record.
 * @returns True if its selections and member records have the declared shapes; false otherwise.
 */
export function isArtifactClosure(value: unknown): value is ArtifactClosure {
	return holds(
		() =>
			isRecord(value) &&
			isString(value.destination) &&
			isStudyDigest(value.digest) &&
			isArtifactLoaderOptions(value.options) &&
			isArray(value.members) &&
			value.members.length > 0 &&
			value.members.length <= ARTIFACT_FILES &&
			value.members.every(isArtifactMember),
	)
}
