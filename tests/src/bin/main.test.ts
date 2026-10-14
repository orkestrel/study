import type { ScratchInterface } from '@orkestrel/test/server'
import { isArray, isRecord, parseJSON } from '@orkestrel/contract'
import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseStudyArguments } from '../../../src/server/commands/parsers.js'
import { StudyCLI } from '../../../src/server/launchers/StudyCLI.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { StudyTask } from '../../../src/server/processes/StudyTask.js'
import { StudyCommand } from '../../../src/server/commands/StudyCommand.js'
import { readStudyResult } from '../../../src/server/stores/helpers.js'
import {
	buildStudyCLI,
	executeStudyCLI,
	writeStudyConsumer,
	buildCustodyPacketLabels,
} from '../../setupServer.js'
import { parseStudyRubric } from '../../../src/core/parsers.js'
import { STUDY_COMMAND_INVALID_ARGUMENTS } from '../../setupStudy.js'

describe('built study executable', () => {
	const runtime = createScratch({ parent: resolve('tmp/units'), prefix: 'runtime-bin-' })
	let entry: string
	let scratch: ScratchInterface
	beforeAll(async () => {
		entry = await buildStudyCLI(runtime)
	})
	beforeEach(() => {
		scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'runtime-consumer-' })
		writeStudyConsumer(scratch)
	})
	afterEach(async () => {
		await destroyScratch(scratch)
	})
	afterAll(async () => {
		await destroyScratch(runtime)
	})

	it('prints help before consumer access and refuses private routes without native IPC', async () => {
		expect(runtime.read('runtime/dist/bin/main.js')?.startsWith('#!/usr/bin/env node')).toBe(true)
		const missing = join(runtime.path, 'missing-entry.js')
		expect(
			await new StudyCLI({ root: join(runtime.path, 'missing-consumer'), entry: missing }).execute([
				'--help',
			]),
		).toBe(0)
		const empty = scratch.ensure('empty')
		const help = spawnSync(process.execPath, [entry, 'execute', 'missing', '--help'], {
			cwd: empty,
			encoding: 'utf8',
			windowsHide: true,
			timeout: 3000,
		})
		expect(help.status).toBe(0)
		expect(help.stderr).toBe('')
		expect(help.stdout).toContain('study execute')
		expect(help.stdout).toContain('60 seconds')
		const bare = spawnSync(process.execPath, [entry], {
			cwd: empty,
			encoding: 'utf8',
			windowsHide: true,
			timeout: 3000,
		})
		expect(bare.status).toBe(64)
		expect(bare.stdout).toBe('')
		expect(bare.stderr).toBe(help.stdout)
		const anywhere = spawnSync(process.execPath, [entry, 'unknown', '--unknown', '--help'], {
			cwd: empty,
			encoding: 'utf8',
			windowsHide: true,
			timeout: 3000,
		})
		expect(anywhere.status).toBe(0)
		expect(anywhere.stdout).toBe(help.stdout)
		expect(scratch.names('empty')).toEqual([])
		for (const route of ['study-command', 'study-worker', 'study-adapter']) {
			const denied = spawnSync(process.execPath, [entry, route, 'execute', 'assessment'], {
				cwd: scratch.path,
				encoding: 'utf8',
				windowsHide: true,
				timeout: 3000,
			})
			expect(denied.status).toBe(64)
			expect(denied.stdout).toBe('')
			expect(denied.stderr).toContain('study: CONFIG:')
			expect(denied.stderr).toContain(route)
			expect(help.stdout).not.toContain(route)
			expect((await executeStudyCLI(entry, scratch.path, [route, '--help'])).code).toBe(64)
		}
		expect(scratch.has('imports.log')).toBe(false)
		expect(scratch.has('tmp')).toBe(false)
	})

	it('keeps grammar diagnostics on stderr and refuses relative output escape, links and collisions', async () => {
		for (const tokens of STUDY_COMMAND_INVALID_ARGUMENTS.filter(
			(arguments_) => arguments_.length > 0,
		)) {
			const rejected = spawnSync(process.execPath, [entry, ...tokens], {
				cwd: scratch.path,
				encoding: 'utf8',
				windowsHide: true,
				timeout: 3000,
			})
			expect(rejected.status).toBe(64)
			expect(rejected.stdout).toBe('')
			expect(rejected.stderr).toContain('study: CONFIG:')
			expect(rejected.stderr).toContain('study ')
		}
		expect(scratch.has('tmp')).toBe(false)
		scratch.ensure('chosen')
		const executed = await executeStudyCLI(entry, scratch.path, [
			'execute',
			'assessment',
			'--out',
			'chosen/result',
		])
		expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual({
			code: 0,
			output: '',
		})
		const result = parseJSON(executed.output)
		if (
			!isRecord(result) ||
			!isArray(result.next) ||
			!result.next.every((token): token is string => typeof token === 'string')
		)
			throw new Error('Missing relative output next argv')
		expect(result.path).toBe(join(scratch.path, 'chosen', 'result'))
		expect(parseStudyArguments(result.next)).toMatchObject({
			command: 'grade',
			target: result.path,
		})
		expect((await executeStudyCLI(entry, scratch.path, result.next)).code).toBe(0)
		const collision = await executeStudyCLI(entry, scratch.path, [
			'execute',
			'assessment',
			'--out',
			'chosen/result',
		])
		expect(collision.code).not.toBe(0)
		expect((scratch.read('imports.log') ?? '').trim().split(/\r\n|\n/)).toHaveLength(1)
		const outside = createScratch({ parent: resolve('tmp/units'), prefix: 'cli-outside-' })
		try {
			scratch.link('linked', outside.path)
			const linked = await executeStudyCLI(entry, scratch.path, [
				'execute',
				'assessment',
				'--out',
				'linked/result',
			])
			expect(linked.code).not.toBe(0)
			expect(outside.names()).toEqual([])
		} finally {
			await destroyScratch(outside)
		}
	})

	it('checks a distinct target and driver without importing the subject or writing results', async () => {
		const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
		expect({ code: checked.code, output: checked.code === 0 ? '' : checked.output }).toEqual({
			code: 0,
			output: '',
		})
		const value = parseJSON(checked.output)
		expect(value).toMatchObject({ command: 'check', study: 'assessment', driver: 'files' })
		expect(scratch.has('imports.log')).toBe(false)
		expect(scratch.has('tmp')).toBe(false)
		expect((await executeStudyCLI(entry, scratch.path, ['unknown', 'assessment'])).code).toBe(64)
	})

	it('executes real file operations in children, seals, grades, labels and reports the whole horizon', async () => {
		const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
		const planned = parseJSON(checked.output)
		if (
			!isRecord(planned) ||
			!isArray(planned.next) ||
			!planned.next.every((token): token is string => typeof token === 'string')
		)
			throw new Error('Missing check next argv')
		expect(parseStudyArguments(planned.next)).toMatchObject({
			command: 'execute',
			target: 'assessment',
			expected: planned.fingerprint,
		})
		const executed = await executeStudyCLI(entry, scratch.path, planned.next)
		expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual({
			code: 0,
			output: '',
		})
		const result = parseJSON(executed.output)
		if (
			!isRecord(result) ||
			typeof result.path !== 'string' ||
			typeof result.result !== 'string' ||
			!isArray(result.next) ||
			!result.next.every((token): token is string => typeof token === 'string')
		)
			throw new Error('Missing execution path')
		expect(result).not.toHaveProperty('id')
		expect(parseStudyArguments(result.next)).toEqual({
			command: 'grade',
			target: result.path,
			rubric: join(scratch.path, 'studies', 'assessment', 'rubric.json'),
		})
		expect(result.path.startsWith(join(scratch.path, 'tmp', 'studies'))).toBe(true)
		const pids = (scratch.read('imports.log') ?? '')
			.trim()
			.split(/\r\n|\n/)
			.map(Number)
		expect(pids.length).toBe(1)
		for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow(/ESRCH|no such process/i)
		const sealed = await readStudyResult(result.path)
		if (sealed.status !== 'sealed') throw new Error('Execution did not seal')
		expect(
			sealed.attempts
				.flatMap((attempt) => attempt.observations)
				.map((observation) => observation.product?.value),
		).toEqual(['saved:remember', 'saved:recall'])
		const grade = await executeStudyCLI(entry, scratch.path, result.next)
		expect({ code: grade.code, output: grade.code === 0 ? '' : grade.output }).toEqual({
			code: 0,
			output: '',
		})
		const grading = parseJSON(grade.output)
		if (
			!isRecord(grading) ||
			typeof grading.grading !== 'string' ||
			!isArray(grading.next) ||
			!grading.next.every((token): token is string => typeof token === 'string')
		)
			throw new Error('Missing grading')
		expect(parseStudyArguments(grading.next)).toEqual({
			command: 'report',
			target: result.path,
			grading: grading.grading,
		})
		expect((scratch.read('imports.log') ?? '').trim().split(/\r\n|\n/)).toHaveLength(1)
		const report = await executeStudyCLI(entry, scratch.path, grading.next)
		expect({ code: report.code, output: report.code === 0 ? '' : report.output }).toEqual({
			code: 0,
			output: '',
		})
		expect(parseJSON(report.output)).toMatchObject({
			report: { scores: [{ achieved: 1, unknown: 1 }] },
		})
		const rubric = parseStudyRubric(parseJSON(scratch.read('studies/assessment/rubric.json') ?? ''))
		const labels = buildCustodyPacketLabels(sealed, rubric)
		const path = scratch.write('labels.json', JSON.stringify(labels))
		const labeled = await executeStudyCLI(entry, scratch.path, [
			'label',
			result.path,
			'--grading',
			grading.grading,
			'--labels',
			path,
		])
		expect({ code: labeled.code, output: labeled.code === 0 ? '' : labeled.output }).toEqual({
			code: 0,
			output: '',
		})
		const labeledResult = parseJSON(labeled.output)
		if (
			!isRecord(labeledResult) ||
			!isArray(labeledResult.next) ||
			!labeledResult.next.every((token): token is string => typeof token === 'string')
		)
			throw new Error('Missing label next argv')
		expect(parseStudyArguments(labeledResult.next)).toEqual({
			command: 'report',
			target: result.path,
			grading: labeledResult.grading,
		})
		const labeledReport = await executeStudyCLI(entry, scratch.path, labeledResult.next)
		expect(parseJSON(labeledReport.output)).toMatchObject({
			report: { scores: [{ achieved: 2, unknown: 0 }] },
		})
		const missingGrade = 'e'.repeat(64)
		for (const operation of [
			['report', result.result, '--grading', missingGrade],
			['label', result.result, '--grading', missingGrade, '--labels', path],
		]) {
			const missing = await executeStudyCLI(entry, scratch.path, operation)
			expect(missing.code).not.toBe(0)
			expect(missing.output).toContain('study: CUSTODY: Selected grading is missing:')
			expect(missing.output).toContain(join(result.path, 'grades', missingGrade, 'grading.json'))
		}
		const source = scratch.read('studies/files/index.ts') ?? ''
		scratch.write(
			'studies/files/index.ts',
			source.replace("row.value==='saved:'", "row.value==='changed:'"),
		)
		const regraded = await executeStudyCLI(entry, scratch.path, [
			'grade',
			result.path,
			'--rubric',
			'studies/assessment/rubric.json',
		])
		expect({ code: regraded.code, output: regraded.code === 0 ? '' : regraded.output }).toEqual({
			code: 0,
			output: '',
		})
		const current = parseJSON(regraded.output)
		if (!isRecord(current) || typeof current.grading !== 'string')
			throw new Error('Missing regrading')
		expect(current.grading).not.toBe(grading.grading)
		const reread = await readStudyResult(result.path)
		if (reread.status !== 'sealed') throw new Error('Execution seal changed')
		expect(reread.seal.id).toBe(sealed.seal.id)
	})

	it('refuses a domain-invalid scenario before subject import and execution writes', async () => {
		scratch.write(
			'studies/files/scenarios/first.json',
			JSON.stringify({
				id: 'first',
				goals: [
					{ id: 'write', input: 123 },
					{ id: 'read', input: 'recall' },
				],
			}),
		)
		const result = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
		expect(result.code).not.toBe(0)
		expect(result.output).toContain('File adapter requires text input')
		expect(scratch.has('imports.log')).toBe(false)
		expect(scratch.has('tmp')).toBe(false)
	})

	it('refuses a missing factory and a changed offline fingerprint before result creation', async () => {
		const command = new StudyCommand({ root: scratch.path, entry })
		const checked = await command.execute(['check', 'assessment'], new AbortController().signal)
		if (!isRecord(checked) || typeof checked.fingerprint !== 'string')
			throw new Error('Missing fingerprint')
		const source = scratch.read('studies/files/index.ts') ?? ''
		scratch.write('studies/files/index.ts', `${source}\n// Changed captured bytes\n`)
		await expect(
			command.execute(
				['execute', 'assessment', '--expected', checked.fingerprint],
				new AbortController().signal,
			),
		).rejects.toThrow('changed after the supervisor check')
		expect(scratch.has('imports.log')).toBe(false)
		expect(scratch.has('tmp')).toBe(false)
		scratch.write('studies/files/index.ts', 'export const missing = true')
		const invalid = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
		expect(invalid.code).toBe(64)
		expect(invalid.output).toContain('createStudyAdapter')
	})

	it('returns operational failure while retaining the complete failed horizon', async () => {
		const source = scratch.read('studies/files/index.ts') ?? ''
		scratch.write(
			'studies/files/index.ts',
			source.replace(
				'writeFileSync(file, options.subject.prefix+goal.input)',
				"(()=>{throw new Error('file operation failed')})()",
			),
		)
		const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
		expect(executed.code).toBe(1)
		const result = parseJSON(executed.output.split(/\r\n|\n/)[0] ?? '')
		if (!isRecord(result) || typeof result.path !== 'string')
			throw new Error(`Missing failure result: ${executed.output}`)
		const sealed = await readStudyResult(result.path)
		if (sealed.status !== 'sealed') throw new Error('Failure horizon did not seal')
		expect(sealed.attempts).toHaveLength(sealed.manifest.schedule.length)
		expect(sealed.attempts[0]?.observations).toHaveLength(2)
		expect(sealed.attempts[0]?.failure).toBeDefined()
	})

	it('compares a caller fingerprint without leaking execute-only flags into offline check', async () => {
		const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
		const value = parseJSON(checked.output)
		if (!isRecord(value) || typeof value.fingerprint !== 'string')
			throw new Error('Missing fingerprint')
		const mismatch = await executeStudyCLI(entry, scratch.path, [
			'execute',
			'assessment',
			'--expected',
			'a'.repeat(64),
		])
		expect(mismatch.code).toBe(64)
		expect(mismatch.output).toContain('requested fingerprint')
		expect(scratch.has('imports.log')).toBe(false)
		const matching = await executeStudyCLI(entry, scratch.path, [
			'execute',
			'assessment',
			'--expected',
			value.fingerprint,
		])
		expect({ code: matching.code, output: matching.code === 0 ? '' : matching.output }).toEqual({
			code: 0,
			output: '',
		})
	})

	it('requires an exact complete sealed capacity qualification shared across target purposes', async () => {
		const source = scratch.read('studies/files/index.ts') ?? ''
		scratch.write('studies/files/index.ts', source.replace('partial:false', 'partial:true'))
		const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
		const definition = parseJSON(scratch.read('studies/assessment/study.json') ?? '')
		if (!isRecord(profile) || !isRecord(definition)) throw new Error('Missing declarations')
		const qualification = join(scratch.path, 'capacity-result')
		scratch.write(
			'studies/files/profiles/local.json',
			JSON.stringify({ ...profile, qualification }),
		)
		scratch.write(
			'studies/capacity/study.json',
			JSON.stringify({ ...definition, name: 'capacity', purpose: 'capacity' }),
		)
		scratch.write(
			'studies/capacity/rubric.json',
			scratch.read('studies/assessment/rubric.json') ?? '',
		)
		const missing = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
		expect(missing.code).not.toBe(0)
		expect(scratch.has('tmp')).toBe(false)
		const capacity = await executeStudyCLI(entry, scratch.path, [
			'execute',
			'capacity',
			'--out',
			qualification,
		])
		expect({ code: capacity.code, output: capacity.code === 0 ? '' : capacity.output }).toEqual({
			code: 0,
			output: '',
		})
		const qualified = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
		expect({ code: qualified.code, output: qualified.code === 0 ? '' : qualified.output }).toEqual({
			code: 0,
			output: '',
		})
		const result = parseJSON(qualified.output)
		if (!isRecord(result) || typeof result.path !== 'string')
			throw new Error('Missing qualified result')
		const sealed = await readStudyResult(result.path)
		const prior = await readStudyResult(qualification)
		if (sealed.status !== 'sealed' || prior.status !== 'sealed')
			throw new Error('Unsealed qualification')
		expect(sealed.manifest.qualification).toBe(prior.seal.id)
		expect(sealed.attempts[0]?.observations[0]?.product?.partial).toBe(true)
		scratch.write('capacity-result/execution/manifest.json', '{}')
		const tampered = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
		expect(tampered.code).not.toBe(0)
	})

	it('preserves the declared provider namespace and profile without importing either during check', async () => {
		const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
		if (!isRecord(profile)) throw new Error('Missing profile')
		const provider = scratch.write(
			'subject/dist/provider.js',
			`import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(scratch.path, 'provider.log'))}, String(process.pid)); export const marker='provider-loaded';`,
		)
		scratch.write(
			'studies/files/profiles/local.json',
			JSON.stringify({
				...profile,
				provider: {
					entry: provider,
					url: 'http://127.0.0.1:1',
					model: 'fixture-model',
					judge: 'fixture-judge',
					digest: { model: 'a'.repeat(64), judge: 'b'.repeat(64) },
				},
			}),
		)
		const source = scratch.read('studies/files/index.ts') ?? ''
		scratch.write(
			'studies/files/index.ts',
			source.replace(
				'driver(options) {',
				"driver(options) { if(options.provider.marker!=='provider-loaded'||options.profile.provider.model!=='fixture-model') throw new Error('Provider selection dropped');",
			),
		)
		const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
		expect(checked.code).toBe(0)
		expect(scratch.has('imports.log')).toBe(false)
		expect(scratch.has('provider.log')).toBe(false)
		const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
		expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual({
			code: 0,
			output: '',
		})
		expect(scratch.has('provider.log')).toBe(true)
	})

	it('kills a blocked adapter using the native parent deadline without a survivor', async () => {
		const pidfile = join(scratch.path, 'blocked.pid')
		scratch.write(
			'studies/files/index.ts',
			`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(pidfile)}, String(process.pid)); while(true) {}`,
		)
		const options = {
			root: scratch.path,
			entry,
			adapter: join(scratch.path, 'studies/files/index.ts'),
			roots: [join(scratch.path, 'subject')],
			duration: 1000,
		}
		const command = new StudyCommand({ root: scratch.path, entry })
		const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
		if (!isRecord(profile)) throw new Error('Missing profile')
		// Parsing a domain request occurs before the blocked module is evaluated.
		const { parseStudyDefinition, parseStudyProfile, parseStudyScenario } =
			await import('../../../src/core/parsers.js')
		const task = new StudyTask(options)
		await expect(
			task.execute(
				{
					operation: 'validate',
					input: {
						definition: parseStudyDefinition(
							parseJSON(scratch.read('studies/assessment/study.json') ?? ''),
						),
						scenarios: [
							parseStudyScenario(
								parseJSON(scratch.read('studies/files/scenarios/first.json') ?? ''),
							),
						],
						profile: parseStudyProfile(profile),
						rubric: parseStudyRubric(
							parseJSON(scratch.read('studies/assessment/rubric.json') ?? ''),
						),
					},
				},
				new AbortController().signal,
			),
		).rejects.toThrow('deadline')
		const pid = Number(scratch.read('blocked.pid'))
		expect(Number.isSafeInteger(pid) && pid > 0).toBe(true)
		expect(() => process.kill(pid, 0)).toThrow(/ESRCH|no such process/i)
		await expect(
			command.execute(
				['execute', 'assessment', '--expected', 'a'.repeat(64)],
				AbortSignal.abort(new Error('interrupted')),
			),
		).rejects.toThrow('interrupted')
	})
})
