import { describe, expect, it } from 'vitest'
import { buildCustodyAttempt, buildCustodyManifest } from '../../../setupStudy.js'
import {
	isStudyCustodyAttempt,
	isStudyCustodyEvidence,
	isStudyCustodyFailure,
	isStudyCustodyFile,
	isStudyCustodyManifest,
	isStudyCustodyName,
	isStudyCustodyObservation,
	isStudyCustodySeal,
	isStudyCustodyTrial,
} from '../../../../src/server/stores/validators.js'

describe('custody validators', () => {
	it('refuses reserved names and malformed or changed manifest identities', () => {
		const manifest = buildCustodyManifest()
		expect(isStudyCustodyManifest(manifest)).toBe(true)
		expect(isStudyCustodyName('con')).toBe(false)
		expect(isStudyCustodyName('../escape')).toBe(false)
		expect(isStudyCustodyName('r1-s1-a1')).toBe(true)
		expect(
			isStudyCustodyManifest({
				...manifest,
				identity: { ...manifest.identity, subject: 'unknown' },
			}),
		).toBe(false)
		expect(isStudyCustodyManifest({ ...manifest, schedule: [] })).toBe(false)
		expect(isStudyCustodyManifest({ ...manifest, created: 'yesterday' })).toBe(false)
	})

	it('refuses invalid trial, evidence, failure, observation and goal horizon boundaries', () => {
		const manifest = buildCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing trial')
		const attempt = buildCustodyAttempt(manifest, trial)
		expect(isStudyCustodyTrial(trial)).toBe(true)
		expect(isStudyCustodyTrial({ ...trial, repetition: -1 })).toBe(false)
		expect(isStudyCustodyAttempt(attempt, manifest)).toBe(true)
		expect(isStudyCustodyAttempt({ ...attempt, observations: [] }, manifest)).toBe(false)
		expect(
			isStudyCustodyAttempt({ ...attempt, trial: { ...trial, arm: 'foreign' } }, manifest),
		).toBe(false)
		expect(isStudyCustodyEvidence({ event: 'saved', goal: 'write', value: true })).toBe(true)
		expect(isStudyCustodyEvidence({ event: 'saved', goal: 'write', value: new Map() })).toBe(false)
		expect(isStudyCustodyFailure({ cause: 'capacity', message: 'Full', role: undefined })).toBe(
			true,
		)
		expect(isStudyCustodyFailure({ cause: 'success', message: 'Awarded' })).toBe(false)
		expect(isStudyCustodyObservation({ goal: 'write', usage: [], duration: 0 })).toBe(false)
		expect(isStudyCustodyObservation({ ...attempt.observations[0], duration: Number.NaN })).toBe(
			false,
		)
	})

	it('refuses duplicate, escaping, or unknown execution inventory paths', () => {
		const file = { path: 'manifest.json', bytes: 10, digest: 'a'.repeat(64) }
		expect(isStudyCustodyFile(file)).toBe(true)
		expect(isStudyCustodyFile({ ...file, path: 'trials/con/attempt.json' })).toBe(false)
		expect(isStudyCustodyFile({ ...file, path: '../manifest.json' })).toBe(false)
		expect(isStudyCustodyFile({ ...file, path: 'arbitrary.json' })).toBe(false)
		expect(
			isStudyCustodySeal({ version: 1, result: 'execution', id: 'b'.repeat(64), files: [file] }),
		).toBe(true)
		expect(
			isStudyCustodySeal({
				version: 1,
				result: 'execution',
				id: 'b'.repeat(64),
				files: [file, file],
			}),
		).toBe(false)
	})
})
