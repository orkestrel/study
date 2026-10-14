import type {
	StudyAttempt,
	StudyBounds,
	StudyCriterion,
	StudyDefinition,
	StudyGrading,
	StudyJudgment,
	StudyManifest,
	StudyProfile,
	StudyRubric,
	StudyScenario,
	StudyTrial,
} from '../src/core/types.js'
import type { StudyMeterFixture } from './src/core/engines/types.js'
import { StudyControl, StudyMeter, StudyScope } from '../src/core/engines/index.js'
import { buildStudySchedule } from '../src/core/helpers.js'

/** Supplies malformed command tokens that must refuse before custody or child work. */
export const STUDY_COMMAND_INVALID_ARGUMENTS: ReadonlyArray<readonly string[]> = Object.freeze([
	[],
	['unknown', 'tools'],
	['check'],
	['check', '../escape'],
	['check', 'tools', '--profile'],
	['check', 'tools', '--profile', 'local', '--profile', 'local'],
	['check', 'tools', '--unknown', 'local'],
	['check', 'tools', '--out', '/unused'],
	['execute', 'tools', '--out', '../escape'],
	['execute', 'tools', '--expected', 'invalid'],
	['grade', 'result'],
	['label', 'result', '--grading', 'a'.repeat(64)],
	['report', 'result', '--grading', 'invalid'],
])

/** Returns a declared two-arm, two-scenario, two-repetition population. */
export function buildStudyDefinition(change: Partial<StudyDefinition> = {}): StudyDefinition {
	return {
		name: 'study',
		version: '1',
		question: 'Does state survive?',
		purpose: 'quality',
		driver: 'memory',
		arms: ['small', 'large'],
		scenarios: ['first', 'second'],
		order: [
			['large', 'small'],
			['small', 'large'],
		],
		retries: 0,
		rubric: 'rubric.json',
		...change,
	}
}

/** Returns a two-goal scenario with public JSON inputs. */
export function buildStudyScenario(id = 'first'): StudyScenario {
	return {
		id,
		goals: [
			{ id: 'write', input: { text: 'remember' } },
			{ id: 'read', input: ['recall'] },
		],
	}
}

/** Returns a rubric covering both declared scenarios and goals. */
export function buildStudyRubric(): StudyRubric {
	return {
		version: '1',
		criteria: ['first', 'second'].flatMap((scenario): readonly StudyCriterion[] => [
			{
				id: `${scenario}-write`,
				scenario,
				goal: 'write',
				method: 'state',
				critical: true,
				assertion: { equals: 'remember' },
			},
			{
				id: `${scenario}-read`,
				scenario,
				goal: 'read',
				method: 'semantic',
				critical: false,
				assertion: { relevant: true },
			},
		]),
	}
}

/** Returns a profile whose request and output allowances fit the room. */
export function buildStudyProfile(): StudyProfile {
	const request = { duration: 100, calls: 1, tokens: 100, bytes: 100 }
	return {
		name: 'local',
		subject: 'subject-v1',
		roots: ['dist'],
		bounds: {
			request,
			goal: { ...request, calls: 2 },
			trial: { ...request, calls: 4 },
			series: { ...request, calls: 32 },
		},
		room: { context: 512, output: 32, safety: 16, recap: 32, think: false },
		provider: undefined,
		qualification: undefined,
	}
}

/** Returns a complete sealed declaration with its real schedule. */
export function buildStudyManifest(): StudyManifest {
	const definition = buildStudyDefinition()
	const scenarios = [buildStudyScenario(), buildStudyScenario('second')]
	const profile = buildStudyProfile()
	return {
		version: 1,
		id: 'a'.repeat(64),
		created: '2026-10-14T12:00:00.000Z',
		definition,
		scenarios,
		identity: {
			subject: 'a'.repeat(64),
			provider: undefined,
			instrument: 'b'.repeat(64),
			fixtures: 'c'.repeat(64),
			profile: 'd'.repeat(64),
		},
		schedule: buildStudySchedule(definition, scenarios),
		bounds: profile.bounds,
		qualification: undefined,
		host: {},
	}
}

