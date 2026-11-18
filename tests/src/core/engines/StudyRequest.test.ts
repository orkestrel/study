import type { StudyUsage } from '../../../../src/core/types.js'
import { captureError, createRecorder, waitForAbort } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudyControl } from '../../../../src/core/engines/StudyControl.js'
import { StudyRequest } from '../../../../src/core/engines/StudyRequest.js'

describe('StudyRequest', () => {
	it('settles once with a frozen copy of the measured usage', () => {
		const control = new StudyControl()
		const settled = createRecorder<readonly [StudyUsage]>()
		const request = new StudyRequest({
			charge: { role: 'agent', tokens: 10, bytes: 10 },
			duration: 1000,
			control,
			settle: settled.handler,
		})
		try {
			const usage: StudyUsage = { role: 'agent', calls: 1, tokens: 8, bytes: 6, duration: 5 }
			expect(request.settled).toBe(false)
			request.finish(usage)
			expect(request.settled).toBe(true)
			expect(settled.calls).toEqual([[usage]])
			expect(settled.calls[0]?.[0]).not.toBe(usage)
			expect(Object.isFrozen(settled.calls[0]?.[0])).toBe(true)
			expect(control.failure).toBeUndefined()
		} finally {
			control.close()
		}
	})

	it('refuses a repeated settlement and latches it as an infrastructure failure', () => {
		const control = new StudyControl()
		const settled = createRecorder<readonly [StudyUsage]>()
		const request = new StudyRequest({
			charge: { role: 'agent', tokens: 10, bytes: 10 },
			duration: 1000,
			control,
			settle: settled.handler,
		})
		try {
			request.finish({ role: 'agent', calls: 1, tokens: 8, bytes: 6, duration: 5 })
			expect(() =>
				request.finish({ role: 'agent', calls: 1, tokens: 8, bytes: 6, duration: 5 }),
			).toThrow('Request settlement is late or repeated')
			expect(settled.count).toBe(1)
			expect(control.failure).toMatchObject({ cause: 'infrastructure', role: 'agent' })
		} finally {
			control.close()
		}
	})

	it('fails misattributed usage under the charge role and settles conservatively', () => {
		const control = new StudyControl()
		const settled = createRecorder<readonly [StudyUsage]>()
		const request = new StudyRequest({
			charge: { role: 'judge', tokens: 10, bytes: 10 },
			duration: 1000,
			control,
			settle: settled.handler,
		})
		try {
			const error = captureError(() =>
				request.finish({ role: 'agent', calls: 1, tokens: 8, bytes: 6, duration: 5 }),
			)
			expect(error).toMatchObject({ code: 'FAULT', context: { role: 'judge' } })
			expect(control.failure?.message).toBe('Request usage is invalid or misattributed')
			expect(settled.calls[0]?.[0]).toMatchObject({ role: 'judge', tokens: undefined })
		} finally {
			control.close()
		}
	})

	it('settles usage beyond its admitted tokens and then refuses it as capacity', () => {
		const control = new StudyControl()
		const settled = createRecorder<readonly [StudyUsage]>()
		const request = new StudyRequest({
			charge: { role: 'agent', tokens: 10, bytes: 10 },
			duration: 1000,
			control,
			settle: settled.handler,
		})
		try {
			const error = captureError(() =>
				request.finish({ role: 'agent', calls: 1, tokens: 12, bytes: 6, duration: 5 }),
			)
			expect(error).toMatchObject({ code: 'CAPACITY' })
			expect(settled.calls[0]?.[0]).toMatchObject({ tokens: 12 })
			expect(control.failure?.stop).toEqual({
				layer: 'scope',
				id: 'Admitted tokens',
				max: 10,
				consumed: 12,
			})
		} finally {
			control.close()
		}
	})

	it('records unknown cost on failure and attributes the charge role when the failure names none', () => {
		const control = new StudyControl()
		const settled = createRecorder<readonly [StudyUsage]>()
		const request = new StudyRequest({
			charge: { role: 'tool', tokens: 10, bytes: 10 },
			duration: 1000,
			control,
			settle: settled.handler,
		})
		try {
			request.fail({
				cause: 'infrastructure',
				message: 'Socket closed',
				role: undefined,
				stop: undefined,
			})
			expect(settled.calls[0]?.[0]).toMatchObject({
				role: 'tool',
				calls: 1,
				tokens: undefined,
				bytes: undefined,
			})
			expect(control.failure).toMatchObject({ message: 'Socket closed', role: 'tool' })
		} finally {
			control.close()
		}
	})

	it('settles with the owner failure when the owner fails first', () => {
		const control = new StudyControl()
		const settled = createRecorder<readonly [StudyUsage]>()
		const request = new StudyRequest({
			charge: { role: 'agent', tokens: 10, bytes: 10 },
			duration: 1000,
			control,
			settle: settled.handler,
		})
		try {
			control.fail({ cause: 'capacity', message: 'Goal bytes', role: 'agent', stop: undefined })
			expect(request.signal.aborted).toBe(true)
			expect(request.settled).toBe(true)
			expect(settled.count).toBe(1)
			expect(control.failure?.message).toBe('Goal bytes')
		} finally {
			control.close()
		}
	})

	it('fails with a request duration stop when its deadline expires before settlement', async () => {
		const control = new StudyControl()
		const settled = createRecorder<readonly [StudyUsage]>()
		const request = new StudyRequest({
			charge: { role: 'agent', tokens: 10, bytes: 10 },
			duration: 20,
			control,
			settle: settled.handler,
		})
		try {
			await waitForAbort(request.signal)
			expect(request.settled).toBe(true)
			expect(control.failure).toMatchObject({
				cause: 'deadline',
				role: 'agent',
				stop: { layer: 'scope', id: 'Request duration', max: 20 },
			})
		} finally {
			control.close()
		}
	})
})
