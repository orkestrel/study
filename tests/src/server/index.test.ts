import * as entry from '@src/server'
import { describe, expect, it } from 'vitest'

describe('src server entry', () => {
	it('exposes the immutable result and grading boundaries', () => {
		expect(entry).toHaveProperty('StudyResults')
		expect(entry).toHaveProperty('StudyGradings')
		expect(entry).toHaveProperty('readStudyResult')
		expect(entry).toHaveProperty('buildStudyPacket')
	})
})
