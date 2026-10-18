import { parseJSON } from '@orkestrel/contract'
import { createRecorder } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { StudyEvidenceSink } from '../../../../src/server/stores/StudyEvidenceSink.js'

describe('StudyEvidenceSink', () => {
	it('owns its selected descriptor after the caller replaces the options file', async () => {
		const scratch = createScratch()
		const first = await open(join(scratch.path, 'first.jsonl'), 'wx')
		const second = await open(join(scratch.path, 'second.jsonl'), 'wx')
		try {
			const reservations = createRecorder<readonly [number]>()
			const options = {
				file: first,
				goals: ['write'],
				goal: 100,
				trial: 100,
				budget: { reserve: reservations.handler },
			}
			const sink = new StudyEvidenceSink(options)
			const appending = sink.append({ event: 'saved', goal: 'write', value: true })
			options.file = second
			await appending
			await sink.close()
			expect(await readFile(join(scratch.path, 'first.jsonl'), 'utf8')).toBe(
				'{"event":"saved","goal":"write","value":true}\n',
			)
			expect(await readFile(join(scratch.path, 'second.jsonl'), 'utf8')).toBe('')
			await expect(first.writeFile('late')).rejects.toMatchObject({ code: 'EBADF' })
			await second.writeFile('caller')
			expect(await readFile(join(scratch.path, 'second.jsonl'), 'utf8')).toBe('caller')
		} finally {
			await Promise.allSettled([first.close(), second.close()])
			scratch.destroy()
		}
	})

	it('owns its goal names and byte limits while borrowing only the budget', async () => {
		const scratch = createScratch()
		const file = await open(join(scratch.path, 'evidence.jsonl'), 'wx')
		try {
			const reservations = createRecorder<readonly [number]>()
			const goals = ['write', 'read']
			const options = {
				file,
				goals,
				goal: 100,
				trial: 140,
				budget: { reserve: reservations.handler },
			}
			const sink = new StudyEvidenceSink(options)
			goals.splice(0, goals.length, 'foreign')
			options.goal = 10000
			options.trial = 10000
			const write = '{"event":"saved","goal":"write","value":true}\n'
			const read = '{"event":"saved","goal":"read","value":true}\n'
			await expect(
				sink.append({ event: 'saved', goal: 'foreign', value: true }),
			).rejects.toMatchObject({ code: 'EVIDENCE' })
			await sink.append({ event: 'saved', goal: 'write', value: true })
			await sink.append({ event: 'saved', goal: 'write', value: true })
			await expect(
				sink.append({ event: 'saved', goal: 'write', value: true }),
			).rejects.toMatchObject({ code: 'CAPACITY' })
			await sink.append({ event: 'saved', goal: 'read', value: true })
			await expect(
				sink.append({ event: 'saved', goal: 'read', value: true }),
			).rejects.toMatchObject({ code: 'CAPACITY' })
			await sink.close()
			expect(reservations.calls).toEqual([
				[Buffer.byteLength(write)],
				[Buffer.byteLength(write)],
				[Buffer.byteLength(read)],
			])
			expect(await readFile(join(scratch.path, 'evidence.jsonl'), 'utf8')).toBe(
				write + write + read,
			)
		} finally {
			await file.close()
			scratch.destroy()
		}
	})

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

	it('writes concurrently admitted rows whole and in admission order', async () => {
		const scratch = createScratch()
		try {
			const file = await open(join(scratch.path, 'evidence.jsonl'), 'wx')
			const sink = new StudyEvidenceSink({
				file,
				goals: ['write'],
				goal: 8388608,
				trial: 8388608,
				budget: { reserve: createRecorder<readonly [number]>().handler },
			})
			const rows = Array.from({ length: 1024 }, (_, index) => ({
				event: 'saved',
				goal: 'write',
				value: `${String(index)}:${'x'.repeat(64)}`,
			}))
			await Promise.all(rows.map((row) => sink.append(row)))
			await sink.close()
			const lines = (await readFile(join(scratch.path, 'evidence.jsonl'), 'utf8')).split('\n')
			// Every row is whole when it parses back to the row admitted at its position.
			const stored = lines.slice(0, -1).map((line) => parseJSON(line))
			expect(stored.length).toBe(rows.length)
			expect(stored.every((row, index) => isDeepStrictEqual(row, rows[index]))).toBe(true)
		} finally {
			scratch.destroy()
		}
	}, 20000)

	it('retains the first failed write and refuses every later append and the close with that failure', async () => {
		const scratch = createScratch()
		try {
			scratch.write('evidence.jsonl', '')
			// A read-only descriptor stays open for the sync, so only the writes fail.
			const file = await open(join(scratch.path, 'evidence.jsonl'), 'r')
			const reservations = createRecorder<readonly [number]>()
			const sink = new StudyEvidenceSink({
				file,
				goals: ['write'],
				goal: 100,
				trial: 100,
				budget: { reserve: reservations.handler },
			})
			const row = { event: 'saved', goal: 'write', value: true }
			const first = await sink.append(row).then(
				() => undefined,
				(error: unknown) => error,
			)
			expect(first).toBeInstanceOf(Error)
			const second = await sink.append(row).then(
				() => undefined,
				(error: unknown) => error,
			)
			expect(second).toBe(first)
			await expect(sink.close()).rejects.toBe(first)
		} finally {
			scratch.destroy()
		}
	})
})
