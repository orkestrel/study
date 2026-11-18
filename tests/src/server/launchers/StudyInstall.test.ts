import type { StudyInstallFixture } from '../../../setupServer.js'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { createRecorder, requireValue } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import {
	STUDY_INSTALL_ENTRY,
	STUDY_LAUNCH_CLEANUP,
	STUDY_LAUNCH_DURATION,
} from '../../../../src/server/launchers/constants.js'
import { StudyInstall } from '../../../../src/server/launchers/StudyInstall.js'
import {
	STUDY_LAUNCHER_PID,
	StudyInstallRecorder,
	createStudyInstallFixture,
	createStudyScratch,
	readStudyPid,
	releaseStudyPid,
	writeStudyLauncherEntry,
	writeStudyReplyEntry,
} from '../../../setupServer.js'

describe('StudyInstall', () => {
	it('executes its entry with only the given arguments in its root and captures both streams', async () => {
		const scratch = createStudyScratch(resolve('tmp/units'), 'install-execute-')
		const inherited = process.execArgv
		try {
			const entry = scratch.write(
				'entry.mjs',
				"process.stdout.write(JSON.stringify({ execArgv: process.execArgv, argv: process.argv.slice(2), cwd: process.cwd() })); process.stderr.write('diagnostic'); process.exitCode = 3\n",
			)
			process.execArgv = [...inherited, '--no-warnings']
			const result = await new StudyInstall({ root: scratch.path, entry }).execute([
				'check',
				'files',
			])
			const reply = parseJSON(result.stdout)
			if (!isRecord(reply) || typeof reply.cwd !== 'string')
				throw new Error(`Missing entry reply: ${result.stdout}${result.stderr}`)
			expect(result.code).toBe(3)
			expect({ execArgv: reply.execArgv, argv: reply.argv }).toEqual({
				execArgv: [],
				argv: ['check', 'files'],
			})
			expect(realpathSync(reply.cwd)).toBe(realpathSync(scratch.path))
			expect(result.stderr).toBe('diagnostic')
			expect(result.duration).toBeGreaterThan(0)
		} finally {
			process.execArgv = inherited
			scratch.destroy()
		}
	}, 30000)

	it('returns 124 at its deadline with the diagnostic in the captured stderr and the process gone', async () => {
		const scratch = createStudyScratch(resolve('tmp/units'), 'install-deadline-')
		try {
			const entry = writeStudyLauncherEntry(scratch, 20000, '')
			const result = await new StudyInstall({ root: scratch.path, entry }).execute(
				['check', 'files'],
				3000,
			)
			const pid = requireValue(readStudyPid(scratch, STUDY_LAUNCHER_PID))
			expect(result.code).toBe(124)
			expect(result.stderr).toBe('study: DEADLINE: Process tree exceeded its 3000 ms deadline\n')
			expect(result.duration).toBeGreaterThanOrEqual(3000)
			// A kill closes the child by the 3000 ms deadline plus the 15000 ms launch cleanup allowance,
			// 18000 ms in all; the held entry would exit on its own only at its 20000 ms lifetime.
			expect(result.duration).toBeLessThan(3000 + STUDY_LAUNCH_CLEANUP)
			expect(isRunning(pid)).toBe(false)
			expect(
				process.platform === 'win32'
					? execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
							encoding: 'utf8',
							windowsHide: true,
						})
					: '',
			).not.toMatch(new RegExp(`\\b${pid}\\b`))
		} finally {
			await releaseStudyPid(readStudyPid(scratch, STUDY_LAUNCHER_PID))
			scratch.destroy()
		}
	}, 30000)
})

