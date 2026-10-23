import type { BudgetError, BudgetErrorContext } from '@orkestrel/budget'
import type { DistributionObservation, DistributionStage } from './setupDistribution.js'
import type { StudyLaunchResult } from '../src/server/launchers/types.js'
import type { ScratchInterface } from '@orkestrel/test/server'
import type { ArtifactLoaderOptions } from '../src/server/artifacts/types.js'
import type { ChildProcess } from 'node:child_process'
import type {
	StudyDaemonFixture,
	StudyReplayFixture,
	StudyContinuationFixture,
	StudyContinuationRefusal,
	StudyContinuationSource,
} from './src/server/commands/types.js'
import type {
	StudyAttempt,
	StudyCriterion,
	StudyEvidence,
	StudyGrading,
	StudyLabeling,
	StudyManifest,
	StudyObservation,
	StudyRole,
	StudyRubric,
	StudyRecord,
} from '../src/core/types.js'
import type { StudyAdjudication, StudyGradeFunction } from '../src/server/adapters/types.js'
import type {
	StudyExchangeDeclaration,
	StudyExchangeHistory,
	StudyExchangeIdentity,
	StudySealedResult,
} from '../src/server/stores/types.js'
import type {
	StudyExchangeCustodyFixture,
	StudyExchangeMutation,
} from './src/server/stores/types.js'
import type {
	StudyProcessSessionOptions,
	StudyTaskOptions,
	StudyTaskRequest,
} from '../src/server/processes/types.js'
import type {
	StudyAgentFixture,
	StudyCheckReading,
	StudyOrphanReceipt,
	StudyPeerFixture,
	StudyTaskFixture,
	StudyTaskMode,
} from './src/server/processes/types.js'
import type { ProviderInterface } from '@orkestrel/agent'
import type { StudyAgentDispatch } from '../src/core/agents/types.js'
import type {
	StudyOllamaRole,
	StudyOllamaStep,
	StudyOllamaTransportOptions,
} from '../src/server/ollama/types.js'
import type { StudyExchangeRow, StudyExchangeSinkInterface } from '../src/server/stores/types.js'
import type { JSONValue } from '@orkestrel/contract'
import type { OllamaReplyFixture, OllamaRequestFixture } from './src/core/agents/types.js'
import type {
	OllamaContextFixture,
	OllamaExchangeFixture,
	OllamaFailureFixture,
	OllamaServerFixture,
	OllamaStatusFailureFixture,
	OllamaStreamFailureFixture,
	OllamaStrictRolesFixture,
	OllamaTransportFixture,
	OllamaRecordingFixture,
	OllamaWireReplyFixture,
} from './src/server/ollama/types.js'
import type {
	StudyMCPAnswer,
	StudyMCPFixture,
	StudyMCPInterference,
	StudyMCPProxy,
	StudySparseEvidence,
} from './src/server/adapters/types.js'
import {
	DISTRIBUTION_FORMATS,
	DISTRIBUTION_RESOLUTIONS,
	checkDistributionProject,
	filterDistributionEntries,
	isDistributionRecord,
	readDistributionJSON,
	readDistributionOutput,
	runDistributionNode,
	runDistributionNpm,
	writeDistributionFile,
	writeDistributionProject,
} from './setupDistribution.js'
import { isArray, isInteger, isRecord, parseJSON } from '@orkestrel/contract'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { requireValue, waitForCondition, waitForEvent, waitForDelay } from '@orkestrel/test'
import { execFile, fork, spawn } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { mergeOverride, peers, srcCore, srcServer } from '../vite.config.js'
import binConfig from '../configs/src/vite.bin.config.js'
import { outputBoundary, resolveExternal } from '../configs/helpers.js'
import { encodeStudyJSON, hashStudyBytes } from '../src/server/helpers.js'
import { parseStudyProfile } from '../src/core/parsers.js'
import {
	isStudyCharge,
	isStudyEvidence,
	isStudyFrame,
	isStudyIdentity,
	isStudyProcessFailure,
	isStudyTrial,
} from '../src/server/processes/validators.js'
import { StudyTask } from '../src/server/processes/StudyTask.js'
import { StudyCommand } from '../src/server/commands/StudyCommand.js'
import { STUDY_TASK_DURATION } from '../src/server/processes/constants.js'
import { STUDY_LAUNCH_BYTES } from '../src/server/launchers/constants.js'
import { collectStudyEvidence } from '../src/server/commands/helpers.js'
import { StudyResultStore } from '../src/server/stores/StudyResultStore.js'
import {
	buildStudyPacket,
	projectStudyExchangeIdentity,
	buildStudyPacketLinks,
	readStudyResult,
	readStudyExchanges,
	readStudyExchangeRows,
} from '../src/server/stores/helpers.js'

/** Moves fixture package manifests and built bytes beneath a consumer's node_modules.
 * @param scratch - The consumer holding its profile and built runtime.
 * @param entry - The built Study executable before relocation.
 * @returns The nested Study executable, with the consumer root admitted first.
 */
export function nestStudyConsumer(scratch: ScratchInterface, entry: string): string {
	const profile = parseStudyProfile(
		parseJSON(scratch.read('studies/files/profiles/local.json') ?? ''),
	)
	const roots = [...new Set([...profile.roots, dirname(dirname(dirname(entry)))])]
	const moves = roots.map((root) => {
		const manifest = readFileSync(join(root, 'package.json'), 'utf8')
		const value = parseJSON(manifest)
		if (!isRecord(value) || typeof value.name !== 'string')
			throw new Error('Missing fixture package name')
		const target = join(scratch.path, 'node_modules', ...value.name.split('/'))
		mkdirSync(target, { recursive: true })
		cpSync(join(root, 'package.json'), join(target, 'package.json'))
		cpSync(join(root, 'dist'), join(target, 'dist'), { recursive: true })
		return { root, target }
	})
	scratch.write(
		'package.json',
		JSON.stringify({ name: 'replay-consumer', version: '1.0.0', type: 'module' }),
	)
	scratch.write('dist/index.js', 'export const consumer = true\n')
	const selections = new Map(
		[
			profile.agent,
			profile.subject,
			...(profile.provider === undefined ? [] : [profile.provider.entry]),
			entry,
		].map((path) => {
			const move = moves.find(({ root }) => path.startsWith(root + sep))
			if (move === undefined) throw new Error('Missing nested fixture selection')
			return [path, join(move.target, relative(move.root, path))]
		}),
	)
	scratch.write(
		'studies/files/profiles/local.json',
		JSON.stringify({
			...profile,
			agent: selections.get(profile.agent),
			subject: selections.get(profile.subject),
			roots: [scratch.path, ...moves.map(({ target }) => target)],
			...(profile.provider === undefined
				? {}
				: { provider: { ...profile.provider, entry: selections.get(profile.provider.entry) } }),
		}),
	)
	return requireValue(selections.get(entry))
}

/** Records an open trial through the actual command, worker, and protocol fixture.
 * @param nested - If true, places admitted packages beneath a consumer root listed first.
 * @returns The sealed recording and resources released by close.
 */
export async function createStudyReplayFixture(nested = false): Promise<StudyReplayFixture> {
	const scratch = createStudyConsumer()
	const library = createScratch({ parent: resolve('tmp/units') })
	const server = await createOllamaServer()
	try {
		const subject = await buildStudyLibrary(
			library,
			resolve('src/server/ollama/StudyOllamaTransport.ts'),
		)
		writeStudyRecordingConsumer(scratch, server.url, subject, true)
		const original = parseStudyProfile(
			parseJSON(scratch.read('studies/files/profiles/local.json') ?? ''),
		)
		if (!isRecord(original.settings) || !isRecord(original.settings.metadata))
			throw new Error('Missing recording settings')
		scratch.write(
			'studies/files/profiles/local.json',
			JSON.stringify({
				...original,
				...(nested
					? {
							bounds: {
								request: { ...original.bounds.request, duration: 10000 },
								goal: { ...original.bounds.goal, duration: 30000 },
								trial: { ...original.bounds.trial, duration: 40000 },
								series: { ...original.bounds.series, duration: 120000 },
							},
						}
					: {}),
				record: { bytes: 65536, calls: 3, duration: 15000 },
				settings: { ...original.settings, metadata: { ...original.settings.metadata, calls: 8 } },
			}),
		)
		const built = await buildStudyCLI(scratch)
		const entry = nested ? nestStudyConsumer(scratch, built) : built
		const command = new StudyCommand({ root: scratch.path, entry })
		const recorded = join(scratch.path, 'baseline')
		await command.execute(
			['execute', 'assessment', '--out', recorded],
			new AbortController().signal,
		)
		const result = await readStudyResult(recorded)
		if (result.status !== 'sealed') throw new Error('Replay fixture did not seal')
		const trial = requireValue(result.manifest.schedule[0])
		const history = await readStudyExchanges(result, trial.id)
		const profile = parseStudyProfile(
			parseJSON(scratch.read('studies/files/profiles/local.json') ?? ''),
		)
		return {
			scratch,
			entry,
			command,
			server,
			recorded,
			result,
			history,
			profile,
			close: async () => {
				await server.close()
				library.destroy()
				scratch.destroy()
			},
		}
	} catch (error) {
		await server.close()
		library.destroy()
		scratch.destroy()
		throw error
	}
}

/** Records one goal on the dedicated fixture and grows only JSON declarations for continuation.
 * @param library - The built real Study transport.
 * @returns A sealed ancestor, the grown consumer, and ownership of its fixture resources.
 */
export async function createStudyContinuationFixture(
	library: string,
): Promise<StudyContinuationFixture> {
	const fixture = await createStudyDaemonFixture(library, 'normal', true)
	const { scratch } = fixture
	try {
		const scenario = requireValue(scratch.read('studies/files/scenarios/first.json'))
		const rubric = requireValue(scratch.read('studies/assessment/rubric.json'))
		const definition = parseJSON(requireValue(scratch.read('studies/assessment/study.json')))
		if (!isRecord(definition)) throw new Error('Missing continuation definition')
		scratch.write(
			'studies/assessment/study.json',
			JSON.stringify({ ...definition, order: [['small']] }),
		)
		scratch.write(
			'studies/files/scenarios/first.json',
			JSON.stringify({ id: 'first', goals: [{ id: 'write', input: 'remember' }] }),
		)
		const criteria = parseJSON(rubric)
		if (!isRecord(criteria) || !isArray(criteria.criteria))
			throw new Error('Missing continuation rubric')
		scratch.write(
			'studies/assessment/rubric.json',
			JSON.stringify({
				...criteria,
				criteria: criteria.criteria.filter(
					(criterion) => isRecord(criterion) && criterion.goal === 'write',
				),
			}),
		)
		const adapter = requireValue(scratch.read('studies/files/index.ts'))
		scratch.write(
			'studies/files/index.ts',
			adapter
				.replace(
					'body: request.body',
					"body: goal.id === 'write' && process.env.STUDY_EXTENSION_CHANGE === 'body' ? request.body.replace('remember', 'Remember') : request.body",
				)
				.replace(
					'if (goal.id === exchanges.declaration.goals.at(-1))',
					"if (goal.id === 'write' && process.env.STUDY_EXTENSION_CHANGE === 'extra') await transport.fetch('agent', profile.provider.url + '/api/chat', { method: 'POST', body: profile.settings.requests[0].body })\n     if (goal.id === exchanges.declaration.goals.at(-1))",
				),
		)
		const profile = { ...fixture.profile, record: { bytes: 65536, calls: 1, duration: 15000 } }
		scratch.write('studies/files/profiles/local.json', JSON.stringify(profile))
		const entry = await buildStudyCLI(scratch)
		const command = new StudyCommand({ root: scratch.path, entry })
		const recorded = join(scratch.path, 'baseline')
		await command.execute(
			['execute', 'assessment', '--out', recorded],
			new AbortController().signal,
		)
		const result = await readStudyResult(recorded)
		if (result.status !== 'sealed') throw new Error('Continuation ancestor did not seal')
		const history = await readStudyExchanges(result, requireValue(result.manifest.schedule[0]).id)
		scratch.write('studies/files/scenarios/first.json', scenario)
		scratch.write('studies/assessment/rubric.json', rubric)
		const executing = {
			...profile,
			record: { bytes: 131072, calls: 4, duration: 30000 },
			bounds: { ...profile.bounds, series: { ...profile.bounds.series, duration: 120000 } },
		}
		scratch.write('studies/files/profiles/local.json', JSON.stringify(executing))
		return { ...fixture, profile: executing, entry, command, recorded, result, history }
	} catch (error) {
		await fixture.close()
		throw error
	}
}

/** Builds continuation admission controls from independently changed public declarations.
 * @param fixture - The grown consumer and its sealed ancestor.
 * @returns Each changed file paired with the bytes restored after its refusal.
 */
export function buildStudyContinuationRefusals(
	fixture: StudyContinuationFixture,
): readonly StudyContinuationRefusal[] {
	const { scratch, profile } = fixture
	const definition = parseJSON(requireValue(scratch.read('studies/assessment/study.json')))
	if (!isRecord(definition) || !isRecord(profile.settings))
		throw new Error('Missing continuation declarations')
	const { daemon: _daemon, ...provider } = requireValue(profile.provider)
	const { record: _record, ...unrecorded } = profile
	const rows = [
		{
			name: 'definition',
			path: 'studies/assessment/study.json',
			value: { ...definition, question: 'Changed question' },
		},
		{
			name: 'trial order',
			path: 'studies/assessment/study.json',
			value: { ...definition, order: [['small'], ['small']] },
		},
		{
			name: 'driver',
			path: 'studies/assessment/study.json',
			value: { ...definition, driver: 'absent' },
		},
		{
			name: 'equal horizon',
			path: 'studies/files/scenarios/first.json',
			value: { id: 'first', goals: [{ id: 'write', input: 'remember' }] },
		},
		{
			name: 'changed prior input',
			path: 'studies/files/scenarios/first.json',
			value: {
				id: 'first',
				goals: [
					{ id: 'write', input: 'Remember' },
					{ id: 'recall', input: 'recall' },
				],
			},
		},
		{
			name: 'changed prior goal',
			path: 'studies/files/scenarios/first.json',
			value: {
				id: 'first',
				goals: [
					{ id: 'different', input: 'remember' },
					{ id: 'recall', input: 'recall' },
				],
			},
		},
		{
			name: 'scenario identity',
			path: 'studies/files/scenarios/first.json',
			value: {
				id: 'different',
				goals: [
					{ id: 'write', input: 'remember' },
					{ id: 'recall', input: 'recall' },
				],
			},
		},
		{
			name: 'absent daemon',
			path: 'studies/files/profiles/local.json',
			value: { ...profile, provider },
		},
		{ name: 'absent recording', path: 'studies/files/profiles/local.json', value: unrecorded },
		{
			name: 'declared procedure',
			path: 'studies/files/profiles/local.json',
			value: { ...profile, settings: { ...profile.settings, procedure: [buildOllamaStep()] } },
		},
		{
			name: 'version',
			path: 'studies/files/profiles/local.json',
			value: { ...profile, settings: { ...profile.settings, version: 'different' } },
		},
		{
			name: 'models',
			path: 'studies/files/profiles/local.json',
			value: {
				...profile,
				provider: {
					...profile.provider,
					digest: { model: 'c'.repeat(64), judge: 'b'.repeat(64) },
					daemon: {
						...profile.provider?.daemon,
						models: [
							{ name: 'model', digest: 'c'.repeat(64) },
							{ name: 'judge', digest: 'b'.repeat(64) },
						],
					},
				},
			},
		},
		{
			name: 'configuration',
			path: 'studies/files/profiles/local.json',
			value: { ...profile, settings: { ...profile.settings, observe: true } },
		},
		{
			name: 'daemon environment',
			path: 'studies/files/profiles/local.json',
			value: {
				...profile,
				provider: {
					...profile.provider,
					daemon: {
						...profile.provider?.daemon,
						environment: { ...profile.provider?.daemon?.environment, OLLAMA_NUM_PARALLEL: '2' },
					},
				},
			},
		},
	]
	return [
		...rows.map((row) => ({
			name: row.name,
			path: row.path,
			original: requireValue(scratch.read(row.path)),
			changed: JSON.stringify(row.value),
		})),
		{
			name: 'content',
			path: 'studies/files/index.ts',
			original: requireValue(scratch.read('studies/files/index.ts')),
			changed: requireValue(scratch.read('studies/files/index.ts')) + ' ',
		},
	]
}

/** Retains an ancestor control through real result custody, with optional recording and completion.
 * @param fixture - The successful recording whose public evidence is copied.
 * @param name - The absent result directory beneath the fixture.
 * @param recording - If true, retains a complete sidecar; if false, declares no recording.
 * @param declared - If true, declares the recorded execution as an exact procedure; if false, keeps it open.
 * @param sealed - If true, seals the result; if false, leaves interrupted custody.
 * @returns The independently readable result directory.
 */
