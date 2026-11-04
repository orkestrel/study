import { describe, expect, it } from 'vitest'
import {
	studyLabelAnswersContract,
	studyLabelPoolContract,
} from '../../../../src/server/labels/contracts.js'
import { parseStudyLabelLane, parseStudyLabelPool } from '../../../../src/server/labels/parsers.js'
import { STUDY_LABEL_CONTROLS, buildStudyLabelMap } from '../../../setupServer.js'

describe('parseStudyLabelLane', () => {
	it('owns one labeler answer under its accountable name', () => {
		const rows = [{ row: 1, verdict: 'achieved', reason: 'Cites row', revealed: true }]
		const lane = parseStudyLabelLane({ rows }, 'first')
		expect(lane).toEqual({ labeler: 'first', rows })
		expect(Object.isFrozen(lane.rows)).toBe(true)
	})

	it('refuses by the refused field path, a blank reason and an undeclared key included', () => {
		const refusals = [
			[{}, 'rows: missing array'],
			[{ rows: [{ row: 0, verdict: 'achieved', reason: 'Why' }] }, 'rows.0.row: breaks min 1'],
			[{ rows: [{ row: 1, verdict: 'maybe', reason: 'Why' }] }, 'rows.0.verdict'],
			[{ rows: [{ row: 1, verdict: 'unknown', reason: ' ' }] }, 'rows.0.reason: breaks pattern'],
			[{ rows: [{ row: 1, verdict: 'unknown' }] }, 'rows.0.reason: missing string'],
			[
				{ rows: [{ row: 1, verdict: 'unknown', reason: 'Why', extra: 1 }] },
				'rows.0.extra: undeclared key',
			],
		] as const
		for (const [value, path] of refusals) {
			expect(() => parseStudyLabelLane(value, 'first')).toThrow(
				expect.objectContaining({ code: 'EVIDENCE', message: expect.stringContaining(path) }),
			)
		}
	})

	it('publishes the JSON Schema a labeler fills', () => {
		expect(studyLabelAnswersContract.schema).toMatchObject({
			type: 'object',
			required: ['rows'],
			additionalProperties: false,
			properties: {
				rows: {
					type: 'array',
					items: {
						required: ['row', 'verdict', 'reason'],
						additionalProperties: false,
						properties: {
							verdict: { enum: ['achieved', 'unsuccessful', 'unknown'] },
							reason: { type: 'string', pattern: '\\S' },
						},
					},
				},
			},
		})
	})
})

describe('parseStudyLabelPool', () => {
	it('owns a pool kept between stages and refuses a broken one by path', () => {
		const map = buildStudyLabelMap(['work'])
		const control = STUDY_LABEL_CONTROLS[0]
		const pool = {
			requests: [
				{
					rows: [
						{
							row: 1,
							input: control?.input,
							product: control?.product,
							assertion: control?.assertion,
						},
					],
				},
			],
			map,
		}
		expect(parseStudyLabelPool(JSON.parse(JSON.stringify(pool)))).toEqual(pool)
		expect(studyLabelPoolContract.is(pool)).toBe(true)
		expect(() => parseStudyLabelPool({ ...pool, map: { links: [{}], checks: [] } })).toThrow(
			/map\.links\.0\.row: missing integer/,
		)
	})
})
