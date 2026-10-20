import type { Message, ProviderRequest } from '@orkestrel/agent'
import { createRecorder } from '@orkestrel/test'
import { isToolCall } from '@orkestrel/tool'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { StudyError } from '../../../../src/core/errors.js'
import {
	buildStudyAgentReadings,
	buildStudyAgentToolResult,
	buildStudyAgentToolDenial,
	buildStudyAgentRevision,
	resolveStudyAgentContent,
	readStudyAgentMessages,
	readStudyAgentResult,
} from '../../../../src/server/agents/helpers.js'
import { StudyAgentScript } from '../../../../src/server/agents/StudyAgentScript.js'
import { encodeStudyJSON, hashStudyBytes } from '../../../../src/server/helpers.js'
import {
	STUDY_AGENT_MESSAGES,
	STUDY_AGENT_TOOL_CALL,
	STUDY_AGENT_INVALID_CALLS,
	STUDY_AGENT_INVALID_RESULTS,
	STUDY_AGENT_TOOL_PROJECTIONS,
	STUDY_AGENT_OMITTED_REASONS,
	STUDY_AGENT_NON_JSON_VALUES,
	STUDY_AGENT_TOOL_RESULTS,
	STUDY_AGENT_INVALID_ERRORS,
	STUDY_AGENT_TOOLS,
	STUDY_SCRIPT_CALL,
	STUDY_SCRIPT_MESSAGES,
	buildStudyScriptResponse,
	createStudyScriptFixture,
	createStudyScriptMeter,
} from '../../../setupStudy.js'

