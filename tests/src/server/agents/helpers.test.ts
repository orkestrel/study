import type { Message, ProviderRequest } from '@orkestrel/agent'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
	buildStudyAgentReadings,
	buildStudyAgentRevision,
	readStudyAgentMessages,
} from '../../../../src/server/agents/helpers.js'
import { encodeStudyJSON, hashStudyBytes } from '../../../../src/server/helpers.js'
import { STUDY_AGENT_MESSAGES, STUDY_AGENT_TOOLS } from '../../../setupStudy.js'

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
		const reads = { role: 0, content: 0, call: 0 }
		expect(
			readStudyAgentMessages([
				{
					get role() {
						reads.role++
						return 'tool'
					},
					get content() {
						reads.content++
						return 'alpha'
					},
					get call() {
						reads.call++
						return 'recalled'
					},
				},
			]),
		).toEqual([{ role: 'tool', content: 'alpha', call: 'recalled' }])
		expect(reads).toEqual({ role: 1, content: 1, call: 1 })
		expect(
			readStudyAgentMessages([{ role: 'tool', content: 'alpha', call: 'recalled', extra: true }]),
		).toEqual([{ role: 'tool', content: 'alpha', call: 'recalled' }])
		expect(() => readStudyAgentMessages([{ role: 'tool', content: 1 }])).toThrow('invalid')
		expect(() => readStudyAgentMessages({})).toThrow('array')
	})

	it('refuses a non-array collection and each malformed member', () => {
		for (const value of [undefined, 'messages', { length: 0 }])
			expect(() => readStudyAgentMessages(value), String(value)).toThrow('not an array')
		for (const member of [
			null,
			'text',
			{ content: 'x' },
			{ role: 'user' },
			{ role: 1, content: 'x' },
			{ role: 'user', content: 2 },
			{ role: 'tool', content: 'x', call: 3 },
		])
			expect(() => readStudyAgentMessages([member]), String(member)).toThrow('fields are invalid')
	})
})
