import { createStudyScratch } from '../../../setupServer.js'
import { isRunning } from '@orkestrel/test/server'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { requireValue, waitForCondition, waitForEvent } from '@orkestrel/test'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { StudyCommand } from '../../../../src/server/commands/StudyCommand.js'
import { StudyDaemonSession } from '../../../../src/server/commands/StudyDaemonSession.js'
import { buildStudyExchangeDeclaration } from '../../../../src/server/processes/helpers.js'
import { buildStudyScenario } from '../../../setupStudy.js'
import {
	readStudyExchangeRows,
	readStudyExchanges,
	readStudyResult,
} from '../../../../src/server/stores/helpers.js'
import {
	buildStudyCLI,
	STUDY_DAEMON_ENDINGS,
	buildStudyLibrary,
	collectStudyRoots,
	createArtifactWorker,
	createStudyDaemonFixture,
	readStudyPid,
	releaseStudyPid,
} from '../../../setupServer.js'

describe('execution-owned daemon staging', () => {
	const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
	afterAll(() => library.destroy())
	it('F2 refuses a profile-mismatched declaration before daemon unload', async () => {
		const subject = await buildStudyLibrary(
			library,
			resolve('src/server/ollama/StudyOllamaTransport.ts'),
		)
		const fixture = await createStudyDaemonFixture(subject, 'normal', true)
		const scenario = buildStudyScenario()
		const trial = { id: 'r1-first-small', scenario: scenario.id, arm: 'small', repetition: 0 }
		const signal = new AbortController().signal
		const session = new StudyDaemonSession({
			profile: fixture.profile,
			scenarios: [scenario],
			workspace: fixture.scratch.path,
			signal,
		})
		try {
			await session.start()
			const traffic = fixture.scratch.read('daemon-requests.jsonl')
			const declaration = buildStudyExchangeDeclaration(fixture.profile, trial, scenario, true)
			await expect(
				session.prepare(trial, signal, {
					path: join(fixture.scratch.path, 'exchanges.jsonl'),
					declaration: { ...declaration, version: 'other-version' },
				}),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: 'Recording declaration differs from the executing profile or trial',
			})
			expect(fixture.scratch.read('daemon-requests.jsonl')).toBe(traffic)
			expect(fixture.scratch.has('exchanges.jsonl')).toBe(false)
		} finally {
			await session.stop()
			await fixture.close()
		}
	}, 60000)

	it('O1 joins open agent and summary maintenance to goals[0] and postflight to the last goal', async () => {
		const subject = await buildStudyLibrary(
			library,
			resolve('src/server/ollama/StudyOllamaTransport.ts'),
		)
		const fixture = await createStudyDaemonFixture(subject, 'normal', true)
		try {
			const entry = await buildStudyCLI(fixture.scratch)
			const command = new StudyCommand({ root: fixture.scratch.path, entry })
			const output = join(fixture.scratch.path, 'open')
			expect(
				await command.execute(
					['execute', 'assessment', '--out', output],
					new AbortController().signal,
				),
			).toMatchObject({ status: 'completed' })
			const result = await readStudyResult(output)
			if (result.status !== 'sealed') throw new Error('Open daemon recording did not seal')
			for (const trial of result.manifest.schedule) {
				const history = await readStudyExchanges(result, trial.id)
				expect(history.declaration.procedure).toBeUndefined()
				expect(history.declaration.goals).toEqual(['write', 'recall'])
				expect(
					history.exchanges
						.filter(({ attempt }) => attempt.stage === 'maintenance')
						.map(({ attempt }) => attempt.goal),
				).toEqual(['write', 'write'])
				expect(
					history.exchanges
						.filter(({ attempt }) => attempt.stage === 'execution')
						.map(({ attempt }) => [attempt.role, attempt.goal]),
				).toEqual([
					['agent', 'write'],
					['summary', 'recall'],
				])
				expect(
					history.exchanges
						.filter(({ attempt }) => attempt.stage === 'postflight')
						.map(({ attempt }) => attempt.goal),
				).toEqual(['recall', 'recall', 'recall', 'recall'])
			}
			expect(isRunning(requireValue(readStudyPid(fixture.scratch, 'daemon.pid')))).toBe(false)
			expect(isRunning(requireValue(readStudyPid(fixture.scratch, 'runner.pid')))).toBe(false)
		} finally {
			await fixture.close()
		}
	}, 60000)

	it('loads an adapter importing the Study server face in a captured worker with daemon staging present', async () => {
		const scratch = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
		try {
			await buildStudyCLI(scratch)
			const instrument = join(scratch.path, 'runtime')
			scratch.write(
				'runtime/package.json',
				JSON.stringify({
					name: '@orkestrel/study',
					version: '0.0.0-runtime',
					type: 'module',
					exports: { '.': './dist/src/core/index.js', './server': './dist/src/server/index.js' },
				}),
			)
			const adapter = scratch.write(
				'runtime/adapter/index.ts',
				readFileSync(resolve('tests/src/server/commands/fixtures/constants.ts'), 'utf8'),
			)
			const options = {
				entries: [],
				roots: [
					instrument,
					...collectStudyRoots([
						'@orkestrel/ollama',
						'@orkestrel/abort',
						'@orkestrel/timeout',
						'@orkestrel/tool',
					]),
				],
				instrument,
				source: { root: join(instrument, 'adapter'), entry: adapter },
			}
			const worker = createArtifactWorker(
				scratch,
				`const options = ${JSON.stringify(options)}
const artifacts = new ArtifactLoader(options)
const adapter = await artifacts.load(options.source.entry)
assert.equal(adapter.STUDY_SERVER_DIGEST, (await import('node:crypto')).createHash('sha256').update('captured-server').digest('hex'))
artifacts.verify()
console.log('captured-server-loaded')`,
			)
			const result = spawnSync(process.execPath, [worker], {
				encoding: 'utf8',
				timeout: 20000,
				windowsHide: true,
			})
			expect({ status: result.status, error: result.status === 0 ? '' : result.stderr }).toEqual({
				status: 0,
				error: '',
			})
			expect(result.stdout).toContain('captured-server-loaded')
		} finally {
			scratch.destroy()
		}
	}, 60000)

	it('stops and joins a started daemon when occupied output refuses custody before any trial', async () => {
		const subject = await buildStudyLibrary(
			library,
			resolve('src/server/ollama/StudyOllamaTransport.ts'),
		)
		const fixture = await createStudyDaemonFixture(subject)
		try {
			const entry = await buildStudyCLI(fixture.scratch)
			const command = new StudyCommand({ root: fixture.scratch.path, entry })
			fixture.scratch.write('occupied/keep.txt', 'caller-owned')
			const error = await command
				.execute(
					['execute', 'assessment', '--out', join(fixture.scratch.path, 'occupied')],
					new AbortController().signal,
				)
				.then(
					() => undefined,
					(failure: unknown) => failure,
				)
			expect(fixture.scratch.read('daemon-requests.jsonl')).toContain('/api/version')
			expect(fixture.scratch.read('daemon-requests.jsonl')).not.toContain('/api/generate')
			expect(fixture.scratch.has('workers.log')).toBe(false)
			expect(fixture.scratch.read('occupied/keep.txt')).toBe('caller-owned')
			expect(isRunning(requireValue(readStudyPid(fixture.scratch, 'daemon.pid')))).toBe(false)
			expect(isRunning(requireValue(readStudyPid(fixture.scratch, 'runner.pid')))).toBe(false)
			expect(error).toMatchObject({ code: 'EEXIST' })
		} finally {
			await fixture.close()
		}
	}, 60000)

	it('seals each trial maintenance prefix and replays offline without starting or contacting a daemon', async () => {
		const subject = await buildStudyLibrary(
			library,
			resolve('src/server/ollama/StudyOllamaTransport.ts'),
		)
		const fixture = await createStudyDaemonFixture(subject)
		try {
			const entry = await buildStudyCLI(fixture.scratch)
			const command = new StudyCommand({ root: fixture.scratch.path, entry })
			const original = join(fixture.scratch.path, 'live')
			expect(
				await command
					.execute(['execute', 'assessment', '--out', original], new AbortController().signal)
					.catch(async (error: unknown) => {
						const result = await readStudyResult(original).catch(() => undefined)
						throw new Error(
							`${String(error)}; failures: ${JSON.stringify(result?.attempts.map((attempt) => attempt.failure))}; requests: ${fixture.scratch.read('daemon-requests.jsonl')}`,
						)
					}),
			).toMatchObject({ status: 'completed' })
			const recorded = await readStudyResult(original)
			if (recorded.status !== 'sealed') throw new Error('Live result did not seal')
			expect(JSON.parse(requireValue(recorded.manifest.host.daemon))).toMatchObject({
				url: fixture.url,
				executable: { version: 'fixture-version' },
			})
			const histories = await Promise.all(
				recorded.manifest.schedule.map((trial) => readStudyExchanges(recorded, trial.id)),
			)
			for (const history of histories) {
				expect(history.declaration.maintenance.map((model) => model.name)).toEqual([
					'model',
					'judge',
				])
				expect(
					history.exchanges.slice(0, 2).map(({ attempt }) => ({
						ordinal: attempt.ordinal,
						goal: attempt.goal,
						role: attempt.role,
						body: Buffer.from(attempt.body, 'base64').toString(),
					})),
				).toEqual([
					{
						ordinal: 1,
						goal: 'write',
						role: 'maintenance',
						body: '{"model":"model","keep_alive":0}',
					},
					{
						ordinal: 2,
						goal: 'write',
						role: 'maintenance',
						body: '{"model":"judge","keep_alive":0}',
					},
				])
				expect(history.exchanges[2]?.attempt).toMatchObject({
					ordinal: 3,
					path: '/api/version',
					stage: 'preflight',
				})
				for (const { response } of history.exchanges.slice(0, 2)) {
					expect(response.headers).toContainEqual(['content-type', 'application/json'])
					expect(response.chunks.reduce((sum, size) => sum + size, 0)).toBe(response.size)
				}
			}
			expect(histories).toHaveLength(2)
			const requests = requireValue(fixture.scratch.read('daemon-requests.jsonl'))
				.split(/\r\n|\n/)
				.filter(Boolean)
				.map((line) => parseJSON(line))
				.filter(isRecord)
			expect(
				requests
					.filter((request) => request.path === '/api/generate')
					.map((request) => request.retained),
			).toEqual([true, true, true, true])
			expect(requests.slice(0, 2).map((request) => request.retained)).toEqual([false, false])
			expect(isRunning(requireValue(readStudyPid(fixture.scratch, 'daemon.pid')))).toBe(false)
			expect(isRunning(requireValue(readStudyPid(fixture.scratch, 'runner.pid')))).toBe(false)
			const before = fixture.scratch.read('daemon-requests.jsonl')
			const prefix = Object.fromEntries(
				histories.map((history) => [history.declaration.trial, history.exchanges.length]),
			)
			fixture.scratch.remove('daemon.pid')
			const output = join(fixture.scratch.path, 'offline')
			expect(
				await command
					.execute(
						[
							'execute',
							'assessment',
							'--out',
							output,
							'--replay',
							original,
							'--prefix',
							JSON.stringify(prefix),
							'--offline',
							'true',
						],
						new AbortController().signal,
					)
					.catch(async (error: unknown) => {
						const result = await readStudyResult(output).catch(() => undefined)
						throw new Error(
							`${String(error)}; replay failures: ${JSON.stringify(result?.attempts.map((attempt) => attempt.failure))}`,
						)
					}),
			).toMatchObject({ status: 'completed' })
			expect(fixture.scratch.has('daemon.pid')).toBe(false)
			expect(fixture.scratch.read('daemon-requests.jsonl')).toBe(before)
			const replayed = await readStudyResult(output)
			if (replayed.status !== 'sealed') throw new Error('Offline result did not seal')
			expect(replayed.manifest.host.daemon).toBeUndefined()
			expect(
				replayed.attempts.map((attempt) => attempt.observations.map((goal) => goal.product)),
			).toEqual(
				recorded.attempts.map((attempt) => attempt.observations.map((goal) => goal.product)),
			)
		} finally {
			await fixture.close()
		}
	}, 180000)

	it.each(STUDY_DAEMON_ENDINGS)(
		'stops and joins after %s while an unrelated sentinel survives',
		async (mode) => {
			const subject = await buildStudyLibrary(
				library,
				resolve('src/server/ollama/StudyOllamaTransport.ts'),
			)
			const fixture = await createStudyDaemonFixture(subject, mode)
			const sentinel = spawn(
				process.execPath,
				[resolve('tests/src/server/commands/fixtures/daemon.mjs'), 'sentinel'],
				{ stdio: ['ignore', 'pipe', 'pipe'] },
			)
			const controller = new AbortController()
			try {
				await waitForEvent(
					(receive) => {
						sentinel.stdout?.once('data', receive)
						return () => sentinel.stdout?.removeListener('data', receive)
					},
					'sentinel ready',
					{ budget: 10000 },
				)
				const entry = await buildStudyCLI(fixture.scratch)
				const command = new StudyCommand({ root: fixture.scratch.path, entry })
				const running = command
					.execute(
						['execute', 'assessment', '--out', join(fixture.scratch.path, 'result')],
						controller.signal,
					)
					.then(
						(value) => ({ value }),
						(error: unknown) => ({ error }),
					)
				if (mode === 'cancel') {
					await Promise.race([
						waitForCondition(
							'daemon model request',
							() => fixture.scratch.read('daemon-requests.jsonl')?.includes('/api/chat') === true,
							{ budget: 60000, interval: 20, signal: controller.signal },
						),
						running.then((result) => {
							throw new Error(`Execution ended before cancellation: ${JSON.stringify(result)}`)
						}),
					])
					controller.abort(new Error('Staging cancellation'))
				}
				const result = await running
				expect(
					'error' in result ||
						('value' in result &&
							typeof result.value === 'object' &&
							result.value !== null &&
							'status' in result.value &&
							result.value.status === 'operational-failure'),
				).toBe(true)
				expect(fixture.scratch.read('daemon-requests.jsonl')).toContain(
					mode === 'start-failure'
						? '/api/version'
						: mode === 'unload-failure'
							? '/api/generate'
							: '/api/chat',
				)
				expect(isRunning(requireValue(readStudyPid(fixture.scratch, 'daemon.pid')))).toBe(false)
				expect(isRunning(requireValue(readStudyPid(fixture.scratch, 'runner.pid')))).toBe(false)
				expect(isRunning(requireValue(sentinel.pid))).toBe(true)
				const retained = await readStudyResult(join(fixture.scratch.path, 'result')).catch(
					() => undefined,
				)
				const first = retained?.manifest?.schedule[0]
				const journal =
					first === undefined
						? undefined
						: fixture.scratch.read(`result/execution/trials/${first.id}/exchanges.jsonl`)
				const rows = journal === undefined ? [] : readStudyExchangeRows(Buffer.from(journal), false)
				expect(
					rows
						.filter((row) => row.phase === 'failure' && row.stage === 'maintenance')
						.map((row) => (row.phase === 'failure' ? row.response?.status : undefined)),
				).toEqual(mode === 'unload-failure' ? [500] : [])
			} finally {
				controller.abort()
				await fixture.close()
				await releaseStudyPid(sentinel.pid)
			}
		},
		180000,
	)
})
