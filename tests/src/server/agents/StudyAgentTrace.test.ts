import type { ProviderRequest } from '@orkestrel/agent'
import { describe, expect, it } from 'vitest'
import { AgentError, estimateRequest } from '@orkestrel/agent'
import { StudyError } from '../../../../src/core/errors.js'
import { buildStudyAgentRevision } from '../../../../src/server/agents/helpers.js'
import {
	STUDY_AGENT_GAUGE,
	STUDY_AGENT_MESSAGES,
	STUDY_AGENT_PROJECTION,
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
	it('numbers mixed agent and summary dispatches and keeps counters and role identities across goals', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		trace.start('write')
		trace.record(reading, first)
		trace.dispatch('summary', second, reading)
		expect(trace.canonical('agent')).toEqual({ id: 1, revision: buildStudyAgentRevision(first) })
		expect(trace.canonical('summary')).toEqual({ id: 2, revision: buildStudyAgentRevision(second) })
		expect(Object.isFrozen(trace.canonical('agent'))).toBe(true)
		await trace.flush(sink.sink)
		trace.start('read')
		trace.record(reading, second)
		expect(trace.canonical('agent')?.id).toBe(3)
		expect(trace.canonical('summary')?.id).toBe(2)
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

	it('starts the second goal rows, admission and refused identity fresh while ordinals, dispatch numbers and role identities continue', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		const window = new AgentError('WINDOW', 'Full', { context: { consumed: 700, max: 600 } })
		trace.start('write')
		trace.admit(first, STUDY_AGENT_GAUGE)
		trace.translate(window)
		await trace.flush(sink.sink)
		trace.start('read')
		trace.translate(window)
		trace.record(reading, first)
		await trace.flush(sink.sink)
		const goals = ['write', 'read'].map((goal) => sink.rows.filter((row) => row.goal === goal))
		expect(sink.rows.map((row) => row.goal)).toEqual(['write', 'write', 'read', 'read', 'read'])
		const [write, read] = goals.map((rows) =>
			rows.map((row) => ({ event: row.event, value: requireStudyRecord(row.value) })),
		)
		expect(write?.map((row) => [row.event, row.value.stage, row.value.ordinal])).toEqual([
			['context', 'admission', 1],
			['refusal', undefined, 1],
		])
		// The admission and the refused identity of the earlier goal are gone: the same error is refused again, with no admission.
		expect(read?.map((row) => [row.event, row.value.stage, row.value.ordinal])).toEqual([
			['refusal', undefined, null],
			['context', 'dispatch', 2],
			['estimate', undefined, undefined],
		])
		expect(read?.[0]?.value.revision).toBe(null)
		expect(read?.[1]?.value.dispatch).toBe(1)
		expect(trace.canonical('agent')?.id).toBe(1)
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

	it('always prices an admission and retains it, without a dispatch field, only when observing', async () => {
		const watched = createStudyAgentTrace(true)
		const silent = createStudyAgentTrace(false)
		const sink = createStudySinkFixture()
		watched.trace.start('write')
		silent.trace.start('write')
		expect(watched.trace.admit(first, STUDY_AGENT_GAUGE)).toBe(STUDY_AGENT_PROJECTION)
		expect(silent.trace.admit(first, STUDY_AGENT_GAUGE)).toBe(STUDY_AGENT_PROJECTION)
		await watched.trace.flush(sink.sink)
		const silentSink = createStudySinkFixture()
		await silent.trace.flush(silentSink.sink)
		expect(silentSink.rows).toEqual([])
		const value = requireStudyRecord(sink.rows[0]?.value)
		expect(Object.keys(value)).toEqual([
			'stage',
			'role',
			'ordinal',
			'revision',
			'estimate',
			'projected',
			'parts',
			'origins',
		])
		expect(value).toMatchObject({
			stage: 'admission',
			role: 'agent',
			ordinal: 1,
			estimate: estimateRequest(first),
			projected: STUDY_AGENT_PROJECTION,
		})
	})

	it('measures, numbers and records nothing with observation off, yet keeps domain rows while a goal is active', async () => {
		const { trace, latch } = createStudyAgentTrace(false)
		const sink = createStudySinkFixture()
		trace.start('write')
		expect(trace.measure('dispatch', 'agent', first, reading, 1)).toBe(undefined)
		trace.record(reading, first)
		trace.dispatch('summary', second, reading)
		expect(trace.canonical('agent')).toBe(undefined)
		expect(trace.canonical('summary')).toBe(undefined)
		trace.append('lookup', { id: 'order-1', found: true })
		trace.append('summary', { sources: ['m1'], content: 'Folded' })
		const window = new AgentError('WINDOW', 'Full', { context: { consumed: 700, max: 600 } })
		const translated = trace.translate(window)
		expect(translated).toBeInstanceOf(StudyError)
		expect(latch.failures.calls).toEqual([[translated]])
		await trace.flush(sink.sink)
		expect(sink.rows).toEqual([
			{ event: 'lookup', goal: 'write', value: { id: 'order-1', found: true } },
			{ event: 'summary', goal: 'write', value: { sources: ['m1'], content: 'Folded' } },
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

	it('retains one refusal row per refused identity naming the retained agent admission across summary measurements, and latches every translation', async () => {
		const { trace, latch } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		const revision = buildStudyAgentRevision(first)
		trace.start('write')
		trace.admit(first, STUDY_AGENT_GAUGE)
		trace.measure('admission', 'summary', second, reading, undefined)
		trace.dispatch('summary', second, reading)
		const window = new AgentError('WINDOW', 'Full', { context: { consumed: 700, max: 600 } })
		const translated = trace.translate(window)
		expect(trace.translate(window)).toEqual(translated)
		const other = new AgentError('WINDOW', 'Again')
		trace.translate(other)
		const plain = new Error('Unrelated')
		expect(trace.translate(plain)).toBe(plain)
		expect(translated).toBeInstanceOf(StudyError)
		expect(translated).toMatchObject({ code: 'CAPACITY', message: 'Full' })
		expect(latch.failures.count).toBe(4)
		await trace.flush(sink.sink)
		const refusals = sink.rows.filter((row) => row.event === 'refusal')
		expect(refusals.map((row) => row.value)).toEqual([
			{ cause: 'capacity', role: 'agent', ordinal: 1, revision, consumed: 700, max: 600 },
			{ cause: 'capacity', role: 'agent', ordinal: 1, revision, consumed: null, max: null },
		])
		expect(Object.keys(requireStudyRecord(refusals[0]?.value))).toEqual([
			'cause',
			'role',
			'ordinal',
			'revision',
			'consumed',
			'max',
		])
	})

	it('retains a refusal without admission as nulls and forgets the refused identity at the next goal', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture()
		const window = new AgentError('WINDOW', 'Full', {
			context: { consumed: 'many', max: undefined },
		})
		trace.start('write')
		trace.admit(first, STUDY_AGENT_GAUGE)
		await trace.flush(createStudySinkFixture().sink)
		trace.start('read')
		trace.translate(window)
		trace.translate(window)
		await trace.flush(sink.sink)
		expect(sink.rows).toEqual([
			{
				event: 'refusal',
				goal: 'read',
				value: {
					cause: 'capacity',
					role: 'agent',
					ordinal: null,
					revision: null,
					consumed: null,
					max: null,
				},
			},
		])
		trace.start('again')
		trace.translate(window)
		await trace.flush(sink.sink)
		expect(sink.rows.map((row) => row.goal)).toEqual(['read', 'again'])
	})

	it('walks the live buffer so a row appended during the flush is retained', async () => {
		const { trace } = createStudyAgentTrace(true)
		const sink = createStudySinkFixture({
			during: () => {
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
		const sink = createStudySinkFixture({ during: () => held.promise })
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
