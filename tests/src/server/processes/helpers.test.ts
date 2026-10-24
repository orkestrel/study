import {
	buildStudyProfile,
	buildStudyScenario,
	buildStudyDaemonProvider,
	buildStudySettingsProfile,
	STUDY_PROFILE_SETTINGS,
} from '../../../setupStudy.js'
import {
	createStudyScratch,
	buildOllamaDeclaration,
	buildOllamaStep,
	createStudyPeer,
	readStudyOrphan,
	releaseStudyPid,
	writeStudyOrphan,
	retainStudyExchangeFixture,
} from '../../../setupServer.js'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { readStudyResult, readStudyExchanges } from '../../../../src/server/stores/helpers.js'
import { describe, expect, it } from 'vitest'
import { requireValue, waitForEvent } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { fork } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { parse, resolve } from 'node:path'
import { STUDY_DRAIN_DURATION } from '../../../../src/server/processes/constants.js'
import { isStudyExchangeDeclaration } from '../../../../src/server/stores/validators.js'
import {
	buildStudyExchangeDeclaration,
	computeStudyConfigurationDigest,
	validateStudyRecordingDeclaration,
	collectStudyAncestors,
	collectStudyEntries,
	drainStudyChild,
	computeStudyInstrumentDigest,
	computeStudyProfileDigest,
	createStudyProcessFailure,
	terminateStudyChild,
	valueToWire,
	resolveStudyInstrument,
	readStudyVersion,
	readStudyPreparedDestination,
	validateStudyRuntime,
	readStudyReplayHistory,
} from '../../../../src/server/processes/helpers.js'