describe('Agent tool evidence', () => {
	it('owns each foreign tool field from one read before validating its copy', () => {
		for (const project of STUDY_AGENT_TOOL_PROJECTIONS) {
			const ids = createRecorder<[]>()
			const names = createRecorder<[]>()
			const parameters = createRecorder<[]>()
			const successes = createRecorder<[]>()
			const values = createRecorder<[]>()
			project(
				{
					get id() {
						ids.handler()
						return 'c1'
					},
					get name() {
						names.handler()
						return 'write'
					},
					get arguments() {
						parameters.handler()
						return { path: 'note.txt' }
					},
				},
				{
					get success() {
						successes.handler()
						return true
					},
					get value() {
						values.handler()
						return 'stored'
					},
				},
			)
			expect(ids.calls).toEqual([[]])
			expect(names.calls).toEqual([[]])
			expect(parameters.calls).toEqual([[]])
			expect(successes.calls).toEqual(project === buildStudyAgentToolResult ? [[]] : [])
			expect(values.calls).toEqual(project === buildStudyAgentToolResult ? [[]] : [])
		}
	})
	it('projects successful and failed results and denials into the retained row shapes', () => {
		expect(buildStudyAgentToolDenial(STUDY_AGENT_TOOL_CALL, 'refused')).toEqual({
			id: 'c1',
			name: 'write',
			reason: 'refused',
		})
		for (const reason of STUDY_AGENT_OMITTED_REASONS)
			expect(buildStudyAgentToolDenial(STUDY_AGENT_TOOL_CALL, reason)).toEqual({
				id: 'c1',
				name: 'write',
			})
		expect(
			buildStudyAgentToolResult(STUDY_AGENT_TOOL_CALL, { success: true, value: 'stored' }),
		).toEqual({
			id: 'c1',
			name: 'write',
			arguments: { path: 'note.txt' },
			success: true,
			value: 'stored',
		})
		expect(
			buildStudyAgentToolResult(STUDY_AGENT_TOOL_CALL, { success: false, error: 'refused' }),
		).toEqual({
			id: 'c1',
			name: 'write',
			arguments: { path: 'note.txt' },
			success: false,
			error: 'refused',
		})
	})

	it.each(STUDY_AGENT_INVALID_CALLS)(
		'refuses a malformed tool call $call with FAULT',
		({ call }) => {
			expect(isToolCall(call)).toBe(false)
			for (const project of STUDY_AGENT_TOOL_PROJECTIONS)
				expect(() => project(call, undefined)).toThrow(
					expect.objectContaining({
						code: 'FAULT',
						message: 'Admitted Agent supplied invalid tool observation',
					}),
				)
		},
	)

	it.each(STUDY_AGENT_INVALID_RESULTS)(
		'refuses a malformed tool result %o with FAULT',
		(result) => {
			expect(() => buildStudyAgentToolResult(STUDY_AGENT_TOOL_CALL, result)).toThrow(
				expect.objectContaining({
					code: 'FAULT',
					message: 'Admitted Agent supplied invalid tool result',
				}),
			)
		},
	)

	it('refuses non-JSON values and arguments and malformed errors with FAULT', () => {
		for (const value of STUDY_AGENT_NON_JSON_VALUES)
			expect(() =>
				buildStudyAgentToolResult(STUDY_AGENT_TOOL_CALL, { success: true, value }),
			).toThrow(
				expect.objectContaining({
					code: 'FAULT',
					message: 'Admitted Agent supplied non-JSON tool value',
				}),
			)
		expect(() => buildStudyAgentToolResult(STUDY_AGENT_TOOL_CALL, { success: true })).toThrow(
			'non-JSON tool value',
		)
		const call = { ...STUDY_AGENT_TOOL_CALL, arguments: { missing: undefined } }
		for (const result of STUDY_AGENT_TOOL_RESULTS)
			expect(() => buildStudyAgentToolResult(call, result)).toThrow(
				expect.objectContaining({
					code: 'FAULT',
					message: 'Admitted Agent supplied non-JSON tool arguments',
				}),
			)
		expect(buildStudyAgentToolDenial(call, '')).toEqual({ id: 'c1', name: 'write', reason: '' })
		for (const error of STUDY_AGENT_INVALID_ERRORS)
			expect(() =>
				buildStudyAgentToolResult(STUDY_AGENT_TOOL_CALL, { success: false, error }),
			).toThrow(
				expect.objectContaining({
					code: 'FAULT',
					message: 'Admitted Agent supplied invalid tool error',
				}),
			)
	})

	it('owns nested arguments and successful values independently of their sources', () => {
		const parameters = { document: { path: 'note.txt' } }
		const value = { stored: ['note.txt'] }
		const call = { ...STUDY_AGENT_TOOL_CALL, arguments: parameters }
		const success = buildStudyAgentToolResult(call, { success: true, value })
		const failure = buildStudyAgentToolResult(call, { success: false, error: 'refused' })
		parameters.document.path = 'changed.txt'
		value.stored.push('changed.txt')
		expect(success).toEqual({
			id: 'c1',
			name: 'write',
			arguments: { document: { path: 'note.txt' } },
			success: true,
			value: { stored: ['note.txt'] },
		})
		expect(failure).toEqual({
			id: 'c1',
			name: 'write',
			arguments: { document: { path: 'note.txt' } },
			success: false,
			error: 'refused',
		})
	})
})

