import type { JSONValue } from '@orkestrel/contract'
import type {
	StudyAttempt,
	StudyProvider,
	StudyBounds,
	StudyCriterion,
	StudyDefinition,
	StudyGrading,
	StudyDriverInterface,
	StudyEvidence,
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
	StudyLeaseFixture,
	StudyMeterFixture,
	StudyStoreFixture,
} from './src/core/engines/types.js'
import type { StudyExecutionCase } from './src/server/stores/types.js'
import type {
	JudgeInterface,
	JudgeRequest,
	LedgerGauge,
	Message,
	ProviderDelta,
	ProviderRequest,
	ProviderResult,
	ProviderStreamOptions,
	ThinkingReplay,
} from '@orkestrel/agent'
import type {
	AgentObserverFixture,
	AgentRefusalFixture,
	OllamaFetchFixture,
	OllamaReplyFixture,
	OllamaRequestFixture,
	OllamaRowFixture,
	ProviderStreamFixture,
	StudyLatchFixture,
} from './src/core/agents/types.js'
import type {
	StudyAgentSummaryFixture,
	StudyAgentSummaryFixtureOptions,
	StudyAgentTraceFixture,
	StudySinkFixture,
	StudyScriptFixture,
	StudySinkFixtureOptions,
	StudyOllamaMessageFixture,
} from './src/server/agents/types.js'
import type { StudyAgentResponse } from '../src/server/agents/types.js'
import type { ToolCall } from '@orkestrel/tool'
import type { StudyAgentReading, StudyAgentRuntime } from '../src/core/agents/types.js'
import { AgentError, estimateRequest, isAgentError, measureRequest } from '@orkestrel/agent'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { createOllama, createOllamaJudge } from '@orkestrel/ollama'
import { createRecorder } from '@orkestrel/test'
import { vi } from 'vitest'
import { StudyControl, StudyDeadline, StudyMeter, StudyScope } from '../src/core/engines/index.js'
import { StudyTrialLease } from '../src/core/engines/StudyTrialLease.js'
import { buildStudySchedule } from '../src/core/helpers.js'
import { StudyAgentObserver } from '../src/core/agents/StudyAgentObserver.js'
import { StudyAgentSummary } from '../src/server/agents/StudyAgentSummary.js'
import { StudyAgentTrace } from '../src/server/agents/StudyAgentTrace.js'

/** Owns the records one fixture observes in arrival order and lends them as one live, readonly view.
 *
 * A reference taken from `entries` sees every record appended later, as the arrays fixtures returned before did.
 * @example Keep a live view of a fixture's records
 * ```ts
 * const log = new StudyLog<string>()
 * const seen = log.entries
 * log.append('first')
 * seen // ['first']
 * ```
 */
export class StudyLog<TEntry> {
	readonly #entries: TEntry[] = []

	/** Reports every record appended so far; the same live view for the log's whole life. */
	get entries(): readonly TEntry[] {
		return this.#entries
	}

	/** Appends one final record after the earlier ones.
	 * @param entry - The observed record.
	 */
	append(entry: TEntry): void {
		this.#entries.push(entry)
	}
}

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
 * @param options - Optional goal execution, a promise that delays each open result, an error that rejects each open, and an error that rejects each session close.
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
					if (options.closing !== undefined) throw options.closing
				},
			}
		},
	}
	return Object.freeze({ driver, opened, executed, closed })
}

/** Creates one trial's lease over recording boundary fixtures, a real failure owner, series scope and deadline.
 * @param options - Optional driver fixture behavior, applied to the lease's driver.
 * @param signal - Optional parent cancellation of the failure owner.
 * @returns The lease, its failure owner, both boundary fixtures, the leased trial and the owned cleanup.
 */
