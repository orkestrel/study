import type { StudyProgressTarget } from '../../../../src/server/adapters/types.js'
import type { Socket } from 'node:net'
import { parseJSON } from '@orkestrel/contract'
import { createRecorder, requireValue } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { describe, expect, it } from 'vitest'
import {
	buildCompactCustodyManifest,
	buildCustodyAttempt,
	buildCustodyManifest,
	buildStudyFailure,
	buildStudyHole,
	buildStudyRubric,
	buildStudySparse,
} from '../../../setupStudy.js'
import { STUDY_CUSTODY_BYTES } from '../../../../src/server/stores/constants.js'
import {
	STUDY_PROGRESS_SCALE,
	buildCustodyPacketLabels,
	buildOllamaDeclaration,
	buildStudyProgressManifest,
	buildStudyProgressRows,
	retainStudyFixture,
	buildStudyExchangeHistory,
	spawnStudyScript,
	writeStudyProgressFixture,
	writeStudyProgressResult,
} from '../../../setupServer.js'
import { encodeStudyJSON, hashStudyBytes } from '../../../../src/server/helpers.js'
import { STUDY_FRAME_BYTES } from '../../../../src/server/processes/constants.js'
import { valueToWire } from '../../../../src/server/processes/helpers.js'
import { StudyResultStore } from '../../../../src/server/stores/StudyResultStore.js'
import { isStudyExchangeDeclaration } from '../../../../src/server/stores/validators.js'
import {
	checkStudyDirectory,
	buildStudyPacket,
	buildStudyPacketLinks,
	computeStudyPacketDigest,
	computeStudySealId,
	readStudyBytes,
	readStudyHandle,
	advanceStudyExchangeProgress,
	buildStudyExchangeProgress,
	validateStudyExchangeRows,
	readStudyProgress,
	readStudyProgressAttempt,
	readStudyProgressPrefix,
	readStudyResult,
	scanStudyExecution,
	scanStudyTree,
	validateStudyEvidenceBytes,
	translateStudyPacketLabels,
	writeStudyBytes,
	computeStudyExchangeOffset,
	scanStudyDivergence,
} from '../../../../src/server/stores/helpers.js'

