import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildStudyRubric } from './setupStudy.js'
import {
	buildCustodyGrading,
	buildCustodyLabels,
	buildCustodyPacketLabels,
	retainStudyFixture,
} from './setupServer.js'

describe('study server fixtures', () => {
	it('returns a sealed real-files fixture with complete grades and explicit supplied label provenance', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			const rubric = buildStudyRubric()
			const grading = buildCustodyGrading(result, rubric)
			const neutral = buildCustodyPacketLabels(result, rubric)
			expect(neutral.packet).not.toBe(result.seal.id)
			expect(neutral.judgments[0]?.trial).not.toBe(result.manifest.schedule[0]?.id)
			expect(neutral.judgments[0]?.criterion).not.toBe('first-read')
			expect(grading.attempts).toEqual(result.manifest.schedule.map((trial) => trial.id))
			expect(
				grading.judgments
					.filter((judgment) => judgment.method === 'human')
					.every((judgment) => judgment.verdict === 'unknown'),
			).toBe(true)
			const labels = buildCustodyLabels(result, 'supplied-human')
			expect(labels.labeler).toBe('supplied-human')
			expect(labels.created).toBe('2026-10-14T12:00:00.000Z')
			expect(buildCustodyGrading(result, rubric, labels).judgments).toEqual(
				expect.arrayContaining(labels.judgments),
			)
		} finally {
			scratch.destroy()
		}
	})
})
