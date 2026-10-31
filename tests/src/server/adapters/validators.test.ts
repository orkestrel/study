import { describe, expect, it } from 'vitest'
import { isStudyAdapter } from '../../../../src/server/adapters/validators.js'
import { readStudyAdapter } from '../../../../src/server/adapters/helpers.js'

describe('consumer adapter boundary', () => {
	it('preserves inherited methods, open records and array-valued adapter declarations', () => {
		const methods = {
			validate: Object.keys,
			driver: Object.values,
			grade: Object.entries,
		}
		expect(isStudyAdapter({ ...methods, extra: true })).toBe(true)
		expect(isStudyAdapter(Object.create(methods))).toBe(true)
		expect(isStudyAdapter(Object.assign([], methods))).toBe(true)
		expect(isStudyAdapter(Object.assign(() => undefined, methods))).toBe(false)
		expect(
			isStudyAdapter(
				new Proxy(methods, {
					get() {
						throw new Error('Hostile property read')
					},
				}),
			),
		).toBe(false)
		const revoked = Proxy.revocable(methods, {})
		revoked.revoke()
		expect(isStudyAdapter(revoked.proxy)).toBe(false)
	})

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

	it('admits an adapter whose progress is absent, undefined, or callable', () => {
		const methods = { validate: Object.keys, driver: Object.values, grade: Object.entries }
		expect(isStudyAdapter(methods)).toBe(true)
		expect(isStudyAdapter({ ...methods, progress: undefined })).toBe(true)
		expect(isStudyAdapter({ ...methods, progress: Object.freeze })).toBe(true)
		expect(isStudyAdapter(Object.create({ ...methods, progress: Object.freeze }))).toBe(true)
	})

	it('refuses an adapter whose progress is present and not callable', () => {
		const methods = { validate: Object.keys, driver: Object.values, grade: Object.entries }
		for (const progress of [null, false, 0, 'progress', {}, []]) {
			expect(isStudyAdapter({ ...methods, progress })).toBe(false)
			expect(isStudyAdapter(Object.create({ ...methods, progress }))).toBe(false)
			expect(() =>
				readStudyAdapter({ createStudyAdapter: () => ({ ...methods, progress }) }),
			).toThrow(/incomplete/)
		}
	})
})