export function createStudyLeaseFixture(
	options: StudyDriverFixtureOptions = {},
	signal?: AbortSignal,
): StudyLeaseFixture {
	const manifest = buildCompactCustodyManifest()
	const trial = manifest.schedule[0]
	if (trial === undefined) throw new Error('Missing fixture trial')
	const driver = createStudyDriverFixture(options)
	const custody = createStudyStoreFixture()
	const control = new StudyControl(signal)
	const series = new StudyScope({ limit: manifest.bounds.series, control, label: 'Series' })
	const lease = new StudyTrialLease(
		trial,
		{ manifest, driver: driver.driver, store: custody.store, signal: control.signal },
		control,
		series,
		new StudyDeadline({ duration: manifest.bounds.request.duration, label: 'Custody or cleanup' }),
	)
	return Object.freeze({
		lease,
		control,
		driver,
		custody,
		trial,
		close(): void {
			series.close()
			control.close()
		},
	})
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

/** Names an origin no fixture contacts; an injected fetch boundary answers every request to it. */
export const STUDY_OLLAMA_ORIGIN = 'http://127.0.0.1:11434'

/** Supplies the exact Ollama `options` an agent chat fixture sends. */
export const STUDY_OLLAMA_OPTIONS = Object.freeze({
	num_ctx: 32768,
	num_predict: 512,
	temperature: 0,
	seed: 0,
})

/** Supplies one streamed content row that a held response sends before it stays open. */
export const STUDY_OLLAMA_PARTIAL_ROW = `${JSON.stringify({ model: 'model', done: false, message: { role: 'assistant', content: 'par' } })}\n`

/** Supplies one complete request's messages. */
export const STUDY_AGENT_MESSAGES: readonly Message[] = Object.freeze<readonly Message[]>([
	{ id: 'm1', role: 'user', content: 'Count the orders' },
])

/** Supplies one complete request's advertised tool. */
export const STUDY_AGENT_TOOLS: NonNullable<ProviderRequest['tools']> = Object.freeze([
	Object.freeze({
		name: 'lookup',
		description: 'Reads a record',
		parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
	}),
])

/** Supplies one complete request's per-call option. */
export const STUDY_AGENT_OPTIONS: ProviderStreamOptions = Object.freeze({ think: false })

/** Supplies a gauge whose projection is the same for every estimate between 0 and 1e9: ceil(100 + 1e-9 * estimate). */
export const STUDY_AGENT_GAUGE: LedgerGauge = Object.freeze({ scale: 1e-9, overhead: 100 })

/** Supplies the projection STUDY_AGENT_GAUGE gives any fixture request, written as arithmetic rather than derived from the helper. */
export const STUDY_AGENT_PROJECTION = 101

/** Supplies terminal rows that report a prompt above STUDY_AGENT_PROJECTION, which every policy must return unchanged. */
export const STUDY_AGENT_MISSES: readonly OllamaRowFixture[] = Object.freeze([
	Object.freeze({ prompt: 102 }),
	Object.freeze({ prompt: 136 }),
])

/** Supplies terminal rows carrying no usable prompt count, which only an enforced policy refuses. */
export const STUDY_AGENT_REFUSALS: readonly AgentRefusalFixture[] = Object.freeze([
	Object.freeze({ name: 'unknown counts', row: Object.freeze({ unknown: true }) }),
	Object.freeze({ name: 'a zero prompt count', row: Object.freeze({ prompt: 0 }) }),
])

/** Supplies the failure an enforced policy attaches to an unusable return. */
export const STUDY_AGENT_USAGE_FAILURE = Object.freeze({
	cause: 'infrastructure',
	message: 'Gauged request returned no usable prompt count',
	role: 'agent',
})

/** Supplies one classification request a real judge answers. */
export const STUDY_JUDGE_REQUEST: JudgeRequest = Object.freeze<JudgeRequest>({
	state: 'Order 1 shipped on Monday',
	questions: { shipped: { form: 'noul' } },
})

/** Builds one inert Ollama chat terminal row consumed by the real provider.
 * @param options - Content, finish, usage, calls, and raw extra fields; `fields` are spread last.
 * @returns A newline-terminated protocol row.
 */
export function buildOllamaRow(options: OllamaRowFixture = {}): string {
	return `${JSON.stringify({ model: 'model', done: true, done_reason: options.reason ?? 'stop', message: { role: 'assistant', content: options.content ?? 'Receipt retained.', ...(options.calls === undefined ? {} : { tool_calls: options.calls }) }, ...(options.unknown === true ? {} : { prompt_eval_count: options.prompt ?? 10, eval_count: options.completion ?? 2 }), ...options.fields })}\n`
}

/** Builds a streamed protocol reply: one nonterminal row per content part, then a terminal row with the reply's counts.
 * @param parts - Content chunks in delta order.
 * @param options - Terminal row overrides; its content is ignored.
 * @returns Newline-delimited protocol rows.
 */
export function buildOllamaStream(
	parts: readonly string[],
	options: OllamaRowFixture = {},
): string {
	const rows = parts.map(
		(content) =>
			`${JSON.stringify({ model: 'model', done: false, message: { role: 'assistant', content } })}\n`,
	)
	return rows.join('') + buildOllamaRow({ ...options, content: '' })
}

/** Builds the protocol answer a raw judge generate request receives: a one-token `length` finish with top logprobs.
 * @param options - Raw extra fields spread last.
 * @returns One JSON document.
 */
export function buildOllamaJudgeRow(options: Readonly<Record<string, JSONValue>> = {}): string {
	return JSON.stringify({
		model: 'judge',
		done: true,
		done_reason: 'length',
		response: 'Yes',
		prompt_eval_count: 10,
		eval_count: 1,
		logprobs: [
			{
				token: 'Yes',
				logprob: -0.01,
				top_logprobs: ['Yes', 'No', 'A', 'B'].map((token) => ({
					token,
					logprob: token === 'Yes' ? -0.01 : -8,
				})),
			},
		],
		...options,
	})
}

/** Reads the protocol answer a fixture gives a path no queued reply claims.
 * @param path - The requested path.
 * @returns The default inventory, metadata, judge, or chat answer.
 */
export function readOllamaDefault(path: string): string {
	if (path === '/api/tags')
		return JSON.stringify({
			models: [
				{ name: 'model', digest: 'a'.repeat(64) },
				{ name: 'judge', digest: 'b'.repeat(64) },
			],
		})
	if (path === '/api/show')
		return JSON.stringify({
			model_info: { 'general.architecture': 'fixture', 'fixture.context_length': 32768 },
		})
	if (path === '/api/generate') return buildOllamaJudgeRow()
	return buildOllamaRow()
}

/** Creates a protocol-faithful fetch boundary that answers queued replies by path and records each request's exact bytes.
 * @param replies - Queued replies for matching request paths.
 * @returns The fetch function, the received requests, and the unserved replies.
 */
export function createOllamaFetch(replies: readonly OllamaReplyFixture[] = []): OllamaFetchFixture {
	const queue = Object.freeze([...replies])
	const requests = new StudyLog<OllamaRequestFixture>()
	const served = new StudyLog<OllamaReplyFixture | undefined>()
	return {
		fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const path = new URL(input instanceof Request ? input.url : input).pathname
			const signal = init?.signal ?? undefined
			// A request an aborted signal refuses is received but claims no queued reply.
			const supplied =
				signal?.aborted === true ? undefined : pickOllamaReply(queue, served.entries, path)
			requests.append({ path, body: typeof init?.body === 'string' ? init.body : '' })
			served.append(supplied)
			signal?.throwIfAborted()
			const bytes = new TextEncoder().encode(supplied?.body ?? readOllamaDefault(path))
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller): void {
						controller.enqueue(bytes)
						// A held response ends only as native fetch ends an aborted body: with the signal's reason.
						if (supplied?.open !== true) controller.close()
						else if (signal !== undefined)
							signal.addEventListener('abort', () => controller.error(signal.reason), {
								once: true,
							})
					},
				}),
				{ status: supplied?.status ?? 200 },
			)
		},
		requests: requests.entries,
		get replies(): readonly OllamaReplyFixture[] {
			return queue.slice(countOllamaServed(served.entries))
		},
	}
}

