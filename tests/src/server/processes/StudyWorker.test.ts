import { createStudyScratch } from '../../../setupServer.js'
import { isRunning } from '@orkestrel/test/server'
import { requireValue } from '@orkestrel/test'
import { parseJSON } from '@orkestrel/contract'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	buildStudyCLI,
	buildStudyRecordedSessionOptions,
	createStudyConsumer,
	createStudyWorker,
	readStudySelectionOpens,
	retainStudyExchangeFixture,
	writeStudySelectionConsumer,
	STUDY_WORKER_IDENTITIES,
} from '../../../setupServer.js'
import {
	buildStudyExchangeDeclaration,
	computeStudyProfileDigest,
	valueToWire,
} from '../../../../src/server/processes/helpers.js'
import { StudyArtifactLoader } from '../../../../src/server/processes/StudyArtifactLoader.js'
import { StudyProcessDriver } from '../../../../src/server/processes/StudyProcessDriver.js'
import { resolveStudyProfile } from '../../../../src/server/commands/helpers.js'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { readStudyExchanges, readStudyResult } from '../../../../src/server/stores/helpers.js'
import { hashStudyBytes } from '../../../../src/server/helpers.js'

describe('StudyWorker', () => {
	it('F2 refuses a profile-mismatched declaration through its own parent channel before creating a sink', async () => {
		const scratch = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
		try {
			const entry = await buildStudyCLI(scratch)
			const options = buildStudyRecordedSessionOptions(scratch, entry, new AbortController().signal)
			const destination = requireValue(options.exchanges?.[options.trial.id])
			const worker = createStudyWorker(entry)
			try {
				await expect(
					worker.channel.request(
						'open',
						valueToWire({
							...options,
							signal: undefined,
							exchanges: {
								[options.trial.id]: {
									...destination,
									declaration: { ...destination.declaration, version: 'other-version' },
								},
							},
						}),
					),
				).rejects.toMatchObject({
					code: 'FAULT',
					message: 'Recording declaration differs from the executing profile or trial',
				})
				expect(scratch.has('exchanges.jsonl')).toBe(false)
			} finally {
				await worker.close()
			}
			expect(isRunning(requireValue(worker.child.pid))).toBe(false)
		} finally {
			scratch.destroy()
		}
	}, 60000)

	it('F2 rechecks replay runtime and continuation content through its own parent channel', async () => {
		const scratch = createStudyScratch(resolve('tmp/units'), 'orkestrel-test-')
		try {
			const entry = await buildStudyCLI(scratch)
			const retained = await retainStudyExchangeFixture(
				join(scratch.path, 'ancestor'),
				'complete',
				true,
				true,
				true,
			)
			await retained.store.seal()
			const result = await readStudyResult(retained.directory)
			if (result.status !== 'sealed') throw new Error('Missing sealed worker ancestor')
			const trial = requireValue(result.manifest.schedule[0])
			const history = await readStudyExchanges(result, trial.id)
			const options = buildStudyRecordedSessionOptions(scratch, entry, new AbortController().signal)
			const profile = {
				...options.profile,
				settings: {
					version: history.declaration.version,
					metadata: { ...history.declaration.metadata },
				},
			}
			const prefix = history.exchanges.findIndex(({ attempt }) => attempt.stage === 'postflight')
			expect(prefix).toBeGreaterThan(0)
			const scenario = requireValue(
				result.manifest.scenarios.find((candidate) => candidate.id === trial.scenario),
			)
			const ancestor = {
				result: result.manifest.id,
				seal: result.seal.id,
				identity: result.manifest.identity,
				file: history.file,
				prefix,
			}
			for (const member of STUDY_WORKER_IDENTITIES) {
				const continuation = member === 'content'
				const declaration = buildStudyExchangeDeclaration(
					profile,
					trial,
					{
						...scenario,
						goals: continuation
							? [...scenario.goals, { id: 'later', input: 'continue' }]
							: scenario.goals,
					},
					false,
					{ ...ancestor, prefix: continuation ? prefix : history.completion.count },
				)
				const worker = createStudyWorker(entry)
				try {
					await expect(
						worker.channel.request(
							'open',
							valueToWire({
								...options,
								signal: undefined,
								trial,
								profile,
								identity: {
									...result.manifest.identity,
									[member]: hashStudyBytes(result.manifest.identity[member] + ':changed'),
								},
								exchanges: {
									[trial.id]: { path: join(scratch.path, 'exchanges.jsonl'), declaration },
								},
								replay: {
									result: retained.directory,
									prefix: { [trial.id]: declaration.ancestor?.prefix },
									offline: !continuation,
								},
							}),
						),
					).rejects.toMatchObject({
						code: 'FAULT',
						message: continuation
							? 'Worker continuation identity or boundary changed'
							: 'Worker replay runtime differs from its ancestor',
					})
					expect(scratch.has('exchanges.jsonl')).toBe(false)
				} finally {
					await worker.close()
				}
				expect(isRunning(requireValue(worker.child.pid))).toBe(false)
			}
		} finally {
			scratch.destroy()
		}
	}, 60000)

	it('hands a transported seed to the consumer driver opening and opens fresh without one', async () => {
		const scratch = createStudyConsumer((consumer) =>
			writeStudySelectionConsumer(consumer, ['small']),
		)
		try {
			const entry = await buildStudyCLI(scratch)
			const signal = new AbortController().signal
			const declared = parseJSON(requireValue(scratch.read('studies/segments/profiles/local.json')))
			const profile = resolveStudyProfile(scratch.path, parseStudyProfile(declared))
			const adapter = join(scratch.path, 'studies', 'segments', 'index.ts')
			const loader = new StudyArtifactLoader({ root: scratch.path, entry, profile, adapter })
			const selected = await loader.inspect()
			const driver = new StudyProcessDriver({
				root: scratch.path,
				entry,
				profile,
				adapter,
				driver: 'segments',
				directory: scratch.ensure('trials'),
				identity: {
					...selected,
					fixtures: 'c'.repeat(64),
					profile: computeStudyProfileDigest(profile),
				},
			})
			const trial = { id: 'r1-s1-a1', scenario: 'first', arm: 'small', repetition: 0 }
			const seeded = await driver.open(trial, signal, { trial: 'r1-s1-a1', goal: 'g2' })
			await seeded.close()
			const fresh = await driver.open(trial, signal)
			await fresh.close()
			expect(readStudySelectionOpens(scratch)).toEqual([
				{ trial: 'r1-s1-a1', seed: { trial: 'r1-s1-a1', goal: 'g2' } },
				{ trial: 'r1-s1-a1', seed: null },
			])
		} finally {
			scratch.destroy()
		}
	}, 120000)
})
