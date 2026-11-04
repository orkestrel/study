import { createStudyScratch } from '../../../setupServer.js'
import { isRunning } from '@orkestrel/test/server'
import { isArray, isRecord, parseJSON } from '@orkestrel/contract'
import { createRecorder, requireValue } from '@orkestrel/test'
import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readStudyClosure } from '../../../../src/server/commands/helpers.js'
import { StudyCommand } from '../../../../src/server/commands/StudyCommand.js'
import { parseStudyArguments } from '../../../../src/server/commands/parsers.js'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { hashStudyBytes } from '../../../../src/server/helpers.js'
import { STUDY_OPEN_BOUND_CASES, STUDY_OLLAMA_PARTIAL_ROW } from '../../../setupStudy.js'
import {
	readStudyExchangeRows,
	readStudyExchanges,
	readStudyResult,
	scanStudyDivergence,
} from '../../../../src/server/stores/helpers.js'
import {
	buildStudyCLI,
	buildStudyLibrary,
	createOllamaServer,
	createStudyConsumer,
	mutateStudyExchangeRows,
	writeStudyRecordingConsumer,
	createStudyReplayFixture,
	STUDY_REPLAY_DIVERGENCE_CASES,
	createStudyContinuationFixture,
	buildStudyContinuationRefusals,
	retainStudyContinuationSource,
	readStudyPid,
	STUDY_CONTINUATION_DIVERGENCES,
	STUDY_CONTINUATION_SOURCES,
	STUDY_CONTINUATION_COMMANDS,
	STUDY_SELECTION_NUMBERS,
	STUDY_SELECTION_PROFILE,
	STUDY_SELECTION_RUBRIC,
	STUDY_SELECTION_ROW,
	buildStudySelectionRefusals,
	readStudySelectionOpens,
	writeStudySelectionConsumer,
} from '../../../setupServer.js'