export async function retainStudyContinuationSource(
	fixture: StudyContinuationFixture,
	name: string,
	recording: boolean,
	declared: boolean,
	sealed = true,
): Promise<string> {
	const directory = join(fixture.scratch.path, name)
	const { record: _record, ...original } = fixture.result.manifest
	const manifest = {
		...original,
		id: `${original.id}-${name}`,
		...(recording ? { record: fixture.history.declaration.record } : {}),
	}
	const store = new StudyResultStore({ directory, manifest })
	await store.create()
	for (const trial of manifest.schedule) {
		const rows = readStudyExchangeRows(
			Buffer.from(
				requireValue(fixture.scratch.read(`baseline/execution/trials/${trial.id}/exchanges.jsonl`)),
			),
		)
		const attempt = requireValue(
			fixture.history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		).attempt
		const declaration = {
			...fixture.history.declaration,
			...(declared
				? {
						procedure: [
							{
								admission: 'exact' as const,
								ordinal: 1,
								goal: 'write',
								role: 'agent' as const,
								path: '/api/chat' as const,
								body: Buffer.from(attempt.body, 'base64').toString(),
								input: attempt.digest,
								policy: {
									model: 'model',
									options: { num_ctx: 8192, num_predict: 8 },
									think: false,
									strict: false,
									length: false,
								},
							},
						],
					}
				: {}),
		}
		if (recording) await store.exchanges(trial, declaration)
		const sink = await store.start(trial)
		const evidence = requireValue(
			fixture.scratch.read(`baseline/execution/trials/${trial.id}/evidence.jsonl`),
		)
			.split(/\r\n|\n/)
			.filter(Boolean)
			.map((line) => parseJSON(line))
		for (const row of evidence) {
			if (!isStudyEvidence(row)) throw new Error('Invalid continuation source evidence')
			await sink.append(row)
		}
		if (recording)
			await writeFile(
				join(directory, 'execution', 'trials', trial.id, 'exchanges.jsonl'),
				[declaration, ...rows.slice(1)].map((row) => JSON.stringify(row) + '\n').join(''),
			)
		await store.finish(
			requireValue(fixture.result.attempts.find((candidate) => candidate.trial.id === trial.id)),
		)
	}
	if (sealed) await store.seal()
	return directory
}

/** Names replay request changes with independently known cursor outcomes. */
export const STUDY_REPLAY_DIVERGENCE_CASES = Object.freeze([
	'same-length',
	'longer',
	'extra',
	'early',
] as const)
import { BudgetError as LocalBudgetError, isBudgetError } from '@orkestrel/budget'
import { isObject } from '@orkestrel/contract'
import { createOllama, extractTiming } from '@orkestrel/ollama'
import { createMCPLegacy, createMCPServer } from '@orkestrel/mcp'
import { createMCPRoutes } from '@orkestrel/mcp/server'
import { createDispatcher } from '@orkestrel/router'
import { createServer as createHost } from '@orkestrel/server'
import { createTool, createToolManager } from '@orkestrel/tool'
import { StudyOllamaExchange } from '../src/server/ollama/StudyOllamaExchange.js'
import { StudyOllamaTransport } from '../src/server/ollama/StudyOllamaTransport.js'
import { buildStudyOllamaBytes } from '../src/server/ollama/helpers.js'
import { createServer } from 'node:http'
import { createServer as createPortServer } from 'node:net'
import {
	buildCompactCustodyManifest,
	buildCustodyAttempt,
	buildCustodyManifest,
	buildStudyRubric,
	buildStudyDefinition,
	buildStudyProfile,
	buildStudyScenario,
	buildOllamaCall,
	buildOllamaRow,
	buildOllamaStream,
	createStudyMeterFixture,
	OllamaReplyQueue,
	readOllamaDefault,
	StudyLog,
	STUDY_JUDGE_OPTIONS,
	STUDY_OLLAMA_OPTIONS,
	STUDY_OLLAMA_PARTIAL_ROW,
} from './setupStudy.js'

/** Builds a declared complete exchange journal without using the production reader.
 * @param trial - The scheduled trial identity.
 * @param captured - If true, declares capture admission; if false, declares exact bytes.
 * @param record - The trial's complete recording bounds.
 * @returns The declaration, paired exchanges and completion.
 */
export function buildStudyExchangeRows(
	trial = 'r1-first-small',
	captured = false,
	record: StudyRecord = { bytes: 32768, calls: 256, duration: 15000 },
): readonly StudyExchangeRow[] {
	const policy = {
		model: 'model',
		options: { num_ctx: 32, num_predict: 8 },
		think: false,
		strict: false,
		length: false,
	}
	const body = JSON.stringify({
		model: 'model',
		messages: [{ role: 'user', content: 'remember' }],
		stream: true,
		think: false,
		options: policy.options,
	})
	const declaration: StudyExchangeDeclaration = {
		phase: 'declaration',
		trial,
		version: '0.40.3',
		models: { model: { name: 'model', digest: 'a'.repeat(64) } },
		metadata: { calls: 6, bytes: 65536, duration: 5000 },
		record,
		goals: ['write', 'read'],
		configuration: 'c'.repeat(64),
		procedure: [
			captured
				? {
						admission: 'capture',
						ordinal: 1,
						goal: 'write',
						role: 'agent',
						path: '/api/chat',
						policy,
						bytes: Buffer.byteLength(body),
					}
				: {
						admission: 'exact',
						ordinal: 1,
						goal: 'write',
						role: 'agent',
						path: '/api/chat',
						policy,
						body,
						input: hashStudyBytes(Buffer.from(body)),
					},
		],
		maintenance: [],
	}
	const identities: readonly StudyExchangeIdentity[] = [
		{
			ordinal: 1,
			goal: 'write',
			role: 'metadata',
			path: '/api/version',
			method: 'GET',
			stage: 'preflight',
		},
		{
			ordinal: 2,
			goal: 'write',
			role: 'metadata',
			path: '/api/tags',
			method: 'GET',
			stage: 'preflight',
		},
		{
			ordinal: 3,
			goal: 'write',
			role: 'metadata',
			path: '/api/show',
			method: 'POST',
			stage: 'preflight',
		},
		{
			ordinal: 4,
			goal: 'write',
			role: 'agent',
			path: '/api/chat',
			method: 'POST',
			stage: 'execution',
			step: 1,
		},
		{
			ordinal: 5,
			goal: 'read',
			role: 'metadata',
			path: '/api/version',
			method: 'GET',
			stage: 'postflight',
		},
		{
			ordinal: 6,
			goal: 'read',
			role: 'metadata',
			path: '/api/tags',
			method: 'GET',
			stage: 'postflight',
		},
		{
			ordinal: 7,
			goal: 'read',
			role: 'metadata',
			path: '/api/show',
			method: 'POST',
			stage: 'postflight',
		},
	]
	return [
		declaration,
		...identities.flatMap((identity): readonly StudyExchangeRow[] => {
			const request =
				identity.stage === 'execution'
					? body
					: identity.path === '/api/show'
						? JSON.stringify({ model: 'model' })
						: ''
			const reply =
				identity.path === '/api/version'
					? JSON.stringify({ version: declaration.version })
					: identity.path === '/api/tags'
						? JSON.stringify({ models: [{ name: 'model', digest: 'a'.repeat(64) }] })
						: identity.path === '/api/show'
							? JSON.stringify({
									capabilities: ['completion'],
									model_info: { 'general.architecture': 'llama', 'llama.context_length': 8192 },
								})
							: buildOllamaRow({ content: 'remember' })
			const bytes = buildStudyOllamaBytes(Buffer.from(reply))
			return [
				{ ...identity, phase: 'attempt', ...buildStudyOllamaBytes(Buffer.from(request)) },
				{
					...identity,
					phase: 'response',
					status: 200,
					headers: [['content-type', 'application/json']],
					chunks: [bytes.size],
					...bytes,
				},
			]
		}),
		{ phase: 'complete', count: identities.length },
	]
}

/** Builds independent open rows with ordered goals and configurable real sidecar load.
 * @param trial - The trial identity.
 * @param record - The sidecar bounds.
 * @param count - The execution population; Default: 3.
 * @param padding - Request and reply padding bytes; Default: 0.
 * @returns A complete open journal over the fixture's protocol bytes.
 */
export function buildOpenStudyExchangeRows(
	trial = 'r1-first-small',
	record: StudyRecord = { bytes: 32768, calls: 256, duration: 15000 },
	count = 3,
	padding = 0,
): readonly StudyExchangeRow[] {
	const rows = buildStudyExchangeRows(trial, false, record)
	const opening = rows[0]
	const request = rows.find((row) => row.phase === 'attempt' && row.stage === 'execution')
	const response = rows.find((row) => row.phase === 'response' && row.stage === 'execution')
	if (
		opening?.phase !== 'declaration' ||
		request?.phase !== 'attempt' ||
		response?.phase !== 'response'
	)
		throw new Error('Missing independent row fixture')
	const { procedure: _procedure, ...declaration } = opening
	const body =
		padding === 0
			? Buffer.from(request.body, 'base64')
			: Buffer.from(
					JSON.stringify({
						model: 'model',
						prompt: 'x'.repeat(padding),
						options: { num_ctx: 32, num_predict: 8 },
						stream: true,
						think: false,
					}),
				)
	const reply =
		padding === 0
			? Buffer.from(response.body, 'base64')
			: Buffer.from(buildOllamaRow({ content: 'x'.repeat(padding * 3) }))
	return [
		declaration,
		...rows.filter(
			(row) => (row.phase === 'attempt' || row.phase === 'response') && row.stage === 'preflight',
		),
		...Array.from({ length: count }, (_entry, index): readonly StudyExchangeRow[] => {
			const identity: StudyExchangeIdentity = {
				...projectStudyExchangeIdentity(request),
				ordinal: index + 4,
				step: index + 1,
				goal: index === 0 ? 'write' : 'read',
				role: index === 1 ? 'summary' : 'agent',
			}
			return [
				{ ...identity, phase: 'attempt', ...buildStudyOllamaBytes(body) },
				{
					...identity,
					phase: 'response',
					...buildStudyOllamaBytes(reply),
					status: 200,
					headers: response.headers,
					chunks: [reply.length],
				},
			]
		}).flat(),
		...rows.flatMap((row): readonly StudyExchangeRow[] =>
			(row.phase === 'attempt' || row.phase === 'response') && row.stage === 'postflight'
				? [{ ...row, ordinal: row.ordinal + count - 1 }]
				: [],
		),
		{ phase: 'complete', count: count + 6 },
	]
}

/** Produces malformed journals while preserving their otherwise valid independent control.
 * @param rows - The valid declaration and ordered population.
 * @param mutation - The precise refused condition.
 * @returns Exact JSONL bytes, with framing omitted only for the partial case.
 */
export function mutateStudyExchangeRows(
	rows: readonly StudyExchangeRow[],
	mutation: StudyExchangeMutation,
): Uint8Array {
	const attempt = rows.find((row) => row.phase === 'attempt')
	const response = rows.find((row) => row.phase === 'response')
	if (attempt === undefined || response === undefined)
		throw new Error('Missing exchange fixture pair')
	const selected =
		mutation === 'goals' ||
		mutation === 'record' ||
		mutation === 'outside-goal' ||
		mutation === 'backward-goal' ||
		mutation === 'postflight-goal' ||
		mutation === 'count' ||
		mutation === 'failed'
			? rows.map((row): StudyExchangeRow => {
					if (row.phase === 'declaration')
						return mutation === 'goals'
							? { ...row, goals: row.goals.map((goal) => (goal === 'read' ? 'other' : goal)) }
							: mutation === 'record'
								? { ...row, record: { ...row.record, calls: row.record.calls + 1 } }
								: row
					if (row.phase === 'complete')
						return mutation === 'count' ? { ...row, count: row.count - 1 } : row
					if (mutation === 'failed' && row.phase === 'response' && row.stage === 'execution')
						return {
							...projectStudyExchangeIdentity(row),
							phase: 'failure',
							reason: 'Fixture refusal',
						}
					return {
						...row,
						goal:
							mutation === 'goals' && row.goal === 'read'
								? 'other'
								: mutation === 'outside-goal' && row.stage === 'execution'
									? 'outside'
									: mutation === 'backward-goal' && row.step === 3
										? 'write'
										: mutation === 'postflight-goal' && row.stage === 'postflight'
											? 'write'
											: row.goal,
					}
				})
			: mutation === 'missing-response'
				? rows.filter((row) => row.phase !== 'response' || row.stage !== 'execution')
				: mutation === 'missing-metadata'
					? rows.filter((row) => row.phase !== 'response' || row.ordinal !== 2)
					: mutation === 'duplicate'
						? [rows[0], attempt, ...rows.slice(1)]
						: mutation === 'orphan'
							? [rows[0], response, ...rows.slice(1)]
							: mutation === 'open'
								? rows.slice(0, -2)
								: mutation === 'incomplete'
									? rows.filter((row) => row.phase !== 'complete')
									: mutation === 'reversed'
										? [
												rows[0],
												...rows
													.slice(1, -1)
													.reduce<ReadonlyArray<readonly StudyExchangeRow[]>>(
														(pairs, _row, index) =>
															index % 2 === 0
																? [...pairs, rows.slice(index + 1, index + 3)]
																: pairs,
														[],
													)
													.toReversed()
													.flat(),
												rows.at(-1),
											]
										: mutation === 'altered'
											? rows.map((row) =>
													row.phase === 'response' && row.stage === 'execution'
														? { ...row, body: Buffer.from('changed').toString('base64') }
														: row,
												)
											: rows
	return Buffer.from(
		selected.map((row) => JSON.stringify(row)).join('\n') + (mutation === 'partial' ? '' : '\n'),
	)
}

/** Builds a replay history from independent fixture bytes, without the strict reader.
 * @param captured - If true, declares capture admission; if false, declares exact bytes.
 * @returns A complete fixture with a pinned serialized file identity.
 */
export function buildStudyExchangeHistory(captured = false): StudyExchangeHistory {
	const rows = buildStudyExchangeRows('r1-first-small', captured)
	const declaration = rows[0]
	const completion = rows.at(-1)
	if (declaration?.phase !== 'declaration' || completion?.phase !== 'complete')
		throw new Error('Invalid fixture boundary')
	return {
		seal: 'b'.repeat(64),
		file: {
			path: `trials/${declaration.trial}/exchanges.jsonl`,
			bytes: mutateStudyExchangeRows(rows, 'complete').length,
			digest: hashStudyBytes(mutateStudyExchangeRows(rows, 'complete')),
		},
		declaration,
		completion,
		exchanges: rows.flatMap((row, index) => {
			const response = rows[index + 1]
			return row.phase === 'attempt' && response?.phase === 'response'
				? [{ attempt: row, response }]
				: []
		}),
	}
}

/** Reverses paired identities and repins the physical bytes while retaining the original declaration.
 * @returns An internally paired, renumbered but declaratively reordered replay control.
 */
export function buildReversedStudyHistory(): StudyExchangeHistory {
	const history = buildStudyExchangeHistory()
	const exchanges = [...history.exchanges].reverse().map((pair, index) => ({
		attempt: { ...pair.attempt, ordinal: index + 1 },
		response: { ...pair.response, ordinal: index + 1 },
	}))
	const bytes = Buffer.from(
		[
			history.declaration,
			...exchanges.flatMap((pair) => [pair.attempt, pair.response]),
			history.completion,
		]
			.map((row) => JSON.stringify(row) + '\n')
			.join(''),
	)
	return {
		...history,
		exchanges,
		file: { ...history.file, bytes: bytes.length, digest: hashStudyBytes(bytes) },
	}
}

/** Writes a protocol-faithful worker peer that retains its exact opening declaration.
 * @param scratch - The owned peer and receipt directory.
 * @returns The peer entry for a real process driver.
 */
export function writeStudyPreparationPeer(scratch: ScratchInterface): string {
	return scratch.write(
		'preparation-peer.cjs',
		`const fs = require('node:fs')
process.on('message', frame => {
 if (frame.operation === 'open') { fs.writeFileSync(${JSON.stringify(join(scratch.path, 'worker-opening.json'))}, JSON.stringify(frame.value)); process.send({id:frame.id, operation:'reply', value:{pid:process.pid, ...frame.value.identity}}) }
 if (frame.operation === 'close') process.send({id:frame.id, operation:'reply', value:true})
})`,
	)
}

/** Retains independent complete trial evidence with a selectable sidecar refusal control.
 * @param directory - The absent owned result directory.
 * @param mutation - The sidecar mutation; Default: complete.
 * @param recording - If true, declares and reserves recording; if false, leaves the sidecar unrequested.
 * @param sidecar - If true, writes sidecars; if false, leaves them missing.
 * @param open - If true, retains an open sequence; if false, retains the declared control.
 * @returns The real store and manifest after every trial has terminated.
 */
