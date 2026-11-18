import type { StudyCharge } from '../../../../src/core/types.js'
import { captureError, waitForAbort } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudyControl } from '../../../../src/core/engines/StudyControl.js'
import { StudyScope } from '../../../../src/core/engines/StudyScope.js'

describe('StudyScope', () => {
	it('refuses an invalid limit at construction', () => {
		const control = new StudyControl()
		try {
			expect(() =>
				Reflect.construct(StudyScope, [
					{ limit: { duration: 1000, calls: -1, tokens: 10, bytes: 10 }, control, label: 'Goal' },
				]),
			).toThrow('Invalid study scope limit')
		} finally {
			control.close()
		}
	})

	it('counts pending reservations against calls, tokens, and bytes before admission', () => {
		const control = new StudyControl()
		const scope = new StudyScope({
			limit: { duration: 1000, calls: 2, tokens: 10, bytes: 100 },
			control,
			label: 'Goal',
		})
		try {
			const charge: StudyCharge = { role: 'agent', tokens: 6, bytes: 10 }
			scope.check(charge)
			scope.reserve(Symbol('first'), charge)
			const error = captureError(() => scope.check(charge))
			expect(error).toMatchObject({ code: 'CAPACITY' })
			expect(control.failure).toEqual({
				cause: 'capacity',
				message: 'Goal allowance cannot admit the request',
				role: 'agent',
				stop: { layer: 'scope', id: 'Goal tokens', max: 10, consumed: 12 },
			})
		} finally {
			scope.close()
			control.close()
		}
	})

	it('names calls before tokens when both allowances refuse', () => {
		const control = new StudyControl()
		const scope = new StudyScope({
			limit: { duration: 1000, calls: 1, tokens: 1, bytes: 100 },
			control,
			label: 'Trial',
		})
		try {
			scope.reserve(Symbol('first'), { role: 'agent', tokens: 1, bytes: 1 })
			expect(captureError(() => scope.check({ role: 'agent', tokens: 1, bytes: 1 }))).toBeDefined()
			expect(control.failure?.stop?.id).toBe('Trial calls')
		} finally {
			scope.close()
			control.close()
		}
	})

	it('settles known usage and keeps the ceiling of an unknown reading', () => {
		const control = new StudyControl()
		const scope = new StudyScope({
			limit: { duration: 1000, calls: 4, tokens: 10, bytes: 100 },
			control,
			label: 'Goal',
		})
		try {
			const first = Symbol('first')
			scope.reserve(first, { role: 'agent', tokens: 6, bytes: 10 })
			scope.settle(first, { role: 'agent', calls: 1, tokens: undefined, duration: 1 })
			expect(captureError(() => scope.check({ role: 'agent', tokens: 5, bytes: 1 }))).toMatchObject(
				{
					code: 'CAPACITY',
				},
			)
			expect(control.failure?.stop).toMatchObject({ id: 'Goal tokens', consumed: 11 })
		} finally {
			scope.close()
			control.close()
		}
	})

	it('commits only the known usage below the reserved ceiling', () => {
		const control = new StudyControl()
		const scope = new StudyScope({
			limit: { duration: 1000, calls: 4, tokens: 10, bytes: 100 },
			control,
			label: 'Goal',
		})
		try {
			const first = Symbol('first')
			scope.reserve(first, { role: 'agent', tokens: 6, bytes: 10 })
			scope.settle(first, { role: 'agent', calls: 1, tokens: 2, bytes: 2, duration: 1 })
			expect(() => scope.check({ role: 'agent', tokens: 8, bytes: 1 })).not.toThrow()
			expect(control.failure).toBeUndefined()
		} finally {
			scope.close()
			control.close()
		}
	})

	it('refuses a duplicate reservation and a settlement that is not pending', () => {
		const control = new StudyControl()
		const scope = new StudyScope({
			limit: { duration: 1000, calls: 4, tokens: 10, bytes: 100 },
			control,
			label: 'Goal',
		})
		try {
			const first = Symbol('first')
			scope.reserve(first, { role: 'agent', tokens: 1, bytes: 1 })
			expect(() => scope.reserve(first, { role: 'agent', tokens: 1, bytes: 1 })).toThrow(
				'Duplicate study reservation',
			)
			expect(() =>
				scope.settle(Symbol('other'), {
					role: 'agent',
					calls: 1,
					tokens: 1,
					bytes: 1,
					duration: 1,
				}),
			).toThrow('Study reservation is not pending')
		} finally {
			scope.close()
			control.close()
		}
	})

	it('refuses admission after the owner failed and after close', () => {
		const control = new StudyControl()
		const scope = new StudyScope({
			limit: { duration: 1000, calls: 4, tokens: 10, bytes: 100 },
			control,
			label: 'Goal',
		})
		try {
			scope.close()
			expect(() => scope.check()).toThrow('Study scope is closed')
			const owner = new StudyControl()
			const open = new StudyScope({
				limit: { duration: 1000, calls: 4, tokens: 10, bytes: 100 },
				control: owner,
				label: 'Goal',
			})
			owner.fail({ cause: 'capacity', message: 'Series bytes', role: 'tool', stop: undefined })
			expect(captureError(() => open.check())).toMatchObject({
				code: 'CAPACITY',
				context: { message: 'Series bytes' },
			})
			open.close()
			owner.close()
		} finally {
			control.close()
		}
	})

	it('fails the owner with its labelled duration stop when the deadline expires', async () => {
		const control = new StudyControl()
		const scope = new StudyScope({
			limit: { duration: 20, calls: 4, tokens: 10, bytes: 100 },
			control,
			label: 'Trial',
		})
		try {
			await waitForAbort(control.signal)
			expect(control.failure).toMatchObject({
				cause: 'deadline',
				message: 'Trial deadline expired',
				stop: { layer: 'scope', id: 'Trial duration', max: 20 },
			})
		} finally {
			scope.close()
			control.close()
		}
	})
})
