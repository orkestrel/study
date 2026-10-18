import { waitForCondition } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { createStudyLeaseFixture } from '../../../setupStudy.js'

describe('StudyTrialLease', () => {
	it('starts custody, opens the scope and session, and closes the session without a cleanup failure', async () => {
		const fixture = createStudyLeaseFixture()
		try {
			expect(fixture.lease.scope).toBeUndefined()
			expect(fixture.lease.evidence).toBeUndefined()
			expect(fixture.lease.session).toBeUndefined()
			await fixture.lease.open()
			expect(fixture.lease.scope).toBeDefined()
			expect(fixture.lease.evidence).toBeDefined()
			expect(fixture.lease.session).toBeDefined()
			expect(fixture.custody.started.calls).toEqual([[fixture.trial]])
			expect(fixture.driver.opened.calls).toEqual([[fixture.trial]])
			expect(await fixture.lease.close()).toBeUndefined()
			expect(fixture.driver.closed.calls).toEqual([[fixture.trial.id]])
			expect(fixture.control.failure).toBeUndefined()
		} finally {
			fixture.close()
		}
	})

	it('returns and latches the failure of a session close', async () => {
		const closing = new Error('Close refused')
		const fixture = createStudyLeaseFixture({ closing })
		try {
			await fixture.lease.open()
			const cleanup = await fixture.lease.close()
			expect(cleanup).toMatchObject({ message: 'Close refused' })
			expect(fixture.control.failure).toEqual(cleanup)
			expect(fixture.driver.closed.count).toBe(1)
		} finally {
			fixture.close()
		}
	})

	it('awaits and closes a session that opens after the parent aborted and reports a differing close failure', async () => {
		const parent = new AbortController()
		const opening = Promise.withResolvers<void>()
		const fixture = createStudyLeaseFixture(
			{ opening: opening.promise, closing: new Error('Late close refused') },
			parent.signal,
		)
		try {
			const pending = fixture.lease.open()
			const settled = pending.then(
				() => undefined,
				(error: unknown) => error,
			)
			await waitForCondition('driver open called', () => fixture.driver.opened.count === 1)
			parent.abort()
			expect(await settled).toMatchObject({ code: 'FAULT' })
			expect(fixture.lease.session).toBeUndefined()
			opening.resolve()
			const cleanup = await fixture.lease.close()
			expect(fixture.driver.closed.count).toBe(1)
			expect(cleanup).toMatchObject({ message: 'Late close refused' })
			expect(fixture.control.failure?.cause).toBe('interrupted')
		} finally {
			opening.resolve()
			fixture.close()
		}
	})

	it('does not report a late opening failure that repeats the latched failure', async () => {
		const fixture = createStudyLeaseFixture({ refuse: new Error('Open refused') })
		try {
			await expect(fixture.lease.open()).rejects.toThrow('Open refused')
			fixture.control.fail({ cause: 'infrastructure', message: 'Open refused', role: undefined })
			expect(await fixture.lease.close()).toBeUndefined()
			expect(fixture.driver.closed.count).toBe(0)
		} finally {
			fixture.close()
		}
	})

	it('starts custody alone when a failure is already latched', async () => {
		const fixture = createStudyLeaseFixture()
		try {
			fixture.control.fail({ cause: 'infrastructure', message: 'Inherited', role: undefined })
			await fixture.lease.open()
			expect(fixture.custody.started.calls).toEqual([[fixture.trial]])
			expect(fixture.lease.evidence).toBeDefined()
			expect(fixture.lease.scope).toBeUndefined()
			expect(fixture.lease.session).toBeUndefined()
			expect(fixture.driver.opened.count).toBe(0)
			expect(await fixture.lease.close()).toBeUndefined()
			expect(fixture.driver.closed.count).toBe(0)
		} finally {
			fixture.close()
		}
	})
})
