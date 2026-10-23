import { describe, expect, it } from 'vitest'
import { captureError, createRecorder, requireValue } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { StudyExchangeSink } from '../../../../src/server/stores/StudyExchangeSink.js'
import {
	buildStudyOllamaTransportOptions,
	buildStudyOllamaSnapshot,
} from '../../../../src/server/ollama/cloners.js'
import { STUDY_OLLAMA_ORIGIN } from '../../../setupStudy.js'
import {
	buildOllamaStep,
	buildOllamaDeclaration,
	buildOllamaTransportOptions,
} from '../../../setupServer.js'

const options = buildOllamaTransportOptions(STUDY_OLLAMA_ORIGIN)
const agentPolicy = requireValue(options.roles.agent)
const chat = `${STUDY_OLLAMA_ORIGIN}/api/chat`

describe('buildStudyOllamaTransportOptions', () => {
	it('owns every recording declaration once and retains only the sink live identity', async () => {
		const scratch = createScratch()
		const declaration = buildOllamaDeclaration()
		const sink = new StudyExchangeSink({
			file: await open(join(scratch.path, 'exchanges.jsonl'), 'wx'),
			record: declaration.record,
		})
		try {
			const reads = createRecorder<[]>()
			const step = buildOllamaStep('exact')
			const policy = step.policy
			Object.defineProperty(step, 'policy', {
				enumerable: true,
				get: () => {
					reads.handler()
					return policy
				},
			})
			const caller = buildOllamaTransportOptions(STUDY_OLLAMA_ORIGIN, {
				exchanges: sink,
			})
			await sink.append({ ...declaration, procedure: [step] })
			const owned = buildStudyOllamaTransportOptions(caller)
			expect(reads.calls).toEqual([[]])
			Reflect.set(step, 'body', 'changed')
			Reflect.set(policy.options, 'seed', 2)
			Reflect.set(caller.metadata, 'calls', 1)
			expect(owned.metadata.calls).toBe(32)
			expect(owned.exchanges?.declaration?.procedure?.[0]?.policy.options.seed).toBe(0)
			expect(owned.exchanges?.declaration?.procedure?.[0]).toMatchObject({
				admission: 'exact',
				body: expect.stringContaining('model'),
			})
			expect(owned.exchanges).toBe(caller.exchanges)
			expect(Object.isFrozen(owned.exchanges?.declaration?.procedure)).toBe(true)
			expect(Object.isFrozen(owned.exchanges?.declaration?.procedure?.[0]?.policy.options)).toBe(
				true,
			)
		} finally {
			await sink.close()
			scratch.destroy()
		}
	})
	it('reads the collaborator once and retains its callable identity without freezing it', () => {
		const reads = createRecorder<[]>()
		const caller = buildOllamaTransportOptions(STUDY_OLLAMA_ORIGIN, {
			fetch: (_role, input, init) => globalThis.fetch(input, init),
		})
		const fetch = caller.fetch
		Object.defineProperty(caller, 'fetch', {
			enumerable: true,
			get: () => {
				reads.handler()
				return fetch
			},
		})
		const owned = buildStudyOllamaTransportOptions(caller)
		expect(reads.calls).toEqual([[]])
		expect(owned.fetch).toBe(fetch)
		expect(Object.isFrozen(owned.fetch)).toBe(false)
		expect('fetch' in buildStudyOllamaTransportOptions(options)).toBe(false)
	})

	it('owns frozen copies of every data member and leaves the caller objects mutable', () => {
		const owned = buildStudyOllamaTransportOptions(options)
		expect(owned).toEqual(options)
		expect(owned.signal).toBe(options.signal)
		expect(owned.timing).toBe(options.timing)
		const members = [
			owned,
			owned.room,
			owned.limit,
			owned.models,
			owned.models.model,
			owned.roles,
			owned.roles.agent,
			owned.roles.agent?.options,
		]
		for (const member of members) expect(Object.isFrozen(member)).toBe(true)
		expect(owned.room).not.toBe(options.room)
		expect(owned.models.model).not.toBe(options.models.model)
		expect(owned.roles.agent).not.toBe(options.roles.agent)
		expect(owned.roles.agent?.options).not.toBe(options.roles.agent?.options)
		expect(Object.isFrozen(options.room)).toBe(false)
		expect(Object.isFrozen(options.roles.agent)).toBe(false)
	})

	it('is unaffected by later changes to the caller objects and omits an undefined policy', () => {
		const caller = {
			...options,
			room: { ...options.room },
			roles: { agent: { ...agentPolicy, options: { ...agentPolicy.options } } },
		}
		Reflect.set(caller.roles, 'summary', undefined)
		const owned = buildStudyOllamaTransportOptions(caller)
		Reflect.set(caller.room, 'context', 1)
		Reflect.set(caller.roles.agent, 'strict', true)
		Reflect.set(caller.roles.agent.options, 'num_predict', 1)
		expect(owned.room.context).toBe(options.room.context)
		expect(owned.roles.agent?.strict).toBe(false)
		expect(owned.roles.agent?.options).toEqual(agentPolicy.options)
		expect('summary' in owned.roles).toBe(false)
	})

	it('reads each caller member once', () => {
		const room = createRecorder<[]>()
		const strict = createRecorder<[]>()
		const caller = { ...options, room: { ...options.room }, roles: { agent: { ...agentPolicy } } }
		Object.defineProperty(caller, 'room', {
			enumerable: true,
			get: () => {
				room.handler()
				return options.room
			},
		})
		Object.defineProperty(caller.roles.agent, 'strict', {
			enumerable: true,
			get: () => {
				strict.handler()
				return false
			},
		})
		buildStudyOllamaTransportOptions(caller)
		expect({ room: room.calls, strict: strict.calls }).toEqual({ room: [[]], strict: [[]] })
	})
})

