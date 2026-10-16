import type { StudyOllamaRequest } from '../../../../src/server/ollama/types.js'
import { describe, expect, it } from 'vitest'
import { captureError, requireValue } from '@orkestrel/test'
import { extractTiming } from '@orkestrel/ollama'
import { StudyError } from '../../../../src/core/errors.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'
import {
	buildStudyOllamaModels,
	buildStudyOllamaRaw,
	buildStudyOllamaSettings,
	buildStudyOllamaTiming,
	readStudyOllamaDigest,
	readStudyOllamaFailure,
	readStudyOllamaRequest,
	readStudyOllamaSupport,
	readStudyOllamaTerminal,
	readStudyOllamaTiming,
	validateStudyOllamaCompletion,
	validateStudyOllamaInventory,
	validateStudyOllamaRoles,
} from '../../../../src/server/ollama/helpers.js'
import {
	STUDY_OLLAMA_OPTIONS,
	STUDY_OLLAMA_ORIGIN,
	STUDY_OLLAMA_PROVIDER,
} from '../../../setupStudy.js'
import {
	STUDY_OLLAMA_FAILURE_CASES,
	STUDY_OLLAMA_NO_FAILURES,
	buildOllamaTransportOptions,
} from '../../../setupServer.js'

const options = buildOllamaTransportOptions(STUDY_OLLAMA_ORIGIN)
const agentPolicy = requireValue(options.roles.agent)
const judgePolicy = requireValue(options.roles.judge)
const room = options.room
const chat = `${STUDY_OLLAMA_ORIGIN}/api/chat`
const agentBody = { model: 'model', stream: true, think: false, options: STUDY_OLLAMA_OPTIONS }
const finished = { model: 'model', done: true, done_reason: 'stop', message: { content: 'ok' } }
const agentRequest: StudyOllamaRequest = {
	role: 'agent',
	path: '/api/chat',
	model: 'model',
	output: 512,
	bytes: 1,
	options: STUDY_OLLAMA_OPTIONS,
	strict: false,
	length: false,
}
const judgeRequest: StudyOllamaRequest = {
	...agentRequest,
	role: 'judge',
	path: '/api/generate',
	model: 'judge',
	output: 1,
	length: true,
}

describe('buildStudyOllamaModels', () => {
	it('pins the model and the judge when both are declared', () => {
		expect(buildStudyOllamaModels(STUDY_OLLAMA_PROVIDER)).toEqual({
			model: { name: 'model', digest: 'a'.repeat(64) },
			judge: { name: 'judge', digest: 'b'.repeat(64) },
		})
	})

	it('pins the model alone when the provider declares no judge', () => {
		const models = buildStudyOllamaModels({
			...STUDY_OLLAMA_PROVIDER,
			judge: undefined,
			digest: { model: STUDY_OLLAMA_PROVIDER.digest.model, judge: undefined },
		})
		expect(models).toEqual({ model: { name: 'model', digest: 'a'.repeat(64) } })
		expect(Object.keys(models)).toEqual(['model'])
	})

	it('pins no judge when its digest is missing', () => {
		const models = buildStudyOllamaModels({
			...STUDY_OLLAMA_PROVIDER,
			digest: { model: STUDY_OLLAMA_PROVIDER.digest.model, judge: undefined },
		})
		expect(Object.keys(models)).toEqual(['model'])
	})

	it('pins no judge when its name is missing', () => {
		expect(
			Object.keys(buildStudyOllamaModels({ ...STUDY_OLLAMA_PROVIDER, judge: undefined })),
		).toEqual(['model'])
	})
})

describe('buildStudyOllamaSettings', () => {
	it('adds both native fields as false for a strict policy', () => {
		const settings = buildStudyOllamaSettings({ ...agentPolicy, strict: true })
		expect(settings.truncate).toBe(false)
		expect(settings.shift).toBe(false)
		expect(Object.keys(settings)).toEqual(['model', 'options', 'think', 'truncate', 'shift'])
	})

	it('omits both native keys for a policy that is not strict', () => {
		const settings = buildStudyOllamaSettings({ ...agentPolicy, strict: false })
		expect('truncate' in settings).toBe(false)
		expect('shift' in settings).toBe(false)
		expect(Object.keys(settings)).toEqual(['model', 'options', 'think'])
	})

	it('keeps a false think flag and the policy model', () => {
		const settings = buildStudyOllamaSettings({ ...agentPolicy, think: false })
		expect(settings.think).toBe(false)
		expect(settings.model).toBe(agentPolicy.model)
		expect(buildStudyOllamaSettings({ ...agentPolicy, think: true }).think).toBe(true)
	})

	it('carries the options object by identity with its key order', () => {
		const settings = buildStudyOllamaSettings(agentPolicy)
		expect(settings.options).toBe(agentPolicy.options)
		expect(Object.keys(requireValue(settings.options))).toEqual(Object.keys(STUDY_OLLAMA_OPTIONS))
	})

	it('projects no length allowance', () => {
		expect('length' in buildStudyOllamaSettings({ ...agentPolicy, length: true })).toBe(false)
		expect('length' in buildStudyOllamaSettings(judgePolicy)).toBe(false)
	})
})

