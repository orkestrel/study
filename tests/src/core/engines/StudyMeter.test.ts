import { waitForAbort, waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { createStudyMeterFixture } from '../../../setupStudy.js'
import { StudyMeter } from '../../../../src/core/engines/index.js'

describe('StudyMeter', () => {
	it('lets the exact final request finish and refuses the next dispatch', () => {
		const fixture = createStudyMeterFixture({
			goal: { duration: 1000, calls: 1, tokens: 10, bytes: 10 },
		})
		try {
			const ticket = fixture.meter.admit({ role: 'agent', tokens: 10, bytes: 10 })
			ticket.finish({ role: 'agent', calls: 1, tokens: 10, bytes: 10, duration: 1 })
			expect(ticket.signal.aborted).toBe(false)
			expect(fixture.control.failure).toBeUndefined()
			expect(() => fixture.meter.admit({ role: 'agent', tokens: 0, bytes: 0 })).toThrow(
				/cannot admit/,
			)
			expect(fixture.control.failure?.cause).toBe('capacity')
		} finally {
			fixture.close()
		}
	})

	it('accounts for pending ceilings and releases only measured unused capacity', () => {
		const fixture = createStudyMeterFixture({
			goal: { duration: 1000, calls: 3, tokens: 10, bytes: 10 },
		})
		try {
			const first = fixture.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			const second = fixture.meter.admit({ role: 'judge', tokens: 2, bytes: 2 })
			first.finish({ role: 'agent', calls: 1, tokens: 1, bytes: 1, duration: 1 })
			const third = fixture.meter.admit({ role: 'summary', tokens: 7, bytes: 7 })
			second.finish({ role: 'judge', calls: 1, tokens: 2, bytes: 2, duration: 1 })
			third.finish({ role: 'summary', calls: 1, tokens: 7, bytes: 7, duration: 1 })
			expect(fixture.meter.usage.map((usage) => [usage.role, usage.tokens])).toEqual([
				['agent', 1],
				['judge', 2],
				['summary', 7],
			])
			expect(fixture.control.failure).toBeUndefined()
		} finally {
			fixture.close()
		}
	})

	it('refuses an overlapping request before dispatch and conservatively settles the interrupted request', () => {
		const fixture = createStudyMeterFixture({
			goal: { duration: 1000, calls: 3, tokens: 10, bytes: 10 },
		})
		try {
			const ticket = fixture.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			expect(() => fixture.meter.admit({ role: 'judge', tokens: 3, bytes: 3 })).toThrow(
				/cannot admit/,
			)
			expect(ticket.signal.aborted).toBe(true)
			expect(fixture.meter.usage).toMatchObject([
				{ calls: 1, tokens: undefined, bytes: undefined, role: 'agent' },
			])
			expect(() => fixture.meter.admit({ role: 'tool', tokens: 0, bytes: 0 })).toThrow(
				/cannot admit/,
			)
		} finally {
			fixture.close()
		}
	})

	it('keeps missing usage unknown and retains its ceilings for subsequent admissions', () => {
		const fixture = createStudyMeterFixture({
			goal: { duration: 1000, calls: 3, tokens: 10, bytes: 10 },
		})
		try {
			const ticket = fixture.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			ticket.finish({ role: 'agent', calls: 1, tokens: undefined, bytes: undefined, duration: 1 })
			expect(fixture.meter.usage[0]?.tokens).toBeUndefined()
			expect(fixture.meter.usage[0]?.bytes).toBeUndefined()
			expect(() => fixture.meter.admit({ role: 'judge', tokens: 3, bytes: 3 })).toThrow(
				/cannot admit/,
			)
		} finally {
			fixture.close()
		}
	})

	it('keeps request failure sticky even when the caller catches settlement errors', () => {
		const fixture = createStudyMeterFixture()
		try {
			const ticket = fixture.meter.admit({ role: 'judge', tokens: 8, bytes: 8 })
			ticket.fail({
				cause: 'infrastructure',
				message: 'Provider refused the request',
				role: 'judge',
			})
			expect(() =>
				ticket.finish({ role: 'judge', calls: 1, tokens: 1, bytes: 1, duration: 1 }),
			).toThrow(/late or repeated/)
			expect(() => fixture.meter.admit({ role: 'agent', tokens: 1, bytes: 1 })).toThrow(
				/Provider refused/,
			)
			expect(fixture.control.failure).toEqual({
				cause: 'infrastructure',
				message: 'Provider refused the request',
				role: 'judge',
			})
		} finally {
			fixture.close()
		}
	})

	it('latches double settlement, excessive measurements, and invalid numeric admission', () => {
		const fixture = createStudyMeterFixture()
		try {
			const ticket = fixture.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			ticket.finish({ role: 'agent', calls: 1, tokens: 1, bytes: 1, duration: 1 })
			expect(() =>
				ticket.finish({ role: 'agent', calls: 1, tokens: 1, bytes: 1, duration: 1 }),
			).toThrow(/late or repeated/)
			expect(fixture.meter.usage).toHaveLength(1)
			expect(fixture.control.failure?.cause).toBe('infrastructure')
		} finally {
			fixture.close()
		}
		for (const amount of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
			const invalid = createStudyMeterFixture()
			try {
				expect(() => invalid.meter.admit({ role: 'agent', tokens: amount, bytes: 0 })).toThrow(
					/safe nonnegative/,
				)
				expect(invalid.meter.usage).toEqual([])
			} finally {
				invalid.close()
			}
		}
		const excessive = createStudyMeterFixture()
		try {
			const ticket = excessive.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			expect(() =>
				ticket.finish({ role: 'agent', calls: 1, tokens: 9, bytes: 8, duration: 1 }),
			).toThrow(/exceeded/)
			expect(excessive.meter.usage[0]?.tokens).toBe(9)
			expect(excessive.control.failure?.cause).toBe('capacity')
		} finally {
			excessive.close()
		}
	})

	it('preserves deadline attribution after cleanup and removes request listeners', async () => {
		const fixture = createStudyMeterFixture({
			request: { duration: 10, calls: 1, tokens: 10, bytes: 10 },
		})
		const ticket = fixture.meter.admit({ role: 'summary', tokens: 8, bytes: 8 })
		await waitForAbort(ticket.signal)
		fixture.close()
		expect(fixture.control.failure).toEqual({
			cause: 'deadline',
			message: 'Request deadline expired',
			role: 'summary',
		})
		expect(fixture.meter.usage).toMatchObject([
			{ role: 'summary', calls: 1, tokens: undefined, bytes: undefined },
		])
		expect(() =>
			ticket.finish({ role: 'summary', calls: 1, tokens: 1, bytes: 1, duration: 1 }),
		).toThrow(/late or repeated/)
		expect(fixture.control.failure?.cause).toBe('deadline')
	})

	it('attributes nested deadlines and refuses goal completion with open tickets', async () => {
		const fixture = createStudyMeterFixture({
			trial: { duration: 10, calls: 4, tokens: 100, bytes: 100 },
		})
		try {
			fixture.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			await waitForAbort(fixture.control.signal)
			expect(fixture.control.failure?.message).toBe('Trial deadline expired')
		} finally {
			fixture.close()
		}
		const open = createStudyMeterFixture()
		open.meter.admit({ role: 'tool', tokens: 0, bytes: 8 })
		open.close()
		expect(open.control.failure?.message).toBe('Goal completed with unsettled requests')
		expect(open.meter.usage).toHaveLength(1)
	})

	it('shares trial capacity across fresh goal meters without sharing goal records', () => {
		const fixture = createStudyMeterFixture({
			trial: { duration: 1000, calls: 1, tokens: 100, bytes: 100 },
		})
		try {
			fixture.meter
				.admit({ role: 'tool', tokens: 0, bytes: 1 })
				.finish({ role: 'tool', calls: 1, tokens: 0, bytes: 1, duration: 0 })
			fixture.meter.close()
			const next = new StudyMeter({
				request: { duration: 1000, calls: 1, tokens: 100, bytes: 100 },
				scopes: fixture.scopes,
				control: fixture.control,
			})
			expect(() => next.admit({ role: 'tool', tokens: 0, bytes: 1 })).toThrow(/Trial allowance/)
			expect(next.usage).toEqual([])
			expect(fixture.meter.usage).toHaveLength(1)
			next.close()
		} finally {
			fixture.close()
		}
	})

	it('races uncooperative work, observes its late rejection, and keeps the first failure', async () => {
		const parent = new AbortController()
		const fixture = createStudyMeterFixture({}, parent.signal)
		const work = waitForDelay(15).then(() => {
			throw new Error('Late rejection')
		})
		const waiting = fixture.control.wait(work)
		parent.abort()
		await expect(waiting).rejects.toMatchObject({ failure: { cause: 'interrupted' } })
		fixture.control.fail({
			cause: 'infrastructure',
			message: 'Cleanup also failed',
			role: undefined,
		})
		fixture.close()
		await waitForDelay(20)
		expect(fixture.control.failure?.cause).toBe('interrupted')
	})
})
