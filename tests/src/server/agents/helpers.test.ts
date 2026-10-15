import type { Message, ProviderRequest } from '@orkestrel/agent'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { buildStudyAgentRevision } from '../../../../src/server/agents/helpers.js'
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
