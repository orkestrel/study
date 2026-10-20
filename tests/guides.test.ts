import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

const MODULES = Object.freeze({
	'@orkestrel/study': 'src/core',
	'@orkestrel/study/server': 'src/server',
})

/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its only owner stays exported from its file and
 * out of the barrel when its constructor takes a value only that owner produces, or when the
 * owner's public value is a projection of the instance rather than the instance. Naming it here
 * makes that intentional, and the second assertion on it fails when a name here stops being
 * stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([
	'class StudyAgentScriptGoal',
	'class StudyAgentTraceGoal',
	'class StudyLaunchChild',
	'class StudyOllamaExchange',
	'class StudyOllamaGoal',
	'class StudyTaskChild',
	'class StudyTrialLease',
])

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
	const {
		STUDY_AGENT_MESSAGES,
		STUDY_AGENT_PROJECTION,
		STUDY_OLLAMA_OPTIONS,
		STUDY_OLLAMA_PROVIDER,
		STUDY_SCRIPT_MANY_CALLS,
		STUDY_SCRIPT_MESSAGES,
		STUDY_SUMMARY_MESSAGES,
		buildCustodyManifest,
		buildCustodyAttempt,
		buildOllamaReplies,
		buildStudyRubric,
		buildStudyScriptResponse,
		createStudyAgentSummary,
		createStudyAgentTrace,
		createStudyScriptFixture,
		createStudyScriptMeter,
		createStudySinkFixture,
		readOllamaMessages,
	} = await import('./setupStudy.js')
	const {
		retainStudyFixture,
		buildCustodyGrading,
		createOllamaContext,
		createForeignBudgetError,
		createBudgetLookalike,
	} = await import('./setupServer.js')
	const { realpathSync } = await import('node:fs')

	it('reads the Agent tool call example into the documented envelope', () => {
		const { readStudyAgentToolCall } = server
		const call = readStudyAgentToolCall({
			id: 'c1',
			name: 'write',
			arguments: { path: 'note.txt' },
		})
		expect(call).toEqual({ id: 'c1', name: 'write', arguments: { path: 'note.txt' } })
	})

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
				expect(
					findMissingSymbols(source.exports(), source.surface()).filter(
						(key) => !INTERNAL.includes(key),
					),
				).toEqual([])
				expect(source.hidden()).toEqual([])
				expect(guide.surface().filter(({ summary }) => summary === undefined)).toEqual([])
				expect(source.surface().filter(({ summary }) => summary === undefined)).toEqual([])
				expect(findDrift(guide, source)).toEqual([])
			})
			it('names no symbol internal that the barrel already exports', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
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

	it('matches a caught system Error without accepting a plain code record', () => {
		const { matchesSystemError } = server
		const error = Object.assign(new Error('Missing declaration'), { code: 'ENOENT' })
		expect(matchesSystemError(error, 'ENOENT')).toBe(true)
		expect(matchesSystemError({ code: 'ENOENT' }, 'ENOENT')).toBe(false)
	})

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
		const { StudyResultStore, readStudyResult } = server
		const scratch = createScratch()
		const manifest = buildCustodyManifest()
		const directory = join(scratch.path, 'result')
		const results = new StudyResultStore({ directory, manifest })
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
		const { decodeStudyJSON, encodeStudyJSON, hashStudyBytes, isStudyAdapter, valueToWire } = server
		const { parseStudyArguments } = server
		expect(matchesStudyKeys({ id: 'one' }, ['id'])).toBe(true)
		expect(matchesStudyKeys({ id: 'one', extra: true }, ['id'])).toBe(false)
		expect(new TextDecoder().decode(encodeStudyJSON({ id: 1 }))).toBe('{"id":1}\n')
		expect(decodeStudyJSON(new TextEncoder().encode('{"id":1}'))).toEqual({ id: 1 })
		expect(hashStudyBytes('retained evidence')).toMatch(/^[a-f0-9]{64}$/)
		expect(hashStudyBytes('changed evidence')).not.toBe(hashStudyBytes('retained evidence'))
		expect(isStudyAdapter({})).toBe(false)
		expect(valueToWire({ state: 'ready', failure: undefined })).toEqual({ state: 'ready' })
		expect(parseStudyArguments(['check', 'files', '--profile', 'local'])).toEqual({
			command: 'check',
			target: 'files',
			profile: 'local',
			out: undefined,
			expected: undefined,
		})
	})

	it('executes the stop attribution examples without inventing missing readings', () => {
		expect(core.isStudyStop({ layer: 'scope', id: 'Goal tokens', max: 100, consumed: 120 })).toBe(
			true,
		)
		expect(
			core.studyStopToJSON({ layer: 'model', id: 'num_predict', max: 2048, consumed: undefined }),
		).toEqual({ layer: 'model', id: 'num_predict', max: 2048, consumed: null })
		expect(
			core.translateStudyAgentStop({ layer: 'meter', id: 'meter', max: 2000, consumed: 2001 }),
		).toMatchObject({
			code: 'CAPACITY',
			failure: { stop: { layer: 'meter', id: 'meter', max: 2000, consumed: 2001 } },
		})
		expect(core.parseStudyReading(2048)).toBe(2048)
		expect(core.parseStudyReading(NaN)).toBeUndefined()
		expect(
			core.computeStudyAdmittedStop(
				{ role: 'agent', tokens: 10, bytes: 100 },
				{ role: 'agent', calls: 1, tokens: 12, bytes: undefined, duration: 0 },
			),
		).toEqual({ layer: 'scope', id: 'Admitted tokens', max: 10, consumed: 12 })
		expect(core.computeStudyOutputStop(2048, 1024, [])).toEqual({
			layer: 'scope',
			id: 'Goal bytes',
			max: 1024,
			consumed: 2048,
		})
		expect(
			server.computeStudyAttributions([
				{
					trial: 'r1-s1-a1',
					goal: undefined,
					failure: { cause: 'capacity', role: undefined, message: 'Capped', stop: undefined },
					executed: true,
				},
			]),
		).toEqual([
			{ cause: 'capacity', role: null, layer: null, executed: 1, unexecuted: 0, readings: [] },
		])
		expect(server.isStudyAgentResponse({ content: 'done', calls: [], truncated: true })).toBe(true)
	})

	it('classifies branded budget errors before the infrastructure fallback', () => {
		const error = createForeignBudgetError({ id: 'foreign', max: -1, consumed: 0 })
		expect(core.readStudyFailure(error)).toEqual({
			cause: 'capacity',
			message: error.message,
			role: undefined,
			stop: { layer: 'budget', id: 'foreign', max: -1, consumed: 0 },
		})
		expect(core.readStudyFailure(createBudgetLookalike())).toEqual({
			cause: 'infrastructure',
			message: 'budget reached its ceiling',
			role: undefined,
			stop: undefined,
		})
	})

	it('issues worker admissions in the sequence the titled example claims', () => {
		const { StudyProcessGoal } = server
		const fixture = createOllamaContext()
		try {
			const goal = new StudyProcessGoal(fixture.context)
			expect(goal.issue(2)).toBeUndefined()
			expect(goal.issue(1)).toBe(1)
			expect(goal.issue(1)).toBeUndefined()
			expect(goal.issue(2)).toBe(2)
		} finally {
			fixture.close()
		}
	})

	it('executes the Agent helper examples against their claimed values', () => {
		const { buildStudyAgentReadings, isStudyAgentResponse, readStudyAgentMessages } = server
		expect(readStudyAgentMessages([{ id: 'm1', role: 'user', content: 'Hi' }])).toEqual([
			{ role: 'user', content: 'Hi' },
		])
		expect(readStudyAgentMessages(STUDY_SCRIPT_MESSAGES)).toEqual([
			{ role: 'user', content: 'Count the orders' },
			{ role: 'tool', content: 'actual-result', call: 'actual-call' },
		])
		expect(() => readStudyAgentMessages('none')).toThrow(core.StudyError)
		expect(isStudyAgentResponse({ content: 'done', calls: [] })).toBe(true)
		expect(isStudyAgentResponse({ content: '', calls: STUDY_SCRIPT_MANY_CALLS })).toBe(true)
		expect(isStudyAgentResponse({ content: 'done', calls: [], extra: true })).toBe(false)
		expect(buildStudyAgentReadings({})).toBeNull()
		expect(
			buildStudyAgentReadings({
				readings: [
					{ key: 'a', phase: 'ask', outcome: 'ok', duration: 3 },
					{ key: 'b', phase: 'ask', outcome: 'ok' },
					{ key: 'c' },
				],
			}),
		).toEqual([
			{ key: 'a', phase: 'ask', outcome: 'ok', duration: 3 },
			{ key: 'b', phase: 'ask', outcome: 'ok', duration: null },
		])
	})

	it('executes the gauge and Agent tool evidence example', () => {
		const { isStudyAgentGauge } = core
		const { buildStudyAgentToolResult, buildStudyAgentToolDenial } = server
		const gauge = isStudyAgentGauge({ scale: 1, overhead: -0, label: 'summary' }) // true
		const call = { id: 'c1', name: 'write', arguments: { path: 'note.txt' } }
		const result = buildStudyAgentToolResult(call, { success: true, value: 'stored' })
		const denial = buildStudyAgentToolDenial(call, 'refused')
		expect(gauge).toBe(true)
		expect(result).toEqual({
			id: 'c1',
			name: 'write',
			arguments: { path: 'note.txt' },
			success: true,
			value: 'stored',
		})
		expect(denial).toEqual({ id: 'c1', name: 'write', reason: 'refused' })
	})

	it('pins Ollama models and projects a role policy onto provider options', () => {
		const { buildStudyOllamaModels, buildStudyOllamaOptions } = server
		const policy = {
			model: 'model',
			options: STUDY_OLLAMA_OPTIONS,
			think: false,
			strict: true,
			length: false,
		}
		expect(buildStudyOllamaModels(STUDY_OLLAMA_PROVIDER)).toEqual({
			model: { name: 'model', digest: 'a'.repeat(64) },
			judge: { name: 'judge', digest: 'b'.repeat(64) },
		})
		const unjudged = {
			...STUDY_OLLAMA_PROVIDER,
			digest: { model: 'a'.repeat(64), judge: undefined },
		}
		expect(Object.keys(buildStudyOllamaModels(unjudged))).toEqual(['model'])
		expect(buildStudyOllamaOptions(policy)).toEqual({
			model: 'model',
			options: STUDY_OLLAMA_OPTIONS,
			think: false,
			truncate: false,
			shift: false,
		})
		expect(buildStudyOllamaOptions(policy).options).toBe(STUDY_OLLAMA_OPTIONS)
		expect(Object.keys(buildStudyOllamaOptions({ ...policy, strict: false }))).toEqual([
			'model',
			'options',
			'think',
		])
	})

	it('retains a trace goal rows without observation and ends the goal on flush', async () => {
		const { trace } = createStudyAgentTrace(false)
		const sink = createStudySinkFixture()
		trace.append('note', 'dropped')
		trace.start('count')
		trace.record({ estimate: 1, projected: undefined }, { messages: STUDY_AGENT_MESSAGES })
		trace.append('note', 'kept')
		const active = trace.goal // 'count'
		await trace.flush(sink.sink)
		expect(active).toBe('count')
		expect(trace.goal).toBeUndefined()
		expect(sink.rows).toEqual([{ event: 'note', goal: 'count', value: 'kept' }])
		const refusing = createStudySinkFixture({ refuse: { error: new Error('Full'), row: 0 } })
		trace.start('again')
		trace.append('note', 'lost')
		await expect(trace.flush(refusing.sink)).rejects.toThrow('Full')
		expect(trace.goal).toBeUndefined()
	})

	it('refuses a summary projection that reaches the limit before any request and sends the canonical array below it', async () => {
		const options = { replies: buildOllamaReplies('Recap'), observe: false }
		const refused = createStudyAgentSummary({ ...options, limit: STUDY_AGENT_PROJECTION })
		refused.trace.start('write')
		await expect(
			refused.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined),
		).rejects.toMatchObject({ code: 'CAPACITY' })
		expect(refused.wire.requests).toEqual([])
		const admitted = createStudyAgentSummary({ ...options, limit: STUDY_AGENT_PROJECTION + 1 })
		admitted.trace.start('write')
		await expect(admitted.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).resolves.toBe(
			'Recap',
		)
		expect(readOllamaMessages(admitted.wire.requests[0]?.body ?? '').slice(-3)).toEqual([
			{ role: 'user', content: 'First arrival' },
			{ role: 'assistant', content: 'First answer' },
			{ role: 'user', content: 'Fold the conversation.' },
		])
		const idle = createStudyAgentSummary({ ...options, limit: STUDY_AGENT_PROJECTION + 1 })
		await expect(idle.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).rejects.toMatchObject({
			code: 'FAULT',
		})
		const blank = createStudyAgentSummary({
			replies: buildOllamaReplies('  '),
			observe: false,
			limit: STUDY_AGENT_PROJECTION + 1,
		})
		const sink = createStudySinkFixture()
		blank.trace.start('write')
		await expect(blank.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).rejects.toMatchObject({
			code: 'FAULT',
		})
		await blank.trace.flush(sink.sink)
		expect(sink.rows.map((row) => row.event)).toEqual(['summary'])
	})

	it('serves a scripted response from an owned snapshot under an explicit byte bound', async () => {
		const { StudyAgentScript } = server
		expect(() => new StudyAgentScript({ bytes: -1 })).toThrow(core.StudyError)
		expect(() => new StudyAgentScript({ bytes: 1.5 })).toThrow(core.StudyError)
		const meter = createStudyScriptMeter()
		try {
			const call = { id: 'call-1', name: 'lookup', arguments: { id: 'order-1' } }
			const fixture = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({ content: 'looking', calls: [call] }),
			])
			const script = new StudyAgentScript({ bytes: 512 })
			script.prepare(fixture.plan)
			call.arguments.id = 'changed'
			const result = await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)
			expect(result.content).toBe('looking')
			expect(result.tools?.[0]?.arguments).toEqual({ id: 'order-1' })
		} finally {
			meter.close()
		}
	})

	it('inspects captured package bytes without executing them and refuses drift', async () => {
		const { ArtifactLoader } = server
		const scratch = createScratch()
		try {
			scratch.write(
				'package.json',
				'{"name":"study-inspection-fixture","version":"1","type":"module"}',
			)
			scratch.write('dist/index.js', 'throw new Error("Inspection must not evaluate this entry")')
			const root = realpathSync(scratch.path)
			const entry = realpathSync(join(root, 'dist', 'index.js'))
			const artifacts = new ArtifactLoader({ roots: [root], entries: [entry] })
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
			const versions = new server.StudyGradingStore({
				result,
				rubric: server.encodeStudyJSON(rubric),
			})
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
