import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildDistributionCases, createDistributionSuite } from './setupDistribution.js'
import {
	checkStudyDistributionControl,
	readStudyDistributionCore,
	readStudyDistributionErrors,
	readStudyDistributionVersion,
} from './setupServer.js'

const suite = createDistributionSuite()
beforeAll(() => suite.start())
afterAll(() => suite.destroy())

describe('packed package', () => {
	for (const entry of buildDistributionCases(suite)) {
		it(`${entry.label}`, async (context) => {
			const observation = await entry.observe(context)
			expect(observation.actual).toStrictEqual(observation.expected)
		})
	}

	it('publishes no browser face this proof cannot drive [requires the registry]', (context) => {
		expect(
			suite
				.read(context)
				.entries.filter((entry) => entry.browsable)
				.map((entry) => entry.subpath),
		).toEqual([])
	})

	it('runs the installed executable [requires the registry]', (context) => {
		const observation = readStudyDistributionVersion(suite.read(context))
		expect(observation.actual).toEqual(observation.expected)
	})

	it('shares one core between the root and server entries [requires the registry]', (context) => {
		expect(readStudyDistributionCore(suite.read(context))).toEqual([
			{ shared: true, code: 'CONFIG' },
			{ shared: true, code: 'CONFIG' },
		])
	})

	it('keeps the nominal control contract under every module resolution [requires the registry]', (context) => {
		expect(checkStudyDistributionControl(suite.read(context))).toEqual([])
	})

	it('recognizes study and artifact errors across packed copies and module formats [requires the registry]', (context) => {
		expect(readStudyDistributionErrors(suite.read(context))).toEqual({
			distinct: true,
			checks: Array.from({ length: 12 }, () => ({
				cross: true,
				subclass: true,
				lookalike: false,
				proxy: false,
				plain: false,
			})),
			capacity: { cause: 'capacity', message: 'Required capacity' },
			deadline: { cause: 'deadline', message: 'Imported deadline' },
			retained: true,
		})
	})
})
