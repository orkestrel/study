import { STUDY_STOP_CAUSES, STUDY_OTHER_CAUSES } from '../../../setupStudy.js'
import { buildStudyStop, STUDY_INVALID_STOPS } from '../../../setupStudy.js'
import { STUDY_FINITE_READINGS } from '../../../setupStudy.js'
import { createForeignBudgetError } from '../../../setupServer.js'
import { readStudyFailure, translateStudyAgentStop } from '../../../../src/core/index.js'
import { isStudyProcessFailure } from '../../../../src/server/processes/validators.js'
import type { StudyFailure, StudyObservation } from '../../../../src/core/types.js'
import { isRecord } from '@orkestrel/contract'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	buildCompactCustodyManifest,
	buildCustodyAttempt,
	buildCustodyManifest,
	buildStudyFailure,
	buildStudyObservation,
	buildStudySparse,
	STUDY_EXECUTION_CASES,
} from '../../../setupStudy.js'
import { decodeStudyJSON, encodeStudyJSON } from '../../../../src/server/helpers.js'
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
	it('retains finite foreign readings unchanged through IPC and custody', () => {
		for (const max of STUDY_FINITE_READINGS) {
			for (const consumed of STUDY_FINITE_READINGS) {
				const stop = buildStudyStop({ layer: 'budget', id: 'foreign', max, consumed })
				for (const error of [
					translateStudyAgentStop(stop),
					createForeignBudgetError({ id: stop.id, max, consumed }),
				]) {
					const failure = readStudyFailure(error)
					expect(failure.cause).toBe('capacity')
					expect(failure.stop).toEqual(stop)
					expect({
						custody: isStudyCustodyFailure(failure),
						ipc: isStudyProcessFailure(failure),
					}).toEqual({ custody: true, ipc: true })
					expect(failure.stop).toEqual(stop)
				}
			}
		}
	})

	it('contains hostile reads and rejects descriptors without evaluating their accessors', () => {
		const manifest = buildCustodyManifest()
		expect(
			isStudyCustodyManifest(
				new Proxy(manifest, {
					get() {
						throw new Error('Hostile manifest read')
					},
				}),
			),
		).toBe(false)
		const reads = createRecorder<[]>()
		const evidence = Object.defineProperty({ goal: 'write', value: true }, 'event', {
			enumerable: true,
			get() {
				reads.handler()
				return 'saved'
			},
		})
		expect(isStudyCustodyEvidence(evidence)).toBe(false)
		expect(reads.calls).toEqual([])
		expect(
			isStudyCustodyEvidence({
				event: 'saved',
				goal: 'write',
				value: true,
				[Symbol('extra')]: true,
			}),
		).toBe(false)
		const revoked = Proxy.revocable(manifest, {})
		revoked.revoke()
		expect(isStudyCustodyManifest(revoked.proxy)).toBe(false)
	})

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
		expect(
			isStudyCustodyManifest({
				...manifest,
				identity: { ...manifest.identity, agent: 'unknown' },
			}),
		).toBe(false)
		const { agent, ...unselected } = manifest.identity
		expect(agent).toMatch(/^[a-f0-9]{64}$/)
		expect(isStudyCustodyManifest({ ...manifest, identity: unselected })).toBe(false)
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
		const refused: StudyFailure = {
			cause: 'content',
			message: 'Summary content was unusable',
			role: 'summary',
			stop: undefined,
		}
		expect(isStudyCustodyFailure(refused)).toBe(true)
		expect(isStudyCustodyFailure({ ...refused, cause: 'Content' })).toBe(false)
		const sealed = {
			...attempt,
			failure: refused,
			observations: [
				buildStudyObservation('write', true, { product: undefined, failure: refused }),
				buildStudyObservation('read', false),
			],
		}
		expect(isStudyCustodyAttempt(sealed, manifest)).toBe(true)
		expect(
			isStudyCustodyAttempt({ ...sealed, failure: { ...refused, cause: 'decoder' } }, manifest),
		).toBe(false)
		expect(isStudyCustodyFailure({ cause: 'capacity', message: '', role: undefined })).toBe(false)
		expect(isStudyCustodyFailure({ cause: 'capacity', message: 'Full', role: 'tool' })).toBe(true)
		expect(isStudyCustodyFailure({ cause: 'capacity', message: 'Full', role: 'foreign' })).toBe(
			false,
		)
		expect(isStudyCustodyObservation({ goal: 'write', usage: [], duration: 0 })).toBe(false)
		expect(isStudyCustodyObservation({ ...attempt.observations[0], duration: Number.NaN })).toBe(
			false,
		)
	})

	it.each(STUDY_EXECUTION_CASES)('reads execution facts: $name', ({ valid, attempt }) => {
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing trial')
		const record = { ...buildCustodyAttempt(manifest, trial), ...attempt }
		expect(isStudyCustodyAttempt(record, manifest)).toBe(valid)
		// An undefined member leaves the record once it crosses custody bytes and must read the same.
		expect(isStudyCustodyAttempt(decodeStudyJSON(encodeStudyJSON(record)), manifest)).toBe(valid)
	})

	it('refuses an observation hole behind a failed executed goal as it refuses one anywhere else', () => {
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing trial')
		const attempt = buildCustodyAttempt(manifest, trial)
		const failure = buildStudyFailure()
		const failed = buildStudyObservation('write', true, { product: undefined, failure })
		const record = { ...attempt, failure }
		// The dense record with the same first goal is lawful, so only the hole decides.
		expect(
			isStudyCustodyAttempt(
				{ ...record, observations: [failed, buildStudyObservation('read', false)] },
				manifest,
			),
		).toBe(true)
		expect(
			isStudyCustodyAttempt(
				{ ...record, observations: buildStudySparse(2, [[0, failed]]) },
				manifest,
			),
		).toBe(false)
		expect(
			isStudyCustodyAttempt(
				{
					...record,
					observations: buildStudySparse(2, [[1, buildStudyObservation('read', false)]]),
				},
				manifest,
			),
		).toBe(false)
	})

	it('serializes every required execution fact and reads the bytes back', () => {
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing trial')
		const current = buildCustodyAttempt(manifest, trial)
		const decoded = decodeStudyJSON(encodeStudyJSON(current))
		expect(isStudyCustodyAttempt(decoded, manifest)).toBe(true)
		expect(isRecord(decoded) && decoded.executed).toBe(true)
		expect(isStudyCustodyAttempt({ ...current, executed: 1 }, manifest)).toBe(false)
	})

	it('reads each observation fact on its own terms', () => {
		const dispatched = buildStudyObservation('write', true, { duration: 0, usage: [] })
		const usage = { role: 'agent', calls: 1, tokens: 1, bytes: 1, duration: 1 } as const
		expect(isStudyCustodyObservation(dispatched)).toBe(true)
		expect(isStudyCustodyObservation(buildStudyObservation('write', false))).toBe(true)
		expect(isStudyCustodyObservation({ ...dispatched, executed: 'yes' })).toBe(false)
		expect(isStudyCustodyObservation({ ...dispatched, executed: null })).toBe(false)
		expect(isStudyCustodyObservation({ ...dispatched, executed: undefined })).toBe(false)
		const changes: ReadonlyArray<Partial<StudyObservation>> = [
			{ product: { value: 'late', partial: false } },
			{ usage: [usage] },
			{ duration: 1 },
			{ failure: undefined },
		]
		for (const change of changes)
			expect(isStudyCustodyObservation(buildStudyObservation('write', false, change))).toBe(false)
	})

	it('refuses a manifest that carries a foreign format member', () => {
		const manifest = buildCustodyManifest()
		expect(isStudyCustodyManifest(manifest)).toBe(true)
		expect(isStudyCustodyManifest({ ...manifest, version: 2 })).toBe(false)
	})

	it('refuses duplicate, escaping, or unknown execution inventory paths', () => {
		const file = { path: 'manifest.json', bytes: 10, digest: 'a'.repeat(64) }
		expect(isStudyCustodyFile(file)).toBe(true)
		expect(isStudyCustodyFile({ ...file, path: 'trials/con/attempt.json' })).toBe(false)
		expect(isStudyCustodyFile({ ...file, path: '../manifest.json' })).toBe(false)
		expect(isStudyCustodyFile({ ...file, path: 'arbitrary.json' })).toBe(false)
		expect(isStudyCustodySeal({ result: 'execution', id: 'b'.repeat(64), files: [file] })).toBe(
			true,
		)
		expect(
			isStudyCustodySeal({ result: 'execution', id: 'b'.repeat(64), files: [file, file] }),
		).toBe(false)
		expect(
			isStudyCustodySeal({ version: 1, result: 'execution', id: 'b'.repeat(64), files: [file] }),
		).toBe(false)
	})
})

it('admits legacy failures and capacity or deadline stops while refusing foreign keys and causes', () => {
	const stop = buildStudyStop()
	for (const cause of STUDY_STOP_CAUSES)
		expect(isStudyCustodyFailure({ cause, message: 'Capped', stop })).toBe(true)
	expect(isStudyCustodyFailure({ cause: 'capacity', message: 'Capped', role: 'summary' })).toBe(
		true,
	)
	expect(isStudyCustodyFailure({ cause: 'capacity', message: 'Capped', stop, extra: true })).toBe(
		false,
	)
	for (const cause of STUDY_OTHER_CAUSES)
		expect(isStudyCustodyFailure({ cause, message: 'Capped', stop })).toBe(false)
	for (const invalid of STUDY_INVALID_STOPS)
		expect(isStudyCustodyFailure({ cause: 'capacity', message: 'Capped', stop: invalid })).toBe(
			false,
		)
})
