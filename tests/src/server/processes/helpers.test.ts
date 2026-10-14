import { buildStudyProfile } from '../../../setupStudy.js'
import { describe, expect, it } from 'vitest'
import { createScratch } from '@orkestrel/test/server'
import { resolve } from 'node:path'
import {
	computeStudyProfileDigest,
	createStudyProcessFailure,
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
})
