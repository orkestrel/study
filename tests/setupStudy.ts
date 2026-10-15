import type { JSONValue } from '@orkestrel/contract'
import type {
	StudyAttempt,
	StudyBounds,
	StudyCriterion,
	StudyDefinition,
	StudyGrading,
	StudyDriverInterface,
	StudyJudgment,
	StudyManifest,
	StudyProduct,
	StudyProfile,
	StudyRubric,
	StudyScenario,
	StudySessionInterface,
	StudySinkInterface,
	StudyStoreInterface,
	StudyTrial,
} from '../src/core/types.js'
import type {
	StudyAdmissionCase,
	StudyDriverFixture,
	StudyDriverFixtureOptions,
	StudyErrorCopy,
	StudyMeterFixture,
	StudyStoreFixture,
} from './src/core/engines/types.js'
import { createRecorder } from '@orkestrel/test'
import { vi } from 'vitest'
import { StudyControl, StudyMeter, StudyScope } from '../src/core/engines/index.js'
import { buildStudySchedule } from '../src/core/helpers.js'

/** Evaluates a distinct copy of the real study error module, tagged the way captured loading tags an import.
 * @param label - The copy's tag; equal labels share one evaluation.
 * @returns The copy's own class, construction and guard.
 */
export async function importStudyErrorCopy(label: string): Promise<StudyErrorCopy> {
	// Vitest's runner keys a module by its full id, query included, so each tag evaluates the
	// real source once more without replacing anything.
	const copy: unknown = await vi.importActual(
		`../src/core/errors.js?artifact=${encodeURIComponent(label)}`,
	)
	if (
		typeof copy !== 'object' ||
		copy === null ||
		!('StudyError' in copy) ||
		!('isStudyError' in copy) ||
		typeof copy.StudyError !== 'function' ||
		typeof copy.isStudyError !== 'function'
	)
		throw new Error('Study error copy exports no class and guard')
	const error = copy.StudyError
	const guard = copy.isStudyError
	return {
		error,
		create: (...values) => Reflect.construct(error, values),
		recognize: (value) => Reflect.apply(guard, undefined, [value]) === true,
	}
}

/** Supplies the output admission matrix:a fast oversized control, an expired oversized product, and an expired within-budget partial control. */
export const STUDY_ADMISSION_CASES: readonly StudyAdmissionCase[] = Object.freeze([
	{
		name: 'fast oversized',
		expired: false,
		oversized: true,
		cause: 'capacity',
		product: undefined,
	},
	{
		name: 'expired oversized',
		expired: true,
		oversized: true,
		cause: 'deadline',
		product: undefined,
	},
	{
		name: 'expired within budget',
		expired: true,
		oversized: false,
		cause: 'deadline',
		product: { value: 'ok', partial: true },
	},
])

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
		settings: undefined,
	}
}

/** Supplies driver settings that Study must own and bind without interpreting. */
export const STUDY_PROFILE_SETTINGS: ReadonlyArray<Readonly<Record<string, JSONValue>>> =
	Object.freeze([
		{},
		{ flag: true },
		{ gauge: { scale: 1.25, steps: [1, 2, { deep: null }], label: 'calibrated' } },
	])

/** Supplies settings values that the profile guard and parser must refuse. */
export const STUDY_PROFILE_INVALID_SETTINGS: readonly unknown[] = Object.freeze([
	[],
	['flag'],
	'flag',
	1,
	true,
	null,
	{ flag: undefined },
	{ flag: Number.NaN },
	{ flag: () => true },
	{ flag: new Date(0) },
	{ flag: 1n },
])

/** Returns a profile carrying the supplied driver settings. */
export function buildStudySettingsProfile(
	settings: Readonly<Record<string, JSONValue>>,
): StudyProfile {
	return { ...buildStudyProfile(), settings }
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

/** Creates a consumer-side driver whose sessions are fresh per open and whose calls are recorded.
 * @param options - Optional goal execution and a promise that delays each open result.
 * @returns The driver with open, execute, and close observations.
 */
export function createStudyDriverFixture(
	options: StudyDriverFixtureOptions = {},
): StudyDriverFixture {
	const opened = createRecorder<readonly [StudyTrial]>()
	const executed = createRecorder<readonly [string]>()
	const closed = createRecorder<readonly [string]>()
	const driver: StudyDriverInterface = {
		async open(trial): Promise<StudySessionInterface> {
			opened.handler(trial)
			if (options.opening !== undefined) await options.opening
			return {
				async execute(goal, context): Promise<StudyProduct> {
					executed.handler(goal.id)
					return options.execute === undefined
						? { value: goal.id, partial: false }
						: options.execute(goal, context)
				},
				async close(): Promise<void> {
					closed.handler(trial.id)
				},
			}
		},
	}
	return Object.freeze({ driver, opened, executed, closed })
}

/** Creates an in-memory custody consumer that records starts and terminal attempts.
 * @returns The store with start and finish observations.
 */
export function createStudyStoreFixture(): StudyStoreFixture {
	const started = createRecorder<readonly [StudyTrial]>()
	const attempts = createRecorder<readonly [StudyAttempt]>()
	const store: StudyStoreInterface = {
		async start(trial): Promise<StudySinkInterface> {
			started.handler(trial)
			return { async append(): Promise<void> {} }
		},
		async finish(attempt): Promise<void> {
			attempts.handler(attempt)
		},
	}
	return Object.freeze({ store, started, attempts })
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
 * Builds the compact custody horizon with explicit output byte allowances per tier.
 * @param bytes - The request, goal, trial, and series byte allowances
 * @returns The independently owned manifest whose other tier limits stay unchanged
 */
export function buildStudyCapacityManifest(
	bytes: Readonly<Record<keyof StudyBounds, number>>,
): StudyManifest {
	const manifest = buildCompactCustodyManifest()
	return {
		...manifest,
		bounds: {
			request: { ...manifest.bounds.request, bytes: bytes.request },
			goal: { ...manifest.bounds.goal, bytes: bytes.goal },
			trial: { ...manifest.bounds.trial, bytes: bytes.trial },
			series: { ...manifest.bounds.series, bytes: bytes.series },
		},
	}
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
