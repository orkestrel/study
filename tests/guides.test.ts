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
	const { buildCustodyManifest, buildCustodyAttempt, buildStudyRubric } =
		await import('./setupStudy.js')
	const { retainStudyFixture, buildCustodyGrading } = await import('./setupServer.js')
	const { realpathSync } = await import('node:fs')

	it('indexes the package guide and keeps the README pitch equal to the Study tagline', () => {
		expect(report.input).toEqual([])
		expect(rows.map(({ entry }) => entry.spec)).toEqual(['guides/study.md'])
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
				])
					expect(findings.filter(({ spec }) => spec === entry.spec)).toEqual([])
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
			const usage = meter.usage // [{ role: 'tool', calls: 1, tokens: 3, bytes: 12, duration: 1 }]
			expect(usage).toEqual([{ role: 'tool', calls: 1, tokens: 3, bytes: 12, duration: 1 }])
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
			const attempts = manifest.schedule.map((trial) => buildCustodyAttempt(manifest, trial))
			await results.create()
			for (const attempt of attempts) {
				const sink = await results.start(attempt.trial)
				await sink.append({ event: 'saved', goal: 'write', value: 'remember' })
				await results.finish(attempt)
			}
			const seal = await results.seal()
			const reading = await readStudyResult(directory)
			const status = reading.status // 'sealed'
			const sealed = reading.status === 'sealed' && reading.seal.id === seal.id // true
			expect(status).toBe('sealed')
			expect(sealed).toBe(true)
			if (reading.status !== 'sealed') throw new Error('Expected sealed custody')
			expect(reading.seal.id).toBe(seal.id)
			const trial = requireValue(manifest.schedule[0])
			await writeFile(join(directory, 'execution', 'trials', trial.id, 'evidence.jsonl'), '')
			await expect(readStudyResult(directory)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it('executes the titled helper examples against their claimed values', () => {
		const { matchesStudyKeys } = core
		const { decodeStudyJSON, encodeStudyJSON, hashStudyBytes, isStudyAdapter, toStudyWire } = server
		const { parseStudyArguments } = server
		expect(matchesStudyKeys({ id: 'one' }, ['id'])).toBe(true)
		expect(matchesStudyKeys({ id: 'one', extra: true }, ['id'])).toBe(false)
		expect(new TextDecoder().decode(encodeStudyJSON({ id: 1 }))).toBe('{"id":1}\n')
		expect(decodeStudyJSON(new TextEncoder().encode('{"id":1}'))).toEqual({ id: 1 })
		expect(hashStudyBytes('retained evidence')).toMatch(/^[a-f0-9]{64}$/)
		expect(hashStudyBytes('changed evidence')).not.toBe(hashStudyBytes('retained evidence'))
		expect(isStudyAdapter({})).toBe(false)
		expect(toStudyWire({ state: 'ready', failure: undefined })).toEqual({ state: 'ready' })
		expect(parseStudyArguments(['check', 'files', '--profile', 'local'])).toEqual({
			command: 'check',
			target: 'files',
			profile: 'local',
			out: undefined,
			expected: undefined,
		})
	})

	it('inspects captured package bytes without executing them and refuses drift', async () => {
		const { Artifacts } = server
		const scratch = createScratch()
		try {
			scratch.write(
				'package.json',
				'{"name":"study-inspection-fixture","version":"1","type":"module"}',
			)
			scratch.write('dist/index.js', 'throw new Error("Inspection must not evaluate this entry")')
			const root = realpathSync(scratch.path)
			const entry = realpathSync(join(root, 'dist', 'index.js'))
			const artifacts = new Artifacts({ roots: [root], entries: [entry] })
			const inventory = artifacts.inspect()
			const selected = inventory.entries.includes(entry) // true
			artifacts.verify()
			expect(selected).toBe(true)
			expect(inventory.node).toBe(process.version)
			expect(inventory.files.map(({ path }) => path)).toEqual([
				join(root, 'dist', 'index.js'),
				join(root, 'package.json'),
			])
			await writeFile(entry, 'export const changed = true')
			expect(() => artifacts.verify()).toThrow(server.ArtifactError)
		} finally {
			scratch.destroy()
		}
	})

	it('retains unknown semantic criteria in immutable grading without changing execution', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			const rubric = buildStudyRubric()
			const grading = buildCustodyGrading(result, rubric)
			const versions = new server.StudyGradings({ result, rubric: server.encodeStudyJSON(rubric) })
			const id = await versions.write(grading)
			expect(await versions.read(id)).toEqual(grading)
			expect(await versions.write(grading)).toBe(id)
			const scores = core.computeStudyScores(result.manifest, rubric, grading)
			expect(scores.length).toBeGreaterThan(0)
			for (const score of scores) {
				expect(score.unknown).toBeGreaterThan(0)
				expect(score.lower).toBeLessThan(score.upper)
				expect(score.coverage).toBeLessThan(1)
			}
			const retained = await server.readStudyResult(result.directory)
			if (retained.status !== 'sealed') throw new Error('Grading changed execution completeness')
			expect(retained.seal).toEqual(result.seal)
		} finally {
			scratch.destroy()
		}
	})
})
