import { describe, expect, it } from 'vitest'
import {
	buildCompactCustodyManifest,
	buildCustodyAttempt,
	buildCustodyManifest,
	createStudyMeterFixture,
} from './setupStudy.js'

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
})
