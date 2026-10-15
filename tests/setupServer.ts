import type { StudyLaunchResult } from '../src/server/launchers/types.js'
import type { ScratchInterface } from '@orkestrel/test/server'
import { isArray, isInteger, isRecord, parseJSON } from '@orkestrel/contract'
import { isRunning } from '@orkestrel/test/server'
import type {
	StudyAttempt,
	StudyCriterion,
	StudyEvidence,
	StudyGrading,
	StudyLabels,
	StudyManifest,
	StudyObservation,
	StudyRole,
	StudyRubric,
} from '../src/core/types.js'
import type { StudyAdjudication, StudyGradeFunction } from '../src/server/adapters/types.js'
import type { StudySealedResult } from '../src/server/stores/types.js'
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
import { requireValue, waitForCondition, waitForEvent } from '@orkestrel/test'
import { execFile, fork } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { srcBin, srcCore } from '../vite.config.js'
import { outputBoundary } from '../configs/helpers.js'
import { encodeStudyJSON, hashStudyBytes } from '../src/server/helpers.js'
import {
	isStudyCharge,
	isStudyEvidence,
	isStudyFrame,
	isStudyIdentity,
	isStudyProcessFailure,
	isStudyTrial,
} from '../src/server/processes/validators.js'
import { StudyTask } from '../src/server/processes/StudyTask.js'
import { STUDY_TASK_DURATION } from '../src/server/processes/constants.js'
import { collectStudyEvidence } from '../src/server/commands/helpers.js'
import { StudyResults } from '../src/server/stores/StudyResults.js'
import {
	buildStudyPacket,
	buildStudyPacketLinks,
	readStudyResult,
} from '../src/server/stores/helpers.js'
import type { ProviderInterface } from '@orkestrel/agent'
import type { StudyAgentDispatch } from '../src/core/agents/types.js'
import type { StudyOllamaRole, StudyOllamaTransportOptions } from '../src/server/ollama/types.js'
import type { JSONValue } from '@orkestrel/contract'
import type { OllamaReplyFixture, OllamaRequestFixture } from './src/core/agents/types.js'
import type {
	OllamaContextFixture,
	OllamaFailureFixture,
	OllamaServerFixture,
	OllamaStatusFailureFixture,
	OllamaStreamFailureFixture,
	OllamaTransportFixture,
} from './src/server/ollama/types.js'
import type { StudyMCPAnswer, StudyMCPFixture } from './src/server/adapters/types.js'
import { createOllama, extractTiming } from '@orkestrel/ollama'
import { createMCPLegacy, createMCPServer } from '@orkestrel/mcp'
import { createMCPRoutes } from '@orkestrel/mcp/server'
import { createDispatcher } from '@orkestrel/router'
import { createServer as createHost } from '@orkestrel/server'
import { createTool, createToolManager } from '@orkestrel/tool'
import { StudyOllamaTransport } from '../src/server/ollama/StudyOllamaTransport.js'
import { createServer } from 'node:http'
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
	readOllamaDefault,
	STUDY_JUDGE_OPTIONS,
	STUDY_OLLAMA_OPTIONS,
	STUDY_OLLAMA_PARTIAL_ROW,
} from './setupStudy.js'

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
 if (context.parentURL?.startsWith(${JSON.stringify(library)}) && (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) return next(new URL(specifier.slice(0, -3) + '.ts', context.parentURL).href, context)
 return next(specifier, context)
} })
const { Artifacts } = await import(${JSON.stringify(`${library}server/artifacts/Artifacts.ts`)})
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
	const instrument = JSON.stringify(STUDY_TASK_INSTRUMENT)
	const entry = scratch.write(
		`adapter-${mode}.cjs`,
		`const fs = require('node:fs')
setTimeout(() => process.exit(0), 20000)
process.on('message', () => {
 fs.writeFileSync(${JSON.stringify(join(scratch.path, 'task-pid.txt'))}, String(process.pid))
 const mode = ${JSON.stringify(mode)}
 if (mode === 'valid') process.send({instrument:${instrument},value:true})
 if (mode === 'malformed') process.send({instrument:'invalid',value:true})
 if (mode === 'repeated') { process.send({instrument:${instrument},value:true}); process.send({instrument:${instrument},value:'second'}) }
 if (mode === 'combined-output') { process.stdout.write('x'.repeat(40000)); process.stderr.write('y'.repeat(40000)) }
})`,
	)
	return Object.freeze({
		task: new StudyTask(buildStudyTaskOptions(entry, duration)),
		pid: 'task-pid.txt',
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

/** Writes a finite command entry that answers check with a valid reply and exits 0 for any command.
 * @param scratch - The owned temporary resource holding the entry and its records.
 * @param duration - The series duration, in milliseconds, the check reply declares.
 * @returns The absolute entry path.
 */
export function writeStudyCheckEntry(scratch: ScratchInterface, duration: number): string {
	const bounds = buildStudyProfile().bounds
	const reply = JSON.stringify({
		bounds: { ...bounds, series: { ...bounds.series, duration } },
		fingerprint: STUDY_CHECK_FINGERPRINT,
	})
	return writeStudyLauncherEntry(
		scratch,
		20000,
		`finish(0, command === 'check' ? ${JSON.stringify(reply)} : undefined)`,
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
export function buildCustodyPacketLabels(
	result: StudySealedResult,
	rubric: StudyRubric,
	labeler = 'human-v1',
): StudyLabels {
	const original = buildCustodyLabels(result, labeler)
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
	const results = new StudyResults({ directory, manifest })
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
	labels?: StudyLabels,
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
export function buildCustodyLabels(result: StudySealedResult, labeler = 'human-v1'): StudyLabels {
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
		let row: number | undefined
		for (const [index, entry] of evidence.entries())
			if (entry.goal === criterion.goal && entry.event === assertion.observation) row = index
		if (row === undefined)
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
	scratch.write(
		'runtime/package.json',
		JSON.stringify({ name: '@orkestrel/study', version: '0.0.1', type: 'module' }),
	)
	await build({
		...srcBin({
			plugins: [outputBoundary(relative(resolve('.'), output).replaceAll('\\', '/'))],
			build: {
				outDir: output,
				emptyOutDir: false,
				rolldownOptions: { output: { banner: '#!/usr/bin/env node' } },
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
			{ cwd: root, windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 },
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
	replies: readonly OllamaReplyFixture[] = [],
	answer?: StudyMCPAnswer,
): Promise<OllamaServerFixture> {
	const queue = [...replies]
	const requests: OllamaRequestFixture[] = []
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = []
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
		const path = request.url ?? ''
		const text = Buffer.concat(chunks).toString('utf8')
		requests.push({ path, body: text })
		const supplied = queue[0]?.path === path ? queue.shift() : undefined
		const body = supplied?.body ?? answer?.(path, text) ?? readOllamaDefault(path)
		response.writeHead(supplied?.status ?? 200)
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
		requests,
		replies: queue,
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
	const evidence: StudyEvidence[] = []
	return {
		context: {
			signal,
			meter: meter.meter,
			evidence: {
				append: async (row) => {
					evidence.push(row)
				},
			},
		},
		evidence,
		meter,
		usage: () =>
			meter.meter.usage.map(({ role, calls, tokens, bytes }) => ({ role, calls, tokens, bytes })),
		close: () => meter.close(),
	}
}

/** Creates a transport over a fresh loopback fixture and prepares it for one goal with real accounting.
 * @param replies - The fixture's queued replies.
 * @param change - Transport configuration members replacing the defaults.
 * @param checkpoint - The goal's retained public view; undefined retains neither it nor request bodies.
 * @returns The server, goal accounting, prepared transport, and one cleanup boundary.
 */
export async function createOllamaTransportFixture(
	replies: readonly OllamaReplyFixture[] = [],
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
	for (let root = pending.pop(); root !== undefined; root = pending.pop()) {
		if (roots.has(root)) continue
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
	const queue = [...outcomes]
	const calls: Array<Readonly<Record<string, unknown>>> = []
	const methods: string[] = []
	const tools = createToolManager()
	tools.add(
		createTool({
			name: 'lookup',
			description: 'Reads an order record',
			parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
			execute: (args) => {
				calls.push({ ...args })
				const outcome = queue.shift()
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
			if (isRecord(message) && typeof message.method === 'string') methods.push(message.method)
		}
		return next()
	})
	try {
		const port = await server.start()
		return {
			url: `http://127.0.0.1:${port}/mcp`,
			calls,
			methods,
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
export const STUDY_MCP_ADAPTER = `export function createStudyAdapter() { return {
 validate(input) {
  if (input.scenarios.some(scenario => scenario.goals.some(goal => typeof goal.input !== 'string'))) throw new Error('Order adapter requires text input')
  if (input.profile.provider === undefined || typeof input.profile.settings?.endpoint !== 'string') throw new Error('Order adapter requires a provider and an endpoint')
 },
 driver(options) {
  if ('rubric' in options || 'definition' in options) throw new Error('Grader truth entered driver')
  const { agent, subject, provider, profile } = options
  return { async open(trial, signal) {
   let goal
   const metered = async (role, charge, run) => {
    const ticket = await goal.meter.admit({ role, ...charge })
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
      const ticket = await goal.meter.admit({ role: 'tool', tokens: 0, bytes: 4096 })
      const started = performance.now()
      let bytes
      try {
       const value = await remote.execute(args, context)
       bytes = Buffer.byteLength(JSON.stringify(value) ?? '')
       return value
      } finally {
       if (!ticket.settled && !ticket.signal.aborted) ticket.finish({ role: 'tool', calls: 1, tokens: undefined, bytes, duration: Math.ceil(performance.now() - started) })
      }
     } })
   } catch (error) {
    runner.emitter.destroy()
    await client.disconnect()
    throw error
   }
   return {
    async execute(declared, context) {
     goal = context
     const receipts = []
     const onTool = (call, result) => receipts.push({ name: call.name, success: result.success, ...(result.success ? { value: result.value ?? null } : { error: result.error }) })
     runner.emitter.on('tool', onTool)
     try {
      runner.context.messages.clear()
      runner.context.messages.add({ role: 'user', content: declared.input })
      const result = await runner.generate({ signal: context.signal })
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