/** Counts the queued replies a protocol fixture has already served.
 * @param served - The reply each received request claimed, undefined where no queued reply matched it.
 * @returns How many of those requests consumed a queued reply.
 */
export function countOllamaServed(served: ReadonlyArray<OllamaReplyFixture | undefined>): number {
	return served.filter((reply) => reply !== undefined).length
}

/** Picks the queued reply the next request claims: the first unserved reply, only when its path is the request's.
 * @param queue - The queued replies in serving order.
 * @param served - The reply each earlier request claimed, undefined where no queued reply matched it.
 * @param path - The requested path.
 * @returns The claimed reply, or undefined when the next queued reply is for another path or none remains.
 */
export function pickOllamaReply(
	queue: readonly OllamaReplyFixture[],
	served: ReadonlyArray<OllamaReplyFixture | undefined>,
	path: string,
): OllamaReplyFixture | undefined {
	const next = queue[countOllamaServed(served)]
	return next?.path === path ? next : undefined
}

/** Drains a provider stream, keeping both the yielded deltas and the returned result.
 * @param stream - The generator to drain.
 * @returns Deltas in yield order and the assembled result.
 */
export async function readProviderStream(
	stream: AsyncGenerator<ProviderDelta, ProviderResult>,
): Promise<ProviderStreamFixture> {
	const deltas: ProviderDelta[] = []
	for (;;) {
		const next = await stream.next()
		if (next.done) return { deltas, result: next.value }
		deltas.push(next.value)
	}
}