describe('study custody helpers', () => {
	it('RP2 finds unmatched requests after a completed history without revalidating caller-owned rows', () => {
		const history = buildStudyExchangeHistory()
		const rows = buildStudyExchangeRows()
		const last = history.exchanges.at(-1)?.attempt
		if (last === undefined) throw new Error('Missing history completion')
		const extra = { ...last, ordinal: history.completion.count + 1 }
		expect(scanStudyDivergence(history, [...rows, extra])).toEqual({
			ordinal: history.completion.count + 1,
			expected: undefined,
			actual: extra,
			offset: undefined,
		})
		expect(scanStudyDivergence(history, rows)).toBeUndefined()
		expect(scanStudyDivergence(history, [])).toEqual({
			ordinal: 1,
			expected: history.exchanges[0]?.attempt,
			actual: undefined,
			offset: undefined,
		})
	})

	it('locates byte substitutions and unequal suffixes without confusing UTF-8 bytes with characters', () => {
		expect(computeStudyExchangeOffset(Buffer.from('café'), Buffer.from('cafe'))).toBe(3)
		expect(computeStudyExchangeOffset(Buffer.from('same'), Buffer.from('same'))).toBeUndefined()
		expect(computeStudyExchangeOffset(Buffer.from('same'), Buffer.from('same plus'))).toBe(4)
		expect(computeStudyExchangeOffset(Buffer.from('same plus'), Buffer.from('same'))).toBe(4)
		expect(computeStudyExchangeOffset(Buffer.from(''), Buffer.from('added'))).toBe(0)
	})
	it('constructs a neutral complete semantic packet and translates only its bound label identities', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const rubric = buildStudyRubric()
			const digest = hashStudyBytes(encodeStudyJSON(rubric))
			const packet = buildStudyPacket(result, rubric, digest)
			if (packet === undefined) throw new Error('Missing packet fixture')
			const links = buildStudyPacketLinks(result, rubric)
			expect(new Set(links.map((link) => link.source.criterion))).toEqual(
				new Set(['first-read', 'second-read']),
			)
			expect(new Set(links.map((link) => link.source.trial))).toEqual(
				new Set(result.manifest.schedule.map((trial) => trial.id)),
			)
			expect(
				links.every(
					(link) => link.trial !== link.source.trial && link.criterion !== link.source.criterion,
				),
			).toBe(true)
			expect(new TextDecoder().decode(packet.content)).not.toContain('"arm"')
			expect(new TextDecoder().decode(packet.content)).not.toContain('small')
			expect(computeStudyPacketDigest(packet)).not.toBe(hashStudyBytes(packet.content))
			expect(computeStudyPacketDigest({ ...packet, mapping: encodeStudyJSON({}) })).not.toBe(
				computeStudyPacketDigest(packet),
			)
			const labels = buildCustodyPacketLabels(result, rubric)
			expect(translateStudyPacketLabels(result, rubric, digest, labels)).toMatchObject([
				{
					trial: result.manifest.schedule[0]?.id,
					criterion: 'first-read',
					verdict: 'achieved',
					method: 'human',
				},
			])
			expect(() =>
				translateStudyPacketLabels(result, rubric, digest, { ...labels, packet: 'f'.repeat(64) }),
			).toThrow('different semantic packet')
			expect(() =>
				translateStudyPacketLabels(result, rubric, digest, {
					...labels,
					judgments: labels.judgments.map((judgment) => ({
						...judgment,
						criterion: 'first-write',
					})),
				}),
			).toThrow('foreign semantic packet identity')
			expect(
				buildStudyPacket(
					result,
					{
						...rubric,
						criteria: rubric.criteria.map((criterion) => ({ ...criterion, method: 'state' })),
					},
					digest,
				),
			).toBeUndefined()
		} finally {
			scratch.destroy()
		}
	})
	it('binds a seal identity to its result identity and exact inventory', () => {
		const file = { path: 'manifest.json', bytes: 10, digest: 'a'.repeat(64) }
		expect(computeStudySealId('execution', [])).not.toBe(computeStudySealId('other', []))
		expect(computeStudySealId('execution', [file])).toBe(
			hashStudyBytes(
				'{"files":[{"bytes":10,"digest":"' +
					'a'.repeat(64) +
					'","path":"manifest.json"}],"result":"execution"}\n',
			),
		)
		expect(computeStudySealId('execution', [{ ...file, bytes: 11 }])).not.toBe(
			computeStudySealId('execution', [file]),
		)
	})

	it('bounds regular-file reads and preserves exclusive writes', async () => {
		const scratch = createScratch()
		try {
			expect(await checkStudyDirectory(scratch.path)).toBe(scratch.path)
			const path = join(scratch.path, 'record.json')
			await writeStudyBytes(path, Buffer.from('original'))
			expect(Buffer.from(await readStudyBytes(path, 8)).toString()).toBe('original')
			await expect(readStudyBytes(path, 7)).rejects.toMatchObject({ code: 'CUSTODY' })
			await expect(readStudyBytes(path, Number.NaN)).rejects.toMatchObject({ code: 'CONFIG' })
			await expect(writeStudyBytes(path, Buffer.from('changed'))).rejects.toMatchObject({
				code: 'EEXIST',
			})
			expect(await readFile(path, 'utf8')).toBe('original')
			await expect(readStudyBytes(scratch.path, 32)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('rejects partial, foreign, and oversized evidence bytes', () => {
		const manifest = buildCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing trial')
		expect(() => validateStudyEvidenceBytes(new Uint8Array(), manifest, trial.id)).not.toThrow()
		expect(() =>
			validateStudyEvidenceBytes(
				encodeStudyJSON({ event: 'saved', goal: 'write', value: true }),
				manifest,
				trial.id,
			),
		).not.toThrow()
		expect(() => validateStudyEvidenceBytes(Buffer.from('{'), manifest, trial.id)).toThrow(
			'partial',
		)
		expect(() =>
			validateStudyEvidenceBytes(
				encodeStudyJSON({ event: 'saved', goal: 'foreign', value: true }),
				manifest,
				trial.id,
			),
		).toThrow('invalid goal')
		expect(() =>
			validateStudyEvidenceBytes(
				encodeStudyJSON({ event: 'saved', goal: 'write', value: 'x'.repeat(5000) }),
				manifest,
				trial.id,
			),
		).toThrow('goal allowance')
		expect(() => validateStudyEvidenceBytes(new Uint8Array(10000), manifest, trial.id)).toThrow(
			'declared trial',
		)
	})

	it('refuses the earlier of an over-allowance goal and an invalid goal line in line order', () => {
		const manifest = buildCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing trial')
		const heavy = Buffer.from(
			encodeStudyJSON({ event: 'saved', goal: 'write', value: 'x'.repeat(2500) }),
		).toString()
		const foreign = Buffer.from(
			encodeStudyJSON({ event: 'saved', goal: 'foreign', value: true }),
		).toString()
		expect(() =>
			validateStudyEvidenceBytes(Buffer.from(heavy + heavy + foreign), manifest, trial.id),
		).toThrow('goal allowance')
		expect(() =>
			validateStudyEvidenceBytes(Buffer.from(heavy + foreign + heavy + heavy), manifest, trial.id),
		).toThrow('invalid goal')
		expect(() =>
			validateStudyEvidenceBytes(Buffer.from(foreign + heavy), manifest, trial.id),
		).toThrow('invalid goal')
		expect(() =>
			validateStudyEvidenceBytes(Buffer.from(heavy + heavy), manifest, trial.id),
		).toThrow('goal allowance')
	})

	it('scans an execution tree in read order and carries the series allowance across sibling directories', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const trials = manifest.schedule.slice(0, 2).map((trial) => trial.id)
			scratch.write('manifest.json', '0123456789')
			for (const id of trials) {
				scratch.write(`trials/${id}/attempt.json`, '0123456789')
				scratch.write(`trials/${id}/evidence.jsonl`, '0123456789')
			}
			const known = new Set(trials)
			const listed = readdirSync(join(scratch.path, 'trials'))
			const found = await scanStudyTree(scratch.path, '', known, 50)
			expect(found.map((file) => file.path)).toEqual([
				'manifest.json',
				...[...listed]
					.reverse()
					.flatMap((id) =>
						readdirSync(join(scratch.path, 'trials', id)).map((name) => `trials/${id}/${name}`),
					),
			])
			expect(found.every((file) => file.bytes === 10)).toBe(true)
			await expect(scanStudyTree(scratch.path, '', known, 49)).rejects.toMatchObject({
				code: 'CUSTODY',
			})
			await expect(
				scanStudyTree(scratch.path, '', new Set(trials.slice(0, 1)), 50),
			).rejects.toMatchObject({
				code: 'CUSTODY',
				message: 'Execution contains an unknown directory',
			})
		} finally {
			scratch.destroy()
		}
	})

	it('returns interrupted metadata from an empty creation and inventories exact regular files', async () => {
		const scratch = createScratch()
		try {
			expect(await readStudyResult(scratch.path)).toEqual({
				status: 'interrupted',
				directory: scratch.path,
				manifest: undefined,
				attempts: [],
			})
			await mkdir(join(scratch.path, 'execution'))
			expect((await readStudyResult(scratch.path)).status).toBe('interrupted')
			const manifest = buildCustodyManifest()
			await writeFile(join(scratch.path, 'execution', 'manifest.json'), encodeStudyJSON(manifest))
			const inventory = await scanStudyExecution(join(scratch.path, 'execution'), manifest)
			expect(inventory.map((file) => file.path)).toEqual(['manifest.json'])
			expect(inventory[0]?.bytes).toBe(
				(await readFile(join(scratch.path, 'execution', 'manifest.json'))).byteLength,
			)
		} finally {
			scratch.destroy()
		}
	})

	it('returns safe interrupted metadata when a crash leaves a partial manifest or terminal record', async () => {
		const scratch = createScratch()
		try {
			await mkdir(join(scratch.path, 'execution'))
			await writeFile(join(scratch.path, 'execution', 'manifest.json'), '{')
			const partialManifest = await readStudyResult(scratch.path)
			expect(partialManifest.status).toBe('interrupted')
			expect(partialManifest.manifest).toBeUndefined()
			const manifest = buildCustodyManifest()
			const trial = manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			await writeFile(join(scratch.path, 'execution', 'manifest.json'), encodeStudyJSON(manifest))
			await mkdir(join(scratch.path, 'execution', 'trials', trial.id), { recursive: true })
			await writeFile(join(scratch.path, 'execution', 'trials', trial.id, 'evidence.jsonl'), '{')
			await writeFile(join(scratch.path, 'execution', 'trials', trial.id, 'attempt.json'), '{')
			const partialAttempt = await readStudyResult(scratch.path)
			expect(partialAttempt.status).toBe('interrupted')
			expect(partialAttempt.attempts).toEqual([])
		} finally {
			scratch.destroy()
		}
	})
})

