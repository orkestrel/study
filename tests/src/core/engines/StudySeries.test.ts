import { waitForCondition } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudySeries } from '../../../../src/core/engines/index.js'
import type { StudyProduct } from '../../../../src/core/types.js'
import {
	buildCompactCustodyManifest,
	buildStudyCapacityManifest,
	createStudyDriverFixture,
	createStudyStoreFixture,
} from '../../../setupStudy.js'

describe('StudySeries', () => {
	it('executes the ordered horizon once and refuses repeated execution before any boundary call', async () => {
		const manifest = buildCompactCustodyManifest()
		const driver = createStudyDriverFixture()
		const custody = createStudyStoreFixture()
		const series = new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		})
		const attempts = await series.execute()
		expect(attempts.map((attempt) => attempt.trial.id)).toEqual(
			manifest.schedule.map((trial) => trial.id),
		)
		expect(attempts.every((attempt) => attempt.failure === undefined)).toBe(true)
		expect(
			attempts.map((attempt) => attempt.observations.map((observation) => observation.goal)),
		).toEqual([
			['write', 'read'],
			['write', 'read'],
		])
		expect(
			attempts.flatMap((attempt) => attempt.observations.map((entry) => entry.product)),
		).toEqual([
			{ value: 'write', partial: false },
			{ value: 'read', partial: false },
			{ value: 'write', partial: false },
			{ value: 'read', partial: false },
		])
		const ids = manifest.schedule.map((trial) => [trial.id])
		expect(driver.opened.calls.map(([trial]) => [trial.id])).toEqual(ids)
		expect(custody.started.calls.map(([trial]) => [trial.id])).toEqual(ids)
		expect(custody.attempts.calls.map(([attempt]) => [attempt.trial.id])).toEqual(ids)
		expect(driver.closed.calls).toEqual(ids)
		expect(driver.executed.calls).toEqual([['write'], ['read'], ['write'], ['read']])
		await expect(series.execute()).rejects.toMatchObject({ code: 'CONFIG' })
		expect(driver.opened.count).toBe(2)
		expect(driver.executed.count).toBe(4)
		expect(driver.closed.count).toBe(2)
		expect(custody.started.count).toBe(2)
		expect(custody.attempts.count).toBe(2)
	})

	it('preserves the declared horizon with interrupted attribution when the parent aborts during execution', async () => {
		const manifest = buildCompactCustodyManifest()
		const parent = new AbortController()
		const gate = Promise.withResolvers<void>()
		const driver = createStudyDriverFixture({
			execute: async (): Promise<StudyProduct> => {
				parent.abort()
				await gate.promise
				return { value: 'late', partial: false }
			},
		})
		const custody = createStudyStoreFixture()
		const task = new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: parent.signal,
		}).execute()
		try {
			const attempts = await task
			expect(attempts.map((attempt) => attempt.trial.id)).toEqual(
				manifest.schedule.map((trial) => trial.id),
			)
			expect(attempts.map((attempt) => attempt.failure?.cause)).toEqual([
				'interrupted',
				'interrupted',
			])
			const [first, second] = attempts
			expect(first?.observations.map((observation) => observation.goal)).toEqual(['write', 'read'])
			expect(first?.observations[0]?.product).toBeUndefined()
			expect(first?.observations[0]?.failure?.cause).toBe('interrupted')
			expect(first?.observations[1]?.product).toBeUndefined()
			expect(first?.observations[1]?.failure?.message).toMatch(/^Goal unexecuted/)
			expect(second?.observations.map((observation) => observation.goal)).toEqual(['write', 'read'])
			expect(
				second?.observations.every(
					(observation) =>
						observation.product === undefined &&
						observation.failure?.cause === 'interrupted' &&
						observation.failure.message.startsWith('Goal unexecuted'),
				),
			).toBe(true)
			expect(driver.executed.calls).toEqual([['write']])
			expect(driver.opened.count).toBe(1)
			expect(driver.closed.calls).toEqual([[manifest.schedule[0]?.id]])
			expect(custody.attempts.count).toBe(2)
		} finally {
			gate.resolve()
			await Promise.allSettled([task])
		}
	})

	it('closes a session that opens after the parent aborted exactly once', async () => {
		const manifest = buildCompactCustodyManifest()
		const parent = new AbortController()
		const opening = Promise.withResolvers<void>()
		const driver = createStudyDriverFixture({ opening: opening.promise })
		const custody = createStudyStoreFixture()
		const task = new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: parent.signal,
		}).execute()
		try {
			await waitForCondition('driver open called', () => driver.opened.count === 1)
			parent.abort()
			opening.resolve()
			const attempts = await task
			expect(attempts).toHaveLength(2)
			expect(attempts.map((attempt) => attempt.failure?.cause)).toEqual([
				'interrupted',
				'interrupted',
			])
			expect(
				attempts.every((attempt) =>
					attempt.observations.every(
						(observation) =>
							observation.product === undefined &&
							observation.failure?.message.startsWith('Goal unexecuted') === true,
					),
				),
			).toBe(true)
			expect(driver.executed.count).toBe(0)
			expect(driver.opened.count).toBe(1)
			expect(driver.closed.calls).toEqual([[manifest.schedule[0]?.id]])
		} finally {
			opening.resolve()
			parent.abort()
			await Promise.allSettled([task])
		}
	})

	it('reports capacity and omits the product when one goal exceeds the goal output limit', async () => {
		const manifest = buildStudyCapacityManifest({
			request: 16,
			goal: 64,
			trial: 4096,
			series: 65536,
		})
		const driver = createStudyDriverFixture({
			execute: async (goal): Promise<StudyProduct> => ({
				value: goal.id === 'write' ? 'ok' : 'x'.repeat(100),
				partial: false,
			}),
		})
		const custody = createStudyStoreFixture()
		const attempts = await new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		}).execute()
		const first = attempts[0]
		expect(first?.observations[0]?.product).toEqual({ value: 'ok', partial: false })
		expect(first?.observations[1]?.product).toBeUndefined()
		expect(first?.observations[1]?.failure?.cause).toBe('capacity')
		expect(first?.failure?.cause).toBe('capacity')
		expect(attempts).toHaveLength(2)
		expect(attempts[1]?.observations.every((entry) => entry.product === undefined)).toBe(true)
		expect(driver.executed.calls).toEqual([['write'], ['read']])
	})

	it('reports capacity and omits the product when cumulative goals exceed the trial output limit', async () => {
		const manifest = buildStudyCapacityManifest({
			request: 16,
			goal: 100,
			trial: 150,
			series: 65536,
		})
		const driver = createStudyDriverFixture({
			execute: async (): Promise<StudyProduct> => ({ value: 'a'.repeat(80), partial: false }),
		})
		const custody = createStudyStoreFixture()
		const attempts = await new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		}).execute()
		const first = attempts[0]
		expect(first?.observations[0]?.product).toEqual({ value: 'a'.repeat(80), partial: false })
		expect(first?.observations[1]?.product).toBeUndefined()
		expect(first?.observations[1]?.failure?.cause).toBe('capacity')
		expect(first?.failure?.cause).toBe('capacity')
		expect(driver.executed.calls).toEqual([['write'], ['read']])
	})

	it('reports capacity and omits the product when cumulative trials exceed the series output limit', async () => {
		const manifest = buildStudyCapacityManifest({
			request: 16,
			goal: 100,
			trial: 200,
			series: 200,
		})
		const driver = createStudyDriverFixture({
			execute: async (): Promise<StudyProduct> => ({ value: 'a'.repeat(80), partial: false }),
		})
		const custody = createStudyStoreFixture()
		const attempts = await new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		}).execute()
		const [first, second] = attempts
		expect(first?.failure).toBeUndefined()
		expect(first?.observations.map((observation) => observation.product)).toEqual([
			{ value: 'a'.repeat(80), partial: false },
			{ value: 'a'.repeat(80), partial: false },
		])
		expect(second?.observations[0]?.product).toBeUndefined()
		expect(second?.observations[0]?.failure?.cause).toBe('capacity')
		expect(second?.failure?.cause).toBe('capacity')
		expect(second?.observations[1]?.product).toBeUndefined()
		expect(second?.observations[1]?.failure?.message).toMatch(/^Goal unexecuted/)
		expect(driver.executed.calls).toEqual([['write'], ['read'], ['write']])
	})
})