describe('buildStudyOllamaSnapshot', () => {
	it('owns the URL spelling, settings, headers, and dispatch while keeping the signal live', () => {
		const url = new URL(chat)
		const headers = new Headers({ 'content-type': 'application/json' })
		const signal = new AbortController().signal
		const init = { method: 'POST', body: '{}', headers, signal }
		const dispatch = { id: 1, revision: 'f'.repeat(64) }
		const snapshot = buildStudyOllamaSnapshot(url, init, dispatch)
		url.pathname = '/outside'
		Reflect.set(init, 'body', 'changed')
		headers.set('content-type', 'text/plain')
		Reflect.set(dispatch, 'id', 2)
		expect(snapshot.url).toBe(chat)
		expect(snapshot.init?.body).toBe('{}')
		expect(snapshot.init?.signal).toBe(signal)
		expect(new Headers(snapshot.init?.headers).get('content-type')).toBe('application/json')
		expect(snapshot.dispatch).toEqual({ id: 1, revision: 'f'.repeat(64) })
	})

	it('reads the caller headers once and clones them from the copied settings', () => {
		const reads = createRecorder<[]>()
		const init: RequestInit = { method: 'POST' }
		Object.defineProperty(init, 'headers', {
			enumerable: true,
			get: () => {
				reads.handler()
				return { 'x-study-owned': 'original' }
			},
		})
		const snapshot = buildStudyOllamaSnapshot(chat, init, undefined)
		expect(reads.calls).toEqual([[]])
		expect(new Headers(snapshot.init?.headers).get('x-study-owned')).toBe('original')
	})

	it('keeps a string spelling and absent settings absent', () => {
		expect(buildStudyOllamaSnapshot(chat, undefined, undefined)).toEqual({
			url: chat,
			init: undefined,
			dispatch: undefined,
		})
	})

	it('refuses a Request input with CONFIG', () => {
		const outcome = captureError(() =>
			buildStudyOllamaSnapshot(new Request(chat), undefined, undefined),
		)
		expect(outcome).toMatchObject({
			code: 'CONFIG',
			message: 'Ollama transport requires explicit URL requests',
		})
	})
})