describe('readStudyOllamaFailure', () => {
	it.each(STUDY_OLLAMA_FAILURE_CASES)('reads $name as $code', ({ value, status, code, reason }) => {
		const failure = readStudyOllamaFailure(value, 'summary', status)
		expect(failure).toBeInstanceOf(StudyError)
		expect(failure?.code).toBe(code)
		expect(failure?.failure).toMatchObject({
			cause: code === 'CAPACITY' ? 'capacity' : 'infrastructure',
			role: 'summary',
		})
		for (const fragment of reason) expect(failure?.message).toContain(fragment)
	})

	it('reads no failure from a value without an error member', () => {
		for (const value of STUDY_OLLAMA_NO_FAILURES)
			expect(readStudyOllamaFailure(value, 'agent')).toBeUndefined()
	})
})

describe('readStudyOllamaTerminal', () => {
	it('keeps absent and partial usage unknown and reads complete usage exactly', () => {
		expect(readStudyOllamaTerminal(finished, agentRequest)).toEqual({
			prompt: undefined,
			completion: undefined,
			reason: 'stop',
		})
		expect(readStudyOllamaTerminal({ ...finished, prompt_eval_count: 7 }, agentRequest)).toEqual({
			prompt: 7,
			completion: undefined,
			reason: 'stop',
		})
		expect(
			readStudyOllamaTerminal({ ...finished, prompt_eval_count: 7, eval_count: 2 }, agentRequest),
		).toEqual({ prompt: 7, completion: 2, reason: 'stop' })
	})

	it('returns no terminal for a valid nonterminal row', () => {
		const row = { model: 'model', done: false, message: { content: 'par' } }
		expect(readStudyOllamaTerminal(row, agentRequest)).toBeUndefined()
	})

	it.each([
		['a negative count', { prompt_eval_count: -1 }],
		['a fractional count', { eval_count: 1.5 }],
		['a text count', { prompt_eval_count: '7' }],
	] as const)('refuses %s as malformed usage attributed to its role', (_name, usage) => {
		const row = { ...finished, ...usage }
		const outcome = captureError(() => readStudyOllamaTerminal(row, agentRequest))
		expect(readStudyFailure(outcome)).toEqual({
			cause: 'infrastructure',
			message: 'Malformed Ollama usage',
			role: 'agent',
		})
	})

	it.each([
		['a non-record row', 'done', 'Malformed Ollama response row'],
		['another model', { model: 'other', done: false, message: { content: '' } }, 'differs'],
		['a missing message', { model: 'model', done: false }, 'Malformed Ollama message'],
		[
			'malformed tool calls',
			{ model: 'model', done: false, message: { content: '', tool_calls: {} } },
			'Malformed Ollama tool calls',
		],
		[
			'a missing finish reason',
			{ model: 'model', done: true, message: { content: '' } },
			'Missing Ollama finish reason',
		],
	] as const)('refuses %s', (_name, row, message) => {
		expect(() => readStudyOllamaTerminal(row, agentRequest)).toThrow(message)
	})

	it('throws a native error row before any other check', () => {
		expect(() =>
			readStudyOllamaTerminal({ error: 'model failed', done: 'invalid' }, agentRequest),
		).toThrow('Ollama error: model failed')
	})
})

describe('validateStudyOllamaCompletion', () => {
	it('admits a stop finish within the reserved room', () => {
		const terminal = { prompt: 32128, completion: 511, reason: 'stop' }
		expect(() => validateStudyOllamaCompletion(terminal, room, agentRequest)).not.toThrow()
	})

	it.each([
		['a prompt above the reserved room', 32129, 2, 'stop', 'CAPACITY'],
		['generation above the allowance', 7, 513, 'stop', 'CAPACITY'],
		['generation at the allowance', 7, 512, 'stop', 'CAPACITY'],
		['an undeclared length finish', 7, 2, 'length', 'CAPACITY'],
		['an unsupported finish', 7, 2, 'unload', 'FAULT'],
	] as const)('refuses %s for a substantive role', (_name, prompt, completion, reason, code) => {
		const outcome = captureError(() =>
			validateStudyOllamaCompletion({ prompt, completion, reason }, room, agentRequest),
		)
		expect(outcome).toBeInstanceOf(StudyError)
		expect(outcome).toMatchObject({ code, failure: { role: 'agent' } })
	})

	it('admits the one-token length finish only where the policy declares it', () => {
		const terminal = { prompt: 10, completion: 1, reason: 'length' }
		expect(() => validateStudyOllamaCompletion(terminal, room, judgeRequest)).not.toThrow()
		expect(() =>
			validateStudyOllamaCompletion(terminal, room, { ...judgeRequest, length: false }),
		).toThrow('Substantive generation reached its output cap')
		expect(() =>
			validateStudyOllamaCompletion({ ...terminal, completion: 2 }, room, judgeRequest),
		).toThrow('Actual generation exceeded the output allowance')
	})
})