/** Reads whether a promise has already settled, without waiting for it to.
 * @param promise - The promise to observe, settled by either fulfilment or rejection.
 * @returns True if the promise settled within one microtask turn; false while it is still pending.
 */
export function readSettled(promise: PromiseLike<unknown>): Promise<boolean> {
	return Promise.race([
		Promise.resolve(promise).then(
			() => true,
			() => true,
		),
		Promise.resolve().then(() => false),
	])
}

/** Reads a retained evidence value as a record, refusing any other shape.
 * @param value - The retained value.
 * @returns The same value as a record.
 */
export function requireStudyRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (!isRecord(value)) throw new Error('Expected a retained record')
	return value
}

/** Reads the exact tool receipts a chat request body carries, in message order.
 * @param body - The encoded chat request.
 * @returns The content of every `tool` message.
 */
export function readOllamaToolResults(body: string): readonly string[] {
	const value = parseJSON(body)
	if (!isRecord(value) || !Array.isArray(value.messages)) throw new Error('Invalid chat request')
	return value.messages.flatMap((message: unknown) => {
		if (!isRecord(message)) throw new Error('Invalid chat message')
		if (message.role !== 'tool') return []
		if (typeof message.content !== 'string') throw new Error('Invalid tool receipt')
		return [message.content]
	})
}

/** Builds one inert chat terminal row that asks for the `lookup` tool.
 * @param options - Usage and finish overrides; its content and calls are replaced.
 * @returns A newline-terminated protocol row.
 */
export function buildOllamaCall(options: OllamaRowFixture = {}): string {
	return buildOllamaRow({
		...options,
		content: '',
		calls: [{ function: { name: 'lookup', arguments: { id: 'order-1' } } }],
	})
}

/** Supplies the admitted Agent capability set from the actual development Agent exports.
 * @returns The actual estimator, measurer and nominal guard.
 */
export function createAgentRuntime(): StudyAgentRuntime {
	return { estimateRequest, measureRequest, isAgentError }
}

/** Creates the window refusal the Agent raises through its actual error class.
 * @param message - The refusal text.
 * @returns The actual `WINDOW` error instance.
 */
export function createAgentWindowError(message = 'Context window exhausted'): AgentError {
	return new AgentError('WINDOW', message)
}

/** Wraps a real published Ollama provider in the observer and records every reading it takes.
 * @param wire - The fetch boundary the real provider sends through.
 * @param gauge - The explicit gauge; undefined prices nothing.
 * @param enforced - If `true`, the observer refuses an unusable prompt count; if `false`, it refuses nothing.
 * @param replay - The replay policy the real provider is constructed with; omitted keeps its default.
 * @returns The observer, its delegate, and the recorded readings and requests.
 */
