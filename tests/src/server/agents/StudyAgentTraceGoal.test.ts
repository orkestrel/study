import { describe, expect, it } from 'vitest'
import { StudyAgentTraceGoal } from '../../../../src/server/agents/StudyAgentTraceGoal.js'

describe('StudyAgentTraceGoal', () => {
	it('holds its goal and stamps every appended row with it, in order', () => {
		const goal = new StudyAgentTraceGoal('write')
		expect(goal.rows).toEqual([])
		goal.append('first', { id: 1 })
		goal.append('second', { id: 2 })
		expect(goal.goal).toBe('write')
		expect(goal.rows).toEqual([
			{ event: 'first', goal: 'write', value: { id: 1 } },
			{ event: 'second', goal: 'write', value: { id: 2 } },
		])
	})

	it('lends one live view that sees a row retained after it was taken', () => {
		const goal = new StudyAgentTraceGoal('write')
		const rows = goal.rows
		goal.append('early', { id: 'early' })
		expect(rows.map((row) => row.event)).toEqual(['early'])
		goal.append('late', { id: 'late' })
		expect(rows.map((row) => row.event)).toEqual(['early', 'late'])
		expect(goal.rows).toBe(rows)
	})

	it('keeps separate rows for two goals of one name', () => {
		const first = new StudyAgentTraceGoal('write')
		const second = new StudyAgentTraceGoal('write')
		first.append('first', { id: 1 })
		expect(second.rows).toEqual([])
		expect(first.rows).toEqual([{ event: 'first', goal: 'write', value: { id: 1 } }])
	})
})
