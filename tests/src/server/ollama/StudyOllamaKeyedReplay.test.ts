import type { StudyRole } from '../../../../src/core/types.js'
import { collectStream, createRecorder, requireValue } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudyOllamaKeyedReplay } from '../../../../src/server/ollama/StudyOllamaKeyedReplay.js'
import { buildStudyOllamaBytes } from '../../../../src/server/ollama/helpers.js'
import {
	buildStudyExchangeHistory,
	buildStudyKeyedHistory,
	createForeignBudgetError,
} from '../../../setupServer.js'

const URL_ORIGIN = 'http://127.0.0.1:1'

describe('StudyOllamaKeyedReplay', () => {
	it('triage preserves exact reply bytes and chunks and cannot answer another listed role', async () => {
		const text = '{\n"answers":{},"note":"résumé 🦉"\n}'
		const chunks = [1, 2, Buffer.byteLength(text) - 3]
		const history = buildStudyKeyedHistory(['triage'], [text], chunks)
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.role === 'triage'),
		)
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['triage', 'judge'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			const init = { method: 'POST', body: Buffer.from(attempt.body, 'base64').toString() }
			const response = await replay.fetch('triage', `${URL_ORIGIN}/v1/systemone`, init)
			const received = await collectStream(requireValue(response.body))
			expect(received.map((chunk) => chunk.length)).toEqual(chunks)
			expect(Buffer.concat(received).toString()).toBe(text)
			expect(replay.served(response)).toBe(true)
			replay.check()
			await expect(replay.fetch('judge', `${URL_ORIGIN}/v1/systemone`, init)).rejects.toMatchObject(
				{ code: 'FAULT' },
			)
			expect(() => replay.check()).toThrow(/member=none/)
		} finally {
			await replay.close()
		}
	})
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
			expect(replay.served(served)).toBe(true)
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

	it('serves its own copy, so a later change to the record it was given reaches no reply', async () => {
		const history = buildStudyKeyedHistory(['agent'], ['original'])
		const { attempt, response } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['agent'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			Object.assign(response, buildStudyOllamaBytes(Buffer.from('modified')), { chunks: [8] })
			const served = await replay.fetch('agent', `${URL_ORIGIN}${attempt.path}`, {
				method: attempt.method,
				body: Buffer.from(attempt.body, 'base64').toString(),
			})
			expect(replay.served(served)).toBe(true)
			expect(await served.text()).toBe('original')
		} finally {
			await replay.close()
		}
	})

	it('validates and indexes one read of each history, so a value that shifts between reads serves nothing else', async () => {
		const history = buildStudyKeyedHistory(['agent'], ['original'])
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const tampered = buildStudyKeyedHistory(['agent'], ['tampered']).exchanges
		const reads = createRecorder<readonly []>()
		const shifting = Object.defineProperty({ ...history }, 'exchanges', {
			enumerable: true,
			get: () => {
				reads.handler()
				return reads.calls.length === 1 ? history.exchanges : tampered
			},
		})
		const replay = new StudyOllamaKeyedReplay({
			histories: [shifting],
			roles: ['agent'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			const served = await replay.fetch('agent', `${URL_ORIGIN}${attempt.path}`, {
				method: attempt.method,
				body: Buffer.from(attempt.body, 'base64').toString(),
			})
			expect(await served.text()).toBe('original')
			expect(reads.calls).toHaveLength(1)
		} finally {
			await replay.close()
		}
	})

	it('sends a miss live when the body, the method, or the path differs', async () => {
		const history = buildStudyExchangeHistory()
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const sent = createRecorder<readonly [string]>()
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: [attempt.role],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
			fetch: async (_role, input) => {
				sent.handler(new URL(input).pathname)
				return new Response('live')
			},
		})
		try {
			const body = Buffer.from(attempt.body, 'base64').toString()
			const misses = [
				{ path: attempt.path, init: { method: attempt.method, body: `${body} ` } },
				{ path: attempt.path, init: { method: 'PUT', body } },
				{ path: '/api/other', init: { method: attempt.method, body } },
			]
			for (const { path, init } of misses) {
				const answer = await replay.fetch(attempt.role, `${URL_ORIGIN}${path}`, init)
				expect(replay.served(answer)).toBe(false)
				expect(await answer.text()).toBe('live')
			}
			expect(sent.calls.map(([path]) => path)).toEqual([attempt.path, attempt.path, '/api/other'])
		} finally {
			await replay.close()
		}
	})

	it('never serves an unlisted role, though its recorded attempt equals the request', async () => {
		const history = buildStudyExchangeHistory()
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const listed: StudyRole = attempt.role === 'judge' ? 'agent' : 'judge'
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: [listed],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
			fetch: async () => new Response('live'),
		})
		try {
			const answer = await replay.fetch(attempt.role, `${URL_ORIGIN}${attempt.path}`, {
				method: attempt.method,
				body: Buffer.from(attempt.body, 'base64').toString(),
			})
			expect(replay.served(answer)).toBe(false)
			expect(await answer.text()).toBe('live')
		} finally {
			await replay.close()
		}
	})

	it('keys the role, so an earlier attempt of another role hides no later one', async () => {
		const history = buildStudyKeyedHistory(['agent', 'summary'], ['first', 'second'])
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['agent', 'summary'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			const body = Buffer.from(attempt.body, 'base64').toString()
			const init = { method: attempt.method, body }
			const url = `${URL_ORIGIN}${attempt.path}`
			expect(await (await replay.fetch('agent', url, init)).text()).toBe('first')
			expect(await (await replay.fetch('summary', url, init)).text()).toBe('second')
		} finally {
			await replay.close()
		}
	})

	it('treats a recorded attempt of another role as a miss, though both roles are listed', async () => {
		const history = buildStudyKeyedHistory(['agent'], ['first'])
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const replay = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['agent', 'judge'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			await expect(
				replay.fetch('judge', `${URL_ORIGIN}${attempt.path}`, {
					method: attempt.method,
					body: Buffer.from(attempt.body, 'base64').toString(),
				}),
			).rejects.toMatchObject({ code: 'FAULT', message: expect.stringContaining('member=none') })
		} finally {
			await replay.close()
		}
	})

	it('serves the first recorded reply of a repeated request, across histories', async () => {
		const first = buildStudyKeyedHistory(['agent'], ['first'])
		const second = buildStudyKeyedHistory(['agent'], ['second'])
		const { attempt } = requireValue(
			first.exchanges.find((pair) => pair.attempt.stage === 'execution'),
		)
		const replay = new StudyOllamaKeyedReplay({
			histories: [first, second],
			roles: ['agent'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
		})
		try {
			const answer = await replay.fetch('agent', `${URL_ORIGIN}${attempt.path}`, {
				method: attempt.method,
				body: Buffer.from(attempt.body, 'base64').toString(),
			})
			expect(await answer.text()).toBe('first')
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

	it('leaves a budget cut unlatched, as the transport does, and latches any other sender failure', async () => {
		const budget = createForeignBudgetError()
		const history = buildStudyExchangeHistory()
		const cut = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['judge'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
			fetch: () => Promise.reject(budget),
		})
		await expect(cut.fetch('agent', `${URL_ORIGIN}/api/chat`, { method: 'GET' })).rejects.toBe(
			budget,
		)
		expect(() => cut.check()).not.toThrow()
		await cut.close()
		const failure = new Error('Broken wire')
		const broken = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['judge'],
			url: URL_ORIGIN,
			signal: new AbortController().signal,
			fetch: () => Promise.reject(failure),
		})
		await expect(broken.fetch('agent', `${URL_ORIGIN}/api/chat`, { method: 'GET' })).rejects.toBe(
			failure,
		)
		expect(() => broken.check()).toThrow(failure)
		await broken.close()
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

	it('refuses at close an offline replay no adapter reached, and only that one', async () => {
		const history = buildStudyExchangeHistory()
		const signal = new AbortController().signal
		const unreached = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['agent'],
			url: URL_ORIGIN,
			signal,
		})
		await expect(unreached.close()).rejects.toMatchObject({
			code: 'FAULT',
			message: 'Offline keyed replay was never reached by the adapter',
		})
		await expect(unreached.close()).resolves.toBeUndefined()
		const live = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['agent'],
			url: URL_ORIGIN,
			signal,
			fetch: async () => new Response('live'),
		})
		await expect(live.close()).resolves.toBeUndefined()
		const cancelled = new AbortController()
		const aborted = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['agent'],
			url: URL_ORIGIN,
			signal: cancelled.signal,
		})
		cancelled.abort(new Error('Cancelled'))
		await expect(aborted.close()).resolves.toBeUndefined()
		const { attempt } = requireValue(
			history.exchanges.find((pair) => pair.attempt.stage === 'preflight'),
		)
		const reached = new StudyOllamaKeyedReplay({
			histories: [history],
			roles: ['metadata'],
			url: URL_ORIGIN,
			signal,
		})
		await (
			await reached.fetch('metadata', `${URL_ORIGIN}${attempt.path}`, { method: 'GET' })
		).text()
		await expect(reached.close()).resolves.toBeUndefined()
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
			fetch: async () => new Response('live'),
		})
		await replay.close()
		await expect(
			replay.fetch('agent', `${URL_ORIGIN}/api/tags`, { method: 'GET' }),
		).rejects.toThrow('closed')
	})
})
