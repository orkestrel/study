import type { JudgeInterface } from '@orkestrel/agent'
import { describe, expect, it } from 'vitest'
import { captureError, requireValue } from '@orkestrel/test'
import { StudyAgentJudge } from '../../../../src/core/agents/StudyAgentJudge.js'
import { StudyError } from '../../../../src/core/errors.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'
import { StudyOllamaTransport } from '../../../../src/server/ollama/StudyOllamaTransport.js'
import {
	STUDY_AGENT_MESSAGES,
	STUDY_JUDGE_REQUEST,
	STUDY_OLLAMA_OPTIONS,
	STUDY_OLLAMA_PARTIAL_ROW,
	buildOllamaRow,
	buildOllamaStream,
	createOllamaJudgeFixture,
	requireStudyRecord,
} from '../../../setupStudy.js'
import {
	STUDY_OLLAMA_STREAM_FAILURES,
	STUDY_OLLAMA_STATUS_FAILURES,
	buildOllamaTransportOptions,
	createOllamaTransportFixture,
	createOllamaTransportProvider,
} from '../../../setupServer.js'

const encoder = new TextEncoder()
const chatBody = JSON.stringify({
	model: 'model',
	stream: true,
	think: false,
	options: STUDY_OLLAMA_OPTIONS,
})

