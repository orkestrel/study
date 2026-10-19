import type { JudgeInterface } from '@orkestrel/agent'
import { STUDY_STOP_SWITCHES } from '../../../setupStudy.js'
import { createForeignBudgetError, createBudgetLookalike } from '../../../setupServer.js'
import { describe, expect, it } from 'vitest'
import { parseJSON } from '@orkestrel/contract'
import { extractTiming } from '@orkestrel/ollama'
import { captureError, createRecorder, requireValue } from '@orkestrel/test'
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
	STUDY_OLLAMA_CHAT_BODY,
	STUDY_OLLAMA_ROW_FAULTS,
	STUDY_OLLAMA_STREAM_FAILURES,
	STUDY_OLLAMA_STATUS_FAILURES,
	buildOllamaStrictRoles,
	buildOllamaTransportOptions,
	createOllamaContext,
	createOllamaTransportFixture,
	createOllamaTransportProvider,
} from '../../../setupServer.js'

const encoder = new TextEncoder()

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
				const failure = fixture.goal.evidence.find((row) => row.event === 'failure')
				expect(failure?.value).toMatchObject({ role: 'agent', path: '/api/chat', status: 200 })
				expect(fixture.goal.evidence.some((row) => row.event === 'wire')).toBe(false)
			} finally {
				await fixture.close()
			}
		},
	)

	it.each(STUDY_OLLAMA_ROW_FAULTS)(
		'latches $name before any later dispatch, failing its ticket without a wire row',
		async ({ body, message, cause }) => {
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body }])
			try {
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const signal = new AbortController().signal
				const outcome = await provider.generate(STUDY_AGENT_MESSAGES, signal).then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(outcome).toBeDefined()
				const retained = readStudyFailure(captureError(() => fixture.transport.check()))
				expect(retained.cause).toBe(cause)
				expect(retained.message).toContain(message)
				expect(fixture.goal.usage()).toEqual([
					{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
				])
				const failure = fixture.goal.evidence.find((row) => row.event === 'failure')
				expect(failure?.value).toMatchObject({ role: 'agent', path: '/api/chat', status: 200 })
				expect(fixture.goal.evidence.some((row) => row.event === 'wire')).toBe(false)
				await provider.generate(STUDY_AGENT_MESSAGES, signal).then(
					() => undefined,
					() => undefined,
				)
				expect(fixture.server.requests).toHaveLength(1)
			} finally {
				await fixture.close()
			}
		},
	)

	it.each(STUDY_OLLAMA_STATUS_FAILURES)(
		'reads $name once under the wire bounds and accounts it before refusal',
		async ({ status, body, code, message }) => {
			const allowance = 2048
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body, status }], {
				limit: { duration: 2000, bytes: allowance },
			})
			try {
				const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY }
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
				const failure = requireStudyRecord(
					fixture.goal.evidence.find((row) => row.event === 'failure')?.value,
				)
				expect(failure).toMatchObject({ role: 'agent', status })
				// Observation is off, so the retained failure holds only its unobserved members.
				expect(Object.keys(failure).sort()).toEqual(['bytes', 'path', 'reason', 'role', 'status'])
				// Every byte read is retained, request included, up to the first chunk past the allowance.
				const read =
					encoder.encode(STUDY_OLLAMA_CHAT_BODY).byteLength + encoder.encode(body).byteLength
				expect(Math.min(Number(failure.bytes), allowance + 1)).toBe(Math.min(read, allowance + 1))
				expect(String(failure.reason)).toContain(message)
				expect(String(failure.reason).length).toBeLessThanOrEqual(256)
			} finally {
				await fixture.close()
			}
		},
	)

	it.each([
		[
			'a completion over its allowance',
			'agent',
			600,
			'Actual generation exceeded the output allowance',
		],
		[
			'a summary completion at its own output cap',
			'summary',
			256,
			'Substantive generation reached its output cap',
		],
	] as const)(
		'accounts the actual tokens and wire row before refusing %s',
		async (_name, role, completion, message) => {
			const fixture = await createOllamaTransportFixture([
				{ path: '/api/chat', body: buildOllamaRow({ prompt: 10, completion }) },
			])
			try {
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url, role)
				await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
					() => undefined,
					() => undefined,
				)
				const usage = fixture.goal.usage().map((row) => [row.role, row.tokens])
				expect(usage).toEqual([[role, 10 + completion]])
				const wire = fixture.goal.evidence.find((row) => row.event === 'wire')
				expect(wire?.value).toMatchObject({ role, prompt: 10, completion, finish: 'stop' })
				expect(fixture.goal.evidence.some((row) => row.event === 'failure')).toBe(false)
				expect(readStudyFailure(captureError(() => fixture.transport.check()))).toEqual({
					cause: 'capacity',
					message,
					role,
					stop: {
						layer: 'model',
						id: 'num_predict',
						max: role === 'summary' ? 256 : 512,
						consumed: completion,
					},
				})
			} finally {
				await fixture.close()
			}
		},
	)

	it('refuses a chat request whose reserved room exceeds the request token allowance before it reaches the server', async () => {
		const fixture = await createOllamaTransportFixture([], {
			room: { context: 65536, safety: 128 },
		})
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
				() => undefined,
				() => undefined,
			)
			expect(captureError(() => fixture.transport.check())).toMatchObject({
				code: 'CAPACITY',
				message: 'Request ceiling exceeds the request allowance',
			})
			expect(fixture.server.requests).toEqual([])
			expect(fixture.goal.usage()).toEqual([])
			expect(fixture.goal.evidence).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	it('aborts a hung response at its request deadline and retains the observed timeline without timing', async () => {
		const fixture = await createOllamaTransportFixture(
			[{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }],
			{ observe: true, limit: { duration: 200, bytes: 1048576 } },
		)
		try {
			const dispatch = { id: 1, revision: 'f'.repeat(64) }
			const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY }
			const outcome = await fixture.transport
				.fetch('agent', `${fixture.server.url}/api/chat`, init, dispatch)
				.then((response) => response.text())
				.then(
					() => undefined,
					(error: unknown) => error,
				)
			expect(outcome).toMatchObject({ name: 'TimeoutError' })
			expect(captureError(() => fixture.transport.check())).toBe(outcome)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			expect(fixture.goal.evidence.map((row) => row.event)).toEqual(['dispatch', 'failure'])
			const [sent, failure] = fixture.goal.evidence.map((row) => requireStudyRecord(row.value))
			expect(Object.keys(failure ?? {}).sort()).toEqual([
				'bytes',
				'canonical',
				'elapsed',
				'id',
				'path',
				'reason',
				'revision',
				'role',
				'sent',
				'started',
				'status',
			])
			expect(failure).toMatchObject({
				role: 'agent',
				path: '/api/chat',
				status: 200,
				id: sent?.id,
				canonical: 1,
				revision: 'f'.repeat(64),
			})
			expect(Number(failure?.elapsed)).toBeGreaterThan(0)
			// The request was admitted before it was sent, so its clock never starts after its send.
			expect(Number(failure?.sent)).toBeGreaterThanOrEqual(Number(failure?.started))
		} finally {
			await fixture.close()
		}
	})

	it('joins observed metadata, agent and judge dispatches to the previous model, reads raw judge units, keeps metadata timing null, and joins a canonical dispatch only to the agent requests the caller measured', async () => {
		const fixture = await createOllamaTransportFixture([], { observe: true })
		try {
			const signal = new AbortController().signal
			const revision = 'f'.repeat(64)
			const provider = createOllamaTransportProvider(
				fixture.transport,
				fixture.server.url,
				'agent',
				{
					id: 1,
					revision,
				},
			)
			const real = createOllamaJudgeFixture(
				fixture.server.url,
				(input: string | URL | Request, init?: RequestInit) =>
					fixture.transport.fetch('judge', input, init),
			)
			const judge = new StudyAgentJudge(real, fixture.transport)
			await provider.generate(STUDY_AGENT_MESSAGES, signal)
			await fixture.transport.verify()
			await judge.ask(STUDY_JUDGE_REQUEST, signal)
			await provider.generate(STUDY_AGENT_MESSAGES, signal)
			const dispatches = fixture.goal.evidence
				.filter((row) => row.event === 'dispatch')
				.map((row) => requireStudyRecord(row.value))
			expect(
				dispatches.map(({ id, role, model, previous, changed }) => [
					id,
					role,
					model,
					previous,
					changed,
				]),
			).toEqual([
				[1, 'agent', 'model', null, false],
				[2, 'metadata', null, 'model', false],
				[3, 'metadata', 'model', 'model', false],
				[4, 'metadata', 'judge', 'model', false],
				[5, 'judge', 'judge', 'model', true],
				[6, 'agent', 'model', 'judge', true],
			])
			const generate = requireValue(
				fixture.server.requests.find((request) => request.path === '/api/generate'),
			)
			const prompt = requireStudyRecord(parseJSON(generate.body)).prompt
			if (typeof prompt !== 'string') throw new Error('Missing raw judge prompt')
			expect(dispatches.map((value) => value.raw)).toEqual([
				undefined,
				undefined,
				undefined,
				undefined,
				{ encoding: 'utf-8', units: prompt.length, bytes: Buffer.byteLength(prompt, 'utf8') },
				undefined,
			])
			const wires = fixture.goal.evidence
				.filter((row) => row.event === 'wire')
				.map((row) => requireStudyRecord(row.value))
			const metadata = wires.filter((value) => value.role === 'metadata')
			expect(metadata.map((value) => value.timing)).toEqual([null, null, null])
			// Only the measured agent requests carry a canonical dispatch; metadata and judge rows join none.
			const joins = [
				['agent', 1, revision],
				['metadata', null, null],
				['metadata', null, null],
				['metadata', null, null],
				['judge', null, null],
				['agent', 1, revision],
			]
			expect(
				dispatches.map(({ role, canonical, revision: joined }) => [role, canonical, joined]),
			).toEqual(joins)
			expect(
				wires.map(({ role, canonical, revision: joined }) => [role, canonical, joined]),
			).toEqual(joins)
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
				stop: { layer: 'model', id: 'num_predict', max: 1, consumed: 1 },
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

	describe('configuration ownership', () => {
		const strictLabel = 'Ollama transport must disable native truncation and shifting'

		it.each(['strict flag', 'model', 'nested options', 'role'] as const)(
			'keeps a strict policy refusing an omitted truncate and shift after the caller changes its %s',
			async (axis) => {
				const roles = buildOllamaStrictRoles()
				const fixture = await createOllamaTransportFixture([], { roles })
				try {
					const changes = {
						'strict flag': () => Reflect.set(roles.agent, 'strict', false),
						model: () => Reflect.set(roles.agent, 'model', 'judge'),
						'nested options': () => Reflect.set(roles.agent.options, 'num_predict', 1),
						role: () => Reflect.set(roles, 'agent', undefined),
					}
					changes[axis]()
					const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
					await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
						() => undefined,
						() => undefined,
					)
					expect(captureError(() => fixture.transport.check())).toMatchObject({
						code: 'CONFIG',
						message: strictLabel,
					})
					expect(fixture.goal.usage()).toEqual([])
					expect(fixture.server.requests).toEqual([])
				} finally {
					await fixture.close()
				}
			},
		)

		it('keeps an originally non-strict policy working after the caller makes it strict', async () => {
			const roles = buildOllamaStrictRoles()
			Reflect.set(roles.agent, 'strict', false)
			const fixture = await createOllamaTransportFixture(
				[{ path: '/api/chat', body: buildOllamaStream(['ok'], { prompt: 1, completion: 1 }) }],
				{ roles },
			)
			try {
				Reflect.set(roles.agent, 'strict', true)
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
				expect(result.content).toBe('ok')
				expect(fixture.server.requests).toHaveLength(1)
				expect(() => fixture.transport.check()).not.toThrow()
			} finally {
				await fixture.close()
			}
		})

		it('keeps the declared request bounds after the caller shrinks its limit and room', async () => {
			const limit = { duration: 2000, bytes: 1048576 }
			const room = { context: 32768, safety: 128 }
			const fixture = await createOllamaTransportFixture(
				[{ path: '/api/chat', body: buildOllamaStream(['ok'], { prompt: 1, completion: 1 }) }],
				{ limit, room },
			)
			try {
				Reflect.set(limit, 'bytes', 1)
				Reflect.set(limit, 'duration', 1)
				Reflect.set(room, 'safety', 32768)
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
				expect(result.content).toBe('ok')
				expect(() => fixture.transport.check()).not.toThrow()
			} finally {
				await fixture.close()
			}
		})

		it('verifies the pinned inventory the caller declared after the caller changes its models', async () => {
			const models = {
				model: { name: 'model', digest: 'a'.repeat(64) },
				judge: { name: 'judge', digest: 'b'.repeat(64) },
			}
			const fixture = await createOllamaTransportFixture([], { models })
			try {
				Reflect.set(models.model, 'digest', 'c'.repeat(64))
				Reflect.set(models.judge, 'name', 'other')
				Reflect.set(models, 'extra', { name: 'extra', digest: 'd'.repeat(64) })
				await fixture.transport.verify()
				const inventory = fixture.goal.evidence.find((row) => row.event === 'inventory')
				expect(inventory?.value).toEqual({ model: 'a'.repeat(64), judge: 'b'.repeat(64) })
			} finally {
				await fixture.close()
			}
		})
	})

	describe('dispatch ownership', () => {
		it.each(['path', 'origin', 'body', 'headers', 'dispatch'] as const)(
			'sends and records the admitted request after the caller changes its %s before the meter answers',
			async (axis) => {
				const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
				const fixture = await createOllamaTransportFixture(
					[{ path: '/api/chat', body: reply }],
					{ observe: true },
					{ view: 'selected goal' },
				)
				try {
					const url = new URL(`${fixture.server.url}/api/chat`)
					const headers = new Headers({
						'content-type': 'application/json',
						'x-study-owned': 'original',
					})
					const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY, headers }
					const dispatch = { id: 1, revision: 'f'.repeat(64) }
					const pending = fixture.transport.fetch('agent', url, init, dispatch)
					const changes = {
						path: () => {
							url.pathname = '/outside'
						},
						origin: () => {
							url.port = '1'
						},
						body: () =>
							Reflect.set(
								init,
								'body',
								JSON.stringify({
									model: 'judge',
									stream: true,
									think: false,
									options: STUDY_OLLAMA_OPTIONS,
								}),
							),
						headers: () => headers.set('x-study-owned', 'changed'),
						dispatch: () => {
							Reflect.set(dispatch, 'id', 99)
							Reflect.set(dispatch, 'revision', '0'.repeat(64))
						},
					}
					changes[axis]()
					const response = await pending
					await response.text()
					expect(fixture.server.requests).toEqual([
						{ path: '/api/chat', body: STUDY_OLLAMA_CHAT_BODY },
					])
					expect(fixture.server.owned).toEqual(['original'])
					const [sent, wire] = fixture.goal.evidence.map((row) => requireStudyRecord(row.value))
					expect(sent).toMatchObject({
						role: 'agent',
						path: '/api/chat',
						model: 'model',
						bytes: encoder.encode(STUDY_OLLAMA_CHAT_BODY).byteLength,
						canonical: 1,
						revision: 'f'.repeat(64),
						body: STUDY_OLLAMA_CHAT_BODY,
					})
					expect(wire).toMatchObject({ canonical: 1, revision: 'f'.repeat(64) })
				} finally {
					await fixture.close()
				}
			},
		)

		it('still cancels an admitted request through the caller signal and sends nothing', async () => {
			const fixture = await createOllamaTransportFixture()
			try {
				const controller = new AbortController()
				const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY, signal: controller.signal }
				const pending = fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, init)
				controller.abort(new Error('Caller cancelled'))
				const outcome = await pending.then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(outcome).toBeInstanceOf(Error)
				expect(outcome).toHaveProperty('message', 'Caller cancelled')
				expect(fixture.server.requests).toEqual([])
			} finally {
				await fixture.close()
			}
		})

		it('still refuses a Request input before admission', async () => {
			const fixture = await createOllamaTransportFixture()
			try {
				const input = new Request(`${fixture.server.url}/api/chat`)
				const outcome = await fixture.transport.fetch('agent', input).then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(outcome).toMatchObject({
					code: 'CONFIG',
					message: 'Ollama transport requires explicit URL requests',
				})
				expect(fixture.goal.usage()).toEqual([])
				expect(fixture.server.requests).toEqual([])
			} finally {
				await fixture.close()
			}
		})
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
			const failure = fixture.goal.evidence.find((row) => row.event === 'failure')
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
				const calls = createRecorder<[]>()
				const failing: JudgeInterface = {
					id: 'judge',
					name: 'ollama',
					model: 'judge',
					ask: () => {
						calls.handler()
						return Promise.reject(thrown)
					},
				}
				const judge = new StudyAgentJudge(failing, fixture.transport)
				const signal = new AbortController().signal
				const outcomes: Array<{ readonly error: unknown }> = []
				for (const request of [STUDY_JUDGE_REQUEST, STUDY_JUDGE_REQUEST]) {
					try {
						await judge.ask(request, signal)
					} catch (error) {
						outcomes.push({ error })
					}
				}
				expect(outcomes).toHaveLength(2)
				for (const outcome of outcomes) expect(outcome.error).toBe(thrown)
				expect(calls.calls).toEqual([[]])
			} finally {
				await fixture.close()
			}
		},
	)

	describe('goal binding', () => {
		const unbound = { code: 'FAULT', message: 'Model dispatch outside an active goal' }

		it('refuses dispatch and verification with no bound goal, before admission or any request', async () => {
			const transport = new StudyOllamaTransport(buildOllamaTransportOptions('http://127.0.0.1:1'))
			try {
				await expect(
					transport.fetch('agent', 'http://127.0.0.1:1/api/chat', {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					}),
				).rejects.toMatchObject(unbound)
				expect(() => transport.check()).not.toThrow()
				await expect(transport.verify()).rejects.toMatchObject(unbound)
				expect(captureError(() => transport.check())).toMatchObject(unbound)
			} finally {
				await transport.close()
			}
		})

		it('ends the bound goal on clear, refuses later dispatch, and binds the next prepared goal', async () => {
			const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }])
			try {
				fixture.transport.clear()
				await expect(
					fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					}),
				).rejects.toMatchObject(unbound)
				expect(fixture.server.requests).toEqual([])
				expect(fixture.goal.usage()).toEqual([])
				expect(fixture.goal.evidence).toEqual([])
				expect(() => fixture.transport.clear()).not.toThrow()
				fixture.transport.prepare({
					goal: 'again',
					context: fixture.goal.context,
					checkpoint: undefined,
				})
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
				expect(result.content).toBe('ok')
				expect(fixture.goal.evidence.map((row) => [row.event, row.goal])).toEqual([
					['dispatch', 'again'],
					['wire', 'again'],
				])
				await fixture.transport.close()
				expect(() => fixture.transport.clear()).not.toThrow()
			} finally {
				await fixture.close()
			}
		})

		it('refuses a second preparation while a goal is bound and keeps the bound goal', async () => {
			const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }])
			try {
				const next = { goal: 'second', context: fixture.goal.context, checkpoint: undefined }
				expect(captureError(() => fixture.transport.prepare(next))).toMatchObject({
					code: 'FAULT',
					message: 'Previous goal is still bound',
				})
				expect(() => fixture.transport.check()).not.toThrow()
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
				expect(fixture.goal.evidence.map((row) => [row.event, row.goal])).toEqual([
					['dispatch', 'first'],
					['wire', 'first'],
				])
			} finally {
				await fixture.close()
			}
		})

		it('binds each goal evidence and checkpoint to its own goal and carries the previous model across goals', async () => {
			const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
			const fixture = await createOllamaTransportFixture(
				[
					{ path: '/api/chat', body: reply },
					{ path: '/api/chat', body: reply },
					{ path: '/api/chat', body: reply },
				],
				{ observe: true },
				{ view: 'first' },
			)
			const second = createOllamaContext()
			try {
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const signal = new AbortController().signal
				await provider.generate(STUDY_AGENT_MESSAGES, signal)
				fixture.transport.clear()
				fixture.transport.prepare({
					goal: 'second',
					context: second.context,
					checkpoint: { view: 'second' },
				})
				await provider.generate(STUDY_AGENT_MESSAGES, signal)
				await provider.generate(STUDY_AGENT_MESSAGES, signal)
				const opened = fixture.goal.evidence
					.filter((row) => row.event === 'dispatch')
					.map((row) => requireStudyRecord(row.value))
				const resumed = second.evidence
					.filter((row) => row.event === 'dispatch')
					.map((row) => requireStudyRecord(row.value))
				expect(opened).toHaveLength(1)
				expect(opened[0]).toMatchObject({ id: 1, previous: null, snapshot: { view: 'first' } })
				const [carried, later] = resumed
				expect(carried).toMatchObject({
					id: 2,
					previous: 'model',
					changed: false,
					snapshot: { view: 'second' },
				})
				expect(later).toMatchObject({ id: 3 })
				expect(later).not.toHaveProperty('snapshot')
				expect(fixture.goal.evidence.every((row) => row.goal === 'first')).toBe(true)
				expect(second.evidence.every((row) => row.goal === 'second')).toBe(true)
				expect(second.evidence.map((row) => row.event)).toEqual([
					'dispatch',
					'wire',
					'dispatch',
					'wire',
				])
			} finally {
				await fixture.close()
				second.close()
			}
		})

		it('attaches each goal checkpoint to that goal own first dispatch when the next goal is prepared during an admission', async () => {
			const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
			const fixture = await createOllamaTransportFixture(
				[
					{ path: '/api/chat', body: reply },
					{ path: '/api/chat', body: reply },
				],
				{ observe: true },
				{ view: 'first' },
			)
			const second = createOllamaContext()
			try {
				const url = `${fixture.server.url}/api/chat`
				const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY }
				const pending = fixture.transport.fetch('agent', url, init)
				// Both calls pass: no wire exists yet, so the request is suspended in its admission.
				fixture.transport.clear()
				fixture.transport.prepare({
					goal: 'second',
					context: second.context,
					checkpoint: { view: 'second' },
				})
				await (await pending).text()
				await (await fixture.transport.fetch('agent', url, init)).text()
				expect(fixture.goal.evidence.map((row) => [row.event, row.goal])).toEqual([
					['dispatch', 'first'],
					['wire', 'first'],
				])
				expect(requireStudyRecord(fixture.goal.evidence[0]?.value).snapshot).toEqual({
					view: 'first',
				})
				expect(second.evidence.map((row) => [row.event, row.goal])).toEqual([
					['dispatch', 'second'],
					['wire', 'second'],
				])
				expect(requireStudyRecord(second.evidence[0]?.value).snapshot).toEqual({ view: 'second' })
			} finally {
				await fixture.close()
				second.close()
			}
		})
	})

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
			// The timeline orders admission, send and settlement.
			expect(Number(onWire?.sent)).toBeGreaterThanOrEqual(Number(onWire?.started))
			expect(Number(onWire?.elapsed)).toBeGreaterThanOrEqual(0)
		} finally {
			await off.close()
			await on.close()
		}
	})

	it('runs the timing extractor once, on the terminal row of a streamed reply', async () => {
		const reply = buildOllamaStream(['Re', 'ceipt'], {
			prompt: 7,
			completion: 2,
			fields: { total_duration: 1234 },
		})
		const extractions = createRecorder<readonly [Readonly<Record<string, unknown>>]>()
		const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }], {
			observe: true,
			timing: (record) => {
				extractions.handler(record)
				return extractTiming(record)
			},
		})
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
			expect(result.content).toBe('Receipt')
			expect(extractions.calls).toMatchObject([[{ done: true, total_duration: 1234 }]])
			const wire = requireStudyRecord(
				fixture.goal.evidence.find((row) => row.event === 'wire')?.value,
			)
			expect(wire.timing).toMatchObject({ durations: { total: 1234 } })
		} finally {
			await fixture.close()
		}
	})
})

