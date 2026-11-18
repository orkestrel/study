import type { StudyCheckReply } from './types.js'
import { isStudyBounds, isStudyDigest } from '@src/core'
import { isRecord } from '@orkestrel/contract'

/**
 * Reads a decoded check reply's validated bounds and its fingerprint when the fingerprint is a valid digest.
 * @param value - The decoded JSON a check printed
 * @returns The reply, or undefined when the value is not a record or holds no valid bounds
 * @example Read a check reply
 * ```ts
 * import { parseStudyCheck } from '@orkestrel/study/server'
 *
 * declare const stdout: string
 * const reply = parseStudyCheck(JSON.parse(stdout))
 * parseStudyCheck({ fingerprint: 'a'.repeat(64) }) // undefined
 * ```
 */
export function parseStudyCheck(value: unknown): StudyCheckReply | undefined {
	if (!isRecord(value) || !isStudyBounds(value.bounds)) return undefined
	return {
		bounds: value.bounds,
		fingerprint: isStudyDigest(value.fingerprint) ? value.fingerprint : undefined,
	}
}
