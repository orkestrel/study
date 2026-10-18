import type { ProviderRequest } from '@orkestrel/agent'
import { describe, expect, it } from 'vitest'
import { Agent, createConversationManager, estimateRequest, measureRequest } from '@orkestrel/agent'
import { createBudget } from '@orkestrel/budget'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { createOllama } from '@orkestrel/ollama'
import { createTool, createToolManager } from '@orkestrel/tool'
import { StudyError } from '../../../../src/core/errors.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'
import {
	STUDY_AGENT_GAUGE,
	STUDY_AGENT_MESSAGES,
	STUDY_AGENT_MISSES,
	STUDY_AGENT_OPTIONS,
	STUDY_AGENT_PROJECTION,
	STUDY_AGENT_REFUSALS,
	STUDY_AGENT_TOOLS,
	STUDY_AGENT_USAGE_FAILURE,
	STUDY_OLLAMA_OPTIONS,
	STUDY_OLLAMA_ORIGIN,
	STUDY_OLLAMA_PARTIAL_ROW,
	buildOllamaCall,
	buildOllamaRow,
	buildOllamaStream,
	createAgentObserver,
	createOllamaFetch,
	readOllamaToolResults,
	readProviderStream,
} from '../../../setupStudy.js'

const messages = STUDY_AGENT_MESSAGES
const tools = STUDY_AGENT_TOOLS
const options = STUDY_AGENT_OPTIONS

