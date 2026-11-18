import { destroyScratch } from '@orkestrel/test/server'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { StudyTaskChild } from '../../../../src/server/processes/StudyTaskChild.js'
import { valueToWire } from '../../../../src/server/processes/helpers.js'
import {
	STUDY_TASK_WORKER_ADAPTER,
	STUDY_TASK_WORKER_TRIAL,
	buildStudyCLI,
	buildStudyTaskRequest,
	createStudyScratch,
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
		for (const directory of [7, 'relative/result']) {
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
					input: { directory, manifest: {}, seal: {}, attempts: [], rubric: {} },
				}),
			).rejects.toMatchObject({ code: 'CONFIG', message: 'Adapter grading input is invalid' })
		}
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