describe('StudyInstall rehearse', () => {
	const prepared = Promise.withResolvers<StudyInstallFixture>()

	beforeAll(async () => {
		await createStudyInstallFixture().then(prepared.resolve, prepared.reject)
	}, 240000)

	afterAll(async () => {
		const { scratch } = await prepared.promise
		scratch.destroy()
	})

	it('runs freeze, check, execute, read, grade, and report through the frozen closure, under the checked deadline', async () => {
		const { scratch, install } = await prepared.promise
		const calls = createRecorder<readonly [readonly string[], number | undefined]>()
		const recorder = new StudyInstallRecorder({ root: install.root, entry: install.entry }, calls)
		const directory = join(scratch.path, 'rehearsal')
		const rehearsal = await recorder.rehearse({ study: 'assessment', profile: 'local', directory })
		const steps = [
			rehearsal.freeze,
			rehearsal.check,
			rehearsal.execute,
			rehearsal.grade,
			rehearsal.report,
		]
		expect(steps.map((step) => [step?.code, step?.code === 0 ? '' : step?.stderr])).toEqual(
			steps.map(() => [0, '']),
		)
		const declared = parseStudyProfile(
			parseJSON(requireValue(scratch.read('install/studies/files/profiles/local.json'))),
		)
		expect(calls.calls.map(([arguments_, duration]) => [arguments_[0], duration])).toEqual([
			['freeze', undefined],
			['check', undefined],
			['execute', declared.bounds.series.duration + STUDY_LAUNCH_CLEANUP + STUDY_LAUNCH_DURATION],
		])
		const closure = requireValue(rehearsal.closure)
		expect(closure.root).toBe(join(directory, 'closure'))
		expect(closure.entry).toBe(join(directory, 'closure', STUDY_INSTALL_ENTRY))
		const frozen = parseJSON(rehearsal.freeze.stdout)
		const checked = parseJSON(requireValue(rehearsal.check).stdout)
		if (!isRecord(frozen) || !isRecord(checked)) throw new Error('Missing freeze or check reply')
		expect(checked.fingerprint).toBe(frozen.fingerprint)
		expect(rehearsal.result).toMatchObject({
			status: 'sealed',
			directory: join(directory, 'result'),
		})
		const graded = parseJSON(requireValue(rehearsal.grade).stdout)
		if (!isRecord(graded)) throw new Error('Missing grade reply')
		expect(parseJSON(requireValue(rehearsal.report).stdout)).toMatchObject({
			command: 'report',
			assessment: graded.assessment,
			report: { scores: [{ total: 2, achieved: 1, unsuccessful: 0, unknown: 1 }] },
		})
	}, 240000)

	it('skips every step after a failed check, and every step after a failed freeze', async () => {
		const { scratch, install } = await prepared.promise
		const checked = await install.rehearse({
			study: 'assessment',
			profile: 'local',
			directory: join(scratch.path, 'unscheduled'),
			selection: { trial: 'missing' },
		})
		expect([checked.freeze.code, checked.check?.code]).toEqual([0, 64])
		expect(checked.closure).toBeDefined()
		expect([checked.execute, checked.result, checked.grade, checked.report]).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
		])
		const frozen = await install.rehearse({
			study: 'assessment',
			profile: 'absent',
			directory: join(scratch.path, 'unfrozen'),
		})
		expect(frozen.freeze.code).toBe(64)
		expect([
			frozen.closure,
			frozen.check,
			frozen.execute,
			frozen.result,
			frozen.grade,
			frozen.report,
		]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
	}, 240000)

	it('skips the read, grade, and report after a failed execute, and the report after a failed grade', async () => {
		const { scratch, install } = await prepared.promise
		const executed = await install.rehearse({
			study: 'assessment',
			profile: 'failing',
			directory: join(scratch.path, 'unexecuted'),
		})
		expect([executed.freeze.code, executed.check?.code, executed.execute?.code]).toEqual([0, 0, 1])
		expect([executed.result, executed.grade, executed.report]).toEqual([
			undefined,
			undefined,
			undefined,
		])
		const graded = await install.rehearse({
			study: 'ungraded',
			profile: 'local',
			directory: join(scratch.path, 'ungraded'),
		})
		expect([graded.freeze.code, graded.check?.code, graded.execute?.code]).toEqual([0, 0, 0])
		expect(graded.result?.status).toBe('sealed')
		expect(graded.grade?.code).toBe(1)
		expect(graded.grade?.stderr).toContain('Declared grade refusal')
		expect(graded.report).toBeUndefined()
	}, 240000)

	it('carries a selection that passes check to the execute step', async () => {
		const { scratch, install } = await prepared.promise
		const calls = createRecorder<readonly [readonly string[], number | undefined]>()
		const recorder = new StudyInstallRecorder({ root: install.root, entry: install.entry }, calls)
		const directory = join(scratch.path, 'selected')
		const destination = join(directory, 'closure')
		const output = join(directory, 'result')
		const goals = { first: 'write', last: 'write' }
		const rehearsal = await recorder.rehearse({
			study: 'assessment',
			profile: 'local',
			directory,
			selection: { goals },
		})
		expect(calls.calls.map(([arguments_]) => arguments_)).toEqual([
			['freeze', 'assessment', '--profile', 'local', '--to', destination],
			[
				'check',
				'assessment',
				'--profile',
				'local',
				'--closure',
				destination,
				'--goals',
				'write..write',
			],
			[
				'execute',
				'assessment',
				'--profile',
				'local',
				'--closure',
				destination,
				'--out',
				output,
				'--goals',
				'write..write',
			],
		])
		expect(rehearsal.execute?.code).toBe(0)
		expect(rehearsal.result?.status === 'sealed' && rehearsal.result.manifest.selection).toEqual({
			goals,
		})
	}, 240000)

	it('refuses a check that exits 0 without validated bounds, through an entry that answers check itself', async () => {
		const { scratch, install } = await prepared.promise
		const entry = writeStudyReplyEntry(install, 'check', '{"command":"check"}\n')
		await expect(
			new StudyInstall({ root: install.root, entry }).rehearse({
				study: 'assessment',
				profile: 'local',
				directory: join(scratch.path, 'unbounded'),
			}),
		).rejects.toMatchObject({
			code: 'FAULT',
			message: 'Study check exited 0 without its validated bounds',
		})
	}, 240000)

	it('refuses a grade that exits 0 without an assessment identity, through a frozen entry that answers grade itself', async () => {
		const { scratch, install } = await prepared.promise
		const entry = writeStudyReplyEntry(install, 'grade', '{"command":"grade"}\n')
		await expect(
			new StudyInstall({ root: install.root, entry }).rehearse({
				study: 'assessment',
				profile: 'local',
				directory: join(scratch.path, 'unassessed'),
			}),
		).rejects.toMatchObject({
			code: 'FAULT',
			message: 'Study grade exited 0 without its assessment identity',
		})
	}, 240000)

	it("streams the launcher's check diagnostic to the installed bin's own stderr when execute's check refuses", async () => {
		const { install } = await prepared.promise
		const result = await install.execute(['execute', 'assessment', '--trial', 'missing'])
		expect({ code: result.code, stdout: result.stdout }).toEqual({ code: 64, stdout: '' })
		expect(result.stderr.split(/\r\n|\n/)).toContain(
			'study: CONFIG: --trial missing names no scheduled trial; check lists the schedule',
		)
	}, 120000)

	it('refuses an existing directory or an absent parent before any step runs', async () => {
		const { scratch, install } = await prepared.promise
		scratch.ensure('occupied')
		await expect(
			install.rehearse({
				study: 'assessment',
				profile: 'local',
				directory: join(scratch.path, 'occupied'),
			}),
		).rejects.toMatchObject({
			code: 'CONFIG',
			message: expect.stringContaining('Rehearsal directory exists'),
		})
		expect(scratch.names('occupied')).toEqual([])
		const parent = join(scratch.path, 'absent')
		await expect(
			install.rehearse({
				study: 'assessment',
				profile: 'local',
				directory: join(parent, 'rehearsal'),
			}),
		).rejects.toMatchObject({
			code: 'CONFIG',
			message: `Rehearsal directory parent is missing: ${parent}; create it before rehearsing`,
		})
		expect(scratch.has('absent')).toBe(false)
	})
})