describe('recording and replay command handoff', () => {
	it.each(STUDY_CONTINUATION_COMMANDS)(
		'F1 %s refuses a continuation profile changed between its early comparison and executing preparation',
		async (operation) => {
			const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
			const subject = await buildStudyLibrary(
				library,
				resolve('src/server/ollama/StudyOllamaTransport.ts'),
			)
			const fixture = await createStudyContinuationFixture(subject)
			try {
				const { scratch, command, recorded, profile } = fixture
				const path = 'studies/files/profiles/local.json'
				const original = requireValue(scratch.read(path))
				const provider = requireValue(profile.provider)
				const daemon = requireValue(provider.daemon)
				const changed = JSON.stringify({
					...profile,
					provider: {
						...provider,
						daemon: { ...daemon, environment: { ...daemon.environment, OLLAMA_NUM_PARALLEL: '2' } },
					},
				})
				const traffic = scratch.read('daemon-requests.jsonl')
				const pid = readStudyPid(scratch, 'daemon.pid')
				const workers = scratch.read('workers.log')
				const signal = new AbortController().signal
				const checkpoints = createRecorder<readonly []>()
				Object.defineProperty(signal, 'throwIfAborted', {
					value: () => {
						AbortSignal.prototype.throwIfAborted.call(signal)
						checkpoints.handler()
						// The caller check and scenario read precede the per-trial continuation checkpoint.
						if (checkpoints.count === 3) scratch.write(path, changed)
					},
				})
				try {
					await expect(
						command.execute(
							[
								operation,
								'assessment',
								'--extend',
								recorded,
								...(operation === 'execute' ? ['--out', join(scratch.path, 'refused')] : []),
							],
							signal,
						),
					).rejects.toMatchObject({
						code: 'CONFIG',
						message: 'Continuation recording configuration changed',
					})
					expect(checkpoints.count).toBeGreaterThanOrEqual(3)
					expect(scratch.read(path)).toBe(changed)
					expect(scratch.read('daemon-requests.jsonl')).toBe(traffic)
					expect(readStudyPid(scratch, 'daemon.pid')).toBe(pid)
					expect(scratch.read('workers.log')).toBe(workers)
					expect(scratch.has('refused')).toBe(false)
				} finally {
					scratch.write(path, original)
				}
			} finally {
				await fixture.close()
				library.destroy()
			}
		},
		120000,
	)

	it('CT2 refuses changed continuation declarations before daemon startup or worker opening and binds the ancestor seal', async () => {
		const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
		const subject = await buildStudyLibrary(
			library,
			resolve('src/server/ollama/StudyOllamaTransport.ts'),
		)
		const fixture = await createStudyContinuationFixture(subject)
		try {
			const { scratch, command, recorded } = fixture
			const traffic = scratch.read('daemon-requests.jsonl')
			const workers = scratch.read('workers.log')
			const daemon = readStudyPid(scratch, 'daemon.pid')
			for (const row of buildStudyContinuationRefusals(fixture)) {
				scratch.write(row.path, row.changed)
				try {
					await expect(
						command.execute(
							['check', 'assessment', '--extend', recorded],
							new AbortController().signal,
						),
					).rejects.toMatchObject({ code: 'CONFIG' })
					await expect(
						command.execute(
							[
								'execute',
								'assessment',
								'--extend',
								recorded,
								'--out',
								join(scratch.path, 'refused'),
							],
							new AbortController().signal,
						),
					).rejects.toMatchObject({ code: 'CONFIG' })
					expect(scratch.read('daemon-requests.jsonl')).toBe(traffic)
					expect(scratch.read('workers.log')).toBe(workers)
					expect(readStudyPid(scratch, 'daemon.pid')).toBe(daemon)
					expect(scratch.has('refused')).toBe(false)
				} finally {
					scratch.write(row.path, row.original)
				}
			}
			await expect(
				command.execute(
					['execute', 'assessment', '--extend', join(scratch.path, 'missing')],
					new AbortController().signal,
				),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			for (const row of STUDY_CONTINUATION_SOURCES) {
				const ancestor = await retainStudyContinuationSource(
					fixture,
					row.name,
					row.recorded,
					row.declared,
					row.sealed,
				)
				await expect(
					command.execute(
						['execute', 'assessment', '--extend', ancestor, '--out', join(scratch.path, 'refused')],
						new AbortController().signal,
					),
				).rejects.toMatchObject({ code: row.code })
				expect(scratch.read('daemon-requests.jsonl')).toBe(traffic)
				expect(scratch.read('workers.log')).toBe(workers)
				expect(scratch.has('refused')).toBe(false)
			}
			const argumentsCount = process.execArgv.length
			process.execArgv.push('--no-warnings')
			try {
				await expect(
					command.execute(
						['execute', 'assessment', '--extend', recorded, '--out', join(scratch.path, 'refused')],
						new AbortController().signal,
					),
				).rejects.toMatchObject({
					code: 'CONFIG',
					message: 'Continuation runtime or content changed',
				})
			} finally {
				process.execArgv.splice(argumentsCount)
			}
			const ordinary = await command.execute(['check', 'assessment'], new AbortController().signal)
			const checked = await command.execute(
				['check', 'assessment', '--extend', recorded],
				new AbortController().signal,
			)
			const alternate = await retainStudyContinuationSource(fixture, 'alternate', true, false)
			const second = await command.execute(
				['check', 'assessment', '--extend', alternate],
				new AbortController().signal,
			)
			if (
				!isRecord(ordinary) ||
				!isRecord(checked) ||
				!isRecord(second) ||
				typeof ordinary.fingerprint !== 'string' ||
				typeof checked.fingerprint !== 'string'
			)
				throw new Error('Missing checked fingerprints')
			expect(checked.fingerprint).not.toBe(ordinary.fingerprint)
			expect(checked.fingerprint).not.toBe(second.fingerprint)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--extend',
						recorded,
						'--expected',
						ordinary.fingerprint,
						'--out',
						join(scratch.path, 'refused'),
					],
					new AbortController().signal,
				),
			).rejects.toMatchObject({ code: 'CONFIG' })
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--extend',
						alternate,
						'--expected',
						checked.fingerprint,
						'--out',
						join(scratch.path, 'refused'),
					],
					new AbortController().signal,
				),
			).rejects.toMatchObject({ code: 'CONFIG' })
			expect(scratch.read('daemon-requests.jsonl')).toBe(traffic)
			expect(scratch.read('workers.log')).toBe(workers)
			expect(readStudyPid(scratch, 'daemon.pid')).toBe(daemon)
			expect(scratch.has('refused')).toBe(false)
		} finally {
			await fixture.close()
			library.destroy()
		}
	}, 240000)

	it.each(STUDY_CONTINUATION_DIVERGENCES)(
		'CT2 retains an environment-driven %s prefix divergence with zero live model requests',
		async (change) => {
			const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
			const subject = await buildStudyLibrary(
				library,
				resolve('src/server/ollama/StudyOllamaTransport.ts'),
			)
			const fixture = await createStudyContinuationFixture(subject)
			const previous = process.env.STUDY_EXTENSION_CHANGE
			try {
				const { scratch, command, recorded, history } = fixture
				const before = requireValue(scratch.read('daemon-requests.jsonl'))
					.split(/\r\n|\n/)
					.filter(Boolean).length
				process.env.STUDY_EXTENSION_CHANGE = change
				const error = await command
					.execute(
						['execute', 'assessment', '--extend', recorded, '--out', join(scratch.path, 'live')],
						new AbortController().signal,
					)
					.then(
						() => undefined,
						(failure: unknown) => failure,
					)
				expect(isRunning(requireValue(readStudyPid(scratch, 'daemon.pid')))).toBe(false)
				expect(isRunning(requireValue(readStudyPid(scratch, 'runner.pid')))).toBe(false)
				expect(error).toMatchObject({ code: 'CUSTODY' })
				const traffic = requireValue(scratch.read('daemon-requests.jsonl'))
					.split(/\r\n|\n/)
					.filter(Boolean)
					.slice(before)
					.map((line) => parseJSON(line))
					.filter(isRecord)
				expect(traffic.map((row) => row.path)).toEqual([
					'/api/version',
					'/api/tags',
					'/api/generate',
					'/api/generate',
				])
				const rows = readStudyExchangeRows(
					Buffer.from(requireValue(scratch.read(`live/execution/${history.file.path}`))),
					false,
				)
				const failure = rows.find((row) => row.phase === 'failure')
				if (failure?.phase !== 'failure') throw new Error('Missing prefix failure terminal')
				expect(failure.ordinal).toBe(change === 'body' ? 7 : 8)
				expect(failure.reason).toContain(change === 'body' ? 'member=body' : 'member=path')
				expect(failure.reason).toContain(
					change === 'body'
						? 'ordinal=7 step=1 role=agent path=/api/chat'
						: 'ordinal=8 step=absent role=metadata path=/api/version',
				)
				expect(failure.reason).toContain('goal=write')
				expect(rows.some((row) => row.phase === 'complete')).toBe(false)
				const divergence = requireValue(scanStudyDivergence(history, rows))
				expect(divergence.ordinal).toBe(failure.ordinal)
				expect(divergence.actual?.goal).toBe('write')
				expect(divergence.actual?.role).toBe('agent')
				expect(divergence.expected?.stage).toBe(change === 'body' ? 'execution' : 'postflight')
				expect((await readStudyResult(join(scratch.path, 'live'))).status).toBe('interrupted')
			} finally {
				if (previous === undefined) delete process.env.STUDY_EXTENSION_CHANGE
				else process.env.STUDY_EXTENSION_CHANGE = previous
				await fixture.close()
				library.destroy()
			}
		},
		120000,
	)
	it('RP1 replays a complete open recording offline with equal products and zero sends', async () => {
		const fixture = await createStudyReplayFixture()
		try {
			const { command, recorded, history, scratch, result, server } = fixture
			const before = server.requests.length
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						join(scratch.path, 'offline'),
						'--replay',
						recorded,
						'--prefix',
						JSON.stringify({ [history.declaration.trial]: history.completion.count }),
						'--offline',
						'true',
					],
					new AbortController().signal,
				),
			).resolves.toMatchObject({ status: 'completed' })
			const replayed = await readStudyResult(join(scratch.path, 'offline'))
			if (replayed.status !== 'sealed') throw new Error('Open replay did not seal')
			expect(server.requests.length).toBe(before)
			expect(
				replayed.attempts.flatMap((attempt) => attempt.observations.map((goal) => goal.product)),
			).toEqual(
				result.attempts.flatMap((attempt) => attempt.observations.map((goal) => goal.product)),
			)
			const rows = readStudyExchangeRows(
				Buffer.from(requireValue(scratch.read(`offline/execution/${history.file.path}`))),
			)
			expect(scanStudyDivergence(history, rows)).toBeUndefined()
		} finally {
			await fixture.close()
		}
	}, 120000)

	it.each(STUDY_REPLAY_DIVERGENCE_CASES)(
		'RP2 retains %s divergence at its recorded position with zero sends',
		async (change) => {
			const fixture = await createStudyReplayFixture()
			try {
				const { profile, history, command, recorded, server, scratch } = fixture
				const settings = profile.settings
				if (!isRecord(settings) || !isArray(settings.requests))
					throw new Error('Missing replay requests')
				const requests = settings.requests
				const modified =
					change === 'extra'
						? [...requests, requests.at(-1)]
						: requests.map((request, index) => {
								if (
									index !== 0 ||
									!isRecord(request) ||
									typeof request.body !== 'string' ||
									change === 'early'
								)
									return request
								return {
									...request,
									body:
										change === 'same-length'
											? request.body.replace('remember', 'Remember')
											: request.body.replace('remember', 'remember more'),
								}
							})
				scratch.write(
					'studies/files/profiles/changed.json',
					JSON.stringify({
						...profile,
						name: 'changed',
						record: { ...profile.record, calls: change === 'early' ? 1 : 4 },
						settings: { ...settings, requests: modified },
						bounds: {
							...profile.bounds,
							goal: { ...profile.bounds.goal, calls: 3, tokens: 24576 },
							trial: { ...profile.bounds.trial, calls: 6, tokens: 49152 },
						},
					}),
				)
				const before = server.requests.length
				const output = join(scratch.path, 'changed')
				await expect(
					command.execute(
						[
							'execute',
							'assessment',
							'--profile',
							'changed',
							'--out',
							output,
							'--replay',
							recorded,
							'--prefix',
							JSON.stringify({ [history.declaration.trial]: history.completion.count }),
							'--offline',
							'true',
						],
						new AbortController().signal,
					),
				).rejects.toMatchObject({ code: 'CUSTODY' })
				const rows = readStudyExchangeRows(
					Buffer.from(requireValue(scratch.read(`changed/execution/${history.file.path}`))),
					false,
				)
				const divergence = requireValue(scanStudyDivergence(history, rows))
				expect(server.requests.length).toBe(before)
				expect(divergence.ordinal).toBe(change === 'extra' ? 8 : change === 'early' ? 6 : 5)
				expect(divergence.expected).toEqual(history.exchanges[divergence.ordinal - 1]?.attempt)
				const actual = divergence.actual
				const expected = requireValue(divergence.expected)
				const failure = rows.find((row) => row.phase === 'failure')
				const reason = failure?.phase === 'failure' ? failure.reason : undefined
				const body = Buffer.from(expected.body, 'base64')
				const offset =
					change === 'early'
						? undefined
						: change === 'extra'
							? 0
							: body.indexOf('remember') + (change === 'same-length' ? 0 : 8)
				expect(divergence.offset).toBe(offset)
				expect(actual === undefined).toBe(change === 'early')
				expect(expected.stage).toBe(change === 'extra' ? 'postflight' : 'execution')
				expect(actual?.path).toBe(
					change === 'early' ? undefined : change === 'extra' ? '/api/generate' : '/api/chat',
				)
				expect(actual?.size === expected.size).toBe(change === 'same-length')
				expect(failure?.phase === 'failure' ? failure.ordinal : undefined).toBe(actual?.ordinal)
				expect(rows.some((row) => row.phase === 'failure')).toBe(change !== 'early')
				expect(reason?.length ?? 0).toBeLessThanOrEqual(256)
				expect(reason?.includes(`ordinal=${divergence.ordinal}`)).toBe(
					change === 'early' ? undefined : true,
				)
				expect(reason?.includes(`step=${expected.step ?? 'absent'}`)).toBe(
					change === 'early' ? undefined : true,
				)
				expect(reason?.includes(`goal=${expected.goal}`)).toBe(
					change === 'early' ? undefined : true,
				)
				expect(reason?.includes(`role=${expected.role}`)).toBe(
					change === 'early' ? undefined : true,
				)
				expect(reason?.includes(`path=${expected.path}`)).toBe(
					change === 'early' ? undefined : true,
				)
				expect(
					reason?.includes(
						change === 'extra'
							? 'member=path'
							: `member=body offset=${offset} sizes=${expected.size}/${actual?.size}`,
					),
				).toBe(change === 'early' ? undefined : true)
				expect(rows.some((row) => row.phase === 'complete')).toBe(false)
			} finally {
				await fixture.close()
			}
		},
		120000,
	)

	it('RP4 refuses invalid prefixes and seals with record calls beyond the metadata allowance and linked ancestry', async () => {
		const fixture = await createStudyReplayFixture()
		try {
			const { command, recorded, scratch, history, result, server } = fixture
			const before = server.requests.length
			for (const [prefix, offline] of [
				[history.completion.count - 1, true],
				[1, false],
				[history.completion.count - 1, false],
			] as const) {
				await expect(
					command.execute(
						[
							'execute',
							'assessment',
							'--out',
							join(scratch.path, 'refused'),
							'--replay',
							recorded,
							'--prefix',
							JSON.stringify({ [history.declaration.trial]: prefix }),
							'--offline',
							String(offline),
						],
						new AbortController().signal,
					),
				).rejects.toMatchObject({ code: 'CONFIG' })
				expect(scratch.has('refused')).toBe(false)
			}
			expect(history.completion.count).toBeGreaterThan(history.declaration.metadata.calls)
			await command.execute(
				[
					'execute',
					'assessment',
					'--out',
					join(scratch.path, 'linked'),
					'--replay',
					recorded,
					'--prefix',
					JSON.stringify({ [history.declaration.trial]: history.completion.count }),
					'--offline',
					'true',
				],
				new AbortController().signal,
			)
			const replayed = await readStudyResult(join(scratch.path, 'linked'))
			if (replayed.status !== 'sealed') throw new Error('Bounded replay did not seal')
			const ancestor = {
				result: result.manifest.id,
				seal: result.seal.id,
				identity: result.manifest.identity,
			}
			expect(replayed.manifest.ancestor).toEqual(ancestor)
			expect(
				(await readStudyExchanges(replayed, history.declaration.trial)).declaration.ancestor,
			).toEqual({ ...ancestor, file: history.file, prefix: history.completion.count })
			expect(server.requests.length).toBe(before)
		} finally {
			await fixture.close()
		}
	}, 120000)
	it.each(STUDY_OPEN_BOUND_CASES)(
		'retains interrupted custody and charges when open record.%s stops a trial',
		async (bound) => {
			const scratch = createStudyConsumer()
			const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
			const server = await createOllamaServer(
				bound === 'duration'
					? [{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }]
					: [],
			)
			try {
				const subject = await buildStudyLibrary(
					library,
					resolve('src/server/ollama/StudyOllamaTransport.ts'),
				)
				writeStudyRecordingConsumer(scratch, server.url, subject, true)
				const profile = parseStudyProfile(
					parseJSON(scratch.read('studies/files/profiles/local.json') ?? ''),
				)
				scratch.write(
					'studies/files/profiles/local.json',
					JSON.stringify({
						...profile,
						record: {
							bytes: 32768,
							calls: bound === 'calls' ? 1 : 8,
							duration: bound === 'duration' ? 100 : 15000,
						},
					}),
				)
				const entry = await buildStudyCLI(scratch)
				const command = new StudyCommand({ root: scratch.path, entry })
				const output = join(scratch.path, 'bounded')
				await expect(
					command.execute(['execute', 'assessment', '--out', output], new AbortController().signal),
				).rejects.toMatchObject({ code: 'CUSTODY' })
				const result = await readStudyResult(output)
				expect(result.status).toBe('interrupted')
				const attempt = result.attempts[0]
				if (attempt === undefined) throw new Error('Missing bounded attempt')
				expect(attempt.failure).toMatchObject({
					cause: bound === 'calls' ? 'capacity' : 'deadline',
					stop: {
						layer: 'scope',
						id: bound === 'calls' ? 'Recording calls' : 'Recording duration',
					},
				})
				expect(
					attempt.observations
						.flatMap((goal) => goal.usage)
						.reduce((sum, usage) => sum + usage.calls, 0),
				).toBeGreaterThan(0)
				const rows = readStudyExchangeRows(
					Buffer.from(
						scratch.read(`bounded/execution/trials/${attempt.trial.id}/exchanges.jsonl`) ?? '',
					),
					false,
				)
				expect(
					rows.filter((row) => row.phase === 'attempt' && row.stage === 'execution'),
				).toHaveLength(1)
				expect(rows.some((row) => row.phase === 'complete')).toBe(false)
				expect(rows.some((row) => row.phase === 'failure' && row.stage === 'execution')).toBe(
					bound === 'duration',
				)
				expect(scratch.has('bounded/seal.json')).toBe(false)
			} finally {
				await server.close()
				library.destroy()
				scratch.destroy()
			}
		},
		120000,
	)

	it('keyed: serves a listed role from a sealed recording and sends every other request live', async () => {
		const fixture = await createStudyReplayFixture()
		const signal = new AbortController().signal
		try {
			const { scratch, command, recorded, server } = fixture
			const before = server.requests.length
			const output = join(scratch.path, 'keyed')
			const options = process.env.NODE_OPTIONS
			// A runtime identity binds NODE_OPTIONS, so this run differs from the recording's runtime.
			process.env.NODE_OPTIONS = '--no-warnings'
			const executed = await command
				.execute(
					[
						'execute',
						'assessment',
						'--out',
						output,
						'--replay',
						recorded,
						'--roles',
						'["judge"]',
						'--offline',
						'false',
					],
					signal,
				)
				.finally(() => {
					if (options === undefined) delete process.env.NODE_OPTIONS
					else process.env.NODE_OPTIONS = options
				})
			expect(executed).toMatchObject({ status: 'completed' })
			const live = server.requests.slice(before).map((request) => request.path)
			expect(live.filter((path) => path === '/api/generate')).toEqual([])
			expect(live.filter((path) => path === '/api/chat').length).toBeGreaterThan(0)
			const result = await readStudyResult(output)
			if (result.status !== 'sealed') throw new Error('Keyed replay did not seal')
			expect(result.manifest.identity.runtime).not.toBe(fixture.result.manifest.identity.runtime)
			expect(result.manifest.keyed).toEqual({
				result: fixture.result.manifest.id,
				seal: fixture.result.seal.id,
				identity: fixture.result.manifest.identity,
				roles: ['judge'],
				offline: false,
			})
			expect(result.manifest.ancestor).toBeUndefined()
			const trial = requireValue(result.manifest.schedule[0]).id
			const history = await readStudyExchanges(result, trial)
			expect(history.declaration.keyed).toEqual(result.manifest.keyed)
			const original = fixture.history.exchanges.find(({ attempt }) => attempt.role === 'judge')
			const served = history.exchanges.find(({ attempt }) => attempt.role === 'judge')
			expect(served?.response.body).toBe(original?.response.body)
			const wires = (scratch.read(`keyed/execution/trials/${trial}/evidence.jsonl`) ?? '')
				.split('\n')
				.filter((line) => line !== '')
				.map((line) => parseJSON(line))
				.flatMap((row) =>
					isRecord(row) && row.event === 'wire' && isRecord(row.value) ? [row.value] : [],
				)
			expect(wires.filter((wire) => wire.replayed === true).map((wire) => wire.role)).toEqual([
				'judge',
			])
			const progress = await command.execute(['progress', output, '--from', 'write'], signal)
			const usage = JSON.stringify(progress)
			expect(usage).toContain('"role":"judge","calls":1,"replayed":1')
			expect(usage).toContain('"role":"agent","calls":1,"replayed":0')
		} finally {
			await fixture.close()
		}
	}, 240000)

	it('keyed: offline serves a whole recording with no send and refuses a miss before send', async () => {
		const fixture = await createStudyReplayFixture()
		const signal = new AbortController().signal
		try {
			const { scratch, command, recorded, server } = fixture
			const before = server.requests.length
			const whole = join(scratch.path, 'whole')
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						whole,
						'--replay',
						recorded,
						'--roles',
						'["agent","summary","judge","metadata"]',
						'--offline',
						'true',
					],
					signal,
				),
			).resolves.toMatchObject({ status: 'completed' })
			expect(server.requests).toHaveLength(before)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						join(scratch.path, 'miss'),
						'--replay',
						recorded,
						'--roles',
						'["judge"]',
						'--offline',
						'true',
					],
					signal,
				),
			).rejects.toBeDefined()
			expect(server.requests).toHaveLength(before)
		} finally {
			await fixture.close()
		}
	}, 240000)

	it('keyed: a tampered recorded row refuses custody before any send or result', async () => {
		const fixture = await createStudyReplayFixture()
		const signal = new AbortController().signal
		try {
			const { scratch, command, recorded, server, result, profile } = fixture
			const trial = requireValue(result.manifest.schedule[0]).id
			const provider = requireValue(profile.provider)
			const original = requireValue(scratch.read('studies/files/profiles/local.json'))
			scratch.write(
				'studies/files/profiles/local.json',
				JSON.stringify({
					...profile,
					provider: { ...provider, digest: { ...provider.digest, model: 'c'.repeat(64) } },
				}),
			)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						join(scratch.path, 'other-models'),
						'--replay',
						recorded,
						'--roles',
						'["judge"]',
						'--offline',
						'false',
					],
					signal,
				),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: expect.stringContaining('declares other models'),
			})
			scratch.write('studies/files/profiles/local.json', original)
			appendFileSync(join(recorded, 'execution', 'trials', trial, 'exchanges.jsonl'), ' ')
			const before = server.requests.length
			const output = join(scratch.path, 'tampered')
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						output,
						'--replay',
						recorded,
						'--roles',
						'["judge"]',
						'--offline',
						'false',
					],
					signal,
				),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			expect(server.requests).toHaveLength(before)
			expect(scratch.has('tampered')).toBe(false)
		} finally {
			await fixture.close()
		}
	}, 240000)

	it('retains a worker wire cut in evidence beside the attempt and the exchange failure', async () => {
		const scratch = createStudyConsumer()
		const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
		const server = await createOllamaServer([{ path: '/api/chat', body: 'x'.repeat(4096) }])
		try {
			const subject = await buildStudyLibrary(
				library,
				resolve('src/server/ollama/StudyOllamaTransport.ts'),
			)
			writeStudyRecordingConsumer(scratch, server.url, subject, true)
			const profile = parseStudyProfile(
				parseJSON(scratch.read('studies/files/profiles/local.json') ?? ''),
			)
			scratch.write(
				'studies/files/profiles/local.json',
				JSON.stringify({
					...profile,
					bounds: {
						...profile.bounds,
						request: { ...profile.bounds.request, bytes: 2048 },
					},
				}),
			)
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const output = join(scratch.path, 'cut')
			await expect(
				command.execute(['execute', 'assessment', '--out', output], new AbortController().signal),
			).rejects.toBeDefined()
			const result = await readStudyResult(output)
			const attempt = requireValue(result.attempts[0])
			expect(attempt.failure).toMatchObject({ stop: { layer: 'scope', id: 'Wire bytes' } })
			const folder = `cut/execution/trials/${attempt.trial.id}`
			const rows = (scratch.read(`${folder}/evidence.jsonl`) ?? '')
				.split('\n')
				.filter((line) => line !== '')
				.map((line) => parseJSON(line))
			const events = rows.flatMap((row) => (isRecord(row) ? [row.event] : []))
			expect(events.filter((name) => name === 'dispatch').length).toBe(
				events.filter((name) => name === 'wire').length + 1,
			)
			expect(events.filter((name) => name === 'stop')).toHaveLength(1)
			expect(events.filter((name) => name === 'failure')).toHaveLength(1)
			const exchanges = readStudyExchangeRows(
				Buffer.from(scratch.read(`${folder}/exchanges.jsonl`) ?? ''),
				false,
			)
			expect(exchanges.some((row) => row.phase === 'failure' && row.stage === 'execution')).toBe(
				true,
			)
		} finally {
			await server.close()
			library.destroy()
			scratch.destroy()
		}
	}, 120000)

	it('O1 seals unpredicted agent summary and judge bodies without a procedure and joins their ordinals', async () => {
		const scratch = createStudyConsumer()
		const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
		const server = await createOllamaServer()
		try {
			const subject = await buildStudyLibrary(
				library,
				resolve('src/server/ollama/StudyOllamaTransport.ts'),
			)
			writeStudyRecordingConsumer(scratch, server.url, subject, true)
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const output = join(scratch.path, 'open')
			expect(
				await command.execute(
					['execute', 'assessment', '--out', output],
					new AbortController().signal,
				),
			).toMatchObject({ status: 'completed' })
			const result = await readStudyResult(output)
			if (result.status !== 'sealed') throw new Error('Open recording did not seal')
			const histories = await Promise.all(
				result.manifest.schedule.map((trial) => readStudyExchanges(result, trial.id)),
			)
			expect(
				histories.flatMap((history) =>
					history.exchanges.map(({ attempt }) => ({
						path: attempt.path,
						body: Buffer.from(attempt.body, 'base64').toString(),
					})),
				),
			).toEqual(server.requests)
			for (const history of histories) {
				expect(history.declaration.procedure).toBeUndefined()
				expect(history.declaration.goals).toEqual(['write', 'recall'])
				expect(history.declaration.record).toEqual(result.manifest.record)
				expect(history.declaration.configuration).toMatch(/^[a-f0-9]{64}$/)
				const executions = history.exchanges.filter(({ attempt }) => attempt.stage === 'execution')
				expect(
					executions.map(({ attempt }) => [
						attempt.ordinal,
						attempt.step,
						attempt.role,
						attempt.goal,
					]),
				).toEqual([
					[5, 1, 'agent', 'write'],
					[6, 2, 'summary', 'recall'],
					[7, 3, 'judge', 'recall'],
				])
				expect(executions.map(({ attempt }) => attempt.digest)).toEqual(
					executions.map(({ attempt }) => hashStudyBytes(Buffer.from(attempt.body, 'base64'))),
				)
				const evidence = (
					scratch.read(`open/execution/trials/${history.declaration.trial}/evidence.jsonl`) ?? ''
				)
					.split(/\r\n|\n/)
					.filter(Boolean)
					.map((line) => parseJSON(line))
					.filter(isRecord)
				for (const event of ['dispatch', 'wire']) {
					expect(
						evidence
							.filter(
								(row) =>
									row.event === event && isRecord(row.value) && row.value.ordinal !== undefined,
							)
							.map((row) => ({ goal: row.goal, value: row.value })),
					).toEqual(
						history.exchanges.map(({ attempt }) => ({
							goal: attempt.goal,
							value: expect.objectContaining({
								ordinal: attempt.ordinal,
								role: attempt.role,
								path: attempt.path,
							}),
						})),
					)
				}
			}
		} finally {
			await server.close()
			library.destroy()
			scratch.destroy()
		}
	}, 120000)

	it('records, seals and replays captured bodies in a fresh offline worker with zero fixture requests', async () => {
		const scratch = createStudyConsumer()
		const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
		const server = await createOllamaServer()
		try {
			const subject = await buildStudyLibrary(
				library,
				resolve('src/server/ollama/StudyOllamaTransport.ts'),
			)
			writeStudyRecordingConsumer(scratch, server.url, subject)
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const original = join(scratch.path, 'recorded')
			const live = await command
				.execute(['execute', 'assessment', '--out', original], new AbortController().signal)
				.catch(async (error: unknown) => {
					const reading = await readStudyResult(original).catch(() => undefined)
					throw new Error(
						`${error instanceof Error ? error.message : String(error)}; retained failures: ${JSON.stringify(reading?.attempts.map((attempt) => attempt.failure))}; peer routes: ${server.requests.map((request) => request.path).join(', ')}`,
					)
				})
			expect(live).toMatchObject({ status: 'completed' })
			const recorded = await readStudyResult(original)
			if (recorded.status !== 'sealed') throw new Error('Recording did not seal')
			const trial = recorded.manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing recorded trial')
			const history = await readStudyExchanges(recorded, trial.id)
			const profile = parseStudyProfile(
				parseJSON(scratch.read('studies/files/profiles/local.json') ?? ''),
			)
			const offline = {
				...profile,
				name: 'offline',
				bounds: {
					request: { ...profile.bounds.request, duration: 4000 },
					goal: { ...profile.bounds.goal, duration: 6000 },
					trial: { ...profile.bounds.trial, duration: 12000 },
					series: { ...profile.bounds.series, duration: 24000 },
				},
			}
			scratch.write('studies/files/profiles/offline.json', JSON.stringify(offline))
			const before = server.requests.length
			const output = join(scratch.path, 'replayed')
			const replayed = await command.execute(
				[
					'execute',
					'assessment',
					'--profile',
					'offline',
					'--out',
					output,
					'--replay',
					original,
					'--prefix',
					JSON.stringify({ [trial.id]: history.exchanges.length }),
					'--offline',
					'true',
				],
				new AbortController().signal,
			)
			expect(replayed).toMatchObject({ status: 'completed' })
			expect(server.requests.length).toBe(before)
			const result = await readStudyResult(output)
			if (result.status !== 'sealed') throw new Error('Offline replay did not seal')
			expect(recorded.manifest.bounds).toEqual(profile.bounds)
			expect(result.manifest.bounds).toEqual(offline.bounds)
			expect(result.manifest.bounds.request.duration).not.toBe(
				recorded.manifest.bounds.request.duration,
			)
			expect(result.attempts[0]?.observations[0]?.product).toEqual({
				value: 'Receipt retained.',
				partial: false,
			})
			expect(
				result.attempts.flatMap((attempt) => attempt.observations.map((goal) => goal.product)),
			).toEqual(
				recorded.attempts.flatMap((attempt) => attempt.observations.map((goal) => goal.product)),
			)
			const workers = (scratch.read('workers.log') ?? '').split(/\r\n|\n/).filter(Boolean)
			expect(workers.length).toBe(2)
			expect(workers[0]).not.toBe(workers[1])
			const evidence = recorded.seal.files.find((file) => file.path.endsWith('evidence.jsonl'))
			if (evidence === undefined) throw new Error('Missing evidence measurement')
			scratch.write(
				'journal-measurement.json',
				JSON.stringify({ sidecar: history.file.bytes, evidence: evidence.bytes }),
			)
			process.stdout.write(
				`Exchange measurement: sidecar=${history.file.bytes} evidence=${evidence.bytes}\n`,
			)
			expect(history.file.bytes).toBeGreaterThan(0)
			const validations = scratch.read('validations.log')
			const sidecar = `recorded/execution/${history.file.path}`
			const retained = scratch.read(sidecar)
			if (retained === undefined) throw new Error('Missing retained sidecar')
			scratch.remove(sidecar)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						'missing-sidecar',
						'--replay',
						original,
						'--prefix',
						JSON.stringify({ [trial.id]: history.exchanges.length }),
						'--offline',
						'true',
					],
					new AbortController().signal,
				),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			expect(scratch.read('validations.log')).toBe(validations)
			scratch.write(
				sidecar,
				Buffer.from(
					mutateStudyExchangeRows(readStudyExchangeRows(Buffer.from(retained)), 'reversed'),
				).toString(),
			)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						'reordered',
						'--replay',
						original,
						'--prefix',
						JSON.stringify({ [trial.id]: history.exchanges.length }),
						'--offline',
						'true',
					],
					new AbortController().signal,
				),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			expect(scratch.read('validations.log')).toBe(validations)
			scratch.write(sidecar, retained)
			const declaration = scratch.read('studies/assessment/study.json')
			if (declaration === undefined) throw new Error('Missing study declaration')
			const definition = parseJSON(declaration)
			if (!isRecord(definition)) throw new Error('Invalid study declaration')
			scratch.write(
				'studies/assessment/study.json',
				JSON.stringify({ ...definition, purpose: 'mechanism' }),
			)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						'changed-declaration',
						'--replay',
						original,
						'--prefix',
						JSON.stringify({ [trial.id]: history.exchanges.length }),
						'--offline',
						'true',
					],
					new AbortController().signal,
				),
			).rejects.toMatchObject({ code: 'CONFIG' })
			expect(scratch.read('validations.log')).toBe(validations)
			scratch.write('studies/assessment/study.json', declaration)
			const checked = await command.execute(
				['check', 'assessment', '--profile', 'offline'],
				new AbortController().signal,
			)
			if (!isRecord(checked) || typeof checked.fingerprint !== 'string')
				throw new Error('Missing checked fingerprint')
			const checkedValidations = scratch.read('validations.log')
			scratch.write(
				'studies/files/profiles/offline.json',
				JSON.stringify({
					...offline,
					bounds: { ...offline.bounds, request: { ...offline.bounds.request, duration: 4001 } },
				}),
			)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--profile',
						'offline',
						'--out',
						'changed-bounds',
						'--expected',
						checked.fingerprint,
						'--replay',
						original,
						'--prefix',
						JSON.stringify({ [trial.id]: history.exchanges.length }),
						'--offline',
						'true',
					],
					new AbortController().signal,
				),
			).rejects.toThrow(/bounds or declaration changed after check/)
			expect(scratch.read('validations.log')).toBe(checkedValidations)
			scratch.write(
				'studies/files/profiles/local.json',
				JSON.stringify({ ...profile, settings: {} }),
			)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						'refused',
						'--replay',
						original,
						'--prefix',
						JSON.stringify({ [trial.id]: history.exchanges.length }),
						'--offline',
						'true',
					],
					new AbortController().signal,
				),
			).rejects.toThrow(/Recording requires/)
			expect(scratch.read('validations.log')).toBe(checkedValidations)
			expect(server.requests.length).toBe(before)
			expect(scratch.has('missing-sidecar')).toBe(false)
			expect(scratch.has('reordered')).toBe(false)
			expect(scratch.has('changed-declaration')).toBe(false)
			expect(scratch.has('changed-bounds')).toBe(false)
			expect(scratch.has('refused')).toBe(false)
		} finally {
			await server.close()
			library.destroy()
			scratch.destroy()
		}
	}, 120000)
})

