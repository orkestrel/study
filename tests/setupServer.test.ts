import { createRecorder, requireValue, waitForCondition, waitForEvent } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { execFileSync, fork, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isArray, isRecord, parseJSON } from '@orkestrel/contract'
import type { StudyObservation } from '../src/core/types.js'
import { createMCPClient, HTTPClientTransport } from '@orkestrel/mcp'
import { existsSync, readFileSync } from 'node:fs'
import { isStudyBounds } from '../src/core/validators.js'
import { STUDY_LAUNCH_BYTES } from '../src/server/launchers/constants.js'
import { buildStudyRubric } from './setupStudy.js'
import {
	STUDY_BURST_ARGUMENTS,
	STUDY_CHECK_FINGERPRINT,
	STUDY_HOSTILE_REFERENCES,
	STUDY_LAUNCHER_PID,
	STUDY_TASK_INSTRUMENT,
	buildStudyEvidenceRow,
	buildStudySparseEvidence,
	admitStudyLibrary,
	answerStudyMCP,
	collectStudyRoots,
	createMCPFixture,
	createMCPProxy,
	createOllamaContext,
	createOllamaExchange,
	createOllamaServer,
	resolveStudyEntry,
	resolveStudyPackage,
	sumStudyCalls,
	buildCustodyGrading,
	buildCustodyLabeling,
	buildCustodyPacketLabeling,
	buildStudyCheckReply,
	buildStudyCLI,
	buildStudyLibrary,
	buildStudySessionOptions,
	buildStudyTaskOptions,
	createArtifactWorker,
	createStudyPeer,
	executeStudyCLI,
	readStudyCheck,
	readStudyCommands,
	readStudyOrphan,
	readStudyPid,
	releaseStudyPid,
	retainStudyFixture,
	spawnStudyScript,
	writeStudyAgent,
	writeStudyTaskAdapter,
	writeStudyBurstEntry,
	writeStudyCheckEntry,
	createStudyConsumer,
	writeStudyConsumer,
	writeStudyLauncherEntry,
	writeStudyOrphan,
} from './setupServer.js'

