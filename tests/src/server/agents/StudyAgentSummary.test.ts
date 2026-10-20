import type { ProviderRequest } from '@orkestrel/agent'
import { describe, expect, it } from 'vitest'
import { estimateRequest } from '@orkestrel/agent'
import { createRecorder, waitForCondition } from '@orkestrel/test'
import { StudyError } from '../../../../src/core/errors.js'
import { buildStudyAgentRevision } from '../../../../src/server/agents/helpers.js'
import {
	STUDY_AGENT_PROJECTION,
	STUDY_AGENT_REFUSALS,
	STUDY_AGENT_USAGE_FAILURE,
	STUDY_OLLAMA_PARTIAL_ROW,
	STUDY_SUMMARY_INSTRUCTION,
	STUDY_SUMMARY_MESSAGES,
	STUDY_SUMMARY_PROMPTS,
	buildOllamaReplies,
	buildOllamaRow,
	createStudyAgentSummary,
	createStudySinkFixture,
	readOllamaMessages,
	requireStudyRecord,
} from '../../../setupStudy.js'

const canonical: ProviderRequest = {
	messages: [...STUDY_SUMMARY_MESSAGES, STUDY_SUMMARY_INSTRUCTION],
}
const agent: ProviderRequest = { messages: STUDY_SUMMARY_MESSAGES }