/** Returns independently attributed grading over the supplied scheduled attempts. */
export function buildStudyGrading(
	schedule: readonly StudyTrial[],
	judgments: readonly StudyJudgment[] = [],
): StudyGrading {
	return {
		version: 1,
		result: 'a'.repeat(64),
		rubric: 'b'.repeat(64),
		grader: 'grader-v1',
		instrument: 'c'.repeat(64),
		attempts: schedule.map((trial) => trial.id),
		labels: undefined,
		judgments,
	}
}

/** Returns an evidence-backed judgment with an explicit verdict and method. */
export function buildStudyJudgment(
	trial: string,
	criterion = 'first-write',
	verdict: StudyJudgment['verdict'] = 'achieved',
	method: StudyJudgment['method'] = 'state',
): StudyJudgment {
	return {
		trial,
		criterion,
		verdict,
		method,
		reason: 'Recorded evidence',
		references: ['attempts/trace.ndjson#1'],
	}
}

/** Creates real scopes and request admission with one lifecycle owner.
 * @param bounds - Per-scope limit overrides.
 * @param signal - Optional parent cancellation.
 * @returns Owned control, scopes, and meter with cleanup.
 */
export function createStudyMeterFixture(
	bounds: Partial<StudyBounds> = {},
	signal?: AbortSignal,
): StudyMeterFixture {
	const limit = { duration: 1000, calls: 4, tokens: 100, bytes: 100 }
	const control = new StudyControl(signal)
	const scopes = [
		new StudyScope({ limit: bounds.goal ?? limit, control, label: 'Goal' }),
		new StudyScope({ limit: bounds.trial ?? limit, control, label: 'Trial' }),
		new StudyScope({ limit: bounds.series ?? limit, control, label: 'Series' }),
	]
	const meter = new StudyMeter({
		request: bounds.request ?? { ...limit, calls: 1 },
		scopes,
		control,
	})
	return Object.freeze({
		control,
		scopes: Object.freeze(scopes),
		meter,
		close(): void {
			meter.close()
			for (const scope of scopes) scope.close()
			control.close()
		},
	})
}

/**
 * Builds a fresh execution declaration with enough encoded custody room.
 * @param changes - The scenario-specific declaration changes
 * @returns The independently owned manifest
 */
export function buildCustodyManifest(changes: Partial<StudyManifest> = {}): StudyManifest {
	const manifest = buildStudyManifest()
	return {
		...manifest,
		bounds: {
			request: { duration: 1000, calls: 1, tokens: 1000, bytes: 1024 },
			goal: { duration: 2000, calls: 2, tokens: 2000, bytes: 4096 },
			trial: { duration: 4000, calls: 4, tokens: 4000, bytes: 8192 },
			series: { duration: 32000, calls: 32, tokens: 32000, bytes: 65536 },
		},
		...changes,
	}
}

/**
 * Builds a small complete custody horizon for lifecycle and tamper proofs.
 * @returns The declared scenarios with one arm and one repetition
 */
export function buildCompactCustodyManifest(): StudyManifest {
	const baseline = buildCustodyManifest()
	const definition: StudyDefinition = {
		...baseline.definition,
		arms: ['small'],
		order: [['small']],
	}
	return buildCustodyManifest({
		definition,
		schedule: buildStudySchedule(definition, baseline.scenarios),
	})
}

/**
 * Builds a complete terminal horizon from the supplied scheduled trial.
 * @param manifest - The authoritative goal horizon
 * @param trial - The scheduled trial
 * @returns The inert terminal record
 */
export function buildCustodyAttempt(manifest: StudyManifest, trial: StudyTrial): StudyAttempt {
	const scenario = manifest.scenarios.find((entry) => entry.id === trial.scenario)
	if (scenario === undefined) throw new Error('Fixture trial has no scenario')
	return {
		trial,
		observations: scenario.goals.map((goal) => ({
			goal: goal.id,
			product: { value: 'remember', partial: false },
			failure: undefined,
			usage: [],
			duration: 0,
		})),
		failure: undefined,
		duration: 0,
	}
}

/** Supplies hostile seal mutations that the offline reader must refuse. */
export const STUDY_CUSTODY_MUTATIONS = Object.freeze([
	'tampered',
	'missing',
	'extra',
	'extra-directory',
	'wrong-horizon',
	'partial-evidence',
])