describe('study packet construction over sparse and oversized declarations', () => {
	it('refuses a hole in the criteria or the schedule instead of skipping the position', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const rubric = buildStudyRubric()
			const digest = hashStudyBytes(encodeStudyJSON(rubric))
			// The dense declarations build, so only the hole decides.
			expect(buildStudyPacketLinks(result, rubric)).toHaveLength(2)
			for (const index of rubric.criteria.keys()) {
				const sparse = { ...rubric, criteria: buildStudyHole(rubric.criteria, index) }
				expect(() => buildStudyPacketLinks(result, sparse)).toThrow(TypeError)
				expect(() => buildStudyPacket(result, sparse, digest)).toThrow(TypeError)
			}
			for (const index of result.manifest.schedule.keys()) {
				const sparse = {
					...result,
					manifest: {
						...result.manifest,
						schedule: buildStudyHole(result.manifest.schedule, index),
					},
				}
				expect(() => buildStudyPacketLinks(sparse, rubric)).toThrow(TypeError)
				expect(() => buildStudyPacket(sparse, rubric, digest)).toThrow(TypeError)
			}
		} finally {
			scratch.destroy()
		}
	})

	it('counts a link that exceeds the custody allowance before it reaches a later hole', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const semantic = buildStudyRubric().criteria.find(
				(criterion) => criterion.method === 'semantic',
			)
			if (semantic === undefined) throw new Error('Missing semantic criterion')
			const oversized = { ...semantic, id: 'x'.repeat(STUDY_CUSTODY_BYTES) }
			const rubric = { version: '1', criteria: buildStudySparse(2, [[0, oversized]]) }
			expect(() => buildStudyPacketLinks(result, rubric)).toThrow(
				'Semantic packet mapping exceeds its custody allowance',
			)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses an absent horizon in link order before it reads a later hole', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'), buildCustodyManifest())
			const rubric = buildStudyRubric()
			const digest = hashStudyBytes(encodeStudyJSON(rubric))
			const trimmed = {
				...result,
				manifest: {
					...result.manifest,
					scenarios: result.manifest.scenarios.map((scenario) => ({
						...scenario,
						goals: scenario.goals.slice(0, 1),
					})),
				},
			}
			// With every goal present the packet builds, so the absent goal and the hole are the only causes.
			expect(buildStudyPacket(result, rubric, digest)).toBeDefined()
			expect(() => buildStudyPacket(trimmed, rubric, digest)).toThrow(
				'Semantic packet refers to an absent sealed horizon',
			)
			expect(() =>
				buildStudyPacket(
					{ ...trimmed, attempts: buildStudyHole(trimmed.attempts, trimmed.attempts.length - 1) },
					rubric,
					digest,
				),
			).toThrow('Semantic packet refers to an absent sealed horizon')
		} finally {
			scratch.destroy()
		}
	})
})

