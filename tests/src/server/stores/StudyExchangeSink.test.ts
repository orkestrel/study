import * as stores from '../../../../src/server/stores/index.js'
import {
	buildStudyExchangeRows,
	buildOpenStudyExchangeRows,
	mutateStudyExchangeRows,
} from '../../../setupServer.js'
import { createScratch } from '@orkestrel/test/server'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('StudyExchangeSink', () => {
	it('restores the same declaration and refuses retained bounds that differ from the reservation', async () => {
		const scratch = createScratch()
		const rows = buildStudyExchangeRows().slice(0, 3)
		const declaration = rows[0]
		if (declaration?.phase !== 'declaration') throw new Error('Missing retained declaration')
		const file = await open(join(scratch.path, 'retained.jsonl'), 'wx')
		try {
			await file.writeFile(rows.map((row) => JSON.stringify(row) + '\n').join(''))
			expect(
				() =>
					new stores.StudyExchangeSink({
						file,
						record: { ...declaration.record, calls: 1 },
						retained: rows,
					}),
			).toThrow(/bounds differ/)
			const sink = new stores.StudyExchangeSink({
				file,
				record: declaration.record,
				retained: rows,
			})
			expect(sink.declaration).toEqual(declaration)
			expect(sink.next).toBe(2)
			await sink.close()
		} finally {
			await file.close()
			scratch.destroy()
		}
	})

	it('measures full append-time revalidation at the Records segment load', () => {
		const rows = buildOpenStudyExchangeRows(
			'measured-trial',
			{ bytes: 8388608, calls: 256, duration: 1800000 },
			182,
			3000,
		)
		const bytes = Buffer.byteLength(rows.map((row) => JSON.stringify(row) + '\n').join(''))
		const durations = rows.map((_row, index) => {
			const started = performance.now()
			stores.validateStudyExchangeRows(rows.slice(0, index + 1), false)
			return performance.now() - started
		})
		const total = durations.reduce((sum, duration) => sum + duration, 0)
		expect(rows.length).toBe(378)
		expect(bytes).toBeGreaterThan(2800000)
		expect(bytes).toBeLessThan(3500000)
		expect(() => stores.readStudyExchangeRows(mutateStudyExchangeRows(rows, 'altered'))).toThrow(
			/\S/,
		)
		process.stdout.write(
			`Append validation measurement: rows=${rows.length} bytes=${bytes} summedMs=${total.toFixed(3)} thresholdMs=30000 node=${process.version} platform=${process.platform} arch=${process.arch}\n`,
		)
	})

	it('serializes bounded complete rows, derives ordinals and drains its descriptor', async () => {
		const scratch = createScratch()
		const rows = buildStudyExchangeRows()
		const sink = new stores.StudyExchangeSink({
			file: await open(join(scratch.path, 'exchanges.jsonl'), 'wx'),
			record: { bytes: 32768, calls: 256, duration: 15000 },
		})
		try {
			expect(sink.next).toBe(1)
			expect(sink.declaration).toBeUndefined()
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
		if (declaration?.phase !== 'declaration' || attempt?.phase !== 'attempt')
			throw new Error('Missing fixture row')
		const sink = new stores.StudyExchangeSink({
			file: await open(join(scratch.path, 'exchanges.jsonl'), 'wx'),
			record: { bytes: 32768, calls: 256, duration: 15000 },
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
		if (declaration?.phase !== 'declaration' || attempt?.phase !== 'attempt')
			throw new Error('Missing fixture row')
		const allowance = Buffer.byteLength(
			JSON.stringify(declaration) + '\n' + JSON.stringify(attempt) + '\n',
		)
		const sink = new stores.StudyExchangeSink({
			file: await open(join(scratch.path, 'exchanges.jsonl'), 'wx'),
			record: { bytes: allowance, calls: 256, duration: 15000 },
		})
		try {
			await sink.append({
				...declaration,
				record: { bytes: allowance, calls: 256, duration: 15000 },
			})
			await expect(sink.append(attempt)).rejects.toMatchObject({ code: 'CAPACITY' })
			expect(sink.next).toBe(1)
		} finally {
			await sink.close().catch(() => undefined)
			scratch.destroy()
		}
	})
})