describe('readStudyOllamaRequest', () => {
	it('reads the declared agent policy from the exact encoded body', () => {
		const body = JSON.stringify(agentBody)
		expect(readStudyOllamaRequest(options, 'agent', chat, { method: 'POST', body })).toEqual({
			role: 'agent',
			path: '/api/chat',
			model: 'model',
			output: 512,
			bytes: new TextEncoder().encode(body).byteLength,
			options: STUDY_OLLAMA_OPTIONS,
			strict: false,
			length: false,
		})
	})

	it('verifies the strict fields only when the role policy declares them', () => {
		const strict = buildOllamaTransportOptions(STUDY_OLLAMA_ORIGIN, {
			roles: { agent: { ...agentPolicy, strict: true } },
		})
		const allowed = JSON.stringify({ ...agentBody, truncate: false, shift: false })
		const verified = readStudyOllamaRequest(strict, 'agent', chat, {
			method: 'POST',
			body: allowed,
		})
		expect(verified.strict).toBe(true)
		for (const fields of [
			{},
			{ truncate: false },
			{ shift: false },
			{ truncate: true, shift: false },
			{ truncate: false, shift: true },
			{ truncate: null, shift: false },
		]) {
			const init = { method: 'POST', body: JSON.stringify({ ...agentBody, ...fields }) }
			expect(() => readStudyOllamaRequest(strict, 'agent', chat, init)).toThrow(
				'must disable native truncation and shifting',
			)
			expect(readStudyOllamaRequest(options, 'agent', chat, init).strict).toBe(false)
		}
	})

	it.each([
		['another origin', 'http://127.0.0.2:11434/api/chat', agentBody, 'admitted origin'],
		['another path', `${STUDY_OLLAMA_ORIGIN}/api/generate`, agentBody, 'admitted origin'],
		['another model', chat, { ...agentBody, model: 'judge' }, 'differ from the declared policy'],
		[
			'changed options',
			chat,
			{ ...agentBody, options: { ...STUDY_OLLAMA_OPTIONS, temperature: 1 } },
			'differ from the declared policy',
		],
		['a disabled stream', chat, { ...agentBody, stream: false }, 'differ from the declared policy'],
		['an undeclared think', chat, { ...agentBody, think: true }, 'flags differ'],
		['an omitted think', chat, { ...agentBody, think: undefined }, 'flags differ'],
	] as const)('refuses %s with CONFIG before admission', (_name, url, body, message) => {
		const init = { method: 'POST', body: JSON.stringify(body) }
		const outcome = captureError(() => readStudyOllamaRequest(options, 'agent', url, init))
		expect(outcome).toMatchObject({ code: 'CONFIG' })
		expect(outcome).toHaveProperty('message', expect.stringContaining(message))
	})

	it('refuses a role without a declared policy', () => {
		const init = { method: 'POST', body: JSON.stringify(agentBody) }
		const agentOnly = buildOllamaTransportOptions(STUDY_OLLAMA_ORIGIN, {
			roles: { agent: agentPolicy },
		})
		expect(() => readStudyOllamaRequest(agentOnly, 'summary', chat, init)).toThrow(
			'no declared wire policy',
		)
		expect(() => readStudyOllamaRequest(options, 'tool', chat, init)).toThrow(
			'no declared wire policy',
		)
	})

	it('reads inventory and pinned metadata requests and refuses an unpinned model', () => {
		const tags = `${STUDY_OLLAMA_ORIGIN}/api/tags`
		const show = `${STUDY_OLLAMA_ORIGIN}/api/show`
		expect(readStudyOllamaRequest(options, 'metadata', tags, { method: 'GET' })).toMatchObject({
			path: '/api/tags',
			model: undefined,
			bytes: 0,
		})
		const pinned = { method: 'POST', body: JSON.stringify({ model: 'judge' }) }
		expect(readStudyOllamaRequest(options, 'metadata', show, pinned)).toMatchObject({
			path: '/api/show',
			model: 'judge',
		})
		const unpinned = { method: 'POST', body: JSON.stringify({ model: 'other' }) }
		expect(() => readStudyOllamaRequest(options, 'metadata', show, unpinned)).toThrow(
			'Invalid model metadata identity',
		)
	})
})

