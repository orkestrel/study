import { retainStudyFixture } from '../../../setupServer.js'
import { createScratch } from '@orkestrel/test/server'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudySeries } from '../../../../src/core/engines/index.js'
import type { StudyProduct } from '../../../../src/core/types.js'
import { StudyResults } from '../../../../src/server/stores/StudyResults.js'
import { encodeStudyJSON } from '../../../../src/server/helpers.js'
import { readStudyResult } from '../../../../src/server/stores/helpers.js'
import { StudyEvidenceSink } from '../../../../src/server/stores/StudyEvidenceSink.js'
import {
	buildCompactCustodyManifest,
	buildCustodyAttempt,
	buildCustodyManifest,
	createStudyDriverFixture,
	STUDY_CUSTODY_MUTATIONS,
} from '../../../setupStudy.js'

describe('StudyResults', () => {
	it('owns an exact scheduled trial by value across its filesystem awaits', async () => {
		const scratch = createScratch()
		const sinks: StudyEvidenceSink[] = []
		try {
			const manifest = buildCompactCustodyManifest()
			const original = manifest.schedule[0]
			if (original === undefined) throw new Error('Missing fixture trial')
			const directory = join(scratch.path, 'result')
			const results = new StudyResults({ directory, manifest })
			await results.create()
			const copy = { ...original }
			const starting = results.start(copy)
			copy.id = 'mutated'
			const first = await starting
			if (first instanceof StudyEvidenceSink) sinks.push(first)
			await results.finish(buildCustodyAttempt(manifest, original))
			for (const trial of manifest.schedule.slice(1)) {
				const sink = await results.start(trial)
				if (sink instanceof StudyEvidenceSink) sinks.push(sink)
				await results.finish(buildCustodyAttempt(manifest, trial))
			}
			await results.seal()
			const reading = await readStudyResult(directory)
			expect(reading.status).toBe('sealed')
			expect(reading.attempts.map((attempt) => attempt.trial.id)).toEqual(
				manifest.schedule.map((trial) => trial.id),
			)
			expect(scratch.has('result/execution/trials/mutated')).toBe(false)
		} finally {
			await Promise.allSettled(sinks.map((sink) => sink.close()))
			scratch.destroy()
		}
	})

	it('reserves seal artifact bytes before publishing a complete execution seal', async () => {
		const scratch = createScratch()
		try {
			const baseline = await retainStudyFixture(join(scratch.path, 'baseline'))
			const allowance = baseline.seal.files.reduce((total, file) => total + file.bytes, 32)
			const manifest = buildCustodyManifest({
				bounds: {
					...baseline.manifest.bounds,
					trial: { ...baseline.manifest.bounds.trial, bytes: 4096 },
					series: { ...baseline.manifest.bounds.series, bytes: allowance },
				},
			})
			const directory = join(scratch.path, 'result')
			const results = new StudyResults({ directory, manifest })
			await results.create()
			for (const trial of manifest.schedule) {
				const sink = await results.start(trial)
				await sink.append({ event: 'saved', goal: 'write', value: 'remember' })
				await results.finish(buildCustodyAttempt(manifest, trial))
			}
			await expect(results.seal()).rejects.toMatchObject({ code: 'CAPACITY' })
			expect(scratch.has('result/seal.json')).toBe(false)
			expect((await readStudyResult(directory)).status).toBe('interrupted')
			await appendFile(
				join(baseline.directory, 'seal.json'),
				' '.repeat(baseline.manifest.bounds.series.bytes),
			)
			await expect(readStudyResult(baseline.directory)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})
	it('keeps construction inert and refuses existing empty or occupied directories', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const directory = join(scratch.path, 'result')
			const results = new StudyResults({ directory, manifest })
			expect(scratch.has('result')).toBe(false)
			await mkdir(directory)
			await expect(results.create()).rejects.toMatchObject({ code: 'EEXIST' })
			expect(scratch.names('result')).toEqual([])
			scratch.write('occupied/original.txt', 'keep')
			await expect(
				new StudyResults({ directory: join(scratch.path, 'occupied'), manifest }).create(),
			).rejects.toMatchObject({ code: 'EEXIST' })
			expect(scratch.read('occupied/original.txt')).toBe('keep')
		} finally {
			scratch.destroy()
		}
	})

	it('drains concurrent appends in admission order and refuses repeated or late terminal work', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const trial = manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing fixture trial')
			const results = new StudyResults({ directory: join(scratch.path, 'result'), manifest })
			await results.create()
			const sink = await results.start(trial)
			const first = sink.append({ event: 'saved', goal: 'write', value: 1 })
			const second = sink.append({ event: 'saved', goal: 'write', value: 2 })
			const terminal = results.finish(buildCustodyAttempt(manifest, trial))
			await expect(sink.append({ event: 'saved', goal: 'write', value: 3 })).rejects.toMatchObject({
				code: 'CUSTODY',
			})
			await expect(results.finish(buildCustodyAttempt(manifest, trial))).rejects.toMatchObject({
				code: 'CUSTODY',
			})
			await Promise.all([first, second, terminal])
			const bytes = await readFile(
				join(scratch.path, 'result', 'execution', 'trials', trial.id, 'evidence.jsonl'),
				'utf8',
			)
			expect(bytes).toBe(
				'{"event":"saved","goal":"write","value":1}\n{"event":"saved","goal":"write","value":2}\n',
			)
			await expect(results.start(trial)).rejects.toMatchObject({ code: 'CUSTODY' })
			await expect(
				results.finish({ ...buildCustodyAttempt(manifest, trial), observations: [] }),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			await expect(
				results.finish({
					...buildCustodyAttempt(manifest, trial),
					trial: { ...trial, id: 'unknown' },
				}),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			await expect(results.seal()).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('accounts for explicit unexecuted attempts and seals only the complete horizon', async () => {
		const scratch = createScratch()
		try {
			const manifest = buildCustodyManifest()
			const results = new StudyResults({ directory: join(scratch.path, 'result'), manifest })
			await results.create()
			for (const trial of manifest.schedule) {
				await results.start(trial)
				const attempt = buildCustodyAttempt(manifest, trial)
				await results.finish({
					...attempt,
					failure: { cause: 'infrastructure', message: 'Unavailable', role: undefined },
					observations: attempt.observations.map((observation) => ({
						...observation,
						product: undefined,
						failure: { cause: 'interrupted', message: 'Never dispatched', role: undefined },
					})),
				})
			}
			const seal = await results.seal()
			const reading = await readStudyResult(join(scratch.path, 'result'))
			expect(reading.status).toBe('sealed')
			if (reading.status !== 'sealed') throw new Error('Missing seal')
			expect(reading.seal.id).toBe(seal.id)
			expect(
				reading.attempts.every((attempt) =>
					attempt.observations.every((observation) => observation.product === undefined),
				),
			).toBe(true)
			await expect(results.seal()).rejects.toMatchObject({ code: 'CUSTODY' })
			await expect(
				results.start(
					manifest.schedule[0] ?? { id: 'unknown', scenario: 'first', arm: 'small', repetition: 0 },
				),
			).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('reserves encoded series bytes before writes and preserves interrupted custody on terminal capacity failure', async () => {
		const scratch = createScratch()
		try {
			const baseline = buildCustodyManifest()
			const manifest = buildCustodyManifest({
				bounds: {
					...baseline.bounds,
					request: { ...baseline.bounds.request, bytes: 64 },
					goal: { ...baseline.bounds.goal, bytes: 64 },
					trial: { ...baseline.bounds.trial, bytes: 128 },
					series: { ...baseline.bounds.series, bytes: 2300 },
				},
			})
			const trial = manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			const directory = join(scratch.path, 'result')
			const results = new StudyResults({ directory, manifest })
			await results.create()
			const sink = await results.start(trial)
			await expect(
				sink.append({ event: 'saved', goal: 'write', value: 'x'.repeat(100) }),
			).rejects.toMatchObject({ code: 'CAPACITY' })
			expect(
				await readFile(join(directory, 'execution', 'trials', trial.id, 'evidence.jsonl'), 'utf8'),
			).toBe('')
			await sink.append({ event: 'saved', goal: 'write', value: true })
			await expect(
				results.finish({
					...buildCustodyAttempt(manifest, trial),
					observations: buildCustodyAttempt(manifest, trial).observations.map((observation) => ({
						...observation,
						product: { value: 'x'.repeat(1000), partial: false },
					})),
				}),
			).rejects.toMatchObject({ code: 'CAPACITY' })
			expect(scratch.has(`result/execution/trials/${trial.id}/attempt.json`)).toBe(false)
			expect((await readStudyResult(directory)).status).toBe('interrupted')
			await expect(
				sink.append({ event: 'saved', goal: 'write', value: false }),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			await expect(results.seal()).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('seals fulfilled capacity attempts when a driver product exceeds the series output limit', async () => {
		const scratch = createScratch()
		try {
			const manifest = {
				...buildCompactCustodyManifest(),
				bounds: {
					request: { duration: 1000, calls: 1, tokens: 1000, bytes: 1024 },
					goal: { duration: 2000, calls: 2, tokens: 2000, bytes: 4096 },
					trial: { duration: 4000, calls: 4, tokens: 4000, bytes: 8192 },
					series: { duration: 32000, calls: 32, tokens: 32000, bytes: 16384 },
				},
			}
			const directory = join(scratch.path, 'result')
			const results = new StudyResults({ directory, manifest })
			await results.create()
			const oversized = 'x'.repeat(manifest.bounds.series.bytes + 1)
			const driver = createStudyDriverFixture({
				execute: async (): Promise<StudyProduct> => ({ value: oversized, partial: false }),
			})
			const attempts = await new StudySeries({
				manifest,
				driver: driver.driver,
				store: results,
				signal: new AbortController().signal,
			}).execute()
			expect(attempts).toHaveLength(manifest.schedule.length)
			const first = attempts[0]
			expect(first?.failure?.cause).toBe('capacity')
			expect(first?.observations[0]?.product).toBeUndefined()
			expect(first?.observations[0]?.failure?.cause).toBe('capacity')
			expect(first?.observations[1]?.product).toBeUndefined()
			expect(first?.observations[1]?.failure?.message).toMatch(/^Goal unexecuted/)
			for (const attempt of attempts.slice(1))
				expect(
					attempt.observations.every(
						(observation) =>
							observation.product === undefined &&
							observation.failure?.message.startsWith('Goal unexecuted') === true,
					),
				).toBe(true)
			const seal = await results.seal()
			const reading = await readStudyResult(directory)
			expect(reading.status).toBe('sealed')
			if (reading.status !== 'sealed') throw new Error('Missing seal')
			expect(reading.seal.id).toBe(seal.id)
			expect(reading.attempts.map((attempt) => attempt.trial.id)).toEqual(
				manifest.schedule.map((trial) => trial.id),
			)
			expect(reading.attempts[0]?.observations[0]?.product).toBeUndefined()
		} finally {
			scratch.destroy()
		}
	})

	it('forwards a genuine terminal custody capacity rejection through the series and stays unsealed', async () => {
		const scratch = createScratch()
		try {
			const manifest = {
				...buildCompactCustodyManifest(),
				bounds: {
					request: { duration: 1000, calls: 1, tokens: 1000, bytes: 64 },
					goal: { duration: 2000, calls: 2, tokens: 2000, bytes: 1200 },
					trial: { duration: 4000, calls: 4, tokens: 4000, bytes: 2300 },
					series: { duration: 32000, calls: 32, tokens: 32000, bytes: 2300 },
				},
			}
			const directory = join(scratch.path, 'result')
			const results = new StudyResults({ directory, manifest })
			await results.create()
			const driver = createStudyDriverFixture({
				execute: async (): Promise<StudyProduct> => ({ value: 'x'.repeat(1100), partial: false }),
			})
			await expect(
				new StudySeries({
					manifest,
					driver: driver.driver,
					store: results,
					signal: new AbortController().signal,
				}).execute(),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			const trial = manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			expect(scratch.has(`result/execution/trials/${trial.id}/attempt.json`)).toBe(false)
			expect(scratch.has('result/seal.json')).toBe(false)
			expect((await readStudyResult(directory)).status).toBe('interrupted')
			await expect(results.seal()).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('reads a crash before seal as interrupted even when every attempt is present', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			await rm(join(result.directory, 'seal.json'))
			const reading = await readStudyResult(result.directory)
			expect(reading.status).toBe('interrupted')
			expect(reading.attempts.map((attempt) => attempt.trial.id)).toEqual(
				result.manifest.schedule.map((trial) => trial.id),
			)
		} finally {
			scratch.destroy()
		}
	})

	it.each(STUDY_CUSTODY_MUTATIONS)('rejects %s execution inventory', async (mutation) => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			const trial = result.manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			const attempt = join(result.directory, 'execution', 'trials', trial.id, 'attempt.json')
			if (mutation === 'tampered') await appendFile(attempt, ' ')
			if (mutation === 'missing') await rm(attempt)
			if (mutation === 'extra')
				await writeFile(join(result.directory, 'execution', 'foreign.json'), '{}')
			if (mutation === 'extra-directory')
				await mkdir(join(result.directory, 'execution', 'foreign'))
			if (mutation === 'wrong-horizon')
				await writeFile(
					attempt,
					encodeStudyJSON({ ...buildCustodyAttempt(result.manifest, trial), observations: [] }),
				)
			if (mutation === 'partial-evidence')
				await appendFile(
					join(result.directory, 'execution', 'trials', trial.id, 'evidence.jsonl'),
					'{',
				)
			await expect(readStudyResult(result.directory)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('rejects real directory links in custody without following their target', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			scratch.write('outside/secret.txt', 'outside')
			scratch.link('result/execution/linked', join(scratch.path, 'outside'))
			await expect(readStudyResult(result.directory)).rejects.toMatchObject({ code: 'CUSTODY' })
			await expect(
				readStudyResult(join(result.directory, 'execution', 'linked')),
			).rejects.toMatchObject({ code: 'CUSTODY' })
			expect(scratch.read('outside/secret.txt')).toBe('outside')
		} finally {
			scratch.destroy()
		}
	})
})