describe('process helpers', () => {
	it('rechecks a sealed replay ancestor against its selected file, identity, prefix, and goal horizon', async () => {
		const scratch = createScratch()
		try {
			const fixture = await retainStudyExchangeFixture(resolve(scratch.path, 'result'))
			await fixture.store.seal()
			const result = await readStudyResult(fixture.directory)
			if (result.status !== 'sealed') throw new Error('Missing sealed source')
			const trial = requireValue(result.manifest.schedule[0])
			const history = await readStudyExchanges(result, trial.id)
			const profile = parseStudyProfile({
				...buildStudyProfile(),
				provider: { ...buildStudyDaemonProvider(), daemon: undefined },
				record: history.declaration.record,
				settings: {
					version: history.declaration.version,
					metadata: history.declaration.metadata,
					procedure: history.declaration.procedure,
				},
			})
			const selection = {
				result: fixture.directory,
				prefix: { [trial.id]: history.completion.count },
				offline: true,
			}
			const ancestor = {
				result: result.manifest.id,
				seal: result.seal.id,
				identity: result.manifest.identity,
				file: history.file,
				prefix: history.completion.count,
			}
			const declaration = { ...history.declaration, ancestor }
			expect(await readStudyReplayHistory(selection, profile, trial, declaration)).toEqual(history)
			const prefix = history.exchanges.findIndex(({ attempt }) => attempt.stage === 'postflight')
			expect(
				await readStudyReplayHistory(
					{ ...selection, offline: false, prefix: { [trial.id]: prefix } },
					profile,
					trial,
					{
						...declaration,
						goals: [...declaration.goals, 'later'],
						ancestor: { ...ancestor, prefix },
					},
				),
			).toEqual(history)
			await expect(
				readStudyReplayHistory(selection, profile, trial, history.declaration),
			).rejects.toThrow(/ancestor differs/)
			await expect(
				readStudyReplayHistory(selection, profile, trial, {
					...declaration,
					ancestor: { ...ancestor, prefix: 1 },
				}),
			).rejects.toThrow(/ancestor differs/)
			await expect(
				readStudyReplayHistory(selection, profile, trial, {
					...declaration,
					ancestor: { ...ancestor, file: { ...history.file, digest: 'f'.repeat(64) } },
				}),
			).rejects.toThrow(/ancestor differs/)
			await expect(
				readStudyReplayHistory(selection, profile, trial, {
					...declaration,
					ancestor: { ...ancestor, identity: { ...ancestor.identity, content: 'e'.repeat(64) } },
				}),
			).rejects.toThrow(/ancestor differs/)
			await expect(
				readStudyReplayHistory(selection, profile, trial, { ...declaration, goals: ['different'] }),
			).rejects.toThrow(/horizon/)
			await expect(
				readStudyReplayHistory(
					{ ...selection, offline: false, prefix: { [trial.id]: 1 } },
					profile,
					trial,
				),
			).rejects.toThrow(/after preflight/)
			await expect(
				readStudyReplayHistory(
					{ ...selection, offline: false, prefix: { [trial.id]: history.completion.count - 1 } },
					profile,
					trial,
				),
			).rejects.toThrow(/before postflight/)
		} finally {
			scratch.destroy()
		}
	}, 30000)
	it('composes open horizons once and validates the parent declaration against every held member', () => {
		const opening = buildOllamaDeclaration()
		const provider = buildStudyDaemonProvider()
		const daemon = requireValue(provider.daemon)
		const profile = {
			...buildStudyProfile(),
			provider: {
				...provider,
				judge: 'judge',
				digest: { ...provider.digest, judge: 'b'.repeat(64) },
				daemon: {
					...daemon,
					models: [...daemon.models, { name: 'judge', digest: 'b'.repeat(64) }],
				},
			},
			record: opening.record,
			settings: { version: opening.version, metadata: { ...opening.metadata } },
		}
		const scenario = buildStudyScenario()
		const trial = { id: 'r1-first-small', scenario: scenario.id, arm: 'small', repetition: 0 }
		const declaration = buildStudyExchangeDeclaration(profile, trial, scenario, false)
		expect(declaration).toMatchObject({
			trial: trial.id,
			goals: ['write', 'read'],
			record: opening.record,
			maintenance: [],
		})
		expect(declaration.procedure).toBeUndefined()
		expect(() =>
			validateStudyRecordingDeclaration(declaration, profile, trial, scenario),
		).not.toThrow()
		expect(buildStudyExchangeDeclaration(profile, trial, scenario, true).maintenance).toEqual(
			profile.provider.daemon?.models,
		)
		expect(() =>
			buildStudyExchangeDeclaration(profile, trial, { ...scenario, id: 'other' }, false),
		).toThrow(/scenario differs/)
		for (const changed of [
			{ ...declaration, trial: 'other' },
			{ ...declaration, goals: ['write'] },
			{ ...declaration, version: 'other' },
			{ ...declaration, configuration: 'd'.repeat(64) },
			{ ...declaration, record: { ...declaration.record, calls: 1 } },
			{ ...declaration, metadata: { ...declaration.metadata, calls: 1 } },
			{ ...declaration, models: { model: { name: 'other', digest: 'a'.repeat(64) } } },
			{ ...declaration, procedure: [buildOllamaStep('capture', undefined, 'agent', 1, 'write')] },
			{ ...declaration, maintenance: [requireValue(profile.provider.daemon.models[0])] },
		]) {
			expect(isStudyExchangeDeclaration(changed)).toBe(true)
			expect(() => validateStudyRecordingDeclaration(changed, profile, trial, scenario)).toThrow(
				/differs/,
			)
		}
	})

	it('binds configuration to room settings and daemon identity apart from executable paths and ceilings', () => {
		const provider = buildStudyDaemonProvider()
		const daemon = requireValue(provider.daemon)
		const profile = { ...buildStudyProfile(), provider, settings: { version: 'fixture-version' } }
		const digest = computeStudyConfigurationDigest(profile)
		expect(digest).toMatch(/^[a-f0-9]{64}$/)
		expect(
			computeStudyConfigurationDigest({
				...profile,
				record: { bytes: 1, calls: 1, duration: 1 },
				bounds: { ...profile.bounds, series: { ...profile.bounds.series, duration: 1 } },
				provider: { ...provider, daemon: { ...daemon, executable: 'different-location' } },
			}),
		).toBe(digest)
		expect(
			computeStudyConfigurationDigest({
				...profile,
				room: { ...profile.room, output: profile.room.output + 1 },
			}),
		).not.toBe(digest)
		expect(
			computeStudyConfigurationDigest({ ...profile, settings: { version: 'different' } }),
		).not.toBe(digest)
		expect(
			computeStudyConfigurationDigest({
				...profile,
				provider: { ...provider, daemon: { ...daemon, version: 'different' } },
			}),
		).not.toBe(digest)
	})

	it('keeps the reserved preparation destination and rejects path, allowance and recording substitutions', () => {
		const scratch = createScratch()
		try {
			const destination = {
				path: resolve(scratch.path, 'exchanges.jsonl'),
				declaration: buildOllamaDeclaration(),
			}
			expect(readStudyPreparedDestination(destination, { ...destination })).toEqual(destination)
			expect(readStudyPreparedDestination(undefined, undefined)).toBeUndefined()
			expect(() =>
				readStudyPreparedDestination(destination, {
					...destination,
					path: resolve(scratch.path, 'other', 'exchanges.jsonl'),
				}),
			).toThrow(/changed its reserved destination/)
			expect(() =>
				readStudyPreparedDestination(destination, {
					...destination,
					declaration: {
						...destination.declaration,
						record: { bytes: 8192, calls: 256, duration: 15000 },
					},
				}),
			).toThrow(/changed its reserved destination/)
			expect(() => readStudyPreparedDestination(undefined, destination)).toThrow(
				/changed its reserved destination/,
			)
			expect(() => readStudyPreparedDestination(destination, undefined)).toThrow(
				/changed its reserved destination/,
			)
		} finally {
			scratch.destroy()
		}
	})
	it('reads the owning runtime version and refuses empty missing or non-string versions', () => {
		const scratch = createScratch()
		try {
			const entry = scratch.write('runtime/dist/bin/main.js', 'export {}')
			scratch.write('package.json', JSON.stringify({ name: 'consumer', version: '9.8.7' }))
			scratch.write(
				'runtime/package.json',
				JSON.stringify({ name: '@orkestrel/study', version: '0.0.0-runtime' }),
			)
			expect(readStudyVersion(entry)).toBe('0.0.0-runtime')
			for (const version of ['', undefined, 42]) {
				scratch.write('runtime/package.json', JSON.stringify({ name: '@orkestrel/study', version }))
				expect(() => readStudyVersion(entry)).toThrow(
					expect.objectContaining({
						code: 'CONFIG',
						message: 'Study runtime package declares no version',
					}),
				)
			}
			scratch.write(
				'runtime/package.json',
				JSON.stringify({ name: 'another-runtime', version: '1.0.0' }),
			)
			expect(() => readStudyVersion(entry)).toThrow(expect.objectContaining({ code: 'CONFIG' }))
		} finally {
			scratch.destroy()
		}
	})
	it('pins the actual runtime package and refuses omitted installed dependencies', () => {
		const scratch = createStudyScratch(resolve('tmp/units'), 'runtime-roots-')
		try {
			scratch.write(
				'package.json',
				JSON.stringify({
					name: '@orkestrel/study',
					type: 'module',
					version: '1.0.0',
					dependencies: { '@orkestrel/contract': '*' },
				}),
			)
			const entry = scratch.write('dist/bin/main.js', 'export {}')
			expect(resolveStudyInstrument(entry)).toBe(scratch.path)
			expect(() => validateStudyRuntime(scratch.path, [scratch.path])).toThrow(
				'omit a runtime dependency',
			)
			validateStudyRuntime(scratch.path, [
				scratch.path,
				realpathSync(resolve('node_modules/@orkestrel/contract')),
			])
			scratch.write(
				'package.json',
				JSON.stringify({ name: '@orkestrel/study', version: '1.0.0', dependencies: [] }),
			)
			expect(() => validateStudyRuntime(scratch.path, [scratch.path])).toThrow(
				'dependency declarations are invalid',
			)
		} finally {
			scratch.destroy()
		}
	})
	it('binds canonical resolved profile settings across the JSON boundary', () => {
		const profile = buildStudyProfile()
		expect(computeStudyProfileDigest(profile)).toMatch(/^[a-f0-9]{64}$/)
		expect(
			computeStudyProfileDigest({ ...profile, room: { ...profile.room, output: 33 } }),
		).not.toBe(computeStudyProfileDigest(profile))
		expect(valueToWire({ optional: undefined, value: 1 })).toEqual({ value: 1 })
		expect(createStudyProcessFailure('lost')).toEqual({
			cause: 'infrastructure',
			message: 'lost',
			role: undefined,
		})
	})
	it('binds driver settings into the profile digest and keeps absent settings off the wire', () => {
		const base = buildStudyProfile()
		const omitted = { ...base }
		Reflect.deleteProperty(omitted, 'settings')
		expect(JSON.stringify(valueToWire(base))).not.toContain('settings')
		expect(JSON.stringify(valueToWire(omitted))).toBe(JSON.stringify(valueToWire(base)))
		expect(computeStudyProfileDigest(omitted)).toBe(computeStudyProfileDigest(base))
		const digests = [base, ...STUDY_PROFILE_SETTINGS.map(buildStudySettingsProfile)].map(
			computeStudyProfileDigest,
		)
		expect(new Set(digests).size).toBe(digests.length)
		const gauge = buildStudySettingsProfile({ gauge: { scale: 1.25 } })
		const changed = buildStudySettingsProfile({ gauge: { scale: 1.5 } })
		expect(computeStudyProfileDigest(changed)).not.toBe(computeStudyProfileDigest(gauge))
	})
	it('binds the selected agent into the profile digest and absent roles to nothing', () => {
		const base = buildStudyProfile()
		expect(computeStudyProfileDigest({ ...base, agent: 'agent-v2' })).not.toBe(
			computeStudyProfileDigest(base),
		)
		const undeclared = { ...base, room: { ...base.room, recap: undefined } }
		const omitted = { ...base, room: { ...base.room } }
		Reflect.deleteProperty(omitted.room, 'recap')
		expect(JSON.stringify(valueToWire(undeclared))).not.toContain('recap')
		expect(computeStudyProfileDigest(omitted)).toBe(computeStudyProfileDigest(undeclared))
		expect(computeStudyProfileDigest(undeclared)).not.toBe(computeStudyProfileDigest(base))
	})
	it('collects each selected entry once while the profile keeps every declared role', () => {
		const base = buildStudyProfile()
		const provider = {
			entry: 'provider-v1',
			url: 'http://127.0.0.1:11435',
			model: 'subject',
			judge: undefined,
			digest: { model: 'a'.repeat(64), judge: undefined },
		}
		expect(collectStudyEntries(base)).toEqual(['agent-v1', 'subject-v1'])
		const shared = { ...base, agent: base.subject }
		expect(shared.agent).toBe(shared.subject)
		expect(collectStudyEntries(shared)).toEqual(['subject-v1'])
		expect(collectStudyEntries({ ...base, provider })).toEqual([
			'agent-v1',
			'subject-v1',
			'provider-v1',
		])
		expect(
			collectStudyEntries({ ...shared, provider: { ...provider, entry: base.subject } }),
		).toEqual(['subject-v1'])
	})
	it('binds the runtime entry and adapter inventory in an ordered JSON pair', () => {
		const entry = 'a'.repeat(64)
		const inventory = 'b'.repeat(64)
		expect(computeStudyInstrumentDigest(entry, inventory)).toBe(
			'2ba3056e95d23c0c154eca683e330401c46e441d5074523e16349e29d7597a64',
		)
		expect(computeStudyInstrumentDigest(inventory, entry)).not.toBe(
			computeStudyInstrumentDigest(entry, inventory),
		)
	})
	it('terminates a live recorded child and treats an exited child as already released', async () => {
		const scratch = createScratch()
		try {
			const peer = createStudyPeer(scratch, `process.on('message', () => {})`)
			const pid = requireValue(peer.child.pid)
			expect(isRunning(pid)).toBe(true)
			terminateStudyChild(peer.child)
			await peer.close()
			expect(isRunning(pid)).toBe(false)
			expect(() => terminateStudyChild(peer.child)).not.toThrow()
		} finally {
			scratch.destroy()
		}
	})
	it('closes a drained child after native exit while its detached leaf holds inherited output', async () => {
		const scratch = createScratch()
		try {
			const child = fork(writeStudyOrphan(scratch, 20000), [], {
				execArgv: [],
				silent: true,
				windowsHide: true,
			})
			drainStudyChild(child)
			const closed = waitForEvent(
				(listener: () => void) => {
					child.once('close', listener)
					return () => {
						child.off('close', listener)
					}
				},
				'drained orphan root close',
				{ budget: STUDY_DRAIN_DURATION + 4000 },
			)
			child.send({ start: true })
			await closed
			const receipt = requireValue(readStudyOrphan(scratch))
			expect(isRunning(receipt.root)).toBe(false)
			expect(isRunning(receipt.leaf)).toBe(true)
		} finally {
			await releaseStudyPid(readStudyOrphan(scratch)?.leaf)
			scratch.destroy()
		}
	}, 15000)
})

describe('collectStudyAncestors', () => {
	it('lists a directory and every parent up to the filesystem root, nearest first', () => {
		const start = resolve('tmp', 'units', 'ancestors')
		const ancestors = collectStudyAncestors(start)
		expect(ancestors[0]).toBe(start)
		expect(ancestors.at(-1)).toBe(parse(start).root)
		expect(ancestors).toContain(resolve('tmp'))
		expect(ancestors.indexOf(resolve('tmp', 'units'))).toBe(1)
		expect(new Set(ancestors).size).toBe(ancestors.length)
		expect(collectStudyAncestors(parse(start).root)).toEqual([parse(start).root])
	})
})
