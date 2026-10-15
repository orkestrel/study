import { describe, expect, it } from 'vitest'
import {
	buildCompactCustodyManifest,
	buildCustodyAttempt,
	buildCustodyManifest,
	buildStudyCapacityManifest,
	buildStudyProfile,
	buildStudySettingsProfile,
	createStudyDriverFixture,
	createStudyMeterFixture,
	createStudyStoreFixture,
	STUDY_PROFILE_SETTINGS,
} from './setupStudy.js'

describe('study boundary fixtures', () => {
	it('opens a fresh session per call and records every driver boundary call', async () => {
		const fixture = createStudyDriverFixture()
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		const goal = manifest.scenarios[0]?.goals[0]
		if (trial === undefined || goal === undefined) throw new Error('Missing fixture declaration')
		const signal = new AbortController().signal
		const first = await fixture.driver.open(trial, signal)
		const second = await fixture.driver.open(trial, signal)
		expect(first).not.toBe(second)
		expect(fixture.opened.calls).toEqual([[trial], [trial]])
		const meter = createStudyMeterFixture()
		try {
			const evidence = await createStudyStoreFixture().store.start(trial)
			const context = { signal, meter: meter.meter, evidence }
			expect(await first.execute(goal, context)).toEqual({ value: goal.id, partial: false })
		} finally {
			meter.close()
		}
		await first.close()
		expect(fixture.executed.calls).toEqual([[goal.id]])
		expect(fixture.closed.calls).toEqual([[trial.id]])
	})
	it('awaits the supplied opening promise and runs the supplied execution', async () => {
		const resolvers = Promise.withResolvers<void>()
		const fixture = createStudyDriverFixture({
			opening: resolvers.promise,
			execute: async () => ({ value: 'custom', partial: true }),
		})
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		const goal = manifest.scenarios[0]?.goals[0]
		if (trial === undefined || goal === undefined) throw new Error('Missing fixture declaration')
		const signal = new AbortController().signal
		const opening = fixture.driver.open(trial, signal)
		let settled = false
		void opening.then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(fixture.opened.count).toBe(1)
		expect(settled).toBe(false)
		resolvers.resolve()
		const session = await opening
		const meter = createStudyMeterFixture()
		try {
			const evidence = await createStudyStoreFixture().store.start(trial)
			expect(await session.execute(goal, { signal, meter: meter.meter, evidence })).toEqual({
				value: 'custom',
				partial: true,
			})
		} finally {
			meter.close()
		}
		expect(fixture.executed.calls).toEqual([[goal.id]])
	})
	it('records started trials and finished attempts without replicating custody', async () => {
		const fixture = createStudyStoreFixture()
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing fixture trial')
		const sink = await fixture.store.start(trial)
		await expect(sink.append({ event: 'saved', goal: 'write', value: 1 })).resolves.toBeUndefined()
		const attempt = buildCustodyAttempt(manifest, trial)
		await fixture.store.finish(attempt)
		expect(fixture.started.calls).toEqual([[trial]])
		expect(fixture.attempts.calls).toEqual([[attempt]])
	})
})

describe('study meter fixture lifecycle', () => {
	it('owns its primitive lifetimes and closes admission without cancelling completed work', () => {
		const fixture = createStudyMeterFixture()
		fixture.meter
			.admit({ role: 'tool', tokens: 0, bytes: 1 })
			.finish({ role: 'tool', calls: 1, tokens: 0, bytes: 1, duration: 0 })
		fixture.close()
		fixture.close()
		expect(fixture.control.failure).toBeUndefined()
		expect(fixture.meter.usage).toHaveLength(1)
		expect(() => fixture.meter.admit({ role: 'tool', tokens: 0, bytes: 1 })).toThrow(/closed/)
	})
})

describe('study declaration fixtures', () => {
	it('varies byte allowances without changing the compact horizon or sharing caller data', () => {
		const bytes = { request: 16, goal: 64, trial: 4096, series: 65536 }
		const manifest = buildStudyCapacityManifest(bytes)
		bytes.goal = 128
		expect(manifest.bounds).toEqual({
			request: { duration: 1000, calls: 1, tokens: 1000, bytes: 16 },
			goal: { duration: 2000, calls: 2, tokens: 2000, bytes: 64 },
			trial: { duration: 4000, calls: 4, tokens: 4000, bytes: 4096 },
			series: { duration: 32000, calls: 32, tokens: 32000, bytes: 65536 },
		})
		expect(manifest.schedule.map(({ scenario, arm }) => ({ scenario, arm }))).toEqual([
			{ scenario: 'first', arm: 'small' },
			{ scenario: 'second', arm: 'small' },
		])
	})
	it('keeps both scenarios in the compact custody population', () => {
		const manifest = buildCompactCustodyManifest()
		expect(
			manifest.schedule.map(({ scenario, arm, repetition }) => ({ scenario, arm, repetition })),
		).toEqual([
			{ scenario: 'first', arm: 'small', repetition: 0 },
			{ scenario: 'second', arm: 'small', repetition: 0 },
		])
	})
	it('builds independent declarations and terminal horizons from their actual schedule', () => {
		const first = buildCustodyManifest()
		const second = buildCustodyManifest()
		expect(first).not.toBe(second)
		expect(first.bounds).not.toBe(second.bounds)
		const trial = first.schedule[0]
		if (trial === undefined) throw new Error('Missing fixture trial')
		const attempt = buildCustodyAttempt(first, trial)
		expect(attempt.trial).toEqual(trial)
		expect(attempt.observations.map((observation) => observation.goal)).toEqual(['write', 'read'])
		expect(() => buildCustodyAttempt(first, { ...trial, scenario: 'foreign' })).toThrow(
			'no scenario',
		)
	})
	it('builds settings profiles that differ from the base only by their settings', () => {
		const base = buildStudyProfile()
		expect(base.settings).toBeUndefined()
		const distinct = new Set(STUDY_PROFILE_SETTINGS.map((settings) => JSON.stringify(settings)))
		expect(distinct.size).toBe(STUDY_PROFILE_SETTINGS.length)
		for (const settings of STUDY_PROFILE_SETTINGS) {
			const profile = buildStudySettingsProfile(settings)
			expect(profile.settings).toBe(settings)
			expect({ ...profile, settings: undefined }).toEqual(base)
		}
	})
})
