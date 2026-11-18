import type { ProviderRequest } from '@orkestrel/agent'
import type { StudyEvidence } from '../../../../src/core/types.js'
import { describe, expect, it } from 'vitest'
import { createRecorder } from '@orkestrel/test'
import { StudyError } from '../../../../src/core/errors.js'
import { buildStudyAgentRevision } from '../../../../src/server/agents/helpers.js'
import {
	STUDY_AGENT_MESSAGES,
	STUDY_AGENT_TOOLS,
	createStudyAgentTrace,
	createStudySinkFixture,
	requireStudyRecord,
} from '../../../setupStudy.js'

const first: ProviderRequest = { messages: STUDY_AGENT_MESSAGES }
const second: ProviderRequest = {
	messages: [...STUDY_AGENT_MESSAGES, { id: 'm2', role: 'assistant', content: 'Two orders' }],
	tools: STUDY_AGENT_TOOLS,
}
const reading = { estimate: 40, projected: 141 }

describe('StudyAgentTrace', () => {
	it('numbers agent dispatches and keeps counters and the role identity across goals', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		trace.start('write')
		trace.record(reading, first)
		trace.dispatch('agent', second, reading)
		expect(trace.canonical('agent')).toEqual({ id: 2, revision: buildStudyAgentRevision(second) })
		expect(Object.isFrozen(trace.canonical('agent'))).toBe(true)
		await trace.flush(sink.sink)
		expect(trace.canonical('agent')?.id).toBe(2)
		trace.start('read')
		trace.record(reading, first)
		expect(trace.canonical('agent')).toEqual({ id: 3, revision: buildStudyAgentRevision(first) })
		await trace.flush(sink.sink)
		const sequence = sink.rows.map((row) => {
			const value = requireStudyRecord(row.value)
			return [row.goal, row.event, value.ordinal, value.dispatch]
		})
		expect(sequence).toEqual([
			['write', 'context', 1, 1],
			['write', 'estimate', undefined, 1],
			['write', 'context', 2, 2],
			['read', 'context', 3, 3],
			['read', 'estimate', undefined, 3],
		])
	})

	it('retains the exact dispatch context and estimate rows in field order', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		const revision = buildStudyAgentRevision(second)
		trace.start('write')
		trace.record(reading, second)
		await trace.flush(sink.sink)
		const [context, estimate] = sink.rows
		expect(context?.event).toBe('context')
		expect(context?.goal).toBe('write')
		const value = requireStudyRecord(context?.value)
		expect(Object.keys(value)).toEqual([
			'stage',
			'role',
			'ordinal',
			'revision',
			'estimate',
			'projected',
			'dispatch',
			'parts',
			'origins',
		])
		expect(value).toMatchObject({
			stage: 'dispatch',
			role: 'agent',
			ordinal: 1,
			revision,
			estimate: 40,
			projected: 141,
			dispatch: 1,
			parts: {
				messages: [
					{ id: 'm1', role: 'user' },
					{ id: 'm2', role: 'assistant' },
				],
			},
			origins: [
				{ origin: 'history', source: 'm1' },
				{ origin: 'history', source: 'm2' },
			],
		})
		expect(estimate?.event).toBe('estimate')
		expect(estimate?.goal).toBe('write')
		expect(estimate?.value).toEqual({ estimate: 40, projected: 141, revision, dispatch: 1 })
		expect(Object.keys(requireStudyRecord(estimate?.value))).toEqual([
			'estimate',
			'projected',
			'revision',
			'dispatch',
		])
	})

	it('retains an unpriced reading with a null projection in both rows', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		trace.start('write')
		trace.record({ estimate: 40, projected: undefined }, first)
		await trace.flush(sink.sink)
		expect(requireStudyRecord(sink.rows[0]?.value).projected).toBe(null)
		expect(requireStudyRecord(sink.rows[1]?.value).projected).toBe(null)
	})

	it('measures, numbers and records nothing with observation off, yet keeps domain rows while a goal is active', async () => {
		const { trace } = createStudyAgentTrace(false)
		const sink = createStudySinkFixture()
		trace.start('write')
		expect(trace.measure('dispatch', 'agent', first, reading, 1)).toBe(undefined)
		trace.record(reading, first)
		trace.dispatch('agent', second, reading)
		expect(trace.canonical('agent')).toBe(undefined)
		trace.append('lookup', { id: 'order-1', found: true })
		trace.append('note', { sources: ['m1'], content: 'Kept' })
		await trace.flush(sink.sink)
		expect(sink.rows).toEqual([
			{ event: 'lookup', goal: 'write', value: { id: 'order-1', found: true } },
			{ event: 'note', goal: 'write', value: { sources: ['m1'], content: 'Kept' } },
		])
	})

	it('measures only while a goal is active', async () => {
		const watched = createStudyAgentTrace(true).trace
		expect(watched.goal).toBe(undefined)
		expect(watched.measure('dispatch', 'agent', first, reading, 1)).toBe(undefined)
		watched.start('write')
		expect(watched.goal).toBe('write')
		expect(watched.measure('dispatch', 'agent', first, reading, 1)?.ordinal).toBe(1)
		await watched.flush(createStudySinkFixture().sink)
		expect(watched.goal).toBe(undefined)
		expect(watched.measure('dispatch', 'agent', first, reading, 1)).toBe(undefined)
	})

	it('drops a row appended outside a goal and starts each goal with empty rows', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		trace.append('lookup', { id: 'before' })
		trace.start('write')
		trace.append('lookup', { id: 'during' })
		await trace.flush(sink.sink)
		trace.append('lookup', { id: 'after' })
		trace.start('read')
		await trace.flush(sink.sink)
		expect(sink.rows).toEqual([{ event: 'lookup', goal: 'write', value: { id: 'during' } }])
	})

	it('walks the live buffer so a row appended during the flush is retained', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture({
			hook: () => {
				// The hook runs before each append, so the sink holds a row exactly after the first.
				if (sink.rows.length > 0) return
				trace.append('late', { id: 'late' })
			},
		})
		trace.start('write')
		trace.append('early', { id: 'early' })
		await trace.flush(sink.sink)
		expect(sink.rows.map((row) => row.event)).toEqual(['early', 'late'])
	})

	it('ends the goal and keeps earlier rows when custody refuses a row', async () => {
		const { trace } = createStudyAgentTrace(true)
		const refusal = new Error('Custody refused')
		const sink = createStudySinkFixture({ refuse: { error: refusal, row: 1 } })
		trace.start('write')
		trace.append('first', { id: 1 })
		trace.append('second', { id: 2 })
		trace.append('third', { id: 3 })
		await expect(trace.flush(sink.sink)).rejects.toBe(refusal)
		expect(sink.rows.map((row) => row.event)).toEqual(['first'])
		expect(trace.goal).toBe(undefined)
		trace.append('after', { id: 4 })
		const next = createStudySinkFixture()
		trace.start('read')
		await trace.flush(next.sink)
		expect(next.rows).toEqual([])
	})

	it('refuses to start a goal while one is active and keeps the active goal and its rows', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		trace.start('write')
		trace.append('first', { id: 1 })
		expect(() => trace.start('read')).toThrow('Trace goal is already active')
		expect(() => trace.start('read')).toThrow(StudyError)
		expect(trace.goal).toBe('write')
		await trace.flush(sink.sink)
		expect(sink.rows).toEqual([{ event: 'first', goal: 'write', value: { id: 1 } }])
	})

	it('treats a flush with no active goal as a no-op, so a completed flush never appends twice', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		await trace.flush(sink.sink)
		trace.start('write')
		trace.append('first', { id: 1 })
		await trace.flush(sink.sink)
		await trace.flush(sink.sink)
		expect(sink.rows).toEqual([{ event: 'first', goal: 'write', value: { id: 1 } }])
	})

	it('refuses a second flush while one is pending and leaves the pending flush and late rows intact', async () => {
		const { trace } = createStudyAgentTrace(true)
		const held = Promise.withResolvers<void>()
		const sink = createStudySinkFixture({ hook: () => held.promise })
		trace.start('write')
		trace.append('first', { id: 1 })
		const pending = trace.flush(sink.sink)
		await expect(trace.flush(sink.sink)).rejects.toMatchObject({
			code: 'CONFIG',
			message: 'Trace flush is already pending',
		})
		expect(() => trace.start('read')).toThrow('Trace goal is already active')
		trace.append('late', { id: 2 })
		held.resolve()
		await pending
		expect(sink.rows.map((row) => row.event)).toEqual(['first', 'late'])
		expect(trace.goal).toBe(undefined)
	})

	it('offers the first row to the sink before the flush call returns', async () => {
		const { trace } = createStudyAgentTrace(true)
		const appended = createRecorder<readonly [StudyEvidence]>()
		trace.start('write')
		trace.append('first', { id: 1 })
		const pending = trace.flush({
			append: async (row) => {
				appended.handler(row)
			},
		})
		expect(appended.calls).toEqual([[{ event: 'first', goal: 'write', value: { id: 1 } }]])
		await pending
		expect(trace.goal).toBe(undefined)
	})

	it('ends a goal with no rows before the flush call returns', async () => {
		const { trace } = createStudyAgentTrace(true)
		trace.start('write')
		const pending = trace.flush(createStudySinkFixture().sink)
		expect(trace.goal).toBe(undefined)
		expect(() => trace.start('read')).not.toThrow()
		await pending
		expect(trace.goal).toBe('read')
	})

	it('refuses a flush the sink starts before its own append returns and records the row once', async () => {
		const { trace } = createStudyAgentTrace(true)
		const other = createStudySinkFixture()
		const reentries =
			createRecorder<readonly [PromiseLike<ReadonlyArray<PromiseSettledResult<void>>>]>()
		const sink = createStudySinkFixture({
			hook: () => {
				reentries.handler(Promise.allSettled([trace.flush(other.sink)]))
			},
		})
		trace.start('write')
		trace.append('first', { id: 1 })
		await trace.flush(sink.sink)
		expect(await Promise.all(reentries.calls.map(([settled]) => settled))).toMatchObject([
			[
				{
					status: 'rejected',
					reason: { code: 'CONFIG', message: 'Trace flush is already pending' },
				},
			],
		])
		expect(sink.rows.map((row) => row.event)).toEqual(['first'])
		expect(other.offered).toEqual([])
		expect(trace.goal).toBe(undefined)
	})

	it('clears the rows and the pending phase when custody refuses, so the next goal starts clean and continues the counters', async () => {
		const { trace } = createStudyAgentTrace(true)
		const refusal = new Error('Custody refused')
		const failing = createStudySinkFixture({ refuse: { error: refusal, row: 0 } })
		trace.start('write')
		trace.record(reading, first)
		await expect(trace.flush(failing.sink)).rejects.toBe(refusal)
		const sink = createStudySinkFixture()
		await trace.flush(sink.sink)
		expect(sink.rows).toEqual([])
		trace.start('read')
		trace.record(reading, first)
		await trace.flush(sink.sink)
		expect(sink.rows.map((row) => requireStudyRecord(row.value).dispatch)).toEqual([2, 2])
		expect(trace.canonical('agent')?.id).toBe(2)
	})
})
