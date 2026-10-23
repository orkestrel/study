import * as stores from '../../../../src/server/stores/index.js'
import { buildStudyExchangeRows, mutateStudyExchangeRows } from '../../../setupServer.js'
import { createScratch } from '@orkestrel/test/server'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('StudyExchangeSink', () => {
	it('serializes bounded complete rows, derives ordinals and drains its descriptor', async () => {
		const scratch = createScratch()
		const rows = buildStudyExchangeRows()
		const sink = new stores.StudyExchangeSink({
			file: await open(join(scratch.path, 'exchanges.jsonl'), 'wx'),
			record: { bytes: 32768 },
		})
		try {
			expect(sink.next).toBe(1)
			for (const row of rows) await sink.append(row)
			expect(sink.next).toBe(8)
			await sink.close()
			expect(await readFile(join(scratch.path, 'exchanges.jsonl'))).toEqual(
				mutateStudyExchangeRows(rows, 'complete'),
			)
			await expect(sink.append({ phase: 'complete', count: 7 })).rejects.toMatchObject({
				code: 'CUSTODY',
			})
		} finally {
			await sink.close().catch(() => undefined)
			scratch.destroy()
		}
	})

	it('latches a second in-flight attempt so even a caught refusal cannot complete', async () => {
		const scratch = createScratch()
		const rows = buildStudyExchangeRows()
		const declaration = rows[0]
		const attempt = rows[1]
		if (declaration === undefined || attempt?.phase !== 'attempt')
			throw new Error('Missing fixture row')
		const sink = new stores.StudyExchangeSink({
			file: await open(join(scratch.path, 'exchanges.jsonl'), 'wx'),
			record: { bytes: 32768 },
		})
		try {
			await sink.append(declaration)
			await sink.append(attempt)
			await expect(sink.append({ ...attempt, ordinal: 2 })).rejects.toMatchObject({
				code: 'CUSTODY',
			})
			await expect(sink.append({ phase: 'complete', count: 1 })).rejects.toMatchObject({
				code: 'CUSTODY',
			})
		} finally {
			await sink.close().catch(() => undefined)
			scratch.destroy()
		}
	})

	it('reserves terminal failure capacity before admitting an attempt', async () => {
		const scratch = createScratch()
		const rows = buildStudyExchangeRows()
		const declaration = rows[0]
		const attempt = rows[1]
		if (declaration === undefined || attempt?.phase !== 'attempt')
			throw new Error('Missing fixture row')
		const allowance = Buffer.byteLength(
			JSON.stringify(declaration) + '\n' + JSON.stringify(attempt) + '\n',
		)
		const sink = new stores.StudyExchangeSink({
			file: await open(join(scratch.path, 'exchanges.jsonl'), 'wx'),
			record: { bytes: allowance },
		})
		try {
			await sink.append(declaration)
			await expect(sink.append(attempt)).rejects.toMatchObject({ code: 'CAPACITY' })
			expect(sink.next).toBe(1)
		} finally {
			await sink.close().catch(() => undefined)
			scratch.destroy()
		}
	})
})
