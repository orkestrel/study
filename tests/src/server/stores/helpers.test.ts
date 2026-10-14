import { createScratch } from '@orkestrel/test/server'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	buildCompactCustodyManifest,
	buildCustodyManifest,
	buildStudyRubric,
} from '../../../setupStudy.js'
import { buildCustodyPacketLabels, retainStudyFixture } from '../../../setupServer.js'
import {
	checkStudyDirectory,
	buildStudyPacket,
	buildStudyPacketLinks,
	computeStudyPacketDigest,
	computeStudySealId,
	encodeStudyJSON,
	hashStudyBytes,
	readStudyBytes,
	readStudyResult,
	scanStudyExecution,
	validateStudyEvidenceBytes,
	translateStudyPacketLabels,
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
	it('encodes stable keys and omitted optional fields and hashes exact bytes', () => {
		expect(
			Buffer.from(encodeStudyJSON({ optional: undefined, nested: { z: 2, a: 1 } })).toString(),
		).toBe('{"nested":{"a":1,"z":2}}\n')
		expect(encodeStudyJSON({ b: 2, a: 1 })).toEqual(encodeStudyJSON({ a: 1, b: 2 }))
		expect(hashStudyBytes(new Uint8Array())).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		)
		expect(() => encodeStudyJSON(undefined)).toThrow('Record cannot be encoded')
		expect(computeStudySealId('execution', [])).not.toBe(computeStudySealId('other', []))
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