export function createAgentObserver(
	wire: OllamaFetchFixture,
	gauge: LedgerGauge | undefined,
	enforced: boolean,
	replay?: ThinkingReplay,
): AgentObserverFixture {
	const inner = createOllama({
		model: 'model',
		url: STUDY_OLLAMA_ORIGIN,
		think: false,
		fetch: wire.fetch,
		...(replay === undefined ? {} : { replay }),
		options: STUDY_OLLAMA_OPTIONS,
	})
	const readings = new StudyLog<StudyAgentReading>()
	const requests = new StudyLog<ProviderRequest>()
	const observer = new StudyAgentObserver({
		provider: inner,
		runtime: createAgentRuntime(),
		gauge,
		enforced,
		record: (reading, request) => {
			readings.append(reading)
			requests.append(request)
		},
	})
	return { observer, inner, readings: readings.entries, requests: requests.entries }
}

/** Supplies the exact Ollama `options` a one-token judge fixture sends. */
export const STUDY_JUDGE_OPTIONS = Object.freeze({
	num_ctx: 32768,
	num_predict: 1,
	temperature: 1,
	seed: 0,
})

/** Creates a real published Ollama judge that sends through the supplied fetch boundary.
 * @param url - The daemon origin.
 * @param fetch - The transport every judge request goes through.
 * @returns The real judge.
 */
export function createOllamaJudgeFixture(
	url: string,
	fetch: typeof globalThis.fetch,
): JudgeInterface {
	return createOllamaJudge({
		model: 'judge',
		system: 'Answer the question about the state.',
		url,
		fetch,
		options: STUDY_JUDGE_OPTIONS,
	})
}

/** Creates a failure owner that records every check and failure and refuses with a supplied value.
 * @param refusal - Wraps the value every check throws, which may itself be undefined or null; absent lets work continue.
 * @returns The recorded owner.
 */
export function createStudyLatch(refusal?: { readonly error: unknown }): StudyLatchFixture {
	const checks = createRecorder<readonly []>()
	const failures = createRecorder<readonly [unknown]>()
	return {
		checks,
		failures,
		check(): void {
			checks.handler()
			if (refusal !== undefined) throw refusal.error
		},
		fail(error: unknown): void {
			failures.handler(error)
		},
	}
}

/** Supplies the summary instruction the summary proofs append as the final user turn. */
export const STUDY_SUMMARY_INSTRUCTION: Message = Object.freeze<Message>({
	id: 'summary-instruction',
	role: 'user',
	content: 'Fold the conversation.',
})

/** Supplies the folded conversation the summary proofs summarize. */
export const STUDY_SUMMARY_MESSAGES: readonly Message[] = Object.freeze<readonly Message[]>([
	{ id: 'h1', role: 'user', content: 'First arrival' },
	{ id: 'h2', role: 'assistant', content: 'First answer' },
])

/** Supplies terminal rows whose actual prompt equals or exceeds STUDY_AGENT_PROJECTION, which a summary must still complete under. */
export const STUDY_SUMMARY_PROMPTS: readonly OllamaRowFixture[] = Object.freeze([
	Object.freeze({ prompt: STUDY_AGENT_PROJECTION }),
	...STUDY_AGENT_MISSES,
])

/** Joins every message to the declared `history` origin and its own id, as an inert consumer origin handler.
 * @param messages - The measured request's messages.
 * @returns One origin entry per message in order.
 */
export function buildStudyAgentOrigins(messages: readonly Message[]): JSONValue {
	return messages.map((message) => ({ origin: 'history', source: message.id }))
}

/** Creates a custody sink that records every offered row and the accepted ones, and can refuse one row or run a hook on every append.
 * @param options - Optional refusal and append hook.
 * @returns The sink, its accepted rows and every offered row, the refused one included.
 */
export function createStudySinkFixture(options: StudySinkFixtureOptions = {}): StudySinkFixture {
	const accepted = new StudyLog<StudyEvidence>()
	const received = new StudyLog<StudyEvidence>()
	const sink: StudySinkInterface = {
		async append(evidence): Promise<void> {
			await options.during?.()
			const row = received.entries.length
			received.append(evidence)
			if (options.refuse !== undefined && options.refuse.row === row) throw options.refuse.error
			accepted.append(evidence)
		},
	}
	return { sink, rows: accepted.entries, offered: received.entries }
}

