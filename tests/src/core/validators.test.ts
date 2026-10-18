import { expect, it } from 'vitest'
import { STUDY_CAUSES, STUDY_ROLES } from '../../../src/core/constants.js'
import {
	isStudyBounds,
	isStudyCause,
	isStudyCriterion,
	isStudyDefinition,
	isStudyDigest,
	isStudyErrorCode,
	isStudyGoal,
	isStudyGrading,
	isStudyJudgment,
	isStudyLabeling,
	isStudyLimit,
	isStudyName,
	isStudyProduct,
	isStudyProfile,
	isStudyProvider,
	isStudyRole,
	isStudyRoom,
	isStudyRubric,
	isStudyScenario,
	isStudyTimestamp,
	isStudyUsage,
} from '../../../src/core/validators.js'
import {
	buildStudyDefinition,
	buildStudyGrading,
	buildStudyJudgment,
	buildStudyManifest,
	buildStudyProfile,
	buildStudyRubric,
	buildStudyScenario,
	buildStudySettingsProfile,
	STUDY_PROFILE_INVALID_SETTINGS,
	STUDY_PROFILE_SETTINGS,
} from '../../setupStudy.js'

it('accepts only portable bounded names, digest identities and valid canonical timestamps', () => {
	expect(isStudyName('read-memory')).toBe(true)
	expect(isStudyName('')).toBe(false)
	expect(isStudyName('../read')).toBe(false)
	expect(isStudyName('a'.repeat(129))).toBe(false)
	expect(isStudyDigest('a'.repeat(64))).toBe(true)
	expect(isStudyDigest('A'.repeat(64))).toBe(false)
	expect(isStudyDigest('a'.repeat(63))).toBe(false)
	expect(isStudyTimestamp('2026-10-14T12:00:00.000Z')).toBe(true)
	expect(isStudyTimestamp('2026-02-30T12:00:00.000Z')).toBe(false)
	expect(isStudyTimestamp('invalid')).toBe(false)
})

