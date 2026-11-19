import { requireValue } from '@orkestrel/test'
import { destroyScratch } from '@orkestrel/test/server'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { StudyTaskChild } from '../../../../src/server/processes/StudyTaskChild.js'
import { valueToWire } from '../../../../src/server/processes/helpers.js'
import {
	STUDY_PREDICATE_RUBRIC,
	STUDY_TASK_WORKER_ADAPTER,
	STUDY_TASK_WORKER_TRIAL,
	buildStudyBundleFixture,
	buildStudyCLI,
	buildStudyTaskRequest,
	createStudyScratch,
	retainStudyFixture,
	writeStudyMarkerAdapter,
} from '../../../setupServer.js'

describe('StudyTaskWorker', () => {
	const runtime = createStudyScratch(resolve('tmp/units'), 'runtime-task-')
	const adapter = runtime.write('adapter/index.ts', STUDY_TASK_WORKER_ADAPTER)
	const compiled = Promise.withResolvers<string>()
	// Registered before the build hook so the scratch is removed even when the build fails.
	afterAll(async () => {
		await destroyScratch(runtime)
	})
	beforeAll(async () => {
		compiled.resolve(await buildStudyCLI(runtime))
	}, 60000)

	it('answers a malformed request with a CONFIG refusal before resolving its runtime', async () => {
		const entry = await compiled.promise
		const child = new StudyTaskChild(
			{ root: runtime.path, entry, adapter, roots: [] },
			20000,
			new AbortController().signal,
		)
		await expect(
			child.execute({ operation: 'progress', entry, adapter, roots: 'none', input: {} }),
		).rejects.toMatchObject({ code: 'CONFIG', message: 'Adapter request is malformed' })
	}, 30000)

	it('refuses a malformed closure selection before any adapter module evaluates', async () => {
		const entry = await compiled.promise
		const child = new StudyTaskChild(
			{ root: runtime.path, entry, adapter, roots: [] },
			20000,
			new AbortController().signal,
		)
		await expect(
			child.execute({
				operation: 'progress',
				entry,
				adapter,
				roots: [],
				input: { targets: [] },
				closure: {},
			}),
		).rejects.toMatchObject({ code: 'CONFIG', message: 'Adapter closure selection is malformed' })
	}, 30000)

	it('refuses grading custody whose directory is not an absolute string before reading evidence', async () => {
		const entry = await compiled.promise
		const result = await retainStudyFixture(join(runtime.path, 'relative-result'))
		for (const directory of [7, relative(process.cwd(), result.directory)]) {
			const child = new StudyTaskChild(
				{ root: runtime.path, entry, adapter, roots: [] },
				20000,
				new AbortController().signal,
			)
			await expect(
				child.execute({
					operation: 'grade',
					entry,
					adapter,
					roots: [],
					input: valueToWire({
						directory,
						manifest: result.manifest,
						seal: result.seal,
						attempts: result.attempts,
						rubric: STUDY_PREDICATE_RUBRIC,
					}),
				}),
			).rejects.toMatchObject({ code: 'CONFIG', message: 'Adapter grading input is invalid' })
		}
	}, 60000)

	it('refuses grading custody whose seal names another result before reading evidence', async () => {
		const entry = await compiled.promise
		const result = await retainStudyFixture(join(runtime.path, 'foreign-result'))
		await expect(
			new StudyTaskChild(
				{ root: runtime.path, entry, adapter, roots: [] },
				20000,
				new AbortController().signal,
			).execute({
				operation: 'grade',
				entry,
				adapter,
				roots: [],
				input: valueToWire({
					directory: result.directory,
					manifest: result.manifest,
					seal: { ...result.seal, result: randomUUID() },
					attempts: result.attempts,
					rubric: STUDY_PREDICATE_RUBRIC,
				}),
			}),
		).rejects.toMatchObject({ code: 'CONFIG', message: 'Adapter grading input is invalid' })
	}, 60000)

	it('reads and verifies sealed evidence before any adapter module evaluates', async () => {
		const entry = await compiled.promise
		const { adapter: marked, marker } = writeStudyMarkerAdapter(runtime, 'marked')
		const { manifest, roots } = buildStudyBundleFixture(runtime, entry, marked)
		const options = { root: runtime.path, entry, adapter: marked, roots }
		const result = await retainStudyFixture(join(runtime.path, 'marked-result'), manifest)
		const trial = requireValue(result.manifest.schedule[0])
		const path = join(result.directory, 'execution', 'trials', trial.id, 'evidence.jsonl')
		const original = readFileSync(path)
		const request = {
			operation: 'grade',
			root: runtime.path,
			entry,
			adapter: marked,
			roots,
			input: valueToWire({
				directory: result.directory,
				manifest: result.manifest,
				seal: result.seal,
				attempts: result.attempts,
				rubric: STUDY_PREDICATE_RUBRIC,
			}),
		}
		writeFileSync(
			path,
			`${original.toString('utf8')}{"event":"saved","goal":"write","value":"x"}\n`,
		)
		await expect(
			new StudyTaskChild(options, 20000, new AbortController().signal).execute(request),
		).rejects.toMatchObject({
			code: 'CUSTODY',
			message: 'Evidence changed after execution verification',
		})
		expect(existsSync(marker)).toBe(false)
		writeFileSync(path, original)
		await expect(
			new StudyTaskChild(options, 20000, new AbortController().signal).execute(request),
		).resolves.toEqual({ instrument: expect.stringMatching(/^[a-f0-9]{64}$/), value: [] })
		expect(existsSync(marker)).toBe(true)
	}, 60000)

	it('validates declarations and projects progress through the adapter under one instrument identity', async () => {
		const entry = await compiled.promise
		const validated = await new StudyTaskChild(
			{ root: runtime.path, entry, adapter, roots: [] },
			20000,
			new AbortController().signal,
		).execute({
			operation: 'validate',
			entry,
			adapter,
			roots: [],
			input: valueToWire(buildStudyTaskRequest().input),
		})
		const projected = await new StudyTaskChild(
			{ root: runtime.path, entry, adapter, roots: [] },
			20000,
			new AbortController().signal,
		).execute({
			operation: 'progress',
			entry,
			adapter,
			roots: [],
			input: { targets: [{ trial: STUDY_TASK_WORKER_TRIAL, goal: 'write', evidence: [] }] },
		})
		expect(validated).toEqual({ instrument: expect.stringMatching(/^[a-f0-9]{64}$/), value: true })
		expect(projected).toEqual({
			instrument: validated.instrument,
			value: [{ trial: 'r1-first-small', goal: 'write', rows: 0 }],
		})
	}, 60000)

	it('refuses an invalid progress target and an unknown operation as CONFIG', async () => {
		const entry = await compiled.promise
		await expect(
			new StudyTaskChild(
				{ root: runtime.path, entry, adapter, roots: [] },
				20000,
				new AbortController().signal,
			).execute({
				operation: 'progress',
				entry,
				adapter,
				roots: [],
				input: { targets: [{ trial: STUDY_TASK_WORKER_TRIAL, goal: 7, evidence: [] }] },
			}),
		).rejects.toMatchObject({ code: 'CONFIG', message: 'Adapter progress input is invalid' })
		await expect(
			new StudyTaskChild(
				{ root: runtime.path, entry, adapter, roots: [] },
				20000,
				new AbortController().signal,
			).execute({ operation: 'other', entry, adapter, roots: [], input: {} }),
		).rejects.toMatchObject({ code: 'CONFIG', message: 'Unknown adapter operation' })
	}, 60000)
})