describe('readStudyHandle', () => {
	it('fills a buffer from the start of the file and returns the bytes it read', async () => {
		const scratch = createScratch()
		try {
			const handle = await open(scratch.write('bytes.bin', 'abcdef'), 'r')
			try {
				const whole = Buffer.alloc(6)
				expect(await readStudyHandle(handle, whole)).toBe(whole)
				expect(whole.toString()).toBe('abcdef')
				const short = await readStudyHandle(handle, Buffer.alloc(9))
				expect(short.length).toBe(6)
				expect(short.toString()).toBe('abcdef')
				expect((await readStudyHandle(handle, Buffer.alloc(0))).length).toBe(0)
				const resumed = Buffer.alloc(6)
				expect(await readStudyHandle(handle, resumed, 4)).toBe(resumed)
				expect(resumed.subarray(4).toString()).toBe('ef')
			} finally {
				await handle.close()
			}
		} finally {
			scratch.destroy()
		}
	})
})

describe('readStudyProgress', () => {
	it('partial line: reads every complete row of an interrupted result and skips the unfinished row', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const [trial, ...others] = manifest.schedule
			if (trial === undefined) throw new Error('Missing trial')
			await writeStudyProgressResult(scratch.path, manifest, {})
			await mkdir(join(scratch.path, 'execution', 'trials', trial.id))
			const path = join(scratch.path, 'execution', 'trials', trial.id, 'evidence.jsonl')
			const complete = [
				'{"event":"saved","goal":"write","value":1}\r\n',
				'{"event":"saved","goal":"write","value":2}\n',
				'{"event":"saved","goal":"read","value":3}\n',
			].join('')
			for (const partial of [
				'{"event":"saved","goal":"read","va',
				'{"event":"saved","goal":"read","value":4}',
			]) {
				await writeFile(path, complete + partial)
				const progress = await readStudyProgress(scratch.path, 'write')
				expect(progress).toEqual({
					id: manifest.id,
					sealed: false,
					trials: [
						{
							trial,
							horizon: 2,
							ended: false,
							failure: undefined,
							goals: [
								{
									goal: 'write',
									rows: { first: 1, last: 2 },
									usage: [],
									stops: [],
									events: { saved: 2 },
									projection: undefined,
								},
								{
									goal: 'read',
									rows: { first: 3, last: 3 },
									usage: [],
									stops: [],
									events: { saved: 1 },
									projection: undefined,
								},
							],
						},
						...others.map((other) => ({
							trial: other,
							horizon: 2,
							ended: false,
							failure: undefined,
							goals: [],
						})),
					],
				})
			}
			await writeFile(path, complete)
			expect(
				(await readStudyProgress(scratch.path)).trials[0]?.goals.map(({ goal, rows }) => ({
					goal,
					rows,
				})),
			).toEqual([{ goal: 'read', rows: { first: 3, last: 3 } }])
		} finally {
			scratch.destroy()
		}
	})

	it('sealed ended: reads a sealed result whose attempts carry a failure', async () => {
		const scratch = createScratch()
		try {
			const directory = join(scratch.path, 'result')
			const manifest = buildCustodyManifest()
			const results = new StudyResultStore({ directory, manifest })
			await results.create()
			for (const trial of manifest.schedule) {
				const sink = await results.start(trial)
				await sink.append({ event: 'saved', goal: 'write', value: 'remember' })
				await results.finish({
					...buildCustodyAttempt(manifest, trial),
					failure: buildStudyFailure(),
				})
			}
			await results.seal()
			const progress = await readStudyProgress(directory)
			expect(progress.sealed).toBe(true)
			expect(progress.trials).toEqual(
				manifest.schedule.map((trial) => ({
					trial,
					horizon: 2,
					ended: true,
					failure: buildStudyFailure(),
					goals: [
						{
							goal: 'write',
							rows: { first: 1, last: 1 },
							usage: [],
							stops: [],
							events: { saved: 1 },
							projection: undefined,
						},
					],
				})),
			)
		} finally {
			scratch.destroy()
		}
	})

	it('live append: reads only complete rows while another process appends without syncing', async () => {
		const scratch = createScratch()
		const server = createServer()
		try {
			const manifest = buildCustodyManifest()
			const trial = manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			await writeStudyProgressResult(scratch.path, manifest, {})
			await mkdir(join(scratch.path, 'execution', 'trials', trial.id))
			const path = join(scratch.path, 'execution', 'trials', trial.id, 'evidence.jsonl')
			const second = '{"event":"saved","goal":"write","value":2}'
			const steps = [
				'{"event":"saved","goal":"write","value":1}\n',
				second.slice(0, 20),
				second.slice(20) + '\n',
				'{"event":"saved","goal":"read","value":3}\n',
			]
			const pipe =
				process.platform === 'win32'
					? '\\\\.\\pipe\\study-progress-' + randomUUID()
					: join(scratch.path, 'live.sock')
			const connection = new Promise<Socket>((resolve) => server.once('connection', resolve))
			await new Promise<void>((resolve) => server.listen(pipe, resolve))
			// The child appends one step per message and holds the file open, syncing only at the end.
			const child = spawnStudyScript(
				[
					"const fs = require('node:fs')",
					"const net = require('node:net')",
					`const steps = ${JSON.stringify(steps)}`,
					`const handle = fs.openSync(${JSON.stringify(path)}, 'a')`,
					`const socket = net.connect(${JSON.stringify(pipe)})`,
					"socket.on('data', () => {",
					'const step = steps.shift()',
					'if (step === undefined) { fs.fsyncSync(handle); fs.closeSync(handle); socket.end(); return }',
					'fs.writeSync(handle, step)',
					"process.stdout.write('appended\\n')",
					'})',
				].join('\n'),
			)
			const exited = new Promise((resolve) => child.once('exit', resolve))
			if (child.stdout === null) throw new Error('Missing child output')
			const socket = await connection
			socket.write('next')
			const counts: number[] = []
			for await (const line of createInterface({ input: child.stdout })) {
				expect(line).toBe('appended')
				const progress = await readStudyProgress(scratch.path, 'write')
				counts.push(
					(progress.trials[0]?.goals ?? []).reduce(
						(total, { events }) => total + (events.saved ?? 0),
						0,
					),
				)
				socket.write('next')
			}
			expect(await exited).toBe(0)
			// The first reading follows a written row that no sync has reached, so it proves visibility.
			expect(counts).toEqual([1, 1, 2, 3])
			const final = await readStudyProgress(scratch.path, 'write')
			expect(final.trials[0]?.goals.map(({ goal, rows }) => ({ goal, rows }))).toEqual([
				{ goal: 'write', rows: { first: 1, last: 2 } },
				{ goal: 'read', rows: { first: 3, last: 3 } },
			])
		} finally {
			server.close()
			scratch.destroy()
		}
	})

	it('usage: tallies each role over hand-counted wire rows and replays up to the ancestor prefix', async () => {
		const scratch = createScratch()
		try {
			const base = buildCustodyManifest()
			const ancestor = { result: 'ancestor', seal: 'd'.repeat(64), identity: base.identity }
			const recorded = buildCustodyManifest({
				record: { bytes: 32768, calls: 256, duration: 15000 },
				ancestor,
			})
			const trial = base.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			const request = { path: '/api/chat', model: 'fixture', options: {} }
			// Each entry is the goal, role, finish, prompt, completion, ordinal, and timing total and cache.
			const wires = (
				[
					['write', 'agent', 'stop', 10, 5, 1, [100, 4]],
					['write', 'agent', 'length', 20, 7, 2, [200, 6]],
					['write', 'agent', 'stop', 30, 9, 3, [300, null]],
					['write', 'judge', 'stop', 8, null, 4, undefined],
					['read', 'agent', 'stop', 1, 2, 6, [10, 4]],
					['read', 'agent', 'stop', 3, 4, 7, [20, 6]],
				] as const
			).map(([goal, role, finish, prompt, completion, ordinal, timing]) => ({
				event: 'wire',
				goal,
				value: {
					...request,
					role,
					finish,
					prompt,
					completion,
					bytes: 9,
					ordinal,
					timing:
						timing === undefined
							? null
							: {
									durations: { total: timing[0], load: null, prompt: null, decode: null },
									counts: { prompt: 1, decode: 1, cached: timing[1] },
									invalid: false,
								},
				},
			}))
			const rows = [
				{
					event: 'dispatch',
					goal: 'write',
					value: { ...request, role: 'agent', bytes: 9, ordinal: 1 },
				},
				...wires.slice(0, 4),
				{
					event: 'wire',
					goal: 'write',
					value: { ordinal: 5, role: 'maintenance', path: '/api/ps' },
				},
				{ event: 'wire', goal: 'write', value: { ...request, role: 'robot', prompt: 1 } },
				{
					event: 'stop',
					goal: 'write',
					value: {
						role: 'agent',
						path: '/api/chat',
						finish: 'length',
						prompt: 30,
						completion: 9,
						stop: { layer: 'scope', id: 'Goal tokens', max: 100, consumed: null },
					},
				},
				{ event: 'cut', goal: 'write', value: { role: 'agent', path: '/api/chat' } },
				...wires.slice(4),
			]
			const declaration = buildOllamaDeclaration(undefined, {
				trial: trial.id,
				ancestor: {
					...ancestor,
					file: { path: `trials/${trial.id}/exchanges.jsonl`, bytes: 1, digest: 'e'.repeat(64) },
					prefix: 2,
				},
			})
			expect(isStudyExchangeDeclaration(parseJSON(JSON.stringify(declaration)))).toBe(true)
			const write = {
				goal: 'write',
				rows: { first: 1, last: 9 },
				usage: [
					{
						role: 'agent',
						calls: 3,
						replayed: 2,
						prompt: 60,
						cached: undefined,
						completion: 21,
						total: 600,
						length: 1,
					},
					{
						role: 'judge',
						calls: 1,
						replayed: 0,
						prompt: 8,
						cached: undefined,
						completion: undefined,
						total: 0,
						length: 0,
					},
					{
						role: 'maintenance',
						calls: 1,
						replayed: 0,
						prompt: undefined,
						cached: undefined,
						completion: undefined,
						total: 0,
						length: 0,
					},
				],
				stops: [{ layer: 'scope', id: 'Goal tokens', max: 100, consumed: undefined }],
				events: { dispatch: 1, wire: 6, stop: 1, cut: 1 },
				projection: undefined,
			}
			const read = {
				goal: 'read',
				rows: { first: 10, last: 11 },
				usage: [
					{
						role: 'agent',
						calls: 2,
						replayed: 0,
						prompt: 4,
						cached: 10,
						completion: 6,
						total: 30,
						length: 0,
					},
				],
				stops: [],
				events: { wire: 2 },
				projection: undefined,
			}
			for (const [manifest, replayed] of [
				[recorded, 2],
				[base, 0],
			] as const) {
				const directory = join(scratch.path, String(replayed))
				await writeStudyProgressResult(directory, manifest, { [trial.id]: rows })
				await writeFile(
					join(directory, 'execution', 'trials', trial.id, 'exchanges.jsonl'),
					JSON.stringify(declaration) + '\n{"partial":',
				)
				const goals = (await readStudyProgress(directory, 'write')).trials[0]?.goals
				expect(goals).toEqual([
					{
						...write,
						usage: write.usage.map((usage) =>
							usage.role === 'agent' ? { ...usage, replayed } : usage,
						),
					},
					read,
				])
			}
		} finally {
			scratch.destroy()
		}
	})

	it('terminal: an absent or unwritten attempt runs, and a corrupt one refuses custody naming its trial', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const trial = requireValue(manifest.schedule[0])
			const directory = join(scratch.path, 'attempt')
			const rows = [{ event: 'saved', goal: 'write', value: 1 }]
			await writeStudyProgressResult(directory, manifest, { [trial.id]: rows })
			const path = join(directory, 'execution', 'trials', trial.id, 'attempt.json')
			const running = await readStudyProgress(directory)
			expect(running.trials[0]).toMatchObject({ ended: false, failure: undefined })
			await writeFile(path, '')
			expect((await readStudyProgress(directory)).trials[0]?.ended).toBe(false)
			const foreign = buildCustodyAttempt(manifest, requireValue(manifest.schedule[1]))
			for (const bytes of ['{"partial":', '{"trial":{}}', JSON.stringify(foreign)]) {
				await writeFile(path, bytes)
				await expect(readStudyProgress(directory)).rejects.toMatchObject({
					code: 'CUSTODY',
					message: `Terminal attempt of trial ${trial.id} is invalid`,
				})
			}
			await rm(path)
			await mkdir(path)
			await expect(readStudyProgress(directory)).rejects.toMatchObject({ code: 'CUSTODY' })
			await rm(path, { recursive: true })
			await writeFile(path, JSON.stringify(buildCustodyAttempt(manifest, trial)))
			expect((await readStudyProgress(directory)).trials[0]?.ended).toBe(true)
			await writeFile(path, '')
			await writeFile(join(directory, 'seal.json'), '{}')
			await expect(readStudyProgress(directory)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('sidecar: an absent or unfinished declaration replays nothing, and a corrupt one refuses custody', async () => {
		const scratch = createScratch()
		try {
			const base = buildCustodyManifest()
			const trial = requireValue(base.schedule[0])
			const manifest = buildCustodyManifest({
				record: { bytes: 32768, calls: 256, duration: 15000 },
				ancestor: { result: 'ancestor', seal: 'd'.repeat(64), identity: base.identity },
			})
			const directory = join(scratch.path, 'sidecar')
			const rows = [{ event: 'wire', goal: 'write', value: { role: 'agent', ordinal: 1 } }]
			await writeStudyProgressResult(directory, manifest, { [trial.id]: rows })
			const path = join(directory, 'execution', 'trials', trial.id, 'exchanges.jsonl')
			expect((await readStudyProgress(directory)).trials[0]?.goals[0]?.usage[0]?.replayed).toBe(0)
			await writeFile(path, '{"phase":"declaration"')
			expect((await readStudyProgress(directory)).trials[0]?.goals[0]?.usage[0]?.replayed).toBe(0)
			for (const line of ['{"partial":', '{"phase":"declaration"}', '[]']) {
				await writeFile(path, `${line}\n`)
				await expect(readStudyProgress(directory)).rejects.toMatchObject({
					code: 'CUSTODY',
					message: `Exchange declaration of trial ${trial.id} is invalid`,
				})
			}
			await rm(path)
			await mkdir(path)
			await expect(readStudyProgress(directory)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('from: lists from the named goal onward, else each trial last goal, and refuses an unknown goal', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const [first, second, third] = manifest.schedule
			if (first === undefined || second === undefined || third === undefined)
				throw new Error('Missing trials')
			await writeStudyProgressResult(scratch.path, manifest, {
				[first.id]: [
					{ event: 'saved', goal: 'write', value: 1 },
					{ event: 'saved', goal: 'read', value: 2 },
				],
				[second.id]: [{ event: 'saved', goal: 'write', value: 3 }],
			})
			// Every later scheduled trial holds no rows, so it lists no goal.
			for (const [from, listed] of [
				['write', [['write', 'read'], ['write']]],
				['read', [['read'], []]],
				[undefined, [['read'], ['write']]],
			] as const)
				expect(
					(await readStudyProgress(scratch.path, from)).trials.map(({ goals }) =>
						goals.map(({ goal }) => goal),
					),
				).toEqual([...listed, ...manifest.schedule.slice(listed.length).map(() => [])])
			// An invalid trial file stays unread when the goal refusal comes first.
			await mkdir(join(scratch.path, 'execution', 'trials', third.id))
			await writeFile(join(scratch.path, 'execution', 'trials', third.id, 'evidence.jsonl'), '{\n')
			await expect(readStudyProgress(scratch.path, 'nope')).rejects.toMatchObject({
				code: 'CONFIG',
				message: expect.stringContaining('"nope"'),
			})
			await expect(readStudyProgress(scratch.path)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('refusals: refuses an absent or invalid manifest and names an invalid complete row', async () => {
		const scratch = createScratch()
		try {
			await expect(readStudyProgress(scratch.path)).rejects.toMatchObject({
				code: 'CUSTODY',
				message: 'Result has no execution manifest',
			})
			await mkdir(join(scratch.path, 'execution'))
			await writeFile(join(scratch.path, 'execution', 'manifest.json'), '{')
			await expect(readStudyProgress(scratch.path)).rejects.toMatchObject({
				code: 'CUSTODY',
				message: 'Invalid execution manifest',
			})
			const manifest = buildCustodyManifest()
			const trial = manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			for (const [rows, line] of [
				['{"event":"saved","goal":"write","value":1}\n{"event":"saved"}\n', 2],
				['{"event":"saved","goal":"write","value":1}\n\n', 2],
				['{"event":"saved","goal":"nope","value":1}\n', 1],
			] as const) {
				await writeStudyProgressResult(scratch.path, manifest, {})
				await mkdir(join(scratch.path, 'execution', 'trials', trial.id), { recursive: true })
				await writeFile(join(scratch.path, 'execution', 'trials', trial.id, 'evidence.jsonl'), rows)
				await expect(readStudyProgress(scratch.path)).rejects.toMatchObject({
					code: 'CUSTODY',
					message: `Evidence line ${line} of trial ${trial.id} is not a row of a declared goal`,
				})
			}
			await writeFile(
				join(scratch.path, 'execution', 'trials', trial.id, 'evidence.jsonl'),
				'x'.repeat(manifest.bounds.trial.bytes + 1),
			)
			await expect(readStudyProgress(scratch.path)).rejects.toMatchObject({
				code: 'CUSTODY',
				message: 'Evidence exceeds the declared trial',
			})
		} finally {
			scratch.destroy()
		}
	})

	it('project: hands each listed goal exactly its rows and keeps each reading by position', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const [first, second] = manifest.schedule
			if (first === undefined || second === undefined) throw new Error('Missing trials')
			const rows = [
				{ event: 'saved', goal: 'write', value: 1 },
				{ event: 'saved', goal: 'read', value: 2 },
				{ event: 'saved', goal: 'write', value: 3 },
			]
			await writeStudyProgressResult(scratch.path, manifest, {
				[first.id]: rows,
				[second.id]: [{ event: 'saved', goal: 'write', value: 4 }],
			})
			const received: Array<readonly StudyProgressTarget[]> = []
			const progress = await readStudyProgress(scratch.path, 'write', async (targets) => {
				received.push(targets)
				return targets.map(({ goal, evidence }) => ({ goal, count: evidence.length }))
			})
			expect(received).toEqual([
				[
					{ trial: first, goal: 'write', evidence: [rows[0], rows[2]] },
					{ trial: first, goal: 'read', evidence: [rows[1]] },
					{ trial: second, goal: 'write', evidence: [{ event: 'saved', goal: 'write', value: 4 }] },
				],
			])
			expect(
				progress.trials.map(({ goals }) =>
					goals.map(({ goal, rows: range, projection }) => ({ goal, range, projection })),
				),
			).toEqual([
				[
					{ goal: 'write', range: { first: 1, last: 3 }, projection: { goal: 'write', count: 2 } },
					{ goal: 'read', range: { first: 2, last: 2 }, projection: { goal: 'read', count: 1 } },
				],
				[{ goal: 'write', range: { first: 1, last: 1 }, projection: { goal: 'write', count: 1 } }],
				...manifest.schedule.slice(2).map(() => []),
			])
			// Without a projection, and with one that answers no readings, every reading is undefined.
			for (const unread of [
				await readStudyProgress(scratch.path, 'write'),
				await readStudyProgress(scratch.path, 'write', async () => []),
			])
				expect(
					unread.trials.flatMap(({ goals }) => goals.map(({ projection }) => projection)),
				).toEqual([undefined, undefined, undefined])
		} finally {
			scratch.destroy()
		}
	})

	it('frame batches: splits listed goals whose rows exceed one frame into requests within it', async () => {
		const scratch = createScratch()
		try {
			const goals = ['goal-1', 'goal-2', 'goal-3']
			const manifest = buildStudyProgressManifest(goals)
			const trial = manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			const raw = 'x'.repeat(1024 * 1024)
			await writeStudyProgressResult(scratch.path, manifest, {
				[trial.id]: goals.flatMap((goal) =>
					Array.from({ length: 7 }, (_, index) => ({ event: 'note', goal, value: { index, raw } })),
				),
			})
			const options = {
				root: scratch.path,
				entry: join(scratch.path, 'dist', 'bin', 'main.js'),
				adapter: join(scratch.path, 'studies', 'memory', 'index.ts'),
				roots: [scratch.path],
			}
			const batches: Array<readonly StudyProgressTarget[]> = []
			const progress = await readStudyProgress(
				scratch.path,
				'goal-1',
				async (targets) => {
					batches.push(targets)
					return targets.map(({ goal }) => goal)
				},
				Buffer.byteLength(
					JSON.stringify(
						valueToWire({ ...options, operation: 'progress', input: { targets: [] } }),
					),
				),
			)
			// Each size is the request StudyTask encodes for its batch, the whole listing last.
			const sizes = [...batches, batches.flat()].map((targets) =>
				Buffer.byteLength(
					JSON.stringify(valueToWire({ ...options, operation: 'progress', input: { targets } })),
				),
			)
			expect(batches.length).toBeGreaterThan(1)
			expect(sizes.at(-1)).toBeGreaterThan(STUDY_FRAME_BYTES)
			for (const size of sizes.slice(0, -1)) expect(size).toBeLessThanOrEqual(STUDY_FRAME_BYTES)
			expect(batches.flat().map(({ goal }) => goal)).toEqual(goals)
			expect(
				progress.trials[0]?.goals.map(({ goal, projection }) => ({ goal, projection })),
			).toEqual(goals.map((goal) => ({ goal, projection: goal })))
		} finally {
			scratch.destroy()
		}
	})

	it('77 goals: reads every goal of a generated observed result from its first goal', async () => {
		const scratch = createScratch()
		try {
			const scale = STUDY_PROGRESS_SCALE
			const { manifest } = await writeStudyProgressFixture(scratch.path)
			const progress = await readStudyProgress(scratch.path, 'goal-1')
			expect(progress.trials.map(({ goals }) => goals.length)).toEqual([scale.goals, scale.reached])
			expect(progress.trials.map(({ trial }) => trial)).toEqual(manifest.schedule)
			for (const { goals } of progress.trials)
				for (const [index, { goal, events, usage }] of goals.entries()) {
					const burst = index % scale.cadence === scale.cadence - 1
					expect(goal).toBe(`goal-${index + 1}`)
					expect(events).toEqual({
						note: 1,
						dispatch: burst ? 2 + scale.burst : 2,
						wire: burst ? 2 + scale.burst : 2,
						checkpoint: 1,
					})
					expect(usage).toEqual([
						{
							role: 'agent',
							calls: 2,
							replayed: 0,
							prompt: 2 * scale.prompt,
							cached: 2 * scale.cached,
							completion: 2 * scale.completion,
							total: 2 * scale.total,
							length: 1,
						},
						...(burst
							? [
									{
										role: 'judge',
										calls: scale.burst,
										replayed: 0,
										prompt: scale.burst * scale.judge,
										cached: undefined,
										completion: undefined,
										total: 0,
										length: 0,
									},
								]
							: []),
					])
				}
			expect(
				buildStudyProgressRows('goal-7', 6).filter(({ event }) => event === 'wire'),
			).toHaveLength(2 + scale.burst)
		} finally {
			scratch.destroy()
		}
	})
})
import * as exchangeStores from '../../../../src/server/stores/index.js'
import {
	buildStudyExchangeRows,
	buildOpenStudyExchangeRows,
	mutateStudyExchangeRows,
} from '../../../setupServer.js'
import { STUDY_EXCHANGE_MUTATIONS, STUDY_OPEN_EXCHANGE_MUTATIONS } from '../../../setupStudy.js'
describe('strict exchange rows', () => {
	it('O5 reads the independent complete open journal control', () => {
		const rows = buildOpenStudyExchangeRows()
		expect(exchangeStores.readStudyExchangeRows(mutateStudyExchangeRows(rows, 'complete'))).toEqual(
			rows,
		)
	})
	it.each(
		STUDY_OPEN_EXCHANGE_MUTATIONS.filter(
			(mutation) => mutation !== 'goals' && mutation !== 'record',
		),
	)('O5 refuses %s open rows', (mutation) => {
		expect(() =>
			exchangeStores.readStudyExchangeRows(
				mutateStudyExchangeRows(buildOpenStudyExchangeRows(), mutation),
			),
		).toThrow(/\S/)
	})

	it('reads the complete independent journal control', () => {
		const rows = buildStudyExchangeRows()
		expect(exchangeStores.readStudyExchangeRows(mutateStudyExchangeRows(rows, 'complete'))).toEqual(
			rows,
		)
	})
	it.each(STUDY_EXCHANGE_MUTATIONS)('refuses %s history', (mutation) => {
		expect(() =>
			exchangeStores.readStudyExchangeRows(
				mutateStudyExchangeRows(buildStudyExchangeRows(), mutation),
			),
		).toThrow(/\S/)
	})
})

describe('validateStudyExchangeRows', () => {
	it('reads each row a fixed number of times, so doubling a journal doubles its reads', () => {
		const record = { bytes: 1e12, calls: 100000, duration: 1e9 }
		const [small, large] = [100, 200].map((count) => {
			const reads = createRecorder<readonly []>()
			const rows = buildOpenStudyExchangeRows('r1-first-small', record, count)
			const progress = validateStudyExchangeRows(
				new Proxy(rows, {
					get: (target, key, receiver) => {
						if (typeof key === 'string' && /^\d+$/.test(key)) reads.handler()
						return Reflect.get(target, key, receiver)
					},
				}),
			)
			expect(progress).toMatchObject({ execution: count, closed: true })
			return { rows: rows.length, reads: reads.count }
		})
		expect(requireValue(large).reads / requireValue(large).rows).toBeLessThanOrEqual(
			requireValue(small).reads / requireValue(small).rows + 0.1,
		)
	})

	it('derives the same progress one row at a time as over the whole journal', () => {
		const rows = buildOpenStudyExchangeRows()
		const declaration = requireValue(rows[0])
		if (declaration.phase !== 'declaration') throw new Error('Missing declaration')
		expect(
			rows.slice(1).reduce(advanceStudyExchangeProgress, buildStudyExchangeProgress(declaration)),
		).toEqual(validateStudyExchangeRows(rows))
		expect(buildStudyExchangeProgress(declaration)).toMatchObject({
			attempts: 0,
			execution: 0,
			goal: undefined,
			closed: false,
		})
		const closed = validateStudyExchangeRows(rows)
		expect(() => advanceStudyExchangeProgress(closed, requireValue(rows[1]))).toThrow(
			/partial or failed/,
		)
		expect(() => advanceStudyExchangeProgress(closed, declaration)).toThrow(/partial or failed/)
	})
})

describe('readStudyProgressAttempt and readStudyProgressPrefix', () => {
	it('read an absent record as running and no declaration', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const trial = requireValue(manifest.schedule[0]).id
			await expect(
				readStudyProgressAttempt(scratch.path, manifest, trial, false),
			).resolves.toBeUndefined()
			await expect(readStudyProgressPrefix(scratch.path, trial)).resolves.toBe(0)
		} finally {
			scratch.destroy()
		}
	})
})
