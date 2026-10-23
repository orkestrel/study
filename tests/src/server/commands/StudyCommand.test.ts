import { createScratch } from '@orkestrel/test/server'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudyCommand } from '../../../../src/server/commands/StudyCommand.js'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { hashStudyBytes } from '../../../../src/server/helpers.js'
import { STUDY_OPEN_BOUND_CASES, STUDY_OLLAMA_PARTIAL_ROW } from '../../../setupStudy.js'
import {
	readStudyExchangeRows,
	readStudyExchanges,
	readStudyResult,
} from '../../../../src/server/stores/helpers.js'
import {
	buildStudyCLI,
	buildStudyLibrary,
	createOllamaServer,
	createStudyConsumer,
	mutateStudyExchangeRows,
	writeStudyRecordingConsumer,
} from '../../../setupServer.js'

describe('recording and replay command handoff', () => {
	it.each(STUDY_OPEN_BOUND_CASES)(
		'retains interrupted custody and charges when open record.%s stops a trial',
		async (bound) => {
			const scratch = createStudyConsumer()
			const library = createScratch({ parent: resolve('tmp/units') })
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

	it('O1 seals unpredicted agent summary and judge bodies without a procedure and joins their ordinals', async () => {
		const scratch = createStudyConsumer()
		const library = createScratch({ parent: resolve('tmp/units') })
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
		const library = createScratch({ parent: resolve('tmp/units') })
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
