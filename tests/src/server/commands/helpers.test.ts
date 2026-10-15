import { createScratch } from '@orkestrel/test/server'
import { appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	buildCustodyManifest,
	buildStudyRubric,
	buildStudySettingsProfile,
	STUDY_PROFILE_SETTINGS,
} from '../../../setupStudy.js'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { computeStudyProfileDigest } from '../../../../src/server/processes/helpers.js'
import { buildCustodyGrading, retainStudyFixture } from '../../../setupServer.js'
import {
	collectStudyEvidence,
	computeStudyCommandFingerprint,
	computeStudyFixtureDigest,
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
			expect(profile.subject).toBe('subject-v1')
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
})
