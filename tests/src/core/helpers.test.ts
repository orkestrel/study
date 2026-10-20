import { studyStopToJSON } from '../../../src/core/helpers.js'
import { buildStudyStop } from '../../setupStudy.js'
import { expect, it } from 'vitest'
import {
	buildStudySchedule,
	computeStudyScores,
	matchesStudyKeys,
	normalizeStudyProfile,
	omitStudyAbsent,
	validateStudyInputs,
} from '../../../src/core/helpers.js'
import { StudyError } from '../../../src/core/errors.js'
import {
	STUDY_UNQUALIFIED_PURPOSES,
	buildStudyDefinition,
	buildStudyGrading,
	buildStudyJudgment,
	buildStudyManifest,
	buildStudyProfile,
	buildStudyRubric,
	buildStudyScenario,
} from '../../setupStudy.js'

it('omits undefined entries in order and keeps falsy declared values', () => {
	expect(
		Object.keys(omitStudyAbsent({ a: 1, b: undefined, c: 0, d: false, e: null, f: '' })),
	).toEqual(['a', 'c', 'd', 'e', 'f'])
	expect(omitStudyAbsent({})).toEqual({})
	expect(omitStudyAbsent({ b: undefined })).toEqual({})
})

it('normalizes a profile so every undeclared optional role is absent and the declared order holds', () => {
	const base = buildStudyProfile()
	const absent = normalizeStudyProfile(base)
	expect(Object.keys(absent)).toEqual(['name', 'agent', 'subject', 'roots', 'bounds', 'room'])
	const provider = {
		entry: 'dist/index.js',
		url: 'http://127.0.0.1:11435',
		model: 'subject',
		judge: undefined,
		digest: { model: 'a'.repeat(64), judge: undefined },
	}
	const room = { ...base.room, recap: undefined }
	const plain = normalizeStudyProfile({ ...base, room, provider })
	expect(JSON.stringify(plain)).not.toMatch(/recap|judge/)
	expect(plain).toEqual({
		...absent,
		room: { context: 512, output: 32, safety: 16, think: false },
		provider: {
			entry: provider.entry,
			url: provider.url,
			model: 'subject',
			digest: { model: 'a'.repeat(64) },
		},
	})
	const declared = normalizeStudyProfile({
		...base,
		provider: {
			...provider,
			judge: 'judge',
			digest: { model: 'a'.repeat(64), judge: 'b'.repeat(64) },
		},
	})
	expect(JSON.stringify(declared)).toContain('"judge":"judge"')
	expect(JSON.stringify(declared)).toContain(`"judge":"${'b'.repeat(64)}"`)
	expect(JSON.stringify(declared)).toContain('"recap":32')
})

it('requires own exact enumerable data fields without invoking accessors', () => {
	expect(matchesStudyKeys({ id: 'one' }, ['id'])).toBe(true)
	expect(matchesStudyKeys({ id: 'one', optional: undefined }, ['id'], ['optional'])).toBe(true)
	expect(matchesStudyKeys({ id: 'one', typo: true }, ['id'])).toBe(false)
	expect(matchesStudyKeys(Object.create({ id: 'one' }), ['id'])).toBe(false)
	expect(
		matchesStudyKeys(
			Object.defineProperty({}, 'id', {
				get: () => {
					throw new Error('read')
				},
				enumerable: true,
			}),
			['id'],
		),
	).toBe(false)
	expect(matchesStudyKeys({ id: 'one', [Symbol('extra')]: true }, ['id'])).toBe(false)
	expect(matchesStudyKeys(Object.defineProperty({}, 'id', { value: 'one' }), ['id'])).toBe(false)
	const revoked = Proxy.revocable({}, {})
	revoked.revoke()
	expect(matchesStudyKeys(revoked.proxy, [])).toBe(false)
	expect(
		matchesStudyKeys(
			new Proxy(
				{},
				{
					ownKeys: () => {
						throw new Error('keys')
					},
				},
			),
			[],
		),
	).toBe(false)
})

it('preserves row order and keeps every repetition distinct with portable unique ids', () => {
	const schedule = buildStudySchedule(buildStudyDefinition(), [
		buildStudyScenario('second'),
		buildStudyScenario(),
	])
	expect(schedule).toEqual([
		{ id: 'r1-s1-a2', scenario: 'first', arm: 'large', repetition: 0 },
		{ id: 'r1-s1-a1', scenario: 'first', arm: 'small', repetition: 0 },
		{ id: 'r1-s2-a2', scenario: 'second', arm: 'large', repetition: 0 },
		{ id: 'r1-s2-a1', scenario: 'second', arm: 'small', repetition: 0 },
		{ id: 'r2-s1-a1', scenario: 'first', arm: 'small', repetition: 1 },
		{ id: 'r2-s1-a2', scenario: 'first', arm: 'large', repetition: 1 },
		{ id: 'r2-s2-a1', scenario: 'second', arm: 'small', repetition: 1 },
		{ id: 'r2-s2-a2', scenario: 'second', arm: 'large', repetition: 1 },
	])
	expect(new Set(schedule.map((trial) => trial.id)).size).toBe(8)
	expect(Object.isFrozen(schedule)).toBe(true)
	expect(schedule.every(Object.isFrozen)).toBe(true)
})

