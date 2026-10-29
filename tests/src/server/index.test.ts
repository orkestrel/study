import * as entry from '@src/server'
import { describe, expect, it } from 'vitest'

describe('src server entry', () => {
	it('exposes the immutable result and grading boundaries', () => {
		expect(entry).toHaveProperty('StudyResultStore')
		expect(entry).toHaveProperty('StudyAssessmentStore')
		expect(entry).toHaveProperty('readStudyResult')
		expect(entry).toHaveProperty('buildStudyPacket')
	})
	it('exposes the shared retained-evidence grading traversal and its citation renderer', () => {
		expect(entry.gradeStudyEvidence).toBeTypeOf('function')
		expect(entry.buildStudyReference).toBeTypeOf('function')
	})
	it('exposes the environment-root byte identity and JSON custody codec', () => {
		const bytes = entry.encodeStudyJSON({ id: 1 })
		expect(entry.decodeStudyJSON(bytes)).toEqual({ id: 1 })
		expect(entry.hashStudyBytes(bytes)).toBe(entry.hashStudyBytes('{"id":1}\n'))
		expect(entry).not.toHaveProperty('hashBytes')
	})
	it('leaves the bounded wait and product guard to the core entry without aliases', () => {
		expect(entry.STUDY_PROCESS_LABEL).toBe('Process lifecycle')
		expect(entry).not.toHaveProperty('awaitStudyProcess')
		expect(entry).not.toHaveProperty('isStudyProduct')
		expect(entry).not.toHaveProperty('StudyDeadline')
	})
})