it('rejects unsafe, fractional, nonfinite, negative, unordered and misspelled limits', () => {
	const profile = buildStudyProfile()
	const limit = profile.bounds.request
	expect(isStudyLimit(limit)).toBe(true)
	expect(isStudyBounds(profile.bounds)).toBe(true)
	expect(isStudyLimit({ ...limit, tokens: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)
	expect(isStudyLimit({ ...limit, duration: 2147483648 })).toBe(false)
	expect(isStudyLimit({ ...limit, duration: 2147483647 })).toBe(true)
	expect(isStudyLimit({ ...limit, duration: -0 })).toBe(false)
	expect(isStudyLimit({ ...limit, calls: 0 })).toBe(false)
	expect(isStudyLimit({ ...limit, bytes: -1 })).toBe(false)
	expect(isStudyLimit({ ...limit, tokens: 1.5 })).toBe(false)
	expect(isStudyLimit({ ...limit, tokens: Infinity })).toBe(false)
	expect(isStudyLimit({ ...limit, tokens: NaN })).toBe(false)
	expect(isStudyLimit({ ...limit, tokens: '100' })).toBe(false)
	expect(isStudyLimit({ ...limit, timeout: 100 })).toBe(false)
	expect(isStudyBounds({ ...profile.bounds, request: { ...limit, calls: 2 } })).toBe(false)
	expect(isStudyBounds({ ...profile.bounds, goal: { ...limit, tokens: 99 } })).toBe(false)
	expect(isStudyBounds({ ...profile.bounds, typo: true })).toBe(false)
})

it('requires dense bounded unique goals and exact configuration keys', () => {
	const scenario = buildStudyScenario()
	expect(isStudyScenario(scenario)).toBe(true)
	expect(isStudyGoal({ id: 'write', input: { n: 1 } })).toBe(true)
	expect(isStudyGoal({ id: 'write', input: NaN })).toBe(false)
	expect(isStudyGoal({ id: 'write', input: {}, oracle: true })).toBe(false)
	expect(isStudyScenario({ ...scenario, goals: [] })).toBe(false)
	expect(isStudyScenario({ ...scenario, goals: Array(1) })).toBe(false)
	expect(isStudyScenario({ ...scenario, goals: [scenario.goals[0], scenario.goals[0]] })).toBe(
		false,
	)
	expect(
		isStudyScenario({
			...scenario,
			goals: Array.from({ length: 4097 }, (_value, id) => ({ id: `goal-${id}`, input: {} })),
		}),
	).toBe(false)
	expect(isStudyScenario({ ...scenario, typo: true })).toBe(false)
})

it('requires exact explicit repetition permutations with a bounded product', () => {
	const definition = buildStudyDefinition()
	expect(isStudyDefinition(definition)).toBe(true)
	expect(isStudyDefinition({ ...definition, order: [] })).toBe(false)
	expect(isStudyDefinition({ ...definition, order: [['small', 'small']] })).toBe(false)
	expect(isStudyDefinition({ ...definition, order: [['small']] })).toBe(false)
	expect(isStudyDefinition({ ...definition, order: [['small', 'foreign']] })).toBe(false)
	expect(isStudyDefinition({ ...definition, order: Array(1) })).toBe(false)
	expect(isStudyDefinition({ ...definition, arms: Array(2) })).toBe(false)
	expect(isStudyDefinition({ ...definition, retries: 1 })).toBe(false)
	expect(
		isStudyDefinition({
			...definition,
			order: Array.from({ length: 1024 }, () => ['small', 'large']),
		}),
	).toBe(true)
	expect(
		isStudyDefinition({
			...definition,
			order: Array.from({ length: 1025 }, () => ['small', 'large']),
		}),
	).toBe(false)
	expect(isStudyDefinition({ ...definition, repetitions: 2 })).toBe(false)
})

it('requires positive room, finite bounds and credential-free HTTP origins', () => {
	const profile = buildStudyProfile()
	const provider = {
		entry: 'dist/index.js',
		url: 'http://127.0.0.1:11435',
		model: 'subject',
		judge: 'judge',
		digest: { model: 'a'.repeat(64), judge: 'b'.repeat(64) },
	}
	expect(isStudyProfile(profile)).toBe(true)
	expect(isStudyRoom(profile.room)).toBe(true)
	expect(isStudyProvider(provider)).toBe(true)
	expect(isStudyProvider({ ...provider, digest: undefined })).toBe(false)
	expect(isStudyProvider({ ...provider, digest: { model: 'a'.repeat(64) } })).toBe(false)
	expect(isStudyProvider({ ...provider, digest: { ...provider.digest, judge: 'mutable' } })).toBe(
		false,
	)
	expect(
		isStudyProvider({ ...provider, digest: { ...provider.digest, extra: 'c'.repeat(64) } }),
	).toBe(false)
	expect(isStudyProvider({ ...provider, url: 'http://user:secret@localhost' })).toBe(false)
	expect(isStudyProvider({ ...provider, url: 'file:///models' })).toBe(false)
	expect(isStudyProvider({ ...provider, url: 'http://localhost/model?key=value' })).toBe(false)
	expect(isStudyProvider({ ...provider, typo: true })).toBe(false)
	expect(isStudyRoom({ ...profile.room, output: 500 })).toBe(false)
	expect(isStudyRoom({ ...profile.room, recap: 500 })).toBe(false)
	expect(isStudyRoom({ ...profile.room, context: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)
	expect(isStudyRoom({ ...profile.room, output: 0 })).toBe(false)
	expect(isStudyRoom({ ...profile.room, typo: true })).toBe(false)
	expect(isStudyProfile({ ...profile, typo: true })).toBe(false)
	expect(isStudyProfile({ ...profile, agent: '' })).toBe(false)
	expect(isStudyProfile({ ...profile, agent: undefined })).toBe(false)
	expect(isStudyProfile({ ...profile, qualification: '' })).toBe(false)
	expect(isStudyProfile({ ...profile, provider })).toBe(true)
	expect(isStudyProfile({ ...profile, roots: [] })).toBe(false)
	expect(isStudyProfile({ ...profile, roots: ['dist', 'dist'] })).toBe(false)
	expect(isStudyProfile({ ...profile, roots: [' '] })).toBe(false)
})

it('admits a room without a recap and refuses an unbounded declared recap', () => {
	const profile = buildStudyProfile()
	const { recap, ...bare } = profile.room
	expect(recap).toBeDefined()
	expect(Object.hasOwn(bare, 'recap')).toBe(false)
	expect(isStudyRoom(bare)).toBe(true)
	expect(isStudyRoom({ ...bare, recap: undefined })).toBe(true)
	expect(isStudyProfile({ ...profile, room: bare })).toBe(true)
	expect(isStudyRoom({ ...bare, recap: 0 })).toBe(false)
	expect(isStudyRoom({ ...bare, recap: 1.5 })).toBe(false)
	expect(isStudyRoom({ ...bare, recap: Number.NaN })).toBe(false)
	expect(isStudyRoom({ ...bare, recap: '32' })).toBe(false)
	expect(isStudyRoom({ ...bare, recap: null })).toBe(false)
	expect(isStudyRoom({ ...bare, recap: bare.context })).toBe(false)
	expect(isStudyRoom({ ...bare, context: undefined })).toBe(false)
})

it('admits an omitted judge and refuses a half-declared judge in either direction', () => {
	const provider = {
		entry: 'dist/index.js',
		url: 'http://127.0.0.1:11435',
		model: 'subject',
		digest: { model: 'a'.repeat(64) },
	}
	const profile = buildStudyProfile()
	const pinned = { ...provider.digest, judge: 'b'.repeat(64) }
	expect(isStudyProvider(provider)).toBe(true)
	expect(isStudyProvider({ ...provider, judge: undefined })).toBe(true)
	expect(isStudyProfile({ ...profile, provider })).toBe(true)
	expect(isStudyProvider({ ...provider, judge: 'judge', digest: pinned })).toBe(true)
	expect(isStudyProvider({ ...provider, judge: 'judge' })).toBe(false)
	expect(isStudyProvider({ ...provider, digest: pinned })).toBe(false)
	expect(isStudyProvider({ ...provider, judge: '', digest: pinned })).toBe(false)
	expect(
		isStudyProvider({
			...provider,
			judge: 'judge',
			digest: { ...provider.digest, judge: 'mutable' },
		}),
	).toBe(false)
	expect(isStudyProfile({ ...profile, provider: { ...provider, judge: 'judge' } })).toBe(false)
})

it('admits absent or JSON-object driver settings and refuses every other shape', () => {
	const profile = buildStudyProfile()
	const omitted = { ...profile }
	Reflect.deleteProperty(omitted, 'settings')
	expect(Object.hasOwn(omitted, 'settings')).toBe(false)
	expect(isStudyProfile(omitted)).toBe(true)
	expect(isStudyProfile({ ...profile, settings: undefined })).toBe(true)
	for (const settings of STUDY_PROFILE_SETTINGS)
		expect(isStudyProfile(buildStudySettingsProfile(settings))).toBe(true)
	for (const settings of STUDY_PROFILE_INVALID_SETTINGS)
		expect(isStudyProfile({ ...profile, settings })).toBe(false)
	const cycle: Record<string, unknown> = {}
	cycle.self = cycle
	const hostile = Object.defineProperty({}, 'flag', {
		enumerable: true,
		get: () => {
			throw new Error('read')
		},
	})
	const foreign = new Proxy(
		{},
		{
			getPrototypeOf: () => {
				throw new Error('prototype')
			},
		},
	)
	expect(isStudyProfile({ ...profile, settings: cycle })).toBe(false)
	expect(isStudyProfile({ ...profile, settings: hostile })).toBe(false)
	expect(isStudyProfile({ ...profile, settings: foreign })).toBe(false)
	expect(isStudyProfile({ ...profile, setting: {} })).toBe(false)
	expect(isStudyProfile({ ...profile, settings: {}, typo: true })).toBe(false)
})

it('requires unique rubric criteria and attributable evidence-supported judgments', () => {
	const rubric = buildStudyRubric()
	const criterion = rubric.criteria[0]
	const judgment = buildStudyJudgment('r1-s1-a1')
	expect(isStudyRubric(rubric)).toBe(true)
	expect(isStudyCriterion(criterion)).toBe(true)
	expect(isStudyCriterion({ ...criterion, method: 'human' })).toBe(false)
	expect(isStudyRubric({ ...rubric, criteria: [...rubric.criteria, criterion] })).toBe(false)
	expect(isStudyRubric({ ...rubric, criteria: Array(1) })).toBe(false)
	expect(isStudyJudgment(judgment)).toBe(true)
	expect(isStudyJudgment({ ...judgment, references: [] })).toBe(false)
	expect(isStudyJudgment({ ...judgment, verdict: 'unknown', references: [] })).toBe(true)
	expect(isStudyJudgment({ ...judgment, references: [' '] })).toBe(false)
	expect(isStudyJudgment({ ...judgment, references: ['same', 'same'] })).toBe(false)
	expect(isStudyJudgment({ ...judgment, reason: ' ' })).toBe(false)
	expect(isStudyJudgment({ ...judgment, verdict: 'invalid' })).toBe(false)
	expect(isStudyJudgment({ ...judgment, typo: true })).toBe(false)
})

it('requires nonnegative known usage and honest semantic-label provenance', () => {
	const usage = { role: 'judge', calls: 0, bytes: 0, duration: 0, tokens: undefined }
	const labels = {
		packet: 'a'.repeat(64),
		labeler: 'reviewer',
		version: '1',
		created: '2026-10-14T12:00:00.000Z',
		usage: [usage],
		judgments: [buildStudyJudgment('r1-s1-a1', 'first-read', 'achieved', 'human')],
	}
	expect(isStudyUsage(usage)).toBe(true)
	expect(isStudyUsage({ ...usage, tokens: 0 })).toBe(true)
	expect(isStudyUsage({ ...usage, tokens: -1 })).toBe(false)
	expect(isStudyUsage({ ...usage, bytes: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)
	expect(isStudyUsage({ ...usage, duration: 0.5 })).toBe(false)
	expect(isStudyUsage({ ...usage, calls: -0, duration: -0, tokens: -0, bytes: -0 })).toBe(true)
	expect(isStudyUsage({ ...usage, role: 'foreign' })).toBe(false)
	expect(isStudyUsage({ ...usage, typo: true })).toBe(false)
	expect(isStudyLabeling(labels)).toBe(true)
	expect(isStudyLabeling({ ...labels, labeler: ' ' })).toBe(false)
	expect(isStudyLabeling({ ...labels, packet: '' })).toBe(false)
	expect(isStudyLabeling({ ...labels, judgments: [buildStudyJudgment('r1-s1-a1')] })).toBe(false)
	expect(
		isStudyLabeling({ ...labels, judgments: [...labels.judgments, ...labels.judgments] }),
	).toBe(false)
	expect(isStudyLabeling({ ...labels, usage: Array(1) })).toBe(false)
	expect(isStudyLabeling({ ...labels, usage: Object.assign([usage], { typo: true }) })).toBe(false)
	expect(isStudyLabeling({ ...labels, typo: true })).toBe(false)
})

it('accepts JSON products with partial status and refuses non-JSON or hostile output', () => {
	expect(isStudyProduct({ value: { answer: 1 }, partial: true })).toBe(true)
	expect(isStudyProduct({ value: null, partial: false })).toBe(true)
	expect(isStudyProduct({ value: 'retained', partial: false, extra: true })).toBe(true)
	expect(isStudyProduct({ value: undefined, partial: false })).toBe(false)
	expect(isStudyProduct({ value: 'retained' })).toBe(false)
	expect(isStudyProduct({ value: 'retained', partial: 'false' })).toBe(false)
	expect(isStudyProduct({ value: NaN, partial: false })).toBe(false)
	expect(isStudyProduct([])).toBe(false)
	expect(isStudyProduct(null)).toBe(false)
	const cycle: Record<string, unknown> = {}
	cycle.self = cycle
	expect(isStudyProduct({ value: cycle, partial: false })).toBe(false)
	const hostile = new Proxy(
		{ partial: false },
		{
			get() {
				throw new Error('Hostile property read')
			},
		},
	)
	expect(isStudyProduct(hostile)).toBe(false)
	const revoked = Proxy.revocable({}, {})
	revoked.revoke()
	expect(isStudyProduct(revoked.proxy)).toBe(false)
})

it('accepts exactly the declared roles and operational causes in their frozen report order', () => {
	expect(STUDY_ROLES).toEqual(['agent', 'judge', 'summary', 'metadata', 'tool'])
	expect(STUDY_CAUSES).toEqual(['capacity', 'infrastructure', 'deadline', 'interrupted', 'content'])
	expect(Object.isFrozen(STUDY_ROLES) && Object.isFrozen(STUDY_CAUSES)).toBe(true)
	for (const role of ['agent', 'judge', 'summary', 'metadata', 'tool'])
		expect(isStudyRole(role)).toBe(true)
	for (const cause of ['capacity', 'infrastructure', 'deadline', 'interrupted', 'content'])
		expect(isStudyCause(cause)).toBe(true)
	for (const value of ['Agent', 'success', '', undefined, null, 0, ['tool'], { role: 'tool' }]) {
		expect(isStudyRole(value)).toBe(false)
		expect(isStudyCause(value)).toBe(false)
	}
	expect(isStudyRole('capacity')).toBe(false)
	expect(isStudyCause('tool')).toBe(false)
	expect(isStudyCause('Content')).toBe(false)
	expect(isStudyCause('decoder')).toBe(false)
})

it('carries no format counter in a grading identity', () => {
	const grading = buildStudyGrading([])
	expect(isStudyGrading(grading)).toBe(true)
	expect(Object.hasOwn(grading, 'version')).toBe(false)
	expect(isStudyGrading({ ...grading, version: 1 })).toBe(false)
})

it('accepts only declared error codes, never a foreign or case-folded code', () => {
	for (const code of ['CONFIG', 'EVIDENCE', 'CUSTODY', 'CAPACITY', 'FAULT', 'DEADLINE'])
		expect(isStudyErrorCode(code)).toBe(true)
	expect(isStudyErrorCode('ARTIFACT')).toBe(false)
	expect(isStudyErrorCode('ENOENT')).toBe(false)
	expect(isStudyErrorCode('config')).toBe(false)
	expect(isStudyErrorCode('')).toBe(false)
	expect(isStudyErrorCode(undefined)).toBe(false)
	expect(isStudyErrorCode({ code: 'CONFIG' })).toBe(false)
})

it('requires SHA bindings, unique attempts and exact grading keys', () => {
	const grading = buildStudyGrading(buildStudyManifest().schedule, [buildStudyJudgment('r1-s1-a1')])
	expect(isStudyGrading(grading)).toBe(true)
	expect(isStudyGrading({ ...grading, result: 'result-name' })).toBe(false)
	expect(isStudyGrading({ ...grading, labels: 'labels-name' })).toBe(false)
	expect(isStudyGrading({ ...grading, attempts: [...grading.attempts, ...grading.attempts] })).toBe(
		false,
	)
	expect(
		isStudyGrading({ ...grading, judgments: [...grading.judgments, ...grading.judgments] }),
	).toBe(false)
	expect(isStudyGrading({ ...grading, typo: true })).toBe(false)
})

it('contains hostile property reads and cyclic unknown data in total guards', () => {
	const hostile = new Proxy(
		{},
		{
			getPrototypeOf: () => {
				throw new Error('prototype')
			},
		},
	)
	expect(isStudyProfile(hostile)).toBe(false)
	expect(isStudyRubric(hostile)).toBe(false)
	expect(isStudyLabeling(hostile)).toBe(false)
	expect(isStudyGrading(hostile)).toBe(false)
	const cycle: Record<string, unknown> = {}
	cycle.self = cycle
	expect(isStudyGoal({ id: 'cycle', input: cycle })).toBe(false)
	expect(isStudyDefinition(null)).toBe(false)
})
