import type { StudyFailure, StudyStop } from '../../../../src/core/types.js'
import { captureError, waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudyControl } from '../../../../src/core/engines/StudyControl.js'
import { isStudyError } from '../../../../src/core/errors.js'

describe('StudyControl', () => {
	it('latches the first failure as a frozen copy and aborts with its coded error', () => {
		const control = new StudyControl()
		const stop: StudyStop = { layer: 'scope', id: 'Goal tokens', max: 10, consumed: 12 }
		const failure: StudyFailure = { cause: 'capacity', message: 'Goal tokens', role: 'agent', stop }
		try {
			control.fail(failure)
			control.fail({ cause: 'deadline', message: 'Late', role: 'judge', stop: undefined })
			expect(control.failure).toEqual(failure)
			expect(control.failure).not.toBe(failure)
			expect(Object.isFrozen(control.failure)).toBe(true)
			expect(Object.isFrozen(control.failure?.stop)).toBe(true)
			expect(control.failure?.stop).not.toBe(stop)
			expect(control.signal.aborted).toBe(true)
			const reason: unknown = control.signal.reason
			expect(isStudyError(reason) && reason.code).toBe('CAPACITY')
			expect(isStudyError(reason) && reason.context).toEqual(failure)
		} finally {
			control.close()
		}
	})

	it('resolves work that settles first and rejects pending work with the retained failure', async () => {
		const control = new StudyControl()
		try {
			expect(await control.wait(Promise.resolve('opened'))).toBe('opened')
			const pending = control.wait(new Promise<never>(() => undefined))
			control.fail({
				cause: 'deadline',
				message: 'Trial deadline',
				role: undefined,
				stop: undefined,
			})
			await expect(pending).rejects.toMatchObject({
				code: 'DEADLINE',
				context: { cause: 'deadline', message: 'Trial deadline' },
			})
			await expect(control.wait(Promise.resolve('late'))).rejects.toMatchObject({
				code: 'DEADLINE',
			})
		} finally {
			control.close()
		}
	})

	it('passes the work rejection through before cancellation', async () => {
		const control = new StudyControl()
		try {
			const refused = new Error('Driver refused')
			await expect(control.wait(Promise.reject(refused))).rejects.toBe(refused)
			expect(control.failure).toBeUndefined()
		} finally {
			control.close()
		}
	})

	it('attributes parent cancellation as an interruption, before and after construction', () => {
		const early = new AbortController()
		early.abort()
		const opened = new StudyControl(early.signal)
		const parent = new AbortController()
		const linked = new StudyControl(parent.signal)
		try {
			expect(opened.failure).toEqual({
				cause: 'interrupted',
				message: 'Study interrupted by parent cancellation',
				role: undefined,
				stop: undefined,
			})
			expect(linked.failure).toBeUndefined()
			parent.abort()
			expect(linked.failure?.cause).toBe('interrupted')
			expect(linked.signal.aborted).toBe(true)
		} finally {
			opened.close()
			linked.close()
		}
	})

	it('keeps an earlier failure when the parent cancels afterwards', () => {
		const parent = new AbortController()
		const control = new StudyControl(parent.signal)
		try {
			control.fail({ cause: 'capacity', message: 'Series bytes', role: 'tool', stop: undefined })
			parent.abort()
			expect(control.failure?.cause).toBe('capacity')
			expect(control.failure?.role).toBe('tool')
		} finally {
			control.close()
		}
	})

	it('stops reading parent cancellation after close and keeps the retained failure', async () => {
		const parent = new AbortController()
		const control = new StudyControl(parent.signal)
		control.close()
		parent.abort()
		await waitForDelay(0)
		expect(control.failure).toBeUndefined()
		expect(captureError(() => control.close())).toBeUndefined()
	})
})