export async function retainStudyExchangeFixture(
	directory: string,
	mutation: StudyExchangeMutation = 'complete',
	recording = true,
	sidecar = true,
	open = false,
): Promise<StudyExchangeCustodyFixture> {
	const manifest = {
		...buildCompactCustodyManifest(),
		...(recording ? { record: { bytes: 16384, calls: 256, duration: 15000 } } : {}),
	}
	const store = new StudyResultStore({ directory, manifest })
	await store.create()
	for (const trial of manifest.schedule) {
		const rows = open
			? buildOpenStudyExchangeRows(trial.id, manifest.record)
			: buildStudyExchangeRows(trial.id, false, manifest.record)
		const declaration = rows[0]
		if (declaration?.phase !== 'declaration') throw new Error('Missing fixture declaration')
		if (recording) await store.exchanges(trial, declaration)
		const sink = await store.start(trial)
		for (const row of rows) {
			if (row.phase === 'attempt' || row.phase === 'response')
				await sink.append({
					event: row.phase === 'attempt' ? 'dispatch' : 'wire',
					goal: row.goal,
					value: { ordinal: row.ordinal, role: row.role, path: row.path },
				})
		}
		if (sidecar)
			await writeFile(
				join(directory, 'execution', 'trials', trial.id, 'exchanges.jsonl'),
				mutateStudyExchangeRows(rows, mutation),
			)
		await store.finish(buildCustodyAttempt(manifest, trial))
	}
	return { store, manifest, directory }
}

/** Writes a real transport consumer whose captured model request can replay in a fresh worker.
 * @param scratch - The owned consumer fixture.
 * @param origin - The loopback Ollama peer.
 * @param library - The built real Study server library admitted as the subject.
 * @param open - If true, declares an open role sequence; if false, keeps the capture-step control.
 */
export function writeStudyRecordingConsumer(
	scratch: ScratchInterface,
	origin: string,
	library: string,
	open = false,
): void {
	writeStudyConsumer(scratch)
	const original = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
	if (!isRecord(original)) throw new Error('Missing recording profile')
	const bounds = {
		request: { duration: 3000, calls: 1, tokens: 8176, bytes: 4096 },
		goal: { duration: 5000, calls: 2, tokens: 16384, bytes: 8192 },
		trial: { duration: 10000, calls: 4, tokens: 32768, bytes: 32768 },
		series: { duration: 20000, calls: 8, tokens: 65536, bytes: 131072 },
	}
	const policy = {
		model: 'model',
		options: { num_ctx: 8192, num_predict: 8 },
		think: false,
		strict: false,
		length: false,
	}
	const body = JSON.stringify({
		model: 'model',
		messages: [{ role: 'user', content: 'remember' }],
		stream: true,
		think: false,
		options: policy.options,
	})
	const summary = { ...policy, options: { ...policy.options, num_predict: 4 } }
	const judge = {
		...policy,
		model: 'judge',
		options: { ...policy.options, num_predict: 1 },
		length: true,
	}
	const requests = [
		{ goal: 'write', role: 'agent', body },
		{
			goal: 'recall',
			role: 'summary',
			body: JSON.stringify({
				model: 'model',
				stream: true,
				think: false,
				options: summary.options,
				messages: [{ role: 'user', content: 'summarize café 🦉' }],
			}),
		},
		{
			goal: 'recall',
			role: 'judge',
			body: JSON.stringify({
				model: 'judge',
				stream: false,
				raw: true,
				logprobs: true,
				options: judge.options,
				prompt: 'A\r\n🦉',
			}),
		},
	]
	scratch.write(
		'studies/files/profiles/local.json',
		JSON.stringify({
			...original,
			bounds,
			room: { ...buildStudyProfile().room, context: 8192, output: 8 },
			subject: library,
			roots: [
				...(isArray(original.roots) ? original.roots : []),
				dirname(dirname(library)),
				...collectStudyRoots(['@orkestrel/ollama']),
			],
			provider: {
				entry: resolveStudyEntry('@orkestrel/ollama'),
				url: origin,
				model: 'model',
				...(open ? { judge: 'judge' } : {}),
				digest: { model: 'a'.repeat(64), ...(open ? { judge: 'b'.repeat(64) } : {}) },
			},
			record: { bytes: 32768, calls: 256, duration: 15000 },
			settings: {
				version: 'fixture-version',
				metadata: { calls: open ? 16 : 8, bytes: 65536, duration: 5000 },
				...(open
					? { roles: { agent: policy, summary, judge }, requests }
					: {
							procedure: [
								{
									admission: 'capture',
									ordinal: 1,
									goal: 'write',
									role: 'agent',
									path: '/api/chat',
									policy,
									bytes: Buffer.byteLength(body),
								},
							],
						}),
				body,
			},
		}),
	)
	scratch.write(
		'studies/files/scenarios/first.json',
		JSON.stringify({
			id: 'first',
			goals: [
				{ id: 'write', input: 'remember' },
				...(open ? [{ id: 'recall', input: 'recall' }] : []),
			],
		}),
	)
	scratch.write(
		'studies/assessment/rubric.json',
		JSON.stringify({
			version: '1',
			criteria: [
				{
					id: 'first-write',
					scenario: 'first',
					goal: 'write',
					method: 'state',
					critical: true,
					assertion: { equals: 'remember' },
				},
				...(open
					? [
							{
								id: 'first-recall',
								scenario: 'first',
								goal: 'recall',
								method: 'state',
								critical: true,
								assertion: { equals: 'recall' },
							},
						]
					: []),
			],
		}),
	)
	scratch.write(
		'studies/files/index.ts',
		`import { appendFileSync } from 'node:fs'
export function createStudyAdapter() { return {
 validate() { appendFileSync(${JSON.stringify(join(scratch.path, 'validations.log'))}, String(process.pid) + '\\n') },
 driver({ subject, provider, profile, exchanges, replay }) { return { async open(trial, signal) {
  appendFileSync(${JSON.stringify(join(scratch.path, 'workers.log'))}, String(process.pid) + '\\n')
  const transport = new subject.StudyOllamaTransport({ url: profile.provider.url, room: profile.room, limit: profile.bounds.request, models: { model: { name: profile.provider.model, digest: profile.provider.digest.model }, ...(profile.provider.judge === undefined ? {} : { judge: { name: profile.provider.judge, digest: profile.provider.digest.judge } }) }, roles: profile.settings.roles ?? { agent: profile.settings.procedure[0].policy }, metadata: profile.settings.metadata, exchanges, signal, observe: false, timing: provider.extractTiming, ...(replay === undefined ? {} : { fetch: replay.fetch }) })
  return {
   async execute(goal, context) {
    transport.prepare({ goal: goal.id, context })
    try {
     if (goal.id === exchanges.declaration.goals[0]) await transport.verify()
     const values = []
     for (const request of (profile.settings.requests ?? [{ goal: 'write', role: 'agent', body: profile.settings.body }]).filter(request => request.goal === goal.id)) {
      const response = await transport.fetch(request.role, profile.provider.url + (request.role === 'judge' ? '/api/generate' : '/api/chat'), { method: 'POST', body: request.body })
      const text = await response.text()
      const row = JSON.parse(text.trim())
      values.push(row.message?.content ?? row.response)
     }
     if (goal.id === exchanges.declaration.goals.at(-1)) await transport.verify()
     transport.check()
     const value = values.join('\\n')
     return { value, partial: false }
    } finally { transport.clear() }
   },
   async close() { await transport.close() }
  }
 } } },
 grade() { return [] }
} }
`,
	)
}

/** Creates an execution consumer with a dedicated protocol daemon and declared process receipts.
 * @param library - The built real Study transport.
 * @param mode - The protocol outcome to exercise.
 * @param open - If true, records agent and summary without declared steps; if false, keeps the capture control.
 * @returns The owned consumer; close releases only its recorded fixture processes.
 */
export async function createStudyDaemonFixture(
	library: string,
	mode = 'normal',
	open = false,
): Promise<StudyDaemonFixture> {
	const scratch = createStudyConsumer()
	try {
		const port = createPortServer()
		await new Promise<void>((fulfill) => port.listen(0, '127.0.0.1', fulfill))
		const address = port.address()
		if (address === null || typeof address === 'string') throw new Error('Missing dedicated port')
		const url = `http://127.0.0.1:${address.port}`
		await new Promise<void>((fulfill, reject) =>
			port.close((error) => (error ? reject(error) : fulfill())),
		)
		writeStudyRecordingConsumer(scratch, url, library, open)
		const original = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
		if (!isRecord(original) || !isRecord(original.provider) || !isRecord(original.settings))
			throw new Error('Missing daemon consumer profile')
		const profile = parseStudyProfile({
			...original,
			settings: {
				...original.settings,
				...(open && isArray(original.settings.requests)
					? {
							requests: original.settings.requests.filter(
								(request) => isRecord(request) && request.role !== 'judge',
							),
						}
					: {}),
				metadata: { calls: 16, bytes: 65536, duration: 20000 },
			},
			bounds: {
				request: { duration: 10000, calls: 1, tokens: 8176, bytes: 4096 },
				goal: { duration: 20000, calls: 2, tokens: 16384, bytes: 8192 },
				trial: { duration: 40000, calls: 4, tokens: 32768, bytes: 32768 },
				series: { duration: 80000, calls: 16, tokens: 131072, bytes: 262144 },
			},
			provider: {
				...original.provider,
				judge: 'judge',
				digest: { model: 'a'.repeat(64), judge: 'b'.repeat(64) },
				daemon: {
					executable: realpathSync(process.execPath),
					digest: hashStudyBytes(readFileSync(process.execPath)),
					version: 'fixture-version',
					environment: {
						NODE_OPTIONS: `--import=${pathToFileURL(resolve('tests/src/server/commands/fixtures/daemon.mjs')).href}`,
						ollama_host: '127.0.0.1:1',
						STUDY_DAEMON_MODE: mode,
						STUDY_DAEMON_PID: join(scratch.path, 'daemon.pid'),
						STUDY_DAEMON_RUNNER: join(scratch.path, 'runner.pid'),
						STUDY_DAEMON_REQUESTS: join(scratch.path, 'daemon-requests.jsonl'),
						STUDY_DAEMON_EVIDENCE: join(
							scratch.path,
							mode === 'normal' ? 'live' : 'result',
							'execution',
							'trials',
						),
					},
					models: [
						{ name: 'model', digest: 'a'.repeat(64) },
						{ name: 'judge', digest: 'b'.repeat(64) },
					],
				},
			},
		})
		scratch.write('studies/files/profiles/local.json', JSON.stringify(profile))
		const definition = parseJSON(scratch.read('studies/assessment/study.json') ?? '')
		if (!isRecord(definition)) throw new Error('Missing daemon study')
		scratch.write(
			'studies/assessment/study.json',
			JSON.stringify({ ...definition, order: [['small'], ['small']] }),
		)
		return {
			scratch,
			profile,
			url,
			async close() {
				await releaseStudyPid(readStudyPid(scratch, 'runner.pid'))
				await releaseStudyPid(readStudyPid(scratch, 'daemon.pid'))
				scratch.destroy()
			},
		}
	} catch (error) {
		scratch.destroy()
		throw error
	}
}

/** Names daemon endings whose real process-tree cleanup the staging proof observes. */
export const STUDY_DAEMON_ENDINGS: readonly string[] = Object.freeze([
	'start-failure',
	'trial-failure',
	'cancel',
	'unload-failure',
])

/** Names the adapter environment changes that must stop a continuation inside its ancestor. */
export const STUDY_CONTINUATION_DIVERGENCES: readonly string[] = Object.freeze(['body', 'extra'])

/** Names complete and interrupted ancestor controls with their admission outcomes. */
export const STUDY_CONTINUATION_SOURCES: readonly StudyContinuationSource[] = Object.freeze([
	{ name: 'unrecorded', recording: false, declared: false, sealed: true, code: 'CONFIG' },
	{ name: 'declared', recording: true, declared: true, sealed: true, code: 'CONFIG' },
	{ name: 'interrupted', recording: true, declared: false, sealed: false, code: 'CUSTODY' },
])

/** Supplies the validation request a task sends to its adapter child. */
export function buildStudyTaskRequest(): StudyTaskRequest {
	return {
		operation: 'validate',
		input: {
			definition: buildStudyDefinition(),
			scenarios: [buildStudyScenario(), buildStudyScenario('second')],
			rubric: buildStudyRubric(),
			profile: buildStudyProfile(),
		},
	}
}

/** Builds the options of a task bound to one adapter entry that reads no package roots.
 * @param entry - The absolute adapter entry, used as both the entry and the adapter.
 * @param duration - The task deadline in milliseconds; Default: 5000.
 * @returns The task options rooted at the workspace.
 */
export function buildStudyTaskOptions(entry: string, duration = 5000): StudyTaskOptions {
	return { entry, root: resolve('.'), adapter: entry, roots: [], duration }
}

/** Builds the options of a session over the first scheduled custody trial.
 * @param scratch - The owned temporary resource holding the worker and the trial directory.
 * @param entry - The absolute worker entry.
 * @param signal - The parent cancellation.
 * @returns The session options bound to the in-memory driver.
 */
export function buildStudySessionOptions(
	scratch: ScratchInterface,
	entry: string,
	signal: AbortSignal,
): StudyProcessSessionOptions {
	const manifest = buildCustodyManifest()
	return {
		entry,
		root: scratch.path,
		directory: scratch.ensure('trials'),
		adapter: scratch.path,
		driver: 'memory',
		profile: { ...buildStudyProfile(), bounds: manifest.bounds, roots: ['dist'] },
		identity: { ...manifest.identity },
		trial: requireValue(manifest.schedule[0]),
		signal,
	}
}

/** Supplies every exported process guard for hostile-boundary proofs. */
export const STUDY_PROCESS_GUARDS = Object.freeze([
	isStudyFrame,
	isStudyProcessFailure,
	isStudyCharge,
	isStudyEvidence,
	isStudyTrial,
	isStudyIdentity,
])

/** Supplies distinct native package roots with one shared package name and different module bytes. */
export const ARTIFACT_NATIVE_FILES = Object.freeze({
	'subject/package.json':
		'{"name":"same-name","version":"1.0.0","type":"module","exports":"./dist/index.js"}\n',
	'subject/dist/index.js': 'export const value = 11\n',
	'subject/node_modules/same-name/package.json':
		'{"name":"same-name","version":"1.0.0","type":"module","exports":"./dist/index.js"}\n',
	'subject/node_modules/same-name/dist/index.js':
		"import { writeFileSync } from 'node:fs'; writeFileSync(new URL('../evaluated.txt', import.meta.url), 'installed'); export const value = 22\n",
	'subject/node_modules/provider/package.json':
		'{"name":"provider","version":"1.0.0","type":"module","exports":"./dist/index.js","dependencies":{"same-name":"1.0.0"}}\n',
	'subject/node_modules/provider/dist/index.js': "export { value } from 'same-name'\n",
})

/** Supplies a physical forest with duplicate package copies, source modules, and exact asset bytes. */
export const ARTIFACT_CLOSURE_FILES = Object.freeze({
	...ARTIFACT_NATIVE_FILES,
	'subject/node_modules/same-name/dist/index.js': 'export const value = 22\n',
	'subject/studies/adapter/index.ts': 'export const value: number = 7\n',
	'subject/studies/adapter/helper.ts': 'export const helper: number = 3\n',
	'subject/studies/adapter/caf\u00e9/e\u0301.txt': '\ufeffline\r\n\ud83d\ude00 ',
	'subject/studies/adapter/rubric.json': '{"value":9}\n',
	'subject/assets/custody.js': 'export const value = 9\n',
})

/** Supplies benign credential-like segments and their uppercase controls. */
export const ARTIFACT_BENIGN_NAMES = Object.freeze([
	'monkey',
	'keyboard',
	'tokenizer',
	'hotkeys',
	'run-aKeY9x',
	'run-aToKeN9x',
	'.environment',
	'.envoy',
	'.npmrc-copy',
	'auth.json.bak',
	'identity.key.txt',
	'certificate.pem.txt',
	'id_rsa.pub',
	'id_dsa.pub',
	'id_ecdsa.pub',
	'id_ed25519.pub',
	'api-tokens.txt',
	'pretoken.json',
	'tokenized',
])

/** Supplies inert credential names without creating credential fixtures. */
export const ARTIFACT_CREDENTIAL_NAMES = Object.freeze([
	'.env',
	'.env.local',
	'.env.production.local',
	'.npmrc',
	'auth.json',
	'identity.key',
	'identity.pem',
	'identity.p12',
	'identity.pfx',
	'.key',
	'.pem',
	'.p12',
	'.pfx',
	'id_rsa',
	'id_dsa',
	'id_ecdsa',
	'id_ed25519',
	'token',
	'token.json',
	'api-token.txt',
	'.token',
	'api_token.txt',
	'token-cache',
])

