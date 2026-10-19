import type { Message } from '@orkestrel/agent'
import { STUDY_STOP_SWITCHES } from '../../../setupStudy.js'
import { estimateRequest } from '@orkestrel/agent'
import { describe, expect, it } from 'vitest'
import { captureError, waitForAbort } from '@orkestrel/test'
import { createTokenBudget, createBudget } from '@orkestrel/budget'
import { executeStudyAgentSeries, buildCompactCustodyManifest } from '../../../setupStudy.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'
import { createForeignBudgetError, createBudgetLookalike } from '../../../setupServer.js'
import { createStudyMeterFixture } from '../../../setupStudy.js'
import { buildStudyReportResult, buildCustodyGrading } from '../../../setupServer.js'
import { buildStudyRubric } from '../../../setupStudy.js'
import { computeStudyReport } from '../../../../src/server/commands/helpers.js'
import { StudyAgentScript } from '../../../../src/server/agents/StudyAgentScript.js'
import {
	STUDY_SCRIPT_CALL,
	STUDY_SCRIPT_MESSAGES,
	STUDY_SCRIPT_REQUEST,
	buildStudyScriptResponse,
	createStudyScriptFixture,
	createStudyScriptMeter,
	readProviderStream,
} from '../../../setupStudy.js'

describe('StudyAgentScript', () => {
	it('retains a request deadline while the scripted response is suspended', async () => {
		const meter = createStudyMeterFixture({
			request: { duration: 20, calls: 1, tokens: 100, bytes: 1000 },
			goal: { duration: 1000, calls: 4, tokens: 100, bytes: 4000 },
			trial: { duration: 1000, calls: 4, tokens: 100, bytes: 4000 },
			series: { duration: 1000, calls: 4, tokens: 100, bytes: 4000 },
		})
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			script.prepare(
				createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'receipt' })]).plan,
			)
			const stream = script.stream(STUDY_SCRIPT_MESSAGES, new AbortController().signal)
			await stream.next()
			await waitForAbort(meter.control.signal)
			await expect(stream.next()).rejects.toBeDefined()
			expect(meter.control.failure).toMatchObject({
				cause: 'deadline',
				stop: { layer: 'scope', id: 'Request duration', max: 20 },
			})
			expect(meter.control.failure?.stop?.consumed).toBeGreaterThanOrEqual(20)
		} finally {
			meter.close()
		}
	})
	it('keeps a real Agent meter stop through the series without an earlier budget failure', async () => {
		const allowance = createTokenBudget({ id: 'estimate', max: 1, scope: 'completion' })
		const run = await executeStudyAgentSeries({ allowance })
		expect(run.results[0]).toMatchObject({
			partial: true,
			stop: { layer: 'meter', id: 'estimate', max: 1 },
		})
		const stop = run.attempts[0]?.failure?.stop
		expect(stop).toEqual({ layer: 'meter', id: 'estimate', max: 1, consumed: allowance.consumed })
		expect(stop?.consumed).toBeGreaterThan(1)
		expect(run.attempts[0]?.observations[0]?.usage).toMatchObject([
			{ role: 'agent', calls: 1, tokens: undefined, bytes: expect.any(Number) },
		])
		expect(run.attempts[0]?.observations[1]).toMatchObject({ executed: false, failure: { stop } })
		const result = buildStudyReportResult(run.attempts, buildCompactCustodyManifest())
		const rubric = buildStudyRubric()
		expect(computeStudyReport(result, rubric, buildCustodyGrading(result, rubric))).toMatchObject({
			operations: {
				trials: {
					attributions: [
						{
							cause: 'capacity',
							role: 'agent',
							layer: 'meter',
							executed: 1,
							unexecuted: 1,
							readings: [
								{ trial: 'r1-s1-a1', id: 'estimate', max: 1, consumed: allowance.consumed },
								{ trial: 'r1-s2-a1', id: 'estimate', max: 1, consumed: allowance.consumed },
							],
						},
					],
				},
				goals: {
					attributions: [
						{
							cause: 'capacity',
							role: 'agent',
							layer: 'meter',
							executed: 1,
							unexecuted: 3,
							readings: [
								{
									trial: 'r1-s1-a1',
									goal: 'write',
									id: 'estimate',
									max: 1,
									consumed: allowance.consumed,
								},
								{
									trial: 'r1-s1-a1',
									goal: 'read',
									id: 'estimate',
									max: 1,
									consumed: allowance.consumed,
								},
								{
									trial: 'r1-s2-a1',
									goal: 'write',
									id: 'estimate',
									max: 1,
									consumed: allowance.consumed,
								},
								{
									trial: 'r1-s2-a1',
									goal: 'read',
									id: 'estimate',
									max: 1,
									consumed: allowance.consumed,
								},
							],
						},
					],
				},
			},
		})
	})

	it('keeps a real Agent budget stop after the scripted call settles', async () => {
		const budget = createTokenBudget({ id: 'cost', max: 1, scope: 'completion' })
		const run = await executeStudyAgentSeries({ budget })
		expect(run.results[0]).toMatchObject({ partial: true, stop: { layer: 'budget', id: 'cost' } })
		expect(run.attempts[0]?.failure?.stop).toEqual({
			layer: 'budget',
			id: 'cost',
			max: 1,
			consumed: budget.consumed,
		})
		expect(budget.consumed).toBeGreaterThan(1)
	})

	it('projects scripted truncation into the real Agent model stop', async () => {
		const run = await executeStudyAgentSeries(
			{},
			buildStudyScriptResponse({ content: 'receipt', truncated: true }),
		)
		expect(run.results[0]).toMatchObject({
			partial: false,
			stop: { layer: 'model', id: expect.any(String) },
		})
		expect(run.attempts[0]?.failure?.stop).toMatchObject({
			layer: 'model',
			max: undefined,
			consumed: undefined,
		})
	})

	it('keeps a real Agent window refusal through the scripted series', async () => {
		const window = createBudget({ id: 'room', max: 1, consumer: estimateRequest })
		const run = await executeStudyAgentSeries({ window, strict: true })
		expect(run.attempts[0]?.failure).toMatchObject({
			cause: 'capacity',
			role: 'agent',
			stop: { layer: 'window', id: 'Agent window', max: 1, consumed: expect.any(Number) },
		})
		expect(run.results).toEqual([])
	})

	it('keeps a goal allowance refusal through the scripted series', async () => {
		const manifest = buildCompactCustodyManifest()
		const run = await executeStudyAgentSeries(
			{},
			buildStudyScriptResponse(),
			{
				bounds: {
					...manifest.bounds,
					request: { ...manifest.bounds.request, tokens: 1 },
					goal: { ...manifest.bounds.goal, tokens: 1 },
				},
			},
			{ role: 'tool', tokens: 1, bytes: 0 },
		)
		expect(run.attempts[0]?.failure?.stop).toEqual({
			layer: 'scope',
			id: 'Goal tokens',
			max: 1,
			consumed: 2,
		})
	})

	it('recognizes a foreign branded cut in catch and finally and refuses an unbranded lookalike', async () => {
		for (const abandoned of STUDY_STOP_SWITCHES) {
			const meter = createStudyScriptMeter()
			try {
				const script = new StudyAgentScript({ bytes: 1000 })
				const fixture = createStudyScriptFixture(meter, [
					buildStudyScriptResponse({ content: 'receipt' }),
				])
				script.prepare(fixture.plan)
				const controller = new AbortController()
				const stream = script.stream(STUDY_SCRIPT_MESSAGES, controller.signal)
				await stream.next()
				const reason = createForeignBudgetError()
				controller.abort(reason)
				const ending = abandoned ? stream.return({ content: 'partial' }) : stream.next()
				const outcome: unknown = await ending.catch((error: unknown) => error)
				expect(outcome).toEqual(abandoned ? { done: true, value: { content: 'partial' } } : reason)
				expect(readStudyFailure(reason).stop).toEqual({
					layer: 'budget',
					id: 'foreign',
					max: 1,
					consumed: 2,
				})
				expect(meter.control.failure).toBeUndefined()
				expect(meter.meter.usage).toMatchObject([{ tokens: undefined, bytes: expect.any(Number) }])
				expect(fixture.rows.count).toBe(1)
			} finally {
				meter.close()
			}
		}
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			script.prepare(
				createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'receipt' })]).plan,
			)
			const controller = new AbortController()
			const stream = script.stream(STUDY_SCRIPT_MESSAGES, controller.signal)
			await stream.next()
			const reason = createBudgetLookalike()
			controller.abort(reason)
			await expect(stream.next()).rejects.toBe(reason)
			expect(readStudyFailure(reason)).toMatchObject({ cause: 'infrastructure', stop: undefined })
			expect(meter.control.failure).toMatchObject({ cause: 'infrastructure', stop: undefined })
		} finally {
			meter.close()
		}
	})
	it('serves an actual prior tool result with metered bytes and accountable unknown token usage', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({ consume: 'actual-call', bytes: 1000 }),
			])
			script.prepare(fixture.plan)
			expect(script.name).toBe('scripted-study')
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'actual-result',
			})
			expect(fixture.rows.calls.map(([row]) => row)).toEqual([
				{
					event: 'provider',
					goal: 'script',
					value: {
						request: STUDY_SCRIPT_REQUEST,
						response: { content: 'actual-result', calls: [] },
					},
				},
			])
			expect(meter.meter.usage[0]).toMatchObject({ role: 'agent', calls: 1, tokens: undefined })
			expect(meter.meter.usage[0]?.bytes).toBeGreaterThan(0)
			expect(fixture.workload.signal.aborted).toBe(false)
			await expect(script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).rejects.toThrow(
				'exhausted',
			)
		} finally {
			meter.close()
		}
	})

	it('refuses a continuation whose referenced result is absent before any admission', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({ consume: 'missing-call' }),
				buildStudyScriptResponse({ content: 'next' }),
			])
			script.prepare(fixture.plan)
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({
				code: 'FAULT',
				message: 'Continuation has no actual referenced tool result',
			})
			expect(meter.meter.usage).toEqual([])
			expect(fixture.rows.count).toBe(0)
			// The refused response is spent: the next call serves the following response.
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'next',
			})
		} finally {
			meter.close()
		}
	})

	it('refuses a malformed foreign message before any admission', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({ consume: 'actual-call' }),
			])
			script.prepare(fixture.plan)
			const hostile: Message = Object.defineProperty(
				{ id: 'm2', role: 'tool', content: '', call: 'actual-call' } satisfies Message,
				'content',
				{ value: 7 },
			)
			await expect(script.generate([hostile], meter.control.signal)).rejects.toMatchObject({
				code: 'FAULT',
				message: 'Provider message fields are invalid',
			})
			expect(meter.meter.usage).toEqual([])
			expect(fixture.rows.count).toBe(0)
		} finally {
			meter.close()
		}
	})

	it('refuses an unprepared provider and an exhausted sequence', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({ code: 'CONFIG', message: 'Scripted provider is unavailable' })
			script.prepare(createStudyScriptFixture(meter, []).plan)
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: 'Scripted provider response sequence is exhausted',
			})
		} finally {
			meter.close()
		}
	})

	it('refuses concurrent preparation and streaming without spending the running response', async () => {
		const meter = createStudyScriptMeter(1000, 100, 2)
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({ content: 'first' }),
				buildStudyScriptResponse({ content: 'second' }),
			])
			script.prepare(fixture.plan)
			const running = script.stream(STUDY_SCRIPT_MESSAGES, meter.control.signal)
			expect(await running.next()).toEqual({
				done: false,
				value: { channel: 'content', text: 'first' },
			})
			expect(() => script.prepare(fixture.plan)).toThrow(
				'Cannot replace a running scripted workload',
			)
			await expect(script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).rejects.toThrow(
				'Scripted provider is unavailable',
			)
			expect(await running.next()).toEqual({ done: true, value: { content: 'first' } })
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'second',
			})
		} finally {
			meter.close()
		}
	})

	it('refuses a second preparation while a goal is prepared and a stream once the goal is cleared', async () => {
		const meter = createStudyScriptMeter(1000, 100, 2)
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const first = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'a1' })])
			const second = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'b1' })])
			script.prepare(first.plan)
			expect(captureError(() => script.prepare(second.plan))).toMatchObject({
				code: 'CONFIG',
				message: 'Scripted goal is already prepared',
			})
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'a1',
			})
			script.clear()
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({ code: 'CONFIG', message: 'Scripted provider is unavailable' })
			expect(meter.meter.usage).toHaveLength(1)
			expect(first.rows.count).toBe(1)
			expect(second.rows.count).toBe(0)
			expect(() => script.clear()).not.toThrow()
			script.prepare(second.plan)
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'b1',
			})
		} finally {
			meter.close()
		}
	})

	it('serves the second goal plan from its first response under the second goal', async () => {
		const meter = createStudyScriptMeter(1000, 100, 2)
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const first = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({ content: 'a1' }),
				buildStudyScriptResponse({ content: 'a2' }),
			])
			const second = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'b1' })])
			script.prepare(first.plan)
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'a1',
			})
			script.clear()
			script.prepare({ ...second.plan, goal: 'second' })
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'b1',
			})
			expect(second.rows.calls.map(([row]) => [row.event, row.goal])).toEqual([
				['provider', 'second'],
			])
			expect(first.rows.calls.map(([row]) => [row.event, row.goal])).toEqual([
				['provider', 'script'],
			])
			// The first goal's unserved a2 is gone with its goal.
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: 'Scripted provider response sequence is exhausted',
			})
		} finally {
			meter.close()
		}
	})

	it('finishes a running stream under its own goal when the goal is cleared', async () => {
		const meter = createStudyScriptMeter(1000, 100, 2)
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const first = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'a1' })])
			const second = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'b1' })])
			script.prepare(first.plan)
			const running = script.stream(STUDY_SCRIPT_MESSAGES, meter.control.signal)
			expect(await running.next()).toEqual({
				done: false,
				value: { channel: 'content', text: 'a1' },
			})
			script.clear()
			expect(() => script.prepare(second.plan)).toThrow(
				'Cannot replace a running scripted workload',
			)
			expect(await running.next()).toEqual({ done: true, value: { content: 'a1' } })
			expect(first.rows.calls.map(([row]) => [row.event, row.goal])).toEqual([
				['provider', 'script'],
			])
			expect(second.rows.count).toBe(0)
			expect(() => script.prepare(second.plan)).not.toThrow()
		} finally {
			meter.close()
		}
	})

	it('validates the declared responses on preparation and keeps the prepared goal after a refusal', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const invalid = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({
					calls: [{ id: 'call-1', name: 'lookup', arguments: { n: Number.NaN } }],
				}),
			])
			expect(() => script.prepare(invalid.plan)).toThrow('Scripted response sequence is invalid')
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({ code: 'CONFIG', message: 'Scripted provider is unavailable' })
			script.prepare(
				createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'kept' })]).plan,
			)
			expect(captureError(() => script.prepare(invalid.plan))).toMatchObject({
				code: 'CONFIG',
				message: 'Scripted goal is already prepared',
			})
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'kept',
			})
		} finally {
			meter.close()
		}
	})

	it('serves owned snapshots that later caller mutation cannot change', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const first = { id: 'call-1', name: 'lookup', arguments: { id: 'order-1' } }
			const calls = [first]
			const responses = [buildStudyScriptResponse({ content: 'kept', calls })]
			const fixture = createStudyScriptFixture(meter, responses)
			script.prepare(fixture.plan)
			first.arguments.id = 'changed'
			calls.push({ id: 'call-2', name: 'lookup', arguments: { id: 'extra' } })
			responses[0] = buildStudyScriptResponse({ content: 'replaced' })
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'kept',
				tools: [STUDY_SCRIPT_CALL],
			})
			expect(fixture.rows.calls[0]?.[0].value).toEqual({
				request: STUDY_SCRIPT_REQUEST,
				response: {
					content: 'kept',
					calls: [{ id: 'call-1', name: 'lookup', arguments: { id: 'order-1' } }],
				},
			})
		} finally {
			meter.close()
		}
	})

	it('requires an explicit nonnegative safe integer byte bound', () => {
		for (const bytes of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
			expect(() => new StudyAgentScript({ bytes })).toThrow('byte bound')
		expect(new StudyAgentScript({ bytes: 0 }).name).toBe('scripted-study')
	})

	it('refuses a request beyond the encoded bound exactly at the boundary before admission', async () => {
		const meter = createStudyScriptMeter()
		try {
			const measuring = new StudyAgentScript({ bytes: 1000 })
			measuring.prepare(
				createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'ok' })]).plan,
			)
			await measuring.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)
			const encoded = meter.meter.usage[0]?.bytes ?? 0
			expect(encoded).toBeGreaterThan(0)
			const exact = new StudyAgentScript({ bytes: encoded })
			exact.prepare(
				createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'ok' })]).plan,
			)
			expect(await exact.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'ok',
			})
			const short = new StudyAgentScript({ bytes: encoded - 1 })
			const refused = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'ok' })])
			short.prepare(refused.plan)
			await expect(
				short.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({
				code: 'CAPACITY',
				message: 'Scripted request exceeds its encoded workload bound',
				failure: {
					stop: { layer: 'scope', id: 'Scripted bytes', max: encoded - 1, consumed: encoded },
				},
			})
			// Refusal precedes admission: no further settled request, no admission row, no failure.
			expect(meter.meter.usage).toHaveLength(2)
			expect(refused.rows.count).toBe(0)
			expect(meter.control.failure).toBeUndefined()
		} finally {
			meter.close()
		}
	})

	it('declares the constructor bound as the default admitted bytes', async () => {
		const meter = createStudyScriptMeter(500)
		try {
			const script = new StudyAgentScript({ bytes: 501 })
			script.prepare(createStudyScriptFixture(meter, [buildStudyScriptResponse()]).plan)
			// The default admission is 501 bytes, which the 500-byte request allowance refuses.
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({
				code: 'CAPACITY',
				message: 'Request ceiling exceeds the request allowance',
			})
		} finally {
			meter.close()
		}
	})

	it('admits one token by default', async () => {
		const meter = createStudyScriptMeter(1000, 1)
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			script.prepare(
				createStudyScriptFixture(meter, [
					buildStudyScriptResponse({ content: 'ok' }),
					buildStudyScriptResponse({ content: 'over', tokens: 2 }),
				]).plan,
			)
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'ok',
			})
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({ code: 'CAPACITY' })
		} finally {
			meter.close()
		}
	})

	it('retains an admission refusal as evidence and preserves the meter error', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [buildStudyScriptResponse({ tokens: 101 })])
			script.prepare(fixture.plan)
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({
				code: 'CAPACITY',
				message: 'Request ceiling exceeds the request allowance',
			})
			expect(fixture.rows.calls.map(([row]) => row)).toEqual([
				{ event: 'admission', goal: 'script', value: { role: 'agent', refused: true } },
			])
			expect(meter.meter.usage).toEqual([])
			expect(meter.control.failure).toMatchObject({ cause: 'capacity', role: 'agent' })
		} finally {
			meter.close()
		}
	})

	it('settles a request whose actual bytes exceed its declared admission as a capacity failure', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({ content: 'ok', bytes: 1 }),
			])
			script.prepare(fixture.plan)
			await expect(
				script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal),
			).rejects.toMatchObject({
				code: 'CAPACITY',
				message: 'Request usage exceeded its admitted ceiling',
			})
			expect(meter.meter.usage).toHaveLength(1)
			expect(meter.meter.usage[0]?.bytes).toBeGreaterThan(1)
			expect(fixture.rows.count).toBe(1)
		} finally {
			meter.close()
		}
	})

	it('fails the admitted ticket with agent attribution when the run aborts mid-response', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'ok' })])
			script.prepare(fixture.plan)
			const stop = new AbortController()
			const stream = script.stream(STUDY_SCRIPT_MESSAGES, stop.signal)
			expect(await stream.next()).toEqual({
				done: false,
				value: { channel: 'content', text: 'ok' },
			})
			stop.abort(new Error('Stopped'))
			await expect(stream.next()).rejects.toThrow('Stopped')
			expect(meter.meter.usage).toHaveLength(1)
			expect(meter.meter.usage[0]).toMatchObject({
				role: 'agent',
				tokens: undefined,
				bytes: undefined,
			})
			expect(meter.control.failure).toMatchObject({
				cause: 'infrastructure',
				message: 'Stopped',
				role: 'agent',
			})
			expect(fixture.workload.signal.aborted).toBe(false)
		} finally {
			meter.close()
		}
	})

	it('fails an abandoned stream request with agent attribution and never finishes it as success', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'ok' })])
			script.prepare(fixture.plan)
			const stream = script.stream(STUDY_SCRIPT_MESSAGES, meter.control.signal)
			expect(await stream.next()).toEqual({
				done: false,
				value: { channel: 'content', text: 'ok' },
			})
			expect(await stream.return({ content: 'abandoned' })).toEqual({
				done: true,
				value: { content: 'abandoned' },
			})
			expect(meter.meter.usage).toHaveLength(1)
			expect(meter.meter.usage[0]).toMatchObject({
				role: 'agent',
				tokens: undefined,
				bytes: undefined,
			})
			expect(meter.control.failure).toMatchObject({
				cause: 'infrastructure',
				message: 'Scripted response was abandoned before completion',
				role: 'agent',
			})
			script.clear()
			expect(() => script.prepare(fixture.plan)).not.toThrow()
			// Closing the meter finds no unsettled request to replace the recorded failure with.
			meter.close()
			expect(meter.meter.usage).toHaveLength(1)
			expect(meter.meter.usage[0]?.role).toBe('agent')
		} finally {
			meter.close()
		}
	})

	it('fails the admitted ticket without provider evidence when the run is aborted before dispatch', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [buildStudyScriptResponse({ content: 'ok' })])
			script.prepare(fixture.plan)
			const stop = new AbortController()
			stop.abort(new Error('Stopped'))
			await expect(script.generate(STUDY_SCRIPT_MESSAGES, stop.signal)).rejects.toThrow('Stopped')
			expect(fixture.rows.count).toBe(0)
			expect(meter.meter.usage).toHaveLength(1)
			expect(meter.meter.usage[0]).toMatchObject({
				role: 'agent',
				tokens: undefined,
				bytes: undefined,
			})
		} finally {
			meter.close()
		}
	})

	it('cancels the workload only after the request settles and the cancellation is retained', async () => {
		const meter = createStudyScriptMeter()
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			const fixture = createStudyScriptFixture(meter, [
				buildStudyScriptResponse({ content: 'done', abort: true }),
			])
			script.prepare(fixture.plan)
			expect(await script.generate(STUDY_SCRIPT_MESSAGES, meter.control.signal)).toEqual({
				content: 'done',
			})
			expect(fixture.rows.calls.map(([row]) => row.event)).toEqual(['provider', 'workload'])
			expect(fixture.rows.calls[1]?.[0].value).toEqual({ aborted: true })
			expect(meter.meter.usage).toHaveLength(1)
			expect(meter.meter.usage[0]?.bytes).toBeGreaterThan(0)
			expect(fixture.workload.signal.aborted).toBe(true)
			expect(fixture.workload.signal.reason).toMatchObject({
				message: 'Declared workload cancellation',
			})
			// Workload cancellation is separate from the operational control.
			expect(meter.control.failure).toBeUndefined()
			expect(meter.control.signal.aborted).toBe(false)
		} finally {
			meter.close()
		}
	})

	it('serves identical deltas, results, evidence and usage through stream and generate', async () => {
		const responses = [
			buildStudyScriptResponse({ content: 'looking', calls: [STUDY_SCRIPT_CALL] }),
			buildStudyScriptResponse({ content: '' }),
		]
		const streamed = createStudyScriptMeter(1000, 100, 2)
		const generated = createStudyScriptMeter(1000, 100, 2)
		try {
			const streaming = new StudyAgentScript({ bytes: 1000 })
			const generating = new StudyAgentScript({ bytes: 1000 })
			const streamFixture = createStudyScriptFixture(streamed, responses)
			const generateFixture = createStudyScriptFixture(generated, responses)
			streaming.prepare(streamFixture.plan)
			generating.prepare(generateFixture.plan)
			const first = await readProviderStream(
				streaming.stream(STUDY_SCRIPT_MESSAGES, streamed.control.signal),
			)
			const second = await readProviderStream(
				streaming.stream(STUDY_SCRIPT_MESSAGES, streamed.control.signal),
			)
			expect(first.deltas).toEqual([{ channel: 'content', text: 'looking' }])
			expect(first.result).toEqual({ content: 'looking', tools: [STUDY_SCRIPT_CALL] })
			// A response without content yields no delta and no tools member.
			expect(second.deltas).toEqual([])
			expect(second.result).toEqual({ content: '' })
			expect(await generating.generate(STUDY_SCRIPT_MESSAGES, generated.control.signal)).toEqual(
				first.result,
			)
			expect(await generating.generate(STUDY_SCRIPT_MESSAGES, generated.control.signal)).toEqual(
				second.result,
			)
			expect(generateFixture.rows.calls).toEqual(streamFixture.rows.calls)
			expect(generated.meter.usage.map((usage) => usage.bytes)).toEqual(
				streamed.meter.usage.map((usage) => usage.bytes),
			)
			expect(streamFixture.rows.calls[0]?.[0].value).toEqual({
				request: STUDY_SCRIPT_REQUEST,
				response: {
					content: 'looking',
					calls: [{ id: 'call-1', name: 'lookup', arguments: { id: 'order-1' } }],
				},
			})
		} finally {
			streamed.close()
			generated.close()
		}
	})
})