describe('validateStudyOllamaRoles', () => {
	it('refuses a policy the inventory cannot serve or the wire cannot bound', () => {
		const { models } = options
		expect(() => validateStudyOllamaRoles(options.roles, models)).not.toThrow()
		const unpinned = { ...agentPolicy, model: 'other' }
		expect(() => validateStudyOllamaRoles({ agent: unpinned }, models)).toThrow('does not pin')
		const unbounded = { ...agentPolicy, options: { num_ctx: 32768 } }
		expect(() => validateStudyOllamaRoles({ agent: unbounded }, models)).toThrow('num_predict')
		const strict = { ...judgePolicy, strict: true }
		expect(() => validateStudyOllamaRoles({ judge: strict }, models)).toThrow('chat roles')
	})
})

describe('validateStudyOllamaInventory', () => {
	const model = { name: 'model', digest: 'a'.repeat(64) }
	const judge = { name: 'judge', digest: 'b'.repeat(64) }

	it('admits each pinned name once with its digest, with or without the sha256 prefix', () => {
		const prefixed = { ...model, digest: `sha256:${model.digest}` }
		expect(() =>
			validateStudyOllamaInventory({ models: [prefixed, judge] }, options.models),
		).not.toThrow()
	})

	it.each([
		['a missing models list', {}],
		['a changed digest', { models: [{ ...model, digest: 'c'.repeat(64) }, judge] }],
		['a duplicate name', { models: [model, model, judge] }],
		['a missing pinned model', { models: [model] }],
	] as const)('refuses %s', (_name, value) => {
		expect(() => validateStudyOllamaInventory(value, options.models)).toThrow(StudyError)
	})
})

describe('readStudyOllamaSupport', () => {
	it('reads the unambiguous ceiling and refuses one below the requested context', () => {
		const info = { 'general.architecture': 'fixture', 'fixture.context_length': 32768 }
		expect(readStudyOllamaSupport({ model_info: info }, 32768)).toBe(32768)
		expect(captureError(() => readStudyOllamaSupport({ model_info: info }, 32769))).toMatchObject({
			code: 'CAPACITY',
		})
		const ambiguous = { ...info, 'other.context_length': 65536 }
		expect(captureError(() => readStudyOllamaSupport({ model_info: ambiguous }, 1))).toMatchObject({
			code: 'CAPACITY',
		})
		expect(captureError(() => readStudyOllamaSupport({}, 1))).toMatchObject({ code: 'FAULT' })
	})
})

describe('readStudyOllamaDigest', () => {
	it('reads the digest pinned for the request model and none for inventory', () => {
		const inventory: StudyOllamaRequest = { ...agentRequest, role: 'metadata', model: undefined }
		expect(readStudyOllamaDigest(options.models, judgeRequest)).toBe('b'.repeat(64))
		expect(readStudyOllamaDigest(options.models, agentRequest)).toBe('a'.repeat(64))
		expect(readStudyOllamaDigest(options.models, inventory)).toBeUndefined()
	})
})

describe('timing and raw observations', () => {
	it('keeps unreported timing members null and lets a throwing extractor observe nothing', () => {
		const timing = extractTiming({
			done: true,
			total_duration: 5,
			load_duration: -1,
			prompt_eval_cached_count: 3,
		})
		expect(buildStudyOllamaTiming(undefined)).toBeNull()
		expect(buildStudyOllamaTiming(timing)).toEqual({
			durations: { total: 5, load: null, prompt: null, decode: null },
			counts: { prompt: null, decode: null, cached: 3 },
			invalid: ['load_duration'],
		})
		// An unreported total stays null beside a reported member, never zero.
		expect(buildStudyOllamaTiming(extractTiming({ done: true, load_duration: 7 }))).toEqual({
			durations: { total: null, load: 7, prompt: null, decode: null },
			counts: { prompt: null, decode: null, cached: null },
			invalid: [],
		})
		const refused = readStudyOllamaTiming(() => {
			throw new Error('Refused timing')
		}, {})
		expect(refused).toBeUndefined()
	})

	it('reads a raw prompt in UTF-16 units and UTF-8 bytes and nothing from another body', () => {
		expect(buildStudyOllamaRaw(JSON.stringify({ prompt: 'café' }))).toEqual({
			encoding: 'utf-8',
			units: 4,
			bytes: 5,
		})
		expect(buildStudyOllamaRaw(JSON.stringify({ messages: [] }))).toBeUndefined()
		expect(buildStudyOllamaRaw('{')).toBeUndefined()
		expect(buildStudyOllamaRaw(undefined)).toBeUndefined()
	})
})
