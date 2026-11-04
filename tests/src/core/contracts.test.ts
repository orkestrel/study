import { seededRandom, isRecord, attempt } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { buildStudyContractCases, buildStudyJudgment } from '../../setupStudy.js'
import { studyJudgmentContract } from '../../../src/core/contracts.js'
import { isStudyJudgment } from '../../../src/core/validators.js'
import { parseStudyJudgments, parseStudyRubric } from '../../../src/core/parsers.js'

describe('standing guard contract table', () => {
	it.each(buildStudyContractCases())(
		'$name: canonical admission, negative control, and restoration',
		(row) => {
			expect(row.direction).toBe('is implies structural guard; domain semantics may refuse')
			expect(row.project).toBeUndefined()
			expect(row.wire.is(row.positive)).toBe(true)
			expect(row.guard(row.positive)).toBe(true)
			expect(row.wire.is(row.negative)).toBe(false)
			expect(row.guard(row.negative)).toBe(false)
		},
	)
	it.each(buildStudyContractCases().filter((row) => row.restore !== undefined))(
		'$name: restores an owned snapshot',
		(row) => {
			if (row.restore === undefined) throw new Error('Missing restoration')
			const snapshot = row.restore(row.positive)
			expect(row.wire.is(snapshot)).toBe(true)
			expect(row.restore(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
			expect(Object.isFrozen(snapshot)).toBe(true)
		},
	)
	it.each(
		buildStudyContractCases().filter(
			(row) => !['digest', 'timestamp', 'labels'].includes(row.name),
		),
	)('$name: generated admissions retain counted semantic refusals', (row) => {
		const admissions = Array.from({ length: 100 }, (_, seed) => {
			const value = row.wire.generate(seededRandom(seed))
			return { admitted: row.wire.is(value), guarded: row.guard(value) }
		})
		expect(admissions.filter((entry) => !entry.admitted)).toEqual([])
		const refused = admissions.filter((entry) => !entry.guarded).length
		expect(refused).toBe(0)
	})
	it.each(
		buildStudyContractCases().filter((row) => ['digest', 'timestamp', 'labels'].includes(row.name)),
	)('$name: generator explicitly refuses unsupported patterns', (row) => {
		const result = attempt(() => row.wire.generate(seededRandom(0)))
		expect(result.success).toBe(false)
	})
	it('keeps judgment evidence and reference uniqueness as semantic refusals', () => {
		const judgment = buildStudyJudgment('trial')
		for (const references of [[], ['same', 'same']]) {
			const value = { ...judgment, references }
			expect(studyJudgmentContract.is(value)).toBe(true)
			expect(isStudyJudgment(value)).toBe(false)
			expect(() => parseStudyJudgments([value])).toThrow(/Grader returned invalid judgments/)
		}
	})
	it('refuses coercion and extra keys at the snapshot door', () => {
		const row = buildStudyContractCases().find((entry) => entry.name === 'rubric')
		if (row === undefined || !isRecord(row.positive)) throw new Error('Missing rubric')
		for (const value of [
			{ ...row.positive, version: 1 },
			{ ...row.positive, extra: true },
		]) {
			expect(isRecord(value)).toBe(true)
			expect(() => parseStudyRubric(value)).toThrow(/Invalid study rubric/)
		}
	})
})
