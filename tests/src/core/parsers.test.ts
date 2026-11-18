import { expect, it } from 'vitest'
import { studyJudgmentContract } from '../../../src/core/contracts.js'
import {
	parseStudyContract,
	parseStudyMeasurement,
	parseStudyDefinition,
	parseStudyAssessment,
	parseStudyLabelSheet,
	parseStudyProfile,
	parseStudyRubric,
	parseStudyScenario,
} from '../../../src/core/parsers.js'
import {
	isStudyDefinition,
	isStudyAssessment,
	isStudyLabelSheet,
	isStudyProfile,
	isStudyRubric,
	isStudyScenario,
} from '../../../src/core/validators.js'
import { StudyError } from '../../../src/core/errors.js'
import {
	buildStudyDefinition,
	buildStudyDaemonProvider,
	buildStudyDaemonRefusals,
	buildStudyAssessment,
	buildStudyJudgment,
	buildStudyManifest,
	buildStudyProfile,
	buildStudyRubric,
	buildStudyScenario,
	buildStudySettingsProfile,
	STUDY_FINITE_MEASUREMENTS,
	STUDY_PROFILE_INVALID_SETTINGS,
	STUDY_PROFILE_SETTINGS,
	STUDY_UNKNOWN_MEASUREMENTS,
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

it('owns the recording allowance and omits an explicit absent recording declaration', () => {
	const record = { bytes: 4096, calls: 256, duration: 15000 }
	const parsed = parseStudyProfile({ ...buildStudyProfile(), record })
	record.bytes = 8192
	expect(parsed.record).toEqual({ bytes: 4096, calls: 256, duration: 15000 })
	expect(Object.isFrozen(parsed.record)).toBe(true)
	expect(parseStudyProfile({ ...buildStudyProfile(), record: undefined })).not.toHaveProperty(
		'record',
	)
})

it('owns driver settings as a frozen JSON snapshot and leaves absent settings out of the profile', () => {
	const base = buildStudyProfile()
	const absent = {
		name: base.name,
		agent: base.agent,
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

it('keeps an undeclared judge off the owned profile and round-trips a declared one', () => {
	const base = buildStudyProfile()
	const provider = {
		entry: 'dist/index.js',
		url: 'http://127.0.0.1:11435',
		model: 'subject',
		judge: undefined,
		digest: { model: 'a'.repeat(64), judge: undefined },
	}
	const plain = parseStudyProfile({ ...base, provider })
	expect(isStudyProfile(plain)).toBe(true)
	expect(Object.hasOwn(plain.provider ?? {}, 'judge')).toBe(false)
	expect(Object.hasOwn(plain.provider?.digest ?? {}, 'judge')).toBe(false)
	expect(parseStudyProfile(JSON.parse(JSON.stringify(plain)))).toEqual(plain)
	const pinned = { model: 'a'.repeat(64), judge: 'b'.repeat(64) }
	const declared = parseStudyProfile({
		...base,
		provider: { ...provider, judge: 'judge', digest: pinned },
	})
	expect(declared.provider?.judge).toBe('judge')
	expect(declared.provider?.digest.judge).toBe('b'.repeat(64))
	expect(() => parseStudyProfile({ ...base, provider: { ...provider, judge: 'judge' } })).toThrow(
		expect.objectContaining({ code: 'CONFIG' }),
	)
	expect(() => parseStudyProfile({ ...base, agent: undefined })).toThrow(
		expect.objectContaining({ code: 'CONFIG' }),
	)
})

it('parses real JSON grading and labels without coercion and preserves unknown token usage', () => {
	const assessment = buildStudyAssessment(buildStudyManifest().schedule, [
		buildStudyJudgment('r1-s1-a1'),
	])
	const parsed = parseStudyAssessment(JSON.parse(JSON.stringify(assessment)))
	expect(isStudyAssessment(parsed)).toBe(true)
	expect(parsed.judgments).toEqual(assessment.judgments)
	expect(parseStudyAssessment({ ...assessment, labels: undefined, packet: undefined })).toEqual(
		parsed,
	)
	expect(Object.isFrozen(parsed.judgments[0]?.references)).toBe(true)
	const labels = {
		packet: 'a'.repeat(64),
		labeler: 'human',
		version: '1',
		created: '2026-10-14T12:00:00.000Z',
		usage: [{ role: 'judge', calls: 0, tokens: undefined, bytes: undefined, duration: 0 }],
		judgments: [buildStudyJudgment('r1-s1-a1', 'first-read', 'unknown', 'human')],
	}
	const parsedLabels = parseStudyLabelSheet(labels)
	expect(isStudyLabelSheet(parsedLabels)).toBe(true)
	expect(parsedLabels.usage[0]?.tokens).toBeUndefined()
	expect(parsedLabels.usage[0]?.bytes).toBeUndefined()
	expect(Object.isFrozen(parsedLabels.usage[0])).toBe(true)
	expect(parseStudyLabelSheet(JSON.parse(JSON.stringify(labels)))).toEqual(parsedLabels)
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
	expect(() => parseStudyAssessment({})).toThrow(expect.objectContaining({ code: 'EVIDENCE' }))
	expect(() => parseStudyLabelSheet({})).toThrow(expect.objectContaining({ code: 'EVIDENCE' }))
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

it('keeps finite foreign readings and leaves absent or non-finite readings unknown', () => {
	for (const value of STUDY_FINITE_MEASUREMENTS) expect(parseStudyMeasurement(value)).toBe(value)
	for (const value of STUDY_UNKNOWN_MEASUREMENTS)
		expect(parseStudyMeasurement(value)).toBeUndefined()
})

it('owns daemon declarations at profile load and rejects missing model digests and relative executables', () => {
	const provider = buildStudyDaemonProvider()
	const daemon = provider.daemon
	if (daemon === undefined) throw new Error('Missing daemon fixture')
	const parsed = parseStudyProfile({ ...buildStudyProfile(), provider })
	expect(parsed.provider?.daemon).toEqual(daemon)
	expect(parsed.provider?.daemon).not.toBe(daemon)
	expect(
		parseStudyProfile({
			...buildStudyProfile(),
			provider: {
				...provider,
				judge: provider.model,
				digest: { ...provider.digest, judge: provider.digest.model },
			},
		}).provider?.daemon?.models,
	).toHaveLength(1)
	for (const candidate of buildStudyDaemonRefusals(provider))
		expect(() => parseStudyProfile({ ...buildStudyProfile(), provider: candidate })).toThrow(
			/Invalid.*profile/,
		)
})

it('owns an unselected criterion list on a grading and leaves it out when absent', () => {
	const assessment = buildStudyAssessment(buildStudyManifest().schedule)
	expect(parseStudyAssessment(assessment)).not.toHaveProperty('unselected')
	const selected = parseStudyAssessment({ ...assessment, unselected: ['first-read'] })
	expect(selected.unselected).toEqual(['first-read'])
	expect(isStudyAssessment(selected)).toBe(true)
	expect(() => parseStudyAssessment({ ...assessment, unselected: [''] })).toThrow(StudyError)
})

it('owns a contract-valid value and refuses with the configured code, noun, and scan faults', () => {
	const judgment = buildStudyJudgment('r1-s1-a1')
	const contract = studyJudgmentContract
	const owned = parseStudyContract(judgment, {
		code: 'EVIDENCE',
		noun: 'study judgment',
		contract,
		scan: () => [],
	})
	expect(owned).toEqual(judgment)
	expect(owned).not.toBe(judgment)
	expect(() =>
		parseStudyContract(
			{ ...judgment, trial: 1 },
			{ code: 'EVIDENCE', noun: 'study judgment', contract, scan: () => [] },
		),
	).toThrow(
		expect.objectContaining({
			code: 'EVIDENCE',
			message: expect.stringMatching(/^Invalid study judgment: .*trial/),
		}),
	)
	expect(() =>
		parseStudyContract(judgment, {
			code: 'EVIDENCE',
			noun: 'study judgment',
			contract,
			scan: () => ['references.0: names no file'],
		}),
	).toThrow(
		expect.objectContaining({
			code: 'EVIDENCE',
			message: 'Invalid study judgment: references.0: names no file',
		}),
	)
	const unreadable = Object.defineProperty({ ...judgment }, 'reason', {
		enumerable: true,
		get: () => {
			throw new Error('Reason is unreadable')
		},
	})
	expect(() =>
		parseStudyContract(unreadable, {
			code: 'CONFIG',
			noun: 'study judgment',
			contract,
			scan: () => [],
		}),
	).toThrow(
		expect.objectContaining({
			code: 'CONFIG',
			message: expect.stringMatching(/^Invalid or unreadable study judgment/),
		}),
	)
})