/** Supplies inert credential and unsafe keys; no credential fixture is opened. */
export const ARTIFACT_REFUSED_KEYS = Object.freeze([
	'../outside',
	'C:/outside',
	'part\\outside',
	'CON.txt',
	'trail.',
	'x//y',
	'x/./y',
	...ARTIFACT_CREDENTIAL_NAMES,
])

/** Names the distinct populations that a copied census must retain. */
export const ARTIFACT_MEMBER_SUFFIXES = Object.freeze([
	'helper.ts',
	'same-name/dist/index.js',
	'e\u0301.txt',
])

/** Selects the duplicate package forest and its custody-only Unicode asset.
 * @param scratch - The scratch seeded with the closure files.
 * @returns Canonical package, source, and asset selections.
 */
export function buildArtifactClosureOptions(scratch: ScratchInterface): ArtifactLoaderOptions {
	const subject = join(scratch.path, 'subject')
	return {
		entries: [
			join(subject, 'dist', 'index.js'),
			join(subject, 'node_modules', 'provider', 'dist', 'index.js'),
		],
		roots: [
			subject,
			join(subject, 'node_modules', 'same-name'),
			join(subject, 'node_modules', 'provider'),
		],
		source: {
			root: join(subject, 'studies', 'adapter'),
			entry: join(subject, 'studies', 'adapter', 'index.ts'),
		},
		assets: [join(subject, 'studies', 'adapter', 'caf\u00e9', 'e\u0301.txt')],
	}
}

/** Writes a native child entry that loads the source library before driving artifacts.
 * @param scratch - The owned temporary resource.
 * @param body - The child's assertions and selected artifact operations.
 * @returns The absolute child entry path.
 */
export function createArtifactWorker(scratch: ScratchInterface, body: string): string {
	const library = new URL('../src/', import.meta.url).href
	return scratch.write(
		'worker.mts',
		`import { registerHooks } from 'node:module'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
registerHooks({ resolve(specifier, context, next) {
 if (context.parentURL?.startsWith(${JSON.stringify(library)}) && specifier === '@src/core') return next(${JSON.stringify(new URL('core/index.ts', library).href)}, context)
 if (context.parentURL?.startsWith(${JSON.stringify(library)}) && (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) return next(new URL(specifier.slice(0, -3) + '.ts', context.parentURL).href, context)
 return next(specifier, context)
} })
const { ArtifactLoader } = await import(${JSON.stringify(`${library}server/artifacts/ArtifactLoader.ts`)})
${body}
`,
	)
}

/** Forks a scripted protocol peer whose exit the fixture bounds on release.
 * @param scratch - The owned temporary resource holding the peer source.
 * @param source - The CommonJS peer program.
 * @returns The live peer and its bounded release.
 */
export function createStudyPeer(scratch: ScratchInterface, source: string): StudyPeerFixture {
	const child = fork(scratch.write('peer.cjs', source), [], {
		execArgv: [],
		silent: true,
		windowsHide: true,
	})
	return Object.freeze({
		child,
		async close(): Promise<void> {
			if (child.exitCode !== null || child.signalCode !== null) return
			const exited = waitForEvent(
				(listener: () => void) => {
					child.once('close', listener)
					return () => {
						child.off('close', listener)
					}
				},
				'study peer exit',
				{ budget: 2000 },
			)
			child.kill()
			await exited
		},
	})
}

/** Spawns a finite Node child that runs one inline program with piped output.
 * @param source - The CommonJS program the child evaluates.
 * @returns The live child; the caller subscribes before any of its events can fire.
 */
export function spawnStudyScript(source: string): ChildProcess {
	return spawn(process.execPath, ['-e', source], {
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
	})
}

/** Supplies the instrument identity a valid fixture adapter answers with. */
export const STUDY_TASK_INSTRUMENT = 'a'.repeat(64)

/** Exercises the task's duration refusals before any process starts. */
export const STUDY_TASK_INVALID_DURATIONS = [0, STUDY_TASK_DURATION + 1, Number.NaN] as const

/** Pairs adapter response populations with their expected operational refusal. */
export const STUDY_TASK_RESPONSES = [
	{ mode: 'valid', expected: undefined },
	{ mode: 'malformed', expected: 'Adapter response is malformed' },
	{ mode: 'repeated', expected: 'Adapter response is oversized or repeated' },
	{ mode: 'combined-output', expected: 'Adapter output exceeds the log allowance' },
] as const

/** Exercises native deadline and caller-cancellation termination. */
export const STUDY_TASK_STOPS = ['deadline', 'abort'] as const

/** Names the scratch file where a task adapter records its pid. */
export const STUDY_TASK_PID = 'task-pid.txt'

/** Writes a finite adapter that records its pid on its first request and answers by mode.
 * @param scratch - The owned temporary resource holding the adapter and its pid record.
 * @param mode - How the adapter answers; a held adapter never answers.
 * @returns The absolute adapter entry path.
 */
export function writeStudyTaskAdapter(scratch: ScratchInterface, mode: StudyTaskMode): string {
	const instrument = JSON.stringify(STUDY_TASK_INSTRUMENT)
	return scratch.write(
		`adapter-${mode}.cjs`,
		`const fs = require('node:fs')
setTimeout(() => process.exit(0), 20000)
process.on('message', () => {
 fs.writeFileSync(${JSON.stringify(join(scratch.path, STUDY_TASK_PID))}, String(process.pid))
 const mode = ${JSON.stringify(mode)}
 if (mode === 'valid') process.send({instrument:${instrument},value:true})
 if (mode === 'malformed') process.send({instrument:'invalid',value:true})
 if (mode === 'repeated') { process.send({instrument:${instrument},value:true}); process.send({instrument:${instrument},value:'second'}) }
 if (mode === 'combined-output') { process.stdout.write('x'.repeat(40000)); process.stderr.write('y'.repeat(40000)) }
})`,
	)
}

/** Writes a finite adapter and binds a task to it, recording the adapter pid on its first request.
 * @param scratch - The owned temporary resource holding the adapter and its pid record.
 * @param mode - How the adapter answers; a held adapter never answers.
 * @param duration - The task deadline in milliseconds.
 * @returns The task and the scratch path of the recorded pid.
 */
export function createStudyTaskFixture(
	scratch: ScratchInterface,
	mode: StudyTaskMode,
	duration: number,
): StudyTaskFixture {
	return Object.freeze({
		task: new StudyTask(buildStudyTaskOptions(writeStudyTaskAdapter(scratch, mode), duration)),
		pid: STUDY_TASK_PID,
	})
}

/** Writes a finite root that leaves a detached leaf holding its inherited output after the root exits.
 *
 * The root exits on its own deadline when no IPC message arrives. On its first IPC message it
 * spawns the leaf with inherited stdout and stderr and an IPC readiness handshake; only after
 * readiness does it record both pids atomically and exit.
 * @param scratch - The owned temporary resource holding the scripts and the pid receipt.
 * @param lifetime - The leaf's natural lifetime in milliseconds.
 * @returns The absolute root entry path.
 */
export function writeStudyOrphan(scratch: ScratchInterface, lifetime: number): string {
	const leaf = scratch.write(
		'orphan-leaf.cjs',
		`setTimeout(() => process.exit(0), ${String(lifetime)})
process.send({ ready: true })`,
	)
	const receipt = scratch.ensure('orphan')
	return scratch.write(
		'orphan-root.cjs',
		`const { spawn } = require('node:child_process')
const fs = require('node:fs')
setTimeout(() => process.exit(0), 20000)
process.once('message', () => {
 const leaf = spawn(process.execPath, [${JSON.stringify(leaf)}], { detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true })
 leaf.once('message', () => {
  fs.writeFileSync(${JSON.stringify(join(receipt, 'pids.tmp'))}, JSON.stringify({ root: process.pid, leaf: leaf.pid }))
  fs.renameSync(${JSON.stringify(join(receipt, 'pids.tmp'))}, ${JSON.stringify(join(receipt, 'pids.json'))})
  process.exit(0)
 })
})`,
	)
}

/** Reads the pid a fixture process recorded.
 * @param scratch - The owned temporary resource.
 * @param path - The scratch path of the pid record.
 * @returns The recorded pid, or undefined before a valid record exists.
 */
