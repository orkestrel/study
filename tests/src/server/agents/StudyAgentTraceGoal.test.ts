import { describe, expect, it } from 'vitest'
import { StudyAgentTraceGoal } from '../../../../src/server/agents/StudyAgentTraceGoal.js'
import { createStudySinkFixture } from '../../../setupStudy.js'

describe('StudyAgentTraceGoal', () => {
	it('holds its goal and stamps every appended row with it, in order', async () => {
		const goal = new StudyAgentTraceGoal('write')
		const sink = createStudySinkFixture()
		goal.append('first', { id: 1 })
		goal.append('second', { id: 2 })
		expect(goal.goal).toBe('write')
		await goal.flush(sink.sink)
		expect(sink.rows).toEqual([
			{ event: 'first', goal: 'write', value: { id: 1 } },
			{ event: 'second', goal: 'write', value: { id: 2 } },
		])
	})

	it('appends a row retained while the flush is appending', async () => {
		const goal = new StudyAgentTraceGoal('write')
		const sink = createStudySinkFixture({
			during: () => {
				// The hook runs before each append, so the sink holds a row exactly after the first.
				if (sink.rows.length > 0) return
				goal.append('late', { id: 'late' })
			},
		})
		goal.append('early', { id: 'early' })
		await goal.flush(sink.sink)
		expect(sink.rows.map((row) => row.event)).toEqual(['early', 'late'])
	})

	it('rejects with the custody refusal and appends no later row', async () => {
		const goal = new StudyAgentTraceGoal('write')
		const refusal = new Error('Custody refused')
		const sink = createStudySinkFixture({ refuse: { error: refusal, row: 1 } })
		goal.append('first', { id: 1 })
		goal.append('second', { id: 2 })
		goal.append('third', { id: 3 })
		await expect(goal.flush(sink.sink)).rejects.toBe(refusal)
		expect(sink.rows.map((row) => row.event)).toEqual(['first'])
		expect(sink.offered.map((row) => row.event)).toEqual(['first', 'second'])
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

	it('keeps separate rows, admission and refused identity for two goals of one name', async () => {
		const first = new StudyAgentTraceGoal('write')
		const second = new StudyAgentTraceGoal('write')
		const error = new Error('Refused')
		const sink = createStudySinkFixture()
		first.append('first', { id: 1 })
		first.admit({ ordinal: 1, revision: null })
		expect(first.refuse(error)).toBe(true)
		expect(second.admission).toBeUndefined()
		expect(second.refuse(error)).toBe(true)
		await second.flush(sink.sink)
		expect(sink.rows).toEqual([])
		await first.flush(sink.sink)
		expect(sink.rows).toEqual([{ event: 'first', goal: 'write', value: { id: 1 } }])
	})
})
