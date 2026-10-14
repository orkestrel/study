import { createRecorder } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudyEvidenceSink } from '../../../../src/server/stores/StudyEvidenceSink.js'

describe('StudyEvidenceSink', () => {
	it('charges the enclosing trial before writing otherwise admissible goal evidence', async () => {
		const scratch = createScratch()
		try {
			const file = await open(join(scratch.path, 'evidence.jsonl'), 'wx')
			const reservations = createRecorder<readonly [number]>()
			const sink = new StudyEvidenceSink({
				file,
				goals: ['write', 'read'],
				goal: 100,
				trial: 80,
				budget: { reserve: reservations.handler },
			})
			await sink.append({ event: 'saved', goal: 'write', value: true })
			await expect(
				sink.append({ event: 'saved', goal: 'read', value: true }),
			).rejects.toMatchObject({ code: 'CAPACITY' })
			await sink.close()
			expect(reservations.count).toBe(1)
			expect(await readFile(join(scratch.path, 'evidence.jsonl'), 'utf8')).toBe(
				'{"event":"saved","goal":"write","value":true}\n',
			)
		} finally {
			scratch.destroy()
		}
	})
	it('owns exact append reservations, closes idempotently, and refuses foreign evidence before charging', async () => {
		const scratch = createScratch()
		try {
			const file = await open(join(scratch.path, 'evidence.jsonl'), 'wx')
			const reservations = createRecorder<readonly [number]>()
			const sink = new StudyEvidenceSink({
				file,
				goals: ['write'],
				goal: 100,
				trial: 100,
				budget: { reserve: reservations.handler },
			})
			await expect(
				sink.append({ event: 'saved', goal: 'foreign', value: true }),
			).rejects.toMatchObject({ code: 'EVIDENCE' })
			await sink.append({ event: 'saved', goal: 'write', value: true })
			await sink.close()
			await sink.close()
			const bytes = await readFile(join(scratch.path, 'evidence.jsonl'))
			expect(reservations.calls).toEqual([[bytes.byteLength]])
			await expect(
				sink.append({ event: 'saved', goal: 'write', value: false }),
			).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('reports an actual failed descriptor write and refuses successful terminal draining', async () => {
		const scratch = createScratch()
		try {
			const file = await open(join(scratch.path, 'evidence.jsonl'), 'wx')
			await file.close()
			const reservations = createRecorder<readonly [number]>()
			const sink = new StudyEvidenceSink({
				file,
				goals: ['write'],
				goal: 100,
				trial: 100,
				budget: { reserve: reservations.handler },
			})
			await expect(
				sink.append({ event: 'saved', goal: 'write', value: true }),
			).rejects.toMatchObject({ code: 'EBADF' })
			await expect(sink.close()).rejects.toMatchObject({ code: 'EBADF' })
			expect(await readFile(join(scratch.path, 'evidence.jsonl'), 'utf8')).toBe('')
		} finally {
			scratch.destroy()
		}
	})
})
