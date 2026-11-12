import { isStudyKeyedSource } from '../../../../src/server/stores/validators.js'
import { STUDY_STOP_CAUSES, STUDY_OTHER_CAUSES } from '../../../setupStudy.js'
import { buildStudyStop, STUDY_INVALID_STOPS } from '../../../setupStudy.js'
import { STUDY_FINITE_MEASUREMENTS } from '../../../setupStudy.js'
import {
	createForeignBudgetError,
	buildStudyExchangeHistory,
	buildOllamaDeclaration,
	STUDY_SELECTION_MALFORMED_SEEDS,
	STUDY_SELECTION_SEED,
} from '../../../setupServer.js'
import { readStudyFailure, translateStudyAgentStop } from '../../../../src/core/index.js'
import { buildStudySchedule } from '../../../../src/core/helpers.js'
import { isStudyProcessFailure } from '../../../../src/server/processes/validators.js'
import type { StudyFailure, StudyObservation } from '../../../../src/core/types.js'
import { isRecord } from '@orkestrel/contract'
import { createRecorder, requireValue } from '@orkestrel/test'
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
	isStudyAncestor,
	isStudyExchangeAncestor,
	isStudyExchangeDeclaration,
	isStudySelection,
} from '../../../../src/server/stores/validators.js'

describe('custody validators', () => {
	it('validates replay ancestry and requires native and content identities in sealed manifests', () => {
		const manifest = buildCustodyManifest()
		const history = buildStudyExchangeHistory()
		const ancestor = { result: manifest.id, seal: history.seal, identity: manifest.identity }
		const exchange = { ...ancestor, file: history.file, prefix: history.completion.count }
		expect(isStudyAncestor(ancestor)).toBe(true)
		expect(isStudyExchangeAncestor(exchange)).toBe(true)
		expect(isStudyCustodyManifest({ ...manifest, ancestor })).toBe(true)
		expect(isStudyExchangeDeclaration({ ...buildOllamaDeclaration(), ancestor: exchange })).toBe(
			true,
		)
		expect(isStudyAncestor({ ...ancestor, seal: 'invalid' })).toBe(false)
		expect(
			isStudyAncestor({ ...ancestor, identity: { ...ancestor.identity, runtime: undefined } }),
		).toBe(false)
		expect(
			isStudyAncestor({ ...ancestor, identity: { ...ancestor.identity, content: undefined } }),
		).toBe(false)
		expect(isStudyExchangeAncestor({ ...exchange, prefix: 0 })).toBe(false)
		expect(
			isStudyExchangeAncestor({ ...exchange, file: { ...history.file, digest: 'invalid' } }),
		).toBe(false)
		expect(
			isStudyCustodyManifest({
				...manifest,
				identity: { ...manifest.identity, content: undefined },
			}),
		).toBe(false)
		expect(
			isStudyExchangeDeclaration({
				...buildOllamaDeclaration(),
				ancestor: { ...exchange, prefix: 0 },
			}),
		).toBe(false)
		const revoked = Proxy.revocable(ancestor, {})
		revoked.revoke()
		expect(isStudyAncestor(revoked.proxy)).toBe(false)
		expect(isStudyExchangeAncestor(revoked.proxy)).toBe(false)
	})
	it('admits a declaration that names no serving version and refuses one that carries a version key', () => {
		const declaration = buildOllamaDeclaration()
		expect(declaration).not.toHaveProperty('version')
		expect(isStudyExchangeDeclaration(declaration)).toBe(true)
		expect(isStudyExchangeDeclaration({ ...declaration, version: '0.40.3' })).toBe(false)
	})
	it('retains finite foreign readings unchanged through IPC and custody', () => {
		for (const max of STUDY_FINITE_MEASUREMENTS) {
			for (const consumed of STUDY_FINITE_MEASUREMENTS) {
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

describe('custody selection', () => {
	it('checks a selection exactly and refuses one without a selector or with a malformed member', () => {
		const range = { first: 'read', last: 'read' }
		expect(isStudySelection({ trial: 'r1-s1-a1', goals: range, seed: STUDY_SELECTION_SEED })).toBe(
			true,
		)
		expect(isStudySelection({ trial: undefined, goals: range, seed: undefined })).toBe(true)
		expect(isStudySelection({ seed: STUDY_SELECTION_SEED })).toBe(true)
		expect(isStudySelection({})).toBe(false)
		expect(isStudySelection({ trial: undefined, goals: undefined, seed: undefined })).toBe(false)
		expect(isStudySelection({ trial: 'con' })).toBe(false)
		expect(isStudySelection({ goals: { first: 'read' } })).toBe(false)
		expect(isStudySelection({ goals: { ...range, extra: true } })).toBe(false)
		expect(isStudySelection({ trial: 'r1-s1-a1', typo: true })).toBe(false)
		expect(isStudySelection(null)).toBe(false)
		for (const seed of STUDY_SELECTION_MALFORMED_SEEDS)
			expect(isStudySelection({ trial: 'r1-s1-a1', seed })).toBe(false)
	})

	it('accepts a selected manifest and refuses a full schedule, an absent trial, goals outside the range, and a malformed seed', () => {
		const manifest = buildCustodyManifest()
		const trial = requireValue(manifest.schedule.find((entry) => entry.id === 'r1-s1-a2'))
		const selection = { trial: trial.id, goals: undefined, seed: STUDY_SELECTION_SEED }
		const selected = { ...manifest, schedule: [trial], selection }
		expect(isStudyCustodyManifest(selected)).toBe(true)
		expect(isStudyCustodyManifest(decodeStudyJSON(encodeStudyJSON(selected)))).toBe(true)
		expect(isStudyCustodyManifest({ ...manifest, selection })).toBe(false)
		expect(
			isStudyCustodyManifest({ ...selected, selection: { ...selection, trial: 'r9-s1-a9' } }),
		).toBe(false)
		for (const seed of STUDY_SELECTION_MALFORMED_SEEDS)
			expect(isStudyCustodyManifest({ ...selected, selection: { ...selection, seed } })).toBe(false)
		const range = { first: 'read', last: 'read' }
		const projected = manifest.scenarios.map((scenario) => ({
			...scenario,
			goals: scenario.goals.filter((goal) => goal.id === 'read'),
		}))
		const ranged = {
			...manifest,
			scenarios: projected,
			schedule: buildStudySchedule(manifest.definition, projected),
			selection: { trial: undefined, goals: range, seed: undefined },
		}
		expect(isStudyCustodyManifest(ranged)).toBe(true)
		expect(isStudyCustodyManifest({ ...ranged, scenarios: manifest.scenarios })).toBe(false)
		const partial = [requireValue(projected[0]), requireValue(manifest.scenarios[1])]
		const narrowed = {
			...manifest,
			scenarios: partial,
			schedule: [trial],
			selection: { trial: trial.id, goals: range, seed: undefined },
		}
		expect(isStudyCustodyManifest(narrowed)).toBe(true)
		expect(
			isStudyCustodyManifest({
				...narrowed,
				selection: { ...narrowed.selection, goals: { first: 'write', last: 'read' } },
			}),
		).toBe(false)
	})
})

describe('isStudyKeyedSource', () => {
	it('holds a sealed source to the keyed role rule', () => {
		const { identity } = buildCustodyManifest()
		const source = { result: 'r', seal: 'd'.repeat(64), identity, roles: ['judge'], offline: false }
		expect(isStudyKeyedSource(source)).toBe(true)
		expect(isStudyKeyedSource({ ...source, roles: ['metadata'], offline: true })).toBe(true)
		for (const invalid of [
			{},
			{ ...source, seal: 'short' },
			{ ...source, roles: ['tool'] },
			{ ...source, roles: ['maintenance'] },
			{ ...source, roles: ['metadata'] },
			{ ...source, offline: 'false' },
			{ ...source, extra: 1 },
		])
			expect(isStudyKeyedSource(invalid)).toBe(false)
	})
})
