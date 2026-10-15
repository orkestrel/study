import { requireValue, waitForCondition } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { StudyTask } from '../../../../src/server/processes/StudyTask.js'
import {
	STUDY_TASK_INSTRUMENT,
	STUDY_TASK_INVALID_DURATIONS,
	STUDY_TASK_RESPONSES,
	STUDY_TASK_STOPS,
	buildStudyTaskOptions,
	buildStudyTaskRequest,
	createStudyTaskFixture,
	readStudyOrphan,
	readStudyPid,
	releaseStudyPid,
	writeStudyOrphan,
} from '../../../setupServer.js'

const request = buildStudyTaskRequest()

describe('StudyTask', () => {
	it('refuses a non-finite, non-positive or excessive deadline before spawning', () => {
		for (const duration of STUDY_TASK_INVALID_DURATIONS) {
			const scratch = createScratch()
			try {
				const fixture = createStudyTaskFixture(scratch, 'valid', duration)
				expect(() => fixture.task.execute(request, new AbortController().signal)).toThrow(
					'Adapter deadline must be finite and at most 60 seconds',
				)
				expect(scratch.has(fixture.pid)).toBe(false)
			} finally {
				scratch.destroy()
			}
		}
	})

	it('verifies the adapter response and stops the child for valid, malformed, repeated and oversized output', async () => {
		for (const { mode, expected } of STUDY_TASK_RESPONSES) {
			const scratch = createScratch()
			let pid: number | undefined
			try {
				const fixture = createStudyTaskFixture(scratch, mode, 5000)
				const result = new StudyDeadline({
					duration: 8000,
					label: 'direct StudyTask response',
				}).wait(fixture.task.execute(request, new AbortController().signal))
				expect(await Promise.allSettled([result])).toMatchObject([
					expected === undefined
						? { status: 'fulfilled', value: { instrument: STUDY_TASK_INSTRUMENT, value: true } }
						: { status: 'rejected', reason: { code: 'FAULT', message: expected } },
				])
				await waitForCondition('StudyTask child recorded its pid', () => scratch.has(fixture.pid), {
					budget: 3000,
					interval: 10,
				})
				pid = requireValue(readStudyPid(scratch, fixture.pid))
				const recorded = pid
				await waitForCondition('recorded StudyTask child stopped', () => !isRunning(recorded), {
					budget: 3000,
					interval: 10,
				})
			} finally {
				await releaseStudyPid(pid)
				scratch.destroy()
			}
		}
	}, 40000)

	it('enforces its deadline and the caller abort with child cleanup', async () => {
		for (const mode of STUDY_TASK_STOPS) {
			const scratch = createScratch()
			const controller = new AbortController()
			let pid: number | undefined
			try {
				const fixture = createStudyTaskFixture(scratch, 'hold', mode === 'deadline' ? 5000 : 30000)
				const result = fixture.task.execute(request, controller.signal)
				const settled = Promise.allSettled([result])
				await waitForCondition('StudyTask child recorded its pid', () => scratch.has(fixture.pid), {
					budget: 4000,
					interval: 10,
				})
				pid = requireValue(readStudyPid(scratch, fixture.pid))
				const recorded = pid
				if (mode === 'abort') controller.abort('caller abort')
				const outcomes = await new StudyDeadline({
					duration: mode === 'deadline' ? 10000 : 4000,
					label: `direct StudyTask ${mode}`,
				}).wait(settled)
				expect(outcomes).toMatchObject([
					{
						status: 'rejected',
						reason:
							mode === 'deadline'
								? { code: 'FAULT', message: 'Adapter deadline exceeded' }
								: 'caller abort',
					},
				])
				await waitForCondition('recorded StudyTask child stopped', () => !isRunning(recorded), {
					budget: 3000,
					interval: 10,
				})
			} finally {
				controller.abort()
				await releaseStudyPid(pid)
				scratch.destroy()
			}
		}
	}, 30000)

	it('rejects an exited root that leaves a detached leaf holding stdout before its deadline', async () => {
		const scratch = createScratch()
		const entry = writeStudyOrphan(scratch, 20000)
		const task = new StudyTask(buildStudyTaskOptions(entry))
		const result = task.execute(request, new AbortController().signal)
		const settled = result.then(
			() => undefined,
			() => undefined,
		)
		try {
			await expect(
				new StudyDeadline({ duration: 4000, label: 'orphaned StudyTask observation' }).wait(result),
			).rejects.toMatchObject({
				code: 'FAULT',
				message: 'Adapter exited without a complete response',
			})
			const receipt = requireValue(readStudyOrphan(scratch))
			expect(isRunning(receipt.root)).toBe(false)
			expect(isRunning(receipt.leaf)).toBe(true)
		} finally {
			await releaseStudyPid(readStudyOrphan(scratch)?.leaf)
			await settled
			scratch.destroy()
		}
	}, 20000)

	it('settles an ordinary exit without a complete response', async () => {
		const scratch = createScratch()
		const entry = scratch.write('exit.cjs', "process.on('message', () => process.exit(0))")
		const task = new StudyTask(buildStudyTaskOptions(entry))
		try {
			await expect(
				new StudyDeadline({ duration: 4000, label: 'ordinary StudyTask exit' }).wait(
					task.execute(request, new AbortController().signal),
				),
			).rejects.toMatchObject({
				code: 'FAULT',
				message: 'Adapter exited without a complete response',
			})
		} finally {
			scratch.destroy()
		}
	}, 10000)
})
