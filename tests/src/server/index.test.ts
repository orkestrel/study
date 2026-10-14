import * as entry from '@src/server'
import { describe, expect, it } from 'vitest'

describe('src server entry', () => {
	it('exposes the immutable result and grading boundaries', () => {
		expect(entry).toHaveProperty('StudyResults')
		expect(entry).toHaveProperty('StudyGradings')
		expect(entry).toHaveProperty('readStudyResult')
		expect(entry).toHaveProperty('buildStudyPacket')
	})
	it('exposes the environment-root byte identity and JSON custody codec', () => {
		const bytes = entry.encodeStudyJSON({ version: 1 })
		expect(entry.decodeStudyJSON(bytes)).toEqual({ version: 1 })
		expect(entry.hashStudyBytes(bytes)).toBe(entry.hashStudyBytes('{"version":1}\n'))
		expect(entry).not.toHaveProperty('hashBytes')
	})
})
