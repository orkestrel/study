import { createScratch, isRunning } from '@orkestrel/test/server'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { requireValue, waitForCondition, waitForEvent } from '@orkestrel/test'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { StudyCommand } from '../../../../src/server/commands/StudyCommand.js'
import {
	readStudyExchangeRows,
	readStudyExchanges,
	readStudyResult,
} from '../../../../src/server/stores/helpers.js'
import {
	buildStudyCLI,
	STUDY_DAEMON_ENDINGS,
	buildStudyLibrary,
	createStudyDaemonFixture,
	readStudyPid,
	releaseStudyPid,
} from '../../../setupServer.js'

describe('execution-owned daemon staging', () => {
	const library = createScratch({ parent: resolve('tmp/units') })
	afterAll(() => library.destroy())

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