describe('buildStudyAgentRevision', () => {
	it('hashes the key-sorted canonical rendering exactly as rendered, with no trailing newline', () => {
		const request: ProviderRequest = {
			messages: [{ role: 'user', id: 'm1', content: 'Hi' }],
		}
		const rendered = '{"messages":[{"content":"Hi","id":"m1","role":"user"}]}'
		const revision = buildStudyAgentRevision(request)
		expect(revision).toBe(createHash('sha256').update(rendered, 'utf8').digest('hex'))
		expect(revision).not.toBe(hashStudyBytes(encodeStudyJSON(request)))
	})

	it('changes for any change to content, order, ids, tools, or options and ignores key order', () => {
		const base: ProviderRequest = { messages: STUDY_AGENT_MESSAGES, tools: STUDY_AGENT_TOOLS }
		const second: Message = { id: 'm2', role: 'assistant', content: 'Two orders' }
		const variants: readonly ProviderRequest[] = [
			{ ...base, messages: [{ id: 'm1', role: 'user', content: 'Count the order' }] },
			{ ...base, messages: [...STUDY_AGENT_MESSAGES, second] },
			{ ...base, messages: [second, ...STUDY_AGENT_MESSAGES] },
			{ ...base, messages: [{ id: 'm9', role: 'user', content: 'Count the orders' }] },
			{ messages: STUDY_AGENT_MESSAGES },
			{ ...base, options: { think: false } },
		]
		const revisions = [base, ...variants].map((request) => buildStudyAgentRevision(request))
		expect(new Set(revisions).size).toBe(revisions.length)
		expect(revisions.every((revision) => typeof revision === 'string')).toBe(true)
		const reordered: ProviderRequest = { tools: STUDY_AGENT_TOOLS, messages: STUDY_AGENT_MESSAGES }
		expect(buildStudyAgentRevision(reordered)).toBe(buildStudyAgentRevision(base))
	})

	it('returns undefined instead of throwing when the request cannot be canonically rendered', () => {
		const cyclic: Record<string, unknown> = { type: 'object' }
		cyclic.self = cyclic
		const hostile = Object.defineProperty({ think: false }, 'schema', {
			enumerable: true,
			get(): never {
				throw new Error('Refused read')
			},
		})
		const schema = { schema: cyclic }
		expect(buildStudyAgentRevision({ messages: STUDY_AGENT_MESSAGES, options: schema })).toBe(
			undefined,
		)
		expect(buildStudyAgentRevision({ messages: STUDY_AGENT_MESSAGES, options: hostile })).toBe(
			undefined,
		)
	})
})

describe('buildStudyAgentReadings', () => {
	it('returns null for a result without a readings array', () => {
		for (const result of [undefined, null, 'text', 3, {}, { readings: 'none' }, { readings: {} }])
			expect(buildStudyAgentReadings(result)).toBe(null)
	})

	it('projects well-formed readings in asking order with a numeric duration or null', () => {
		const result = {
			content: 'ignored',
			readings: [
				{ key: 'shipped', phase: 'ask', outcome: 'yes', duration: 12, extra: 'dropped' },
				{ key: 'billed', phase: 'recheck', outcome: 'no' },
				{ key: 'late', phase: 'ask', outcome: 'yes', duration: '5' },
			],
		}
		expect(buildStudyAgentReadings(result)).toEqual([
			{ key: 'shipped', phase: 'ask', outcome: 'yes', duration: 12 },
			{ key: 'billed', phase: 'recheck', outcome: 'no', duration: null },
			{ key: 'late', phase: 'ask', outcome: 'yes', duration: null },
		])
	})

	it('skips an entry missing a string key, phase, or outcome and keeps the rest', () => {
		const result = {
			readings: [
				null,
				'row',
				{ phase: 'ask', outcome: 'yes' },
				{ key: 'shipped', outcome: 'yes' },
				{ key: 'shipped', phase: 'ask', outcome: 1 },
				{ key: 'kept', phase: 'ask', outcome: 'yes', duration: 0 },
			],
		}
		expect(buildStudyAgentReadings(result)).toEqual([
			{ key: 'kept', phase: 'ask', outcome: 'yes', duration: 0 },
		])
		expect(buildStudyAgentReadings({ readings: [] })).toEqual([])
	})
})

