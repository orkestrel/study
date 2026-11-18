import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { parseStudyArguments } from '../../../../src/server/commands/parsers.js'
import {
	STUDY_LAUNCH_CLEANUP,
	STUDY_LAUNCH_DURATION,
} from '../../../../src/server/launchers/constants.js'
import {
	buildStudyFixtureProfile,
	buildStudySelectors,
	computeStudyExecutionDuration,
	scanStudyAbsolutePaths,
} from '../../../../src/server/launchers/helpers.js'
import { buildStudyDaemonProvider, buildStudyProfile } from '../../../setupStudy.js'

describe('buildStudySelectors', () => {
	it('renders trial, goal range, and seed in launcher order, which the command grammar reads back', () => {
		const selection = {
			trial: 'r1-s1-a1',
			goals: { first: 'g3', last: 'g5' },
			seed: { result: 'baseline', trial: 'r1-s1-a1', goal: 'g2' },
		}
		const selectors = buildStudySelectors(selection)
		expect(selectors).toEqual([
			'--trial',
			'r1-s1-a1',
			'--goals',
			'g3..g5',
			'--seed',
			'baseline:r1-s1-a1:g2',
		])
		expect(parseStudyArguments(['check', 'files', ...selectors])).toMatchObject(selection)
		expect(buildStudySelectors({})).toEqual([])
		expect(buildStudySelectors({ goals: { first: 'write', last: 'write' } })).toEqual([
			'--goals',
			'write..write',
		])
	})
})

describe('buildStudyFixtureProfile', () => {
	const profile = parseStudyProfile({
		...buildStudyProfile(),
		provider: buildStudyDaemonProvider(),
	})
	const digests = { model: 'b'.repeat(64), judge: undefined }

	it('rebinds the url and digests and drops the daemon into a profile the parser admits unchanged', () => {
		const rebound = buildStudyFixtureProfile(profile, 'http://127.0.0.1:9', digests)
		expect(rebound.provider).toEqual({
			entry: 'provider.js',
			url: 'http://127.0.0.1:9',
			model: 'model',
			judge: undefined,
			digest: digests,
		})
		expect(rebound.provider).not.toHaveProperty('daemon')
		expect({ ...rebound, provider: undefined }).toEqual({ ...profile, provider: undefined })
		expect(parseStudyProfile(JSON.parse(JSON.stringify(rebound)))).toEqual(rebound)
	})

	it('refuses the same rebind when the daemon stays, because its pins no longer match', () => {
		expect(() =>
			parseStudyProfile({
				...profile,
				provider: { ...profile.provider, url: 'http://127.0.0.1:9', digest: digests },
			}),
		).toThrow(expect.objectContaining({ code: 'CONFIG' }))
	})

	it('refuses a profile with no provider and digests that pair with no declared model', () => {
		expect(() =>
			buildStudyFixtureProfile(buildStudyProfile(), 'http://127.0.0.1:9', digests),
		).toThrow(
			expect.objectContaining({
				code: 'CONFIG',
				message: expect.stringContaining('declares no provider to rebind'),
			}),
		)
		expect(() =>
			buildStudyFixtureProfile(profile, 'http://127.0.0.1:9', {
				...digests,
				judge: 'c'.repeat(64),
			}),
		).toThrow(expect.objectContaining({ code: 'CONFIG' }))
	})
})

describe('scanStudyAbsolutePaths', () => {
	it('names every absolute root and entry by its key path and nothing in a relative profile', () => {
		const relative = { ...buildStudyProfile(), provider: buildStudyDaemonProvider() }
		expect(scanStudyAbsolutePaths(relative)).toEqual([])
		expect(
			scanStudyAbsolutePaths({
				...relative,
				roots: ['dist', resolve('subject')],
				agent: resolve('agent.js'),
				subject: resolve('subject.js'),
				provider: { ...relative.provider, entry: resolve('provider.js') },
			}),
		).toEqual(['roots[1]', 'agent', 'subject', 'provider.entry'])
	})
})

describe('computeStudyExecutionDuration', () => {
	it('adds the 60-second check allowance and the 15-second cleanup to the series duration', () => {
		const bounds = buildStudyProfile().bounds
		expect([STUDY_LAUNCH_DURATION, STUDY_LAUNCH_CLEANUP]).toEqual([60000, 15000])
		expect(computeStudyExecutionDuration(bounds)).toBe(75100)
		expect(
			computeStudyExecutionDuration({
				...bounds,
				series: { ...bounds.series, duration: 86400000 },
			}),
		).toBe(86475000)
	})
})
