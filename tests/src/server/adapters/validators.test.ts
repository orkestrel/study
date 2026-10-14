import { describe, expect, it } from 'vitest'
import { isStudyAdapter } from '../../../../src/server/adapters/validators.js'
import { readStudyAdapter } from '../../../../src/server/adapters/helpers.js'

describe('consumer adapter boundary', () => {
	it('refuses absent, incomplete and throwing declarations without trusting a factory name', () => {
		for (const value of [
			undefined,
			null,
			1,
			'adapter',
			{},
			{ validate: true, driver: true, grade: true },
		]) {
			expect(isStudyAdapter(value)).toBe(false)
			expect(() => readStudyAdapter(value)).toThrow(/createStudyAdapter/)
		}
		expect(
			isStudyAdapter(
				new Proxy(
					{},
					{
						has() {
							throw new Error('unreadable')
						},
					},
				),
			),
		).toBe(false)
		expect(() => readStudyAdapter({ createStudyAdapter: () => ({}) })).toThrow(/incomplete/)
	})
})
