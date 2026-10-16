import type { StudyFailure } from '../../../../src/core/types.js'
import { createScratch } from '@orkestrel/test/server'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRecord } from '@orkestrel/contract'
import {
	buildCustodyManifest,
	buildStudyAttempt,
	buildStudyFailure,
	buildStudyObservation,
	buildStudyOperationAttempts,
	buildStudyRubric,
	buildStudySettingsProfile,
	STUDY_PROFILE_SETTINGS,
} from '../../../setupStudy.js'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { computeStudyProfileDigest } from '../../../../src/server/processes/helpers.js'
import {
	buildCustodyGrading,
	buildStudyReportResult,
	retainStudyFixture,
} from '../../../setupServer.js'
import {
	collectStudyEvidence,
	computeStudyCommandFingerprint,
	computeStudyFixtureDigest,
	computeStudyPartition,
	computeStudyReport,
	resolveStudyPath,
	resolveStudyProfile,
} from '../../../../src/server/commands/helpers.js'
import { encodeStudyJSON, hashStudyBytes } from '../../../../src/server/helpers.js'
import { buildStudyProfile } from '../../../setupStudy.js'

describe('study command helpers', () => {
	it('shares execution fixture identity across display metadata, purpose and rubric changes while binding actual policy and inputs', () => {
		const manifest = buildCustodyManifest()
		const scenarios = manifest.scenarios.map((scenario) => ({
			path: `scenarios/${scenario.id}.json`,
			digest: hashStudyBytes(encodeStudyJSON(scenario)),
		}))
		const first = computeStudyFixtureDigest(manifest.definition, scenarios)
		const renamed = {
			...manifest.definition,
			name: 'capacity',
			version: '2',
			question: 'Another question',
			purpose: 'capacity',
			rubric: 'rubric-v2.json',
		}
		expect(computeStudyFixtureDigest({ ...renamed, purpose: 'capacity' }, scenarios)).toBe(first)
		expect(
			computeStudyFixtureDigest({ ...manifest.definition, driver: 'different' }, scenarios),
		).not.toBe(first)
		expect(
			computeStudyFixtureDigest(
				{ ...manifest.definition, order: [...manifest.definition.order].reverse() },
				scenarios,
			),
		).not.toBe(first)
		expect(
			computeStudyFixtureDigest(
				manifest.definition,
				scenarios.map((entry) => ({ ...entry, digest: 'f'.repeat(64) })),
			),
		).not.toBe(first)
		expect(
			computeStudyCommandFingerprint(manifest.identity, manifest.bounds, manifest.definition),
		).not.toBe(
			computeStudyCommandFingerprint(manifest.identity, manifest.bounds, {
				...manifest.definition,
				question: 'Another question',
			}),
		)
	})
	it('contains portable relative paths and resolves explicit executable profile paths', () => {
		const scratch = createScratch()
		try {
			expect(resolveStudyPath(scratch.path, 'profiles/local.json')).toBe(
				join(scratch.path, 'profiles', 'local.json'),
			)
			expect(() => resolveStudyPath(scratch.path, '../escape')).toThrow('portable')
			expect(() => resolveStudyPath(scratch.path, 'profiles/con.json')).toThrow('portable')
			expect(() => resolveStudyPath(scratch.path, 'profiles\\local.json')).toThrow('portable')
			const profile = buildStudyProfile()
			expect(resolveStudyProfile(scratch.path, profile).subject).toBe(
				join(scratch.path, profile.subject),
			)
			expect(resolveStudyProfile(scratch.path, profile).agent).toBe(
				join(scratch.path, profile.agent),
			)
			expect(profile.subject).toBe('subject-v1')
			expect(profile.agent).toBe('agent-v1')
		} finally {
			scratch.destroy()
		}
	})

	it('changes the execution fingerprint when a deadline or bound artifact identity changes', () => {
		const manifest = buildCustodyManifest()
		const first = computeStudyCommandFingerprint(manifest.identity, manifest.bounds)
		expect(first).toMatch(/^[a-f0-9]{64}$/)
		expect(
			computeStudyCommandFingerprint(
				{ ...manifest.identity, subject: 'f'.repeat(64) },
				manifest.bounds,
			),
		).not.toBe(first)
		expect(
			computeStudyCommandFingerprint(
				{ ...manifest.identity, agent: 'f'.repeat(64) },
				manifest.bounds,
			),
		).not.toBe(first)
		expect(
			computeStudyCommandFingerprint(manifest.identity, {
				...manifest.bounds,
				series: { ...manifest.bounds.series, duration: manifest.bounds.series.duration + 1 },
			}),
		).not.toBe(first)
	})

	it('changes the admitted profile identity and execution fingerprint when only driver settings change', () => {
		const manifest = buildCustodyManifest()
		const root = resolve('study-root')
		const profiles = [
			buildStudyProfile(),
			...STUDY_PROFILE_SETTINGS.map(buildStudySettingsProfile),
			buildStudyProfile(),
		]
		const sealed = profiles.map((profile) => {
			const source = parseStudyProfile(JSON.parse(JSON.stringify(profile)))
			const admitted = resolveStudyProfile(root, source)
			const identity = { ...manifest.identity, profile: computeStudyProfileDigest(admitted) }
			return {
				profile: identity.profile,
				fingerprint: computeStudyCommandFingerprint(identity, admitted.bounds, manifest.definition),
			}
		})
		expect(sealed.pop()).toEqual(sealed[0])
		expect(new Set(sealed.map(({ profile }) => profile)).size).toBe(sealed.length)
		expect(new Set(sealed.map(({ fingerprint }) => fingerprint)).size).toBe(sealed.length)
	})

	it('partitions attempted failures apart from cascaded unexecuted goals and counts completion by product and failure', () => {
		const manifest = buildCustodyManifest()
		const result = buildStudyReportResult(buildStudyOperationAttempts(manifest), manifest)
		const report = computeStudyReport(
			result,
			buildStudyRubric(),
			buildCustodyGrading(result, buildStudyRubric()),
		)
		if (!isRecord(report)) throw new Error('Missing report')
		expect(report.operations).toEqual({
			trials: {
				scheduled: 8,
				terminal: 8,
				executed: 7,
				unexecuted: 1,
				completed: 3,
				faults: [
					{ cause: 'capacity', executed: 1, unexecuted: 0 },
					{ cause: 'infrastructure', executed: 1, unexecuted: 0 },
					{ cause: 'deadline', executed: 1, unexecuted: 0 },
					{ cause: 'interrupted', executed: 0, unexecuted: 1 },
					{ cause: 'content', executed: 0, unexecuted: 0 },
				],
			},
			goals: {
				scheduled: 16,
				executed: 10,
				unexecuted: 6,
				products: 9,
				partial: 1,
				completed: 8,
				faults: [
					{ cause: 'capacity', executed: 1, unexecuted: 1 },
					{ cause: 'infrastructure', executed: 0, unexecuted: 2 },
					{ cause: 'deadline', executed: 0, unexecuted: 1 },
					{ cause: 'interrupted', executed: 0, unexecuted: 2 },
					{ cause: 'content', executed: 0, unexecuted: 0 },
				],
			},
		})
	})

	it('reports a first executed content failure with the goals it leaves unexecuted under the same cause, apart by the executed fact', () => {
		const manifest = buildCustodyManifest()
		const refused: StudyFailure = {
			cause: 'content',
			message: 'Summary content was unusable',
			role: 'summary',
		}
		const attempts = buildStudyOperationAttempts(manifest).map((attempt, index) =>
			index === 0
				? buildStudyAttempt(
						attempt.trial,
						true,
						[
							buildStudyObservation('write', true, { product: undefined, failure: refused }),
							buildStudyObservation('read', false, {
								failure: { ...refused, message: `Goal unexecuted: ${refused.message}` },
							}),
						],
						refused,
					)
				: attempt,
		)
		const result = buildStudyReportResult(attempts, manifest)
		const report = computeStudyReport(
			result,
			buildStudyRubric(),
			buildCustodyGrading(result, buildStudyRubric()),
		)
		if (!isRecord(report) || !isRecord(report.operations)) throw new Error('Missing operations')
		const { trials, goals } = report.operations
		if (!isRecord(trials) || !isRecord(goals)) throw new Error('Missing partitions')
		expect(trials.faults).toContainEqual({ cause: 'content', executed: 1, unexecuted: 0 })
		expect(goals.faults).toContainEqual({ cause: 'content', executed: 1, unexecuted: 1 })
		expect(goals.faults).toContainEqual({ cause: 'interrupted', executed: 0, unexecuted: 2 })
		expect(goals.faults).toContainEqual({ cause: 'infrastructure', executed: 0, unexecuted: 2 })
	})

	it('excludes a product that carries a failure from completion and counts each affected record once per cause', () => {
		const manifest = buildCustodyManifest()
		const late = buildStudyFailure('deadline', 'Late')
		const closing = buildStudyFailure('infrastructure', 'Close failed')
		const attempts = buildStudyOperationAttempts(manifest).map((attempt, index) => {
			if (index === 0)
				return buildStudyAttempt(
					attempt.trial,
					true,
					[
						buildStudyObservation('write', true, { failure: late }),
						buildStudyObservation('read', false, {
							failure: buildStudyFailure('deadline', 'Goal unexecuted: Late'),
						}),
					],
					late,
				)
			// Both goals completed cleanly, then closing the trial failed.
			if (index === 6)
				return buildStudyAttempt(
					attempt.trial,
					true,
					[buildStudyObservation('write', true), buildStudyObservation('read', true)],
					closing,
				)
			return attempt
		})
		const result = buildStudyReportResult(attempts, manifest)
		const report = computeStudyReport(
			result,
			buildStudyRubric(),
			buildCustodyGrading(result, buildStudyRubric()),
		)
		if (!isRecord(report) || !isRecord(report.operations)) throw new Error('Missing operations')
		expect(report.operations).toEqual({
			trials: {
				scheduled: 8,
				terminal: 8,
				executed: 7,
				unexecuted: 1,
				completed: 1,
				faults: [
					{ cause: 'capacity', executed: 1, unexecuted: 0 },
					{ cause: 'infrastructure', executed: 2, unexecuted: 0 },
					{ cause: 'deadline', executed: 2, unexecuted: 0 },
					{ cause: 'interrupted', executed: 0, unexecuted: 1 },
					{ cause: 'content', executed: 0, unexecuted: 0 },
				],
			},
			goals: {
				scheduled: 16,
				executed: 9,
				unexecuted: 7,
				products: 8,
				partial: 1,
				completed: 6,
				faults: [
					{ cause: 'capacity', executed: 1, unexecuted: 1 },
					{ cause: 'infrastructure', executed: 0, unexecuted: 2 },
					{ cause: 'deadline', executed: 1, unexecuted: 2 },
					{ cause: 'interrupted', executed: 0, unexecuted: 2 },
					{ cause: 'content', executed: 0, unexecuted: 0 },
				],
			},
		})
	})

	it('partitions records by their explicit fact without inferring it from product, usage or failure', () => {
		expect(computeStudyPartition([])).toEqual({ executed: 0, unexecuted: 0 })
		const records = [
			buildStudyObservation('write', true, { product: undefined, failure: buildStudyFailure() }),
			buildStudyObservation('write', true),
			buildStudyObservation('write', false),
			buildStudyObservation('write', false, { failure: buildStudyFailure('deadline') }),
		]
		expect(computeStudyPartition(records)).toEqual({ executed: 2, unexecuted: 2 })
		const attempts = buildStudyOperationAttempts(buildCustodyManifest())
		expect(computeStudyPartition(attempts)).toEqual({ executed: 7, unexecuted: 1 })
	})

	it('retains the declared denominator, semantic unknowns, separate repetitions and unknown actual usage', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			const rubric = buildStudyRubric()
			const grading = buildCustodyGrading(result, rubric)
			const report = computeStudyReport(
				{
					...result,
					attempts: result.attempts.map((attempt) => ({
						...attempt,
						observations: attempt.observations.map((observation) => ({
							...observation,
							usage: [
								{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined, duration: 0 },
							],
						})),
					})),
				},
				rubric,
				grading,
			)
			expect(report).toMatchObject({
				population: 'Complete declared trial and criterion horizon',
				scores: [
					{ arm: 'small', total: 8, achieved: 4, unknown: 4, lower: 0.5, upper: 1, coverage: 0.5 },
					{ arm: 'large', total: 8, achieved: 4, unknown: 4 },
				],
				costs: {
					roles: expect.arrayContaining([
						{
							role: 'agent',
							measurements: 16,
							calls: 16,
							duration: 0,
							tokens: { known: 0, unknown: 16 },
							bytes: { known: 0, unknown: 16 },
						},
					]),
				},
				repetitions: [{ repetition: 0 }, { repetition: 1 }],
			})
			const evidence = await collectStudyEvidence(result)
			expect(Object.keys(evidence)).toEqual(result.manifest.schedule.map((trial) => trial.id))
			const trial = result.manifest.schedule[0]
			if (trial === undefined) throw new Error('Missing trial')
			await appendFile(
				join(result.directory, 'execution', 'trials', trial.id, 'evidence.jsonl'),
				' ',
			)
			await expect(collectStudyEvidence(result)).rejects.toMatchObject({ code: 'CUSTODY' })
		} finally {
			scratch.destroy()
		}
	})

	it.each([
		{
			name: 'rewritten under the stale digest',
			sealed: false,
			rewrite: (text: string) => `${text}${text.split('\n')[0] ?? ''}\n`,
			message: 'Evidence changed after execution verification',
		},
		{
			name: 'without a trailing newline under a matching digest',
			sealed: true,
			rewrite: (text: string) => text.slice(0, -1),
			message: 'Evidence is incomplete',
		},
		{
			name: 'with an invalid row under a matching digest',
			sealed: true,
			rewrite: () => '{"event":1}\n',
			message: 'Evidence row is invalid',
		},
	])(
		'refuses sealed evidence $name with a custody failure naming it',
		async ({ sealed, rewrite, message }) => {
			const scratch = createScratch()
			try {
				const result = await retainStudyFixture(join(scratch.path, 'result'))
				const trial = result.manifest.schedule[0]
				if (trial === undefined) throw new Error('Missing trial')
				const path = join(result.directory, 'execution', 'trials', trial.id, 'evidence.jsonl')
				const bytes = Buffer.from(rewrite(await readFile(path, 'utf8')), 'utf8')
				await writeFile(path, bytes)
				const sealPath = `trials/${trial.id}/evidence.jsonl`
				const tampered = sealed
					? {
							...result,
							seal: {
								...result.seal,
								files: result.seal.files.map((file) =>
									file.path === sealPath ? { ...file, digest: hashStudyBytes(bytes) } : file,
								),
							},
						}
					: result
				await expect(collectStudyEvidence(tampered)).rejects.toMatchObject({
					code: 'CUSTODY',
					message,
				})
			} finally {
				scratch.destroy()
			}
		},
	)
})
