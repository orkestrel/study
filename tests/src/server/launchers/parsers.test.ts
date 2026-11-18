import { isRecord, parseJSON } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { parseStudyCheck } from '../../../../src/server/launchers/parsers.js'
import { STUDY_CHECK_FINGERPRINT, buildStudyCheckReply } from '../../../setupServer.js'
import { buildStudyProfile } from '../../../setupStudy.js'

describe('parseStudyCheck', () => {
	it("reads a check reply's bounds and fingerprint, and leaves a missing fingerprint absent", () => {
		const bounds = buildStudyProfile().bounds
		const reply = parseJSON(buildStudyCheckReply(4000))
		if (!isRecord(reply)) throw new Error('Missing check reply fixture')
		expect(parseStudyCheck(reply)).toEqual({
			bounds: { ...bounds, series: { ...bounds.series, duration: 4000 } },
			fingerprint: STUDY_CHECK_FINGERPRINT,
		})
		expect(parseStudyCheck({ ...reply, fingerprint: 'short' })).toEqual({
			bounds: reply.bounds,
			fingerprint: undefined,
		})
		expect(parseStudyCheck({ bounds: reply.bounds })).toEqual({
			bounds: reply.bounds,
			fingerprint: undefined,
		})
	})

	it('returns undefined for a reply that is not a record or holds no valid bounds', () => {
		for (const value of [
			undefined,
			null,
			'reply',
			[],
			{},
			{ fingerprint: STUDY_CHECK_FINGERPRINT },
			{ bounds: { series: { duration: 4000 } }, fingerprint: STUDY_CHECK_FINGERPRINT },
		])
			expect(parseStudyCheck(value)).toBeUndefined()
	})
})