describe('StudyAgentSummary', () => {
	it('reads each gauge field once and projects from the validated copy', async () => {
		const scales = createRecorder<[]>()
		const overheads = createRecorder<[]>()
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: false,
			limit: 102,
			gauge: {
				get scale() {
					scales.handler()
					return 1e-9
				},
				get overhead() {
					overheads.handler()
					return overheads.calls.length === 1 ? 100 : 1000
				},
			},
		})
		expect(scales.calls).toEqual([[]])
		expect(overheads.calls).toEqual([[]])
		fixture.trace.start('write')
		await expect(fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).resolves.toBe(
			'Recap',
		)
		expect(scales.calls).toEqual([[]])
		expect(overheads.calls).toEqual([[]])
		expect(fixture.wire.requests).toHaveLength(1)
	})

	it('refuses invalid read gauge values with CONFIG and the established message', () => {
		const scales = createRecorder<[]>()
		const overheads = createRecorder<[]>()
		expect(() =>
			createStudyAgentSummary({
				replies: [],
				observe: false,
				limit: 102,
				gauge: {
					get scale() {
						scales.handler()
						return Number.NaN
					},
					get overhead() {
						overheads.handler()
						return 0
					},
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: 'CONFIG',
				message:
					'Summary gauge scale must be finite and positive and its overhead finite and nonnegative',
			}),
		)
		expect(scales.calls).toEqual([[]])
		expect(overheads.calls).toEqual([[]])
	})
	it('reports the Summary room stop at the projection boundary', async () => {
		const fixture = createStudyAgentSummary({
			replies: [],
			observe: false,
			limit: STUDY_AGENT_PROJECTION,
		})
		fixture.trace.start('write')
		await expect(
			fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined),
		).rejects.toMatchObject({
			failure: {
				cause: 'capacity',
				role: 'summary',
				stop: { layer: 'window', id: 'Summary room', max: 101, consumed: 101 },
			},
		})
		expect(fixture.wire.requests).toEqual([])
	})
	it('measures and sends one canonical array with the instruction as the final user turn and retains the summary evidence', async () => {
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: true,
			limit: 1000,
		})
		const sink = createStudySinkFixture()
		fixture.trace.start('write')
		await expect(fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).resolves.toBe(
			'Recap',
		)
		expect(fixture.wire.requests).toHaveLength(1)
		expect(readOllamaMessages(fixture.wire.requests[0]?.body ?? '').slice(-3)).toEqual([
			{ role: 'user', content: 'First arrival' },
			{ role: 'assistant', content: 'First answer' },
			{ role: 'user', content: 'Fold the conversation.' },
		])
		const revision = buildStudyAgentRevision(canonical)
		expect(fixture.trace.canonical('summary')).toEqual({ id: 1, revision })
		await fixture.trace.flush(sink.sink)
		expect(sink.rows.map((row) => row.event)).toEqual(['context', 'summary'])
		const context = requireStudyRecord(sink.rows[0]?.value)
		expect(Object.keys(context)).toEqual([
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
		expect(context).toMatchObject({
			stage: 'dispatch',
			role: 'summary',
			ordinal: 1,
			revision,
			estimate: estimateRequest(canonical),
			projected: STUDY_AGENT_PROJECTION,
			dispatch: 1,
			origins: [
				{ origin: 'history', source: 'h1' },
				{ origin: 'history', source: 'h2' },
				{ origin: 'history', source: 'summary-instruction' },
			],
		})
		expect(sink.rows[1]).toEqual({
			event: 'summary',
			goal: 'write',
			value: { sources: ['h1', 'h2'], content: 'Recap' },
		})
	})

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		'refuses the limit %s at construction',
		(limit) => {
			expect(() => createStudyAgentSummary({ replies: [], observe: true, limit })).toThrow(
				'Summary limit must be a positive safe integer',
			)
		},
	)

	it.each([
		{ scale: 0, overhead: 100 },
		{ scale: -1, overhead: 100 },
		{ scale: Number.NaN, overhead: 100 },
		{ scale: Number.POSITIVE_INFINITY, overhead: 100 },
		{ scale: 1e-9, overhead: -1 },
		{ scale: 1e-9, overhead: Number.NaN },
		{ scale: 1e-9, overhead: Number.POSITIVE_INFINITY },
	])('refuses the gauge %o at construction', (gauge) => {
		expect(() =>
			createStudyAgentSummary({ replies: [], observe: true, limit: 102, gauge }),
		).toThrow('Summary gauge scale must be finite and positive')
	})

	it('accepts a zero overhead and the smallest limit', () => {
		expect(() =>
			createStudyAgentSummary({
				replies: [],
				observe: true,
				limit: 1,
				gauge: { scale: 1e-9, overhead: 0 },
			}),
		).not.toThrow()
	})

	it('keeps the validated gauge and limit when the caller later mutates its gauge', async () => {
		const gauge = { scale: 1e-9, overhead: 100 }
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: false,
			limit: 102,
			gauge,
		})
		// An uncopied gauge would project 1001 and refuse at the limit of 102.
		gauge.overhead = 1000
		fixture.trace.start('write')
		await expect(fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).resolves.toBe(
			'Recap',
		)
		expect(fixture.wire.requests).toHaveLength(1)
	})

	it('numbers its dispatch after an agent dispatch of the same trial', async () => {
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: true,
			limit: 1000,
		})
		fixture.trace.start('write')
		fixture.trace.record({ estimate: 5, projected: STUDY_AGENT_PROJECTION }, agent)
		await fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)
		expect(fixture.trace.canonical('agent')?.id).toBe(1)
		expect(fixture.trace.canonical('summary')?.id).toBe(2)
	})

	it('refuses a projection that reaches or passes the limit before any request and admits one below it', async () => {
		const refused = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: true,
			limit: 101,
		})
		const sink = createStudySinkFixture()
		refused.trace.start('write')
		await expect(
			refused.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined),
		).rejects.toMatchObject({
			code: 'CAPACITY',
			message: 'Summary request projection reaches the summary room',
			failure: {
				cause: 'capacity',
				message: 'Summary request projection reaches the summary room',
				role: 'summary',
			},
		})
		expect(refused.wire.requests).toEqual([])
		expect(refused.trace.canonical('summary')).toBe(undefined)
		await refused.trace.flush(sink.sink)
		const revision = buildStudyAgentRevision(canonical)
		expect(sink.rows.map((row) => row.event)).toEqual(['context', 'refusal'])
		expect(Object.keys(requireStudyRecord(sink.rows[0]?.value))).not.toContain('dispatch')
		expect(sink.rows[0]?.value).toMatchObject({ stage: 'admission', role: 'summary', ordinal: 1 })
		expect(sink.rows[1]?.value).toEqual({
			cause: 'capacity',
			role: 'summary',
			ordinal: 1,
			revision,
			consumed: 101,
			max: 101,
		})
		expect(Object.keys(requireStudyRecord(sink.rows[1]?.value))).toEqual([
			'cause',
			'role',
			'ordinal',
			'revision',
			'consumed',
			'max',
		])
		// A projection past the limit retains the projection it reached, never the limit it passed.
		const over = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: true,
			limit: 100,
		})
		const overSink = createStudySinkFixture()
		over.trace.start('write')
		await expect(over.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).rejects.toMatchObject({
			code: 'CAPACITY',
		})
		expect(over.wire.requests).toEqual([])
		await over.trace.flush(overSink.sink)
		expect(overSink.rows[1]?.value).toMatchObject({ cause: 'capacity', consumed: 101, max: 100 })
		const admitted = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: true,
			limit: 102,
		})
		admitted.trace.start('write')
		await expect(admitted.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).resolves.toBe(
			'Recap',
		)
		expect(admitted.wire.requests).toHaveLength(1)
	})

	it.each(STUDY_SUMMARY_PROMPTS)(
		'completes a summary whose actual prompt of $prompt reaches its projection, keeping the forecast and retaining no refusal',
		async (row) => {
			const fixture = createStudyAgentSummary({
				replies: [{ path: '/api/chat', body: buildOllamaRow({ ...row, content: 'Recap' }) }],
				observe: true,
				limit: 1000,
			})
			const sink = createStudySinkFixture()
			fixture.trace.start('write')
			await expect(fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).resolves.toBe(
				'Recap',
			)
			expect(fixture.wire.requests).toHaveLength(1)
			await fixture.trace.flush(sink.sink)
			expect(sink.rows.map((entry) => entry.event)).toEqual(['context', 'summary'])
			expect(sink.rows[0]?.value).toMatchObject({
				stage: 'dispatch',
				role: 'summary',
				projected: STUDY_AGENT_PROJECTION,
			})
		},
	)

	it('refuses at the limit without retaining a row when observation is off', async () => {
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: false,
			limit: 101,
		})
		const sink = createStudySinkFixture()
		fixture.trace.start('write')
		await expect(
			fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined),
		).rejects.toBeInstanceOf(StudyError)
		await fixture.trace.flush(sink.sink)
		expect(sink.rows).toEqual([])
		expect(fixture.wire.requests).toEqual([])
	})

	it.each(STUDY_AGENT_REFUSALS)(
		'refuses $name as an infrastructure failure of the summary role before retaining evidence',
		async ({ row }) => {
			const fixture = createStudyAgentSummary({
				replies: [{ path: '/api/chat', body: buildOllamaRow(row) }],
				observe: true,
				limit: 1000,
			})
			const sink = createStudySinkFixture()
			fixture.trace.start('write')
			await expect(
				fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined),
			).rejects.toMatchObject({
				code: 'FAULT',
				failure: { ...STUDY_AGENT_USAGE_FAILURE, role: 'summary' },
			})
			await fixture.trace.flush(sink.sink)
			expect(sink.rows.map((entry) => entry.event)).toEqual(['context'])
		},
	)

	it('retains blank summary evidence before refusing it as unusable content', async () => {
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('   '),
			observe: false,
			limit: 1000,
		})
		const sink = createStudySinkFixture()
		fixture.trace.start('write')
		await expect(
			fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined),
		).rejects.toMatchObject({
			code: 'FAULT',
			failure: {
				cause: 'content',
				message: 'Summary returned no usable content',
				role: 'summary',
			},
		})
		await fixture.trace.flush(sink.sink)
		expect(sink.rows).toEqual([
			{
				event: 'summary',
				goal: 'write',
				value: { sources: ['h1', 'h2'], content: '   ' },
			},
		])
	})

	it('refuses a summary produced outside an active goal and retains nothing', async () => {
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: true,
			limit: 1000,
		})
		await expect(
			fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined),
		).rejects.toMatchObject({
			code: 'FAULT',
			message: 'Summary outside an active goal or invalid content',
		})
		fixture.trace.start('read')
		const sink = createStudySinkFixture()
		await fixture.trace.flush(sink.sink)
		expect(sink.rows).toEqual([])
	})

	it('refuses an already cancelled bound before the latch or the wire and lets a live argument override it', async () => {
		const cancelled = new AbortController()
		const reason = new Error('Stopped')
		cancelled.abort(reason)
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: false,
			limit: 1000,
			signal: cancelled.signal,
		})
		fixture.trace.start('write')
		await expect(fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).rejects.toBe(reason)
		expect(fixture.latch.checks.calls).toEqual([])
		expect(fixture.wire.requests).toEqual([])
		await expect(
			fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, new AbortController().signal),
		).resolves.toBe('Recap')
		expect(fixture.wire.requests).toHaveLength(1)
	})

	it('refuses with the latched failure before any request', async () => {
		const failure = new Error('Latched failure')
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Recap'),
			observe: true,
			limit: 1000,
			refusal: { error: failure },
		})
		fixture.trace.start('write')
		await expect(fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).rejects.toBe(failure)
		expect(fixture.latch.checks.calls).toEqual([[]])
		expect(fixture.wire.requests).toEqual([])
	})

	it('rejects an in-flight request cancelled through the bound without retaining summary evidence', async () => {
		const controller = new AbortController()
		const fixture = createStudyAgentSummary({
			replies: [{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }],
			observe: true,
			limit: 1000,
		})
		const sink = createStudySinkFixture()
		fixture.trace.start('write')
		const pending = fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, controller.signal)
		await Promise.all([
			expect(pending).rejects.toThrow(Error),
			waitForCondition('summary request sent', () => fixture.wire.requests.length === 1).then(() =>
				controller.abort(new Error('Stopped mid-flight')),
			),
		])
		await fixture.trace.flush(sink.sink)
		expect(sink.rows.map((row) => row.event)).toEqual(['context'])
	})
})