describe('selection', () => {
	it('selection: one trial of two', async () => {
		const scratch = createStudyConsumer((consumer) =>
			writeStudySelectionConsumer(consumer, ['small', 'large']),
		)
		const signal = new AbortController().signal
		try {
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const output = join(scratch.path, 'selected')
			const rubric = join(scratch.path, 'studies', 'selection', 'rubric.json')
			const tracked = hashStudyBytes(
				Buffer.from(requireValue(scratch.read(STUDY_SELECTION_RUBRIC))),
			)
			await expect(
				command.execute(['execute', 'selection', '--trial', 'r1-s1-a2', '--out', output], signal),
			).resolves.toMatchObject({ status: 'completed' })
			const result = await readStudyResult(output)
			if (result.status !== 'sealed') throw new Error('One-trial selection did not seal')
			expect(result.manifest.schedule.map((trial) => trial.id)).toEqual(['r1-s1-a2'])
			expect(result.manifest.selection).toEqual({ trial: 'r1-s1-a2' })
			expect(result.attempts.map((attempt) => attempt.trial.id)).toEqual(['r1-s1-a2'])
			expect(readStudySelectionOpens(scratch)).toEqual([{ trial: 'r1-s1-a2', seed: null }])
			const graded = await command.execute(['grade', output, '--rubric', rubric], signal)
			if (!isRecord(graded) || typeof graded.assessment !== 'string')
				throw new Error('Missing one-trial grading')
			const grading = parseJSON(
				requireValue(scratch.read(`selected/grades/${graded.assessment}/grading.json`)),
			)
			expect(grading).toMatchObject({ rubric: tracked })
			expect(grading).not.toHaveProperty('unselected')
			const reported = await command.execute(
				['report', output, '--assessment', graded.assessment],
				signal,
			)
			if (
				!isRecord(reported) ||
				!isRecord(reported.report) ||
				!isArray(reported.report.scores) ||
				!isArray(reported.report.repetitions)
			)
				throw new Error('Missing one-trial report')
			expect(reported.report).toMatchObject({
				selection: { trial: 'r1-s1-a2' },
				population: 'Selected segment of the declared trial and criterion horizon',
				scores: [{ arm: 'large', total: 8, achieved: 8, unknown: 0, lower: 1, upper: 1 }],
				repetitions: [{ repetition: 0, arms: [{ arm: 'large', total: 8, achieved: 8 }] }],
			})
			expect(reported.report.scores).toHaveLength(1)
			const rows = [
				...reported.report.scores,
				...reported.report.repetitions.flatMap((repetition) =>
					isRecord(repetition) && isArray(repetition.arms) ? repetition.arms : [],
				),
			]
			const records = rows.flatMap((row) => (isRecord(row) ? [row] : []))
			expect(records).toHaveLength(2)
			const readings = records.flatMap((row) => STUDY_SELECTION_NUMBERS.map((key) => row[key]))
			expect(readings).toHaveLength(16)
			expect(readings.every(Number.isFinite)).toBe(true)
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('selection: a goal range', async () => {
		const scratch = createStudyConsumer((consumer) =>
			writeStudySelectionConsumer(consumer, ['small', 'large']),
		)
		const signal = new AbortController().signal
		try {
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const output = join(scratch.path, 'ranged')
			const rubric = join(scratch.path, 'studies', 'selection', 'rubric.json')
			const tracked = hashStudyBytes(
				Buffer.from(requireValue(scratch.read(STUDY_SELECTION_RUBRIC))),
			)
			const checked = await command.execute(['check', 'selection'], signal)
			if (!isRecord(checked) || !isRecord(checked.identity))
				throw new Error('Missing selection-free check')
			await expect(
				command.execute(['execute', 'selection', '--goals', 'g3..g5', '--out', output], signal),
			).resolves.toMatchObject({ status: 'completed' })
			const result = await readStudyResult(output)
			if (result.status !== 'sealed') throw new Error('Goal range did not seal')
			expect(result.manifest.selection).toEqual({ goals: { first: 'g3', last: 'g5' } })
			expect(result.manifest.identity.fixtures).toBe(checked.identity.fixtures)
			expect(
				result.manifest.scenarios.map((scenario) => scenario.goals.map((goal) => goal.id)),
			).toEqual([['g3', 'g4', 'g5']])
			expect(
				result.attempts.flatMap((attempt) =>
					attempt.observations.map((observation) => [attempt.trial.id, observation.goal]),
				),
			).toEqual([
				['r1-s1-a1', 'g3'],
				['r1-s1-a1', 'g4'],
				['r1-s1-a1', 'g5'],
				['r1-s1-a2', 'g3'],
				['r1-s1-a2', 'g4'],
				['r1-s1-a2', 'g5'],
			])
			const graded = await command.execute(['grade', output, '--rubric', rubric], signal)
			if (!isRecord(graded) || typeof graded.assessment !== 'string')
				throw new Error('Missing goal-range grading')
			const directory = `ranged/grades/${graded.assessment}`
			const grading = parseJSON(requireValue(scratch.read(`${directory}/grading.json`)))
			if (!isRecord(grading) || typeof grading.rubric !== 'string')
				throw new Error('Missing goal-range grading record')
			expect(grading.rubric).not.toBe(tracked)
			const unselected = ['first-g1', 'first-g2', 'first-g6', 'first-g7', 'first-g8']
			expect(grading.unselected).toEqual(unselected)
			const projected = parseJSON(
				requireValue(scratch.read(`${directory}/${grading.rubric}.rubric.json`)),
			)
			expect(projected).toMatchObject({
				criteria: [{ id: 'first-g3' }, { id: 'first-g4' }, { id: 'first-g5' }],
			})
			const reported = await command.execute(
				['report', output, '--assessment', graded.assessment],
				signal,
			)
			expect(reported).toMatchObject({
				report: {
					selection: { goals: { first: 'g3', last: 'g5' } },
					unselected,
					scores: [
						{ arm: 'small', total: 3, achieved: 3 },
						{ arm: 'large', total: 3, achieved: 3 },
					],
					operations: { goals: { scheduled: 6, executed: 6, unexecuted: 0 } },
				},
			})
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('selection: a seed from a sealed result', async () => {
		const scratch = createStudyConsumer((consumer) =>
			writeStudySelectionConsumer(consumer, ['small', 'large']),
		)
		const signal = new AbortController().signal
		try {
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const source = join(scratch.path, 'source')
			const output = join(scratch.path, 'seeded')
			const rubric = join(scratch.path, 'studies', 'selection', 'rubric.json')
			await command.execute(['execute', 'selection', '--out', source], signal)
			const sealed = await readStudyResult(source)
			if (sealed.status !== 'sealed') throw new Error('Seed source did not seal')
			const selectors = ['--trial', 'r1-s1-a1', '--goals', 'g3..g5']
			const seed = ['--seed', `${source}:r1-s1-a1:g2`]
			await expect(
				command.execute(['execute', 'selection', ...selectors, ...seed, '--out', output], signal),
			).resolves.toMatchObject({ status: 'completed' })
			expect(readStudySelectionOpens(scratch)).toEqual([
				{ trial: 'r1-s1-a1', seed: null },
				{ trial: 'r1-s1-a2', seed: null },
				{ trial: 'r1-s1-a1', seed: { trial: 'r1-s1-a1', goal: 'g2' } },
			])
			const result = await readStudyResult(output)
			if (result.status !== 'sealed') throw new Error('Seeded selection did not seal')
			expect(result.manifest.selection).toEqual({
				trial: 'r1-s1-a1',
				goals: { first: 'g3', last: 'g5' },
				seed: {
					result: sealed.manifest.id,
					seal: sealed.seal.id,
					trial: 'r1-s1-a1',
					goal: 'g2',
					digest: createHash('sha256').update(STUDY_SELECTION_ROW).digest('hex'),
				},
			})
			const graded = await command.execute(['grade', output, '--rubric', rubric], signal)
			if (!isRecord(graded) || typeof graded.assessment !== 'string')
				throw new Error('Missing seeded grading')
			const reported = await command.execute(
				['report', output, '--assessment', graded.assessment],
				signal,
			)
			expect(reported).toMatchObject({
				report: {
					selection: { trial: 'r1-s1-a1', seed: { result: sealed.manifest.id, goal: 'g2' } },
					scores: [{ arm: 'small', total: 3, achieved: 3 }],
				},
			})
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('selection: a seed on a one-trial schedule', async () => {
		const scratch = createStudyConsumer((consumer) =>
			writeStudySelectionConsumer(consumer, ['small']),
		)
		const signal = new AbortController().signal
		try {
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const source = join(scratch.path, 'source')
			const output = join(scratch.path, 'seeded')
			const seed = ['--seed', `${source}:r1-s1-a1:g2`]
			await command.execute(['execute', 'selection', '--out', source], signal)
			await expect(
				command.execute(['execute', 'selection', ...seed, '--out', output], signal),
			).resolves.toMatchObject({ status: 'completed' })
			expect(readStudySelectionOpens(scratch)).toEqual([
				{ trial: 'r1-s1-a1', seed: null },
				{ trial: 'r1-s1-a1', seed: { trial: 'r1-s1-a1', goal: 'g2' } },
			])
			const result = await readStudyResult(output)
			if (result.status !== 'sealed') throw new Error('One-trial seed did not seal')
			expect(result.manifest.schedule.map((trial) => trial.id)).toEqual(['r1-s1-a1'])
			expect(result.manifest.selection).toMatchObject({ seed: { trial: 'r1-s1-a1', goal: 'g2' } })
			expect(result.manifest.selection).not.toHaveProperty('trial')
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('selection: refusals before any request', async () => {
		const scratch = createStudyConsumer((consumer) =>
			writeStudySelectionConsumer(consumer, ['small', 'large']),
		)
		const signal = new AbortController().signal
		try {
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const sealed = join(scratch.path, 'source')
			const other = join(scratch.path, 'other')
			const tampered = join(scratch.path, 'tampered')
			const unsealed = join(scratch.path, 'unsealed')
			await command.execute(['execute', 'selection', '--out', sealed], signal)
			await command.execute(['execute', 'selection', '--trial', 'r1-s1-a1', '--out', other], signal)
			cpSync(sealed, tampered, { recursive: true })
			cpSync(sealed, unsealed, { recursive: true })
			appendFileSync(join(tampered, 'execution', 'trials', 'r1-s1-a1', 'evidence.jsonl'), '\n')
			rmSync(join(unsealed, 'seal.json'))
			const seed = ['--seed', `${sealed}:r1-s1-a1:g2`]
			const checked = await command.execute(
				['check', 'selection', '--trial', 'r1-s1-a1', ...seed],
				signal,
			)
			if (!isRecord(checked) || typeof checked.fingerprint !== 'string')
				throw new Error('Missing seeded check')
			const opened = readStudySelectionOpens(scratch)
			expect(opened).toHaveLength(3)
			const refusals = buildStudySelectionRefusals(
				{ sealed, tampered, unsealed, other },
				checked.fingerprint,
			)
			for (const [index, refusal] of refusals.entries()) {
				const output = join(scratch.path, `refused-${index}`)
				await expect(
					command.execute(['execute', 'selection', ...refusal.tokens, '--out', output], signal),
				).rejects.toMatchObject({ code: refusal.code })
				expect(scratch.has(`refused-${index}`)).toBe(false)
			}
			expect(readStudySelectionOpens(scratch)).toEqual(opened)
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('selection: check binds the selection', async () => {
		const scratch = createStudyConsumer((consumer) =>
			writeStudySelectionConsumer(consumer, ['small', 'large']),
		)
		const signal = new AbortController().signal
		try {
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const source = join(scratch.path, 'source')
			const destination = join(scratch.path, 'frozen')
			const seed = ['--seed', `${source}:r1-s1-a1:g2`]
			await command.execute(['execute', 'selection', '--out', source], signal)
			const plain = await command.execute(['check', 'selection'], signal)
			const trial = await command.execute(['check', 'selection', '--trial', 'r1-s1-a2'], signal)
			const goals = await command.execute(['check', 'selection', '--goals', 'g2..g4'], signal)
			const seeded = await command.execute(
				['check', 'selection', '--trial', 'r1-s1-a2', ...seed],
				signal,
			)
			if (
				!isRecord(plain) ||
				!isRecord(trial) ||
				!isRecord(goals) ||
				!isRecord(seeded) ||
				!isArray(trial.next) ||
				!isArray(goals.next) ||
				!isArray(seeded.next)
			)
				throw new Error('Missing selection checks')
			expect(
				new Set([plain.fingerprint, trial.fingerprint, goals.fingerprint, seeded.fingerprint]).size,
			).toBe(4)
			expect(plain).not.toHaveProperty('selection')
			expect(trial).toMatchObject({
				selection: { trial: 'r1-s1-a2' },
				schedule: [{ id: 'r1-s1-a2' }],
			})
			expect(goals).toMatchObject({ selection: { goals: { first: 'g2', last: 'g4' } } })
			expect(parseStudyArguments(trial.next.map(String))).toMatchObject({
				command: 'execute',
				trial: 'r1-s1-a2',
				expected: trial.fingerprint,
			})
			expect(parseStudyArguments(goals.next.map(String))).toMatchObject({
				goals: { first: 'g2', last: 'g4' },
				expected: goals.fingerprint,
			})
			expect(parseStudyArguments(seeded.next.map(String))).toMatchObject({
				trial: 'r1-s1-a2',
				seed: { result: resolve(source), trial: 'r1-s1-a1', goal: 'g2' },
				expected: seeded.fingerprint,
			})
			const frozen = await command.execute(
				['freeze', 'selection', '--profile', 'local', '--to', destination],
				signal,
			)
			const closed = await command.execute(['check', 'selection', '--closure', destination], signal)
			const selected = await command.execute(
				['check', 'selection', '--closure', destination, '--trial', 'r1-s1-a2'],
				signal,
			)
			if (!isRecord(frozen) || !isRecord(closed) || !isRecord(selected))
				throw new Error('Missing closure checks')
			expect(closed.fingerprint).toBe(frozen.fingerprint)
			expect(selected.fingerprint).not.toBe(frozen.fingerprint)
			expect(selected).toMatchObject({ selection: { trial: 'r1-s1-a2' } })
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('closure: a result executed under a closure reads through its own entry and refuses the live one', async () => {
		const scratch = createStudyConsumer((consumer) =>
			writeStudySelectionConsumer(consumer, ['small', 'large']),
		)
		const signal = new AbortController().signal
		try {
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const destination = join(scratch.path, 'frozen')
			const output = join(scratch.path, 'closed')
			await command.execute(
				['freeze', 'selection', '--profile', 'local', '--to', destination],
				signal,
			)
			await expect(
				command.execute(
					['execute', 'selection', '--closure', destination, '--out', output],
					signal,
				),
			).resolves.toMatchObject({ status: 'completed' })
			const closure = readStudyClosure(destination)
			const rubric = join(closure.root, 'studies', 'selection', 'rubric.json')
			// The live runtime gains a dependency the closure's relocated roots cannot hold.
			scratch.write(
				'runtime/node_modules/fixture-dependency/package.json',
				'{"name":"fixture-dependency","version":"1.0.0","type":"module"}',
			)
			scratch.write(
				'runtime/package.json',
				JSON.stringify({
					name: '@orkestrel/study',
					version: '0.0.0-runtime',
					type: 'module',
					dependencies: { 'fixture-dependency': '1.0.0' },
				}),
			)
			for (const operation of [
				['grade', output, '--rubric', rubric],
				['progress', output],
			]) {
				await expect(command.execute(operation, signal)).rejects.toMatchObject({
					code: 'CONFIG',
					message: expect.stringContaining("through that closure's own entry"),
				})
			}
			const own = new StudyCommand({ root: closure.root, entry: closure.entry })
			await expect(own.execute(['progress', output], signal)).resolves.toMatchObject({
				command: 'progress',
			})
			await expect(
				own.execute(['grade', output, '--rubric', rubric], signal),
			).resolves.toMatchObject({ command: 'grade' })
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('closure: a freeze lands inside a consumer root outside what it copies, and refuses a missing parent', async () => {
		const scratch = createStudyConsumer((consumer) => {
			writeStudySelectionConsumer(consumer, ['small', 'large'])
			consumer.write(
				'package.json',
				JSON.stringify({ name: 'root-consumer', version: '1.0.0', type: 'module' }),
			)
			consumer.write('dist/index.js', 'export const consumer = true\n')
			const profile = parseJSON(requireValue(consumer.read(STUDY_SELECTION_PROFILE)))
			if (!isRecord(profile) || !isArray(profile.roots)) throw new Error('Missing profile roots')
			consumer.write(
				STUDY_SELECTION_PROFILE,
				JSON.stringify({ ...profile, roots: [consumer.path, ...profile.roots] }),
			)
		})
		const signal = new AbortController().signal
		try {
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const freeze = ['freeze', 'selection', '--profile', 'local', '--to']
			const missing = join(scratch.path, 'closures', 'absent')
			await expect(command.execute([...freeze, missing], signal)).rejects.toMatchObject({
				code: 'PARENT',
				message: `Artifact destination parent is missing: ${join(scratch.path, 'closures')}`,
			})
			await expect(
				command.execute([...freeze, join(scratch.path, 'dist', 'frozen')], signal),
			).rejects.toMatchObject({ code: 'OVERLAP' })
			scratch.ensure('closures')
			const frozen = await command.execute([...freeze, missing], signal)
			const checked = await command.execute(['check', 'selection', '--closure', missing], signal)
			if (!isRecord(frozen) || !isRecord(checked)) throw new Error('Missing closure check')
			expect(checked.fingerprint).toBe(frozen.fingerprint)
			expect(
				readStudyClosure(missing).closure.members.some(({ key }) => key.startsWith('closures/')),
			).toBe(false)
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('selection: replay', async () => {
		const scratch = createStudyConsumer()
		const library = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
		const server = await createOllamaServer()
		const signal = new AbortController().signal
		try {
			const subject = await buildStudyLibrary(
				library,
				resolve('src/server/ollama/StudyOllamaTransport.ts'),
			)
			writeStudyRecordingConsumer(scratch, server.url, subject, true)
			const entry = await buildStudyCLI(scratch)
			const command = new StudyCommand({ root: scratch.path, entry })
			const recorded = join(scratch.path, 'recorded')
			const goals = ['--goals', 'write..write']
			await expect(
				command.execute(['execute', 'assessment', ...goals, '--out', recorded], signal),
			).resolves.toMatchObject({ status: 'completed' })
			const source = await readStudyResult(recorded)
			if (source.status !== 'sealed') throw new Error('Goal-range recording did not seal')
			expect(source.manifest.selection).toEqual({ goals: { first: 'write', last: 'write' } })
			const trial = requireValue(source.manifest.schedule[0])
			const history = await readStudyExchanges(source, trial.id)
			const replay = [
				'--replay',
				recorded,
				'--prefix',
				JSON.stringify({ [trial.id]: history.completion.count }),
				'--offline',
				'true',
			]
			const offline = join(scratch.path, 'offline')
			const before = server.requests.length
			const started = performance.now()
			await expect(
				command.execute(['execute', 'assessment', ...goals, '--out', offline, ...replay], signal),
			).resolves.toMatchObject({ status: 'completed' })
			process.stdout.write(
				`Selection replay measurement: ${Math.round(performance.now() - started)} ms\n`,
			)
			const replayed = await readStudyResult(offline)
			if (replayed.status !== 'sealed') throw new Error('Goal-range replay did not seal')
			expect(replayed.manifest.selection).toEqual(source.manifest.selection)
			expect(
				replayed.attempts.flatMap((attempt) => attempt.observations.map((goal) => goal.product)),
			).toEqual(
				source.attempts.flatMap((attempt) => attempt.observations.map((goal) => goal.product)),
			)
			const checked = await command.execute(['check', 'assessment', ...goals], signal)
			if (!isRecord(checked) || typeof checked.fingerprint !== 'string')
				throw new Error('Missing goal-range check')
			const pinned = ['--expected', checked.fingerprint, '--out', join(scratch.path, 'pinned')]
			await expect(
				command.execute(['execute', 'assessment', ...goals, ...pinned, ...replay], signal),
			).resolves.toMatchObject({ status: 'completed' })
			expect(server.requests.length).toBe(before)
			const workers = scratch.read('workers.log')
			const differing = ['--goals', 'write..recall', '--out', join(scratch.path, 'differing')]
			await expect(
				command.execute(['execute', 'assessment', ...differing, ...replay], signal),
			).rejects.toMatchObject({ code: 'CONFIG' })
			expect(scratch.read('workers.log')).toBe(workers)
			expect(scratch.has('differing')).toBe(false)
		} finally {
			await server.close()
			library.destroy()
			scratch.destroy()
		}
	}, 240000)
})