/** Creates a real trace over the actual Agent runtime and a recorded failure owner.
 * @param observe - If `true`, the trace retains measurement rows; if `false`, it retains none.
 * @param refusal - Wraps the value the latch's check throws; absent lets work continue.
 * @returns The trace and its latch.
 */
export function createStudyAgentTrace(
	observe: boolean,
	refusal?: { readonly error: unknown },
): StudyAgentTraceFixture {
	const latch = createStudyLatch(refusal)
	const trace = new StudyAgentTrace({
		runtime: createAgentRuntime(),
		latch,
		observe,
		origins: buildStudyAgentOrigins,
	})
	return { trace, latch }
}

/** Creates a real summary over a real Ollama provider on a protocol-faithful wire, with the gauge that prices every fixture request at the declared projection.
 * @param options - Queued wire replies, observation switch, limit, and optional cancellation and latch refusal.
 * @returns The summary, its trace and latch, and the wire.
 */
export function createStudyAgentSummary(
	options: StudyAgentSummaryFixtureOptions,
): StudyAgentSummaryFixture {
	const wire = createOllamaFetch(options.replies)
	const { trace, latch } = createStudyAgentTrace(options.observe, options.refusal)
	const summary = new StudyAgentSummary({
		provider: createAgentObserver(wire, undefined, false).inner,
		runtime: createAgentRuntime(),
		trace,
		latch,
		gauge: options.gauge ?? STUDY_AGENT_GAUGE,
		limit: options.limit,
		instruction: STUDY_SUMMARY_INSTRUCTION,
		signal: options.signal ?? new AbortController().signal,
	})
	return { summary, trace, latch, wire }
}

/** Builds the one queued chat reply that answers a summary with the supplied content and a usable prompt count.
 * @param content - The reply content.
 * @returns A single reply for the chat path.
 */
export function buildOllamaReplies(content: string): readonly OllamaReplyFixture[] {
	return [{ path: '/api/chat', body: buildOllamaRow({ content, prompt: 9 }) }]
}

/** Reads the chat messages a request body carries, in order.
 * @param body - The encoded chat request.
 * @returns The role and content of every message.
 */
export function readOllamaMessages(body: string): readonly StudyOllamaMessageFixture[] {
	const value = parseJSON(body)
	if (!isRecord(value) || !Array.isArray(value.messages)) throw new Error('Invalid chat request')
	return value.messages.map((message): StudyOllamaMessageFixture => {
		if (
			!isRecord(message) ||
			typeof message.role !== 'string' ||
			typeof message.content !== 'string'
		)
			throw new Error('Invalid chat message')
		return { role: message.role, content: message.content }
	})
}

/** Supplies the declared Ollama serving identities the transport helper proofs pin. */
export const STUDY_OLLAMA_PROVIDER: StudyProvider = Object.freeze({
	entry: 'provider.js',
	url: STUDY_OLLAMA_ORIGIN,
	model: 'model',
	judge: 'judge',
	digest: Object.freeze({ model: 'a'.repeat(64), judge: 'b'.repeat(64) }),
})

/** Supplies a conversation whose tool message answers the call `actual-call`. */
export const STUDY_SCRIPT_MESSAGES: readonly Message[] = Object.freeze<readonly Message[]>([
	{ id: 'm1', role: 'user', content: 'Count the orders' },
	{ id: 'm2', role: 'tool', content: 'actual-result', call: 'actual-call' },
])

/** Supplies the projection a script retains for STUDY_SCRIPT_MESSAGES, written as a literal rather than derived. */
export const STUDY_SCRIPT_REQUEST: readonly JSONValue[] = Object.freeze([
	{ role: 'user', content: 'Count the orders' },
	{ role: 'tool', content: 'actual-result', call: 'actual-call' },
])

/** Supplies one inert tool call a scripted response requests. */
export const STUDY_SCRIPT_CALL: ToolCall = Object.freeze({
	id: 'call-1',
	name: 'lookup',
	arguments: Object.freeze({ id: 'order-1' }),
})