describe('resolveStudyAgentContent', () => {
	const request = [
		{ role: 'tool', content: 'first', call: 'call-1' },
		{ role: 'user', content: 'ignored', call: 'call-1' },
		{ role: 'tool', content: 'second', call: 'call-1' },
		{ role: 'tool', content: 'other', call: 'call-2' },
	] as const

	it('serves the declared content unless the response consumes a prior tool message', () => {
		expect(
			resolveStudyAgentContent(request, buildStudyScriptResponse({ content: 'declared' })),
		).toBe('declared')
	})

	it('serves the content of the last tool message the consumed call names', () => {
		expect(
			resolveStudyAgentContent(
				request,
				buildStudyScriptResponse({ content: '', consume: 'call-1' }),
			),
		).toBe('second')
		expect(
			resolveStudyAgentContent(
				request,
				buildStudyScriptResponse({ content: '', consume: 'call-2' }),
			),
		).toBe('other')
	})

	it('refuses a consumed call that no actual tool message references', () => {
		expect(() =>
			resolveStudyAgentContent(
				request,
				buildStudyScriptResponse({ content: '', consume: 'call-3' }),
			),
		).toThrow('no actual referenced tool result')
		expect(() =>
			resolveStudyAgentContent([], buildStudyScriptResponse({ content: '', consume: 'call-1' })),
		).toThrow(StudyError)
	})
})

describe('readStudyAgentResult', () => {
	it('drains every delta of a scripted stream and returns the assembled result', async () => {
		const meter = createStudyScriptMeter(1000, 100)
		try {
			const script = new StudyAgentScript({ bytes: 1000 })
			script.prepare(
				createStudyScriptFixture(meter, [
					buildStudyScriptResponse({ content: 'looking', calls: [STUDY_SCRIPT_CALL] }),
				]).plan,
			)
			expect(
				await readStudyAgentResult(script.stream(STUDY_SCRIPT_MESSAGES, meter.control.signal)),
			).toEqual({ content: 'looking', tools: [STUDY_SCRIPT_CALL] })
		} finally {
			meter.close()
		}
	})
})

describe('readStudyAgentMessages', () => {
	it('projects role, content and call in message order and drops every other member', () => {
		const messages: readonly Message[] = [
			{ id: 'm1', role: 'user', content: 'Count', images: ['x'], thinking: 'hidden' },
			{ id: 'm2', role: 'tool', content: 'three', call: 'call-1' },
		]
		const readings = readStudyAgentMessages(messages)
		expect(readings).toEqual([
			{ role: 'user', content: 'Count' },
			{ role: 'tool', content: 'three', call: 'call-1' },
		])
		expect(Object.keys(readings[1] ?? {})).toEqual(['role', 'content', 'call'])
		expect(Object.isFrozen(readings)).toBe(true)
	})

	it('projects only dereferenced foreign message fields and refuses malformed provider reads', () => {
		const roles = createRecorder<[]>()
		const contents = createRecorder<[]>()
		const calls = createRecorder<[]>()
		expect(
			readStudyAgentMessages([
				{
					get role() {
						roles.handler()
						return 'tool'
					},
					get content() {
						contents.handler()
						return 'alpha'
					},
					get call() {
						calls.handler()
						return 'recalled'
					},
				},
			]),
		).toEqual([{ role: 'tool', content: 'alpha', call: 'recalled' }])
		expect({ role: roles.calls, content: contents.calls, call: calls.calls }).toEqual({
			role: [[]],
			content: [[]],
			call: [[]],
		})
		expect(
			readStudyAgentMessages([{ role: 'tool', content: 'alpha', call: 'recalled', extra: true }]),
		).toEqual([{ role: 'tool', content: 'alpha', call: 'recalled' }])
		expect(() => readStudyAgentMessages([{ role: 'tool', content: 1 }])).toThrow('invalid')
		expect(() => readStudyAgentMessages({})).toThrow('array')
	})

	it('refuses a non-array collection and each malformed member', () => {
		for (const value of [undefined, 'messages', { length: 0 }])
			expect(() => readStudyAgentMessages(value)).toThrow('not an array')
		for (const member of [
			null,
			'text',
			{ content: 'x' },
			{ role: 'user' },
			{ role: 1, content: 'x' },
			{ role: 'user', content: 2 },
			{ role: 'tool', content: 'x', call: 3 },
		])
			expect(() => readStudyAgentMessages([member])).toThrow('fields are invalid')
	})
})
