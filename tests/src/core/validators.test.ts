import { expect, it } from 'vitest'
import {
	isStudyBounds,
	isStudyCriterion,
	isStudyDefinition,
	isStudyDigest,
	isStudyGoal,
	isStudyGrading,
	isStudyJudgment,
	isStudyLabels,
	isStudyLimit,
	isStudyName,
	isStudyProfile,
	isStudyProvider,
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
	expect(isStudyProfile({ ...profile, qualification: '' })).toBe(false)
	expect(isStudyProfile({ ...profile, provider })).toBe(true)
	expect(isStudyProfile({ ...profile, roots: [] })).toBe(false)
	expect(isStudyProfile({ ...profile, roots: ['dist', 'dist'] })).toBe(false)
	expect(isStudyProfile({ ...profile, roots: [' '] })).toBe(false)
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
	expect(isStudyUsage({ ...usage, role: 'foreign' })).toBe(false)
	expect(isStudyUsage({ ...usage, typo: true })).toBe(false)
	expect(isStudyLabels(labels)).toBe(true)
	expect(isStudyLabels({ ...labels, labeler: ' ' })).toBe(false)
	expect(isStudyLabels({ ...labels, packet: '' })).toBe(false)
	expect(isStudyLabels({ ...labels, judgments: [buildStudyJudgment('r1-s1-a1')] })).toBe(false)
	expect(isStudyLabels({ ...labels, judgments: [...labels.judgments, ...labels.judgments] })).toBe(
		false,
	)
	expect(isStudyLabels({ ...labels, usage: Array(1) })).toBe(false)
	expect(isStudyLabels({ ...labels, usage: Object.assign([usage], { typo: true }) })).toBe(false)
	expect(isStudyLabels({ ...labels, typo: true })).toBe(false)
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
	expect(isStudyLabels(hostile)).toBe(false)
	expect(isStudyGrading(hostile)).toBe(false)
	const cycle: Record<string, unknown> = {}
	cycle.self = cycle
	expect(isStudyGoal({ id: 'cycle', input: cycle })).toBe(false)
	expect(isStudyDefinition(null)).toBe(false)
})
