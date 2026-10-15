import type { StudyEvidence } from '../../../../src/core/types.js'
import type { StudyGradeTarget } from '../../../../src/server/adapters/types.js'
import { createRecorder, requireValue } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isStudyError, StudyError } from '../../../../src/core/errors.js'
import { buildStudyReference, gradeStudyEvidence } from '../../../../src/server/adapters/helpers.js'
import {
	buildStudyAdjudication,
	buildStudyEvidenceRow,
	buildStudySparseEvidence,
	createStudyAttemptGrade,
	createStudyRowGrade,
	readStudyAdjudication,
	retainStudyFixture,
	STUDY_HOSTILE_REFERENCES,
	STUDY_PREDICATE_RUBRIC,
} from '../../../setupServer.js'
import {
	buildCompactCustodyManifest,
	buildCustodyAttempt,
	buildCustodyManifest,
	buildStudyOperationAttempts,
} from '../../../setupStudy.js'

describe('gradeStudyEvidence', () => {
	it('grades the declared population in schedule then rubric order and cites the latest retained row one-based', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
				[
					{ event: 'saved', goal: 'write', value: 'stale' },
					{ event: 'saved', goal: 'write', value: 'remember' },
				],
			)
			const judgments = gradeStudyEvidence(
				await readStudyAdjudication(result),
				createStudyRowGrade(),
			)
			expect(
				judgments.map((judgment) => [
					judgment.trial,
					judgment.criterion,
					judgment.verdict,
					judgment.method,
					judgment.references,
				]),
			).toEqual([
				['r1-s1-a1', 'first-operational', 'unknown', 'state', []],
				['r1-s1-a1', 'first-saved', 'achieved', 'trace', ['trials/r1-s1-a1/evidence.jsonl#2']],
				['r1-s1-a1', 'first-read', 'unknown', 'human', []],
				['r1-s2-a1', 'second-operational', 'unknown', 'state', []],
				['r1-s2-a1', 'second-saved', 'achieved', 'trace', ['trials/r1-s2-a1/evidence.jsonl#2']],
				['r1-s2-a1', 'second-read', 'unknown', 'human', []],
			])
			expect(Object.isFrozen(judgments)).toBe(true)
			expect(judgments.every((judgment) => Object.isFrozen(judgment))).toBe(true)
			expect(judgments.every((judgment) => Object.isFrozen(judgment.references))).toBe(true)
		} finally {
			scratch.destroy()
		}
	})

	it('keeps the declared order when retained attempts arrive reversed', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const input = await readStudyAdjudication(result)
			const judgments = gradeStudyEvidence(
				{ ...input, attempts: [...input.attempts].reverse() },
				createStudyRowGrade(),
			)
			expect(judgments.map((judgment) => judgment.trial)).toEqual([
				'r1-s1-a1',
				'r1-s1-a1',
				'r1-s1-a1',
				'r1-s2-a1',
				'r1-s2-a1',
				'r1-s2-a1',
			])
		} finally {
			scratch.destroy()
		}
	})

	it('judges a trial without a retained attempt and hands its predicate neither attempt nor evidence', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const input = await readStudyAdjudication(result)
			const targets = createRecorder<readonly [StudyGradeTarget]>()
			const judgments = gradeStudyEvidence(
				{ ...input, attempts: input.attempts.slice(0, 1) },
				(target) => {
					targets.handler(target)
					return createStudyRowGrade()(target)
				},
			)
			expect(judgments).toHaveLength(6)
			const missing = judgments.filter((judgment) => judgment.trial === 'r1-s2-a1')
			expect(missing.map((judgment) => [judgment.verdict, judgment.references])).toEqual([
				['unknown', []],
				['unknown', []],
				['unknown', []],
			])
			const unretained = targets.calls.filter(([target]) => target.trial.id === 'r1-s2-a1')
			expect(unretained).toHaveLength(3)
			for (const [target] of unretained) {
				expect(target.attempt).toBeUndefined()
				expect(target.evidence).toEqual([])
			}
			expect(input.evidence['r1-s2-a1']).toHaveLength(1)
			const retained = requireValue(
				targets.calls.find(([target]) => target.trial.id === 'r1-s1-a1'),
			)[0]
			expect(retained.attempt?.trial.id).toBe('r1-s1-a1')
			expect(retained.evidence).toEqual(input.evidence['r1-s1-a1'])
		} finally {
			scratch.destroy()
		}
	})

	it('supports a whole-attempt predicate over real retained evidence and cites files and rows', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const judgments = gradeStudyEvidence(
				await readStudyAdjudication(result),
				createStudyAttemptGrade(),
			)
			expect(
				judgments
					.filter((judgment) => judgment.trial === 'r1-s1-a1')
					.map((judgment) => [
						judgment.criterion,
						judgment.verdict,
						judgment.method,
						judgment.references,
					]),
			).toEqual([
				['first-operational', 'achieved', 'state', ['trials/r1-s1-a1/attempt.json']],
				['first-saved', 'achieved', 'trace', ['trials/r1-s1-a1/evidence.jsonl#1']],
				['first-read', 'unknown', 'human', []],
			])
		} finally {
			scratch.destroy()
		}
	})

	it('leaves per-goal success to the consumer: a whole-attempt failure fails a goal that itself succeeded', () => {
		const manifest = buildCustodyManifest()
		const attempts = buildStudyOperationAttempts(manifest)
		const judgments = gradeStudyEvidence(
			buildStudyAdjudication(manifest, attempts),
			createStudyAttemptGrade(),
		)
		expect(judgments).toHaveLength(manifest.schedule.length * 3)
		expect(
			judgments
				.filter((judgment) => judgment.criterion.endsWith('-operational'))
				.map((judgment) => judgment.verdict),
		).toEqual([
			'achieved',
			'unsuccessful',
			'achieved',
			'unsuccessful',
			'unsuccessful',
			'unsuccessful',
			'achieved',
			'achieved',
		])
		// The fifth attempt dispatched its write goal without a failure and failed afterwards.
		const late = requireValue(attempts[5])
		expect(late.observations[0]?.failure).toBeUndefined()
		expect(late.observations[0]?.product).toBeDefined()
		expect(late.failure?.cause).toBe('deadline')
		expect(
			judgments.find(
				(judgment) =>
					judgment.trial === late.trial.id && judgment.criterion.endsWith('-operational'),
			)?.verdict,
		).toBe('unsuccessful')
	})

	it('refuses invalid declarations, attempts, evidence and unreachable goals when called directly', () => {
		const base = buildStudyAdjudication()
		const grade = createStudyRowGrade()
		const first = requireValue(base.attempts[0])
		const extra = { event: 'saved', goal: 'write', value: 1, extra: true }
		const cases = [
			[
				'rubric',
				{ ...base, rubric: { version: '', criteria: [] } },
				'CONFIG',
				/Invalid grading rubric/,
			],
			[
				'schedule',
				{
					...base,
					manifest: { ...base.manifest, schedule: [...base.manifest.schedule].reverse() },
				},
				'CONFIG',
				/Invalid grading manifest/,
			],
			[
				'foreign attempt',
				{
					...base,
					attempts: [{ ...first, trial: { ...first.trial, id: 'foreign' } }],
				},
				'EVIDENCE',
				/Invalid or duplicate grading attempts/,
			],
			[
				'duplicate attempt',
				{ ...base, attempts: [first, first] },
				'EVIDENCE',
				/Invalid or duplicate grading attempts/,
			],
			[
				'foreign evidence',
				{ ...base, evidence: { ghost: [] } },
				'EVIDENCE',
				/Invalid or foreign grading evidence/,
			],
			[
				'invalid evidence row',
				{ ...base, evidence: { 'r1-s1-a1': [extra] } },
				'EVIDENCE',
				/Invalid or foreign grading evidence/,
			],
			[
				'undeclared goal',
				{
					...base,
					rubric: {
						version: '1',
						criteria: [
							{
								id: 'ghost',
								scenario: 'first',
								goal: 'ghost',
								method: 'state',
								critical: false,
								assertion: true,
							},
						],
					},
				},
				'CONFIG',
				/undeclared goal/,
			],
		] as const
		for (const [, input, code, message] of cases)
			expect(() => gradeStudyEvidence(input, grade)).toThrow(
				expect.objectContaining({ code, message: expect.stringMatching(message) }),
			)
		expect(() => Reflect.apply(gradeStudyEvidence, undefined, [undefined, grade])).toThrow(
			/Invalid grading input/,
		)
		expect(() => gradeStudyEvidence(base, grade)).not.toThrow()
	})

	it('refuses a predicate reading that is not a valid judgment or cites evidence that was not retained', () => {
		const base = buildStudyAdjudication(
			undefined,
			undefined,
			Object.fromEntries(
				buildCompactCustodyManifest().schedule.map((trial): [string, readonly StudyEvidence[]] => [
					trial.id,
					[{ event: 'saved', goal: 'write', value: 'remember' }],
				]),
			),
		)
		const reading = {
			verdict: 'achieved',
			method: 'state',
			reason: 'Matches',
			references: [],
		} as const
		expect(() => gradeStudyEvidence(base, () => reading)).toThrow(/invalid judgment/)
		expect(() =>
			gradeStudyEvidence(base, () => ({ ...reading, verdict: 'unknown', reason: '  ' })),
		).toThrow(/invalid judgment/)
		expect(() =>
			gradeStudyEvidence(base, () => ({
				...reading,
				references: [{ file: 'attempt' }, { file: 'attempt' }],
			})),
		).toThrow(/invalid judgment/)
		for (const hostile of [
			null,
			'unknown',
			{ ...reading, references: 'attempt' },
			{ ...reading, references: [{ file: 'rows' }] },
		])
			expect(() => Reflect.apply(gradeStudyEvidence, undefined, [base, () => hostile])).toThrow(
				/invalid reading|unknown retained file/,
			)
		for (const row of [1, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() =>
				gradeStudyEvidence(base, () => ({ ...reading, references: [{ file: 'evidence', row }] })),
			).toThrow(/row that does not exist/)
		expect(() =>
			gradeStudyEvidence(base, () => ({ ...reading, references: [{ file: 'attempt', row: 0 }] })),
		).toThrow(/row that does not exist/)
		const partial = buildStudyAdjudication(undefined, base.attempts.slice(0, 1), base.evidence)
		expect(() =>
			gradeStudyEvidence(partial, () => ({ ...reading, references: [{ file: 'attempt' }] })),
		).toThrow(/not retained/)
	})

	it('propagates a predicate refusal unchanged', () => {
		const refusal = new StudyError('EVIDENCE', 'Malformed domain evidence')
		expect(() =>
			gradeStudyEvidence(buildStudyAdjudication(), () => {
				throw refusal
			}),
		).toThrow(refusal)
	})

	it('yields one unknown judgment for every declared pair when no evidence was retained', () => {
		const judgments = gradeStudyEvidence(buildStudyAdjudication(), createStudyRowGrade())
		expect(judgments.map((judgment) => `${judgment.trial}/${judgment.criterion}`)).toEqual([
			'r1-s1-a1/first-operational',
			'r1-s1-a1/first-saved',
			'r1-s1-a1/first-read',
			'r1-s2-a1/second-operational',
			'r1-s2-a1/second-saved',
			'r1-s2-a1/second-read',
		])
		expect(judgments.every((judgment) => judgment.verdict === 'unknown')).toBe(true)
	})
})

