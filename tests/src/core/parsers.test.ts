import { expect, it } from 'vitest'
import {
	parseStudyDefinition,
	parseStudyGrading,
	parseStudyLabels,
	parseStudyProfile,
	parseStudyRubric,
	parseStudyScenario,
} from '../../../src/core/parsers.js'
import {
	isStudyDefinition,
	isStudyGrading,
	isStudyLabels,
	isStudyProfile,
	isStudyRubric,
	isStudyScenario,
} from '../../../src/core/validators.js'
import { StudyError } from '../../../src/core/errors.js'
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

it('owns frozen declaration snapshots that satisfy each paired guard', () => {
	const definition = buildStudyDefinition()
	const scenario = buildStudyScenario()
	const profile = buildStudyProfile()
	const rubric = buildStudyRubric()
	const parsedDefinition = parseStudyDefinition(definition)
	const parsedScenario = parseStudyScenario(scenario)
	const parsedProfile = parseStudyProfile(profile)
	const parsedRubric = parseStudyRubric(rubric)
	expect(isStudyDefinition(parsedDefinition)).toBe(true)
	expect(isStudyScenario(parsedScenario)).toBe(true)
	expect(isStudyProfile(parsedProfile)).toBe(true)
	expect(isStudyRubric(parsedRubric)).toBe(true)
	expect(parsedDefinition).not.toBe(definition)
	expect(parsedDefinition.order).not.toBe(definition.order)
	expect(parsedScenario.goals).not.toBe(scenario.goals)
	expect(parsedProfile.bounds).not.toBe(profile.bounds)
	expect(parsedProfile.provider).toBeUndefined()
	expect(parsedRubric.criteria).not.toBe(rubric.criteria)
	expect(Object.isFrozen(parsedDefinition.order[0])).toBe(true)
	expect(Object.isFrozen(parsedScenario.goals[0]?.input)).toBe(true)
	expect(Object.isFrozen(parsedProfile.bounds.request)).toBe(true)
	expect(Object.isFrozen(parsedRubric.criteria[0]?.assertion)).toBe(true)
	const mutable = { id: 'mutable', goals: [{ id: 'write', input: { text: 'before' } }] }
	const owned = parseStudyScenario(mutable)
	const goal = mutable.goals[0]
	if (goal !== undefined) goal.input.text = 'after'
	expect(owned.goals[0]?.input).toEqual({ text: 'before' })
})

it('owns driver settings as a frozen JSON snapshot and leaves absent settings out of the profile', () => {
	const base = buildStudyProfile()
	const absent = {
		name: base.name,
		subject: base.subject,
		roots: base.roots,
		bounds: base.bounds,
		room: base.room,
	}
	for (const parsed of [parseStudyProfile(base), parseStudyProfile(absent)]) {
		expect(Object.hasOwn(parsed, 'settings')).toBe(false)
		expect(JSON.stringify(parsed)).toBe(JSON.stringify(absent))
	}
	for (const settings of STUDY_PROFILE_SETTINGS) {
		const profile = buildStudySettingsProfile(settings)
		const parsed = parseStudyProfile(profile)
		expect(isStudyProfile(parsed)).toBe(true)
		expect(parsed.settings).toEqual(settings)
		expect(parsed.settings).not.toBe(settings)
		expect(Object.isFrozen(parsed.settings)).toBe(true)
		expect(parseStudyProfile(JSON.parse(JSON.stringify(profile)))).toEqual(parsed)
	}
	const mutable = { gauge: { steps: [1, 2], label: 'before' } }
	const owned = parseStudyProfile({ ...base, settings: mutable })
	mutable.gauge.steps.push(3)
	mutable.gauge.label = 'after'
	expect(owned.settings).toEqual({ gauge: { steps: [1, 2], label: 'before' } })
	expect(Object.isFrozen(owned.settings?.gauge)).toBe(true)
	for (const settings of STUDY_PROFILE_INVALID_SETTINGS)
		expect(() => parseStudyProfile({ ...base, settings })).toThrow(
			expect.objectContaining({ code: 'CONFIG' }),
		)
	const cycle: Record<string, unknown> = {}
	cycle.self = cycle
	expect(() => parseStudyProfile({ ...base, settings: cycle })).toThrow(StudyError)
})

it('parses real JSON grading and labels without coercion and preserves unknown token usage', () => {
	const grading = buildStudyGrading(buildStudyManifest().schedule, [buildStudyJudgment('r1-s1-a1')])
	const parsed = parseStudyGrading(JSON.parse(JSON.stringify(grading)))
	expect(isStudyGrading(parsed)).toBe(true)
	expect(parsed.judgments).toEqual(grading.judgments)
	expect(parseStudyGrading({ ...grading, labels: undefined, packet: undefined })).toEqual(parsed)
	expect(Object.isFrozen(parsed.judgments[0]?.references)).toBe(true)
	const labels = {
		packet: 'a'.repeat(64),
		labeler: 'human',
		version: '1',
		created: '2026-10-14T12:00:00.000Z',
		usage: [{ role: 'judge', calls: 0, tokens: undefined, bytes: undefined, duration: 0 }],
		judgments: [buildStudyJudgment('r1-s1-a1', 'first-read', 'unknown', 'human')],
	}
	const parsedLabels = parseStudyLabels(labels)
	expect(isStudyLabels(parsedLabels)).toBe(true)
	expect(parsedLabels.usage[0]?.tokens).toBeUndefined()
	expect(parsedLabels.usage[0]?.bytes).toBeUndefined()
	expect(Object.isFrozen(parsedLabels.usage[0])).toBe(true)
	expect(parseStudyLabels(JSON.parse(JSON.stringify(labels)))).toEqual(parsedLabels)
})

it('rejects unknown keys, unsafe limits, malformed JSON shapes and hostile reads with coded errors', () => {
	expect(() => parseStudyDefinition({ ...buildStudyDefinition(), repetition: 2 })).toThrow(
		expect.objectContaining({ code: 'CONFIG' }),
	)
	expect(() => parseStudyScenario({ ...buildStudyScenario(), truth: {} })).toThrow(
		expect.objectContaining({ code: 'CONFIG' }),
	)
	expect(() =>
		parseStudyProfile({
			...buildStudyProfile(),
			room: { ...buildStudyProfile().room, output: '32' },
		}),
	).toThrow(StudyError)
	expect(() => parseStudyRubric({ ...buildStudyRubric(), criteria: [] })).toThrow(StudyError)
	expect(() => parseStudyGrading({})).toThrow(expect.objectContaining({ code: 'EVIDENCE' }))
	expect(() => parseStudyLabels({})).toThrow(expect.objectContaining({ code: 'EVIDENCE' }))
	expect(() =>
		parseStudyScenario(
			new Proxy(
				{},
				{
					ownKeys: () => {
						throw new Error('keys')
					},
				},
			),
		),
	).toThrow(StudyError)
	expect(() => parseStudyScenario('not parsed JSON')).toThrow(StudyError)
})
