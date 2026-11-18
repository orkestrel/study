import type { StudyCheckReply } from './types.js'
import { isStudyBounds, isStudyDigest } from '@src/core'
import { isRecord } from '@orkestrel/contract'

export function parseStudyCheck(value: unknown): StudyCheckReply | undefined {
	if (!isRecord(value) || !isStudyBounds(value.bounds)) return undefined
	return {
		bounds: value.bounds,
		fingerprint: isStudyDigest(value.fingerprint) ? value.fingerprint : undefined,
	}
}