export function readStudyPid(scratch: ScratchInterface, path: string): number | undefined {
	const pid = Number(scratch.read(path))
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

/** Reads the atomic receipt of a fixture orphan.
 * @param scratch - The owned temporary resource holding the receipt.
 * @returns Both recorded pids, or undefined before the receipt exists.
 */
export function readStudyOrphan(scratch: ScratchInterface): StudyOrphanReceipt | undefined {
	const text = scratch.read('orphan/pids.json')
	if (text === undefined) return undefined
	const value: unknown = JSON.parse(text)
	if (!isRecord(value) || !isInteger(value.root) || !isInteger(value.leaf)) return undefined
	return { root: value.root, leaf: value.leaf }
}

/** Kills exactly one recorded fixture process and awaits its exit.
 * @param pid - The recorded pid; absent when nothing was recorded.
 */
export async function releaseStudyPid(pid: number | undefined): Promise<void> {
	if (pid === undefined || !isRunning(pid)) return
	try {
		// Fixture processes record their own pid and spawn no descendants of their own.
		process.kill(pid, 'SIGKILL')
	} catch {
		// The process may have exited between the liveness read and the kill.
	}
	await waitForCondition(`recorded fixture process ${String(pid)} stopped`, () => !isRunning(pid), {
		budget: 3000,
		interval: 10,
	})
}

/** Names the scratch file where a launcher entry records its pid. */
export const STUDY_LAUNCHER_PID = 'launcher-pid.txt'

/** Names the scratch file where a launcher entry appends each command it receives. */
export const STUDY_LAUNCHER_LOG = 'launcher-commands.log'

/** Supplies the execution fingerprint a fixture check answers with. */
export const STUDY_CHECK_FINGERPRINT = 'a'.repeat(64)

/** Selects a finite offline command in launcher fixtures. */
export const STUDY_CHECK_ARGUMENTS = ['check', 'files', '--profile', 'local'] as const

/** Selects the supervised execution path in launcher fixtures. */
export const STUDY_EXECUTE_ARGUMENTS = ['execute', 'files', '--profile', 'local'] as const

/** Writes a finite command entry that records its pid and command before running a body.
 *
 * The body runs after the records and sees `command`, the first command token, and
 * `finish(code, text)`, which clears the natural deadline, writes the optional text, and exits.
 * @param scratch - The owned temporary resource holding the entry and its records.
 * @param lifetime - The entry's natural lifetime in milliseconds.
 * @param body - The CommonJS statements the entry runs; an empty body holds until its lifetime ends.
 * @returns The absolute entry path.
 */
export function writeStudyLauncherEntry(
	scratch: ScratchInterface,
	lifetime: number,
	body: string,
): string {
	const pid = join(scratch.path, STUDY_LAUNCHER_PID)
	return scratch.write(
		'launcher-entry.cjs',
		`const fs = require('node:fs')
const command = process.argv[3]
const lifetime = setTimeout(() => process.exit(0), ${String(lifetime)})
function finish(code, text) { clearTimeout(lifetime); if (text === undefined) process.exit(code); else process.stdout.write(text, () => process.exit(code)) }
fs.appendFileSync(${JSON.stringify(join(scratch.path, STUDY_LAUNCHER_LOG))}, process.argv.slice(3).join(' ') + '\\n')
fs.writeFileSync(${JSON.stringify(`${pid}.tmp`)}, String(process.pid))
fs.renameSync(${JSON.stringify(`${pid}.tmp`)}, ${JSON.stringify(pid)})
${body}
`,
	)
}

/** Builds the text a fixture check prints for a valid profile.
 * @param duration - The series duration, in milliseconds, the reply declares.
 * @returns The JSON reply carrying the bounds and the fixture fingerprint.
 */
export function buildStudyCheckReply(duration: number): string {
	const bounds = buildStudyProfile().bounds
	return JSON.stringify({
		bounds: { ...bounds, series: { ...bounds.series, duration } },
		fingerprint: STUDY_CHECK_FINGERPRINT,
	})
}

/** Writes a finite command entry that answers check with a valid reply and exits 0 for any command.
 * @param scratch - The owned temporary resource holding the entry and its records.
 * @param duration - The series duration, in milliseconds, the check reply declares.
 * @returns The absolute entry path.
 */
export function writeStudyCheckEntry(scratch: ScratchInterface, duration: number): string {
	return writeStudyLauncherEntry(
		scratch,
		20000,
		`finish(0, command === 'check' ? ${JSON.stringify(buildStudyCheckReply(duration))} : undefined)`,
	)
}

/** Selects the launch whose check holds before it answers in overlapping-launch fixtures. */
export const STUDY_HOLD_ARGUMENTS = ['execute', 'files', '--profile', 'hold'] as const

/** Selects the launch whose check overflows the host output allowance in overlapping-launch fixtures. */
export const STUDY_BURST_ARGUMENTS = ['execute', 'files', '--profile', 'burst'] as const

/** Writes a command entry whose check outcome follows the profile it was asked to check.
 *
 * A check for profile `burst` prints one byte past the host output allowance. A check for any other
 * profile holds briefly, then answers with a valid reply. Any other command exits 0.
 * @param scratch - The owned temporary resource holding the entry and its records.
 * @returns The absolute entry path.
 */
export function writeStudyBurstEntry(scratch: ScratchInterface): string {
	return writeStudyLauncherEntry(
		scratch,
		20000,
		`if (command !== 'check') finish(0)
else if (process.argv[6] === 'burst') process.stdout.write(Buffer.alloc(${String(STUDY_LAUNCH_BYTES + 1)}), () => finish(0))
else setTimeout(() => finish(0, ${JSON.stringify(buildStudyCheckReply(60000))}), 1200)`,
	)
}

/** Reads the commands a launcher entry received, in arrival order.
 * @param scratch - The owned temporary resource holding the entry's records.
 * @returns Each received command as its space-joined tokens.
 */
export function readStudyCommands(scratch: ScratchInterface): readonly string[] {
	return (scratch.read(STUDY_LAUNCHER_LOG) ?? '').split(/\r\n|\n/).filter((line) => line !== '')
}

/** Writes an isolated wrapper that interrupts a built launcher once its command entry is ready.
 *
 * The wrapper emits the interruption inside its own process, waits for the entry's pid record
 * through a directory watch, and prints the launcher's exit code.
 * @param scratch - The owned temporary resource holding the wrapper and the entry's records.
 * @param library - The built server library entry that exports the launcher.
 * @param entry - The command entry the launcher supervises.
 * @param tokens - The public command tokens the launcher executes.
 * @returns The absolute wrapper path.
 */
export function writeStudyInterruptor(
	scratch: ScratchInterface,
	library: string,
	entry: string,
	tokens: readonly string[],
): string {
	return scratch.write(
		'interruptor.mjs',
		`import { existsSync, watch } from 'node:fs'
import { StudyLauncher } from ${JSON.stringify(pathToFileURL(library).href)}
const ready = new Promise((resolve) => {
 const watcher = watch(${JSON.stringify(scratch.path)}, () => {
  if (!existsSync(${JSON.stringify(join(scratch.path, STUDY_LAUNCHER_PID))})) return
  watcher.close()
  resolve()
 })
})
const running = new StudyLauncher({ root: ${JSON.stringify(scratch.path)}, entry: ${JSON.stringify(entry)} }).execute(${JSON.stringify(tokens)})
await ready
process.emit('SIGINT')
const code = await running
process.stdout.write(String(code) + '\\n', () => process.exit(0))
`,
	)
}

/**
 * Builds supplied neutral labels for a real sealed semantic packet.
 * @param result - The sealed fixture execution
 * @param rubric - The independently retained rubric
 * @param labeler - The supplied accountable labeler; Default: human-v1
 * @returns Original imported neutral labels ready for exact-byte custody
 */
export function buildCustodyPacketLabeling(
	result: StudySealedResult,
	rubric: StudyRubric,
	labeler = 'human-v1',
): StudyLabeling {
	const original = buildCustodyLabeling(result, labeler)
	const packet = buildStudyPacket(result, rubric, hashStudyBytes(encodeStudyJSON(rubric)))
	const link = buildStudyPacketLinks(result, rubric).find(
		(entry) =>
			entry.source.trial === original.judgments[0]?.trial &&
			entry.source.criterion === original.judgments[0]?.criterion,
	)
	if (packet === undefined || link === undefined) throw new Error('Missing semantic packet fixture')
	return {
		...original,
		packet: hashStudyBytes(packet.content),
		judgments: original.judgments.map((judgment) => ({
			...judgment,
			trial: link.trial,
			criterion: link.criterion,
		})),
	}
}

/** Supplies the one evidence row a retained fixture trial holds by default. */
export const STUDY_FIXTURE_ROWS: readonly StudyEvidence[] = Object.freeze([
	{ event: 'saved', goal: 'write', value: 'remember' },
])

/**
 * Retains a complete fixture through the real append-only execution store.
 * @param directory - The nonexistent result directory inside an owned scratch resource
 * @param manifest - The execution declaration; Default: a fresh custody manifest
 * @param rows - The evidence rows appended to every trial in order; Default: one saved write row
 * @returns The independently verified sealed execution
 */
export async function retainStudyFixture(
	directory: string,
	manifest: StudyManifest = buildCustodyManifest(),
	rows: readonly StudyEvidence[] = STUDY_FIXTURE_ROWS,
): Promise<StudySealedResult> {
	const results = new StudyResultStore({ directory, manifest })
	await results.create()
	for (const trial of manifest.schedule) {
		const sink = await results.start(trial)
		for (const row of rows) await sink.append(row)
		await results.finish(buildCustodyAttempt(manifest, trial))
	}
	await results.seal()
	const reading = await readStudyResult(directory)
	if (reading.status !== 'sealed') throw new Error('Fixture execution did not seal')
	return reading
}

/**
 * Builds the grading input over an inert declaration, its attempts and its evidence.
 * @param manifest - The declaration; Default: the compact custody manifest
 * @param attempts - The retained terminal records; Default: one complete record per scheduled trial
 * @param evidence - The retained rows keyed by trial; Default: none
 * @returns The adjudication paired with the predicate rubric
 */
export function buildStudyAdjudication(
	manifest: StudyManifest = buildCompactCustodyManifest(),
	attempts: readonly StudyAttempt[] = manifest.schedule.map((trial) =>
		buildCustodyAttempt(manifest, trial),
	),
	evidence: Readonly<Record<string, readonly StudyEvidence[]>> = {},
): StudyAdjudication {
	return { manifest, rubric: STUDY_PREDICATE_RUBRIC, attempts, evidence }
}

/**
 * Reads the grading input of a sealed execution through the real custody evidence reader.
 * @param result - The independently verified sealed execution
 * @returns The adjudication over its retained attempts and evidence rows
 */
export async function readStudyAdjudication(result: StudySealedResult): Promise<StudyAdjudication> {
	return buildStudyAdjudication(
		result.manifest,
		result.attempts,
		await collectStudyEvidence(result),
	)
}

/**
 * Builds an inert sealed reading over supplied attempts for report computation.
 * @param attempts - The terminal records the report partitions
 * @param manifest - The declaration the attempts belong to; Default: a fresh custody manifest
 * @returns A sealed reading with an empty inventory, never written to custody
 */
export function buildStudyReportResult(
	attempts: readonly StudyAttempt[],
	manifest: StudyManifest = buildCustodyManifest(),
): StudySealedResult {
	return {
		status: 'sealed',
		directory: '',
		manifest,
		attempts,
		seal: { result: manifest.id, id: 'e'.repeat(64), files: [] },
	}
}

/**
 * Builds complete predicate judgments while preserving unknown semantic grades.
 * @param result - The verified execution
 * @param rubric - The independently held rubric
 * @param labels - The optional imported semantic labels
 * @returns The complete grading bound to exact imported bytes
 */
export function buildCustodyGrading(
	result: StudySealedResult,
	rubric: StudyRubric = buildStudyRubric(),
	labels?: StudyLabeling,
): StudyGrading {
	return {
		result: result.seal.id,
		rubric: hashStudyBytes(encodeStudyJSON(rubric)),
		grader: 'predicate',
		instrument: 'b'.repeat(64),
		attempts: result.manifest.schedule.map((trial) => trial.id),
		labels: labels === undefined ? undefined : hashStudyBytes(encodeStudyJSON(labels)),
		judgments: result.manifest.schedule.flatMap((trial) =>
			rubric.criteria
				.filter((criterion) => criterion.scenario === trial.scenario)
				.map((criterion) => {
					const imported = labels?.judgments.find(
						(judgment) => judgment.trial === trial.id && judgment.criterion === criterion.id,
					)
					if (imported !== undefined) return imported
					return {
						trial: trial.id,
						criterion: criterion.id,
						verdict: criterion.method === 'semantic' ? 'unknown' : 'achieved',
						method: criterion.method === 'semantic' ? 'human' : criterion.method,
						reason:
							criterion.method === 'semantic'
								? 'No imported semantic labels'
								: 'Recorded fixture state',
						references:
							criterion.method === 'semantic' ? [] : [`trials/${trial.id}/evidence.jsonl#1`],
					}
				}),
		),
	}
}

/**
 * Builds an attributable imported semantic judgment without a generated timestamp.
 * @param result - The sealed execution supplying a scheduled trial
 * @param labeler - The supplied accountable labeler
 * @returns The inert labels artifact
 */
export function buildCustodyLabeling(
	result: StudySealedResult,
	labeler = 'human-v1',
): StudyLabeling {
	const trial = result.manifest.schedule[0]
	if (trial === undefined) throw new Error('Fixture has no trial')
	return {
		packet: result.seal.id,
		labeler,
		version: '1',
		created: '2026-10-14T12:00:00.000Z',
		usage: [],
		judgments: [
			{
				trial: trial.id,
				criterion: `${trial.scenario}-read`,
				verdict: 'achieved',
				method: 'human',
				reason: 'Supplied relevant recall label',
				references: [`trials/${trial.id}/attempt.json`],
			},
		],
	}
}

/** Supplies a rubric whose criteria exercise a whole-attempt predicate, a retained-row predicate and a semantic label for each scenario. */
export const STUDY_PREDICATE_RUBRIC: StudyRubric = Object.freeze({
	version: '1',
	criteria: Object.freeze(
		['first', 'second'].flatMap((scenario): readonly StudyCriterion[] => [
			{
				id: `${scenario}-operational`,
				scenario,
				goal: 'write',
				method: 'state',
				critical: true,
				assertion: { observation: 'operational' },
			},
			{
				id: `${scenario}-saved`,
				scenario,
				goal: 'write',
				method: 'trace',
				critical: false,
				assertion: { observation: 'saved', equals: 'remember' },
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
	),
})

/**
 * Builds an inert predicate shaped like the memory consumer's grading policy.
 * @returns A predicate that requires whole-attempt success for the operational assertion, cites the first matching row for an event assertion, and leaves semantic criteria unknown
 */
export function createStudyAttemptGrade(): StudyGradeFunction {
	return ({ criterion, attempt, evidence }) => {
		if (criterion.method === 'semantic')
			return {
				verdict: 'unknown',
				method: 'human',
				reason: 'Requires an independent blind semantic label',
				references: [],
			}
		const assertion = criterion.assertion
		const observation = attempt?.observations.find((entry) => entry.goal === criterion.goal)
		if (attempt === undefined || observation === undefined || !isRecord(assertion))
			return {
				verdict: 'unknown',
				method: criterion.method,
				reason: 'No retained observation for the declared mechanism',
				references: [],
			}
		const complete = observation.failure === undefined && observation.product !== undefined
		if (assertion.observation === 'operational')
			return {
				verdict: complete && attempt.failure === undefined ? 'achieved' : 'unsuccessful',
				method: criterion.method,
				reason: 'Retained observable mechanism evidence',
				references: [{ file: 'attempt' }],
			}
		const row = evidence.findIndex(
			(entry) => entry.goal === criterion.goal && entry.event === assertion.observation,
		)
		if (row >= 0)
			return {
				verdict: 'achieved',
				method: criterion.method,
				reason: 'Retained observable mechanism evidence',
				references: [{ file: 'evidence', row }],
			}
		return complete
			? {
					verdict: 'unsuccessful',
					method: criterion.method,
					reason: 'Retained observable mechanism evidence',
					references: [{ file: 'attempt' }, { file: 'evidence' }],
				}
			: {
					verdict: 'unknown',
					method: criterion.method,
					reason: 'No retained observation for the declared mechanism',
					references: [],
				}
	}
}

/**
 * Builds one retained saved-evidence row of the declared write goal.
 * @param value - The observed value the row carries
 * @returns The retained evidence row
 */
export function buildStudyEvidenceRow(value: string): StudyEvidence {
	return { event: 'saved', goal: 'write', value }
}

/**
 * Builds typed evidence arrays whose retained positions are absent rather than undefined rows.
 * @returns A lone absent slot, an absent tail after one row, and an absent interior between two rows
 */
export function buildStudySparseEvidence(): StudySparseEvidence {
	const lone = new Array<StudyEvidence>(1)
	const tail = new Array<StudyEvidence>(2)
	tail[0] = buildStudyEvidenceRow('a')
	const interior = new Array<StudyEvidence>(3)
	interior[0] = buildStudyEvidenceRow('a')
	interior[2] = buildStudyEvidenceRow('c')
	return { lone, tail, interior }
}

/** Values a hostile untyped caller may supply where a grading reference record belongs. */
export const STUDY_HOSTILE_REFERENCES: readonly unknown[] = Object.freeze([
	null,
	undefined,
	'evidence',
	1,
	[],
])

/**
 * Builds an inert predicate shaped like the tools consumer's grading policy.
 * @returns A predicate that reads the latest retained row of a goal's declared event against the criterion's expected value, and leaves unretained trials unknown
 */
export function createStudyRowGrade(): StudyGradeFunction {
	return ({ criterion, evidence }) => {
		const assertion = criterion.assertion
		if (criterion.method === 'semantic' || !isRecord(assertion))
			return {
				verdict: 'unknown',
				method: 'human',
				reason: 'Requires an independent blind semantic label',
				references: [],
			}
		const row = evidence.findLastIndex(
			(entry) => entry.goal === criterion.goal && entry.event === assertion.observation,
		)
		if (row === -1)
			return {
				verdict: 'unknown',
				method: criterion.method,
				reason: 'No retained observation for the declared predicate',
				references: [],
			}
		return {
			verdict: evidence[row]?.value === assertion.equals ? 'achieved' : 'unsuccessful',
			method: criterion.method,
			reason: 'Retained observation is compared with the independent predicate',
			references: [{ file: 'evidence', row }],
		}
	}
}

/** Builds the actual installed CLI route in an exclusively owned package fixture.
 * @param scratch - The owned temporary consumer and runtime package.
 * @returns The actual built executable.
 */
export async function buildStudyCLI(scratch: ScratchInterface): Promise<string> {
	const output = scratch.ensure('runtime/dist/bin')
	const core = scratch.ensure('runtime/dist/src/core')
	const server = scratch.ensure('runtime/dist/src/server')
	scratch.write(
		'runtime/package.json',
		JSON.stringify({ name: '@orkestrel/study', version: '0.0.0-runtime', type: 'module' }),
	)
	await build({
		...srcCore({
			plugins: [outputBoundary(relative(resolve('.'), core).replaceAll('\\', '/'))],
			build: {
				outDir: core,
				lib: { entry: resolve('src/core/index.ts'), formats: ['es'] },
				rolldownOptions: {
					external: (id) => resolveExternal(id, { peers, refused: [], siblings: [] }),
					output: { entryFileNames: 'index.js' },
				},
			},
		}),
		configFile: false,
		logLevel: 'warn',
	})
	await build({
		...srcServer({
			plugins: [outputBoundary(relative(resolve('.'), server).replaceAll('\\', '/'))],
			build: { outDir: server },
		}),
		configFile: false,
		logLevel: 'warn',
	})
	await build({
		...mergeOverride(binConfig, {
			plugins: [outputBoundary(relative(resolve('.'), output).replaceAll('\\', '/'))],
			build: {
				outDir: output,
			},
		}),
		configFile: false,
		logLevel: 'warn',
	})
	return join(output, 'main.js')
}

/** Builds the actual library source as a separate admitted package, as a consumer would import it.
 * @param scratch - The owned temporary package parent inside the workspace.
 * @param source - The real source entry; Default: the core library.
 * @returns The built library entry under the package's dist directory.
 */
export async function buildStudyLibrary(
	scratch: ScratchInterface,
	source = resolve('src/core/index.ts'),
): Promise<string> {
	const output = scratch.ensure('library/dist')
	scratch.write(
		'library/package.json',
		JSON.stringify({ name: 'study-library', version: '0.0.1', type: 'module' }),
	)
	await build({
		...srcCore({
			plugins: [outputBoundary(relative(resolve('.'), output).replaceAll('\\', '/'))],
			build: {
				outDir: output,
				emptyOutDir: false,
				sourcemap: false,
				lib: { entry: source, formats: ['es'] },
				rolldownOptions: {
					platform: 'node',
					external: isBuiltin,
					output: { entryFileNames: 'index.js' },
				},
			},
		}),
		configFile: false,
		logLevel: 'warn',
	})
	return join(output, 'index.js')
}

/** Admits a separately built library package to a written consumer's local profile roots.
 * @param consumer - The consumer `writeStudyConsumer` wrote.
 * @param library - The scratch `buildStudyLibrary` built its package under.
 */
export function admitStudyLibrary(consumer: ScratchInterface, library: ScratchInterface): void {
	const profile = parseJSON(consumer.read('studies/files/profiles/local.json') ?? '')
	if (!isRecord(profile) || !isArray(profile.roots)) throw new Error('Missing consumer profile')
	consumer.write(
		'studies/files/profiles/local.json',
		JSON.stringify({ ...profile, roots: [...profile.roots, join(library.path, 'library')] }),
	)
}

/** Drives the real CLI with a finite native command cap.
 * @param entry - The built runtime entry.
 * @param root - The selected consumer working directory.
 * @param tokens - Public CLI arguments.
 * @returns Truthful native exit and all command output.
 */
export function executeStudyCLI(
	entry: string,
	root: string,
	tokens: readonly string[],
): Promise<StudyLaunchResult> {
	return new Promise((complete) =>
		execFile(
			process.execPath,
			[entry, ...tokens],
			{ cwd: root, windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) =>
				complete({
					code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
					output: error === null ? stdout : stdout + stderr,
				}),
		),
	)
}

/** Writes one installed Agent runtime package whose entry records each evaluation.
 * @param scratch - The owned temporary consumer.
 * @param name - The package directory and log name.
 * @param marker - The value the entry exports so a driver can tell which occurrence it received.
 * @returns The package root, built entry, and evaluation log path.
 */
export function writeStudyAgent(
	scratch: ScratchInterface,
	name: string,
	marker: string,
): StudyAgentFixture {
	const log = join(scratch.path, `${name}.log`)
	scratch.write(
		`${name}/package.json`,
		JSON.stringify({ name: 'fixture-agent', version: '1.0.0', type: 'module' }),
	)
	const entry = scratch.write(
		`${name}/dist/index.js`,
		`import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(log)}, String(process.pid)+'\\n'); export const marker = ${JSON.stringify(marker)};`,
	)
	return { root: join(scratch.path, name), entry, log }
}

/** Reads the agent identity and fingerprint from a supervisor check's printed report.
 * @param output - The check command's standard output.
 * @returns The printed agent identity and execution fingerprint.
 */
export function readStudyCheck(output: string): StudyCheckReading {
	const value = parseJSON(output)
	if (
		!isRecord(value) ||
		!isRecord(value.identity) ||
		typeof value.identity.agent !== 'string' ||
		typeof value.fingerprint !== 'string'
	)
		throw new Error(`Missing check identity: ${output}`)
	return { agent: value.identity.agent, fingerprint: value.fingerprint }
}

/** Creates an owned scratch after creating its parent directories.
 * @param parent - The directory in which to allocate the scratch.
 * @param prefix - The name fragment that starts the allocated directory name.
 * @returns The owned scratch; the caller destroys it.
 * @example
 * const scratch = createStudyScratch(resolve('tmp/units'), 'study-')
 * scratch.destroy()
 */
export function createStudyScratch(parent: string, prefix: string): ScratchInterface {
	mkdirSync(parent, { recursive: true })
	return createScratch({ parent, prefix })
}

/** Creates an owned temporary consumer holding the real file-operation adapter and subject package.
 * @param write - Writes the consumer into the scratch; Default: the real file-operation adapter and subject package.
 * @returns The consumer scratch; the caller destroys it.
 * @throws Error - Thrown when the writer fails, after the scratch is destroyed.
 */
export function createStudyConsumer(
	write: (scratch: ScratchInterface) => void = writeStudyConsumer,
): ScratchInterface {
	const scratch = createStudyScratch(resolve('tmp/units'), 'runtime-consumer-')
	try {
		write(scratch)
		return scratch
	} catch (error) {
		scratch.destroy()
		throw error
	}
}

/** Writes a real file-operation adapter and a separately selected subject package.
 * @param scratch - The owned temporary consumer; its capacity study needs no qualification.
 */
export function writeStudyConsumer(scratch: ScratchInterface): void {
	const definition = {
		...buildStudyDefinition(),
		name: 'assessment',
		purpose: 'capacity',
		driver: 'files',
		scenarios: ['first'],
		arms: ['small'],
		order: [['small']],
		rubric: 'rubric.json',
	}
	const profile = {
		...buildStudyProfile(),
		room: { ...buildStudyProfile().room, context: 4096 },
		agent: join(scratch.path, 'subject/dist/index.js'),
		subject: join(scratch.path, 'subject/dist/index.js'),
		roots: [join(scratch.path, 'subject')],
		bounds: {
			request: { duration: 3000, calls: 1, tokens: 1000, bytes: 4096 },
			goal: { duration: 5000, calls: 2, tokens: 2000, bytes: 8192 },
			trial: { duration: 10000, calls: 4, tokens: 4000, bytes: 32768 },
			series: { duration: 20000, calls: 8, tokens: 8000, bytes: 65536 },
		},
	}
	scratch.write(
		'subject/package.json',
		JSON.stringify({ name: 'file-subject', version: '1.0.0', type: 'module' }),
	)
	scratch.write(
		'subject/dist/index.js',
		`import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(scratch.path, 'imports.log'))}, String(process.pid)+'\\n'); export const prefix = 'saved:';`,
	)
	scratch.write('studies/assessment/study.json', JSON.stringify(definition))
	scratch.write(
		'studies/assessment/rubric.json',
		JSON.stringify({
			...buildStudyRubric(),
			criteria: buildStudyRubric().criteria.filter((criterion) => criterion.scenario === 'first'),
		}),
	)
	scratch.write('studies/files/profiles/local.json', JSON.stringify(profile))
	scratch.write(
		'studies/files/scenarios/first.json',
		JSON.stringify({
			...buildStudyScenario(),
			goals: [
				{ id: 'write', input: 'remember' },
				{ id: 'read', input: 'recall' },
			],
		}),
	)
	scratch.write(
		'studies/files/index.ts',
		`import {writeFileSync, readFileSync, appendFileSync} from 'node:fs'
import {join} from 'node:path'
export function createStudyAdapter() { return {
 validate(input) { if (input.scenarios.some(scenario => scenario.goals.some(goal => typeof goal.input !== 'string'))) throw new Error('File adapter requires text input') },
 driver(options) { if ('rubric' in options || 'definition' in options) throw new Error('Grader truth entered driver'); return { async open(trial) { const file = join(options.directory, 'result.txt'); return {
  async execute(goal, context) { const ticket = await context.meter.admit({role:'tool',tokens:1,bytes:64}); writeFileSync(file, options.subject.prefix+goal.input); const value = readFileSync(file,'utf8'); await context.evidence.append({event:'saved',goal:goal.id,value}); ticket.finish({role:'tool',calls:1,tokens:1,bytes:64,duration:0}); return {value,partial:false} },
  async close() {}
 } } } },
 grade(input) { return input.manifest.schedule.flatMap(trial => input.rubric.criteria.filter(criterion => criterion.scenario===trial.scenario).map(criterion => { const rows = input.evidence[trial.id] ?? []; const index = rows.findIndex(row => row.event === 'saved' && row.goal === criterion.goal); const row = rows[index]; return {trial:trial.id,criterion:criterion.id,verdict:criterion.method==='semantic'||row===undefined?'unknown':row.value==='saved:'+criterion.assertion.equals?'achieved':'unsuccessful',method:criterion.method==='semantic'?'human':criterion.method,reason:'Retained file observation',references:criterion.method==='semantic'||row===undefined?[]:['trials/'+trial.id+'/evidence.jsonl#'+(index+1)]} })) }
} }
`,
	)
}

/** Starts a loopback Ollama protocol fixture on an ephemeral port that answers queued replies by path.
 * @param replies - Queued replies for matching request paths; other paths receive the default answer.
 * @param answer - Answers a request from its exact bytes when no queued reply claims it; declining leaves the default answer.
 * @returns The fixture origin, the exact received requests, the unserved replies, and its close.
 */
export async function createOllamaServer(
	replies: readonly OllamaWireReplyFixture[] = [],
	answer?: StudyMCPAnswer,
): Promise<OllamaServerFixture> {
	const queue = new OllamaReplyQueue(replies)
	const requests = new StudyLog<OllamaRequestFixture>()
	const owners = new StudyLog<string | undefined>()
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = []
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
		const path = request.url ?? ''
		const text = Buffer.concat(chunks).toString('utf8')
		const supplied = queue.claim(path)
		const scripted = replies.find((entry) => entry === supplied)
		requests.append({ path, body: text })
		const header = request.headers['x-study-owned']
		owners.append(typeof header === 'string' ? header : undefined)
		const body = supplied?.body ?? answer?.(path, text) ?? readOllamaDefault(path)
		if (scripted?.pause !== undefined) await waitForDelay(scripted.pause)
		response.writeHead(supplied?.status ?? 200, scripted?.headers)
		if (scripted?.chunks !== undefined) {
			for (const chunk of scripted.chunks) {
				response.write(chunk)
				await waitForDelay(1)
			}
			if (scripted.interrupted === true) response.destroy()
			else if (scripted.open !== true) response.end()
			return
		}
		if (supplied?.open === true) response.write(body)
		else response.end(body)
	})
	await new Promise<void>((resolveListen, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolveListen)
	})
	const address = server.address()
	if (address === null || typeof address === 'string')
		throw new Error('Missing Ollama fixture address')
	return {
		url: `http://127.0.0.1:${address.port}`,
		requests: requests.entries,
		owned: owners.entries,
		get replies(): readonly OllamaReplyFixture[] {
			return queue.remaining
		},
		close: () =>
			new Promise<void>((resolveClose, reject) => {
				server.closeAllConnections()
				server.close((error) => (error === undefined ? resolveClose() : reject(error)))
			}),
	}
}

/** Builds the transport configuration the fixture server serves: agent, summary, and a one-token judge.
 * @param url - The fixture origin.
 * @param change - Members replacing the defaults.
 * @returns A complete transport configuration.
 */
export function buildOllamaTransportOptions(
	url: string,
	change: Partial<StudyOllamaTransportOptions> = {},
): StudyOllamaTransportOptions {
	return {
		url,
		room: { context: 32768, safety: 128 },
		limit: { duration: 2000, bytes: 1048576 },
		metadata: { calls: 32, bytes: 16777216, duration: 15000 },
		models: {
			model: { name: 'model', digest: 'a'.repeat(64) },
			judge: { name: 'judge', digest: 'b'.repeat(64) },
		},
		roles: {
			agent: {
				model: 'model',
				options: STUDY_OLLAMA_OPTIONS,
				think: false,
				strict: false,
				length: false,
			},
			summary: {
				model: 'model',
				options: { ...STUDY_OLLAMA_OPTIONS, num_predict: 256 },
				think: false,
				strict: false,
				length: false,
			},
			judge: {
				model: 'judge',
				options: STUDY_JUDGE_OPTIONS,
				think: false,
				strict: false,
				length: true,
			},
		},
		signal: new AbortController().signal,
		observe: false,
		timing: extractTiming,
		...change,
	}
}

/** Supplies disk sidecar pressure cases and fitting response controls. */
export const STUDY_OLLAMA_SIDECAR_CASES = Object.freeze([
	{ bytes: 8192, status: 200 },
	{ bytes: 65536, status: 200 },
	{ bytes: 8192, status: 500 },
	{ bytes: 65536, status: 500 },
])

/** Supplies the exact encoded agent chat body the default transport policy admits. */
export const STUDY_OLLAMA_CHAT_BODY = JSON.stringify({
	model: 'model',
	stream: true,
	think: false,
	options: STUDY_OLLAMA_OPTIONS,
})

/** Builds fresh mutable caller role declarations whose agent policy is strict.
 * @returns Role declarations a test may mutate after construction without sharing state.
 */
export function buildOllamaStrictRoles(): OllamaStrictRolesFixture {
	return {
		agent: {
			model: 'model',
			options: { ...STUDY_OLLAMA_OPTIONS },
			think: false,
			strict: true,
			length: false,
		},
	}
}

/** Records every supplied exchange row without implementing production sink validation. */
export class OllamaExchangeRecorder implements StudyExchangeSinkInterface {
	readonly #rows: StudyExchangeRow[] = []
	readonly #declaration: StudyExchangeDeclaration

	/** Retains the supplied declaration at the recorder boundary.
	 * @param declaration - The inert declaration, kept live for malformed-input tests.
	 */
	constructor(declaration: StudyExchangeDeclaration = buildOllamaDeclaration()) {
		this.#declaration = declaration
		this.#rows.push(declaration)
	}

	/** Holds the declaration supplied to the recorder. */
	get declaration(): StudyExchangeDeclaration {
		return this.#declaration
	}

	/** Holds all rows in append order. */
	get rows(): readonly StudyExchangeRow[] {
		return this.#rows
	}

	/** Reports the next HTTP ordinal from accepted attempts. */
	get next(): number {
		return this.#rows.filter((row) => row.phase === 'attempt').length + 1
	}

	/** Retains one row as an owned snapshot.
	 * @param row - The supplied exchange row.
	 * @returns Completion after the row is retained.
	 */
	async append(row: StudyExchangeRow): Promise<void> {
		this.#rows.push(structuredClone(row))
	}

	/** Closes this inert recorder.
	 * @returns Immediate completion.
	 */
	async close(): Promise<void> {}
}

/** Builds a declared model step over the fixture's exact role policy.
 * @param admission - The exact or capture admission contract.
 * @param body - The body whose bytes the declaration bounds.
 * @param role - The responsible model role.
 * @param ordinal - The contiguous model-step ordinal.
 * @param goal - The declared goal.
 * @returns The complete step declaration.
 */
export function buildOllamaStep(
	admission: 'exact' | 'capture' = 'capture',
	body = STUDY_OLLAMA_CHAT_BODY,
	role: StudyOllamaRole = 'agent',
	ordinal = 1,
	goal = 'first',
): StudyOllamaStep {
	const policy = requireValue(buildOllamaTransportOptions('http://127.0.0.1:1').roles[role])
	const identity = {
		ordinal,
		goal,
		role,
		path: role === 'judge' ? ('/api/generate' as const) : ('/api/chat' as const),
		policy: { ...policy, options: { ...policy.options } },
	}
	return admission === 'exact'
		? { ...identity, admission, body, input: hashStudyBytes(body) }
		: { ...identity, admission, bytes: Buffer.byteLength(body) }
}

/** Supplies distinct agent, summary and raw judge body bytes under their declared policies.
 * @returns Model-role and body pairs in the declared execution order.
 */
export function buildOllamaRoleBodies(): ReadonlyArray<readonly [StudyOllamaRole, string]> {
	return [
		['agent', STUDY_OLLAMA_CHAT_BODY],
		[
			'summary',
			JSON.stringify({
				model: 'model',
				stream: true,
				think: false,
				options: { ...STUDY_OLLAMA_OPTIONS, num_predict: 256 },
				messages: [{ role: 'user', content: 'résumé' }],
			}),
		],
		[
			'judge',
			JSON.stringify({
				model: 'judge',
				stream: false,
				raw: true,
				logprobs: true,
				options: STUDY_JUDGE_OPTIONS,
				prompt: 'A\r\n🦉',
			}),
		],
	]
}

/** Builds an independent opening row for transport protocol fixtures.
 * @param procedure - The declared execution population; undefined selects open recording.
 * @param change - Members replacing the fixture declaration.
 * @returns The complete opening row without transport-owned version or procedure options.
 */
export function buildOllamaDeclaration(
	procedure: readonly StudyOllamaStep[] | undefined = [buildOllamaStep()],
	change: Partial<StudyExchangeDeclaration> = {},
): StudyExchangeDeclaration {
	const options = buildOllamaTransportOptions('http://127.0.0.1:1')
	return {
		phase: 'declaration',
		trial: 'r1-first-small',
		version: 'fixture-version',
		models: options.models,
		metadata: options.metadata,
		record: { bytes: 32768, calls: 256, duration: 15000 },
		goals: [...new Set(['first', ...(procedure ?? []).map((step) => step.goal)])],
		configuration: 'c'.repeat(64),
		maintenance: [],
		...(procedure === undefined ? {} : { procedure }),
		...change,
	}
}

/** Creates a recording transport whose sink retains every row for independent assertions.
 * @param procedure - The declared model-step population.
 * @param replies - The loopback server's protocol responses.
 * @param change - Explicit transport overrides.
 * @returns The transport fixture and retained exchange rows.
 */
export async function createOllamaRecordingFixture(
	procedure: readonly StudyOllamaStep[] = [buildOllamaStep()],
	replies: readonly OllamaWireReplyFixture[] = [],
	change: Partial<StudyOllamaTransportOptions> = {},
): Promise<OllamaRecordingFixture> {
	const sink = new OllamaExchangeRecorder(
		buildOllamaDeclaration(procedure, {
			...(change.metadata === undefined ? {} : { metadata: change.metadata }),
			...(change.models === undefined ? {} : { models: change.models }),
		}),
	)
	const fixture = await createOllamaTransportFixture(replies, {
		exchanges: sink,
		...change,
	})
	return { ...fixture, sink, rows: sink.rows }
}

/** Creates an open recording over the real transport, meter and loopback protocol server.
 * @param replies - The peer's queued response bytes and timing.
 * @param change - Transport policies and independent metadata bounds.
 * @param declaration - Opening-row members replacing the open defaults.
 * @returns The prepared transport and the recorder's complete append log.
 */
export async function createOpenOllamaRecordingFixture(
	replies: readonly OllamaWireReplyFixture[] = [],
	change: Partial<StudyOllamaTransportOptions> = {},
	declaration: Partial<StudyExchangeDeclaration> = {},
): Promise<OllamaRecordingFixture> {
	const { procedure: _procedure, ...opening } = buildOllamaDeclaration()
	const sink = new OllamaExchangeRecorder({
		...opening,
		...(change.metadata === undefined ? {} : { metadata: change.metadata }),
		...(change.models === undefined ? {} : { models: change.models }),
		...declaration,
	})
	const fixture = await createOllamaTransportFixture(replies, { exchanges: sink, ...change })
	return { ...fixture, sink, rows: sink.rows }
}

/** Creates real goal accounting and an append-only evidence recorder sized for the fixture transport.
 * @param signal - The goal's cancellation.
 * @returns The context, its evidence, the real meter, and one cleanup boundary.
 */
export function createOllamaContext(signal = new AbortController().signal): OllamaContextFixture {
	const meter = createStudyMeterFixture(
		{
			request: { duration: 2000, calls: 1, tokens: 32640, bytes: 1048576 },
			goal: { duration: 15000, calls: 64, tokens: 8388608, bytes: 268435456 },
			trial: { duration: 15000, calls: 64, tokens: 8388608, bytes: 268435456 },
			series: { duration: 15000, calls: 64, tokens: 8388608, bytes: 268435456 },
		},
		signal,
	)
	const appended = new StudyLog<StudyEvidence>()
	return {
		context: {
			signal,
			meter: meter.meter,
			evidence: {
				append: async (row) => {
					appended.append(row)
				},
			},
		},
		evidence: appended.entries,
		meter,
		usage: () =>
			meter.meter.usage.map(({ role, calls, tokens, bytes }) => ({ role, calls, tokens, bytes })),
		close: () => meter.close(),
	}
}

/** Creates an exchange over real goal accounting, an admitted ticket and an empty response reader.
 * @param bytes - The encoded request bytes the exchange's tally starts from; Default: 10.
 * @returns The exchange, its goal accounting and one cleanup boundary.
 */
export async function createOllamaExchange(bytes = 10): Promise<OllamaExchangeFixture> {
	const goal = createOllamaContext()
	try {
		return {
			exchange: new StudyOllamaExchange({
				slot: Symbol('exchange'),
				identity: undefined,
				headers: [],
				ceiling: 1048576,
				activity: { goal: 'first', context: goal.context, checkpoint: undefined },
				request: {
					role: 'agent',
					path: '/api/chat',
					model: 'model',
					output: 8,
					bytes,
					options: {},
					strict: false,
					length: false,
				},
				ticket: await goal.context.meter.admit({ role: 'agent', tokens: 1, bytes: 1 }),
				signal: goal.context.signal,
				reader: requireValue(new Response('').body).getReader(),
				decoder: new TextDecoder('utf-8', { fatal: true }),
				status: 200,
				started: 0,
				id: 1,
				sent: 0,
				dispatch: undefined,
				bytes,
			}),
			goal,
			close: () => goal.close(),
		}
	} catch (error) {
		goal.close()
		throw error
	}
}

/** Creates a transport over a fresh loopback fixture and prepares it for one goal with real accounting.
 * @param replies - The fixture's queued replies.
 * @param change - Transport configuration members replacing the defaults.
 * @param checkpoint - The goal's retained public view; undefined retains neither it nor request bodies.
 * @returns The server, goal accounting, the transport prepared for goal `first`, and one cleanup boundary that closes the transport and so ends its goal.
 */
export async function createOllamaTransportFixture(
	replies: readonly OllamaWireReplyFixture[] = [],
	change: Partial<StudyOllamaTransportOptions> = {},
	checkpoint?: JSONValue,
): Promise<OllamaTransportFixture> {
	const server = await createOllamaServer(replies)
	const goal = createOllamaContext()
	try {
		const transport = new StudyOllamaTransport(buildOllamaTransportOptions(server.url, change))
		transport.prepare({ goal: 'first', context: goal.context, checkpoint })
		return {
			server,
			goal,
			transport,
			close: async () => {
				await transport.close()
				goal.close()
				await server.close()
			},
		}
	} catch (error) {
		goal.close()
		await server.close()
		throw error
	}
}

/** Creates a real published Ollama provider whose every request goes through the transport under one role.
 * @param transport - The admitting transport.
 * @param url - The fixture origin.
 * @param role - The responsibility each request is admitted under. Default: agent.
 * @param dispatch - The canonical dispatch each request joins.
 * @returns The real provider.
 */
export function createOllamaTransportProvider(
	transport: StudyOllamaTransport,
	url: string,
	role: Exclude<StudyOllamaRole, 'judge'> = 'agent',
	dispatch?: StudyAgentDispatch,
): ProviderInterface {
	return createOllama({
		model: 'model',
		url,
		think: false,
		timeout: 2000,
		options:
			role === 'agent' ? STUDY_OLLAMA_OPTIONS : { ...STUDY_OLLAMA_OPTIONS, num_predict: 256 },
		fetch: (input: string | URL | Request, init?: RequestInit) =>
			transport.fetch(role, input, init, dispatch),
	})
}

/** Supplies the human message of the live Ollama 0.40.3 context refusal. */
export const STUDY_OLLAMA_NATIVE_MESSAGE =
	'request (8204 tokens) exceeds the available context size (2048 tokens), try increasing it'

/** Supplies the structured error that live refusal carried. */
export const STUDY_OLLAMA_NATIVE_ERROR = Object.freeze({
	code: 400,
	message: STUDY_OLLAMA_NATIVE_MESSAGE,
	type: 'exceed_context_size_error',
	n_prompt_tokens: 8204,
	n_ctx: 2048,
})

/** Supplies the exact outer body recorded from that live refusal: `error` is a string that holds the structured JSON, not a nested object. */
export const STUDY_OLLAMA_NATIVE_BODY =
	'{"error":"{\\"error\\":{\\"code\\":400,\\"message\\":\\"request (8204 tokens) exceeds the available context size (2048 tokens), try increasing it\\",\\"type\\":\\"exceed_context_size_error\\",\\"n_prompt_tokens\\":8204,\\"n_ctx\\":2048}}"}'

/** Supplies native error values and the failure each must read as, with the substrings its readable reason must keep. */
export const STUDY_OLLAMA_FAILURE_CASES: readonly OllamaFailureFixture[] = Object.freeze([
	{
		name: 'a structured error object',
		value: { error: STUDY_OLLAMA_NATIVE_ERROR },
		code: 'CAPACITY',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE, 'exceed_context_size_error'],
	},
	{
		name: 'the exact live string-wrapped body',
		value: parseJSON(STUDY_OLLAMA_NATIVE_BODY),
		code: 'CAPACITY',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE, 'exceed_context_size_error'],
	},
	{
		name: 'the exact live string-wrapped body on HTTP 400',
		value: parseJSON(STUDY_OLLAMA_NATIVE_BODY),
		status: 400,
		code: 'CAPACITY',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE, 'exceed_context_size_error', 'HTTP 400'],
	},
	{
		name: 'a string holding the bare error object',
		value: { error: JSON.stringify(STUDY_OLLAMA_NATIVE_ERROR) },
		code: 'CAPACITY',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE, 'exceed_context_size_error'],
	},
	{
		name: 'an object that wraps the error object once',
		value: { error: { error: STUDY_OLLAMA_NATIVE_ERROR } },
		code: 'CAPACITY',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'an error object without a code',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, code: undefined } },
		code: 'CAPACITY',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'plain text that mentions the context',
		value: { error: 'the prompt exceeds the available context size' },
		code: 'FAULT',
		reason: ['the prompt exceeds the available context size'],
	},
	{
		name: 'context text under another native type',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, type: 'invalid_request_error' } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE, 'invalid_request_error'],
	},
	{
		name: 'a type that only resembles the capacity type',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, type: 'exceed_context_size_errors' } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE, 'exceed_context_size_errors'],
	},
	{
		name: 'the capacity type in another case',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, type: 'Exceed_Context_Size_Error' } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'an error object without a type',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, type: undefined } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'a prompt count equal to the context',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, n_prompt_tokens: 2048 } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'a zero context count',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, n_ctx: 0 } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'a fractional prompt count',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, n_prompt_tokens: 8204.5 } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'a prompt count written as text',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, n_prompt_tokens: '8204' } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'a NaN context count',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, n_ctx: Number.NaN } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'an infinite prompt count',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, n_prompt_tokens: Number.POSITIVE_INFINITY } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'an error code other than 400',
		value: { error: { ...STUDY_OLLAMA_NATIVE_ERROR, code: 500 } },
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE],
	},
	{
		name: 'the live body on another HTTP status',
		value: parseJSON(STUDY_OLLAMA_NATIVE_BODY),
		status: 500,
		code: 'FAULT',
		reason: [STUDY_OLLAMA_NATIVE_MESSAGE, 'HTTP 500'],
	},
	{
		name: 'a string that wraps a string that wraps the error',
		value: {
			error: JSON.stringify({ error: JSON.stringify({ error: STUDY_OLLAMA_NATIVE_ERROR }) }),
		},
		code: 'FAULT',
		reason: ['Ollama error'],
	},
	{
		name: 'a numeric error member',
		value: { error: 7 },
		code: 'FAULT',
		reason: ['Malformed Ollama error'],
	},
	{
		name: 'a null error member',
		value: { error: null },
		code: 'FAULT',
		reason: ['Malformed Ollama error'],
	},
	{
		name: 'a blank error string',
		value: { error: '  ' },
		code: 'FAULT',
		reason: ['Malformed Ollama error'],
	},
	{
		name: 'an empty error object on HTTP 500',
		value: { error: {} },
		status: 500,
		code: 'FAULT',
		reason: ['Malformed Ollama HTTP 500 error'],
	},
])

