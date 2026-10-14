import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

const MODULES = Object.freeze({
	'@orkestrel/study': 'src/core',
	'@orkestrel/study/server': 'src/server',
})

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md', 'package.json'],
	modules: MODULES,
	languages: ['ts'],
	language: 'ts',
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, rows }) => {
	const { createGuide, findDrift, findMissingSymbols } = await import('@orkestrel/guide')
	const { requireValue } = await import('@orkestrel/test')
	const { describe, expect, it } = await import('vitest')
	const core = await import('@orkestrel/study')
	const server = await import('@orkestrel/study/server')
	const { createScratch } = await import('@orkestrel/test/server')
	const { join } = await import('node:path')
	const { writeFile } = await import('node:fs/promises')
	const { buildCustodyManifest, buildCustodyAttempt } = await import('./setupStudy.js')

	it('indexes every public concept and keeps the README pitch equal to the Study tagline', () => {
		expect(report.input).toEqual([])
		expect(rows.map(({ entry }) => entry.spec)).toEqual([
			'guides/study.md',
			'guides/artifacts.md',
			'guides/adapters.md',
			'guides/commands.md',
		])
		expect(report.pitch).toEqual([])
		expect(createGuide(requireValue(files['README.md'])).tagline()).toBe(
			createGuide(requireValue(files['guides/study.md'])).tagline(),
		)
	})

	for (const { entry, guide, source } of rows) {
		describe(entry.concept, () => {
			it('documents every public export with the source description and no hidden declaration', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
				expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
				expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
				expect(findMissingSymbols(source.exports(), source.surface())).toEqual([])
				expect(source.hidden()).toEqual([])
				expect(guide.surface().filter(({ summary }) => summary === undefined)).toEqual([])
				expect(source.surface().filter(({ summary }) => summary === undefined)).toEqual([])
				expect(findDrift(guide, source)).toEqual([])
			})
			it('keeps methods, examples, self imports, and test links in parity', () => {
				for (const findings of [
					report.sections,
					report.methods,
					report.declarations,
					report.links,
					report.tests,
					report.fences,
					report.examples.fences,
					report.examples.functions,
					report.examples.methods,
					report.examples.titles,
					report.imports,
					report.drift,
				]) expect(findings.filter(({ spec }) => spec === entry.spec)).toEqual([])
			})
		})
	}

	it('admits a ceiling before work, settles known charges, and retains a refused boundary', () => {
		const { StudyControl, StudyScope, StudyMeter } = core
		const control = new StudyControl()
		const limit = { duration: 1000, calls: 1, tokens: 8, bytes: 64 }
		const scope = new StudyScope({ limit, control, label: 'Goal' })
		const meter = new StudyMeter({ request: limit, scopes: [scope], control })
		try {
			const ticket = meter.admit({ role: 'tool', tokens: 8, bytes: 64 })
			ticket.finish({ role: 'tool', calls: 1, tokens: 3, bytes: 12, duration: 1 })
			expect(meter.usage).toEqual([{ role: 'tool', calls: 1, tokens: 3, bytes: 12, duration: 1 }])
			expect(() => meter.admit({ role: 'tool', tokens: 1, bytes: 1 })).toThrow(core.StudyError)
			expect(control.failure?.cause).toBe('capacity')
			expect(control.signal.aborted).toBe(true)
		} finally {
			meter.close()
			scope.close()
			control.close()
		}
	})

	it('seals complete custody, reads the same identity, and detects changed execution bytes', async () => {
		const { StudyResults, readStudyResult } = server
		const scratch = createScratch()
		const manifest = buildCustodyManifest()
		const directory = join(scratch.path, 'result')
		const results = new StudyResults({ directory, manifest })
		try {
			await results.create()
			for (const trial of manifest.schedule) {
				const sink = await results.start(trial)
				await sink.append({ event: 'saved', goal: 'write', value: 'remember' })
				await results.finish(buildCustodyAttempt(manifest, trial))
			}
			const seal = await results.seal()
			const reading = await readStudyResult(directory)
			expect(reading.status).toBe('sealed')
			if (reading.status !== 'sealed') throw new Error('Expected sealed custody')
			expect(reading.seal.id).toBe(seal.id)
			const trial = requireValue(manifest.schedule[0])
			await writeFile(join(directory, 'execution', 'trials', trial.id, 'evidence.jsonl'), '')
			await expect(readStudyResult(directory)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})
})
