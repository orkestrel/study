import { requireValue, waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { StudyLaunchChild } from '../../../../src/server/launchers/StudyLaunchChild.js'
import { spawnStudyScript } from '../../../setupServer.js'

describe('StudyLaunchChild', () => {
	it('captures the stdout of a child that closes and reports its exit code', async () => {
		const result = await new StudyLaunchChild(
			spawnStudyScript("process.stdout.write('captured'); process.exit(4)"),
			10000,
			false,
			new AbortController().signal,
		).execute()
		expect(result).toEqual({ code: 4, output: 'captured' })
	})

	it('terminates a child and reports 130 when the signal is already aborted', async () => {
		const controller = new AbortController()
		controller.abort()
		const result = await new StudyLaunchChild(
			spawnStudyScript('setTimeout(() => undefined, 20000)'),
			10000,
			false,
			controller.signal,
		).execute()
		expect(result.code).toBe(130)
	})

	it('terminates a running child and reports 130 when the signal aborts mid-launch', async () => {
		const controller = new AbortController()
		const child = spawnStudyScript('setTimeout(() => undefined, 20000)')
		const running = new StudyLaunchChild(child, 10000, false, controller.signal).execute()
		controller.abort()
		// The child must exit on the interruption, well before its own 10 s deadline could end it.
		await waitForCondition(
			'every interrupted child exited',
			() => !isRunning(requireValue(child.pid)),
			{
				budget: 3000,
			},
		)
		expect((await running).code).toBe(130)
	})

	it('terminates every running child that shares one interruption', async () => {
		const controller = new AbortController()
		const children = [
			spawnStudyScript('setTimeout(() => undefined, 20000)'),
			spawnStudyScript('setTimeout(() => undefined, 20000)'),
		]
		const running = children.map((child) =>
			new StudyLaunchChild(child, 10000, false, controller.signal).execute(),
		)
		controller.abort()
		// Every child must exit on the shared interruption, well before its own 10 s deadline could end it.
		await waitForCondition(
			'every interrupted child exited',
			() => children.every((child) => !isRunning(requireValue(child.pid))),
			{ budget: 3000 },
		)
		expect((await Promise.all(running)).map((result) => result.code)).toEqual([130, 130])
	})

	it('keeps a late child error from changing a settled launch or throwing beside a pending one', async () => {
		const first = spawnStudyScript("process.stdout.write('one')")
		const settled = await new StudyLaunchChild(
			first,
			10000,
			false,
			new AbortController().signal,
		).execute()
		const second = new StudyLaunchChild(
			spawnStudyScript('setTimeout(() => process.exit(5), 300)'),
			10000,
			false,
			new AbortController().signal,
		).execute()
		expect(() => first.emit('error', new Error('late'))).not.toThrow()
		expect(settled).toEqual({ code: 0, output: 'one' })
		expect((await second).code).toBe(5)
	})

	it('refuses to supervise the same child twice', async () => {
		const child = new StudyLaunchChild(
			spawnStudyScript('process.exit(0)'),
			10000,
			false,
			new AbortController().signal,
		)
		const running = child.execute()
		expect(() => child.execute()).toThrow('Study launch can execute only once')
		expect((await running).code).toBe(0)
	})
})
