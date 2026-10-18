import { describe, expect, it } from 'vitest'
import { StudyAgentScriptGoal } from '../../../../src/server/agents/StudyAgentScriptGoal.js'
import {
	buildStudyScriptResponse,
	createStudyScriptFixture,
	createStudyScriptMeter,
} from '../../../setupStudy.js'

describe('StudyAgentScriptGoal', () => {
	it('holds the plan it was given', () => {
		const meter = createStudyScriptMeter()
		try {
			const { plan } = createStudyScriptFixture(meter, [buildStudyScriptResponse()])
			expect(new StudyAgentScriptGoal(plan).plan).toBe(plan)
		} finally {
			meter.close()
		}
	})

	it('takes the declared responses in order, then stays exhausted', () => {
		const meter = createStudyScriptMeter()
		try {
			const responses = [
				buildStudyScriptResponse({ content: 'one' }),
				buildStudyScriptResponse({ content: 'two' }),
			]
			const goal = new StudyAgentScriptGoal(createStudyScriptFixture(meter, responses).plan)
			expect(goal.take()).toBe(responses[0])
			expect(goal.take()).toBe(responses[1])
			expect(goal.take()).toBeUndefined()
			expect(goal.take()).toBeUndefined()
		} finally {
			meter.close()
		}
	})

	it('is exhausted at once over an empty sequence', () => {
		const meter = createStudyScriptMeter()
		try {
			expect(
				new StudyAgentScriptGoal(createStudyScriptFixture(meter, []).plan).take(),
			).toBeUndefined()
		} finally {
			meter.close()
		}
	})

	it('starts every goal over one plan at the first response', () => {
		const meter = createStudyScriptMeter()
		try {
			const responses = [buildStudyScriptResponse({ content: 'one' })]
			const { plan } = createStudyScriptFixture(meter, responses)
			const first = new StudyAgentScriptGoal(plan)
			const second = new StudyAgentScriptGoal(plan)
			expect(first.take()).toBe(responses[0])
			expect(first.take()).toBeUndefined()
			expect(second.take()).toBe(responses[0])
		} finally {
			meter.close()
		}
	})
})
