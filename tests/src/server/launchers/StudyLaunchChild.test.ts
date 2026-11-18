import { requireValue, waitForCondition, waitForEvent } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { fork } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { StudyLaunchChild } from '../../../../src/server/launchers/StudyLaunchChild.js'
import { STUDY_DRAIN_DURATION } from '../../../../src/server/processes/constants.js'
import {
	readStudyOrphan,
	releaseStudyPid,
	spawnStudyScript,
	writeStudyOrphan,
} from '../../../setupServer.js'

describe('StudyLaunchChild', () => {
	it('captures the stdout of a child that closes and reports its exit code', async () => {
		const result = await new StudyLaunchChild(
			spawnStudyScript("process.stdout.write('captured'); process.exit(4)"),
			10000,
			{ stdout: false, stderr: true },
			new AbortController().signal,
		).execute()
		expect(result).toEqual({ code: 4, stdout: 'captured', stderr: '' })
	})

	it('terminates a child and reports 130 when the signal is already aborted', async () => {
		const controller = new AbortController()
		controller.abort()
		const result = await new StudyLaunchChild(
			spawnStudyScript('setTimeout(() => undefined, 20000)'),
			10000,
			{ stdout: false, stderr: true },
			controller.signal,
		).execute()
		expect(result.code).toBe(130)
	})

	it('terminates a running child and reports 130 when the signal aborts mid-launch', async () => {
		const controller = new AbortController()
		const child = spawnStudyScript('setTimeout(() => undefined, 20000)')
		const launch = new StudyLaunchChild(
			child,
			10000,
			{ stdout: false, stderr: true },
			controller.signal,
		).execute()
		controller.abort()
		// The child must exit on the interruption, well before its own 10 s deadline could end it.
		await waitForCondition(
			'every interrupted child exited',
			() => !isRunning(requireValue(child.pid)),
			{
				budget: 3000,
			},
		)
		expect((await launch).code).toBe(130)
	})

	it('terminates every running child that shares one interruption', async () => {
		const controller = new AbortController()
		const children = [
			spawnStudyScript('setTimeout(() => undefined, 20000)'),
			spawnStudyScript('setTimeout(() => undefined, 20000)'),
		]
		const launches = children.map((child) =>
			new StudyLaunchChild(
				child,
				10000,
				{ stdout: false, stderr: true },
				controller.signal,
			).execute(),
		)
		controller.abort()
		// Every child must exit on the shared interruption, well before its own 10 s deadline could end it.
		await waitForCondition(
			'every interrupted child exited',
			() => children.every((child) => !isRunning(requireValue(child.pid))),
			{ budget: 3000 },
		)
		expect((await Promise.all(launches)).map((result) => result.code)).toEqual([130, 130])
	})

	it('keeps a late child error from changing a settled launch or throwing beside a pending one', async () => {
		const first = spawnStudyScript("process.stdout.write('one')")
		const settled = await new StudyLaunchChild(
			first,
			10000,
			{ stdout: false, stderr: true },
			new AbortController().signal,
		).execute()
		const second = new StudyLaunchChild(
			spawnStudyScript('setTimeout(() => process.exit(5), 300)'),
			10000,
			{ stdout: false, stderr: true },
			new AbortController().signal,
		).execute()
		expect(() => first.emit('error', new Error('late'))).not.toThrow()
		expect(settled).toEqual({ code: 0, stdout: 'one', stderr: '' })
		expect((await second).code).toBe(5)
	})

	it('drains the pipes a descendant of an exited root holds after an interruption, and reports 130', async () => {
		const scratch = createScratch()
		try {
			const child = fork(writeStudyOrphan(scratch, 20000), [], {
				execArgv: [],
				silent: true,
				windowsHide: true,
			})
			const controller = new AbortController()
			const launch = new StudyLaunchChild(
				child,
				20000,
				{ stdout: false, stderr: false },
				controller.signal,
			).execute()
			const exited = waitForEvent(
				(listener: () => void) => {
					child.once('exit', listener)
					return () => {
						child.off('exit', listener)
					}
				},
				'orphan root exit',
				{ budget: 5000 },
			)
			child.send({ start: true })
			await exited
			const receipt = requireValue(readStudyOrphan(scratch))
			controller.abort()
			const result = await new StudyDeadline({
				duration: STUDY_DRAIN_DURATION + 4000,
				label: 'drained interruption observation',
			}).wait(launch)
			expect(result.code).toBe(130)
			expect(isRunning(receipt.root)).toBe(false)
			expect(isRunning(receipt.leaf)).toBe(true)
		} finally {
			await releaseStudyPid(readStudyOrphan(scratch)?.leaf)
			scratch.destroy()
		}
	}, 20000)

	it('refuses to supervise the same child twice', async () => {
		const child = new StudyLaunchChild(
			spawnStudyScript('process.exit(0)'),
			10000,
			{ stdout: false, stderr: true },
			new AbortController().signal,
		)
		const launch = child.execute()
		expect(() => child.execute()).toThrow('Study launch can execute only once')
		expect((await launch).code).toBe(0)
	})
})
