import type { JSONValue } from '@orkestrel/contract'
import type {
	StudyAttempt,
	StudyBounds,
	StudyCriterion,
	StudyDefinition,
	StudyGrading,
	StudyDriverInterface,
	StudyFailure,
	StudyJudgment,
	StudyManifest,
	StudyObservation,
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
import type { StudyExecutionCase } from './src/server/stores/types.js'
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
		agent: 'agent-v1',
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
		id: 'a'.repeat(64),
		created: '2026-10-14T12:00:00.000Z',
		definition,
		scenarios,
		identity: {
			agent: '1'.repeat(64),
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
		result: 'a'.repeat(64),
		rubric: 'b'.repeat(64),
		grader: 'grader',
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
 * @param options - Optional goal execution, a promise that delays each open result, and an error that rejects each open.
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
			if (options.refuse !== undefined) throw options.refuse
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
		observations: scenario.goals.map((goal) => buildStudyObservation(goal.id, true)),
		failure: undefined,
		duration: 0,
		executed: true,
	}
}

/**
 * Builds an attributable operational failure.
 * @param cause - The operational ending; Default: capacity
 * @param message - The retained message; Default: Full
 * @returns The inert failure
 */
export function buildStudyFailure(
	cause: StudyFailure['cause'] = 'capacity',
	message = 'Full',
): StudyFailure {
	return { cause, message, role: undefined }
}

/**
 * Builds a retained goal outcome that carries an explicit execution fact.
 * @param goal - The declared goal identity
 * @param executed - True for a dispatched goal, false for a goal never dispatched
 * @param change - The fields that differ from the default outcome
 * @returns A complete product for a dispatched goal; a failure without product, usage or duration for an undispatched goal
 */
export function buildStudyObservation(
	goal: string,
	executed: boolean,
	change: Partial<StudyObservation> = {},
): StudyObservation {
	return {
		goal,
		product: executed === false ? undefined : { value: 'remember', partial: false },
		failure:
			executed === false ? buildStudyFailure('interrupted', 'Goal unexecuted: Stopped') : undefined,
		usage: [],
		duration: 0,
		executed,
		...change,
	}
}

/**
 * Builds a terminal record over a scheduled trial from explicit goal outcomes.
 * @param trial - The scheduled trial
 * @param executed - The trial's execution fact
 * @param observations - The ordered goal outcomes
 * @param failure - The terminal operational failure; Default: none
 * @returns The inert terminal record
 */
export function buildStudyAttempt(
	trial: StudyTrial,
	executed: boolean,
	observations: readonly StudyObservation[],
	failure?: StudyFailure,
): StudyAttempt {
	return { trial, observations, failure, duration: 0, executed }
}

/**
 * Builds one terminal record per scheduled trial covering every operational partition.
 * @param manifest - The two-goal declaration to fill
 * @returns Completed, attempted-failure, partial-product, open-fault, inherited-cascade and between-goal-failure trials, then completed trials for the rest of the schedule
 */
export function buildStudyOperationAttempts(manifest: StudyManifest): readonly StudyAttempt[] {
	const capacity = buildStudyFailure('capacity', 'Full')
	return manifest.schedule.map((trial, index) => {
		switch (index) {
			case 1:
				return buildStudyAttempt(
					trial,
					true,
					[
						buildStudyObservation('write', true, { product: undefined, failure: capacity }),
						buildStudyObservation('read', false, {
							failure: buildStudyFailure('capacity', 'Goal unexecuted: Full'),
						}),
					],
					capacity,
				)
			case 2:
				return buildStudyAttempt(trial, true, [
					buildStudyObservation('write', true, { product: { value: 'half', partial: true } }),
					buildStudyObservation('read', true),
				])
			case 3:
				// An open failure is infrastructure, so its unexecuted goals carry that cause.
				return buildStudyAttempt(
					trial,
					true,
					['write', 'read'].map((goal) =>
						buildStudyObservation(goal, false, {
							failure: buildStudyFailure('infrastructure', 'Goal unexecuted: Open failed'),
						}),
					),
					buildStudyFailure('infrastructure', 'Open failed'),
				)
			case 4:
				return buildStudyAttempt(
					trial,
					false,
					[buildStudyObservation('write', false), buildStudyObservation('read', false)],
					buildStudyFailure('interrupted', 'Stopped'),
				)
			case 5:
				return buildStudyAttempt(
					trial,
					true,
					[
						buildStudyObservation('write', true),
						buildStudyObservation('read', false, {
							failure: buildStudyFailure('deadline', 'Goal unexecuted: Late'),
						}),
					],
					buildStudyFailure('deadline', 'Late'),
				)
			default:
				return buildStudyAttempt(trial, true, [
					buildStudyObservation('write', true),
					buildStudyObservation('read', true),
				])
		}
	})
}

