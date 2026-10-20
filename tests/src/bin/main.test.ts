import { arrayOf, isArray, isRecord, isString, parseJSON } from '@orkestrel/contract'
import { createScratch, destroyScratch, isRunning } from '@orkestrel/test/server'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { cpSync } from 'node:fs'
import { parseStudyArguments } from '../../../src/server/commands/parsers.js'
import { StudyCLI } from '../../../src/server/launchers/StudyCLI.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { StudyTask } from '../../../src/server/processes/StudyTask.js'
import { StudyCommand } from '../../../src/server/commands/StudyCommand.js'
import { readStudyResult } from '../../../src/server/stores/helpers.js'
import {
	createStudyScratch,
	admitStudyLibrary,
	buildStudyCLI,
	buildStudyLibrary,
	createStudyConsumer,
	executeStudyCLI,
	readStudyCheck,
	writeStudyAgent,
	writeStudyConsumer,
	buildCustodyPacketLabeling,
} from '../../setupServer.js'
import { parseStudyRubric } from '../../../src/core/parsers.js'
import { STUDY_COMMAND_INVALID_ARGUMENTS, STUDY_MISSING_DECLARATIONS } from '../../setupStudy.js'

describe('built study executable', () => {
	const runtime = createStudyScratch(resolve('tmp/units'), 'runtime-bin-')
	const compiled = Promise.withResolvers<string>()
	// Registered before the build hook so the scratch is removed even when the build fails.
	afterAll(async () => {
		await destroyScratch(runtime)
	})
	beforeAll(async () => {
		compiled.resolve(await buildStudyCLI(runtime))
	}, 60000)

	it('prints the installed version', async () => {
		const entry = await compiled.promise
		const scratch = createScratch()
		try {
			scratch.write('package.json', JSON.stringify({ name: 'study-consumer', version: '9.8.7' }))
			const version = spawnSync(process.execPath, [entry, '--version'], {
				cwd: scratch.path,
				encoding: 'utf8',
				windowsHide: true,
				timeout: 10000,
			})
			expect(version.status).toBe(0)
			expect(version.stdout).toBe('0.0.0-runtime\n')
			expect(version.stderr).toBe('')
			const invalid = spawnSync(process.execPath, [entry, '--version', 'extra'], {
				cwd: scratch.path,
				encoding: 'utf8',
				windowsHide: true,
				timeout: 10000,
			})
			expect(invalid.status).toBe(64)
			expect(invalid.stdout).toBe('')
			expect(invalid.stderr).toContain('study: CONFIG:')
			const help = spawnSync(process.execPath, [entry, '--version', '--help'], {
				cwd: scratch.path,
				encoding: 'utf8',
				windowsHide: true,
				timeout: 10000,
			})
			expect(help.status).toBe(0)
			expect(help.stdout).toContain('study --version')
			expect(help.stdout).toContain('study --help')
			expect(help.stderr).toBe('')
			expect(scratch.names()).toEqual(['package.json'])
		} finally {
			scratch.destroy()
		}
	})

	it.each(STUDY_MISSING_DECLARATIONS)(
		'refuses a missing declaration file as invalid input: $path $removed',
		async ({ tokens, removed, path }) => {
			const entry = await compiled.promise
			const scratch = createStudyConsumer()
			try {
				if (removed !== undefined) scratch.remove(removed)
				const refusal = await executeStudyCLI(entry, scratch.path, tokens)
				expect(refusal.code).toBe(64)
				expect(refusal.output).toBe(`study: CONFIG: Declaration is missing: ${path}\n`)
				expect(refusal.output).not.toContain(scratch.path)
				expect(scratch.has('tmp')).toBe(false)
				expect(scratch.has('imports.log')).toBe(false)
			} finally {
				await destroyScratch(scratch)
			}
		},
	)

	it('refuses a missing selected result as a custody failure', async () => {
		const entry = await compiled.promise
		const scratch = createScratch()
		try {
			const refusal = await executeStudyCLI(entry, scratch.path, [
				'report',
				'nope',
				'--grading',
				'a'.repeat(64),
			])
			expect(refusal.code).toBe(1)
			expect(refusal.output).toBe('study: CUSTODY: Selected result is missing: nope\n')
			expect(scratch.names()).toEqual([])
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a linked declaration as invalid input before following a junction', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		const outside = createScratch()
		try {
			const target = outside.ensure('scenarios')
			scratch.remove('studies/files/scenarios')
			scratch.link('studies/files/scenarios', target)
			const refusal = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect(refusal.code).toBe(64)
			expect(refusal.output).toBe(
				'study: CONFIG: Declaration path is linked: studies/files/scenarios\n',
			)
			expect(refusal.output).not.toContain(scratch.path)
			expect(scratch.has('tmp')).toBe(false)
			expect(scratch.has('imports.log')).toBe(false)
			expect(outside.names('scenarios')).toEqual([])
		} finally {
			scratch.remove('studies/files/scenarios')
			await destroyScratch(scratch)
			outside.destroy()
		}
	})

	it('refuses declarations in definition, scenario, rubric, profile order', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			scratch.remove('studies/assessment/rubric.json')
			scratch.remove('studies/files/profiles/local.json')
			const refusal = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect(refusal.code).toBe(64)
			expect(refusal.output).toBe(
				'study: CONFIG: Declaration is missing: studies/assessment/rubric.json\n',
			)
			expect(scratch.has('tmp')).toBe(false)
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('runs the sibling server face', async () => {
		const entry = await compiled.promise
		const server = runtime.read('runtime/dist/src/server/index.js')
		if (server === undefined) throw new Error('Missing server face')
		try {
			runtime.write(
				'runtime/dist/src/server/index.js',
				`throw new Error('server face loaded')\n${server}`,
			)
			const help = spawnSync(process.execPath, [entry, '--help'], {
				cwd: runtime.path,
				encoding: 'utf8',
				windowsHide: true,
				timeout: 10000,
			})
			expect(help.status).not.toBe(0)
			expect(help.stdout).toBe('')
			expect(help.stderr).toContain('server face loaded')
		} finally {
			runtime.write('runtime/dist/src/server/index.js', server)
		}
	})

	it('shares one core face between the built faces', async () => {
		await compiled.promise
		const driver = runtime.write(
			'identity.mjs',
			`import { StudyError } from './runtime/dist/src/core/index.js'
import { parseStudyArguments } from './runtime/dist/src/server/index.js'
try { parseStudyArguments([]) } catch (error) {
 process.stdout.write(JSON.stringify({ shared: error instanceof StudyError, code: error.code }))
}
`,
		)
		const identity = spawnSync(process.execPath, [driver], {
			cwd: runtime.path,
			encoding: 'utf8',
			windowsHide: true,
			timeout: 10000,
		})
		expect(identity.status).toBe(0)
		expect(identity.stderr).toBe('')
		expect(parseJSON(identity.stdout)).toEqual({ shared: true, code: 'CONFIG' })
	})

	it('bundles no sibling environment', async () => {
		await compiled.promise
		const server = parseJSON(runtime.read('runtime/dist/src/server/index.js.map') ?? '')
		const bin = parseJSON(runtime.read('runtime/dist/bin/main.js.map') ?? '')
		if (
			!isRecord(server) ||
			!arrayOf(isString)(server.sources) ||
			!isRecord(bin) ||
			!arrayOf(isString)(bin.sources)
		)
			throw new Error('Missing face sources')
		const sources = server.sources.map((source) => source.replaceAll('\\', '/'))
		const entries = bin.sources.map((source) => source.replaceAll('\\', '/'))
		expect(sources.some((source) => source.includes('src/server/'))).toBe(true)
		expect(entries.some((source) => source.endsWith('src/bin/main.ts'))).toBe(true)
		expect(sources.filter((source) => source.includes('src/core/'))).toEqual([])
		expect(entries.filter((source) => /src\/(?:core|server)\//u.test(source))).toEqual([])
	})

	it('prints help before consumer access and refuses private routes without native IPC', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			expect(runtime.read('runtime/dist/bin/main.js')?.startsWith('#!/usr/bin/env node')).toBe(true)
			const missing = join(runtime.path, 'missing-entry.js')
			expect(
				await new StudyCLI({
					root: join(runtime.path, 'missing-consumer'),
					entry: missing,
				}).execute(['--help']),
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('keeps grammar diagnostics on stderr and refuses relative output escape, links and collisions', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
			if (!isRecord(result) || !arrayOf(isString)(result.next))
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
			const outside = createStudyScratch(resolve('tmp/units'), 'cli-outside-')
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('checks a distinct target and driver without importing the subject or writing results', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('executes real file operations in children, seals, grades, labels and reports the whole horizon', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			const planned = parseJSON(checked.output)
			if (!isRecord(planned) || !arrayOf(isString)(planned.next))
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
				!arrayOf(isString)(result.next)
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
			for (const pid of pids) expect(isRunning(pid)).toBe(false)
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
				!arrayOf(isString)(grading.next)
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
			const rubric = parseStudyRubric(
				parseJSON(scratch.read('studies/assessment/rubric.json') ?? ''),
			)
			const labels = buildCustodyPacketLabeling(sealed, rubric)
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
			if (!isRecord(labeledResult) || !arrayOf(isString)(labeledResult.next))
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('refuses a domain-invalid scenario before subject import and execution writes', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('refuses a missing factory and a changed offline fingerprint before result creation', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('returns operational failure while retaining the complete failed horizon', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('compares a caller fingerprint without leaking execute-only flags into offline check', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('requires an exact complete sealed capacity qualification shared across target purposes', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
				'studies/assessment/study.json',
				JSON.stringify({ ...definition, purpose: 'quality' }),
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
			expect({
				code: qualified.code,
				output: qualified.code === 0 ? '' : qualified.output,
			}).toEqual({
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('preserves the declared provider namespace and profile without importing either during check', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('loads a shared agent and subject entry once while retaining both declared roles', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const source = scratch.read('studies/files/index.ts') ?? ''
			scratch.write(
				'studies/files/index.ts',
				source.replace(
					'driver(options) {',
					"driver(options) { if(options.agent!==options.subject||options.profile.agent!==options.profile.subject||options.agent.prefix!=='saved:') throw new Error('Shared selection split');",
				),
			)
			const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
			expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual({
				code: 0,
				output: '',
			})
			expect((scratch.read('imports.log') ?? '').trim().split(/\r\n|\n/)).toHaveLength(1)
			const result = parseJSON(executed.output)
			if (!isRecord(result) || typeof result.path !== 'string') throw new Error('Missing result')
			const sealed = await readStudyResult(result.path)
			if (sealed.status !== 'sealed') throw new Error('Execution did not seal')
			expect(sealed.manifest.identity.agent).toBe(sealed.manifest.identity.subject)
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('selects a distinct agent entry and binds its bytes into the execution identity', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const agent = writeStudyAgent(scratch, 'agent', 'agent-loaded')
			const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
			if (!isRecord(profile) || !isArray(profile.roots)) throw new Error('Missing profile')
			scratch.write(
				'studies/files/profiles/local.json',
				JSON.stringify({ ...profile, agent: agent.entry, roots: [...profile.roots, agent.root] }),
			)
			const source = scratch.read('studies/files/index.ts') ?? ''
			scratch.write(
				'studies/files/index.ts',
				source.replace(
					'driver(options) {',
					"driver(options) { if(options.agent.marker!=='agent-loaded'||options.agent===options.subject||options.subject.prefix!=='saved:'||options.profile.agent===options.profile.subject) throw new Error('Agent selection dropped');",
				),
			)
			const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect({ code: checked.code, output: checked.code === 0 ? '' : checked.output }).toEqual({
				code: 0,
				output: '',
			})
			expect(scratch.has('agent.log')).toBe(false)
			const before = readStudyCheck(checked.output)
			const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
			expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual({
				code: 0,
				output: '',
			})
			const evaluators = (scratch.read('agent.log') ?? '')
				.trim()
				.split(/\r\n|\n/)
				.map(Number)
			expect(evaluators.map((pid) => isRunning(pid))).toEqual([false])
			scratch.write(
				'agent/dist/index.js',
				`${scratch.read('agent/dist/index.js') ?? ''}\n// Changed agent bytes\n`,
			)
			const changed = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect(changed.code).toBe(0)
			const after = readStudyCheck(changed.output)
			expect(after.agent).not.toBe(before.agent)
			expect(after.fingerprint).not.toBe(before.fingerprint)
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('selects the named occurrence among several installed agent packages', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const first = writeStudyAgent(scratch, 'agent-first', 'first-loaded')
			const second = writeStudyAgent(scratch, 'agent-second', 'second-loaded')
			const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
			if (!isRecord(profile) || !isArray(profile.roots)) throw new Error('Missing profile')
			const source = scratch.read('studies/files/index.ts') ?? ''
			for (const [selected, other, marker] of [
				[second, first, 'second-loaded'],
				[first, second, 'first-loaded'],
			] as const) {
				scratch.write(
					'studies/files/profiles/local.json',
					JSON.stringify({
						...profile,
						agent: selected.entry,
						roots: [...profile.roots, first.root, second.root],
					}),
				)
				scratch.write(
					'studies/files/index.ts',
					source.replace(
						'driver(options) {',
						`driver(options) { if(options.agent.marker!==${JSON.stringify(marker)}) throw new Error('Wrong agent occurrence');`,
					),
				)
				const untouched = scratch.read(relative(scratch.path, other.log))
				const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
				expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual(
					{
						code: 0,
						output: '',
					},
				)
				expect(scratch.read(relative(scratch.path, other.log))).toBe(untouched)
			}
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('refuses a selected agent import during validation, directly or transitively', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const agent = writeStudyAgent(scratch, 'agent', 'agent-loaded')
			const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
			if (!isRecord(profile) || !isArray(profile.roots)) throw new Error('Missing profile')
			scratch.write(
				'studies/files/profiles/local.json',
				JSON.stringify({ ...profile, agent: agent.entry, roots: [...profile.roots, agent.root] }),
			)
			const adapter = scratch.read('studies/files/index.ts') ?? ''
			const href = pathToFileURL(agent.entry).href
			scratch.write('studies/files/part.ts', `export { marker } from ${JSON.stringify(href)}\n`)
			for (const imported of [
				`import { marker } from ${JSON.stringify(href)}`,
				"import { marker } from './part.js'",
			]) {
				scratch.write('studies/files/index.ts', `${imported}\nvoid marker\n${adapter}`)
				for (const operation of ['check', 'execute']) {
					const refused = await executeStudyCLI(entry, scratch.path, [operation, 'assessment'])
					expect(refused.code).not.toBe(0)
					expect(refused.output).toContain('Artifact module is excluded:')
				}
			}
			expect(scratch.has('agent.log')).toBe(false)
			expect(scratch.has('imports.log')).toBe(false)
			expect(scratch.has('tmp')).toBe(false)
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('executes a plain study that declares no recap, provider, or judge', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
			if (!isRecord(profile) || !isRecord(profile.room)) throw new Error('Missing profile')
			scratch.write(
				'studies/files/profiles/local.json',
				JSON.stringify({
					...profile,
					room: Object.fromEntries(Object.entries(profile.room).filter(([key]) => key !== 'recap')),
				}),
			)
			const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
			expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual({
				code: 0,
				output: '',
			})
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('admits a provider without a judge and refuses a half-declared judge', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
			if (!isRecord(profile)) throw new Error('Missing profile')
			const provider = scratch.write(
				'subject/dist/provider.js',
				`export const marker='provider-loaded';`,
			)
			const declared = { entry: provider, url: 'http://127.0.0.1:1', model: 'fixture-model' }
			scratch.write(
				'studies/files/profiles/local.json',
				JSON.stringify({
					...profile,
					provider: { ...declared, digest: { model: 'a'.repeat(64) } },
				}),
			)
			const omitted = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect({ code: omitted.code, output: omitted.code === 0 ? '' : omitted.output }).toEqual({
				code: 0,
				output: '',
			})
			for (const half of [
				{ ...declared, judge: 'fixture-judge', digest: { model: 'a'.repeat(64) } },
				{ ...declared, digest: { model: 'a'.repeat(64), judge: 'b'.repeat(64) } },
			]) {
				scratch.write(
					'studies/files/profiles/local.json',
					JSON.stringify({ ...profile, provider: half }),
				)
				const refused = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
				expect(refused.code).toBe(64)
				expect(refused.output).toContain('study profile')
			}
			expect(scratch.has('imports.log')).toBe(false)
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('refuses selected subject and provider imports during validation, directly or transitively', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const adapter = scratch.read('studies/files/index.ts') ?? ''
			const profile = parseJSON(scratch.read('studies/files/profiles/local.json') ?? '')
			if (!isRecord(profile)) throw new Error('Missing profile')
			const subject = pathToFileURL(join(scratch.path, 'subject/dist/index.js')).href
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
			scratch.write('studies/files/part.ts', `export { prefix } from ${JSON.stringify(subject)}\n`)
			scratch.write(
				'studies/files/provider.ts',
				`export { marker as prefix } from ${JSON.stringify(pathToFileURL(provider).href)}\n`,
			)
			for (const imported of [
				`import { prefix } from ${JSON.stringify(subject)}`,
				"import { prefix } from './part.js'",
				`import { marker as prefix } from ${JSON.stringify(pathToFileURL(provider).href)}`,
				"import { prefix } from './provider.js'",
			]) {
				scratch.write('studies/files/index.ts', `${imported}\nvoid prefix\n${adapter}`)
				for (const operation of ['check', 'execute']) {
					const refused = await executeStudyCLI(entry, scratch.path, [operation, 'assessment'])
					expect(refused.code).not.toBe(0)
					expect(refused.output).toContain('Artifact module is excluded:')
				}
			}
			expect(scratch.has('imports.log')).toBe(false)
			expect(scratch.has('provider.log')).toBe(false)
			expect(scratch.has('tmp')).toBe(false)
			scratch.write('studies/files/index.ts', adapter)
			const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect({ code: checked.code, output: checked.code === 0 ? '' : checked.output }).toEqual({
				code: 0,
				output: '',
			})
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('refuses quality without qualification before evaluation while capacity and mechanism execute', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const definition = parseJSON(scratch.read('studies/assessment/study.json') ?? '')
			const rubric = parseJSON(scratch.read('studies/assessment/rubric.json') ?? '')
			if (!isRecord(definition) || !isRecord(rubric) || !isArray(rubric.criteria))
				throw new Error('Missing declarations')
			expect(definition.purpose).toBe('capacity')
			scratch.write(
				'studies/quality/study.json',
				JSON.stringify({ ...definition, name: 'quality', purpose: 'quality' }),
			)
			scratch.write('studies/quality/rubric.json', JSON.stringify(rubric))
			for (const operation of ['check', 'execute']) {
				const refused = await executeStudyCLI(entry, scratch.path, [operation, 'quality'])
				expect(refused.code).toBe(64)
				expect(refused.output).toContain('Quality studies require a capacity qualification')
			}
			expect(scratch.has('imports.log')).toBe(false)
			expect(scratch.has('tmp')).toBe(false)
			scratch.write(
				'studies/mechanism/study.json',
				JSON.stringify({ ...definition, name: 'mechanism', purpose: 'mechanism' }),
			)
			scratch.write(
				'studies/mechanism/rubric.json',
				JSON.stringify({
					...rubric,
					criteria: rubric.criteria.map((criterion) =>
						isRecord(criterion) ? { ...criterion, method: 'state' } : criterion,
					),
				}),
			)
			for (const study of ['assessment', 'mechanism']) {
				const executed = await executeStudyCLI(entry, scratch.path, ['execute', study])
				expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual(
					{
						code: 0,
						output: '',
					},
				)
			}
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('binds the server face into the label instrument', async () => {
		const entry = await compiled.promise
		const server = runtime.read('runtime/dist/src/server/index.js')
		const bin = runtime.read(entry)
		if (server === undefined || bin === undefined) throw new Error('Missing runtime faces')
		const scratch = createStudyConsumer()
		try {
			const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
			expect({ code: executed.code, output: executed.code === 0 ? '' : executed.output }).toEqual({
				code: 0,
				output: '',
			})
			const result = parseJSON(executed.output)
			if (!isRecord(result) || typeof result.path !== 'string') throw new Error('Missing result')
			const graded = await executeStudyCLI(entry, scratch.path, [
				'grade',
				result.path,
				'--rubric',
				'studies/assessment/rubric.json',
			])
			expect({ code: graded.code, output: graded.code === 0 ? '' : graded.output }).toEqual({
				code: 0,
				output: '',
			})
			const grading = parseJSON(graded.output)
			if (!isRecord(grading) || typeof grading.grading !== 'string')
				throw new Error('Missing grading')
			const sealed = await readStudyResult(result.path)
			if (sealed.status !== 'sealed') throw new Error('Execution did not seal')
			const rubric = parseStudyRubric(
				parseJSON(scratch.read('studies/assessment/rubric.json') ?? ''),
			)
			const labels = scratch.write(
				'labels.json',
				JSON.stringify(buildCustodyPacketLabeling(sealed, rubric)),
			)
			const tokens = ['label', result.path, '--grading', grading.grading, '--labels', labels]
			const labeled = await executeStudyCLI(entry, scratch.path, tokens)
			expect({ code: labeled.code, output: labeled.code === 0 ? '' : labeled.output }).toEqual({
				code: 0,
				output: '',
			})
			const first = parseJSON(labeled.output)
			if (!isRecord(first) || typeof first.grading !== 'string') throw new Error('Missing label')
			runtime.write(
				'runtime/dist/src/server/index.js',
				`${server}\n// Changed label server bytes\n`,
			)
			expect(runtime.read(entry)).toBe(bin)
			const relabeled = await executeStudyCLI(entry, scratch.path, tokens)
			expect({
				code: relabeled.code,
				output: relabeled.code === 0 ? '' : relabeled.output,
			}).toEqual({ code: 0, output: '' })
			const second = parseJSON(relabeled.output)
			if (!isRecord(second) || typeof second.grading !== 'string')
				throw new Error('Missing changed label')
			expect(first.previous).toBe(grading.grading)
			expect(second.previous).toBe(grading.grading)
			expect(second.grading).not.toBe(first.grading)
		} finally {
			runtime.write('runtime/dist/src/server/index.js', server)
			await destroyScratch(scratch)
		}
	})

	it('keeps distinct labeled gradings when equal labels follow distinct graders', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
			const result = parseJSON(executed.output)
			if (!isRecord(result) || typeof result.path !== 'string') throw new Error('Missing result')
			const grade = ['grade', result.path, '--rubric', 'studies/assessment/rubric.json']
			const first = parseJSON((await executeStudyCLI(entry, scratch.path, grade)).output)
			const adapter = scratch.read('studies/files/index.ts') ?? ''
			scratch.write('studies/files/index.ts', `${adapter}\n// Changed grader bytes\n`)
			const second = parseJSON((await executeStudyCLI(entry, scratch.path, grade)).output)
			if (
				!isRecord(first) ||
				!isRecord(second) ||
				typeof first.grading !== 'string' ||
				typeof second.grading !== 'string'
			)
				throw new Error('Missing gradings')
			expect(first.grading).not.toBe(second.grading)
			const sealed = await readStudyResult(result.path)
			if (sealed.status !== 'sealed') throw new Error('Execution did not seal')
			const rubric = parseStudyRubric(
				parseJSON(scratch.read('studies/assessment/rubric.json') ?? ''),
			)
			const labels = scratch.write(
				'labels.json',
				JSON.stringify(buildCustodyPacketLabeling(sealed, rubric)),
			)
			const labeled: string[] = []
			for (const grading of [first.grading, second.grading]) {
				const output = await executeStudyCLI(entry, scratch.path, [
					'label',
					result.path,
					'--grading',
					grading,
					'--labels',
					labels,
				])
				expect({ code: output.code, output: output.code === 0 ? '' : output.output }).toEqual({
					code: 0,
					output: '',
				})
				const value = parseJSON(output.output)
				if (!isRecord(value) || typeof value.grading !== 'string') throw new Error('Missing label')
				expect(value.previous).toBe(grading)
				labeled.push(value.grading)
			}
			expect(new Set([first.grading, second.grading, ...labeled]).size).toBe(4)
			const importer = runtime.read(entry)
			if (importer === undefined) throw new Error('Missing importer bytes')
			try {
				runtime.write(entry, `${importer}\n// Changed label importer bytes\n`)
				const imported = await executeStudyCLI(entry, scratch.path, [
					'label',
					result.path,
					'--grading',
					first.grading,
					'--labels',
					labels,
				])
				expect(imported.code).toBe(0)
				const value = parseJSON(imported.output)
				if (!isRecord(value) || typeof value.grading !== 'string') throw new Error('Missing label')
				expect(value.previous).toBe(first.grading)
				expect(labeled).not.toContain(value.grading)
				labeled.push(value.grading)
			} finally {
				runtime.write(entry, importer)
			}
			for (const grading of [first.grading, second.grading, ...labeled]) {
				const report = await executeStudyCLI(entry, scratch.path, [
					'report',
					result.path,
					'--grading',
					grading,
				])
				expect(report.code).toBe(0)
			}
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('keeps a real built library StudyError code across the captured module boundary', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const library = createStudyScratch(resolve('tmp/units'), 'runtime-library-')
			try {
				const built = pathToFileURL(await buildStudyLibrary(library)).href
				admitStudyLibrary(scratch, library)
				for (const [thrown, code, message] of [
					[
						"new StudyError('CONFIG', 'Built library refusal')",
						64,
						'CONFIG: Built library refusal',
					],
					[
						"new StudyError('EVIDENCE', 'Built evidence refusal')",
						1,
						'FAULT: Built evidence refusal',
					],
					[
						"Object.assign(new Error('Plain refusal'), { code: 'CONFIG' })",
						1,
						'FAULT: Plain refusal',
					],
					[
						"Object.assign(new Error('Foreign refusal'), { name: 'StudyError', code: 'ARTIFACT' })",
						1,
						'FAULT: Foreign refusal',
					],
					[
						"Object.assign(new Error('Foreign configuration'), { name: 'StudyError', code: 'CONFIG' })",
						1,
						'FAULT: Foreign configuration',
					],
				] as const) {
					scratch.write(
						'studies/files/index.ts',
						`import { StudyError } from ${JSON.stringify(built)}\nvoid StudyError\nexport function createStudyAdapter() { return { validate() { throw ${thrown} }, driver() {}, grade() { return [] } } }\n`,
					)
					const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
					expect(checked.code).toBe(code)
					expect(checked.output).toContain(`study: ${message}`)
				}
			} finally {
				await destroyScratch(library)
			}
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('attributes a real built library StudyError thrown during captured execution', async () => {
		const entry = await compiled.promise
		const library = createStudyScratch(resolve('tmp/units'), 'runtime-library-')
		try {
			const built = pathToFileURL(await buildStudyLibrary(library)).href
			for (const [thrown, failure] of [
				[
					"new StudyError('CAPACITY', 'Captured capacity')",
					{ cause: 'capacity', message: 'Captured capacity', role: undefined },
				],
				[
					"new StudyError('DEADLINE', 'Captured deadline')",
					{ cause: 'deadline', message: 'Captured deadline', role: undefined },
				],
				[
					"new StudyError('FAULT', 'Captured attribution', { cause: 'capacity', message: 'Context full', role: 'agent' })",
					{ cause: 'capacity', message: 'Context full', role: 'agent' },
				],
				[
					"new StudyError('FAULT', 'Captured fault')",
					{ cause: 'infrastructure', message: 'Captured fault', role: undefined },
				],
				[
					"Object.assign(new Error('Foreign capacity'), { name: 'StudyError', code: 'CAPACITY' })",
					{ cause: 'infrastructure', message: 'Foreign capacity', role: undefined },
				],
			] as const) {
				const consumer = createStudyScratch(resolve('tmp/units'), 'runtime-consumer-')
				try {
					writeStudyConsumer(consumer)
					admitStudyLibrary(consumer, library)
					const source = consumer.read('studies/files/index.ts') ?? ''
					consumer.write(
						'studies/files/index.ts',
						`import { StudyError } from ${JSON.stringify(built)}\n${source.replace(
							'async execute(goal, context) {',
							`async execute(goal, context) { throw ${thrown};`,
						)}`,
					)
					const executed = await executeStudyCLI(entry, consumer.path, ['execute', 'assessment'])
					expect(executed.code).toBe(1)
					const result = parseJSON(executed.output.split(/\r\n|\n/)[0] ?? '')
					if (!isRecord(result) || typeof result.path !== 'string')
						throw new Error(`Missing failure result: ${executed.output}`)
					const sealed = await readStudyResult(result.path)
					if (sealed.status !== 'sealed') throw new Error('Failure horizon did not seal')
					expect(sealed.attempts[0]?.failure).toEqual(failure)
				} finally {
					await destroyScratch(consumer)
				}
			}
		} finally {
			await destroyScratch(library)
		}
	})

	it('keeps an abandoned ticket observation exact and reports its cleanup disconnect', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const library = createStudyScratch(resolve('tmp/units'), 'runtime-library-')
			try {
				const built = pathToFileURL(await buildStudyLibrary(library)).href
				admitStudyLibrary(scratch, library)
				const source = scratch.read('studies/files/index.ts') ?? ''
				scratch.write(
					'studies/files/index.ts',
					`import { StudyError } from ${JSON.stringify(built)}\n${source.replace(
						'writeFileSync(file, options.subject.prefix+goal.input)',
						"(()=>{throw new StudyError('CAPACITY', 'Captured capacity')})()",
					)}`,
				)
				const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
				expect(executed.code).toBe(1)
				const result = parseJSON(executed.output.split(/\r\n|\n/)[0] ?? '')
				if (!isRecord(result) || typeof result.path !== 'string')
					throw new Error(`Missing failure result: ${executed.output}`)
				const sealed = await readStudyResult(result.path)
				if (sealed.status !== 'sealed') throw new Error('Failure horizon did not seal')
				expect(sealed.attempts[0]?.observations[0]?.failure).toEqual({
					cause: 'capacity',
					message: 'Captured capacity',
					role: undefined,
				})
				expect(sealed.attempts[0]?.failure).toEqual({
					cause: 'capacity',
					message: 'Captured capacity; cleanup: Study process disconnected',
					role: undefined,
				})
			} finally {
				await destroyScratch(library)
			}
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('refuses a nested trusted runtime loader reaching an unadmitted package', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
			const library = createStudyScratch(resolve('tmp/units'), 'nested-library-')
			try {
				const built = await buildStudyLibrary(library, resolve('src/server/artifacts/index.ts'))
				const runtimeLibrary = join(runtime.ensure('runtime/dist/loader'), 'index.js')
				cpSync(dirname(built), dirname(runtimeLibrary), { recursive: true })
				const outside = scratch.ensure('outside')
				scratch.write(
					'outside/package.json',
					JSON.stringify({
						name: 'unadmitted-subject',
						version: '1.0.0',
						type: 'module',
					}),
				)
				const target = scratch.write(
					'outside/dist/index.js',
					`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(scratch.path, 'escaped.log'))}, 'escaped'); export const prefix='saved:'`,
				)
				scratch.write(
					'subject/dist/index.js',
					`import {ArtifactLoader} from ${JSON.stringify(pathToFileURL(runtimeLibrary).href)}; const artifacts=new ArtifactLoader(${JSON.stringify({ entries: [target], roots: [outside] })}); const namespace=await artifacts.load(${JSON.stringify(target)}); export const prefix=namespace.prefix`,
				)
				const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
				expect({ code: checked.code, output: checked.code === 0 ? '' : checked.output }).toEqual({
					code: 0,
					output: '',
				})
				expect(scratch.has('escaped.log')).toBe(false)
				const executed = await executeStudyCLI(entry, scratch.path, ['execute', 'assessment'])
				const output = parseJSON(executed.output.split(/\r\n|\n/)[0] ?? '')
				if (!isRecord(output) || typeof output.path !== 'string') throw new Error(executed.output)
				const retained = await readStudyResult(output.path)
				expect(executed.code).toBe(1)
				if (retained.status !== 'sealed') throw new Error('Missing retained failure')
				expect(retained.attempts[0]?.failure?.message).toContain('Artifact URL is unsupported:')
				expect(scratch.has('escaped.log')).toBe(false)
				expect((await executeStudyCLI(entry, scratch.path, ['--help'])).code).toBe(0)
			} finally {
				await destroyScratch(library)
			}
		} finally {
			await destroyScratch(scratch)
		}
	})

	it('kills a blocked adapter using the native parent deadline without a survivor', async () => {
		const entry = await compiled.promise
		const scratch = createStudyConsumer()
		try {
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
			expect(isRunning(pid)).toBe(false)
			await expect(
				command.execute(
					['execute', 'assessment', '--expected', 'a'.repeat(64)],
					AbortSignal.abort(new Error('interrupted')),
				),
			).rejects.toThrow('interrupted')
		} finally {
			await destroyScratch(scratch)
		}
	})
})
