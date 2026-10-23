import { createScratch } from '@orkestrel/test/server'
import { readdirSync } from 'node:fs'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	buildCompactCustodyManifest,
	buildCustodyManifest,
	buildStudyHole,
	buildStudyRubric,
	buildStudySparse,
} from '../../../setupStudy.js'
import { STUDY_CUSTODY_BYTES } from '../../../../src/server/stores/constants.js'
import { buildCustodyPacketLabeling, retainStudyFixture } from '../../../setupServer.js'
import { encodeStudyJSON, hashStudyBytes } from '../../../../src/server/helpers.js'
import {
	checkStudyDirectory,
	buildStudyPacket,
	buildStudyPacketLinks,
	computeStudyPacketDigest,
	computeStudySealId,
	readStudyBytes,
	readStudyHandle,
	readStudyResult,
	scanStudyExecution,
	scanStudyTree,
	validateStudyEvidenceBytes,
	translateStudyPacketLabeling,
	writeStudyBytes,
} from '../../../../src/server/stores/helpers.js'

describe('study custody helpers', () => {
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
			const labels = buildCustodyPacketLabeling(result, rubric)
			expect(translateStudyPacketLabeling(result, rubric, digest, labels)).toMatchObject([
				{
					trial: result.manifest.schedule[0]?.id,
					criterion: 'first-read',
					verdict: 'achieved',
					method: 'human',
				},
			])
			expect(() =>
				translateStudyPacketLabeling(result, rubric, digest, { ...labels, packet: 'f'.repeat(64) }),
			).toThrow('different semantic packet')
			expect(() =>
				translateStudyPacketLabeling(result, rubric, digest, {
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