describe('StudyAgentObserver', () => {
	it.each(['generate', 'stream'] as const)(
		'%s delegates once, records before the wire, and sends the bytes an unobserved provider sends',
		async (mode) => {
			const body =
				mode === 'generate'
					? buildOllamaRow({ content: 'Receipt', prompt: 7 })
					: buildOllamaStream(['Re', 'ceipt'], { prompt: 7 })
			const plainWire = createOllamaFetch([{ path: '/api/chat', body }])
			const watchedWire = createOllamaFetch([{ path: '/api/chat', body }])
			const plain = createAgentObserver(plainWire, undefined, false)
			const watched = createAgentObserver(watchedWire, undefined, false)
			const signal = new AbortController().signal
			const expected =
				mode === 'generate'
					? await plain.inner.generate(messages, signal, tools, options)
					: await readProviderStream(plain.inner.stream(messages, signal, tools, options))
			const pending =
				mode === 'generate'
					? watched.observer.generate(messages, signal, tools, options)
					: readProviderStream(watched.observer.stream(messages, signal, tools, options))
			expect(watched.readings).toHaveLength(1)
			expect(watchedWire.requests).toEqual([])
			expect(await pending).toEqual(expected)
			expect(watchedWire.requests).toHaveLength(1)
			expect(watchedWire.requests).toEqual(plainWire.requests)
			const sent = parseJSON(watchedWire.requests[0]?.body ?? '')
			if (!isRecord(sent)) throw new Error('Invalid chat request')
			expect(sent).toMatchObject({ model: 'model', think: false, options: STUDY_OLLAMA_OPTIONS })
			expect(watched.readings).toEqual([
				{ estimate: estimateRequest({ messages, tools, options }), projected: undefined },
			])
		},
	)

	it('detects a changed request byte between two providers, so the equality comparison can fail', async () => {
		const plainWire = createOllamaFetch()
		const changedWire = createOllamaFetch()
		const plain = createAgentObserver(plainWire, undefined, false)
		const changed = createOllama({
			model: 'model',
			url: STUDY_OLLAMA_ORIGIN,
			think: false,
			fetch: changedWire.fetch,
			options: { ...STUDY_OLLAMA_OPTIONS, temperature: 1 },
		})
		const signal = new AbortController().signal
		await plain.observer.generate(messages, signal, tools, options)
		await changed.generate(messages, signal, tools, options)
		expect(plainWire.requests).toHaveLength(1)
		expect(changedWire.requests).toHaveLength(1)
		expect(changedWire.requests).not.toEqual(plainWire.requests)
	})

	it('yields streamed deltas in wire order and returns the assembled result', async () => {
		const wire = createOllamaFetch([
			{ path: '/api/chat', body: buildOllamaStream(['Re', 'ce', 'ipt'], { prompt: 7 }) },
		])
		const { observer } = createAgentObserver(wire, undefined, false)
		const { deltas, result } = await readProviderStream(
			observer.stream(messages, new AbortController().signal, tools, options),
		)
		expect(deltas).toEqual([
			{ channel: 'content', text: 'Re' },
			{ channel: 'content', text: 'ce' },
			{ channel: 'content', text: 'ipt' },
		])
		expect(result.content).toBe('Receipt')
		expect(result.usage?.prompt).toBe(7)
	})

	it('hands the recorder the exact pre-encoding request, keeping omitted members omitted', async () => {
		const wire = createOllamaFetch()
		const watched = createAgentObserver(wire, undefined, false)
		const signal = new AbortController().signal
		const schema = { type: 'object', properties: { count: { type: 'number' } } }
		await watched.observer.generate(messages, signal)
		await watched.observer.generate(messages, signal, tools, { think: false, schema })
		await watched.observer.generate(messages, signal, [], undefined)
		const [bare, full, empty] = watched.requests
		expect(Object.keys(bare ?? {})).toEqual(['messages'])
		expect(bare?.messages).toBe(messages)
		expect(full).toEqual({ messages, tools, options: { think: false, schema } })
		expect(Object.keys(empty ?? {})).toEqual(['messages', 'tools'])
		// Every reading is the actual Agent estimate of the request handed over beside it.
		expect(watched.readings.map((reading) => reading.estimate)).toEqual(
			watched.requests.map((request) => estimateRequest(request)),
		)
		const parts = measureRequest(full ?? { messages })
		expect(parts.tools).toBeGreaterThan(0)
		expect(parts.schema).toBeGreaterThan(0)
		expect(measureRequest(bare ?? { messages })).toMatchObject({ tools: 0, schema: 0 })
		expect(wire.requests).toHaveLength(3)
	})

	it('prices each reading by the explicit gauge and prices nothing without one', async () => {
		const priced = createAgentObserver(createOllamaFetch(), { scale: 2, overhead: 5 }, false)
		const unpriced = createAgentObserver(createOllamaFetch(), undefined, false)
		const signal = new AbortController().signal
		await priced.observer.generate(messages, signal, tools, options)
		await unpriced.observer.generate(messages, signal, tools, options)
		const estimate = estimateRequest({ messages, tools, options })
		expect(priced.readings).toEqual([{ estimate, projected: Math.ceil(2 * estimate + 5) }])
		expect(unpriced.readings).toEqual([{ estimate, projected: undefined }])
	})

	it.each(['generate', 'stream'] as const)(
		'%s returns a prompt that misses the projection upward exactly as the real provider does',
		async (mode) => {
			for (const row of STUDY_AGENT_MISSES) {
				const body = mode === 'generate' ? buildOllamaRow(row) : buildOllamaStream(['Re'], row)
				const reply = { path: '/api/chat', body }
				const plain = createAgentObserver(createOllamaFetch([reply]), undefined, false)
				const watched = createAgentObserver(createOllamaFetch([reply]), STUDY_AGENT_GAUGE, true)
				const signal = new AbortController().signal
				const expected =
					mode === 'generate'
						? await plain.inner.generate(messages, signal, tools, options)
						: await readProviderStream(plain.inner.stream(messages, signal, tools, options))
				const returned =
					mode === 'generate'
						? await watched.observer.generate(messages, signal, tools, options)
						: await readProviderStream(watched.observer.stream(messages, signal, tools, options))
				expect([row, returned]).toEqual([row, expected])
				expect(watched.readings.map((reading) => reading.projected)).toEqual([
					STUDY_AGENT_PROJECTION,
				])
			}
		},
	)

	it.each(['generate', 'stream'] as const)(
		'%s refuses every unusable return with the exact attributable error only under the enforced policy',
		async (mode) => {
			for (const { name, row } of STUDY_AGENT_REFUSALS) {
				const body = mode === 'generate' ? buildOllamaRow(row) : buildOllamaStream(['Re'], row)
				const enforcedWire = createOllamaFetch([{ path: '/api/chat', body }])
				const passiveWire = createOllamaFetch([{ path: '/api/chat', body }])
				const enforced = createAgentObserver(enforcedWire, STUDY_AGENT_GAUGE, true)
				const passive = createAgentObserver(passiveWire, STUDY_AGENT_GAUGE, false)
				const signal = new AbortController().signal
				const outcome = await (
					mode === 'generate'
						? enforced.observer.generate(messages, signal, tools, options)
						: readProviderStream(enforced.observer.stream(messages, signal, tools, options))
				).then(
					() => undefined,
					(error: unknown) => error,
				)
				expect([name, outcome]).toEqual([name, expect.any(StudyError)])
				expect([name, outcome]).toMatchObject([name, { code: 'FAULT' }])
				expect([name, readStudyFailure(outcome)]).toEqual([name, STUDY_AGENT_USAGE_FAILURE])
				expect(enforcedWire.requests).toHaveLength(1)
				const accepted =
					mode === 'generate'
						? await passive.observer.generate(messages, signal, tools, options)
						: await readProviderStream(passive.observer.stream(messages, signal, tools, options))
				const content = 'result' in accepted ? accepted.result.content : accepted.content
				expect([name, content]).toEqual([name, mode === 'generate' ? 'Receipt retained.' : 'Re'])
				expect(passive.readings.map((reading) => reading.projected)).toEqual([
					STUDY_AGENT_PROJECTION,
				])
			}
		},
	)

	it.each([
		['an unenforced', false],
		['an enforced', true],
	] as const)(
		'preserves the real provider abort through %s observer and takes no usage decision',
		async (_name, enforced) => {
			const held = { path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }
			const wire = createOllamaFetch([held, held])
			const watched = createAgentObserver(wire, STUDY_AGENT_GAUGE, enforced)
			const outcomes: unknown[] = []
			for (const target of [watched.inner, watched.observer]) {
				const controller = new AbortController()
				const stream = target.stream(messages, controller.signal, tools, options)
				expect(await stream.next()).toEqual({
					done: false,
					value: { channel: 'content', text: 'par' },
				})
				controller.abort()
				outcomes.push(
					await stream.next().then(
						() => undefined,
						(error: unknown) => error,
					),
				)
			}
			expect(watched.readings).toHaveLength(1)
			for (const outcome of outcomes) {
				expect(outcome).toMatchObject({ code: 'ABORT', partial: { content: 'par' } })
				expect(outcome).not.toBeInstanceOf(StudyError)
			}
		},
	)

	it('records the single reading when the observed stream is created, before any delta is read', async () => {
		const wire = createOllamaFetch([
			{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
		])
		const watched = createAgentObserver(wire, STUDY_AGENT_GAUGE, true)
		const controller = new AbortController()
		const stream = watched.observer.stream(messages, controller.signal, tools, options)
		expect(watched.readings).toHaveLength(1)
		expect(wire.requests).toEqual([])
		await stream.next()
		controller.abort()
		await stream.next().then(
			() => undefined,
			() => undefined,
		)
		expect(watched.readings).toHaveLength(1)
	})

	it('forwards identity and the declared replay policy, reporting none when the real provider reports none', () => {
		const fallback = createAgentObserver(createOllamaFetch(), undefined, false)
		expect(fallback.observer.id).toBe(fallback.inner.id)
		expect(fallback.observer.name).toBe(fallback.inner.name)
		expect(fallback.observer.name).toBe('ollama')
		expect(fallback.observer.replay).toBe(fallback.inner.replay ?? 'none')
		expect(createAgentObserver(createOllamaFetch(), undefined, false, 'all').observer.replay).toBe(
			'all',
		)
		expect(createAgentObserver(createOllamaFetch(), undefined, false, 'turn').observer.replay).toBe(
			'turn',
		)
	})

	it('measures the same complete request the Agent window measures', async () => {
		const wire = createOllamaFetch([
			{ path: '/api/chat', body: buildOllamaStream(['Receipt retained.'], { prompt: 7 }) },
		])
		const manager = createConversationManager()
		const conversation = manager.add({})
		try {
			const watched = createAgentObserver(wire, undefined, false)
			const measured: number[] = []
			const agent = new Agent(watched.observer, {
				conversations: manager,
				strict: true,
				limit: 8,
				window: createBudget<ProviderRequest>({
					max: 30000,
					consumer: (request) => {
						const value = estimateRequest(request)
						measured.push(value)
						return value
					},
				}),
			})
			agent.context.instructions.add({ name: 'desk', content: 'You operate a support desk.' })
			conversation.add({ role: 'user', content: 'Count the orders' })
			try {
				const result = await agent.generate({ signal: new AbortController().signal })
				expect(result.content).toBe('Receipt retained.')
				expect(watched.readings).toHaveLength(1)
				expect(measured.length).toBeGreaterThan(0)
				expect(new Set(measured)).toEqual(new Set([watched.readings[0]?.estimate]))
				expect(wire.requests.filter((entry) => entry.path === '/api/chat')).toHaveLength(1)
			} finally {
				agent.emitter.destroy()
			}
		} finally {
			conversation.emitter.destroy()
		}
	})

	it.each([
		{
			name: 'a projection miss',
			reply: { prompt: STUDY_AGENT_PROJECTION + 1 },
			outcome: expect.objectContaining({ content: 'Follow-up received' }),
			chats: 2,
			unsent: 0,
		},
		{
			name: 'unknown counts',
			reply: { unknown: true },
			outcome: expect.objectContaining({
				code: 'FAULT',
				failure: expect.objectContaining({ cause: 'infrastructure', role: 'agent' }),
			}),
			chats: 1,
			unsent: 1,
		},
	])(
		'continues or stops the Agent tool turn by the usable prompt count alone for $name',
		async ({ reply, outcome, chats, unsent }) => {
			const wire = createOllamaFetch([
				{ path: '/api/chat', body: buildOllamaCall(reply) },
				{ path: '/api/chat', body: buildOllamaRow({ content: 'Follow-up received' }) },
			])
			const manager = createConversationManager()
			const conversation = manager.add({})
			const toolbox = createToolManager()
			toolbox.add(
				createTool({
					name: 'lookup',
					description: 'Reads a record',
					parameters: {
						type: 'object',
						properties: { id: { type: 'string' } },
						required: ['id'],
						additionalProperties: false,
					},
					execute: () => 'No record',
				}),
			)
			try {
				const watched = createAgentObserver(wire, STUDY_AGENT_GAUGE, true)
				const agent = new Agent(watched.observer, {
					conversations: manager,
					tools: toolbox,
					strict: true,
					limit: 8,
				})
				conversation.add({ role: 'user', content: 'Look up order-1' })
				try {
					const returned = await agent.generate({ signal: new AbortController().signal }).then(
						(result) => result,
						(error: unknown) => error,
					)
					expect(returned).toEqual(outcome)
					const sent = wire.requests.filter((entry) => entry.path === '/api/chat')
					expect(sent).toHaveLength(chats)
					expect(wire.replies).toHaveLength(unsent)
					expect(watched.readings.map((reading) => reading.projected)).toEqual(
						sent.map(() => STUDY_AGENT_PROJECTION),
					)
					// A completed tool turn feeds its receipt to the follow-up request; a stopped one never runs the tool.
					expect(sent.slice(1).map((entry) => readOllamaToolResults(entry.body))).toEqual(
						sent.slice(1).map(() => ['No record']),
					)
				} finally {
					agent.emitter.destroy()
				}
			} finally {
				toolbox.destroy()
				conversation.emitter.destroy()
			}
		},
	)
})