/** Supplies values that carry no `error` member and so read as no failure at all. */
export const STUDY_OLLAMA_NO_FAILURES: readonly unknown[] = Object.freeze([
	undefined,
	null,
	'error',
	['error'],
	{},
	{ done: true },
	{ model: 'model', done: false, message: { role: 'assistant', content: 'error' } },
])

/** Supplies 200 response bodies a 2048-byte wire allowance must refuse while reading, with the failure each latches. */
export const STUDY_OLLAMA_STREAM_FAILURES: readonly OllamaStreamFailureFixture[] = Object.freeze([
	{
		name: 'the response byte allowance',
		body: buildOllamaStream(['x'.repeat(4096)]),
		message: 'Ollama wire byte allowance exceeded',
		cause: 'capacity',
	},
	{
		name: 'malformed usage',
		body: buildOllamaRow({ fields: { eval_count: -1 } }),
		message: 'Malformed Ollama usage',
		cause: 'infrastructure',
	},
	{
		name: 'a native context error row',
		body: `${STUDY_OLLAMA_PARTIAL_ROW}${STUDY_OLLAMA_NATIVE_BODY}\n`,
		message: STUDY_OLLAMA_NATIVE_MESSAGE,
		cause: 'capacity',
	},
])

/** Supplies non-2xx responses a 2048-byte wire allowance reads once, with the failure each throws. */
export const STUDY_OLLAMA_STATUS_FAILURES: readonly OllamaStatusFailureFixture[] = Object.freeze([
	{
		name: 'the live context refusal on HTTP 400',
		status: 400,
		body: STUDY_OLLAMA_NATIVE_BODY,
		code: 'CAPACITY',
		message: 'exceed_context_size_error',
	},
	{
		name: 'an unparsable body on HTTP 500',
		status: 500,
		body: 'daemon unavailable',
		code: 'FAULT',
		message: 'Ollama HTTP response refused: 500',
	},
	{
		name: 'an oversized body on HTTP 500',
		status: 500,
		body: 'x'.repeat(4096),
		code: 'CAPACITY',
		message: 'Ollama wire byte allowance exceeded',
	},
	{
		name: 'a multi-line JSON body on HTTP 500',
		status: 500,
		body: JSON.stringify({ error: 'model runner crashed' }, null, 2),
		code: 'FAULT',
		message: 'Ollama HTTP 500 error: model runner crashed',
	},
	{
		name: 'an empty body on HTTP 502',
		status: 502,
		body: '',
		code: 'FAULT',
		message: 'Ollama HTTP response refused: 502',
	},
	{
		name: 'an overlong error reason on HTTP 500',
		status: 500,
		body: JSON.stringify({ error: `model runner crashed: ${'x'.repeat(300)}` }),
		code: 'FAULT',
		message: 'Ollama HTTP 500 error: model runner crashed',
	},
])

