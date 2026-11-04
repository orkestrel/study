import { captureError } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	studyJudgmentContract,
	studyLabelsContract,
	studyRubricContract,
} from '../../../src/core/contracts.js'
import {
	scanStudyJudgmentFaults,
	scanStudyLabelsFaults,
	scanStudyRubricFaults,
} from '../../../src/core/helpers.js'
import {
	parseStudyJudgments,
	parseStudyLabels,
	parseStudyRubric,
} from '../../../src/core/parsers.js'
import { isStudyJudgment, isStudyLabels, isStudyRubric } from '../../../src/core/validators.js'
import {
	STUDY_JUDGMENT_LOCKSTEP,
	STUDY_LABELS_LOCKSTEP,
	STUDY_RUBRIC_LOCKSTEP,
	buildStudyLockstepLabels,
} from '../../setupStudy.js'

describe('study filled shapes in lockstep with their hand guards', () => {
	it.each(STUDY_RUBRIC_LOCKSTEP)('rubric: $name', ({ value, accepted }) => {
		expect(isStudyRubric(value)).toBe(accepted)
		expect(studyRubricContract.is(value) && scanStudyRubricFaults(value).length === 0).toBe(
			accepted,
		)
		expect(captureError(() => parseStudyRubric(value)) === undefined).toBe(accepted)
	})

	it.each(STUDY_JUDGMENT_LOCKSTEP)('judgment: $name', ({ value, accepted }) => {
		expect(isStudyJudgment(value)).toBe(accepted)
		expect(
			studyJudgmentContract.is(value) && scanStudyJudgmentFaults(value, 'value').length === 0,
		).toBe(accepted)
		expect(captureError(() => parseStudyJudgments([value])) === undefined).toBe(accepted)
	})

	it.each(STUDY_LABELS_LOCKSTEP)('labels: $name', ({ value, accepted }) => {
		expect(isStudyLabels(value)).toBe(accepted)
		expect(studyLabelsContract.is(value) && scanStudyLabelsFaults(value).length === 0).toBe(
			accepted,
		)
		expect(captureError(() => parseStudyLabels(value)) === undefined).toBe(accepted)
	})
})

describe('study filled refusals name the field', () => {
	it.each([
		[{}, 'version: missing string'],
		[{ version: ' ', criteria: [] }, 'version: breaks pattern'],
		[{ version: '1', criteria: [] }, 'criteria: breaks min 1'],
		[
			{
				version: '1',
				criteria: [
					{ id: 'one', scenario: 's', goal: 'g', method: 'read', critical: true, assertion: 1 },
				],
			},
			'criteria.0.method',
		],
		[
			{
				version: '1',
				criteria: [
					{
						id: 'one',
						scenario: 's',
						goal: 'g',
						method: 'state',
						critical: true,
						assertion: 1,
						weight: 2,
					},
				],
			},
			'criteria.0.weight: undeclared key',
		],
		[
			{
				version: '1',
				criteria: [
					{ id: 'one', scenario: 's', goal: 'g', method: 'state', critical: true, assertion: 1 },
					{ id: 'one', scenario: 's', goal: 'h', method: 'state', critical: true, assertion: 1 },
				],
			},
			'criteria.1.id: repeats one',
		],
	])('rubric %#', (value, path) => {
		expect(() => parseStudyRubric(value)).toThrow(
			expect.objectContaining({ code: 'CONFIG', message: expect.stringContaining(path) }),
		)
	})

	it.each([
		[{ ...buildStudyLockstepLabels(), packet: 'short' }, 'packet: breaks pattern'],
		[
			{ ...buildStudyLockstepLabels(), created: '2026-02-30T00:00:00.000Z' },
			'created: names no real instant',
		],
		[
			{ ...buildStudyLockstepLabels(), usage: [{ role: 'nobody', calls: 0, duration: 0 }] },
			'usage.0.role',
		],
		[
			{ ...buildStudyLockstepLabels(), usage: [{ role: 'tool', calls: 1.5, duration: 0 }] },
			'usage.0.calls',
		],
		[
			{
				...buildStudyLockstepLabels(),
				judgments: [{ ...buildStudyLockstepLabels().judgments[0], method: 'state' }],
			},
			'judgments.0.method',
		],
		[
			{
				...buildStudyLockstepLabels(),
				judgments: [{ ...buildStudyLockstepLabels().judgments[0], references: [] }],
			},
			'judgments.0.references: a verdict needs evidence',
		],
		[
			{
				...buildStudyLockstepLabels(),
				judgments: [
					buildStudyLockstepLabels().judgments[0],
					buildStudyLockstepLabels().judgments[0],
				],
			},
			'judgments.1: repeats its trial and criterion',
		],
	])('labels %#', (value, path) => {
		expect(() => parseStudyLabels(value)).toThrow(
			expect.objectContaining({ code: 'EVIDENCE', message: expect.stringContaining(path) }),
		)
	})

	it('names a refused judgment by its index and keeps a plain list refusal', () => {
		const judgment = buildStudyLockstepLabels().judgments[0]
		expect(() => parseStudyJudgments('none')).toThrow(/expected array/)
		expect(() => parseStudyJudgments([judgment, { ...judgment, verdict: 'maybe' }])).toThrow(
			expect.objectContaining({ code: 'FAULT', message: expect.stringContaining('1: verdict') }),
		)
		expect(() => parseStudyJudgments([{ ...judgment, references: [] }])).toThrow(
			/0\.references: a verdict needs evidence/,
		)
	})

	it('refuses an accessor as unreadable without running it', () => {
		const labels = buildStudyLockstepLabels()
		const reads: string[] = []
		const hostile = Object.defineProperty({ ...labels }, 'packet', {
			enumerable: true,
			get: () => {
				reads.push('packet')
				return labels.packet
			},
		})
		expect(() => parseStudyLabels(hostile)).toThrow(/unreadable/)
		expect(reads).toEqual([])
	})
})

describe('study published JSON Schemas', () => {
	it('publishes the closed labels schema a labeler fills', () => {
		expect(studyLabelsContract.schema).toMatchObject({
			type: 'object',
			additionalProperties: false,
			required: ['packet', 'labeler', 'version', 'created', 'usage', 'judgments'],
			properties: {
				packet: { type: 'string', pattern: '^[a-f0-9]{64}$' },
				judgments: {
					type: 'array',
					items: {
						additionalProperties: false,
						required: ['trial', 'criterion', 'verdict', 'method', 'reason', 'references'],
						properties: {
							verdict: { enum: ['achieved', 'unsuccessful', 'unknown'] },
							method: { enum: ['human', 'model'] },
						},
					},
				},
			},
		})
	})

	it('publishes the rubric and judgment schemas', () => {
		expect(studyRubricContract.schema).toMatchObject({
			required: ['version', 'criteria'],
			properties: { criteria: { minItems: 1 } },
		})
		expect(studyJudgmentContract.schema).toMatchObject({
			properties: { method: { enum: ['state', 'trace', 'human', 'model'] } },
		})
	})
})
