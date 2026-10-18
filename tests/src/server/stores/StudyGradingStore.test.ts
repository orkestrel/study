import { createScratch } from '@orkestrel/test/server'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCompactCustodyManifest, buildStudyRubric, readSettled } from '../../../setupStudy.js'
import {
	buildCustodyGrading,
	buildCustodyLabeling,
	buildCustodyPacketLabeling,
	retainStudyFixture,
} from '../../../setupServer.js'
import { StudyGradingStore } from '../../../../src/server/stores/StudyGradingStore.js'
import { encodeStudyJSON, hashStudyBytes } from '../../../../src/server/helpers.js'
import {
	buildStudyPacket,
	computeStudyPacketDigest,
} from '../../../../src/server/stores/helpers.js'

describe('StudyGradingStore', () => {
	it('binds neutral packet and private map bytes and refuses forged, tampered or foreign packet custody', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const rubric = buildStudyRubric()
			const base = buildCustodyGrading(result, rubric)
			const packet = buildStudyPacket(result, rubric, base.rubric)
			if (packet === undefined) throw new Error('Missing packet fixture')
			const grading = { ...base, packet: computeStudyPacketDigest(packet) }
			const store = new StudyGradingStore({ result, rubric: encodeStudyJSON(rubric), packet })
			const original = await readFile(join(result.directory, 'execution', 'manifest.json'))
			const id = await store.write(grading)
			expect(await store.write(grading)).toBe(id)
			await appendFile(join(result.directory, 'grades', id, `${grading.packet}.packet.json`), ' ')
			await expect(store.read(id)).rejects.toMatchObject({ code: 'CUSTODY' })
			const later = await store.write({ ...grading, grader: 'packet-v2' })
			await appendFile(
				join(result.directory, 'grades', later, `${grading.packet}.mapping.json`),
				' ',
			)
			await expect(store.read(later)).rejects.toMatchObject({ code: 'CUSTODY' })
			const forged = { ...packet, mapping: encodeStudyJSON({ entries: [] }) }
			await expect(
				new StudyGradingStore({ result, rubric: encodeStudyJSON(rubric), packet: forged }).write({
					...grading,
					packet: computeStudyPacketDigest(forged),
				}),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			const labels = buildCustodyPacketLabeling(result, rubric)
			const foreign = {
				...labels,
				judgments: labels.judgments.map((judgment) => ({ ...judgment, criterion: 'first-write' })),
			}
			await expect(
				new StudyGradingStore({
					result,
					rubric: encodeStudyJSON(rubric),
					packet,
					labels: encodeStudyJSON(foreign),
				}).write({ ...grading, labels: hashStudyBytes(encodeStudyJSON(foreign)) }),
			).rejects.toMatchObject({ code: 'EVIDENCE' })
			expect(await readFile(join(result.directory, 'execution', 'manifest.json'))).toEqual(original)
		} finally {
			scratch.destroy()
		}
	})
	it('reproduces the same exact predicate grading identity and preserves execution bytes', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const rubric = buildStudyRubric()
			const grades = new StudyGradingStore({ result, rubric: encodeStudyJSON(rubric) })
			const original = await Promise.all(
				result.seal.files.map((file) =>
					readFile(join(result.directory, 'execution', ...file.path.split('/'))),
				),
			)
			const grading = buildCustodyGrading(result, rubric)
			const [id, duplicate] = await Promise.all([grades.write(grading), grades.write(grading)])
			expect(duplicate).toBe(id)
			expect(
				await new StudyGradingStore({ result, rubric: encodeStudyJSON(rubric) }).write(grading),
			).toBe(id)
			expect(await grades.read(id)).toEqual({ ...grading, labels: undefined })
			expect(await grades.read('f'.repeat(64))).toBeUndefined()
			const changed = await grades.write({ ...grading, grader: 'predicate-v2' })
			expect(changed).not.toBe(id)
			expect(scratch.names('result/grades')).toEqual(expect.arrayContaining([id, changed]))
			expect(
				await Promise.all(
					result.seal.files.map((file) =>
						readFile(join(result.directory, 'execution', ...file.path.split('/'))),
					),
				),
			).toEqual(original)
		} finally {
			scratch.destroy()
		}
	})

	it('settles a later write only after every earlier write settled', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const rubric = buildStudyRubric()
			const grades = new StudyGradingStore({ result, rubric: encodeStudyJSON(rubric) })
			const grading = buildCustodyGrading(result, rubric)
			const first = grades.write(grading)
			// Refused after the same verification the first write needs, so it would settle first if unqueued.
			const second = grades.write({ ...grading, rubric: 'f'.repeat(64) })
			await expect(second).rejects.toMatchObject({ code: 'EVIDENCE' })
			expect(await readSettled(first)).toBe(true)
			expect(scratch.names('result/grades')).toEqual([await first])
		} finally {
			scratch.destroy()
		}
	})

	it('imports exact labels bytes and assigns distinct identities to changed label provenance', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const rubric = buildStudyRubric()
			const originalLabels = buildCustodyLabeling(result)
			const base = buildCustodyGrading(result, rubric, originalLabels)
			const packet = buildStudyPacket(result, rubric, base.rubric)
			if (packet === undefined) throw new Error('Missing packet fixture')
			const labels = buildCustodyPacketLabeling(result, rubric)
			const grading = {
				...base,
				labels: hashStudyBytes(encodeStudyJSON(labels)),
				packet: computeStudyPacketDigest(packet),
			}
			const first = new StudyGradingStore({
				result,
				rubric: encodeStudyJSON(rubric),
				labels: encodeStudyJSON(labels),
				packet,
			})
			const id = await first.write(grading)
			const changed = { ...labels, labeler: 'human-v2' }
			const second = new StudyGradingStore({
				result,
				rubric: encodeStudyJSON(rubric),
				labels: encodeStudyJSON(changed),
				packet,
			})
			const later = await second.write({
				...grading,
				labels: hashStudyBytes(encodeStudyJSON(changed)),
			})
			expect(later).not.toBe(id)
			expect(
				await readFile(join(result.directory, 'grades', id, `${grading.labels}.labels.json`)),
			).toEqual(Buffer.from(encodeStudyJSON(labels)))
			expect((await first.read(id))?.judgments).toEqual(grading.judgments)
			expect((await first.read(later))?.labels).not.toBe(grading.labels)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses omitted coverage, foreign attempt identities, artifact bindings, and unbound semantic success', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const rubric = buildStudyRubric()
			const grades = new StudyGradingStore({ result, rubric: encodeStudyJSON(rubric) })
			const grading = buildCustodyGrading(result, rubric)
			await expect(grades.write({ ...grading, judgments: [] })).rejects.toMatchObject({
				code: 'EVIDENCE',
			})
			await expect(grades.write({ ...grading, attempts: ['unexecuted'] })).rejects.toMatchObject({
				code: 'EVIDENCE',
			})
			await expect(grades.write({ ...grading, result: result.manifest.id })).rejects.toMatchObject({
				code: 'EVIDENCE',
			})
			await expect(grades.write({ ...grading, rubric: 'f'.repeat(64) })).rejects.toMatchObject({
				code: 'EVIDENCE',
			})
			await expect(grades.write({ ...grading, labels: 'f'.repeat(64) })).rejects.toMatchObject({
				code: 'EVIDENCE',
			})
			await expect(
				grades.write({
					...grading,
					judgments: grading.judgments.map((judgment) =>
						judgment.method === 'human'
							? { ...judgment, verdict: 'achieved', references: ['unbound'] }
							: judgment,
					),
				}),
			).rejects.toMatchObject({ code: 'EVIDENCE' })
			expect(scratch.has('result/grades')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('detects tampered grading, artifact, and execution bytes and never overwrites them', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(
				join(scratch.path, 'result'),
				buildCompactCustodyManifest(),
			)
			const rubric = buildStudyRubric()
			const grades = new StudyGradingStore({ result, rubric: encodeStudyJSON(rubric) })
			const grading = buildCustodyGrading(result, rubric)
			const id = await grades.write(grading)
			const artifact = join(result.directory, 'grades', id, `${grading.rubric}.rubric.json`)
			await appendFile(artifact, ' ')
			await expect(grades.read(id)).rejects.toMatchObject({ code: 'CUSTODY' })
			await expect(grades.write(grading)).rejects.toMatchObject({ code: 'CUSTODY' })
			expect((await readFile(artifact, 'utf8')).endsWith(' ')).toBe(true)
			const later = await grades.write({ ...grading, grader: 'later' })
			await appendFile(join(result.directory, 'grades', later, 'grading.json'), ' ')
			await expect(grades.read(later)).rejects.toMatchObject({ code: 'CUSTODY' })
			await appendFile(join(result.directory, 'execution', 'manifest.json'), ' ')
			await expect(grades.write({ ...grading, grader: 'after-tamper' })).rejects.toMatchObject({
				code: 'CUSTODY',
			})
		} finally {
			scratch.destroy()
		}
	})
})