describe('study server fixtures', () => {
	it('binds native fixture declarations to the selected entry and live cancellation', () => {
		const scratch = createScratch()
		try {
			const entry = scratch.write('worker.cjs', '')
			const controller = new AbortController()
			const options = buildStudySessionOptions(scratch, entry, controller.signal)
			expect(options.entry).toBe(entry)
			expect(options.root).toBe(scratch.path)
			expect(options.adapter).toBe(scratch.path)
			expect(options.directory).toBe(join(scratch.path, 'trials'))
			expect(scratch.has('trials')).toBe(true)
			expect(options.trial).toMatchObject({ scenario: 'first', arm: 'large', repetition: 0 })
			expect(isStudyBounds(options.profile.bounds)).toBe(true)
			expect(options.signal).toBe(controller.signal)
			controller.abort('fixture cancellation')
			expect(options.signal.reason).toBe('fixture cancellation')
			const task = buildStudyTaskOptions(entry, 1200)
			expect(task).toEqual({ entry, root: resolve('.'), adapter: entry, roots: [], duration: 1200 })
			expect(buildStudyTaskOptions(entry).duration).toBe(5000)
		} finally {
			scratch.destroy()
		}
	})
	it('writes an installed agent package that records evaluation and reads a check identity', () => {
		const scratch = createScratch()
		try {
			const agent = writeStudyAgent(scratch, 'agent', 'agent-loaded')
			expect(agent.root).toBe(join(scratch.path, 'agent'))
			expect(agent.entry).toBe(join(scratch.path, 'agent', 'dist', 'index.js'))
			expect(agent.log).toBe(join(scratch.path, 'agent.log'))
			expect(scratch.has('agent.log')).toBe(false)
			expect(scratch.read('agent/dist/index.js')).toContain('agent-loaded')
			const digest = 'a'.repeat(64)
			const printed = JSON.stringify({ identity: { agent: digest }, fingerprint: digest })
			expect(readStudyCheck(printed)).toEqual({ agent: digest, fingerprint: digest })
			expect(() => readStudyCheck(JSON.stringify({ identity: {}, fingerprint: digest }))).toThrow(
				'Missing check identity',
			)
		} finally {
			scratch.destroy()
		}
	})
	it('creates an owned consumer holding the study declarations and removes it on destroy', () => {
		const scratch = createStudyConsumer()
		try {
			expect(scratch.path).toContain('runtime-consumer-')
			expect(scratch.has('studies/assessment/study.json')).toBe(true)
			expect(scratch.has('subject/dist/index.js')).toBe(true)
		} finally {
			scratch.destroy()
		}
		expect(scratch.has('studies/assessment/study.json')).toBe(false)
	})
	it('destroys the owned consumer before it rethrows a failed write', () => {
		const failure = new Error('Consumer write failed')
		const created = createRecorder<readonly [string]>()
		expect(() =>
			createStudyConsumer((scratch) => {
				created.handler(scratch.path)
				throw failure
			}),
		).toThrow(failure)
		const [path] = created.calls[0] ?? []
		if (path === undefined) throw new Error('The writer never received the scratch')
		expect(existsSync(path)).toBe(false)
	})
	it('builds the native CLI and supplies a checkable consumer without importing its subject', async () => {
		const scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'setup-cli-' })
		try {
			writeStudyConsumer(scratch)
			const entry = await buildStudyCLI(scratch)
			const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect(checked.code).toBe(0)
			expect(() => JSON.parse(checked.output)).not.toThrow()
			const refused = await executeStudyCLI(entry, scratch.path, ['check', 'missing'])
			expect(refused.code).not.toBe(0)
		} finally {
			scratch.destroy()
		}
	})
	it('builds the core library as a separate importable package with its own error class', async () => {
		const scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'setup-library-' })
		try {
			const entry = await buildStudyLibrary(scratch)
			expect(entry).toBe(join(scratch.path, 'library', 'dist', 'index.js'))
			expect(scratch.read('library/package.json')).toContain('"type":"module"')
			const constructed = execFileSync(
				process.execPath,
				[
					'--input-type=module',
					'--eval',
					`import { StudyError } from ${JSON.stringify(pathToFileURL(entry).href)}; const error = new StudyError('CONFIG', 'Built refusal'); console.log(error.name + ':' + error.code + ':' + error.message)`,
				],
				{ encoding: 'utf8', timeout: 10000, windowsHide: true },
			)
			expect(constructed).toBe('StudyError:CONFIG:Built refusal\n')
			const consumer = createScratch({ parent: resolve('tmp/units'), prefix: 'setup-admitted-' })
			try {
				writeStudyConsumer(consumer)
				const before = parseJSON(consumer.read('studies/files/profiles/local.json') ?? '')
				if (!isRecord(before) || !isArray(before.roots)) throw new Error('Missing consumer profile')
				admitStudyLibrary(consumer, scratch)
				expect(parseJSON(consumer.read('studies/files/profiles/local.json') ?? '')).toEqual({
					...before,
					roots: [...before.roots, join(scratch.path, 'library')],
				})
			} finally {
				consumer.destroy()
			}
		} finally {
			scratch.destroy()
		}
	})
	it('creates an executable native artifact worker in its owned scratch directory', () => {
		const scratch = createScratch()
		try {
			const worker = createArtifactWorker(
				scratch,
				"assert.equal(typeof ArtifactLoader, 'function'); console.log('artifact-ready')",
			)
			expect(
				execFileSync(process.execPath, [worker], {
					encoding: 'utf8',
					timeout: 10000,
					windowsHide: true,
				}),
			).toBe('artifact-ready\n')
		} finally {
			scratch.destroy()
		}
	})
	it('forks a scripted peer over real IPC and releases it idempotently after a bounded exit', async () => {
		const scratch = createScratch()
		try {
			const peer = createStudyPeer(scratch, `process.on('message', (value) => process.send(value))`)
			const echoed = waitForEvent(
				(listener: (value: unknown) => void) => {
					peer.child.once('message', listener)
					return () => {
						peer.child.off('message', listener)
					}
				},
				'study peer echo',
				{ budget: 5000 },
			)
			peer.child.send({ ping: true })
			expect((await echoed)[0]).toEqual({ ping: true })
			await peer.close()
			await peer.close()
			expect(peer.child.exitCode !== null || peer.child.signalCode !== null).toBe(true)
			expect(peer.child.connected).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
	it('leaves a live detached leaf after its root exits and cleans only the recorded leaf', async () => {
		const scratch = createScratch()
		try {
			const root = fork(writeStudyOrphan(scratch, 20000), [], {
				execArgv: [],
				silent: true,
				windowsHide: true,
			})
			const exited = waitForEvent(
				(listener: () => void) => {
					root.once('exit', listener)
					return () => {
						root.off('exit', listener)
					}
				},
				'orphan root exit',
				{ budget: 5000 },
			)
			root.send({ start: true })
			await exited
			await waitForCondition(
				'orphan receipt exists',
				() => readStudyOrphan(scratch) !== undefined,
				{
					budget: 3000,
					interval: 10,
				},
			)
			const receipt = requireValue(readStudyOrphan(scratch))
			expect(receipt.root).toBe(root.pid)
			expect(isRunning(receipt.root)).toBe(false)
			expect(isRunning(receipt.leaf)).toBe(true)
			await releaseStudyPid(receipt.leaf)
			expect(isRunning(receipt.leaf)).toBe(false)
		} finally {
			await releaseStudyPid(readStudyOrphan(scratch)?.leaf)
			scratch.destroy()
		}
	}, 15000)
	it('records the pid and command of a launcher entry and exits with the body outcome', () => {
		const scratch = createScratch()
		try {
			const entry = writeStudyLauncherEntry(scratch, 20000, "finish(7, 'answer')")
			expect(readStudyCommands(scratch)).toEqual([])
			const result = spawnSync(process.execPath, [entry, 'study-command', 'check', 'files'], {
				encoding: 'utf8',
				timeout: 10000,
				windowsHide: true,
			})
			expect(result.status).toBe(7)
			expect(result.stdout).toBe('answer')
			expect(readStudyPid(scratch, STUDY_LAUNCHER_PID)).toBe(result.pid)
			expect(readStudyCommands(scratch)).toEqual(['check files'])
		} finally {
			scratch.destroy()
		}
	})
	it('answers check with a valid reply at the requested duration and exits 0 for another command', () => {
		const scratch = createScratch()
		try {
			const entry = writeStudyCheckEntry(scratch, 86400000)
			const checked = spawnSync(process.execPath, [entry, 'study-command', 'check', 'files'], {
				encoding: 'utf8',
				timeout: 10000,
				windowsHide: true,
			})
			const reply: unknown = JSON.parse(checked.stdout)
			expect(checked.status).toBe(0)
			expect(isRecord(reply) && isStudyBounds(reply.bounds) && reply.bounds.series.duration).toBe(
				86400000,
			)
			expect(isRecord(reply) && reply.fingerprint).toBe(STUDY_CHECK_FINGERPRINT)
			const executed = spawnSync(process.execPath, [entry, 'study-command', 'execute', 'files'], {
				encoding: 'utf8',
				timeout: 10000,
				windowsHide: true,
			})
			expect(executed.status).toBe(0)
			expect(executed.stdout).toBe('')
			expect(readStudyCommands(scratch)).toEqual(['check files', 'execute files'])
		} finally {
			scratch.destroy()
		}
	})
	it('writes an adapter that records its pid and answers a valid request with the fixture instrument', async () => {
		const scratch = createScratch()
		const child = fork(writeStudyTaskAdapter(scratch, 'valid'), [], {
			execArgv: [],
			silent: true,
			windowsHide: true,
		})
		try {
			const answered = waitForEvent(
				(listener: (value: unknown) => void) => {
					child.once('message', listener)
					return () => {
						child.off('message', listener)
					}
				},
				'task adapter answer',
				{ budget: 5000 },
			)
			child.send({ request: true })
			expect((await answered)[0]).toEqual({ instrument: STUDY_TASK_INSTRUMENT, value: true })
			expect(readStudyPid(scratch, 'task-pid.txt')).toBe(child.pid)
		} finally {
			child.kill()
			scratch.destroy()
		}
	})
	it('creates an exchange over a real ticket whose tally starts from the request bytes', async () => {
		const fixture = await createOllamaExchange(7)
		try {
			expect(fixture.exchange.bytes).toBe(7)
			expect(fixture.exchange.request.role).toBe('agent')
			expect(fixture.exchange.activity.context).toBe(fixture.goal.context)
			expect(fixture.exchange.ticket.signal.aborted).toBe(false)
		} finally {
			fixture.close()
		}
	})
	it('spawns a finite child that evaluates one program with piped output', async () => {
		const child = spawnStudyScript(
			"process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
		)
		const closed = waitForEvent(
			(listener: (code: number | null) => void) => {
				child.once('close', listener)
				return () => {
					child.off('close', listener)
				}
			},
			'script child close',
			{ budget: 10000 },
		)
		const outputs = [child.stdout, child.stderr].map(
			(stream) =>
				new Promise<string>((done) => {
					stream?.setEncoding('utf8')
					stream?.once('data', (text: string) => done(text))
				}),
		)
		expect((await closed)[0]).toBe(3)
		expect(await Promise.all(outputs)).toEqual(['out', 'err'])
	})
	it('builds a check reply that declares the requested series duration and the fixture fingerprint', () => {
		const reply: unknown = JSON.parse(buildStudyCheckReply(4200))
		expect(isRecord(reply) && isStudyBounds(reply.bounds) && reply.bounds.series.duration).toBe(
			4200,
		)
		expect(isRecord(reply) && reply.fingerprint).toBe(STUDY_CHECK_FINGERPRINT)
	})
	it('answers a held check after a pause, overflows a burst check and exits 0 for another command', () => {
		const scratch = createScratch()
		try {
			const entry = writeStudyBurstEntry(scratch)
			const burst = spawnSync(
				process.execPath,
				[entry, 'study-command', 'check', 'files', '--profile', 'burst'],
				{ timeout: 15000, windowsHide: true, maxBuffer: STUDY_LAUNCH_BYTES * 2 },
			)
			expect(burst.status).toBe(0)
			expect(burst.stdout.byteLength).toBe(STUDY_LAUNCH_BYTES + 1)
			const held = spawnSync(
				process.execPath,
				[entry, 'study-command', 'check', 'files', '--profile', 'hold'],
				{ encoding: 'utf8', timeout: 15000, windowsHide: true },
			)
			const reply: unknown = JSON.parse(held.stdout)
			expect(held.status).toBe(0)
			expect(isRecord(reply) && reply.fingerprint).toBe(STUDY_CHECK_FINGERPRINT)
			const executed = spawnSync(
				process.execPath,
				[entry, 'study-command', ...STUDY_BURST_ARGUMENTS],
				{
					encoding: 'utf8',
					timeout: 15000,
					windowsHide: true,
				},
			)
			expect(executed.status).toBe(0)
			expect(executed.stdout).toBe('')
		} finally {
			scratch.destroy()
		}
	})
	it('returns a sealed real-files fixture with complete grades and explicit supplied label provenance', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			const rubric = buildStudyRubric()
			const grading = buildCustodyGrading(result, rubric)
			const neutral = buildCustodyPacketLabeling(result, rubric)
			expect(neutral.packet).not.toBe(result.seal.id)
			expect(neutral.judgments[0]?.trial).not.toBe(result.manifest.schedule[0]?.id)
			expect(neutral.judgments[0]?.criterion).not.toBe('first-read')
			expect(grading.attempts).toEqual(result.manifest.schedule.map((trial) => trial.id))
			expect(
				grading.judgments
					.filter((judgment) => judgment.method === 'human')
					.every((judgment) => judgment.verdict === 'unknown'),
			).toBe(true)
			const labels = buildCustodyLabeling(result, 'supplied-human')
			expect(labels.labeler).toBe('supplied-human')
			expect(labels.created).toBe('2026-10-14T12:00:00.000Z')
			expect(buildCustodyGrading(result, rubric, labels).judgments).toEqual(
				expect.arrayContaining([...labels.judgments]),
			)
		} finally {
			scratch.destroy()
		}
	})
	it('resolves installed packages to canonical roots and entries with their declared dependency closure', () => {
		const root = resolveStudyPackage(resolve('.'), '@orkestrel/mcp')
		const manifest = parseJSON(readFileSync(join(root, 'package.json'), 'utf8'))
		expect(isRecord(manifest) && manifest.name).toBe('@orkestrel/mcp')
		const entry = resolveStudyEntry('@orkestrel/mcp')
		expect(entry).toBe(join(root, 'dist', 'src', 'core', 'index.js'))
		expect(existsSync(entry)).toBe(true)
		const roots = collectStudyRoots(['@orkestrel/mcp', '@orkestrel/mcp'])
		expect(new Set(roots).size).toBe(roots.length)
		const names = roots.map((candidate) => {
			const declared = parseJSON(readFileSync(join(candidate, 'package.json'), 'utf8'))
			return isRecord(declared) ? declared.name : undefined
		})
		expect(names).toContain('@orkestrel/mcp')
		expect(names).toContain('@orkestrel/contract')
		expect(names).toContain('@orkestrel/tool')
		// A peer dependency is not a runtime dependency of the closure.
		expect(names).not.toContain('@orkestrel/router')
		expect(() => resolveStudyPackage(resolve('.'), '@orkestrel/absent-package')).toThrow(
			'@orkestrel/absent-package',
		)
	})
	it('answers a chat request as a protocol peer from the exact last message and refuses invalid requests', () => {
		const user = { role: 'user', content: 'Where?' }
		expect(answerStudyMCP('/api/tags', '{}')).toBeUndefined()
		const asked = parseJSON(
			(answerStudyMCP('/api/chat', JSON.stringify({ messages: [user] })) ?? '').trim(),
		)
		expect(asked).toMatchObject({
			message: { tool_calls: [{ function: { name: 'lookup', arguments: { id: 'order-1' } } }] },
		})
		for (const receipt of ['shipped Monday', 'delayed Friday']) {
			const body = JSON.stringify({ messages: [user, { role: 'tool', content: receipt }] })
			const answered = parseJSON((answerStudyMCP('/api/chat', body) ?? '').trim())
			expect(answered).toMatchObject({ message: { content: `Order status: ${receipt}` } })
			expect(answered).not.toHaveProperty('message.tool_calls')
		}
		// An earlier receipt does not answer a later request that ends on a user message.
		const later = JSON.stringify({ messages: [{ role: 'tool', content: 'shipped Monday' }, user] })
		expect(parseJSON((answerStudyMCP('/api/chat', later) ?? '').trim())).toMatchObject({
			message: { tool_calls: [{ function: { name: 'lookup' } }] },
		})
		expect(() => answerStudyMCP('/api/chat', 'not json')).toThrow('Invalid chat request')
		expect(() => answerStudyMCP('/api/chat', '{"messages":{}}')).toThrow('Invalid chat request')
		expect(() => answerStudyMCP('/api/chat', '{"messages":[]}')).toThrow('Invalid chat message')
		expect(() =>
			answerStudyMCP('/api/chat', JSON.stringify({ messages: [{ role: 'tool', content: 7 }] })),
		).toThrow('Invalid tool receipt')
	})
	it('serves scripted outcomes through the real client, records receipts, and releases its port', async () => {
		const server = await createMCPFixture(['shipped Monday', new Error('No order order-1')])
		const client = createMCPClient({
			transport: new HTTPClientTransport({ url: server.url, timeout: 2000 }),
			timeout: 2000,
		})
		try {
			await client.connect()
			expect((await client.tools()).map((tool) => tool.name)).toEqual(['lookup'])
			expect(await client.call('lookup', { id: 'a' })).toEqual({
				resultType: 'complete',
				value: 'shipped Monday',
			})
			await expect(client.call('lookup', { id: 'b' })).rejects.toThrow('No order order-1')
			await expect(client.call('lookup', { id: 'c' })).rejects.toThrow('No scripted outcome')
			expect(server.calls).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
			expect(server.methods.filter((method) => method === 'tools/call')).toHaveLength(3)
		} finally {
			await client.disconnect()
			await server.close()
		}
		await expect(fetch(server.url, { method: 'POST', body: '{}' })).rejects.toThrow('fetch failed')
	})
	it('keeps the MCP fixture outcome sequence it was created with after the caller changes its array', async () => {
		const outcomes: Array<string | Error> = ['original']
		const server = await createMCPFixture(outcomes)
		const client = createMCPClient({
			transport: new HTTPClientTransport({ url: server.url, timeout: 2000 }),
			timeout: 2000,
		})
		try {
			outcomes.fill('changed')
			outcomes.push('extra')
			await client.connect()
			expect(await client.call('lookup', { id: 'a' })).toEqual({
				resultType: 'complete',
				value: 'original',
			})
			await expect(client.call('lookup', { id: 'b' })).rejects.toThrow('No scripted outcome')
			expect(server.calls).toEqual([{ id: 'a' }, { id: 'b' }])
		} finally {
			await client.disconnect()
			await server.close()
		}
	})
	it('shows a retained MCP fixture reference its later calls and methods', async () => {
		const server = await createMCPFixture(['shipped Monday'])
		const calls = server.calls
		const methods = server.methods
		const client = createMCPClient({
			transport: new HTTPClientTransport({ url: server.url, timeout: 2000 }),
			timeout: 2000,
		})
		try {
			expect([calls.length, methods.length]).toEqual([0, 0])
			await client.connect()
			await client.call('lookup', { id: 'a' })
			expect(calls).toEqual([{ id: 'a' }])
			expect(methods).toContain('tools/call')
			expect(server.calls).toBe(calls)
			expect(server.methods).toBe(methods)
		} finally {
			await client.disconnect()
			await server.close()
		}
	})
	it('shows a retained MCP proxy reference the ids it interferes with later', async () => {
		const server = await createMCPFixture(['unreached'])
		const proxy = await createMCPProxy(server.url, 'status')
		const intercepted = proxy.intercepted
		const client = createMCPClient({
			transport: new HTTPClientTransport({ url: proxy.url, timeout: 300 }),
			timeout: 300,
		})
		try {
			await client.connect()
			expect(intercepted).toEqual([])
			await client.call('lookup', { id: 'a' }).catch(() => undefined)
			expect(intercepted).toHaveLength(1)
			expect(proxy.intercepted).toBe(intercepted)
		} finally {
			await client.disconnect()
			await proxy.close()
			await server.close()
		}
	})
	it('shows a retained Ollama peer reference its later requests and owners', async () => {
		const peer = await createOllamaServer()
		const requests = peer.requests
		const owned = peer.owned
		try {
			expect([requests.length, owned.length]).toEqual([0, 0])
			await fetch(`${peer.url}/api/tags`, {
				method: 'POST',
				body: '{}',
				headers: { 'x-study-owned': 'recorded' },
			})
			expect(requests.map((request) => request.path)).toEqual(['/api/tags'])
			expect(owned).toEqual(['recorded'])
			expect(peer.requests).toBe(requests)
			expect(peer.owned).toBe(owned)
		} finally {
			await peer.close()
		}
	})
	it('shows a retained goal context reference the evidence appended later', async () => {
		const goal = createOllamaContext()
		try {
			const evidence = goal.evidence
			expect(evidence).toEqual([])
			await goal.context.evidence.append(buildStudyEvidenceRow('a'))
			expect(evidence).toEqual([buildStudyEvidenceRow('a')])
			expect(goal.evidence).toBe(evidence)
		} finally {
			goal.close()
		}
	})
	it('forwards discovery through the MCP proxy and interferes only with tool calls, then releases its port', async () => {
		for (const interference of ['status', 'reset', 'held', 'invalid', 'error'] as const) {
			const server = await createMCPFixture(['unreached'])
			const proxy = await createMCPProxy(server.url, interference)
			const client = createMCPClient({
				transport: new HTTPClientTransport({ url: proxy.url, timeout: 300 }),
				timeout: 300,
			})
			try {
				await client.connect()
				expect((await client.tools()).map((tool) => tool.name)).toEqual(['lookup'])
				const refused = await client.call('lookup', { id: 'a' }).then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(refused).toBeInstanceOf(Error)
				expect(proxy.intercepted).toHaveLength(1)
				expect(server.calls).toEqual([])
				expect(server.methods.filter((method) => method === 'tools/call')).toEqual([])
				expect(server.methods).toContain('tools/list')
			} finally {
				await client.disconnect()
				await proxy.close()
				await server.close()
			}
			await expect(fetch(proxy.url, { method: 'POST', body: '{}' })).rejects.toThrow('fetch failed')
		}
	})
	it('lets an Ollama peer answer from request bytes without disturbing queued or default replies', async () => {
		const peer = await createOllamaServer([], answerStudyMCP)
		try {
			const chat = await fetch(`${peer.url}/api/chat`, {
				method: 'POST',
				body: JSON.stringify({ messages: [{ role: 'tool', content: 'delayed Friday' }] }),
			})
			expect(await chat.text()).toContain('Order status: delayed Friday')
			const tags = await fetch(`${peer.url}/api/tags`, {
				method: 'POST',
				body: '{}',
				headers: { 'x-study-owned': 'recorded' },
			})
			expect(await tags.text()).toContain('"models"')
			expect(peer.requests.map((request) => request.path)).toEqual(['/api/chat', '/api/tags'])
			expect(peer.owned).toEqual([undefined, 'recorded'])
		} finally {
			await peer.close()
		}
	})
	it('serves queued replies in order by path and reports the unserved remainder', async () => {
		const queued = [
			{ path: '/api/tags', body: 'first' },
			{ path: '/api/chat', body: 'second' },
		] as const
		const peer = await createOllamaServer(queued)
		try {
			expect(peer.replies).toEqual(queued)
			// A path that is not at the head of the queue is answered by default and leaves the queue whole.
			const early = await fetch(`${peer.url}/api/chat`, { method: 'POST', body: '{}' })
			expect(await early.text()).not.toBe('second')
			expect(peer.replies).toEqual(queued)
			const tags = await fetch(`${peer.url}/api/tags`, { method: 'POST', body: '{}' })
			expect(await tags.text()).toBe('first')
			expect(peer.replies).toEqual([queued[1]])
			const chat = await fetch(`${peer.url}/api/chat`, { method: 'POST', body: '{}' })
			expect(await chat.text()).toBe('second')
			expect(peer.replies).toEqual([])
		} finally {
			await peer.close()
		}
	})
	it('totals observed calls by role and reads zero for an unused role', () => {
		const observation: StudyObservation = {
			goal: 'write',
			product: undefined,
			failure: undefined,
			usage: [
				{ role: 'agent', calls: 2, tokens: 5, bytes: 9, duration: 1 },
				{ role: 'tool', calls: 1, tokens: undefined, bytes: 3, duration: 1 },
				{ role: 'agent', calls: 1, tokens: 1, bytes: 1, duration: 1 },
			],
			duration: 3,
			executed: true,
		}
		expect(sumStudyCalls(observation, 'agent')).toBe(3)
		expect(sumStudyCalls(observation, 'tool')).toBe(1)
		expect(sumStudyCalls(observation, 'judge')).toBe(0)
	})
	it('builds a saved write-goal evidence row carrying the supplied value', () => {
		expect(buildStudyEvidenceRow('a')).toEqual({ event: 'saved', goal: 'write', value: 'a' })
		expect(buildStudyEvidenceRow('b')).not.toBe(buildStudyEvidenceRow('b'))
	})
	it('builds sparse evidence with absent positions, not undefined elements, and keeps later indices', () => {
		const { lone, tail, interior } = buildStudySparseEvidence()
		const explicit: readonly unknown[] = [undefined]
		expect(0 in explicit).toBe(true)
		expect([lone.length, tail.length, interior.length]).toEqual([1, 2, 3])
		expect(0 in lone).toBe(false)
		expect([0 in tail, 1 in tail]).toEqual([true, false])
		expect([0 in interior, 1 in interior, 2 in interior]).toEqual([true, false, true])
		expect(tail[0]).toEqual(buildStudyEvidenceRow('a'))
		expect(interior[0]).toEqual(buildStudyEvidenceRow('a'))
		expect(interior[2]).toEqual(buildStudyEvidenceRow('c'))
		expect(buildStudySparseEvidence().lone).not.toBe(lone)
	})
	it('lists the hostile reference values a typed caller cannot supply', () => {
		expect(STUDY_HOSTILE_REFERENCES).toEqual([null, undefined, 'evidence', 1, []])
		expect(Object.isFrozen(STUDY_HOSTILE_REFERENCES)).toBe(true)
	})
})
