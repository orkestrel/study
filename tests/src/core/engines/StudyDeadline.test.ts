import { waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudyControl, StudyDeadline } from '../../../../src/core/engines/index.js'

describe('StudyDeadline', () => {
	it('returns the identical result and releases its deadline timer', async () => {
		const deadline = new StudyDeadline({ duration: 1000, label: 'Custody or cleanup' })
		const result = { closed: true }
		const work = Promise.withResolvers<{ closed: boolean }>()
		const before = process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length
		const pending = deadline.wait(work.promise)
		const during = process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length
		work.resolve(result)
		expect(await pending).toBe(result)
		expect(during).toBe(before + 1)
		expect(process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length).toBe(
			before,
		)
	})

	it('rejects with the original work rejection rather than a translated failure', async () => {
		const error = new Error('Cleanup refused')
		await expect(
			new StudyDeadline({ duration: 1000, label: 'Process lifecycle' }).wait(Promise.reject(error)),
		).rejects.toBe(error)
	})

	it('attributes expiry to the exact caller label and observes a late rejection', async () => {
		for (const label of ['Custody or cleanup', 'Process lifecycle']) {
			const late = waitForDelay(30).then(() => {
				throw new Error('Late rejection')
			})
			await expect(new StudyDeadline({ duration: 10, label }).wait(late)).rejects.toMatchObject({
				code: 'DEADLINE',
				failure: { cause: 'deadline', message: `${label} deadline expired`, role: undefined },
			})
			await waitForDelay(40)
		}
	})

	it('bounds cleanup apart from a cancelled caller and isolates every wait', async () => {
		const caller = new StudyControl()
		caller.fail({ cause: 'interrupted', message: 'Series cancelled', role: undefined })
		const deadline = new StudyDeadline({ duration: 30, label: 'Custody or cleanup' })
		try {
			const stalled = deadline.wait(new Promise<never>(() => undefined))
			const concurrent = deadline.wait(waitForDelay(5).then(() => 'closed'))
			expect(await concurrent).toBe('closed')
			await expect(stalled).rejects.toMatchObject({ failure: { cause: 'deadline' } })
			expect(await deadline.wait(Promise.resolve('retried'))).toBe('retried')
			expect(caller.failure?.message).toBe('Series cancelled')
		} finally {
			caller.close()
		}
	})

	it('rejects a nonfinite or out-of-range duration without throwing synchronously', async () => {
		for (const duration of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
			const pending = new StudyDeadline({ duration, label: 'Process lifecycle' }).wait(
				Promise.resolve(true),
			)
			await expect(pending).rejects.toMatchObject({ code: 'CONFIG' })
		}
	})
})