/** Supplies more calls than any one consumer's workload bound, which the generic guard must still accept. */
export const STUDY_SCRIPT_MANY_CALLS: readonly ToolCall[] = Object.freeze(
	Array.from({ length: 16 }, () => STUDY_SCRIPT_CALL),
)

/** Supplies responses the scripted response guard must accept. */
export const STUDY_SCRIPT_VALID_RESPONSES: readonly unknown[] = Object.freeze([
	{ content: 'done', calls: [] },
	buildStudyScriptResponse(),
	buildStudyScriptResponse({
		content: 'looking',
		calls: [STUDY_SCRIPT_CALL],
		consume: 'call-0',
		abort: true,
		tokens: 0,
		bytes: 0,
	}),
	{ content: 'x'.repeat(4096), calls: [] },
	{ content: '', calls: STUDY_SCRIPT_MANY_CALLS },
	{ content: '', calls: [], consume: 'c'.repeat(256) },
])

/** Supplies responses the scripted response guard must refuse, one violated rule each. */
export const STUDY_SCRIPT_INVALID_RESPONSES: readonly unknown[] = Object.freeze([
	null,
	undefined,
	'done',
	[],
	{ calls: [] },
	{ content: 'x' },
	{ content: 'x', calls: [], extra: true },
	{ content: 1, calls: [] },
	{ content: '', calls: 'none' },
	{ content: '', calls: [{ id: 'call-1', name: 'lookup' }] },
	{ content: '', calls: [{ id: 'call-1', name: 'lookup', arguments: [] }] },
	{ content: '', calls: [{ id: 'call-1', name: 'lookup', arguments: { value: Number.NaN } }] },
	{ content: '', calls: [], consume: '' },
	{ content: '', calls: [], consume: 1 },
	{ content: '', calls: [], abort: 'yes' },
	{ content: '', calls: [], tokens: -1 },
	{ content: '', calls: [], tokens: 1.5 },
	{ content: '', calls: [], tokens: '1' },
	{ content: '', calls: [], tokens: Number.NaN },
	{ content: '', calls: [], bytes: Number.MAX_SAFE_INTEGER + 1 },
	{ content: '', calls: [], bytes: Number.NaN },
])

/**
 * Builds one inert scripted response with every control undefined.
 * @param change - The members that differ from the empty response
 * @returns The complete response
 */
export function buildStudyScriptResponse(
	change: Partial<StudyAgentResponse> = {},
): StudyAgentResponse {
	return {
		content: '',
		calls: [],
		consume: undefined,
		abort: undefined,
		tokens: undefined,
		bytes: undefined,
		...change,
	}
}

/**
 * Creates the real meter fixture with one shared allowance at every scope and one call per request.
 * @param bytes - The byte allowance at the request and every enclosing scope; Default: 1000
 * @param tokens - The token allowance at the request and every enclosing scope; Default: 100
 * @param requests - The number of full-size requests each enclosing scope can reserve; Default: 1
 * @returns The owned control, scopes and meter with cleanup
 */
export function createStudyScriptMeter(
	bytes = 1000,
	tokens = 100,
	requests = 1,
): StudyMeterFixture {
	const limit = { duration: 1000, calls: 4, tokens, bytes }
	const scope = { ...limit, bytes: bytes * requests }
	return createStudyMeterFixture({
		request: { ...limit, calls: 1 },
		goal: scope,
		trial: scope,
		series: scope,
	})
}

/**
 * Builds a scripted plan over a real meter whose evidence sink records every appended row.
 * @param meter - The real meter fixture the plan admits through
 * @param responses - The declared inert responses in serving order
 * @returns The plan, the recorded rows and the separate workload controller
 */
export function createStudyScriptFixture(
	meter: StudyMeterFixture,
	responses: readonly StudyAgentResponse[],
): StudyScriptFixture {
	const rows = createRecorder<readonly [StudyEvidence]>()
	const workload = new AbortController()
	return Object.freeze({
		rows,
		workload,
		plan: {
			responses,
			goal: 'script',
			workload,
			context: {
				signal: meter.control.signal,
				meter: meter.meter,
				evidence: {
					async append(row: StudyEvidence): Promise<void> {
						rows.handler(row)
					},
				},
			},
		},
	})
}