describe('buildStudyReference', () => {
	const manifest = buildCompactCustodyManifest()
	const trial = requireValue(manifest.schedule[0])
	const criterion = requireValue(STUDY_PREDICATE_RUBRIC.criteria[0])
	const evidence: readonly StudyEvidence[] = [
		{ event: 'saved', goal: 'write', value: 'a' },
		{ event: 'saved', goal: 'write', value: 'b' },
	]
	const target: StudyGradeTarget = {
		trial,
		criterion,
		attempt: buildCustodyAttempt(manifest, trial),
		evidence,
	}

	it('renders retained paths and one-based rows', () => {
		expect(buildStudyReference(target, { file: 'attempt' })).toBe('trials/r1-s1-a1/attempt.json')
		expect(buildStudyReference(target, { file: 'evidence' })).toBe('trials/r1-s1-a1/evidence.jsonl')
		expect(buildStudyReference(target, { file: 'evidence', row: 0 })).toBe(
			'trials/r1-s1-a1/evidence.jsonl#1',
		)
		expect(buildStudyReference(target, { file: 'evidence', row: 1 })).toBe(
			'trials/r1-s1-a1/evidence.jsonl#2',
		)
	})

	it('refuses rows beyond the retained evidence, rows of the attempt file and unretained trials', () => {
		expect(() => buildStudyReference(target, { file: 'evidence', row: 2 })).toThrow(
			/row that does not exist/,
		)
		expect(() => buildStudyReference(target, { file: 'attempt', row: 0 })).toThrow(
			/row that does not exist/,
		)
		expect(() =>
			buildStudyReference({ ...target, attempt: undefined }, { file: 'attempt' }),
		).toThrow(/not retained/)
	})

	it('refuses a row whose retained slot is absent and keeps later citations unshifted', () => {
		const { lone, tail, interior } = buildStudySparseEvidence()
		expect(buildStudyReference({ ...target, evidence: tail }, { file: 'evidence', row: 0 })).toBe(
			'trials/r1-s1-a1/evidence.jsonl#1',
		)
		expect(
			buildStudyReference({ ...target, evidence: interior }, { file: 'evidence', row: 2 }),
		).toBe('trials/r1-s1-a1/evidence.jsonl#3')
		const absent = [
			[{ ...target, evidence: lone }, 0],
			[{ ...target, evidence: tail }, 1],
			[{ ...target, evidence: interior }, 1],
		] as const
		for (const [sparse, row] of absent)
			expect(() => buildStudyReference(sparse, { file: 'evidence', row })).toThrow(
				expect.objectContaining({
					code: 'EVIDENCE',
					message: expect.stringMatching(/does not exist/),
				}),
			)
	})

	it('keeps whole-file references valid without a row, including over empty evidence', () => {
		const empty = { ...target, evidence: [] }
		expect(buildStudyReference(empty, { file: 'evidence' })).toBe('trials/r1-s1-a1/evidence.jsonl')
		expect(buildStudyReference(empty, { file: 'attempt' })).toBe('trials/r1-s1-a1/attempt.json')
		expect(() => buildStudyReference(empty, { file: 'evidence', row: 0 })).toThrow(
			/row that does not exist/,
		)
	})

	it('refuses a reference that is not a record with a study refusal rather than a raw TypeError', () => {
		for (const hostile of STUDY_HOSTILE_REFERENCES) {
			const args = [target, hostile]
			let caught: unknown
			try {
				Reflect.apply(buildStudyReference, undefined, args)
			} catch (error) {
				caught = error
			}
			expect(isStudyError(caught)).toBe(true)
			expect(caught).toMatchObject({ code: 'EVIDENCE' })
		}
	})
})