describe('transport stop chain', () => {
	it('names the encoded request byte refusal before any admission', async () => {
		const fixture = await createOllamaTransportFixture([], { limit: { duration: 2000, bytes: 1 } })
		try {
			await expect(
				fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				}),
			).rejects.toMatchObject({
				failure: {
					cause: 'capacity',
					role: undefined,
					stop: {
						layer: 'scope',
						id: 'Wire bytes',
						max: 1,
						consumed: Buffer.byteLength(STUDY_OLLAMA_CHAT_BODY),
					},
				},
			})
			expect(fixture.goal.usage()).toEqual([])
			expect(fixture.server.requests).toEqual([])
		} finally {
			await fixture.close()
		}
	})
	it('records a model cap after the wire with completion distinct from the cap and joins observed ids', async () => {
		for (const observe of STUDY_STOP_SWITCHES) {
			const fixture = await createOllamaTransportFixture(
				[
					{
						path: '/api/chat',
						body: buildOllamaRow({ reason: 'length', prompt: 7, completion: 9 }),
					},
				],
				{ observe },
			)
			try {
				const response = await fixture.transport.fetch(
					'agent',
					`${fixture.server.url}/api/chat`,
					{ method: 'POST', body: STUDY_OLLAMA_CHAT_BODY },
					{ id: 3, revision: 'f'.repeat(64) },
				)
				await expect(response.text()).rejects.toMatchObject({
					failure: { stop: { layer: 'model', id: 'num_predict', max: 512, consumed: 9 } },
				})
				expect(fixture.goal.evidence.map((row) => row.event)).toEqual(['dispatch', 'wire', 'stop'])
				const stopped = requireStudyRecord(fixture.goal.evidence[2]?.value)
				expect(stopped).toMatchObject({
					role: 'agent',
					path: '/api/chat',
					finish: 'length',
					prompt: 7,
					completion: 9,
					stop: { layer: 'model', id: 'num_predict', max: 512, consumed: 9 },
				})
				expect(stopped.id).toBe(observe ? 1 : undefined)
				expect(stopped.canonical).toBe(observe ? 3 : undefined)
				expect(stopped.revision).toBe(observe ? 'f'.repeat(64) : undefined)
				expect(typeof stopped.started).toBe(observe ? 'number' : 'undefined')
				expect(typeof stopped.sent).toBe(observe ? 'number' : 'undefined')
				expect(typeof stopped.elapsed).toBe(observe ? 'number' : 'undefined')
			} finally {
				await fixture.close()
			}
		}
	})

	it('records Context room refusals and records no stop for unsupported finish reasons', async () => {
		for (const window of STUDY_STOP_SWITCHES) {
			const fixture = await createOllamaTransportFixture([
				{
					path: '/api/chat',
					body: buildOllamaRow({
						reason: window ? 'stop' : 'unsupported',
						prompt: window ? 32300 : 7,
						completion: 1,
					}),
				},
			])
			try {
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				await expect(response.text()).rejects.toMatchObject({ code: window ? 'CAPACITY' : 'FAULT' })
				expect(fixture.goal.evidence.map((row) => row.event)).toEqual(
					window ? ['dispatch', 'wire', 'stop'] : ['dispatch', 'wire'],
				)
				expect(fixture.goal.evidence[2]?.value).toEqual(
					window
						? {
								role: 'agent',
								path: '/api/chat',
								finish: 'stop',
								prompt: 32300,
								completion: 1,
								stop: { layer: 'window', id: 'Context room', max: 32128, consumed: 32300 },
							}
						: undefined,
				)
			} finally {
				await fixture.close()
			}
		}
	})

	it('cuts a foreign budget abort during pull and accounts known bytes without latching it', async () => {
		const fixture = await createOllamaTransportFixture(
			[{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }],
			{ observe: true },
		)
		try {
			const controller = new AbortController()
			const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
				signal: controller.signal,
			})
			const reader = requireValue(response.body).getReader()
			await reader.read()
			const reason = createForeignBudgetError()
			controller.abort(reason)
			await expect(reader.read()).rejects.toBe(reason)
			expect(fixture.goal.usage()).toMatchObject([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: expect.any(Number) },
			])
			expect(fixture.goal.evidence.map((row) => row.event)).toEqual(['dispatch', 'cut'])
			expect(fixture.goal.evidence[1]?.value).toMatchObject({
				role: 'agent',
				path: '/api/chat',
				status: 200,
				budget: { id: 'foreign', max: 1, consumed: 2 },
				id: 1,
			})
			expect(() => fixture.transport.check()).not.toThrow()
			fixture.transport.clear()
			expect(() =>
				fixture.transport.prepare({
					goal: 'second',
					context: fixture.goal.context,
					checkpoint: undefined,
				}),
			).not.toThrow()
		} finally {
			await fixture.close()
		}
	})

	it('cuts cancellation with a foreign budget and fails an unbranded cancellation', async () => {
		for (const branded of STUDY_STOP_SWITCHES) {
			const fixture = await createOllamaTransportFixture([
				{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
			])
			try {
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				const reader = requireValue(response.body).getReader()
				await reader.read()
				const reason = branded ? createForeignBudgetError() : createBudgetLookalike()
				await reader.cancel(reason)
				expect(fixture.goal.evidence.map((row) => row.event)).toEqual([
					'dispatch',
					branded ? 'cut' : 'failure',
				])
				expect(captureError(() => fixture.transport.check())).toBe(branded ? undefined : reason)
				expect(fixture.goal.usage()[0]?.tokens).toBeUndefined()
				expect(typeof fixture.goal.usage()[0]?.bytes).toBe(branded ? 'number' : 'undefined')
			} finally {
				await fixture.close()
			}
		}
	})

	it('accounts a branded abort before the wire exists and retains no failure', async () => {
		const fixture = await createOllamaTransportFixture()
		try {
			const controller = new AbortController()
			const reason = createForeignBudgetError()
			controller.abort(reason)
			await expect(
				fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
					signal: controller.signal,
				}),
			).rejects.toBe(reason)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			expect(fixture.server.requests).toEqual([])
			expect(fixture.goal.evidence).toEqual([])
			expect(() => fixture.transport.check()).not.toThrow()
		} finally {
			await fixture.close()
		}
	})

	it('retains a Study refusal raised while writing a cut and delivers the stream error', async () => {
		const fixture = await createOllamaTransportFixture([
			{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
		])
		const refusal = new StudyError('CAPACITY', 'Evidence full', {
			cause: 'capacity',
			message: 'Evidence full',
			role: undefined,
			stop: { layer: 'custody', id: 'Goal evidence', max: 1, consumed: 2 },
		})
		try {
			fixture.transport.clear()
			fixture.transport.prepare({
				goal: 'first',
				checkpoint: undefined,
				context: {
					...fixture.goal.context,
					evidence: {
						append: async (row) => {
							if (row.event === 'cut') throw refusal
							await fixture.goal.context.evidence.append(row)
						},
					},
				},
			})
			const controller = new AbortController()
			const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
				signal: controller.signal,
			})
			const reader = requireValue(response.body).getReader()
			await reader.read()
			const reason = createForeignBudgetError()
			controller.abort(reason)
			await expect(reader.read()).rejects.toBe(reason)
			expect(captureError(() => fixture.transport.check())).toBe(refusal)
			expect(fixture.goal.meter.control.failure?.stop).toEqual({
				layer: 'custody',
				id: 'Goal evidence',
				max: 1,
				consumed: 2,
			})
		} finally {
			await fixture.close()
		}
	})
})
