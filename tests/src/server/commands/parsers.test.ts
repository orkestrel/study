import { describe, expect, it } from 'vitest'
import { STUDY_COMMAND_INVALID_ARGUMENTS } from '../../../setupStudy.js'
import { parseStudyArguments } from '../../../../src/server/commands/parsers.js'

describe('study command arguments', () => {
	it('accepts contained relative output and gives actionable flag diagnostics', () => {
		expect(parseStudyArguments(['execute', 'files', '--out', 'tmp/studies/chosen'])).toMatchObject({
			out: 'tmp/studies/chosen',
		})
		expect(() => parseStudyArguments(['execute', 'files', '--out', '../escape'])).toThrow(
			/--out.*escape/,
		)
		expect(() => parseStudyArguments(['execute', 'files', '--profile', '../bad'])).toThrow(
			/--profile.*bad/,
		)
		expect(() => parseStudyArguments(['check', 'files', '--out', 'chosen'])).toThrow(
			/--out.*check.*--profile/,
		)
		expect(() => parseStudyArguments(['grade', 'result'])).toThrow(/--rubric.*study grade/)
		expect(() => parseStudyArguments(['check', 'files', '--profile'])).toThrow(
			/--profile.*value.*study check/,
		)
		expect(() =>
			parseStudyArguments(['check', 'files', '--profile', 'local', '--profile', 'local']),
		).toThrow(/--profile.*duplicate.*study check/)
	})
	it.each(STUDY_COMMAND_INVALID_ARGUMENTS)(
		'refuses malformed command tokens %j',
		(...arguments_) => {
			expect(() => parseStudyArguments(arguments_)).toThrow(/\S/)
		},
	)

	it('refuses a sparse token array at its absent flag or value exactly as a dense one that ends early', () => {
		const trailing = Object.assign(new Array<string>(4), { 0: 'check', 1: 'files' })
		const value = Object.assign(new Array<string>(4), { 0: 'check', 1: 'files', 2: '--profile' })
		const interior = Object.assign(new Array<string>(6), {
			0: 'check',
			1: 'files',
			2: '--profile',
			3: 'local',
			5: 'tail',
		})
		expect(1 in trailing).toBe(true)
		expect(2 in trailing).toBe(false)
		expect(() => parseStudyArguments(trailing)).toThrow(/"<end>" is not a check flag.*study check/)
		expect(() => parseStudyArguments(value)).toThrow(
			/--profile requires a value before "<end>".*study check/,
		)
		expect(() => parseStudyArguments(interior)).toThrow(/"<end>" is not a check flag.*study check/)
		expect(() => parseStudyArguments(['check', 'files', '--unknown', 'x'])).toThrow(
			/"--unknown" is not a check flag.*study check/,
		)
	})

	it('parses independent operations and the supervisor fingerprint without duplicate flags', () => {
		expect(parseStudyArguments(['check', 'tools'])).toEqual({
			command: 'check',
			target: 'tools',
			profile: 'local',
			out: undefined,
			expected: undefined,
		})
		expect(parseStudyArguments(['execute', 'tools', '--expected', 'a'.repeat(64)])).toMatchObject({
			command: 'execute',
			expected: 'a'.repeat(64),
		})
		expect(parseStudyArguments(['grade', 'result', '--rubric', 'rubric.json'])).toEqual({
			command: 'grade',
			target: 'result',
			rubric: 'rubric.json',
		})
		expect(
			parseStudyArguments([
				'label',
				'result',
				'--grading',
				'a'.repeat(64),
				'--labels',
				'labels.json',
			]),
		).toMatchObject({ command: 'label', labels: 'labels.json' })
		expect(parseStudyArguments(['report', 'result', '--grading', 'a'.repeat(64)])).toMatchObject({
			command: 'report',
			grading: 'a'.repeat(64),
		})
	})
})
