import type { StudyRole } from '../../../../src/core/types.js'
import { createRecorder, requireValue } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { STUDY_OLLAMA_SERVED } from '../../../../src/server/ollama/constants.js'
import { StudyOllamaKeyedReplay } from '../../../../src/server/ollama/StudyOllamaKeyedReplay.js'
import { buildStudyExchangeHistory } from '../../../setupServer.js'

const URL_ORIGIN = 'http://127.0.0.1:1'

describe('StudyOllamaKeyedReplay', () => {
	it('serves a listed role by equal path, method, and body, marked, with its recorded chunks', async () => {
		const history = buildStudyExchangeHistory()
		const { attempt, response } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const sent = createRecorder<readonly [StudyRole]>()
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: [attempt.role],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
			fetch: async (role) => {
				sent.handler(role)
				return new Response('live')
			},
		})
		try {
			const body = Buffer.from(attempt.body, 'base64').toString()
			const served = await replay.fetch(attempt.role, `${URL_ORIGIN}${attempt.path}`, {
				method: attempt.method,
				body,
			})
			expect(Reflect.get(served, STUDY_OLLAMA_SERVED)).toBe(true)
			expect(served.status).toBe(response.status)
			const text = await served.text()
			expect(Buffer.from(text).toString('base64')).toBe(response.body)
			const again = await replay.fetch(attempt.role, `${URL_ORIGIN}${attempt.path}`, {
				method: attempt.method,
				body,
			})
			expect(await again.text()).toBe(text)
			expect(sent.calls).toEqual([])
			replay.check()
		} finally {
			await replay.close()
		}
	})

	it('sends a miss live, a changed body, method, and path included, and an unlisted role never serves', async () => {
		const history = buildStudyExchangeHistory()
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const sent = createRecorder<readonly [StudyRole]>()
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: [attempt.role],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
			fetch: async (role) => {
				sent.handler(role)
				return new Response('live')
			},
		})
		try {
			const body = Buffer.from(attempt.body, 'base64').toString()
			const other: StudyRole = attempt.role === 'agent' ? 'judge' : 'agent'
			const misses = [
				{ role: attempt.role, path: attempt.path, init: { method: 'POST', body: `${body} ` } },
				{ role: attempt.role, path: '/api/other', init: { method: 'POST', body } },
				{ role: other, path: attempt.path, init: { method: 'POST', body } },
			] as const
			for (const { role, path, init } of misses) {
				const answer = await replay.fetch(role, `${URL_ORIGIN}${path}`, init)
				expect(Reflect.get(answer, STUDY_OLLAMA_SERVED)).toBeUndefined()
				expect(await answer.text()).toBe('live')
			}
			expect(sent.calls.map(([role]) => role)).toEqual([attempt.role, attempt.role, other])
		} finally {
			await replay.close()
		}
	})

	it('treats a recorded attempt of another role as a miss, though both roles are listed', async () => {
		const history = buildStudyExchangeHistory()
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const other: StudyRole = attempt.role === 'agent' ? 'judge' : 'agent'
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: [attempt.role, other],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			await expect(
				replay.fetch(other, `${URL_ORIGIN}${attempt.path}`, {
					method: attempt.method,
					body: Buffer.from(attempt.body, 'base64').toString(),
				}),
			).rejects.toMatchObject({ code: 'FAULT' })
		} finally {
			await replay.close()
		}
	})

	it('refuses a miss with no live sender and latches the refusal', async () => {
		const history = buildStudyExchangeHistory()
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['judge'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			await expect(
				replay.fetch('judge', `${URL_ORIGIN}/api/generate`, { method: 'POST', body: '{}' }),
			).rejects.toMatchObject({
				code: 'FAULT',
				message: expect.stringContaining('member=none'),
			})
			expect(() => replay.check()).toThrow('member=none')
		} finally {
			await replay.close()
		}
	})

	it('refuses a request from another origin rather than serving it', async () => {
		const history = buildStudyExchangeHistory()
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: [attempt.role],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			await expect(
				replay.fetch(attempt.role, `http://127.0.0.1:2${attempt.path}`, {
					method: attempt.method,
					body: Buffer.from(attempt.body, 'base64').toString(),
				}),
			).rejects.toMatchObject({ code: 'FAULT' })
		} finally {
			await replay.close()
		}
	})

	it('refuses custody over a tampered row before any sender is reached', () => {
		const history = buildStudyExchangeHistory()
		const tampered = {
			...history,
			exchanges: history.exchanges.map((pair) =>
				pair.attempt.stage === 'execution'
					? {
							...pair,
							response: { ...pair.response, body: Buffer.from('tampered').toString('base64') },
						}
					: pair,
			),
		}
		expect(
			() =>
				new StudyOllamaKeyedReplay({
					histories: [tampered],
					roles: ['agent'],
					url: URL_ORIGIN,
					signal: new AbortController().signal,
				}),
		).toThrow(expect.objectContaining({ code: 'CUSTODY' }))
	})

	it('refuses no roles, a pathful origin, and a closed replay', async () => {
		const history = buildStudyExchangeHistory()
		const signal = new AbortController().signal
		expect(
			() =>
				new StudyOllamaKeyedReplay({ histories: [history], roles: [], url: URL_ORIGIN, signal }),
		).toThrow(expect.objectContaining({ code: 'CONFIG' }))
		expect(
			() =>
				new StudyOllamaKeyedReplay({
					histories: [history],
					roles: ['agent'],
					url: `${URL_ORIGIN}/nested`,
					signal,
				}),
		).toThrow(expect.objectContaining({ code: 'CONFIG' }))
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['agent'],
			url: URL_ORIGIN,
			signal,
		})
		await replay.close()
		await expect(
			replay.fetch('agent', `${URL_ORIGIN}/api/tags`, { method: 'GET' }),
		).rejects.toThrow('closed')
	})
})