/** Supplies the terminal record shapes custody must accept or refuse. */
export const STUDY_EXECUTION_CASES: readonly StudyExecutionCase[] = Object.freeze([
	{
		name: 'accepts an executed trial whose goals all executed',
		valid: true,
		attempt: {},
	},
	{
		name: 'accepts executed goals with zero duration and empty usage',
		valid: true,
		attempt: {
			observations: [
				buildStudyObservation('write', true, { duration: 0, usage: [] }),
				buildStudyObservation('read', true, { duration: 0, usage: [] }),
			],
		},
	},
	{
		name: 'accepts an attempted goal without a product as executed',
		valid: true,
		attempt: {
			failure: buildStudyFailure(),
			observations: [
				buildStudyObservation('write', true, { product: undefined, failure: buildStudyFailure() }),
				buildStudyObservation('read', false),
			],
		},
	},
	{
		name: 'accepts an executed trial that never dispatched a goal',
		valid: true,
		attempt: {
			failure: buildStudyFailure('infrastructure', 'Open failed'),
			observations: [buildStudyObservation('write', false), buildStudyObservation('read', false)],
		},
	},
	{
		name: 'accepts an unexecuted trial that inherited a series failure',
		valid: true,
		attempt: {
			executed: false,
			failure: buildStudyFailure(),
			observations: [buildStudyObservation('write', false), buildStudyObservation('read', false)],
		},
	},
	{
		name: 'accepts a trial close failure after every goal executed cleanly',
		valid: true,
		attempt: { failure: buildStudyFailure('infrastructure', 'Close failed') },
	},
	{
		name: 'accepts a between-goal failure after a goal finished without one',
		valid: true,
		attempt: {
			failure: buildStudyFailure('deadline', 'Late'),
			observations: [buildStudyObservation('write', true), buildStudyObservation('read', false)],
		},
	},
	{
		name: 'accepts an executed goal with a product and a failure that ends the prefix',
		valid: true,
		attempt: {
			failure: buildStudyFailure(),
			observations: [
				buildStudyObservation('write', true, { failure: buildStudyFailure() }),
				buildStudyObservation('read', false),
			],
		},
	},
	{
		name: 'refuses an undefined trial fact',
		valid: false,
		attempt: { executed: undefined },
	},
	{
		name: 'refuses a goal that omits its fact',
		valid: false,
		attempt: {
			observations: [
				buildStudyObservation('write', true),
				{ goal: 'read', product: undefined, failure: buildStudyFailure(), usage: [], duration: 0 },
			],
		},
	},
	{
		name: 'refuses an unexecuted goal that holds a product',
		valid: false,
		attempt: {
			failure: buildStudyFailure(),
			observations: [
				buildStudyObservation('write', true, { failure: buildStudyFailure() }),
				buildStudyObservation('read', false, { product: { value: 'late', partial: false } }),
			],
		},
	},
	{
		name: 'refuses an unexecuted goal that holds usage',
		valid: false,
		attempt: {
			failure: buildStudyFailure(),
			observations: [
				buildStudyObservation('write', true, { failure: buildStudyFailure() }),
				buildStudyObservation('read', false, {
					usage: [{ role: 'agent', calls: 1, tokens: 1, bytes: 1, duration: 1 }],
				}),
			],
		},
	},
	{
		name: 'refuses an unexecuted goal that holds duration',
		valid: false,
		attempt: {
			failure: buildStudyFailure(),
			observations: [
				buildStudyObservation('write', true, { failure: buildStudyFailure() }),
				buildStudyObservation('read', false, { duration: 1 }),
			],
		},
	},
	{
		name: 'refuses an unexecuted goal without a failure',
		valid: false,
		attempt: {
			failure: buildStudyFailure(),
			observations: [
				buildStudyObservation('write', true, { failure: buildStudyFailure() }),
				buildStudyObservation('read', false, { failure: undefined }),
			],
		},
	},
	{
		name: 'refuses an unexecuted goal before an executed goal',
		valid: false,
		attempt: {
			failure: buildStudyFailure(),
			observations: [buildStudyObservation('write', false), buildStudyObservation('read', true)],
		},
	},
	{
		name: 'refuses an executed goal after a goal that failed',
		valid: false,
		attempt: {
			failure: buildStudyFailure(),
			observations: [
				buildStudyObservation('write', true, { product: undefined, failure: buildStudyFailure() }),
				buildStudyObservation('read', true),
			],
		},
	},
	{
		name: 'refuses an unexecuted trial that holds an executed goal',
		valid: false,
		attempt: {
			executed: false,
			failure: buildStudyFailure(),
			observations: [buildStudyObservation('write', true), buildStudyObservation('read', false)],
		},
	},
	{
		name: 'refuses an unexecuted trial without a failure',
		valid: false,
		attempt: {
			executed: false,
			observations: [buildStudyObservation('write', false), buildStudyObservation('read', false)],
		},
	},
	{
		name: 'refuses an attempt without a failure that holds a failed goal',
		valid: false,
		attempt: {
			failure: undefined,
			observations: [
				buildStudyObservation('write', true, { failure: buildStudyFailure() }),
				buildStudyObservation('read', false),
			],
		},
	},
	{
		name: 'refuses an attempt without a failure that holds an unexecuted goal',
		valid: false,
		attempt: {
			failure: undefined,
			observations: [buildStudyObservation('write', true), buildStudyObservation('read', false)],
		},
	},
	{
		name: 'refuses a non-boolean trial fact',
		valid: false,
		attempt: { executed: 'yes' },
	},
	{
		name: 'refuses a null goal fact',
		valid: false,
		attempt: {
			observations: [
				buildStudyObservation('write', true),
				{ ...buildStudyObservation('read', true), executed: null },
			],
		},
	},
])

/** Supplies hostile seal mutations that the offline reader must refuse. */
export const STUDY_CUSTODY_MUTATIONS = Object.freeze([
	'tampered',
	'missing',
	'extra',
	'extra-directory',
	'wrong-horizon',
	'partial-evidence',
])
