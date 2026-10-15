import {
	buildStudyProfile,
	buildStudySettingsProfile,
	STUDY_PROFILE_SETTINGS,
} from '../../../setupStudy.js'
import {
	createStudyPeer,
	readStudyOrphan,
	releaseStudyPid,
	writeStudyOrphan,
} from '../../../setupServer.js'
import { describe, expect, it } from 'vitest'
import { requireValue, waitForEvent } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { fork } from 'node:child_process'
import { resolve } from 'node:path'
import { STUDY_DRAIN_DURATION } from '../../../../src/server/processes/constants.js'
import {
	drainStudyChild,
	computeStudyInstrumentDigest,
	computeStudyProfileDigest,
	createStudyProcessFailure,
	terminateStudyChild,
	toStudyWire,
	resolveStudyInstrument,
	validateStudyRuntime,
} from '../../../../src/server/processes/helpers.js'

describe('process helpers', () => {
	it('pins the actual runtime package and refuses omitted installed dependencies', () => {
		const scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'runtime-roots-' })
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
				resolve('node_modules/@orkestrel/contract'),
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
		expect(toStudyWire({ optional: undefined, value: 1 })).toEqual({ value: 1 })
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
		expect(JSON.stringify(toStudyWire(base))).not.toContain('settings')
		expect(JSON.stringify(toStudyWire(omitted))).toBe(JSON.stringify(toStudyWire(base)))
		expect(computeStudyProfileDigest(omitted)).toBe(computeStudyProfileDigest(base))
		const digests = [base, ...STUDY_PROFILE_SETTINGS.map(buildStudySettingsProfile)].map(
			computeStudyProfileDigest,
		)
		expect(new Set(digests).size).toBe(digests.length)
		const gauge = buildStudySettingsProfile({ gauge: { scale: 1.25 } })
		const changed = buildStudySettingsProfile({ gauge: { scale: 1.5 } })
		expect(computeStudyProfileDigest(changed)).not.toBe(computeStudyProfileDigest(gauge))
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
