import { requireValue, waitForCondition } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { STUDY_LOG_BYTES, STUDY_TASK_DURATION } from '../../../../src/server/processes/constants.js'
import { StudyTask } from '../../../../src/server/processes/StudyTask.js'
import {
	buildStudyDefinition,
	buildStudyProfile,
	buildStudyRubric,
	buildStudyScenario,
} from '../../../setupStudy.js'
import {
	STUDY_TASK_INSTRUMENT,
	createStudyTaskFixture,
	readStudyOrphan,
	readStudyPid,
	releaseStudyPid,
	writeStudyOrphan,
} from '../../../setupServer.js'

const request = {
	operation: 'validate' as const,
	input: {
		definition: buildStudyDefinition(),
		scenarios: [buildStudyScenario(), buildStudyScenario('second')],
		rubric: buildStudyRubric(),
		profile: buildStudyProfile(),
	},
}

describe('StudyTask', () => {
	it('refuses a non-finite, non-positive or excessive deadline before spawning', () => {
		for (const duration of [0, STUDY_TASK_DURATION + 1, Number.NaN]) {
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
		const cases = [
			{ mode: 'valid', expected: undefined },
			{ mode: 'malformed', expected: 'Adapter response is malformed' },
			{ mode: 'repeated', expected: 'Adapter response is oversized or repeated' },
			{ mode: 'combined-output', expected: 'Adapter output exceeds the log allowance' },
		] as const
		for (const { mode, expected } of cases) {
			const scratch = createScratch()
			let pid: number | undefined
			try {
				const fixture = createStudyTaskFixture(scratch, mode, 5000)
				const result = new StudyDeadline({ duration: 8000, label: 'direct StudyTask response' }).wait(
					fixture.task.execute(request, new AbortController().signal),
				)
				if (expected === undefined)
					await expect(result).resolves.toEqual({ instrument: STUDY_TASK_INSTRUMENT, value: true })
				else await expect(result).rejects.toMatchObject({ code: 'FAULT', message: expected })
				await waitForCondition('StudyTask child recorded its pid', () => scratch.has(fixture.pid), {
					budget: 3000,
					interval: 10,
				})
				pid = requireValue(readStudyPid(scratch, fixture.pid))
				const recorded = pid
				await waitForCondition(
					'recorded StudyTask child stopped',
					() => !isRunning(recorded),
					{ budget: 3000, interval: 10 },
				)
			} finally {
				await releaseStudyPid(pid)
				scratch.destroy()
			}
		}
		expect(STUDY_LOG_BYTES).toBe(64 * 1024)
	}, 40000)

	it('enforces its deadline and the caller abort with child cleanup', async () => {
		for (const mode of ['deadline', 'abort'] as const) {
			const scratch = createScratch()
			const controller = new AbortController()
			let pid: number | undefined
			try {
				const fixture = createStudyTaskFixture(scratch, 'hold', mode === 'deadline' ? 5000 : 30000)
				const result = fixture.task.execute(request, controller.signal)
				void result.catch(() => undefined)
				await waitForCondition('StudyTask child recorded its pid', () => scratch.has(fixture.pid), {
					budget: 4000,
					interval: 10,
				})
				pid = requireValue(readStudyPid(scratch, fixture.pid))
				const recorded = pid
				if (mode === 'deadline')
					await expect(
						new StudyDeadline({ duration: 10000, label: 'direct StudyTask deadline' }).wait(result),
					).rejects.toMatchObject({ code: 'FAULT', message: 'Adapter deadline exceeded' })
				else {
					controller.abort('caller abort')
					await expect(
						new StudyDeadline({ duration: 4000, label: 'direct StudyTask caller abort' }).wait(
							result,
						),
					).rejects.toBe('caller abort')
				}
				await waitForCondition(
					'recorded StudyTask child stopped',
					() => !isRunning(recorded),
					{ budget: 3000, interval: 10 },
				)
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
		const task = new StudyTask({
			entry,
			root: resolve('.'),
			adapter: entry,
			roots: [],
			duration: 5000,
		})
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
		const task = new StudyTask({
			entry,
			root: resolve('.'),
			adapter: entry,
			roots: [],
			duration: 5000,
		})
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