/** Supplies 200 response bodies that break the row protocol, with the failure each latches without a role. */
export const STUDY_OLLAMA_ROW_FAULTS: readonly OllamaStreamFailureFixture[] = Object.freeze([
	{
		name: 'a stream with no terminal row',
		body: STUDY_OLLAMA_PARTIAL_ROW,
		message: 'Ollama response has no terminal row',
		cause: 'infrastructure',
	},
	{
		name: 'a row after the terminal',
		body: `${buildOllamaRow()}${buildOllamaRow()}`,
		message: 'Ollama emitted a row after its terminal',
		cause: 'infrastructure',
	},
	{
		name: 'an unparsable stream row',
		body: '{broken\n',
		message: 'JSON',
		cause: 'infrastructure',
	},
])

/** Resolves the canonical root of an installed package as Node resolves it from a directory.
 * @param from - The directory whose package manifest anchors resolution.
 * @param name - The package name.
 * @returns The canonical package root.
 */
export function resolveStudyPackage(from: string, name: string): string {
	return dirname(
		realpathSync(createRequire(join(from, 'package.json')).resolve(`${name}/package.json`)),
	)
}

/** Resolves the built core entry of an installed package from the workspace.
 * @param name - The package name.
 * @returns The canonical absolute path of its `dist/src/core/index.js`.
 */
export function resolveStudyEntry(name: string): string {
	return join(resolveStudyPackage(resolve('.'), name), 'dist', 'src', 'core', 'index.js')
}

/** Sums the calls an observation recorded under one role.
 * @param observation - The retained goal observation.
 * @param role - The responsibility to total.
 * @returns The total calls, zero when the role was never used.
 */
export function sumStudyCalls(observation: StudyObservation, role: StudyRole): number {
	return observation.usage
		.filter((usage) => usage.role === role)
		.reduce((total, usage) => total + usage.calls, 0)
}

/** Collects the canonical roots of installed packages and their declared runtime dependencies.
 * @param names - The package names selected from the workspace.
 * @returns Each distinct canonical root, admitted as captured package inventory.
 */
export function collectStudyRoots(names: readonly string[]): readonly string[] {
	const roots = new Set<string>()
	const pending = names.map((name) => resolveStudyPackage(resolve('.'), name))
	while (pending.length > 0) {
		const root = pending.pop()
		if (root === undefined || roots.has(root)) continue
		roots.add(root)
		const manifest = parseJSON(readFileSync(join(root, 'package.json'), 'utf8'))
		if (!isRecord(manifest) || !isRecord(manifest.dependencies)) continue
		for (const dependency of Object.keys(manifest.dependencies))
			pending.push(resolveStudyPackage(root, dependency))
	}
	return [...roots]
}

/** Starts a real MCP server over a real tool on an ephemeral loopback port, as an external service.
 *
 * The server is composed from the installed MCP core server, the MCP HTTP routes, the router and
 * the HTTP server. Its bytes are never captured by a Study inventory.
 * @param outcomes - One outcome per `lookup` call, in order: a string is the tool's result and an error is its refusal.
 * @returns The endpoint, the recorded receipts and one bounded teardown.
 */
export async function createMCPFixture(
	outcomes: ReadonlyArray<string | Error>,
): Promise<StudyMCPFixture> {
	// The sequence is the fixture's own copy, so a caller changing its array later changes no outcome.
	const sequence = Object.freeze([...outcomes])
	const executed = new StudyLog<Readonly<Record<string, unknown>>>()
	const posted = new StudyLog<string>()
	const tools = createToolManager()
	tools.add(
		createTool({
			name: 'lookup',
			description: 'Reads an order record',
			parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
			execute: (args) => {
				// The recorded calls are the fixture's own record, so the next outcome is the one past them.
				const outcome = sequence[executed.entries.length]
				executed.append({ ...args })
				if (outcome === undefined) throw new Error('No scripted outcome remains')
				if (outcome instanceof Error) throw outcome
				return outcome
			},
		}),
	)
	const dispatcher = createDispatcher<unknown>()
	dispatcher.add(
		createMCPRoutes(
			createMCPLegacy(createMCPServer({ identity: { name: 'orders', version: '1.0.0' }, tools })),
		),
	)
	const server = createHost<unknown>({
		dispatcher,
		state: () => undefined,
		host: '127.0.0.1',
		port: 0,
	})
	server.use(async (request, _context, next) => {
		if (request.method === 'POST') {
			const message = parseJSON(await request.clone().text())
			if (isRecord(message) && typeof message.method === 'string') posted.append(message.method)
		}
		return next()
	})
	try {
		const port = await server.start()
		return {
			url: `http://127.0.0.1:${port}/mcp`,
			calls: executed.entries,
			methods: posted.entries,
			close: async () => {
				await server.stop()
				await server.destroy()
				tools.destroy()
			},
		}
	} catch (error) {
		await server.destroy()
		tools.destroy()
		throw error
	}
}

/** Starts a loopback proxy in front of an MCP endpoint that forwards every request except `tools/call`.
 * @param target - The real MCP endpoint every other request is forwarded to.
 * @param interference - How each `tools/call` fails; none reaches the target.
 * @returns The proxy endpoint, the interfered request ids and one bounded teardown.
 */
export async function createMCPProxy(
	target: string,
	interference: StudyMCPInterference,
): Promise<StudyMCPProxy> {
	const interfered = new StudyLog<unknown>()
	const proxy = createServer(async (request, response) => {
		const chunks: Buffer[] = []
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
		const body = Buffer.concat(chunks).toString('utf8')
		const message = parseJSON(body)
		if (isRecord(message) && message.method === 'tools/call') {
			interfered.append(message.id)
			if (interference === 'reset') request.socket.destroy()
			else if (interference === 'status') {
				response.writeHead(503, { 'content-type': 'text/plain' })
				response.end('Unavailable')
			} else if (interference !== 'held') {
				response.writeHead(200, { 'content-type': 'application/json' })
				response.end(
					JSON.stringify(
						interference === 'invalid'
							? { jsonrpc: '2.0', id: message.id, result: 7 }
							: {
									jsonrpc: '2.0',
									id: message.id,
									error: { code: -32000, message: 'Remote unavailable' },
								},
					),
				)
			}
			return
		}
		const headers = new Headers(
			Object.fromEntries(
				Object.entries(request.headers).flatMap(([name, value]) =>
					value === undefined || name === 'host' || name === 'content-length'
						? []
						: [[name, Array.isArray(value) ? value.join(', ') : value] as const],
				),
			),
		)
		const reply = await fetch(target, {
			method: request.method ?? 'POST',
			headers,
			...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body }),
		})
		response.writeHead(reply.status, {
			'content-type': reply.headers.get('content-type') ?? 'application/json',
		})
		response.end(await reply.text())
	})
	await new Promise<void>((ready, reject) => {
		proxy.once('error', reject)
		proxy.listen(0, '127.0.0.1', ready)
	})
	const address = proxy.address()
	if (address === null || typeof address === 'string') throw new Error('Missing MCP proxy address')
	return {
		url: `http://127.0.0.1:${address.port}/mcp`,
		intercepted: interfered.entries,
		close: () =>
			new Promise<void>((done, reject) => {
				proxy.closeAllConnections()
				proxy.close((error) => (error === undefined ? done() : reject(error)))
			}),
	}
}

/** Answers a chat request as a deterministic Ollama protocol peer: it asks for `lookup` until the last message is a tool receipt, then answers from that receipt.
 * @param path - The requested path.
 * @param body - The exact request bytes.
 * @returns The terminal row, or undefined for any path but chat.
 */
export function answerStudyMCP(path: string, body: string): string | undefined {
	if (path !== '/api/chat') return undefined
	const request = parseJSON(body)
	if (!isRecord(request) || !isArray(request.messages)) throw new Error('Invalid chat request')
	const last: unknown = request.messages.at(-1)
	if (!isRecord(last) || typeof last.role !== 'string') throw new Error('Invalid chat message')
	if (last.role !== 'tool') return buildOllamaCall()
	if (typeof last.content !== 'string') throw new Error('Invalid tool receipt')
	return buildOllamaRow({ content: `Order status: ${last.content}` })
}

/** Names the goals the MCP consumer declares, in order. */
export const STUDY_MCP_GOALS = Object.freeze(['shipped', 'delayed', 'refused'] as const)