describe('gradeStudyEvidence sparse evidence', () => {
	const manifest = buildCompactCustodyManifest()
	const [first, second] = manifest.schedule

	it('refuses evidence with a hole at the tail, the interior, or a lone slot without renumbering', () => {
		const { lone, tail, interior } = buildStudySparseEvidence()
		const grade = createStudyRowGrade()
		const inputs = [lone, tail, interior].map((sparse) =>
			buildStudyAdjudication(undefined, undefined, { [requireValue(first).id]: sparse }),
		)
		for (const input of inputs)
			expect(() => gradeStudyEvidence(input, grade)).toThrow(
				expect.objectContaining({
					code: 'EVIDENCE',
					message: expect.stringMatching(/Invalid or foreign grading evidence/),
				}),
			)
	})

	it('still cites a valid dense row as #1 and accepts empty evidence', () => {
		const denseInput = buildStudyAdjudication(undefined, undefined, {
			[requireValue(first).id]: [buildStudyEvidenceRow('a')],
			[requireValue(second).id]: [],
		})
		const emptyInput = buildStudyAdjudication(undefined, undefined, {
			[requireValue(first).id]: [],
		})
		const dense = gradeStudyEvidence(denseInput, createStudyAttemptGrade())
		expect(dense.find((judgment) => judgment.criterion === 'first-saved')?.references).toEqual([
			'trials/r1-s1-a1/evidence.jsonl#1',
		])
		const empty = gradeStudyEvidence(emptyInput, createStudyRowGrade())
		expect(empty.every((judgment) => judgment.verdict === 'unknown')).toBe(true)
	})

	it('refuses non-record references from a predicate with a study refusal', () => {
		const base = buildStudyAdjudication()
		for (const hostile of STUDY_HOSTILE_REFERENCES) {
			const reading = {
				verdict: 'unknown',
				method: 'state',
				reason: 'Hostile',
				references: [hostile],
			}
			const args = [base, () => reading]
			let caught: unknown
			try {
				Reflect.apply(gradeStudyEvidence, undefined, args)
			} catch (error) {
				caught = error
			}
			expect(isStudyError(caught)).toBe(true)
			expect(caught).toMatchObject({ code: 'EVIDENCE' })
		}
	})
})
