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

	it('holds no admission until one is retained and replaces it with each stamp', () => {
		const goal = new StudyAgentTraceGoal('write')
		expect(goal.admission).toBeUndefined()
		const stamp = { ordinal: 1, revision: 'a'.repeat(64) }
		goal.admit(stamp)
		expect(goal.admission).toBe(stamp)
		goal.admit(undefined)
		expect(goal.admission).toBeUndefined()
	})

	it('refuses a failure identity once and again only after a different one', () => {
		const goal = new StudyAgentTraceGoal('write')
		const a = new Error('A')
		const b = new Error('B')
		expect(goal.refuse(a)).toBe(true)
		expect(goal.refuse(a)).toBe(false)
		expect(goal.refuse(b)).toBe(true)
		expect(goal.refuse(a)).toBe(true)
	})

	it('keeps separate rows, admission and refused identity for two goals of one name', () => {
		const first = new StudyAgentTraceGoal('write')
		const second = new StudyAgentTraceGoal('write')
		const error = new Error('Refused')
		first.append('first', { id: 1 })
		first.admit({ ordinal: 1, revision: null })
		expect(first.refuse(error)).toBe(true)
		expect(second.admission).toBeUndefined()
		expect(second.refuse(error)).toBe(true)
		expect(second.rows).toEqual([])
		expect(first.rows).toEqual([{ event: 'first', goal: 'write', value: { id: 1 } }])
	})
})