/** Supplies the adapter that drives the admitted Agent over the admitted MCP core client.
 *
 * It evaluates nothing during validation: the selected namespaces arrive only through `driver`.
 */
export const STUDY_MCP_ADAPTER = `import { AsyncLocalStorage } from 'node:async_hooks'
export function createStudyAdapter() { return {
 validate(input) {
  if (input.scenarios.some(scenario => scenario.goals.some(goal => typeof goal.input !== 'string'))) throw new Error('Order adapter requires text input')
  if (input.profile.provider === undefined || typeof input.profile.settings?.endpoint !== 'string') throw new Error('Order adapter requires a provider and an endpoint')
 },
 driver(options) {
  if ('rubric' in options || 'definition' in options) throw new Error('Grader truth entered driver')
  const { agent, subject, provider, profile } = options
  return { async open(trial, signal) {
   const goal = new AsyncLocalStorage()
   const metered = async (role, charge, run) => {
    const ticket = await goal.getStore().meter.admit({ role, ...charge })
    const started = performance.now()
    try {
     const outcome = await run(ticket)
     ticket.finish({ role, calls: 1, tokens: outcome.tokens, bytes: outcome.bytes, duration: Math.ceil(performance.now() - started) })
     return outcome.value
    } catch (error) {
     if (!ticket.settled) ticket.fail({ cause: 'infrastructure', message: String(error?.message ?? error), role })
     throw error
    }
   }
   const wire = async (input, init) => metered('agent', { tokens: 4096, bytes: 262144 }, async (ticket) => {
    const response = await fetch(input, { ...init, signal: init?.signal === undefined || init.signal === null ? ticket.signal : AbortSignal.any([ticket.signal, init.signal]) })
    const text = await response.text()
    const row = text.trim().split('\\n').at(-1)
    const counts = JSON.parse(row)
    return { value: new Response(text, { status: response.status }), tokens: counts.prompt_eval_count + counts.eval_count, bytes: Buffer.byteLength(text) }
   })
   const client = subject.createMCPClient({ transport: new subject.HTTPClientTransport({ url: profile.settings.endpoint, timeout: 4000 }), timeout: 4000 })
   const runner = agent.createAgent(provider.createOllama({ model: profile.provider.model, url: profile.provider.url, think: false, timeout: 4000, fetch: wire, options: { num_ctx: profile.room.context, num_predict: profile.room.output, temperature: 0, seed: 0 } }), { limit: 4, timeout: 8000, signal })
   try {
    await client.connect()
    for (const remote of await client.tools())
     runner.context.tools.add({ name: remote.name, description: remote.description, parameters: remote.parameters, execute: async (args, context) => {
      const ticket = await goal.getStore().meter.admit({ role: 'tool', tokens: 0, bytes: 4096 })
      const started = performance.now()
      try {
       const value = await remote.execute(args, context)
       const bytes = Buffer.byteLength(JSON.stringify(value) ?? '')
       ticket.finish({ role: 'tool', calls: 1, tokens: undefined, bytes, duration: Math.ceil(performance.now() - started) })
       return value
      } catch (error) {
       if (ticket.settled || ticket.signal.aborted) throw error
       try {
        if (subject.isMCPToolError(error)) ticket.finish({ role: 'tool', calls: 1, tokens: undefined, bytes: undefined, duration: Math.ceil(performance.now() - started) })
        else ticket.fail({ cause: 'infrastructure', message: String(error?.message ?? error), role: 'tool' })
       } catch (settlement) {
        if (!ticket.settled && !ticket.signal.aborted) ticket.fail({ cause: 'infrastructure', message: String(settlement?.message ?? settlement), role: 'tool' })
        throw settlement
       }
       throw error
      }
     } })
   } catch (error) {
    runner.emitter.destroy()
    await client.disconnect()
    throw error
   }
   return {
    async execute(declared, context) {
     const receipts = []
     const onTool = (call, result) => receipts.push({ name: call.name, success: result.success, ...(result.success ? { value: result.value ?? null } : { error: result.error }) })
     runner.emitter.on('tool', onTool)
     try {
      runner.context.messages.clear()
      runner.context.messages.add({ role: 'user', content: declared.input })
      const result = await goal.run(context, () => runner.generate({ signal: context.signal }))
      for (const receipt of receipts) await context.evidence.append({ event: 'tool', goal: declared.id, value: receipt })
      await context.evidence.append({ event: 'answered', goal: declared.id, value: result.content })
      return { value: result.content, partial: result.partial }
     } finally { runner.emitter.off('tool', onTool) }
    },
    async close() {
     runner.emitter.destroy()
     runner.context.tools.destroy()
     await client.disconnect()
    },
   }
  } }
 },
 grade(input) { return input.manifest.schedule.flatMap(trial => input.rubric.criteria.filter(criterion => criterion.scenario === trial.scenario).map(criterion => { const rows = input.evidence[trial.id] ?? []; const index = rows.findIndex(row => row.event === 'answered' && row.goal === criterion.goal); return { trial: trial.id, criterion: criterion.id, verdict: index < 0 ? 'unknown' : 'achieved', method: criterion.method, reason: 'Retained answer observation', references: index < 0 ? [] : ['trials/' + trial.id + '/evidence.jsonl#' + (index + 1)] } })) }
} }
`

/** Writes a mechanism consumer whose subject is the admitted MCP core client and whose runtime is the admitted Agent.
 *
 * The profile declares a provider without a judge and a room without a recap.
 * @param scratch - The owned temporary consumer.
 * @param endpoint - The parent-owned MCP endpoint, passed through explicit profile settings.
 * @param origin - The parent-owned Ollama protocol origin.
 */
export function writeStudyMCP(scratch: ScratchInterface, endpoint: string, origin: string): void {
	const limit = { duration: 5000, calls: 1, tokens: 4096, bytes: 1048576 }
	const profile = {
		name: 'local',
		agent: resolveStudyEntry('@orkestrel/agent'),
		subject: resolveStudyEntry('@orkestrel/mcp'),
		roots: collectStudyRoots(['@orkestrel/agent', '@orkestrel/mcp', '@orkestrel/ollama']),
		bounds: {
			request: limit,
			goal: { ...limit, duration: 20000, calls: 8, tokens: 65536, bytes: 4194304 },
			trial: { ...limit, duration: 60000, calls: 32, tokens: 262144, bytes: 16777216 },
			series: { ...limit, duration: 90000, calls: 64, tokens: 524288, bytes: 33554432 },
		},
		room: { context: 8192, output: 512, safety: 64, think: false },
		provider: {
			entry: resolveStudyEntry('@orkestrel/ollama'),
			url: origin,
			model: 'model',
			digest: { model: 'a'.repeat(64) },
		},
		settings: { endpoint },
	}
	scratch.write(
		'studies/orders/study.json',
		JSON.stringify({
			...buildStudyDefinition(),
			name: 'orders',
			purpose: 'mechanism',
			driver: 'mcp',
			scenarios: ['lookups'],
			arms: ['remote'],
			order: [['remote']],
			rubric: 'rubric.json',
		}),
	)
	scratch.write(
		'studies/orders/rubric.json',
		JSON.stringify({
			version: '1',
			criteria: STUDY_MCP_GOALS.map((goal): StudyCriterion => ({
				id: `${goal}-answered`,
				scenario: 'lookups',
				goal,
				method: 'trace',
				critical: false,
				assertion: { observation: 'answered' },
			})),
		}),
	)
	scratch.write('studies/mcp/profiles/local.json', JSON.stringify(profile))
	scratch.write(
		'studies/mcp/scenarios/lookups.json',
		JSON.stringify({
			id: 'lookups',
			goals: STUDY_MCP_GOALS.map((goal) => ({ id: goal, input: `Where is order-1 (${goal})?` })),
		}),
	)
	scratch.write('studies/mcp/index.ts', STUDY_MCP_ADAPTER)
}

/** Constructs an error through the budget package's independently evaluated CommonJS entry.
 * @param context - The foreign source's readings.
 * @returns A branded error whose constructor differs from the ESM class.
 */
export function createForeignBudgetError(
	context: BudgetErrorContext = { id: 'foreign', max: 1, consumed: 2 },
): BudgetError {
	const module: unknown = createRequire(import.meta.url)('@orkestrel/budget')
	if (!isObject(module)) throw new Error('Invalid CommonJS budget entry')
	const constructor: unknown = Reflect.get(module, 'BudgetError')
	if (typeof constructor !== 'function' || constructor === LocalBudgetError)
		throw new Error('Expected a foreign budget constructor')
	const error: unknown = Reflect.construct(constructor, [context])
	if (!isBudgetError(error)) throw new Error('Expected branded foreign error')
	return error
}

/** Constructs an unbranded error carrying the budget error's public-looking fields.
 * @returns The negative recognition control.
 */
export function createBudgetLookalike(): Error {
	return Object.assign(new Error('budget reached its ceiling'), {
		name: 'BudgetError',
		code: 'exhaust',
		context: { id: 'foreign', max: 1, consumed: 2 },
	})
}

/** Names the consumer's ESM core identity driver. */
export const CORE_ESM_DRIVER = 'core.mjs'
/** Names the consumer's CommonJS core identity driver. */
export const CORE_CJS_DRIVER = 'core.cjs'
/** Drives the server's refusal through the ESM root class. */
export const CORE_ESM_DRIVER_SOURCE = `import { StudyError } from '@orkestrel/study'
import { parseStudyArguments } from '@orkestrel/study/server'
try { parseStudyArguments([]) } catch (error) {
 process.stdout.write(JSON.stringify({ shared: error instanceof StudyError, code: error.code }))
}
`
/** Drives the server's refusal through the CommonJS root class. */
export const CORE_CJS_DRIVER_SOURCE = `const { StudyError } = require('@orkestrel/study')
const { parseStudyArguments } = require('@orkestrel/study/server')
try { parseStudyArguments([]) } catch (error) {
 process.stdout.write(JSON.stringify({ shared: error instanceof StudyError, code: error.code }))
}
`

/** Checks that server refusals share the root error class in each module format.
 * @param stage - The installed consumer.
 * @returns The observed core identities and codes.
 */
export function readStudyDistributionCore(stage: DistributionStage): readonly unknown[] {
	return [
		[CORE_ESM_DRIVER, CORE_ESM_DRIVER_SOURCE],
		[CORE_CJS_DRIVER, CORE_CJS_DRIVER_SOURCE],
	].map(([driver, source]) => {
		if (driver === undefined || source === undefined) throw new Error('Missing core driver')
		const path = join(stage.consumer, driver)
		writeDistributionFile(path, source)
		const result = runDistributionNode([path], stage.consumer)
		if (result.status !== 0) throw new Error(readDistributionOutput(result))
		return JSON.parse(result.stdout)
	})
}

/** Reads the installed command's version through its npm shim.
 * @param stage - The installed consumer.
 * @returns The command output and the manifest's declared version.
 */
export function readStudyDistributionVersion(stage: DistributionStage): DistributionObservation {
	const manifest = readDistributionJSON(join(stage.installed, 'package.json'))
	if (!isDistributionRecord(manifest) || typeof manifest.version !== 'string')
		throw new Error('The installed manifest declares no version')
	const executable = join(
		stage.consumer,
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'study.cmd' : 'study',
	)
	const result = runDistributionNpm(
		['exec', '--offline', '--no', '--loglevel=silent', '--', executable, '--version'],
		stage.consumer,
		stage.consumer,
	)
	return {
		actual: { code: result.status, stdout: result.stdout, stderr: result.stderr },
		expected: { code: 0, stdout: manifest.version + '\n', stderr: '' },
	}
}

/** Checks the nominal control contract under every published consumer resolution.
 * @param stage - The installed consumer.
 * @returns The diagnostics and silent negative controls.
 */
export function checkStudyDistributionControl(stage: DistributionStage): readonly string[] {
	return DISTRIBUTION_RESOLUTIONS.flatMap((driver) =>
		DISTRIBUTION_FORMATS.flatMap(([extension, format]) => {
			if (filterDistributionEntries(stage.entries, driver.conditions[format]).length === 0)
				return []
			const label = driver.label + '.' + extension
			const valid = 'study-control.' + label
			const invalid = 'study-invalid-control.' + label
			writeDistributionFile(
				join(stage.consumer, valid),
				"import { StudyControl } from '@orkestrel/study'\nimport type { StudyChannel, StudyRemoteMeterOptions } from '@orkestrel/study/server'\ndeclare const channel: StudyChannel\nexport const options: StudyRemoteMeterOptions = { channel, control: new StudyControl() }\n",
			)
			writeDistributionFile(
				join(stage.consumer, invalid),
				"import type { StudyChannel, StudyRemoteMeterOptions } from '@orkestrel/study/server'\ndeclare const channel: StudyChannel\nexport const options: StudyRemoteMeterOptions = { channel, control: new Map() }\n",
			)
			return [
				...checkDistributionProject(
					stage,
					writeDistributionProject(stage, valid, driver, ['./' + valid]),
				).map((message) => label + ': ' + message),
				...(checkDistributionProject(
					stage,
					writeDistributionProject(stage, invalid, driver, ['./' + invalid]),
				).length === 0
					? [label + ': invalid control accepted']
					: []),
			]
		}),
	)
}

/** Defines the consumer's error recognition checks across formats and duplicate paths. */
export const STUDY_DISTRIBUTION_ERROR_SOURCE = `import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const imported = await import('@orkestrel/study')
const required = require('@orkestrel/study')
const server = await import('@orkestrel/study/server')
const common = require('@orkestrel/study/server')
const duplicate = process.argv[2]
const coreCopy = await import(pathToFileURL(join(duplicate, 'dist/src/core/index.js')).href)
const coreRequired = require(join(duplicate, 'dist/src/core/index.cjs'))
const serverCopy = await import(pathToFileURL(join(duplicate, 'dist/src/server/index.js')).href)
const serverRequired = require(join(duplicate, 'dist/src/server/index.cjs'))
const pairs = [
	[imported, required, 'StudyError', 'isStudyError', ['CONFIG', 'Refused'], '@orkestrel/study.error'],
	[imported, coreCopy, 'StudyError', 'isStudyError', ['CONFIG', 'Refused'], '@orkestrel/study.error'],
	[required, coreRequired, 'StudyError', 'isStudyError', ['CONFIG', 'Refused'], '@orkestrel/study.error'],
	[server, common, 'ArtifactError', 'isArtifactError', ['Refused', 'DRIFT'], '@orkestrel/study.ArtifactError'],
	[server, serverCopy, 'ArtifactError', 'isArtifactError', ['Refused', 'DRIFT'], '@orkestrel/study.ArtifactError'],
	[common, serverRequired, 'ArtifactError', 'isArtifactError', ['Refused', 'DRIFT'], '@orkestrel/study.ArtifactError'],
]
const checks = pairs.flatMap(([first, second, name, guard, args, brand]) => [[first, second], [second, first]].map(([owner, reader]) => {
	const error = new owner[name](...args)
	class Derived extends owner[name] { constructor() { super(...args); this.name = 'Derived' } }
	const lookalike = Object.assign(new Error('Look-alike'), { code: error.code })
	const plain = {}
	Object.defineProperty(plain, Symbol.for(brand), { value: plain })
	return { cross: reader[guard](error), subclass: reader[guard](new Derived()), lookalike: reader[guard](lookalike), proxy: reader[guard](new Proxy(error, {})), plain: reader[guard](plain) }
}))
const failure = { cause: 'capacity', message: 'Context full', role: 'agent' }
process.stdout.write(JSON.stringify({
	distinct: pairs.every(([first, second, name]) => first[name] !== second[name]), checks,
	capacity: imported.readStudyFailure(new required.StudyError('CAPACITY', 'Required capacity')),
	deadline: required.readStudyFailure(new imported.StudyError('DEADLINE', 'Imported deadline')),
	retained: imported.readStudyFailure(new required.StudyError('FAULT', 'Rejected', failure)) === failure,
}))
`

/** Reads error recognition from independently loaded copies of the packed files.
 * @param stage - The installed consumer.
 * @returns The driver's observed guard decisions and failure attribution.
 */
export function readStudyDistributionErrors(stage: DistributionStage): unknown {
	const duplicate = join(stage.consumer, 'node_modules', '@orkestrel', 'study-copy')
	mkdirSync(duplicate, { recursive: true })
	cpSync(join(stage.installed, 'package.json'), join(duplicate, 'package.json'))
	cpSync(join(stage.installed, 'dist'), join(duplicate, 'dist'), { recursive: true })
	const path = join(stage.consumer, 'study-errors.mjs')
	writeDistributionFile(path, STUDY_DISTRIBUTION_ERROR_SOURCE)
	const result = runDistributionNode([path, duplicate], stage.consumer)
	if (result.status !== 0) throw new Error(readDistributionOutput(result))
	return JSON.parse(result.stdout)
}
