import type { Message, ProviderRequest } from '@orkestrel/agent'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { StudyError } from '../../../../src/core/errors.js'
import {
	buildStudyAgentReadings,
	buildStudyAgentRevision,
	resolveStudyAgentContent,
	readStudyAgentMessages,
	readStudyAgentResult,
} from '../../../../src/server/agents/helpers.js'
import { StudyAgentScript } from '../../../../src/server/agents/StudyAgentScript.js'
import { encodeStudyJSON, hashStudyBytes } from '../../../../src/server/helpers.js'
import {
	STUDY_AGENT_MESSAGES,
	STUDY_AGENT_TOOLS,
	STUDY_SCRIPT_CALL,
	STUDY_SCRIPT_MESSAGES,
	buildStudyScriptResponse,
	createStudyScriptFixture,
	createStudyScriptMeter,
} from '../../../setupStudy.js'

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
		expect({ role: roles.count, content: contents.count, call: calls.count }).toEqual({
			role: 1,
			content: 1,
			call: 1,
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
