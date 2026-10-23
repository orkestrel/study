import * as ollama from '../../../../src/server/ollama/index.js'
import { buildReversedStudyHistory, buildStudyExchangeHistory } from '../../../setupServer.js'
import { buildStudyOllamaBytes } from '../../../../src/server/ollama/helpers.js'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

describe('StudyOllamaReplay', () => {
	it('requires sealed completed history rather than prospective capture, and projects captured prefix bodies', async () => {
		const history = buildStudyExchangeHistory(true)
		const replay = new ollama.StudyOllamaReplay({
			history,
			url: 'http://127.0.0.1:1',
			prefix: history.exchanges.length,
			limit: { calls: 20, bytes: 65536, duration: 5000 },
			signal: new AbortController().signal,
		})
		try {
			expect(replay.procedure[0]).toMatchObject({
				admission: 'exact',
				input: history.exchanges[3]?.attempt.digest,
			})
			expect(history.declaration.procedure[0]?.admission).toBe('capture')
		} finally {
			await replay.close()
		}
		const calls = createRecorder<readonly []>()
		for (const invalid of [
			{ ...history, exchanges: [] },
			buildReversedStudyHistory(),
			{
				...history,
				exchanges: history.exchanges.map((pair) =>
					pair.attempt.stage === 'execution'
						? {
								...pair,
								response: {
									...pair.response,
									...buildStudyOllamaBytes(Buffer.from('changed')),
									chunks: [7],
								},
							}
						: pair,
				),
			},
		]) {
			expect(
				() =>
					new ollama.StudyOllamaReplay({
						history: invalid,
						url: 'http://127.0.0.1:1',
						prefix: history.exchanges.length,
						limit: { calls: 20, bytes: 65536, duration: 5000 },
						signal: new AbortController().signal,
						fetch: async () => {
							calls.handler()
							return new Response('live')
						},
					}),
			).toThrow(/\S/)
		}
		expect(calls.count).toBe(0)
	})
	it('refuses completion until the response is read and the full prefix is consumed', async () => {
		const history = buildStudyExchangeHistory()
		const replay = new ollama.StudyOllamaReplay({
			history,
			url: 'http://127.0.0.1:1',
			prefix: 1,
			limit: { calls: 20, bytes: 65536, duration: 5000 },
			signal: new AbortController().signal,
			fetch: async () => new Response('live'),
		})
		try {
			expect(() => replay.check()).toThrow(/incomplete/)
			const response = await replay.fetch('metadata', 'http://127.0.0.1:1/api/version', {})
			expect(() => replay.check()).toThrow(/still being read/)
			await response.text()
			expect(() => replay.check()).not.toThrow()
		} finally {
			await replay.close()
		}
	})
	it('replays the exact prefix offline and refuses a changed request without forwarding', async () => {
		const history = buildStudyExchangeHistory()
		const sent = createRecorder<readonly [string]>()
		const replay = new ollama.StudyOllamaReplay({
			history,
			url: 'http://127.0.0.1:1',
			prefix: history.exchanges.length,
			limit: { calls: 20, bytes: 65536, duration: 5000 },
			signal: new AbortController().signal,
			fetch: async (_role, input) => {
				sent.handler(String(input))
				return new Response('live')
			},
		})
		try {
			const response = await replay.fetch('metadata', 'http://127.0.0.1:1/api/version', {
				method: 'GET',
			})
			expect(await response.text()).toBe('{"version":"0.40.3"}')
			await expect(
				replay.fetch('metadata', 'http://127.0.0.1:1/api/show', {
					method: 'POST',
					body: 'changed',
				}),
			).rejects.toMatchObject({ code: 'FAULT' })
			expect(sent.count).toBe(0)
			expect(() => replay.check()).toThrow(/\S/)
		} finally {
			await replay.close()
		}
	})

	it('consumes every retained reply and refuses later requests without a live collaborator', async () => {
		const history = buildStudyExchangeHistory()
		const replay = new ollama.StudyOllamaReplay({
			history,
			url: 'http://127.0.0.1:1',
			prefix: history.exchanges.length,
			limit: { calls: 20, bytes: 65536, duration: 5000 },
			signal: new AbortController().signal,
		})
		try {
			for (const exchange of history.exchanges) {
				const response = await replay.fetch(
					exchange.attempt.role,
					`http://127.0.0.1:1${exchange.attempt.path}`,
					{
						method: exchange.attempt.method,
						...(exchange.attempt.size === 0
							? {}
							: { body: Buffer.from(exchange.attempt.body, 'base64').toString('utf8') }),
					},
				)
				expect(Buffer.from(await response.arrayBuffer()).toString('base64')).toBe(
					exchange.response.body,
				)
			}
			expect(() => replay.check()).not.toThrow()
			await expect(
				replay.fetch('metadata', 'http://127.0.0.1:1/api/version', {}),
			).rejects.toMatchObject({ code: 'FAULT' })
		} finally {
			await replay.close()
		}
	})

	it('forwards only after a consumed prefix and projects recorded capture bodies to exact steps', async () => {
		const history = buildStudyExchangeHistory()
		const sent = createRecorder<readonly [string]>()
		const replay = new ollama.StudyOllamaReplay({
			history,
			url: 'http://127.0.0.1:1',
			prefix: 1,
			limit: { calls: 20, bytes: 65536, duration: 5000 },
			signal: new AbortController().signal,
			fetch: async (_role, input) => {
				sent.handler(String(input))
				return new Response('live')
			},
		})
		try {
			await (await replay.fetch('metadata', 'http://127.0.0.1:1/api/version', {})).text()
			expect(await (await replay.fetch('metadata', 'http://127.0.0.1:1/api/tags', {})).text()).toBe(
				'live',
			)
			expect(sent.count).toBe(1)
			expect(() => replay.check()).not.toThrow()
		} finally {
			await replay.close()
		}
	})

	it('refuses reversed internally paired identities, altered bytes and incomplete histories at construction', () => {
		const history = buildStudyExchangeHistory()
		for (const changed of [
			{ ...history, exchanges: [...history.exchanges].reverse() },
			{ ...history, exchanges: [] },
			{ ...history, completion: { phase: 'complete' as const, count: 1 } },
			{
				...history,
				exchanges: history.exchanges.map((row) => ({
					...row,
					response: { ...row.response, digest: 'c'.repeat(64) },
				})),
			},
		]) {
			expect(
				() =>
					new ollama.StudyOllamaReplay({
						history: changed,
						url: 'http://127.0.0.1:1',
						prefix: history.exchanges.length,
						limit: { calls: 20, bytes: 65536, duration: 5000 },
						signal: new AbortController().signal,
					}),
			).toThrow(/\S/)
		}
	})
})
