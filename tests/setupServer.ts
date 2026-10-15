import type { StudyLaunchResult } from '../src/server/launchers/types.js'
import type { ScratchInterface } from '@orkestrel/test/server'
import { isArray, isInteger, isRecord, parseJSON } from '@orkestrel/contract'
import { isRunning } from '@orkestrel/test/server'
import type {
	StudyAttempt,
	StudyGrading,
	StudyLabels,
	StudyManifest,
	StudyRubric,
} from '../src/core/types.js'
import type { StudySealedResult } from '../src/server/stores/types.js'
import type {
	StudyProcessSessionOptions,
	StudyTaskOptions,
	StudyTaskRequest,
} from '../src/server/processes/types.js'
import type {
	StudyOrphanReceipt,
	StudyPeerFixture,
	StudyTaskFixture,
	StudyTaskMode,
} from './src/server/processes/types.js'
import { requireValue, waitForCondition, waitForEvent } from '@orkestrel/test'
import { execFile, fork } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import { isBuiltin } from 'node:module'
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
import { StudyResults } from '../src/server/stores/StudyResults.js'
import {
	buildStudyPacket,
	buildStudyPacketLinks,
	readStudyResult,
} from '../src/server/stores/helpers.js'
import {
	buildCustodyAttempt,
	buildCustodyManifest,
	buildStudyRubric,
	buildStudyDefinition,
	buildStudyProfile,
	buildStudyScenario,
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

/**
 * Retains a complete fixture through the real append-only execution store.
 * @param directory - The nonexistent result directory inside an owned scratch resource
 * @param manifest - The execution declaration; Default: a fresh custody manifest
 * @returns The independently verified sealed execution
 */
export async function retainStudyFixture(
	directory: string,
	manifest: StudyManifest = buildCustodyManifest(),
): Promise<StudySealedResult> {
	const results = new StudyResults({ directory, manifest })
	await results.create()
	for (const trial of manifest.schedule) {
		const sink = await results.start(trial)
		await sink.append({ event: 'saved', goal: 'write', value: 'remember' })
		await results.finish(buildCustodyAttempt(manifest, trial))
	}
	await results.seal()
	const reading = await readStudyResult(directory)
	if (reading.status !== 'sealed') throw new Error('Fixture execution did not seal')
	return reading
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
