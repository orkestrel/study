import type { StudyFailure } from '../../../../src/core/types.js'
import { createScratch, supportsFileLinks } from '@orkestrel/test/server'
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
	buildStudyDefinition,
	buildStudyScenario,
	buildStudySettingsProfile,
	STUDY_PROFILE_SETTINGS,
	STUDY_LINKED_DECLARATIONS,
} from '../../../setupStudy.js'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { computeStudyProfileDigest } from '../../../../src/server/processes/helpers.js'
import {
	buildCustodyGrading,
	createStudyConsumer,
	buildStudyReportResult,
	retainStudyFixture,
	ARTIFACT_CLOSURE_FILES,
	buildArtifactClosureOptions,
} from '../../../setupServer.js'
import {
	collectStudyEvidence,
	computeStudyCommandFingerprint,
	computeStudyFixtureDigest,
	computeStudyPartition,
	computeStudyReport,
	computeStudyAttributions,
	resolveStudyPath,
	resolveStudyProfile,
	readStudyDeclaration,
	readStudyDeclarationBytes,
	readStudyClosure,
	resolveStudyClosurePath,
} from '../../../../src/server/commands/helpers.js'
import { encodeStudyJSON, hashStudyBytes } from '../../../../src/server/helpers.js'
import { buildStudyProfile } from '../../../setupStudy.js'
import { buildStudyStop } from '../../../setupStudy.js'
import { isStudyCustodyAttempt } from '../../../../src/server/stores/validators.js'
import { readStudyBytes } from '../../../../src/server/stores/helpers.js'
import { STUDY_CAUSES, STUDY_ROLES, STUDY_LAYERS } from '../../../../src/core/constants.js'
import { ArtifactLoader } from '../../../../src/server/artifacts/ArtifactLoader.js'

it('reads an exact published forest and relocates original and active profile paths', async () => {
	const scratch = createScratch({ files: ARTIFACT_CLOSURE_FILES })
	try {
		const closure = await new ArtifactLoader(buildArtifactClosureOptions(scratch)).materialize(
			join(scratch.path, 'copy'),
		)
		const entry = closure.options.entries[0]
		if (entry === undefined) throw new Error('Missing relocated entry')
		const identity = buildCustodyManifest().identity
		const publication = {
			closure,
			root: closure.destination,
			entry,
			target: 'assessment',
			profile: 'local',
			source: identity,
			identity,
			fingerprint: '0'.repeat(64),
		}
		await writeFile(join(closure.destination, 'closure.json'), encodeStudyJSON(publication))
		expect(readStudyClosure(closure.destination)).toEqual(publication)
		expect(resolveStudyClosurePath(closure.destination, 'dist/index.js', closure)).toBe(entry)
		expect(
			resolveStudyClosurePath(
				closure.destination,
				join(scratch.path, 'subject', 'dist', 'index.js'),
				closure,
			),
		).toBe(entry)
		expect(resolveStudyClosurePath(scratch.path, 'plain')).toBe(join(scratch.path, 'plain'))
		await writeFile(join(closure.destination, 'extra.txt'), 'extra')
		expect(() => readStudyClosure(closure.destination)).toThrow(/membership/)
	} finally {
		scratch.destroy()
	}
})

