import { createScratch } from '@orkestrel/test/server'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildStudyRubric } from './setupStudy.js'
import {
	buildCustodyGrading,
	buildCustodyLabels,
	buildCustodyPacketLabels,
	buildStudyCLI,
	buildStudyLibrary,
	createArtifactWorker,
	executeStudyCLI,
	retainStudyFixture,
	writeStudyConsumer,
} from './setupServer.js'

describe('study server fixtures', () => {
	it('builds the native CLI and supplies a checkable consumer without importing its subject', async () => {
		const scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'setup-cli-' })
		try {
			writeStudyConsumer(scratch)
			const entry = await buildStudyCLI(scratch)
			const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect(checked.code).toBe(0)
			expect(() => JSON.parse(checked.output)).not.toThrow()
			const refused = await executeStudyCLI(entry, scratch.path, ['check', 'missing'])
			expect(refused.code).not.toBe(0)
		} finally {
			scratch.destroy()
		}
	})
	it('builds the core library as a separate importable package with its own error class', async () => {
		const scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'setup-library-' })
		try {
			const entry = await buildStudyLibrary(scratch)
			expect(entry).toBe(join(scratch.path, 'library', 'dist', 'index.js'))
			expect(scratch.read('library/package.json')).toContain('"type":"module"')
			const constructed = execFileSync(
				process.execPath,
				[
					'--input-type=module',
					'--eval',
					`import { StudyError } from ${JSON.stringify(pathToFileURL(entry).href)}; const error = new StudyError('CONFIG', 'Built refusal'); console.log(error.name + ':' + error.code + ':' + error.message)`,
				],
				{ encoding: 'utf8', timeout: 10000, windowsHide: true },
			)
			expect(constructed).toBe('StudyError:CONFIG:Built refusal\n')
		} finally {
			scratch.destroy()
		}
	})
	it('creates an executable native artifact worker in its owned scratch directory', () => {
		const scratch = createScratch()
		try {
			const worker = createArtifactWorker(
				scratch,
				"assert.equal(typeof Artifacts, 'function'); console.log('artifact-ready')",
			)
			expect(
				execFileSync(process.execPath, [worker], {
					encoding: 'utf8',
					timeout: 10000,
					windowsHide: true,
				}),
			).toBe('artifact-ready\n')
		} finally {
			scratch.destroy()
		}
	})
	it('returns a sealed real-files fixture with complete grades and explicit supplied label provenance', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			const rubric = buildStudyRubric()
			const grading = buildCustodyGrading(result, rubric)
			const neutral = buildCustodyPacketLabels(result, rubric)
			expect(neutral.packet).not.toBe(result.seal.id)
			expect(neutral.judgments[0]?.trial).not.toBe(result.manifest.schedule[0]?.id)
			expect(neutral.judgments[0]?.criterion).not.toBe('first-read')
			expect(grading.attempts).toEqual(result.manifest.schedule.map((trial) => trial.id))
			expect(
				grading.judgments
					.filter((judgment) => judgment.method === 'human')
					.every((judgment) => judgment.verdict === 'unknown'),
			).toBe(true)
			const labels = buildCustodyLabels(result, 'supplied-human')
			expect(labels.labeler).toBe('supplied-human')
			expect(labels.created).toBe('2026-10-14T12:00:00.000Z')
			expect(buildCustodyGrading(result, rubric, labels).judgments).toEqual(
				expect.arrayContaining([...labels.judgments]),
			)
		} finally {
			scratch.destroy()
		}
	})
})
