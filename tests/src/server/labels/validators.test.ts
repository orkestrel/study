import { describe, expect, it } from 'vitest'
import { isStudyLabelLegend, isStudyLabelPacket } from '../../../../src/server/labels/validators.js'

describe('isStudyLabelPacket', () => {
	it('admits entries with and without a product', () => {
		expect(
			isStudyLabelPacket({
				entries: [
					{
						trial: 'r1-s1-a1',
						criterion: 'first-write',
						input: 'open',
						product: 'saved',
						assertion: 'saved',
					},
					{ trial: 'r1-s1-a2', criterion: 'first-write', input: 'open', assertion: 'saved' },
				],
			}),
		).toBe(true)
		expect(isStudyLabelPacket({ entries: [] })).toBe(true)
	})

	it('refuses a missing field, a non-string identity, a value outside JSON, and a non-list', () => {
		const entry = { trial: 'r1-s1-a1', criterion: 'first-write', input: 'open', assertion: 'saved' }
		const { criterion: _criterion, ...unnamed } = entry
		for (const entries of [
			[unnamed],
			[{ ...entry, trial: 1 }],
			[{ ...entry, input: Symbol.for('open') }],
			[{ ...entry, assertion: undefined }],
			'entries',
		])
			expect(isStudyLabelPacket({ entries })).toBe(false)
		expect(isStudyLabelPacket(undefined)).toBe(false)
	})
})

describe('isStudyLabelLegend', () => {
	it('admits a result and links with their source pairs', () => {
		expect(
			isStudyLabelLegend({
				result: 'a'.repeat(64),
				entries: [
					{
						trial: 'row-1',
						criterion: 'row-1',
						source: { trial: 'r1-s1-a1', criterion: 'first-write' },
					},
				],
			}),
		).toBe(true)
	})

	it('refuses a missing result, a non-string link, and a source without its criterion', () => {
		const link = {
			trial: 'row-1',
			criterion: 'row-1',
			source: { trial: 'r1-s1-a1', criterion: 'first-write' },
		}
		expect(isStudyLabelLegend({ entries: [link] })).toBe(false)
		expect(isStudyLabelLegend({ result: 'a'.repeat(64), entries: [{ ...link, trial: 1 }] })).toBe(
			false,
		)
		expect(
			isStudyLabelLegend({
				result: 'a'.repeat(64),
				entries: [{ ...link, source: { trial: 'r1-s1-a1' } }],
			}),
		).toBe(false)
		expect(isStudyLabelLegend({ result: 'a'.repeat(64), entries: link })).toBe(false)
	})
})
