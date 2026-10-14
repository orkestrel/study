import type { StudyLaunchResult } from '../src/server/launchers/types.js'
import type { ScratchInterface } from '@orkestrel/test/server'
import type { StudyGrading, StudyLabels, StudyManifest, StudyRubric } from '../src/core/types.js'
import type { StudySealedResult } from '../src/server/stores/types.js'
import { execFile } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import { isBuiltin } from 'node:module'
import { build } from 'vite'
import { srcBin, srcCore } from '../vite.config.js'
import { outputBoundary } from '../configs/helpers.js'
import {
	isStudyCharge,
	isStudyEvidence,
	isStudyFrame,
	isStudyIdentity,
	isStudyProcessFailure,
	isStudyProduct,
	isStudyTrial,
} from '../src/server/processes/validators.js'
import { StudyResults } from '../src/server/stores/StudyResults.js'
import {
	buildStudyPacket,
	buildStudyPacketLinks,
	encodeStudyJSON,
	hashStudyBytes,
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

/** Supplies every exported process guard for hostile-boundary proofs. */
export const STUDY_PROCESS_GUARDS = Object.freeze([
	isStudyFrame,
	isStudyProcessFailure,
	isStudyCharge,
	isStudyProduct,
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
	const library = new URL('../src/server/artifacts/', import.meta.url).href
	return scratch.write(
		'worker.mts',
		`import { registerHooks } from 'node:module'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
registerHooks({ resolve(specifier, context, next) {
 if (context.parentURL?.startsWith(${JSON.stringify(library)}) && specifier.startsWith('./') && specifier.endsWith('.js')) return next(new URL(specifier.slice(0, -3) + '.ts', context.parentURL).href, context)
 return next(specifier, context)
} })
const { Artifacts } = await import(${JSON.stringify(`${library}Artifacts.ts`)})
${body}
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
		version: 1,
		result: result.seal.id,
		rubric: hashStudyBytes(encodeStudyJSON(rubric)),
		grader: 'predicate-v1',
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
