import { isRecord, parseJSON } from '@orkestrel/contract'
import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readStudyResult } from '../../../../src/server/stores/helpers.js'
import {
	answerStudyMCP,
	buildStudyCLI,
	createMCPFixture,
	createMCPProxy,
	createOllamaServer,
	executeStudyCLI,
	readStudyAdjudication,
	STUDY_MCP_GOALS,
	sumStudyCalls,
	writeStudyMCP,
} from '../../../setupServer.js'
import { readOllamaToolResults, requireStudyRecord } from '../../../setupStudy.js'

// The subject is the admitted MCP core client and the runtime is the separately admitted Agent,
// both loaded by the captured loader inside the Study child. The MCP server and the Ollama
// protocol peer are external services owned by this test: their bytes are not part of the
// child's captured inventory, and the proof claims nothing about model quality.

describe('admitted Agent over the admitted MCP core client', () => {
	const runtime = createScratch({ parent: resolve('tmp/units'), prefix: 'runtime-mcp-' })
	const compiled = Promise.withResolvers<string>()
	// Registered before the build hook so the scratch is removed even when the build fails.
	afterAll(async () => {
		await destroyScratch(runtime)
	})
	beforeAll(async () => {
		compiled.resolve(await buildStudyCLI(runtime))
	}, 60000)

	it('discovers and calls a real remote tool, returns changed results, and keeps a remote refusal visible', async () => {
		const entry = await compiled.promise
		const consumer = createScratch({
			parent: resolve('tmp/units'),
			prefix: 'runtime-mcp-consumer-',
		})
		const server = await createMCPFixture([
			'shipped Monday',
			'delayed Friday',
			new Error('No order order-1'),
		])
		try {
			const peer = await createOllamaServer([], answerStudyMCP)
			try {
				writeStudyMCP(consumer, server.url, peer.url)
				const executed = await executeStudyCLI(entry, consumer.path, ['execute', 'orders'])
				const output = parseJSON(executed.output.split(/\r\n|\n/)[0] ?? '')
				if (!isRecord(output) || typeof output.path !== 'string')
					throw new Error(`Missing result: ${executed.output}`)
				const sealed = await readStudyResult(output.path)
				if (sealed.status !== 'sealed') throw new Error('Execution did not seal')
				expect({
					code: executed.code,
					failures: sealed.attempts.map((attempt) => attempt.failure),
				}).toEqual({ code: 0, failures: [undefined] })
				const [attempt] = sealed.attempts
				if (attempt === undefined) throw new Error('Missing attempt')
				expect(attempt.failure).toBeUndefined()
				expect(attempt.observations.map((observation) => observation.goal)).toEqual([
					...STUDY_MCP_GOALS,
				])
				for (const observation of attempt.observations) {
					expect(observation.executed).toBe(true)
					expect(observation.failure).toBeUndefined()
					expect(sumStudyCalls(observation, 'agent')).toBe(2)
					expect(sumStudyCalls(observation, 'tool')).toBe(1)
					expect(sumStudyCalls(observation, 'judge')).toBe(0)
					expect(sumStudyCalls(observation, 'summary')).toBe(0)
				}
				// The server executed exactly the three calls, each reached through the subject's client.
				expect(server.calls).toEqual([{ id: 'order-1' }, { id: 'order-1' }, { id: 'order-1' }])
				expect(server.methods.filter((method) => method === 'tools/list')).toHaveLength(1)
				expect(server.methods.filter((method) => method === 'tools/call')).toHaveLength(3)
				// Each product is the answer the peer built from the tool receipt the Agent returned to it.
				const values = attempt.observations.map((observation) => observation.product?.value)
				expect(values).toEqual([
					'Order status: shipped Monday',
					'Order status: delayed Friday',
					expect.stringContaining('No order order-1'),
				])
				expect(new Set(values).size).toBe(values.length)
				const chats = peer.requests.filter((request) => request.path === '/api/chat')
				expect(chats).toHaveLength(6)
				expect(chats[0]?.body).toContain('"name":"lookup"')
				expect(chats.map((request) => readOllamaToolResults(request.body).length)).toEqual([
					0, 1, 0, 1, 0, 1,
				])
				expect(readOllamaToolResults(chats[1]?.body ?? '').at(-1)).toContain('shipped Monday')
				expect(readOllamaToolResults(chats[3]?.body ?? '').at(-1)).toContain('delayed Friday')
				expect(readOllamaToolResults(chats[5]?.body ?? '').at(-1)).toContain('No order order-1')
				// The remote refusal stays an observed tool failure, not a Study operational failure.
				const adjudication = await readStudyAdjudication(sealed)
				const rows = adjudication.evidence[attempt.trial.id] ?? []
				const tools = rows.filter((row) => row.event === 'tool')
				expect(tools.map((row) => row.goal)).toEqual([...STUDY_MCP_GOALS])
				const receipts = tools.map((row) => requireStudyRecord(row.value))
				expect(receipts.map((receipt) => receipt.success)).toEqual([true, true, false])
				expect(receipts.map((receipt) => receipt.name)).toEqual(['lookup', 'lookup', 'lookup'])
				expect(String(receipts[2]?.error)).toContain('No order order-1')
				expect(rows.filter((row) => row.event === 'answered').map((row) => row.goal)).toEqual([
					...STUDY_MCP_GOALS,
				])
			} finally {
				await peer.close()
			}
		} finally {
			await server.close()
			await destroyScratch(consumer)
		}
	}, 60000)

	it.each(['status', 'reset', 'held', 'invalid', 'error'] as const)(
		'keeps a %s tool-call failure an infrastructure failure of the tool role and never answers from it',
		async (interference) => {
			const entry = await compiled.promise
			const consumer = createScratch({
				parent: resolve('tmp/units'),
				prefix: 'runtime-mcp-failure-',
			})
			const server = await createMCPFixture([])
			const proxy = await createMCPProxy(server.url, interference)
			try {
				const peer = await createOllamaServer([], answerStudyMCP)
				try {
					writeStudyMCP(consumer, proxy.url, peer.url)
					const executed = await executeStudyCLI(entry, consumer.path, ['execute', 'orders'])
					const output = parseJSON(executed.output.split(/\r\n|\n/)[0] ?? '')
					if (!isRecord(output) || typeof output.path !== 'string')
						throw new Error(`Missing result: ${executed.output}`)
					const sealed = await readStudyResult(output.path)
					if (sealed.status !== 'sealed') throw new Error('Execution did not seal')
					const [attempt] = sealed.attempts
					if (attempt === undefined) throw new Error('Missing attempt')
					expect(executed.code).toBe(1)
					expect(attempt.failure).toMatchObject({ cause: 'infrastructure', role: 'tool' })
					// The first goal's single interfered call is the only one: no retry and no later goal.
					expect(proxy.intercepted).toEqual([expect.any(Number)])
					expect(server.calls).toEqual([])
					expect(
						attempt.observations.filter((observation) => observation.product !== undefined),
					).toEqual([])
					expect(peer.requests.filter((request) => request.path === '/api/chat')).toHaveLength(1)
					const adjudication = await readStudyAdjudication(sealed)
					const rows = adjudication.evidence[attempt.trial.id] ?? []
					expect(rows.filter((row) => row.event === 'answered')).toEqual([])
				} finally {
					await peer.close()
				}
			} finally {
				await proxy.close()
				await server.close()
				await destroyScratch(consumer)
			}
			await expect(fetch(proxy.url, { method: 'POST', body: '{}' })).rejects.toThrow('fetch failed')
			await expect(fetch(server.url, { method: 'POST', body: '{}' })).rejects.toThrow(
				'fetch failed',
			)
		},
		60000,
	)
})
