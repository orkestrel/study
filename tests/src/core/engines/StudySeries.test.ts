import type { StudyFailure, StudyProduct } from '../../../../src/core/types.js'
import { createRecorder, waitForCondition } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudySeries } from '../../../../src/core/engines/index.js'
import { StudyError } from '../../../../src/core/errors.js'
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
			attempts.map((attempt) => [
				attempt.executed,
				attempt.observations.map((observation) => observation.executed),
			]),
		).toEqual([
			[true, [true, true]],
			[true, [true, true]],
		])
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

	it('propagates an attached content failure through the horizon without retry and keeps settled usage', async () => {
		const manifest = buildCompactCustodyManifest()
		const refused: StudyFailure = {
			cause: 'content',
			message: 'Summary content was unusable',
			role: 'summary',
		}
		const driver = createStudyDriverFixture({
			execute: async (_goal, context): Promise<StudyProduct> => {
				const ticket = await context.meter.admit({ role: 'summary', tokens: 10, bytes: 10 })
				ticket.finish({ role: 'summary', calls: 1, tokens: 7, bytes: 9, duration: 1 })
				throw new StudyError('FAULT', refused.message, refused)
			},
		})
		const custody = createStudyStoreFixture()
		const attempts = await new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		}).execute()
		expect(attempts.map((attempt) => attempt.trial.id)).toEqual(
			manifest.schedule.map((trial) => trial.id),
		)
		const [first, second] = attempts
		expect(first?.executed).toBe(true)
		expect(first?.failure).toEqual(refused)
		expect(
			first?.observations.map((observation) => [observation.goal, observation.executed]),
		).toEqual([
			['write', true],
			['read', false],
		])
		expect(first?.observations[0]?.failure).toEqual(refused)
		expect(first?.observations[0]?.product).toBeUndefined()
		expect(first?.observations[0]?.usage).toMatchObject([
			{ role: 'summary', calls: 1, tokens: 7, bytes: 9 },
		])
		expect(first?.observations[1]?.failure).toEqual({
			...refused,
			message: `Goal unexecuted: ${refused.message}`,
		})
		expect(first?.observations[1]?.usage).toEqual([])
		expect(second?.executed).toBe(false)
		expect(second?.failure).toEqual(refused)
		expect(second?.observations.map((observation) => observation.executed)).toEqual([false, false])
		expect(
			second?.observations.every(
				(observation) =>
					observation.product === undefined &&
					observation.failure?.cause === 'content' &&
					observation.failure.role === 'summary' &&
					observation.failure.message === `Goal unexecuted: ${refused.message}`,
			),
		).toBe(true)
		expect(driver.opened.count).toBe(1)
		expect(driver.executed.calls).toEqual([['write']])
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
			expect(first?.executed).toBe(true)
			expect(first?.observations.map((observation) => observation.executed)).toEqual([true, false])
			expect(second?.executed).toBe(false)
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
			expect(attempts.map((attempt) => attempt.executed)).toEqual([true, false])
			expect(
				attempts.every((attempt) =>
					attempt.observations.every((observation) => observation.executed === false),
				),
			).toBe(true)
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

	it('records execution that returns a product without any metered request as executed with empty usage', async () => {
		const manifest = buildCompactCustodyManifest()
		const driver = createStudyDriverFixture()
		const custody = createStudyStoreFixture()
		const attempts = await new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		}).execute()
		const observations = attempts.flatMap((attempt) => attempt.observations)
		expect(observations).toHaveLength(4)
		for (const observation of observations) {
			expect(observation.executed).toBe(true)
			expect(observation.usage).toEqual([])
			expect(observation.product).toEqual({ value: observation.goal, partial: false })
			expect(observation.failure).toBeUndefined()
		}
	})

	it('separates an attempted goal fault from the unexecuted remainder and from the later trial that inherits it', async () => {
		const manifest = buildCompactCustodyManifest()
		const driver = createStudyDriverFixture({
			execute: async (): Promise<StudyProduct> => {
				throw new Error('Driver fault')
			},
		})
		const custody = createStudyStoreFixture()
		const [first, second, ...rest] = await new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		}).execute()
		expect(rest).toEqual([])
		expect(first?.executed).toBe(true)
		expect(first?.failure).toEqual({
			cause: 'infrastructure',
			message: 'Driver fault',
			role: undefined,
		})
		expect(first?.observations.map((observation) => observation.executed)).toEqual([true, false])
		expect(first?.observations[0]).toMatchObject({
			product: undefined,
			failure: { cause: 'infrastructure', message: 'Driver fault' },
		})
		expect(first?.observations[1]).toMatchObject({
			product: undefined,
			usage: [],
			duration: 0,
			failure: { cause: 'infrastructure', message: 'Goal unexecuted: Driver fault' },
		})
		expect(second?.executed).toBe(false)
		expect(second?.observations.map((observation) => observation.executed)).toEqual([false, false])
		expect(driver.executed.calls).toEqual([['write']])
		expect(driver.opened.count).toBe(1)
	})

	it('records an open fault as an executed trial with no executed goal and cascades the later trial', async () => {
		const manifest = buildCompactCustodyManifest()
		const driver = createStudyDriverFixture({ refuse: new Error('Open refused') })
		const custody = createStudyStoreFixture()
		const attempts = await new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		}).execute()
		const [first, second] = attempts
		expect(attempts).toHaveLength(2)
		expect(first?.executed).toBe(true)
		expect(first?.failure?.cause).toBe('infrastructure')
		expect(first?.observations.map((observation) => observation.executed)).toEqual([false, false])
		expect(second?.executed).toBe(false)
		expect(second?.observations.map((observation) => observation.executed)).toEqual([false, false])
		expect(driver.opened.count).toBe(1)
		expect(driver.executed.count).toBe(0)
		expect(driver.closed.count).toBe(0)
		expect(custody.started.count).toBe(2)
		expect(custody.attempts.count).toBe(2)
	})

	it('keeps the product of a goal that finishes after its deadline and leaves the rest unexecuted', async () => {
		const baseline = buildStudyCapacityManifest({
			request: 16,
			goal: 64,
			trial: 4096,
			series: 65536,
		})
		const manifest = {
			...baseline,
			bounds: {
				...baseline.bounds,
				request: { ...baseline.bounds.request, duration: 25 },
				goal: { ...baseline.bounds.goal, duration: 50 },
			},
		}
		const waits = createRecorder<[number]>()
		// The synchronous wait outlasts the goal duration before any timer can fire.
		const driver = createStudyDriverFixture({
			execute: async (): Promise<StudyProduct> => {
				const started = performance.now()
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
				waits.handler(performance.now() - started)
				return { value: 'ok', partial: false }
			},
		})
		const custody = createStudyStoreFixture()
		const [first, second] = await new StudySeries({
			manifest,
			driver: driver.driver,
			store: custody.store,
			signal: new AbortController().signal,
		}).execute()
		expect(waits.calls.map(([wait]) => wait >= manifest.bounds.goal.duration)).toEqual([true])
		expect(first?.executed).toBe(true)
		expect(first?.failure?.cause).toBe('deadline')
		expect(first?.observations.map((observation) => observation.executed)).toEqual([true, false])
		expect(first?.observations[0]?.product).toEqual({ value: 'ok', partial: false })
		expect(first?.observations[0]?.failure?.cause).toBe('deadline')
		expect(second?.executed).toBe(false)
		expect(second?.observations.map((observation) => observation.executed)).toEqual([false, false])
		expect(driver.executed.calls).toEqual([['write']])
	})
})