describe('study command helpers', () => {
	for (const { path, directory, declaration } of STUDY_LINKED_DECLARATIONS) {
		// File links require a privilege that directory junctions do not require on Windows.
		it.skipIf(!directory && !supportsFileLinks())(
			`refuses a linked declaration as invalid input: ${path}`,
			async () => {
				const scratch = createStudyConsumer()
				const outside = createScratch()
				try {
					await expect(readStudyDeclaration(scratch.path, 'assessment')).resolves.toHaveProperty(
						'definition.name',
						'assessment',
					)
					const target = directory
						? outside.ensure('declaration')
						: outside.write('declaration', 'not declaration JSON')
					scratch.remove(path)
					scratch.link(path, target)
					await expect(readStudyDeclaration(scratch.path, 'assessment')).rejects.toMatchObject({
						code: 'CONFIG',
						message: `Declaration path is linked: ${path}`,
					})
					await expect(
						readStudyDeclarationBytes(scratch.path, join(scratch.path, declaration)),
					).rejects.toMatchObject({
						code: 'CONFIG',
						message: `Declaration path is linked: ${path}`,
					})
					await expect(readStudyBytes(join(scratch.path, declaration), 1024)).rejects.toMatchObject(
						{
							code: 'CUSTODY',
						},
					)
					expect(outside.names()).toEqual(['declaration'])
					expect(directory ? outside.names('declaration') : outside.read('declaration')).toEqual(
						directory ? [] : 'not declaration JSON',
					)
					expect(scratch.has('tmp')).toBe(false)
					expect(scratch.has('imports.log')).toBe(false)
				} finally {
					// Remove the link before destroying either owned scratch directory.
					scratch.remove(path)
					scratch.destroy()
					outside.destroy()
				}
			},
		)
	}

	it('refuses a rubric reached through a junction as invalid input', async () => {
		const scratch = createStudyConsumer()
		const outside = createScratch()
		try {
			const original = await readStudyDeclaration(scratch.path, 'assessment')
			scratch.write(
				'studies/assessment/study.json',
				JSON.stringify({ ...original.definition, rubric: 'criteria/rubric.json' }),
			)
			const target = outside.ensure('criteria')
			scratch.link('studies/assessment/criteria', target)
			await expect(readStudyDeclaration(scratch.path, 'assessment')).rejects.toMatchObject({
				code: 'CONFIG',
				message: 'Declaration path is linked: studies/assessment/criteria',
			})
			expect(outside.names('criteria')).toEqual([])
			expect(scratch.has('tmp')).toBe(false)
		} finally {
			scratch.remove('studies/assessment/criteria')
			scratch.destroy()
			outside.destroy()
		}
	})

	it('reads the declared rubric and ordered scenario bytes with bundle-relative fixture identities', async () => {
		const scratch = createScratch()
		try {
			const definition = buildStudyDefinition({
				rubric: 'criteria.json',
				scenarios: ['second', 'first'],
			})
			const rubric = buildStudyRubric()
			scratch.write('studies/study/study.json', JSON.stringify(definition))
			scratch.write('studies/study/criteria.json', JSON.stringify(rubric))
			scratch.write('studies/study/rubric.json', JSON.stringify({ ...rubric, version: 'decoy' }))
			const scenarios = definition.scenarios.map((id) => buildStudyScenario(id))
			const fixtures = scenarios.map((scenario) => {
				const text = ` ${JSON.stringify(scenario)}\n`
				scratch.write(`studies/memory/scenarios/${scenario.id}.json`, text)
				return { path: `scenarios/${scenario.id}.json`, digest: hashStudyBytes(text) }
			})
			const declaration = await readStudyDeclaration(scratch.path, 'study')
			expect(declaration).toEqual({
				definition,
				scenarios,
				fixtures,
				rubric,
				bundle: join(scratch.path, 'studies', 'memory'),
			})
			expect(
				Buffer.from(
					await readStudyDeclarationBytes(
						scratch.path,
						join(scratch.path, 'studies/study/criteria.json'),
					),
				).toString(),
			).toBe(JSON.stringify(rubric))
			expect(scratch.has('studies/memory/profiles')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a declaration whose name differs from the selected directory', async () => {
		const scratch = createScratch()
		try {
			scratch.write(
				'studies/study/study.json',
				JSON.stringify(buildStudyDefinition({ name: 'different' })),
			)
			await expect(readStudyDeclaration(scratch.path, 'study')).rejects.toMatchObject({
				code: 'CONFIG',
				message: 'Study name differs from its selected directory',
			})
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a scenario whose id differs from the declared selector', async () => {
		const scratch = createScratch()
		try {
			scratch.write('studies/study/study.json', JSON.stringify(buildStudyDefinition()))
			scratch.write(
				'studies/memory/scenarios/first.json',
				JSON.stringify(buildStudyScenario('different')),
			)
			await expect(readStudyDeclaration(scratch.path, 'study')).rejects.toMatchObject({
				code: 'CONFIG',
				message: 'Scenario identity is incompatible',
			})
		} finally {
			scratch.destroy()
		}
	})

	it('refuses an aborted declaration read before admitting a scenario', async () => {
		const scratch = createScratch()
		try {
			scratch.write('studies/study/study.json', JSON.stringify(buildStudyDefinition()))
			const controller = new AbortController()
			const reason = new Error('Declaration cancelled')
			controller.abort(reason)
			await expect(readStudyDeclaration(scratch.path, 'study', controller.signal)).rejects.toBe(
				reason,
			)
		} finally {
			scratch.destroy()
		}
	})

	it('retains custody refusals for existing declaration directories', async () => {
		const scratch = createScratch()
		try {
			const directory = scratch.ensure('declaration.json')
			await expect(readStudyDeclarationBytes(scratch.path, directory)).rejects.toMatchObject({
				code: 'CUSTODY',
			})
		} finally {
			scratch.destroy()
		}
	})
	it('orders attribution groups by cause role and layer and keeps source order within each group', () => {
		const sources = STUDY_CAUSES.flatMap((cause) =>
			[...STUDY_ROLES, undefined].flatMap((role) =>
				[...STUDY_LAYERS, undefined].map((layer) => ({
					trial: `${cause}-${role}-${layer}`,
					goal: undefined,
					failure: {
						cause,
						role,
						message: 'Stopped',
						stop: layer === undefined ? undefined : buildStudyStop({ layer }),
					},
					executed: true,
				})),
			),
		)
		const groups = computeStudyAttributions([...sources].reverse())
		expect(groups).toEqual(
			sources.map((source) => ({
				cause: source.failure.cause,
				role: source.failure.role ?? null,
				layer: source.failure.stop?.layer ?? null,
				executed: 1,
				unexecuted: 0,
				readings:
					source.failure.stop === undefined
						? []
						: [{ trial: source.trial, id: 'num_predict', max: 8, consumed: 9 }],
			})),
		)
		const failure = {
			cause: 'capacity',
			role: 'summary',
			message: 'Capped',
			stop: buildStudyStop({ max: undefined, consumed: undefined }),
		} as const
		expect(
			computeStudyAttributions([
				{ trial: 'second', goal: 'write', failure, executed: false },
				{ trial: 'first', goal: 'read', failure, executed: true },
			]),
		).toEqual([
			{
				cause: 'capacity',
				role: 'summary',
				layer: 'model',
				executed: 1,
				unexecuted: 1,
				readings: [
					{ trial: 'second', goal: 'write', id: 'num_predict', max: null, consumed: null },
					{ trial: 'first', goal: 'read', id: 'num_predict', max: null, consumed: null },
				],
			},
		])
		expect(computeStudyAttributions([])).toEqual([])
	})

	it('reads a legacy attempt without a stop and reports null layer without inventing a reading', () => {
		const manifest = buildCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing trial')
		const failure = {
			cause: 'capacity',
			message: 'Substantive generation reached its output cap',
			role: 'summary',
		}
		const legacy: unknown = {
			trial,
			executed: true,
			duration: 1,
			failure,
			observations: [
				{ goal: 'write', executed: true, duration: 1, failure, usage: [] },
				{ goal: 'read', executed: false, duration: 0, failure, usage: [] },
			],
		}
		expect(isStudyCustodyAttempt(legacy, manifest)).toBe(true)
		if (!isStudyCustodyAttempt(legacy, manifest)) throw new Error('Legacy attempt refused')
		const result = buildStudyReportResult([legacy], manifest)
		const report = computeStudyReport(
			result,
			buildStudyRubric(),
			buildCustodyGrading(result, buildStudyRubric()),
		)
		expect(report).toMatchObject({
			operations: {
				trials: {
					faults: expect.arrayContaining([{ cause: 'capacity', executed: 1, unexecuted: 0 }]),
					attributions: [
						{
							cause: 'capacity',
							role: 'summary',
							layer: null,
							executed: 1,
							unexecuted: 0,
							readings: [],
						},
					],
				},
				goals: {
					faults: expect.arrayContaining([{ cause: 'capacity', executed: 1, unexecuted: 1 }]),
					attributions: [
						{
							cause: 'capacity',
							role: 'summary',
							layer: null,
							executed: 1,
							unexecuted: 1,
							readings: [],
						},
					],
				},
			},
		})
	})
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
		expect(report.operations).toMatchObject({
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
			stop: undefined,
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
		expect(report.operations).toMatchObject({
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