describe('StudyOllamaTransport', () => {
	it('completes an admitted stream, accounts it once, and retains dispatch and wire evidence', async () => {
		const reply = buildOllamaStream(['Re', 'ceipt'], { prompt: 7, completion: 2 })
		const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }])
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
			expect(result.content).toBe('Receipt')
			const sent = encoder.encode(requireValue(fixture.server.requests[0]).body).byteLength
			const bytes = sent + encoder.encode(reply).byteLength
			expect(fixture.goal.usage()).toEqual([{ role: 'agent', calls: 1, tokens: 9, bytes }])
			const shared = {
				role: 'agent',
				path: '/api/chat',
				model: 'model',
				options: STUDY_OLLAMA_OPTIONS,
			}
			expect(fixture.goal.evidence).toEqual([
				{ event: 'dispatch', goal: 'first', value: { ...shared, bytes: sent } },
				{
					event: 'wire',
					goal: 'first',
					value: { ...shared, finish: 'stop', prompt: 7, completion: 2, bytes },
				},
			])
			expect(() => fixture.transport.check()).not.toThrow()
		} finally {
			await fixture.close()
		}
	})

	it('keeps absent and partial usage unknown while accounting the known bytes', async () => {
		const partial = buildOllamaRow({ unknown: true, fields: { prompt_eval_count: 7 } })
		const fixture = await createOllamaTransportFixture([
			{ path: '/api/chat', body: buildOllamaRow({ unknown: true }) },
			{ path: '/api/chat', body: partial },
		])
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const signal = new AbortController().signal
			await provider.generate(STUDY_AGENT_MESSAGES, signal)
			await provider.generate(STUDY_AGENT_MESSAGES, signal)
			const usage = fixture.goal.usage()
			expect(usage.map(({ tokens }) => tokens)).toEqual([undefined, undefined])
			expect(usage.every(({ bytes }) => typeof bytes === 'number' && bytes > 0)).toBe(true)
			const wires = fixture.goal.evidence.filter((row) => row.event === 'wire')
			expect(wires.map((row) => row.value)).toMatchObject([
				{ prompt: null, completion: null },
				{ prompt: 7, completion: null },
			])
		} finally {
			await fixture.close()
		}
	})

	it('verifies the pinned inventory and support, admitting each metadata read', async () => {
		const fixture = await createOllamaTransportFixture()
		try {
			await fixture.transport.verify()
			const events = fixture.goal.evidence.map((row) => row.event)
			expect(events).toEqual([
				'dispatch',
				'wire',
				'dispatch',
				'wire',
				'support',
				'dispatch',
				'wire',
				'support',
				'inventory',
			])
			const findings = fixture.goal.evidence.filter(
				(row) => row.event === 'support' || row.event === 'inventory',
			)
			expect(findings.map((row) => row.value)).toEqual([
				{ model: 'model', ceiling: 32768, requested: 32768 },
				{ model: 'judge', ceiling: 32768, requested: 32768 },
				{ model: 'a'.repeat(64), judge: 'b'.repeat(64) },
			])
			const usage = fixture.goal.usage().map(({ role, tokens }) => [role, tokens])
			expect(usage).toEqual([
				['metadata', 0],
				['metadata', 0],
				['metadata', 0],
			])
		} finally {
			await fixture.close()
		}
	})

	it('refuses a changed served digest and retains that failure', async () => {
		const changed = JSON.stringify({
			models: [
				{ name: 'model', digest: 'c'.repeat(64) },
				{ name: 'judge', digest: 'b'.repeat(64) },
			],
		})
		const fixture = await createOllamaTransportFixture([{ path: '/api/tags', body: changed }])
		try {
			const outcome = await fixture.transport.verify().then(
				() => undefined,
				(error: unknown) => error,
			)
			expect(outcome).toBeDefined()
			expect(captureError(() => fixture.transport.check())).toMatchObject({
				code: 'FAULT',
				message: 'Serving inventory does not match the required model digest',
			})
			expect(fixture.goal.evidence.some((row) => row.event === 'inventory')).toBe(false)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'metadata', calls: 1, tokens: undefined, bytes: undefined },
			])
		} finally {
			await fixture.close()
		}
	})

	it.each(STUDY_OLLAMA_STREAM_FAILURES)(
		'fails the ticket, drains the reader, and latches $name',
		async ({ body, message, cause }) => {
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body }], {
				limit: { duration: 2000, bytes: 2048 },
			})
			try {
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const signal = new AbortController().signal
				const outcome = await provider.generate(STUDY_AGENT_MESSAGES, signal).then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(outcome).toBeDefined()
				const retained = captureError(() => fixture.transport.check())
				expect(retained).toBeInstanceOf(StudyError)
				expect(readStudyFailure(retained)).toMatchObject({ cause, role: 'agent' })
				expect(readStudyFailure(retained).message).toContain(message)
				expect(fixture.goal.usage()).toEqual([
					{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
				])
				const failure = fixture.goal.evidence.find((row) => row.event === 'wire-failure')
				expect(failure?.value).toMatchObject({ role: 'agent', path: '/api/chat', status: 200 })
				expect(fixture.goal.evidence.some((row) => row.event === 'wire')).toBe(false)
			} finally {
				await fixture.close()
			}
		},
	)

	it.each(STUDY_OLLAMA_STATUS_FAILURES)(
		'reads $name once under the wire bounds and accounts it before refusal',
		async ({ status, body, code, message }) => {
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body, status }], {
				limit: { duration: 2000, bytes: 2048 },
			})
			try {
				const init = { method: 'POST', body: chatBody }
				const outcome = await fixture.transport
					.fetch('agent', `${fixture.server.url}/api/chat`, init)
					.then(
						() => undefined,
						(error: unknown) => error,
					)
				expect(outcome).toBeInstanceOf(StudyError)
				expect(outcome).toMatchObject({ code, failure: { role: 'agent' } })
				expect(readStudyFailure(outcome).message).toContain(message)
				expect(captureError(() => fixture.transport.check())).toBe(outcome)
				expect(fixture.goal.usage()).toEqual([
					{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
				])
				const failure = fixture.goal.evidence.find((row) => row.event === 'wire-failure')
				expect(failure?.value).toMatchObject({ role: 'agent', status })
			} finally {
				await fixture.close()
			}
		},
	)

	it('accounts the actual tokens and wire row before refusing a completion over its allowance', async () => {
		const fixture = await createOllamaTransportFixture([
			{ path: '/api/chat', body: buildOllamaRow({ prompt: 10, completion: 600 }) },
		])
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
				() => undefined,
				() => undefined,
			)
			const usage = fixture.goal.usage().map(({ role, tokens }) => [role, tokens])
			expect(usage).toEqual([['agent', 610]])
			const wire = fixture.goal.evidence.find((row) => row.event === 'wire')
			expect(wire?.value).toMatchObject({ prompt: 10, completion: 600, finish: 'stop' })
			expect(fixture.goal.evidence.some((row) => row.event === 'wire-failure')).toBe(false)
			expect(readStudyFailure(captureError(() => fixture.transport.check()))).toEqual({
				cause: 'capacity',
				message: 'Actual generation exceeded the output allowance',
				role: 'agent',
			})
		} finally {
			await fixture.close()
		}
	})

	it('admits the one-token judge length finish only when its policy declares it', async () => {
		const options = buildOllamaTransportOptions('http://127.0.0.1:1')
		const judgePolicy = requireValue(options.roles.judge)
		const declared = await createOllamaTransportFixture()
		const undeclared = await createOllamaTransportFixture([], {
			roles: { ...options.roles, judge: { ...judgePolicy, length: false } },
		})
		try {
			const signal = new AbortController().signal
			for (const fixture of [declared, undeclared]) {
				const real = createOllamaJudgeFixture(
					fixture.server.url,
					(input: string | URL | Request, init?: RequestInit) =>
						fixture.transport.fetch('judge', input, init),
				)
				await new StudyAgentJudge(real, fixture.transport).ask(STUDY_JUDGE_REQUEST, signal).then(
					() => undefined,
					() => undefined,
				)
			}
			for (const fixture of [declared, undeclared])
				expect(fixture.goal.usage().map(({ role, tokens }) => [role, tokens])).toEqual([
					['judge', 11],
				])
			expect(() => declared.transport.check()).not.toThrow()
			expect(readStudyFailure(captureError(() => undeclared.transport.check()))).toEqual({
				cause: 'capacity',
				message: 'Substantive generation reached its output cap',
				role: 'judge',
			})
		} finally {
			await declared.close()
			await undeclared.close()
		}
	})

	it('refuses a strict chat request the provider sent without native false flags, before admission', async () => {
		const options = buildOllamaTransportOptions('http://127.0.0.1:1')
		const agentPolicy = requireValue(options.roles.agent)
		const fixture = await createOllamaTransportFixture([], {
			roles: { ...options.roles, agent: { ...agentPolicy, strict: true } },
		})
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
				() => undefined,
				() => undefined,
			)
			expect(captureError(() => fixture.transport.check())).toMatchObject({
				code: 'CONFIG',
				message: 'Ollama transport must disable native truncation and shifting',
			})
			expect(fixture.goal.usage()).toEqual([])
			expect(fixture.server.requests).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	it('cancels an open response on close, fails its ticket, and refuses later work', async () => {
		const fixture = await createOllamaTransportFixture([
			{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
		])
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const stream = provider.stream(STUDY_AGENT_MESSAGES, new AbortController().signal)
			expect(await stream.next()).toEqual({
				done: false,
				value: { channel: 'content', text: 'par' },
			})
			const next = { goal: 'second', context: fixture.goal.context, checkpoint: undefined }
			expect(() => fixture.transport.prepare(next)).toThrow('Previous model response is still open')
			await fixture.transport.close()
			await stream.next().then(
				() => undefined,
				() => undefined,
			)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			const failure = fixture.goal.evidence.find((row) => row.event === 'wire-failure')
			expect(failure?.value).toMatchObject({ role: 'agent', reason: 'Ollama transport closed' })
			const retained = captureError(() => fixture.transport.check())
			expect(readStudyFailure(retained).message).toBe('Ollama transport closed')
		} finally {
			await fixture.close()
		}
	})

	it('retains the first failure with its identity and refuses dispatch after it', async () => {
		const fixture = await createOllamaTransportFixture()
		try {
			const first = new StudyError('FAULT', 'First failure')
			fixture.transport.fail(first)
			fixture.transport.fail(new StudyError('FAULT', 'Second failure'))
			expect(captureError(() => fixture.transport.check())).toBe(first)
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
				() => undefined,
				() => undefined,
			)
			expect(fixture.server.requests).toEqual([])
			expect(fixture.goal.usage()).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	it.each([
		['undefined', undefined],
		['null', null],
		['an Error', new Error('First thrown value')],
	] as const)(
		'retains a first failure of %s exactly and keeps it against a later failure',
		async (_name, thrown) => {
			const fixture = await createOllamaTransportFixture()
			try {
				fixture.transport.fail(thrown)
				fixture.transport.fail(new StudyError('FAULT', 'Later failure'))
				fixture.transport.fail(undefined)
				const outcomes = [0, 1].map(() => {
					try {
						fixture.transport.check()
						return undefined
					} catch (error) {
						return { error }
					}
				})
				for (const outcome of outcomes) {
					expect(outcome).toBeDefined()
					expect(outcome?.error).toBe(thrown)
				}
			} finally {
				await fixture.close()
			}
		},
	)

	it.each([
		['undefined', undefined],
		['null', null],
		['an Error', new Error('Judge unavailable')],
	] as const)(
		'refuses the next judge ask after a failed ask that threw %s, without calling the judge',
		async (_name, thrown) => {
			const fixture = await createOllamaTransportFixture()
			try {
				let calls = 0
				const failing: JudgeInterface = {
					id: 'judge',
					name: 'ollama',
					model: 'judge',
					ask: () => {
						calls += 1
						return Promise.reject(thrown)
					},
				}
				const judge = new StudyAgentJudge(failing, fixture.transport)
				const signal = new AbortController().signal
				const outcomes: Array<{ readonly error: unknown }> = []
				for (let attempt = 0; attempt < 2; attempt += 1) {
					try {
						await judge.ask(STUDY_JUDGE_REQUEST, signal)
					} catch (error) {
						outcomes.push({ error })
					}
				}
				expect(outcomes).toHaveLength(2)
				for (const outcome of outcomes) expect(outcome.error).toBe(thrown)
				expect(calls).toBe(1)
			} finally {
				await fixture.close()
			}
		},
	)

	it('refuses a role policy whose model the inventory does not pin at construction', () => {
		const options = buildOllamaTransportOptions('http://127.0.0.1:1')
		const agent = { ...requireValue(options.roles.agent), model: 'unpinned' }
		expect(() => new StudyOllamaTransport({ ...options, roles: { agent } })).toThrow('does not pin')
	})

	it('sends the same bytes and accounts the same usage with observation on and off', async () => {
		const reply = buildOllamaRow({ prompt: 7, completion: 2, fields: { total_duration: 1234 } })
		const off = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }])
		const on = await createOllamaTransportFixture(
			[{ path: '/api/chat', body: reply }],
			{ observe: true },
			{ view: 'selected goal' },
		)
		try {
			const dispatch = { id: 1, revision: 'f'.repeat(64) }
			const signal = new AbortController().signal
			for (const fixture of [off, on]) {
				const url = fixture.server.url
				const provider = createOllamaTransportProvider(fixture.transport, url, 'agent', dispatch)
				await provider.generate(STUDY_AGENT_MESSAGES, signal)
			}
			expect(on.server.requests).toEqual(off.server.requests)
			expect(on.goal.usage()).toEqual(off.goal.usage())
			const [offDispatch, offWire] = off.goal.evidence.map((row) => requireStudyRecord(row.value))
			const [onDispatch, onWire] = on.goal.evidence.map((row) => requireStudyRecord(row.value))
			expect(onDispatch).toEqual({
				...offDispatch,
				id: 1,
				canonical: 1,
				revision: 'f'.repeat(64),
				digest: 'a'.repeat(64),
				previous: null,
				changed: false,
				body: requireValue(on.server.requests[0]).body,
				snapshot: { view: 'selected goal' },
			})
			expect(onWire).toMatchObject({
				...offWire,
				id: 1,
				canonical: 1,
				revision: 'f'.repeat(64),
				timing: {
					durations: { total: 1234, load: null, prompt: null, decode: null },
					counts: { prompt: 7, decode: 2, cached: null },
					invalid: [],
				},
			})
			const observed = ['canonical', 'elapsed', 'id', 'revision', 'sent', 'started', 'timing']
			expect(Object.keys(onWire ?? {}).sort()).toEqual(
				[...Object.keys(offWire ?? {}), ...observed].sort(),
			)
		} finally {
			await off.close()
			await on.close()
		}
	})
})