it('rejects duplicate, missing, foreign and oversized scenario populations', () => {
	const definition = buildStudyDefinition()
	const scenarios = [buildStudyScenario(), buildStudyScenario('second')]
	expect(() =>
		buildStudySchedule(definition, [...scenarios, scenarios[0] ?? buildStudyScenario()]),
	).toThrow(StudyError)
	expect(() => buildStudySchedule(definition, [buildStudyScenario()])).toThrow(StudyError)
	expect(() =>
		buildStudySchedule(definition, [buildStudyScenario(), buildStudyScenario('foreign')]),
	).toThrow(StudyError)
	expect(() =>
		buildStudySchedule(
			buildStudyDefinition({ order: Array.from({ length: 1025 }, () => ['small', 'large']) }),
			scenarios,
		),
	).toThrow(StudyError)
})

it('enforces a valid profile, all criterion references, complete goal coverage, purpose and room allowances', () => {
	const manifest = buildStudyManifest()
	const rubric = buildStudyRubric()
	const profile = { ...buildStudyProfile(), qualification: 'tmp/studies/capacity' }
	expect(() =>
		validateStudyInputs(manifest.definition, manifest.scenarios, rubric, profile),
	).not.toThrow()
	// A profile that fails its own guard is refused even when every cross-reference and allowance holds.
	expect(() =>
		validateStudyInputs(manifest.definition, manifest.scenarios, rubric, { ...profile, roots: [] }),
	).toThrow('Invalid rubric or profile')
	expect(() =>
		validateStudyInputs(
			manifest.definition,
			manifest.scenarios,
			{ ...rubric, criteria: rubric.criteria.slice(1) },
			profile,
		),
	).toThrow(StudyError)
	expect(() =>
		validateStudyInputs(
			manifest.definition,
			manifest.scenarios,
			{
				...rubric,
				criteria: rubric.criteria.map((criterion) => ({ ...criterion, goal: 'foreign' })),
			},
			profile,
		),
	).toThrow(StudyError)
	expect(() =>
		validateStudyInputs(
			{ ...manifest.definition, purpose: 'mechanism' },
			manifest.scenarios,
			rubric,
			profile,
		),
	).toThrow(StudyError)
	expect(() =>
		validateStudyInputs(manifest.definition, manifest.scenarios, rubric, {
			...profile,
			room: { ...profile.room, output: 101 },
		}),
	).toThrow(StudyError)
	expect(() =>
		validateStudyInputs(manifest.definition, manifest.scenarios, rubric, {
			...profile,
			room: { ...profile.room, context: 110 },
		}),
	).toThrow(StudyError)
	expect(() =>
		validateStudyInputs(
			manifest.definition,
			manifest.scenarios,
			{ ...rubric, version: '2' },
			profile,
		),
	).not.toThrow()
})

it('binds rubric paths independently of versioned regrading over the same execution', () => {
	const original = buildStudyManifest()
	const manifest = { ...original, definition: { ...original.definition, rubric: 'rubric.json' } }
	const rubric = buildStudyRubric()
	const grading = buildStudyGrading(manifest.schedule)
	expect(() =>
		validateStudyInputs(manifest.definition, manifest.scenarios, rubric, {
			...buildStudyProfile(),
			qualification: 'tmp/studies/capacity',
		}),
	).not.toThrow()
	const first = computeStudyScores(manifest, rubric, grading)
	const revised = { ...rubric, version: '2' }
	expect(computeStudyScores(manifest, revised, { ...grading, rubric: 'd'.repeat(64) })).toEqual(
		first,
	)
	expect(manifest.definition.rubric).toBe('rubric.json')
	expect(manifest.schedule).toBe(original.schedule)
	expect(() =>
		computeStudyScores(manifest, { ...revised, criteria: revised.criteria.slice(1) }, grading),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(
			manifest,
			{
				...revised,
				criteria: revised.criteria.map((criterion) => ({ ...criterion, goal: 'foreign' })),
			},
			grading,
		),
	).toThrow(StudyError)
})

