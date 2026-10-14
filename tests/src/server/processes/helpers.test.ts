import { buildStudyProfile } from '../../../setupStudy.js'
import { createStudyPeer } from '../../../setupServer.js'
import { describe, expect, it } from 'vitest'
import { requireValue } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { resolve } from 'node:path'
import { hashStudyBytes } from '../../../../src/server/helpers.js'
import {
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
	it('binds the runtime entry and adapter inventory in an ordered JSON pair', () => {
		const entry = 'a'.repeat(64)
		const inventory = 'b'.repeat(64)
		expect(computeStudyInstrumentDigest(entry, inventory)).toBe(
			hashStudyBytes(`["${entry}","${inventory}"]`),
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
})
