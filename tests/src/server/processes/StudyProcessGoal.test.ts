import { describe, expect, it } from 'vitest'
import { StudyProcessGoal } from '../../../../src/server/processes/StudyProcessGoal.js'
import { createStudyMeterFixture, createStudySinkFixture } from '../../../setupStudy.js'

describe('StudyProcessGoal', () => {
	it('holds the parent context its goal runs under', () => {
		const meter = createStudyMeterFixture()
		try {
			const context = {
				signal: meter.control.signal,
				meter: meter.meter,
				evidence: createStudySinkFixture().sink,
			}
			expect(new StudyProcessGoal(context).context).toBe(context)
		} finally {
			meter.close()
		}
	})

	it('issues admission identifiers in strict sequence and refuses any other request without advancing', () => {
		const meter = createStudyMeterFixture()
		try {
			const goal = new StudyProcessGoal({
				signal: meter.control.signal,
				meter: meter.meter,
				evidence: createStudySinkFixture().sink,
			})
			expect(goal.issue(2)).toBeUndefined()
			expect(goal.issue('1')).toBeUndefined()
			expect(goal.issue(undefined)).toBeUndefined()
			expect(goal.issue(1)).toBe(1)
			expect(goal.issue(1)).toBeUndefined()
			expect(goal.issue(2)).toBe(2)
			expect(goal.issue(3)).toBe(3)
		} finally {
			meter.close()
		}
	})

	it('restarts its sequence for every goal', () => {
		const meter = createStudyMeterFixture()
		try {
			const context = {
				signal: meter.control.signal,
				meter: meter.meter,
				evidence: createStudySinkFixture().sink,
			}
			const first = new StudyProcessGoal(context)
			const second = new StudyProcessGoal(context)
			expect(first.issue(1)).toBe(1)
			expect(second.issue(1)).toBe(1)
		} finally {
			meter.close()
		}
	})
})