it('requires a capacity qualification for quality after existing room and coverage checks', () => {
	const manifest = buildStudyManifest()
	const definition = { ...manifest.definition, purpose: 'quality' as const }
	const profile = buildStudyProfile()
	const rubric = buildStudyRubric()
	expect(() => validateStudyInputs(definition, manifest.scenarios, rubric, profile)).toThrow(
		expect.objectContaining({
			code: 'CONFIG',
			message: 'Quality studies require a capacity qualification',
		}),
	)
	expect(() =>
		validateStudyInputs(definition, manifest.scenarios, rubric, {
			...profile,
			room: { ...profile.room, context: 110 },
		}),
	).toThrow('Request allowance does not fit the model room')
	expect(() =>
		validateStudyInputs(
			definition,
			manifest.scenarios,
			{ ...rubric, criteria: rubric.criteria.slice(1) },
			profile,
		),
	).toThrow('Every declared goal needs a criterion')
	expect(() =>
		validateStudyInputs(definition, manifest.scenarios, rubric, {
			...profile,
			qualification: 'tmp/studies/capacity',
		}),
	).not.toThrow()
	const mechanical = {
		...rubric,
		criteria: rubric.criteria.map((criterion) => ({ ...criterion, method: 'state' as const })),
	}
	for (const purpose of STUDY_UNQUALIFIED_PURPOSES)
		expect(() =>
			validateStudyInputs({ ...definition, purpose }, manifest.scenarios, mechanical, profile),
		).not.toThrow()
})

it('retains unserved and missing judgments in each complete horizon', () => {
	const manifest = buildStudyManifest()
	const rubric = buildStudyRubric()
	const grading = buildStudyGrading(manifest.schedule)
	expect(computeStudyScores(manifest, rubric, grading)).toEqual(
		['small', 'large'].map((arm) => ({
			arm,
			total: 8,
			achieved: 0,
			unsuccessful: 0,
			unknown: 8,
			critical: 0,
			lower: 0,
			upper: 1,
			coverage: 0,
		})),
	)
	const judged = {
		...grading,
		judgments: [
			buildStudyJudgment('r1-s1-a1'),
			buildStudyJudgment('r2-s1-a1', 'first-write', 'unsuccessful'),
			buildStudyJudgment('r1-s1-a1', 'first-read', 'unknown', 'human'),
		],
	}
	expect(computeStudyScores(manifest, rubric, judged)).toEqual([
		{
			arm: 'small',
			total: 8,
			achieved: 1,
			unsuccessful: 1,
			unknown: 6,
			critical: 1,
			lower: 0.125,
			upper: 0.875,
			coverage: 0.25,
		},
		{
			arm: 'large',
			total: 8,
			achieved: 0,
			unsuccessful: 0,
			unknown: 8,
			critical: 0,
			lower: 0,
			upper: 1,
			coverage: 0,
		},
	])
})

it('rejects incomplete schedules, mismatched attempts, foreign or duplicate judgments and methods', () => {
	const manifest = buildStudyManifest()
	const rubric = buildStudyRubric()
	const grading = buildStudyGrading(manifest.schedule)
	const judgment = buildStudyJudgment('r1-s1-a1')
	expect(() =>
		computeStudyScores({ ...manifest, schedule: manifest.schedule.slice(1) }, rubric, grading),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(
			{ ...manifest, schedule: [...manifest.schedule].reverse() },
			rubric,
			grading,
		),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(manifest, rubric, { ...grading, attempts: grading.attempts.slice(1) }),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(manifest, rubric, {
			...grading,
			attempts: [...grading.attempts.slice(1), 'foreign'],
		}),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(manifest, rubric, { ...grading, judgments: [judgment, judgment] }),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(manifest, rubric, {
			...grading,
			judgments: [buildStudyJudgment('foreign')],
		}),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(manifest, rubric, {
			...grading,
			judgments: [buildStudyJudgment('r1-s1-a1', 'second-write')],
		}),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(manifest, rubric, {
			...grading,
			judgments: [buildStudyJudgment('r1-s1-a1', 'first-write', 'achieved', 'human')],
		}),
	).toThrow(StudyError)
	expect(() =>
		computeStudyScores(manifest, rubric, {
			...grading,
			judgments: [buildStudyJudgment('r1-s1-a1', 'first-read', 'achieved', 'state')],
		}),
	).toThrow(StudyError)
})

it('projects each unknown stop reading to null and preserves distinct known readings', () => {
	expect(studyStopToJSON(buildStudyStop())).toEqual({
		layer: 'model',
		id: 'num_predict',
		max: 8,
		consumed: 9,
	})
	expect(studyStopToJSON(buildStudyStop({ max: undefined, consumed: undefined }))).toEqual({
		layer: 'model',
		id: 'num_predict',
		max: null,
		consumed: null,
	})
})
