import { requireValue } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { STUDY_COMMAND_DURATION } from '../../../../src/server/commands/constants.js'
import { STUDY_LAUNCH_DURATION } from '../../../../src/server/launchers/constants.js'
import { StudyLauncher } from '../../../../src/server/launchers/StudyLauncher.js'
import {
	STUDY_BURST_ARGUMENTS,
	STUDY_CHECK_FINGERPRINT,
	STUDY_CHECK_ARGUMENTS,
	STUDY_EXECUTE_ARGUMENTS,
	STUDY_HOLD_ARGUMENTS,
	STUDY_LAUNCHER_PID,
	buildStudyLibrary,
	readStudyCommands,
	readStudyPid,
	releaseStudyPid,
	writeStudyBurstEntry,
	writeStudyCheckEntry,
	writeStudyInterruptor,
	writeStudyLauncherEntry,
} from '../../../setupServer.js'

describe('StudyLauncher', () => {
	it('terminates a held command at the public default duration and returns 124', async () => {
		const scratch = createScratch()
		const launcher = new StudyLauncher({
			root: scratch.path,
			entry: writeStudyLauncherEntry(scratch, 80000, ''),
		})
		const started = performance.now()
		const result = launcher.execute(STUDY_CHECK_ARGUMENTS)
		const settled = result.then(
			() => undefined,
			() => undefined,
		)
		try {
			const code = await new StudyDeadline({
				duration: 75000,
				label: 'launcher default deadline observation',
			}).wait(result)
			const elapsed = performance.now() - started
			expect(code).toBe(124)
			expect(elapsed).toBeGreaterThanOrEqual(STUDY_LAUNCH_DURATION)
			expect(elapsed).toBeLessThan(75000)
			expect(isRunning(requireValue(readStudyPid(scratch, STUDY_LAUNCHER_PID)))).toBe(false)
		} finally {
			await releaseStudyPid(readStudyPid(scratch, STUDY_LAUNCHER_PID))
			await settled
			scratch.destroy()
		}
	}, 90000)

	it('returns the ordinary exit of a command that ends before its deadline', async () => {
		const scratch = createScratch()
		const launcher = new StudyLauncher({
			root: scratch.path,
			entry: writeStudyLauncherEntry(scratch, 20000, 'finish(7)'),
		})
		const result = launcher.execute(STUDY_CHECK_ARGUMENTS)
		const settled = result.then(
			() => undefined,
			() => undefined,
		)
		try {
			const code = await new StudyDeadline({
				duration: 15000,
				label: 'launcher ordinary exit observation',
			}).wait(result)
			expect(code).toBe(7)
			expect(isRunning(requireValue(readStudyPid(scratch, STUDY_LAUNCHER_PID)))).toBe(false)
		} finally {
			await releaseStudyPid(readStudyPid(scratch, STUDY_LAUNCHER_PID))
			await settled
			scratch.destroy()
		}
	}, 20000)

	it('refuses to dispatch execute for a checked series duration above the host ceiling', async () => {
		const scratch = createScratch()
		const launcher = new StudyLauncher({
			root: scratch.path,
			entry: writeStudyCheckEntry(scratch, STUDY_COMMAND_DURATION + 1),
		})
		try {
			await expect(
				new StudyDeadline({ duration: 15000, label: 'launcher ceiling observation' }).wait(
					launcher.execute(STUDY_EXECUTE_ARGUMENTS),
				),
			).rejects.toThrow(
				'Study execution requires a validated series duration within the 24-hour host ceiling',
			)
			expect(readStudyCommands(scratch)).toEqual(['check files --profile local'])
		} finally {
			await releaseStudyPid(readStudyPid(scratch, STUDY_LAUNCHER_PID))
			scratch.destroy()
		}
	}, 20000)

	it('dispatches execute with the checked fingerprint for a series duration at the host ceiling', async () => {
		const scratch = createScratch()
		const launcher = new StudyLauncher({
			root: scratch.path,
			entry: writeStudyCheckEntry(scratch, STUDY_COMMAND_DURATION),
		})
		try {
			expect(
				await new StudyDeadline({ duration: 15000, label: 'launcher at-ceiling observation' }).wait(
					launcher.execute(STUDY_EXECUTE_ARGUMENTS),
				),
			).toBe(0)
			expect(readStudyCommands(scratch)).toEqual([
				'check files --profile local',
				`execute files --profile local --expected ${STUDY_CHECK_FINGERPRINT}`,
			])
		} finally {
			await releaseStudyPid(readStudyPid(scratch, STUDY_LAUNCHER_PID))
			scratch.destroy()
		}
	}, 20000)

	it('keeps overlapping launches on one launcher apart', async () => {
		const scratch = createScratch()
		const launcher = new StudyLauncher({ root: scratch.path, entry: writeStudyBurstEntry(scratch) })
		const held = launcher.execute(STUDY_HOLD_ARGUMENTS)
		const burst = launcher.execute(STUDY_BURST_ARGUMENTS)
		try {
			const outcomes = await new StudyDeadline({
				duration: 30000,
				label: 'launcher overlapping launches observation',
			}).wait(Promise.allSettled([held, burst]))
			expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected'])
			expect(outcomes[0]).toEqual({ status: 'fulfilled', value: 0 })
			expect(outcomes[1]).toMatchObject({
				status: 'rejected',
				reason: new Error('Study command output exceeds the 16 MiB host allowance'),
			})
		} finally {
			await Promise.allSettled([held, burst])
			scratch.destroy()
		}
	}, 40000)

	it('returns 130 and stops the command when interrupted inside an isolated launcher process', async () => {
		const scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'launcher-interrupt-' })
		try {
			const library = await buildStudyLibrary(scratch, resolve('src/server/index.ts'))
			const entry = writeStudyLauncherEntry(scratch, 20000, '')
			const wrapper = writeStudyInterruptor(scratch, library, entry, STUDY_CHECK_ARGUMENTS)
			const { stdout } = await promisify(execFile)(process.execPath, [wrapper], {
				cwd: scratch.path,
				timeout: 15000,
				windowsHide: true,
			})
			expect(stdout).toBe('130\n')
			expect(readStudyCommands(scratch)).toEqual(['check files --profile local'])
			expect(isRunning(requireValue(readStudyPid(scratch, STUDY_LAUNCHER_PID)))).toBe(false)
		} finally {
			await releaseStudyPid(readStudyPid(scratch, STUDY_LAUNCHER_PID))
			scratch.destroy()
		}
	}, 60000)
})
