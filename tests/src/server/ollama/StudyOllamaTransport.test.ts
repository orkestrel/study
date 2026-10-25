import type { JudgeInterface } from '@orkestrel/agent'
import type { StudyOllamaFetchFunction } from '../../../../src/server/ollama/types.js'
import { STUDY_STOP_SWITCHES } from '../../../setupStudy.js'
import { createForeignBudgetError, createBudgetLookalike } from '../../../setupServer.js'
import { describe, expect, it } from 'vitest'
import { parseJSON, isRecord } from '@orkestrel/contract'
import { createScratch } from '@orkestrel/test/server'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractTiming } from '@orkestrel/ollama'
import {
	captureError,
	createRecorder,
	requireValue,
	waitForAbort,
	waitForCondition,
} from '@orkestrel/test'
import { StudyAgentJudge } from '../../../../src/core/agents/StudyAgentJudge.js'
import { StudyError, isStudyError } from '../../../../src/core/errors.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'
import { StudyOllamaTransport } from '../../../../src/server/ollama/StudyOllamaTransport.js'
import { hashStudyBytes } from '../../../../src/server/helpers.js'
import { StudyExchangeSink } from '../../../../src/server/stores/StudyExchangeSink.js'
import { readStudyExchangeRows } from '../../../../src/server/stores/helpers.js'
import {
	STUDY_AGENT_MESSAGES,
	STUDY_JUDGE_REQUEST,
	STUDY_OLLAMA_OPTIONS,
	STUDY_OLLAMA_PARTIAL_ROW,
	STUDY_OLLAMA_CAPTURE_LENGTHS,
	STUDY_OLLAMA_RECORDING_FAILURES,
	STUDY_OLLAMA_ADMISSION_CASES,
	STUDY_OLLAMA_FORBIDDEN_STEPS,
	STUDY_OLLAMA_METADATA_FAILURES,
	STUDY_OLLAMA_POSTFLIGHT_FAILURES,
	STUDY_OLLAMA_BYTE_FAILURES,
	STUDY_OLLAMA_METADATA_REQUESTS,
	STUDY_OLLAMA_CHARGED_FAILURES,
	STUDY_OPEN_ADMISSION_CASES,
	STUDY_OPEN_OVERLAPS,
	buildOllamaRow,
	buildOllamaStream,
	createOllamaJudgeFixture,
	requireStudyRecord,
	readOllamaDefault,
} from '../../../setupStudy.js'
import {
	STUDY_OLLAMA_CHAT_BODY,
	STUDY_OLLAMA_ABANDONMENT_CASES,
	STUDY_OLLAMA_SIDECAR_CASES,
	STUDY_OLLAMA_ROW_FAULTS,
	STUDY_OLLAMA_STREAM_FAILURES,
	STUDY_OLLAMA_STATUS_FAILURES,
	buildOllamaStrictRoles,
	buildOllamaTransportOptions,
	createOllamaContext,
	createOllamaTransportFixture,
	createOllamaTransportProvider,
	buildOllamaStep,
	buildOllamaDeclaration,
	createOllamaRecordingFixture,
	createOpenOllamaRecordingFixture,
	OllamaExchangeRecorder,
	buildOllamaRoleBodies,
} from '../../../setupServer.js'

const encoder = new TextEncoder()

describe('StudyOllamaTransport', () => {
	describe.each(STUDY_OLLAMA_ABANDONMENT_CASES)('native abandonment recording=$recording', ({ recording }) => {
		it('retains one terminal when a native stream is abandoned', async () => {
			const scratch = createScratch()
			const path = join(scratch.path, 'exchanges.jsonl')
			const failures: unknown[] = []
			try {
				const { procedure: _procedure, ...declaration } = buildOllamaDeclaration()
				const sink = recording
					? new StudyExchangeSink({ file: await open(path, 'wx'), record: declaration.record })
					: undefined
				try {
					if (sink !== undefined) {
						expect(declaration).not.toHaveProperty('procedure')
						await sink.append(declaration)
						expect(sink.declaration).toMatchObject({ phase: 'declaration' })
						expect(sink.declaration).not.toHaveProperty('procedure')
						console.info('Native abandonment declaration', { recording, path })
					}
					const fixture = await createOllamaTransportFixture(
						[{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }],
						sink === undefined ? {} : { exchanges: sink },
					)
					try {
						await fixture.transport.verify()
						const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
						const stream = provider.stream(STUDY_AGENT_MESSAGES, new AbortController().signal)
						const delta = await stream.next()
						expect(delta).toEqual({ done: false, value: { channel: 'content', text: 'par' } })
						console.info('Native abandonment delta', { recording, delta })
						await expect(stream.return({ content: '' })).resolves.toEqual({
							done: true,
							value: { content: '' },
						})
						expect(fixture.goal.usage()).toEqual([
							{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
						])
						const failure = captureError(() => fixture.transport.check())
						expect(failure).toMatchObject({
							code: 'FAULT',
							message: 'Ollama response cancelled before its end',
						})
						await expect(
							provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal),
						).rejects.toBe(failure)
						expect(captureError(() => fixture.transport.check())).toBe(failure)
						expect(
							fixture.server.requests.filter((request) => request.path === '/api/chat'),
						).toHaveLength(1)
					} catch (error) {
						failures.push(error)
					} finally {
						try {
							await fixture.transport.close()
						} catch (error) {
							failures.push(error)
						} finally {
							try {
								if (sink !== undefined) await expect(sink.close()).resolves.toBeUndefined()
							} catch (error) {
								failures.push(error)
							} finally {
								try {
									fixture.goal.close()
								} catch (error) {
									failures.push(error)
								} finally {
									try {
										await fixture.server.close()
									} catch (error) {
										failures.push(error)
									}
								}
							}
						}
						try {
							expect(fixture.goal.usage()).toEqual([
								{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
							])
						} catch (error) {
							failures.push(error)
						}
					}
				} catch (error) {
					failures.push(error)
				} finally {
					if (sink !== undefined) {
						try {
							await expect(sink.close()).resolves.toBeUndefined()
						} catch (error) {
							failures.push(error)
						}
						try {
							const rows = readStudyExchangeRows(await readFile(path), false)
							const attempts = rows.filter((row) => row.phase === 'attempt' && row.stage === 'execution')
							const terminals = rows.filter((row) => row.phase === 'failure' && row.stage === 'execution')
							console.info('Native abandonment retained execution', { attempts, terminals })
							expect(attempts).toHaveLength(1)
							expect(terminals).toHaveLength(1)
							const attempt = requireValue(attempts[0])
							const terminal = requireValue(terminals[0])
							if (attempt.phase !== 'attempt' || terminal.phase !== 'failure')
								throw new Error('Missing execution attempt or failure terminal')
							expect(terminal).toMatchObject({
								ordinal: attempt.ordinal,
								goal: attempt.goal,
								role: 'agent',
								path: '/api/chat',
								method: attempt.method,
								reason: 'Ollama response cancelled before its end',
							})
							expect(terminal.step).toBe(attempt.step)
							expect(terminal.response).toMatchObject({
								status: 200,
								body: Buffer.from(STUDY_OLLAMA_PARTIAL_ROW).toString('base64'),
								digest: hashStudyBytes(STUDY_OLLAMA_PARTIAL_ROW),
								size: Buffer.byteLength(STUDY_OLLAMA_PARTIAL_ROW),
							})
							expect(
								rows.some((row) => row.phase === 'response' && row.stage === 'execution'),
							).toBe(false)
							expect(rows.some((row) => row.phase === 'complete')).toBe(false)
							expect(rows.flatMap((row) =>
								row.phase === 'attempt' && row.stage === 'preflight' ? [row.path] : [],
							)).toEqual([
								'/api/version',
								'/api/tags',
								'/api/show',
								'/api/show',
							])
						} catch (error) {
							failures.push(error)
						}
					}
				}
			} catch (error) {
				failures.push(error)
			} finally {
				try {
					scratch.destroy()
					console.info('Native abandonment resources released', { recording, path })
				} catch (error) {
					failures.push(error)
				}
			}
			if (failures.length !== 0)
				throw new AggregateError(failures, 'Native stream abandonment failed', { cause: failures[0] })
		}, 5000)
	})

	describe('open recording admission', () => {
		it('reads the sink declaration once before retaining its independent configuration', async () => {
			const sink = new OllamaExchangeRecorder()
			const reads = createRecorder<[]>()
			const declaration = sink.declaration
			Object.defineProperty(sink, 'declaration', {
				get: () => {
					reads.handler()
					return declaration
				},
			})
			const transport = new StudyOllamaTransport(
				buildOllamaTransportOptions('http://127.0.0.1:1', { exchanges: sink }),
			)
			try {
				expect(reads.calls).toEqual([[]])
			} finally {
				await transport.close()
			}
		})

		it.each(STUDY_OPEN_OVERLAPS)(
			'O2 refuses overlapping %s before any model POST',
			async (overlap) => {
				const fixture = await createOpenOllamaRecordingFixture()
				const entered = createRecorder<[]>()
				const release = new AbortController()
				try {
					await fixture.transport.verify()
					fixture.transport.clear()
					fixture.transport.prepare({
						goal: 'first',
						checkpoint: undefined,
						context: {
							...fixture.goal.context,
							meter: {
								signal: fixture.goal.context.meter.signal,
								get usage() {
									return fixture.goal.context.meter.usage
								},
								admit: async (charge) => {
									entered.handler()
									await waitForAbort(release.signal)
									return fixture.goal.context.meter.admit(charge)
								},
							},
						},
					})
					const first = fixture.transport
						.fetch('agent', `${fixture.server.url}/api/chat`, {
							method: 'POST',
							body: STUDY_OLLAMA_CHAT_BODY,
						})
						.then(
							() => undefined,
							(error: unknown) => error,
						)
					await waitForCondition('open admission entered', () => entered.count === 1)
					await expect(
						overlap === 'request'
							? fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
									method: 'POST',
									body: STUDY_OLLAMA_CHAT_BODY,
								})
							: fixture.transport.verify(),
					).rejects.toMatchObject({ code: 'FAULT' })
					release.abort()
					expect(await first).toMatchObject({ code: 'FAULT' })
					expect(fixture.server.requests.some((row) => row.path === '/api/chat')).toBe(false)
					expect(
						fixture.rows.some((row) => row.phase === 'attempt' && row.stage === 'execution'),
					).toBe(false)
				} finally {
					release.abort()
					await fixture.close()
				}
			},
		)

		it.each(STUDY_OLLAMA_METADATA_FAILURES)(
			'O2 refuses $name under open metadata bounds with no model POST',
			async ({ reply, metadata }) => {
				const fixture = await createOpenOllamaRecordingFixture(
					[reply],
					metadata === undefined ? {} : { metadata },
				)
				try {
					await expect(fixture.transport.verify()).rejects.toBeDefined()
					expect(captureError(() => fixture.transport.check())).toBeDefined()
					expect(fixture.goal.usage()).toEqual([])
					expect(
						fixture.server.requests.some(
							(row) => row.path === '/api/chat' || row.path === '/api/generate',
						),
					).toBe(false)
					expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(false)
				} finally {
					await fixture.close()
				}
			},
		)

		it('O2 reserves open attempt and failure bytes before append or model POST', async () => {
			const scratch = createScratch()
			const path = join(scratch.path, 'exchanges.jsonl')
			const record = { bytes: 8192, calls: 8, duration: 15000 }
			const sink = new StudyExchangeSink({ file: await open(path, 'wx'), record })
			const { procedure: _procedure, ...declaration } = buildOllamaDeclaration()
			try {
				await sink.append({ ...declaration, record })
				const fixture = await createOpenOllamaRecordingFixture([], { exchanges: sink })
				try {
					await fixture.transport.verify()
					const before = await readFile(path)
					await expect(
						fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
							method: 'POST',
							body: `${STUDY_OLLAMA_CHAT_BODY.slice(0, -1)},"prompt":"${'x'.repeat(12000)}"}`,
						}),
					).rejects.toMatchObject({ code: 'CAPACITY' })
					expect(await readFile(path)).toEqual(before)
					expect(fixture.server.requests.some((row) => row.path === '/api/chat')).toBe(false)
					expect(fixture.goal.usage()).toEqual([
						expect.objectContaining({ calls: 1, tokens: undefined }),
					])
					expect(readStudyExchangeRows(before, false).some((row) => row.phase === 'complete')).toBe(
						false,
					)
				} finally {
					await fixture.close()
				}
			} finally {
				await sink.close().catch(() => undefined)
				scratch.destroy()
			}
		})

		it.each(STUDY_OPEN_ADMISSION_CASES)(
			'O2 refuses %s with no model POST for the refused request',
			async (scenario) => {
				const strict = scenario === 'truncate' || scenario === 'shift'
				const fixture = await createOpenOllamaRecordingFixture(
					[],
					strict ? { roles: buildOllamaStrictRoles() } : {},
					{
						goals:
							scenario === 'preflight-goal'
								? ['earlier', 'first']
								: scenario === 'backward-goal' || scenario === 'postflight-goal'
									? ['first', 'second']
									: ['first'],
					},
				)
				try {
					if (scenario !== 'before-preflight' && scenario !== 'preflight-goal')
						await fixture.transport.verify()
					if (scenario === 'after-postflight') await fixture.transport.verify()
					if (scenario === 'outside-goal' || scenario === 'backward-goal') {
						fixture.transport.clear()
						fixture.transport.prepare({
							goal: scenario === 'outside-goal' ? 'absent' : 'second',
							context: fixture.goal.context,
							checkpoint: undefined,
						})
					}
					if (scenario === 'backward-goal') {
						await (
							await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
								method: 'POST',
								body: STUDY_OLLAMA_CHAT_BODY,
							})
						).text()
						fixture.transport.clear()
						fixture.transport.prepare({
							goal: 'first',
							context: fixture.goal.context,
							checkpoint: undefined,
						})
					}
					const baseline = fixture.server.requests.filter(
						(row) => row.path === '/api/chat' || row.path === '/api/generate',
					).length
					const attempts = fixture.rows.filter((row) => row.phase === 'attempt').length
					const judge = scenario === 'raw' || scenario === 'logprobs'
					const original = requireStudyRecord(
						parseJSON(
							judge
								? requireValue(buildOllamaRoleBodies().find(([role]) => role === 'judge'))[1]
								: STUDY_OLLAMA_CHAT_BODY,
						),
					)
					const body = JSON.stringify({
						...original,
						...(strict
							? {
									truncate: scenario === 'truncate',
									shift: scenario === 'shift',
								}
							: {}),
						...(scenario === 'model' ? { model: 'other' } : {}),
						...(scenario === 'options' ? { options: { ...STUDY_OLLAMA_OPTIONS, seed: 1 } } : {}),
						...(scenario === 'stream' ? { stream: false } : {}),
						...(scenario === 'think' ? { think: true } : {}),
						...(scenario === 'raw' ? { raw: false } : {}),
						...(scenario === 'logprobs' ? { logprobs: false } : {}),
					})
					const role =
						scenario === 'role'
							? 'tool'
							: scenario === 'metadata-pass'
								? 'metadata'
								: judge
									? 'judge'
									: 'agent'
					const path =
						scenario === 'path' || judge
							? '/api/generate'
							: scenario === 'metadata-pass'
								? '/api/tags'
								: '/api/chat'
					const url = `${scenario === 'origin' ? 'http://127.0.0.1:1' : fixture.server.url}${path}${scenario === 'query' ? '?extra=1' : ''}`
					const error = await (
						scenario === 'postflight-goal' || scenario === 'preflight-goal'
							? fixture.transport.verify()
							: fixture.transport.fetch(
									role,
									url,
									scenario === 'metadata-pass'
										? { method: 'GET' }
										: { method: scenario === 'method' ? 'GET' : 'POST', body },
								)
					).then(
						() => undefined,
						(failure: unknown) => failure,
					)
					expect(error).toBeDefined()
					expect(captureError(() => fixture.transport.check())).toBe(error)
					expect(
						fixture.server.requests.filter(
							(row) => row.path === '/api/chat' || row.path === '/api/generate',
						),
					).toHaveLength(baseline)
					expect(fixture.rows.filter((row) => row.phase === 'attempt')).toHaveLength(attempts)
					expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(
						scenario === 'after-postflight',
					)
				} finally {
					await fixture.close()
				}
			},
		)

		it('O2 refuses exhausted model time before another append or model POST after settlement stalls', async () => {
			const fixture = await createOpenOllamaRecordingFixture(
				[],
				{},
				{ record: { bytes: 32768, calls: 8, duration: 20 } },
			)
			try {
				fixture.transport.clear()
				fixture.transport.prepare({
					goal: 'first',
					checkpoint: undefined,
					context: {
						...fixture.goal.context,
						evidence: {
							append: async (row) => {
								if (row.event === 'wire' && isRecord(row.value) && row.value.role === 'agent')
									Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40)
								await fixture.goal.context.evidence.append(row)
							},
						},
					},
				})
				await fixture.transport.verify()
				await (
					await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					})
				).text()
				const before = fixture.rows.length
				await expect(
					fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					}),
				).rejects.toMatchObject({
					code: 'DEADLINE',
					failure: { stop: { layer: 'scope', id: 'Recording duration' } },
				})
				expect(fixture.rows).toHaveLength(before)
				expect(fixture.server.requests.filter((row) => row.path === '/api/chat')).toHaveLength(1)
				expect(fixture.goal.usage()).toHaveLength(1)
				expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(false)
			} finally {
				await fixture.close()
			}
		})

		it('O3 refuses the execution past record.calls before append while retaining prior charges', async () => {
			const fixture = await createOpenOllamaRecordingFixture(
				[],
				{},
				{ record: { bytes: 32768, calls: 1, duration: 15000 } },
			)
			try {
				await fixture.transport.verify()
				await (
					await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					})
				).text()
				const before = fixture.rows.length
				const error = await fixture.transport
					.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					})
					.then(
						() => undefined,
						(failure: unknown) => failure,
					)
				expect(error).toMatchObject({
					code: 'CAPACITY',
					failure: { stop: { layer: 'scope', id: 'Recording calls', max: 1, consumed: 2 } },
				})
				expect(captureError(() => fixture.transport.check())).toBe(error)
				expect(fixture.rows).toHaveLength(before)
				expect(fixture.server.requests.filter((row) => row.path === '/api/chat')).toHaveLength(1)
				expect(fixture.goal.usage()).toEqual([expect.objectContaining({ role: 'agent', calls: 1 })])
				expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(false)
			} finally {
				await fixture.close()
			}
		})

		it('O4 aborts a partial slow reply at record.duration with an attributed failure and retained charges', async () => {
			const fixture = await createOpenOllamaRecordingFixture(
				[{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }],
				{},
				{ record: { bytes: 32768, calls: 8, duration: 80 } },
			)
			try {
				await fixture.transport.verify()
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				const error = await response.text().then(
					() => undefined,
					(failure: unknown) => failure,
				)
				expect(error).toMatchObject({
					code: 'DEADLINE',
					failure: {
						cause: 'deadline',
						stop: { layer: 'scope', id: 'Recording duration', max: 80 },
					},
				})
				expect(captureError(() => fixture.transport.check())).toBe(error)
				expect(fixture.rows.at(-1)).toMatchObject({
					phase: 'failure',
					role: 'agent',
					step: 1,
					reason: 'Recording duration allowance exhausted',
					response: { body: Buffer.from(STUDY_OLLAMA_PARTIAL_ROW).toString('base64') },
				})
				expect(fixture.goal.usage()).toEqual([
					expect.objectContaining({ role: 'agent', calls: 1, tokens: undefined }),
				])
				expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(false)
			} finally {
				await fixture.close()
			}
		})
	})

	describe('bounded exchange recording', () => {
		it.each(STUDY_OLLAMA_SIDECAR_CASES)(
			'retains a terminal for $status replies under a $bytes-byte sidecar',
			async ({ bytes, status }) => {
				const scratch = createScratch()
				const path = join(scratch.path, 'exchanges.jsonl')
				const record = { bytes, calls: 256, duration: 15000 }
				const sink = new StudyExchangeSink({ file: await open(path, 'wx'), record })
				const procedure = [buildOllamaStep()]
				const options = buildOllamaTransportOptions('http://127.0.0.1:1')
				const body = JSON.stringify({ version: 'fixture-version', padding: 'x'.repeat(12000) })
				try {
					await sink.append({
						phase: 'declaration',
						trial: 'r1-first-small',
						version: 'fixture-version',
						models: options.models,
						metadata: options.metadata,
						procedure,
						maintenance: [],
						record,
						goals: ['first'],
						configuration: 'c'.repeat(64),
					})
					const fixture = await createOllamaRecordingFixture(
						procedure,
						[{ path: '/api/version', body, status }],
						{ exchanges: sink },
					)
					try {
						const error = await fixture.transport.verify().then(
							() => undefined,
							(failure: unknown) => failure,
						)
						const retained = await readFile(path)
						const rows = readStudyExchangeRows(retained, false)
						const terminal = rows[2]
						const completed = bytes === 65536 && status === 200
						const failure = terminal?.phase === 'failure' ? terminal : undefined
						const reply = terminal?.phase === 'response' ? terminal : failure?.response
						const retainedReply = expect.objectContaining({
							status,
							size: Buffer.byteLength(body),
							body: Buffer.from(body).toString('base64'),
						})
						const omittedReply = expect.stringContaining(
							'reply was not retained because it exceeded the sidecar allowance',
						)
						expect(isStudyError(error) ? error.code : error).toBe(
							completed ? undefined : status === 200 ? 'CAPACITY' : 'FAULT',
						)
						expect(terminal).toMatchObject({
							phase: completed ? 'response' : 'failure',
							ordinal: 1,
							goal: 'first',
							role: 'metadata',
							path: '/api/version',
						})
						expect(reply).toEqual(bytes === 65536 ? retainedReply : undefined)
						expect(failure?.reason).toEqual(
							bytes === 8192
								? omittedReply
								: completed
									? undefined
									: 'Ollama HTTP response refused: 500',
						)
						expect(captureError(() => fixture.transport.check())).toBe(error)
						expect(fixture.server.requests.map((request) => request.path)).toEqual(
							completed
								? ['/api/version', '/api/tags', '/api/show', '/api/show']
								: ['/api/version'],
						)
						expect(fixture.goal.evidence).toContainEqual(
							expect.objectContaining({
								event: status === 200 ? 'wire' : 'failure',
								value: expect.objectContaining({
									path: '/api/version',
									bytes: Buffer.byteLength(body),
								}),
							}),
						)
						expect(retained.byteLength).toBeLessThanOrEqual(bytes)
						expect(() => readStudyExchangeRows(retained, true)).toThrow(/complet|failed|incomplete/)
					} finally {
						await fixture.close()
					}
				} finally {
					await sink.close().catch(() => undefined)
					scratch.destroy()
				}
			},
		)

		it.each(STUDY_OLLAMA_CAPTURE_LENGTHS)(
			'refuses invalid capture length %s before sending',
			(bytes) => {
				const step = buildOllamaStep()
				Reflect.set(step, 'bytes', bytes)
				expect(
					captureError(
						() =>
							new StudyOllamaTransport(
								buildOllamaTransportOptions('http://127.0.0.1:1', {
									exchanges: new OllamaExchangeRecorder(buildOllamaDeclaration([step])),
								}),
							),
					),
				).toMatchObject({ code: 'CONFIG' })
			},
		)

		it.each(STUDY_OLLAMA_FORBIDDEN_STEPS)(
			'refuses conflicting $admission declaration with undefined $field',
			({ admission, field }) => {
				const step = buildOllamaStep(admission)
				Reflect.set(step, field, undefined)
				expect(
					captureError(
						() =>
							new StudyOllamaTransport(
								buildOllamaTransportOptions('http://127.0.0.1:1', {
									exchanges: new OllamaExchangeRecorder(buildOllamaDeclaration([step])),
								}),
							),
					),
				).toMatchObject({ code: 'CONFIG' })
			},
		)

		it.each(STUDY_OLLAMA_FORBIDDEN_STEPS)(
			'refuses nonenumerable $field on $admission admission',
			({ admission, field }) => {
				const step = buildOllamaStep(admission)
				Object.defineProperty(step, field, { value: undefined, enumerable: false })
				expect(
					captureError(
						() =>
							new StudyOllamaTransport(
								buildOllamaTransportOptions('http://127.0.0.1:1', {
									exchanges: new OllamaExchangeRecorder(buildOllamaDeclaration([step])),
								}),
							),
					),
				).toMatchObject({ code: 'CONFIG' })
			},
		)

		it('refuses a same-length changed exact body before any model send and keeps the refusal latched', async () => {
			const body = `${STUDY_OLLAMA_CHAT_BODY.slice(0, -1)},"prompt":"first"}`
			const fixture = await createOllamaRecordingFixture([buildOllamaStep('exact', body)])
			try {
				await fixture.transport.verify()
				await expect(
					fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body: body.replace('first', 'other'),
					}),
				).rejects.toMatchObject({ code: 'FAULT' })
				expect(captureError(() => fixture.transport.check())).toMatchObject({ code: 'FAULT' })
				expect(fixture.server.requests.some((row) => row.path === '/api/chat')).toBe(false)
				expect(fixture.goal.usage()).toEqual([])
			} finally {
				await fixture.close()
			}
		})

		it.each(STUDY_OLLAMA_ADMISSION_CASES)(
			'refuses capture %s before a model send',
			async (scenario) => {
				const fixture = await createOllamaRecordingFixture([
					buildOllamaStep(
						'capture',
						STUDY_OLLAMA_CHAT_BODY,
						'agent',
						1,
						scenario === 'goal' ? 'second' : 'first',
					),
				])
				try {
					await fixture.transport.verify()
					const body =
						scenario === 'length'
							? `${STUDY_OLLAMA_CHAT_BODY} `
							: scenario === 'options'
								? STUDY_OLLAMA_CHAT_BODY.replace('"seed":0', '"seed":1')
								: STUDY_OLLAMA_CHAT_BODY
					await expect(
						fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
							method: 'POST',
							body,
						}),
					).rejects.toBeDefined()
					expect(fixture.server.requests.some((row) => row.path === '/api/chat')).toBe(false)
				} finally {
					await fixture.close()
				}
			},
		)

		it('records capture bytes matching the peer digest and exact Unicode CRLF reply before completing postflight', async () => {
			const body = `${STUDY_OLLAMA_CHAT_BODY.slice(0, -1)},"prompt":"é café 🦉\r\n"}`
				.replace(/\r/g, '\\r')
				.replace(/\n/g, '\\n')
			const reply = buildOllamaStream(['café 🦉', 'é']).replace(/\n/g, '\r\n')
			const bytes = encoder.encode(reply)
			const fixture = await createOllamaRecordingFixture(
				[buildOllamaStep('capture', body)],
				[
					{
						path: '/api/chat',
						body: reply,
						chunks: [bytes.slice(0, 77), bytes.slice(77, 79), bytes.slice(79)],
					},
				],
			)
			try {
				await fixture.transport.verify()
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body,
				})
				expect(await response.text()).toBe(reply)
				await fixture.transport.verify()
				const attempt = fixture.rows.find((row) => row.phase === 'attempt' && row.role === 'agent')
				const retained = fixture.rows.find(
					(row) => row.phase === 'response' && row.role === 'agent',
				)
				const peer = requireValue(fixture.server.requests.find((row) => row.path === '/api/chat'))
				expect(attempt).toMatchObject({
					phase: 'attempt',
					ordinal: 5,
					step: 1,
					stage: 'execution',
					body: Buffer.from(peer.body).toString('base64'),
					digest: hashStudyBytes(peer.body),
					size: Buffer.byteLength(body),
				})
				expect(retained).toMatchObject({
					phase: 'response',
					body: Buffer.from(reply).toString('base64'),
					digest: hashStudyBytes(reply),
					size: bytes.byteLength,
				})
				if (retained?.phase !== 'response') throw new Error('Missing recorded model response')
				expect(retained.chunks.length).toBeGreaterThan(1)
				expect(retained.chunks.reduce((total, length) => total + length, 0)).toBe(bytes.byteLength)
				expect(fixture.rows.at(-1)).toEqual({ phase: 'complete', count: 9 })
				expect(fixture.goal.usage().map(({ role }) => role)).toEqual(['agent'])
				expect(fixture.server.requests.map(({ path }) => path)).toEqual([
					'/api/version',
					'/api/tags',
					'/api/show',
					'/api/show',
					'/api/chat',
					'/api/version',
					'/api/tags',
					'/api/show',
					'/api/show',
				])
			} finally {
				await fixture.close()
			}
		})

		it.each(STUDY_OLLAMA_RECORDING_FAILURES)(
			'records a failure without a response or completion for $name',
			async ({ body }) => {
				const fixture = await createOllamaRecordingFixture(undefined, [{ path: '/api/chat', body }])
				try {
					await fixture.transport.verify()
					const response = await fixture.transport.fetch(
						'agent',
						`${fixture.server.url}/api/chat`,
						{ method: 'POST', body: STUDY_OLLAMA_CHAT_BODY },
					)
					await expect(response.text()).rejects.toBeDefined()
					expect(fixture.rows.some((row) => row.phase === 'failure' && row.role === 'agent')).toBe(
						true,
					)
					expect(fixture.rows.some((row) => row.phase === 'response' && row.role === 'agent')).toBe(
						false,
					)
					expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(false)
					expect(fixture.goal.usage()).toHaveLength(1)
				} finally {
					await fixture.close()
				}
			},
		)

		it('refuses a second request and verification while capture admission is awaiting its meter', async () => {
			const entered = createRecorder<[]>()
			const release = new AbortController()
			const fixture = await createOllamaRecordingFixture()
			try {
				await fixture.transport.verify()
				fixture.transport.clear()
				fixture.transport.prepare({
					goal: 'first',
					checkpoint: undefined,
					context: {
						...fixture.goal.context,
						meter: {
							signal: fixture.goal.context.meter.signal,
							get usage() {
								return fixture.goal.context.meter.usage
							},
							admit: async (charge) => {
								entered.handler()
								await waitForAbort(release.signal)
								return fixture.goal.context.meter.admit(charge)
							},
						},
					},
				})
				const first = fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				const outcome = first.catch((error: unknown) => error)
				await waitForCondition('capture admission entered', () => entered.count === 1)
				expect(entered.calls).toEqual([[]])
				await expect(fixture.transport.verify()).rejects.toMatchObject({ code: 'FAULT' })
				release.abort()
				expect(await outcome).toMatchObject({ code: 'FAULT' })
				expect(fixture.server.requests.some((row) => row.path === '/api/chat')).toBe(false)
			} finally {
				release.abort()
				await fixture.close()
			}
		})

		it('refuses postflight before all declared model steps finish', async () => {
			const fixture = await createOllamaRecordingFixture()
			try {
				await fixture.transport.verify()
				await expect(fixture.transport.verify()).rejects.toMatchObject({ code: 'FAULT' })
				expect(fixture.server.requests.filter((row) => row.path === '/api/version')).toHaveLength(1)
			} finally {
				await fixture.close()
			}
		})

		it.each(STUDY_OLLAMA_METADATA_FAILURES)(
			'refuses $name metadata before any model send',
			async ({ reply, metadata }) => {
				const fixture = await createOllamaRecordingFixture(
					undefined,
					[reply],
					metadata === undefined ? {} : { metadata },
				)
				try {
					await expect(fixture.transport.verify()).rejects.toBeDefined()
					expect(captureError(() => fixture.transport.check())).toBeDefined()
					expect(fixture.goal.usage()).toEqual([])
					expect(fixture.server.requests.some((row) => row.path === '/api/chat')).toBe(false)
					expect(fixture.rows.some((row) => row.phase === 'failure')).toBe(true)
					expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(false)
				} finally {
					await fixture.close()
				}
			},
		)

		it.each(STUDY_OLLAMA_POSTFLIGHT_FAILURES)(
			'refuses $name in postflight and preserves completed model charges',
			async ({ reply }) => {
				const fixture = await createOllamaRecordingFixture(undefined, [
					{ path: reply.path, body: readOllamaDefault(reply.path) },
					reply,
				])
				try {
					await fixture.transport.verify()
					const response = await fixture.transport.fetch(
						'agent',
						`${fixture.server.url}/api/chat`,
						{ method: 'POST', body: STUDY_OLLAMA_CHAT_BODY },
					)
					await response.text()
					await expect(fixture.transport.verify()).rejects.toMatchObject({ code: 'FAULT' })
					expect(fixture.goal.usage()).toHaveLength(1)
					expect(fixture.rows.at(-1)).toMatchObject({
						phase: 'failure',
						role: 'metadata',
						stage: 'postflight',
					})
					expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(false)
				} finally {
					await fixture.close()
				}
			},
		)

		it.each(STUDY_OLLAMA_BYTE_FAILURES)(
			'retains failed raw bytes without a manufactured response for %j',
			async (reply) => {
				const fixture = await createOllamaRecordingFixture(undefined, [reply])
				try {
					await fixture.transport.verify()
					const response = await fixture.transport.fetch(
						'agent',
						`${fixture.server.url}/api/chat`,
						{ method: 'POST', body: STUDY_OLLAMA_CHAT_BODY },
					)
					await expect(response.text()).rejects.toBeDefined()
					const failure = fixture.rows.find(
						(row) => row.phase === 'failure' && row.role === 'agent',
					)
					expect(failure).toMatchObject({
						phase: 'failure',
						ordinal: 5,
						response: { body: Buffer.concat(reply.chunks ?? []).toString('base64') },
					})
					expect(fixture.rows.some((row) => row.phase === 'response' && row.role === 'agent')).toBe(
						false,
					)
					expect(fixture.goal.usage()).toHaveLength(1)
				} finally {
					await fixture.close()
				}
			},
		)

		it('records every model role body and ordered metadata without spending model quota on metadata', async () => {
			const bodies = buildOllamaRoleBodies()
			const fixture = await createOllamaRecordingFixture(
				bodies.map(([role, body], index) =>
					buildOllamaStep(role === 'summary' ? 'capture' : 'exact', body, role, index + 1),
				),
			)
			try {
				await fixture.transport.verify()
				for (const [role, body] of bodies) {
					const response = await fixture.transport.fetch(
						role,
						`${fixture.server.url}${role === 'judge' ? '/api/generate' : '/api/chat'}`,
						{ method: 'POST', body },
					)
					await response.text()
				}
				await fixture.transport.verify()
				const attempts = fixture.rows.filter((row) => row.phase === 'attempt')
				expect(attempts.map((row) => Buffer.from(row.body, 'base64').toString('utf8'))).toEqual(
					fixture.server.requests.map((row) => row.body),
				)
				expect(attempts.map((row) => row.role)).toEqual([
					'metadata',
					'metadata',
					'metadata',
					'metadata',
					'agent',
					'summary',
					'judge',
					'metadata',
					'metadata',
					'metadata',
					'metadata',
				])
				expect(fixture.goal.usage().map((row) => row.role)).toEqual(['agent', 'summary', 'judge'])
				const dispatches = fixture.goal.evidence
					.filter((row) => row.event === 'dispatch')
					.map((row) => requireStudyRecord(row.value).ordinal)
				const wires = fixture.goal.evidence
					.filter((row) => row.event === 'wire')
					.map((row) => requireStudyRecord(row.value).ordinal)
				expect(dispatches).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
				expect(wires).toEqual(dispatches)
			} finally {
				await fixture.close()
			}
		})

		it('keeps the admitted capture charge and failure row when a collaborator send aborts and arrives late', async () => {
			const entered = createRecorder<[]>()
			const cancelled = createRecorder<readonly [unknown]>()
			const caller = new AbortController()
			const release = new AbortController()
			const reason = new Error('Capture collaborator aborted')
			const fixture = await createOllamaRecordingFixture(undefined, [], {
				fetch: async (role, input, init) => {
					if (role === 'metadata') return globalThis.fetch(input, init)
					entered.handler()
					await waitForAbort(release.signal)
					return new Response(
						new ReadableStream<Uint8Array>({
							cancel: (error: unknown) => cancelled.handler(error),
						}),
					)
				},
			})
			try {
				await fixture.transport.verify()
				const sending = fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
					signal: caller.signal,
				})
				const outcome = sending.catch((error: unknown) => error)
				await waitForCondition('capture collaborator send', () => entered.count === 1)
				expect(entered.calls).toEqual([[]])
				caller.abort(reason)
				expect(await outcome).toBe(reason)
				expect(fixture.goal.usage()).toEqual([
					{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
				])
				expect(fixture.rows.at(-1)).toMatchObject({ phase: 'failure', role: 'agent', ordinal: 5 })
				expect(fixture.rows.some((row) => row.phase === 'response' && row.role === 'agent')).toBe(
					false,
				)
				release.abort()
				await waitForCondition('late capture response cancellation', () => cancelled.count === 1)
				expect(cancelled.calls).toEqual([[reason]])
				expect(captureError(() => fixture.transport.check())).toBe(reason)
			} finally {
				release.abort()
				await fixture.close()
			}
		})

		it('refuses a second in-flight request while retaining the first attempted exchange', async () => {
			const fixture = await createOllamaRecordingFixture(undefined, [
				{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
			])
			try {
				await fixture.transport.verify()
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				await expect(
					fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					}),
				).rejects.toMatchObject({ code: 'FAULT' })
				await response.body?.cancel(new Error('End held response'))
				expect(fixture.server.requests.filter((row) => row.path === '/api/chat')).toHaveLength(1)
				expect(fixture.rows.at(-1)).toMatchObject({ phase: 'failure', role: 'agent' })
			} finally {
				await fixture.close()
			}
		})

		it.each(STUDY_OLLAMA_METADATA_REQUESTS)(
			'refuses a metadata route or body before any peer send: %j',
			async ({ path, init }) => {
				const fixture = await createOllamaRecordingFixture()
				try {
					await expect(
						fixture.transport.fetch('metadata', `${fixture.server.url}${path}`, init),
					).rejects.toMatchObject({ code: 'CONFIG' })
					expect(fixture.server.requests).toEqual([])
					expect(fixture.goal.usage()).toEqual([])
				} finally {
					await fixture.close()
				}
			},
		)

		it.each(STUDY_OLLAMA_CHARGED_FAILURES)(
			'retains charged failure without a response or completion for $name',
			async ({ status, body }) => {
				const fixture = await createOllamaRecordingFixture(
					undefined,
					[{ path: '/api/chat', body, status }],
					{ limit: { duration: 2000, bytes: 1024 } },
				)
				try {
					await fixture.transport.verify()
					await expect(
						fixture.transport
							.fetch('agent', `${fixture.server.url}/api/chat`, {
								method: 'POST',
								body: STUDY_OLLAMA_CHAT_BODY,
							})
							.then((response) => response.text()),
					).rejects.toBeDefined()
					expect(fixture.goal.usage()).toHaveLength(1)
					expect(fixture.goal.usage()[0]).toMatchObject({ role: 'agent', calls: 1 })
					expect(fixture.rows.at(-1)).toMatchObject({ phase: 'failure', role: 'agent', ordinal: 5 })
					expect(fixture.rows.some((row) => row.phase === 'response' && row.role === 'agent')).toBe(
						false,
					)
					expect(fixture.rows.some((row) => row.phase === 'complete')).toBe(false)
					expect(captureError(() => fixture.transport.check())).toBeDefined()
				} finally {
					await fixture.close()
				}
			},
		)

		it('attributes the captured body cap before admission', async () => {
			const body = `${STUDY_OLLAMA_CHAT_BODY.slice(0, -1)},"prompt":"${'x'.repeat(2048)}"}`
			const fixture = await createOllamaRecordingFixture([buildOllamaStep('capture', body)], [], {
				limit: { duration: 2000, bytes: 1024 },
			})
			try {
				await fixture.transport.verify()
				await expect(
					fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body,
					}),
				).rejects.toMatchObject({
					code: 'CAPACITY',
					failure: { role: 'agent', stop: { id: 'Wire bytes' } },
				})
				expect(fixture.goal.usage()).toEqual([])
				expect(fixture.server.requests.some((row) => row.path === '/api/chat')).toBe(false)
			} finally {
				await fixture.close()
			}
		})

		it('keeps metadata call exhaustion separate from model quotas', async () => {
			const limited = await createOllamaRecordingFixture(undefined, [], {
				metadata: { calls: 3, bytes: 1048576, duration: 2000 },
			})
			try {
				await expect(limited.transport.verify()).rejects.toMatchObject({
					code: 'CAPACITY',
					failure: { role: 'metadata' },
				})
				expect(limited.server.requests).toHaveLength(3)
				expect(limited.goal.usage()).toEqual([])
			} finally {
				await limited.close()
			}
		})

		it('excludes model execution time from the independent metadata duration', async () => {
			const fixture = await createOllamaRecordingFixture(
				undefined,
				[{ path: '/api/chat', body: buildOllamaRow(), pause: 500 }],
				{ metadata: { calls: 32, bytes: 1048576, duration: 400 } },
			)
			try {
				await fixture.transport.verify()
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				await response.text()
				await fixture.transport.verify()
				expect(fixture.rows.at(-1)).toEqual({ phase: 'complete', count: 9 })
				expect(fixture.goal.usage().map((row) => row.role)).toEqual(['agent'])
			} finally {
				await fixture.close()
			}
		})
	})

	it('forwards exact validated agent and summary requests to the collaborator with one shared model', async () => {
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const fixture = await createOllamaTransportFixture([], {
			roles: {
				agent: requireValue(buildOllamaTransportOptions('http://127.0.0.1:1').roles.agent),
				summary: requireValue(buildOllamaTransportOptions('http://127.0.0.1:1').roles.agent),
			},
			fetch: (role, input, init) => {
				calls.handler(role, input, init)
				expect(fixture.goal.evidence.at(-1)?.event).toBe('dispatch')
				expect(fixture.goal.usage()).toHaveLength(calls.count - 1)
				return globalThis.fetch(input, init)
			},
		})
		try {
			const body = `{ "model": "model", "stream": true, "think": false, "messages": [{"role":"user","content":"e\u0301"}], "options": ${JSON.stringify(STUDY_OLLAMA_OPTIONS)} }`
			const caller = new AbortController()
			const headers = new Headers({ 'content-type': 'application/json', 'x-study-owned': 'exact' })
			for (const role of ['agent', 'summary'] as const) {
				const url = new URL('/api/chat', fixture.server.url)
				const response = await fixture.transport.fetch(role, url, {
					method: 'POST',
					body,
					headers,
					signal: caller.signal,
					redirect: 'follow',
				})
				const [attributed, input, init] = requireValue(calls.calls.at(-1))
				expect(attributed).toBe(role)
				expect(input).toBe(url.href)
				expect(init).toEqual({
					method: 'POST',
					body,
					headers,
					signal: expect.any(AbortSignal),
					redirect: 'error',
				})
				expect(init.signal).not.toBe(caller.signal)
				expect(init.signal?.aborted).toBe(false)
				expect(fixture.goal.usage()).toHaveLength(calls.count - 1)
				await response.text()
			}
			expect(calls.calls.map(([role]) => role)).toEqual(['agent', 'summary'])
			expect(fixture.server.requests).toEqual([
				{ path: '/api/chat', body },
				{ path: '/api/chat', body },
			])
			expect(fixture.server.owned).toEqual(['exact', 'exact'])
			expect(
				fixture.goal
					.usage()
					.map((usage) => ({ role: usage.role, calls: usage.calls, tokens: usage.tokens })),
			).toEqual([
				{ role: 'agent', calls: 1, tokens: 12 },
				{ role: 'summary', calls: 1, tokens: 12 },
			])
			expect(fixture.goal.evidence.map(({ event }) => event)).toEqual([
				'dispatch',
				'wire',
				'dispatch',
				'wire',
			])
			caller.abort(new Error('Caller finished'))
			expect(calls.calls.every(([, , init]) => init.signal?.aborted === true)).toBe(true)
		} finally {
			await fixture.close()
		}
	})

	it('refuses a present non-callable fetch collaborator at construction', () => {
		const options = buildOllamaTransportOptions('http://127.0.0.1:1')
		Reflect.set(options, 'fetch', {})
		expect(captureError(() => new StudyOllamaTransport(options))).toMatchObject({
			code: 'CONFIG',
			message: 'Ollama fetch collaborator must be callable',
		})
		Reflect.set(options, 'fetch', null)
		expect(captureError(() => new StudyOllamaTransport(options))).toMatchObject({ code: 'CONFIG' })
	})

	it('validates the request before invoking the collaborator or admitting a ticket', async () => {
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const fixture = await createOllamaTransportFixture([], {
			fetch: (role, input, init) => {
				calls.handler(role, input, init)
				return globalThis.fetch(input, init)
			},
		})
		try {
			await expect(
				fixture.transport.fetch('summary', `${fixture.server.url}/outside`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				}),
			).rejects.toMatchObject({ code: 'CONFIG' })
			expect(calls.calls).toEqual([])
			expect(fixture.goal.usage()).toEqual([])
			expect(fixture.goal.evidence).toEqual([])
			expect(fixture.server.requests).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	it('attributes collaborator metadata and judge calls and retains terminal timing', async () => {
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const fixture = await createOllamaTransportFixture([], {
			observe: true,
			fetch: (role, input, init) => {
				calls.handler(role, input, init)
				return globalThis.fetch(input, init)
			},
		})
		try {
			await fixture.transport.verify()
			const judge = createOllamaJudgeFixture(fixture.server.url, (input, init) =>
				fixture.transport.fetch('judge', input, init),
			)
			await judge.ask(STUDY_JUDGE_REQUEST, new AbortController().signal)
			expect(calls.calls.map(([role]) => role)).toEqual([
				'metadata',
				'metadata',
				'metadata',
				'judge',
			])
			expect(
				calls.calls.every(
					([, , init]) => init.redirect === 'error' && init.signal instanceof AbortSignal,
				),
			).toBe(true)
			expect(fixture.goal.usage().map(({ role }) => role)).toEqual(['judge'])
			const wire = requireValue(fixture.goal.evidence.findLast((row) => row.event === 'wire'))
			expect(requireStudyRecord(wire.value)).toMatchObject({
				role: 'judge',
				timing: expect.any(Object),
			})
		} finally {
			await fixture.close()
		}
	})

	it('accounts a synchronous collaborator throw once and retains its identity', async () => {
		const reason = new Error('Collaborator refused')
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const fixture = await createOllamaTransportFixture([], {
			fetch: (...args) => {
				calls.handler(...args)
				throw reason
			},
		})
		try {
			await expect(
				fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				}),
			).rejects.toBe(reason)
			expect(calls.calls.map(([role]) => role)).toEqual(['agent'])
			expect(fixture.server.requests).toEqual([])
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			expect(captureError(() => fixture.transport.check())).toBe(reason)
			await fixture.transport.close()
			expect(fixture.goal.usage()).toHaveLength(1)
		} finally {
			await fixture.close()
		}
	})

	it('keeps collaborator HTTP refusal accounting and the failure latch', async () => {
		const fixture = await createOllamaTransportFixture(
			[{ path: '/api/chat', status: 503, body: '{"error":"runner unavailable"}' }],
			{
				fetch: (_role, input, init) => globalThis.fetch(input, init),
			},
		)
		try {
			const failure = await fixture.transport
				.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				.catch((error: unknown) => error)
			expect(failure).toMatchObject({ code: 'FAULT' })
			expect(captureError(() => fixture.transport.check())).toBe(failure)
			expect(fixture.goal.evidence.map(({ event }) => event)).toEqual(['dispatch', 'failure'])
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			await fixture.transport.close()
			expect(fixture.goal.usage()).toHaveLength(1)
		} finally {
			await fixture.close()
		}
	})

	it('keeps collaborator incomplete stream and byte cap failures on existing accounting paths', async () => {
		for (const { body, message } of STUDY_OLLAMA_STREAM_FAILURES.concat(STUDY_OLLAMA_ROW_FAULTS)) {
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body }], {
				limit: { duration: 2000, bytes: 1024 },
				fetch: (_role, input, init) => globalThis.fetch(input, init),
			})
			try {
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				expect(fixture.goal.usage()).toEqual([])
				const failure = await response.text().catch((error: unknown) => error)
				expect(readStudyFailure(failure).message).toContain(message)
				expect(captureError(() => fixture.transport.check())).toBe(failure)
				expect(fixture.goal.evidence.map(({ event }) => event)).toEqual(['dispatch', 'failure'])
				expect(fixture.goal.usage()).toEqual([
					{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
				])
				await fixture.transport.close()
				expect(fixture.goal.usage()).toHaveLength(1)
			} finally {
				await fixture.close()
			}
		}
	})

	it('propagates abort through the collaborator bounded signal and accounts the failed stream once', async () => {
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const fixture = await createOllamaTransportFixture(
			[{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }],
			{
				fetch: (role, input, init) => {
					calls.handler(role, input, init)
					return globalThis.fetch(input, init)
				},
			},
		)
		try {
			const caller = new AbortController()
			const reason = new Error('Caller aborted')
			const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
				signal: caller.signal,
			})
			const reader = requireValue(response.body).getReader()
			await reader.read()
			caller.abort(reason)
			await expect(reader.read()).rejects.toBe(reason)
			expect(calls.calls.map(([role]) => role)).toEqual(['agent'])
			expect(requireValue(calls.calls[0])[2].signal?.reason).toBe(reason)
			expect(captureError(() => fixture.transport.check())).toBe(reason)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			await fixture.transport.close()
			expect(fixture.goal.usage()).toHaveLength(1)
		} finally {
			await fixture.close()
		}
	})

	it('settles a cooperative collaborator before headers on caller abort', async () => {
		const entered = Promise.withResolvers<void>()
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const fixture = await createOllamaTransportFixture([], {
			fetch: (role, input, init) => {
				calls.handler(role, input, init)
				entered.resolve()
				return globalThis.fetch(input, init)
			},
		})
		const caller = new AbortController()
		const reason = new Error('Caller aborted before native headers')
		const pending = fixture.transport
			.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
				signal: caller.signal,
			})
			.catch((error: unknown) => error)
		try {
			await entered.promise
			expect(fixture.goal.usage()).toEqual([])
			caller.abort(reason)
			expect(await pending).toBe(reason)
			expect(calls.calls.map(([role]) => role)).toEqual(['agent'])
			expect(requireValue(calls.calls[0])[2].signal?.reason).toBe(reason)
			expect(captureError(() => fixture.transport.check())).toBe(reason)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			await fixture.transport.close()
			expect(fixture.goal.usage()).toHaveLength(1)
		} finally {
			caller.abort(reason)
			await pending
			await fixture.close()
		}
	})

	it('settles a pending collaborator on caller abort and cancels its late response once', async () => {
		const release = Promise.withResolvers<Response>()
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const settled = createRecorder<readonly [string, unknown]>()
		const cancelled = createRecorder<readonly [unknown]>()
		const late = new Response(new ReadableStream<Uint8Array>({ cancel: cancelled.handler }))
		const fixture = await createOllamaTransportFixture([], {
			fetch: (...args) => {
				calls.handler(...args)
				return release.promise
			},
		})
		const caller = new AbortController()
		const reason = new Error('Caller aborted before response')
		const pending = fixture.transport
			.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
				signal: caller.signal,
			})
			.then(
				(response) => settled.handler('fulfilled', response),
				(error: unknown) => settled.handler('rejected', error),
			)
		try {
			await waitForCondition('collaborator entry', () => calls.count === 1)
			expect(settled.calls).toEqual([])
			expect(fixture.goal.usage()).toEqual([])
			caller.abort(reason)
			expect(calls.calls.map(([role]) => role)).toEqual(['agent'])
			expect(requireValue(calls.calls[0])[2].signal?.reason).toBe(reason)
			await waitForCondition(
				'caller abort settles pending collaborator',
				() => settled.count === 1,
				{
					budget: 500,
				},
			)
			expect(settled.calls).toEqual([['rejected', reason]])
			expect(captureError(() => fixture.transport.check())).toBe(reason)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			await fixture.transport.close()
			await fixture.transport.close()
			release.resolve(late)
			await waitForCondition('late response cancellation', () => cancelled.count === 1)
			expect(cancelled.calls).toEqual([[reason]])
			expect(settled.calls).toEqual([['rejected', reason]])
			expect(fixture.goal.usage()).toHaveLength(1)
			expect(captureError(() => fixture.transport.check())).toBe(reason)
			expect(fixture.goal.evidence.map(({ event }) => event)).toEqual(['dispatch'])
			expect(fixture.server.requests).toEqual([])
		} finally {
			release.resolve(late)
			await pending
			await fixture.close()
		}
	})

	it('settles a pending collaborator on deadline and cancels its late response once', async () => {
		const release = Promise.withResolvers<Response>()
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const settled = createRecorder<readonly [string, unknown]>()
		const cancelled = createRecorder<readonly [unknown]>()
		const late = new Response(new ReadableStream<Uint8Array>({ cancel: cancelled.handler }))
		const fixture = await createOllamaTransportFixture([], {
			limit: { duration: 100, bytes: 1048576 },
			fetch: (...args) => {
				calls.handler(...args)
				return release.promise
			},
		})
		const pending = fixture.transport
			.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
			})
			.then(
				(response) => settled.handler('fulfilled', response),
				(error: unknown) => settled.handler('rejected', error),
			)
		try {
			await waitForCondition('collaborator entry', () => calls.count === 1)
			expect(settled.calls).toEqual([])
			expect(fixture.goal.usage()).toEqual([])
			expect(calls.calls.map(([role]) => role)).toEqual(['agent'])
			const signal = requireValue(requireValue(calls.calls[0])[2].signal)
			await waitForAbort(signal)
			const reason: unknown = signal.reason
			expect(reason).toMatchObject({ name: 'TimeoutError' })
			await waitForCondition('deadline settles pending collaborator', () => settled.count === 1, {
				budget: 500,
			})
			expect(settled.calls).toEqual([['rejected', reason]])
			expect(captureError(() => fixture.transport.check())).toBe(reason)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			await fixture.transport.close()
			release.resolve(late)
			await waitForCondition('late response cancellation', () => cancelled.count === 1)
			expect(cancelled.calls).toEqual([[reason]])
			expect(settled.calls).toEqual([['rejected', reason]])
			expect(fixture.goal.usage()).toHaveLength(1)
			expect(captureError(() => fixture.transport.check())).toBe(reason)
		} finally {
			release.resolve(late)
			await pending
			await fixture.close()
		}
	})

	it('settles a pending collaborator on close and cancels its late response once', async () => {
		const release = Promise.withResolvers<Response>()
		const calls = createRecorder<Parameters<StudyOllamaFetchFunction>>()
		const settled = createRecorder<readonly [string, unknown]>()
		const cancelled = createRecorder<readonly [unknown]>()
		const late = new Response(new ReadableStream<Uint8Array>({ cancel: cancelled.handler }))
		const fixture = await createOllamaTransportFixture([], {
			fetch: (...args) => {
				calls.handler(...args)
				return release.promise
			},
		})
		const pending = fixture.transport
			.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
			})
			.then(
				(response) => settled.handler('fulfilled', response),
				(error: unknown) => settled.handler('rejected', error),
			)
		try {
			await waitForCondition('collaborator entry', () => calls.count === 1)
			expect(settled.calls).toEqual([])
			expect(fixture.goal.usage()).toEqual([])
			const closing = fixture.transport.close()
			expect(calls.calls.map(([role]) => role)).toEqual(['agent'])
			const signal = requireValue(requireValue(calls.calls[0])[2].signal)
			const reason: unknown = signal.reason
			expect(reason).toMatchObject({ code: 'FAULT', message: 'Ollama transport closed' })
			await waitForCondition('close settles pending collaborator', () => settled.count === 1, {
				budget: 500,
			})
			await closing
			expect(settled.calls).toEqual([['rejected', reason]])
			expect(captureError(() => fixture.transport.check())).toBe(reason)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			await fixture.transport.close()
			release.resolve(late)
			await waitForCondition('late response cancellation', () => cancelled.count === 1)
			expect(cancelled.calls).toEqual([[reason]])
			expect(settled.calls).toEqual([['rejected', reason]])
			expect(fixture.goal.usage()).toHaveLength(1)
			expect(captureError(() => fixture.transport.check())).toBe(reason)
		} finally {
			release.resolve(late)
			await pending
			await fixture.close()
		}
	})

	it('completes an admitted stream, accounts it once, and retains dispatch and wire evidence', async () => {
		const reply = buildOllamaStream(['Re', 'ceipt'], { prompt: 7, completion: 2 })
		const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }])
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
			expect(result.content).toBe('Receipt')
			const sent = encoder.encode(requireValue(fixture.server.requests[0]).body).byteLength
			const bytes = sent + encoder.encode(reply).byteLength
			expect(fixture.goal.usage()).toEqual([{ role: 'agent', calls: 1, tokens: 9, bytes }])
			const shared = {
				role: 'agent',
				path: '/api/chat',
				model: 'model',
				options: STUDY_OLLAMA_OPTIONS,
			}
			expect(fixture.goal.evidence).toEqual([
				{ event: 'dispatch', goal: 'first', value: { ...shared, bytes: sent } },
				{
					event: 'wire',
					goal: 'first',
					value: { ...shared, finish: 'stop', prompt: 7, completion: 2, bytes },
				},
			])
			expect(() => fixture.transport.check()).not.toThrow()
		} finally {
			await fixture.close()
		}
	})

	it('keeps absent and partial usage unknown while accounting the known bytes', async () => {
		const partial = buildOllamaRow({ unknown: true, fields: { prompt_eval_count: 7 } })
		const fixture = await createOllamaTransportFixture([
			{ path: '/api/chat', body: buildOllamaRow({ unknown: true }) },
			{ path: '/api/chat', body: partial },
		])
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const signal = new AbortController().signal
			await provider.generate(STUDY_AGENT_MESSAGES, signal)
			await provider.generate(STUDY_AGENT_MESSAGES, signal)
			const usage = fixture.goal.usage()
			expect(usage.map(({ tokens }) => tokens)).toEqual([undefined, undefined])
			expect(usage.every(({ bytes }) => typeof bytes === 'number' && bytes > 0)).toBe(true)
			const wires = fixture.goal.evidence.filter((row) => row.event === 'wire')
			expect(wires.map((row) => row.value)).toMatchObject([
				{ prompt: null, completion: null },
				{ prompt: 7, completion: null },
			])
		} finally {
			await fixture.close()
		}
	})

	it('verifies the pinned inventory and support, admitting each metadata read', async () => {
		const fixture = await createOllamaTransportFixture()
		try {
			await fixture.transport.verify()
			const events = fixture.goal.evidence.map((row) => row.event)
			expect(events).toEqual([
				'dispatch',
				'wire',
				'dispatch',
				'wire',
				'support',
				'dispatch',
				'wire',
				'support',
				'inventory',
			])
			const findings = fixture.goal.evidence.filter(
				(row) => row.event === 'support' || row.event === 'inventory',
			)
			expect(findings.map((row) => row.value)).toEqual([
				{ model: 'model', ceiling: 32768, requested: 32768 },
				{ model: 'judge', ceiling: 32768, requested: 32768 },
				{ model: 'a'.repeat(64), judge: 'b'.repeat(64) },
			])
			const usage = fixture.goal.usage().map(({ role, tokens }) => [role, tokens])
			expect(usage).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	it('refuses a changed served digest and retains that failure', async () => {
		const changed = JSON.stringify({
			models: [
				{ name: 'model', digest: 'c'.repeat(64) },
				{ name: 'judge', digest: 'b'.repeat(64) },
			],
		})
		const fixture = await createOllamaTransportFixture([{ path: '/api/tags', body: changed }])
		try {
			const outcome = await fixture.transport.verify().then(
				() => undefined,
				(error: unknown) => error,
			)
			expect(outcome).toBeDefined()
			expect(captureError(() => fixture.transport.check())).toMatchObject({
				code: 'FAULT',
				message: 'Serving inventory does not match the required model digest',
			})
			expect(fixture.goal.evidence.some((row) => row.event === 'inventory')).toBe(false)
			expect(fixture.goal.usage()).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	it.each(STUDY_OLLAMA_STREAM_FAILURES)(
		'fails the ticket, drains the reader, and latches $name',
		async ({ body, message, cause }) => {
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body }], {
				limit: { duration: 2000, bytes: 2048 },
			})
			try {
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const signal = new AbortController().signal
				const outcome = await provider.generate(STUDY_AGENT_MESSAGES, signal).then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(outcome).toBeDefined()
				const retained = captureError(() => fixture.transport.check())
				expect(retained).toBeInstanceOf(StudyError)
				expect(readStudyFailure(retained)).toMatchObject({ cause, role: 'agent' })
				expect(readStudyFailure(retained).message).toContain(message)
				expect(fixture.goal.usage()).toEqual([
					{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
				])
				const failure = fixture.goal.evidence.find((row) => row.event === 'failure')
				expect(failure?.value).toMatchObject({ role: 'agent', path: '/api/chat', status: 200 })
				expect(fixture.goal.evidence.some((row) => row.event === 'wire')).toBe(false)
			} finally {
				await fixture.close()
			}
		},
	)

	it.each(STUDY_OLLAMA_ROW_FAULTS)(
		'latches $name before any later dispatch, failing its ticket without a wire row',
		async ({ body, message, cause }) => {
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body }])
			try {
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const signal = new AbortController().signal
				const outcome = await provider.generate(STUDY_AGENT_MESSAGES, signal).then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(outcome).toBeDefined()
				const retained = readStudyFailure(captureError(() => fixture.transport.check()))
				expect(retained.cause).toBe(cause)
				expect(retained.message).toContain(message)
				expect(fixture.goal.usage()).toEqual([
					{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
				])
				const failure = fixture.goal.evidence.find((row) => row.event === 'failure')
				expect(failure?.value).toMatchObject({ role: 'agent', path: '/api/chat', status: 200 })
				expect(fixture.goal.evidence.some((row) => row.event === 'wire')).toBe(false)
				await provider.generate(STUDY_AGENT_MESSAGES, signal).then(
					() => undefined,
					() => undefined,
				)
				expect(fixture.server.requests).toHaveLength(1)
			} finally {
				await fixture.close()
			}
		},
	)

	it.each(STUDY_OLLAMA_STATUS_FAILURES)(
		'reads $name once under the wire bounds and accounts it before refusal',
		async ({ status, body, code, message }) => {
			const allowance = 2048
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body, status }], {
				limit: { duration: 2000, bytes: allowance },
			})
			try {
				const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY }
				const outcome = await fixture.transport
					.fetch('agent', `${fixture.server.url}/api/chat`, init)
					.then(
						() => undefined,
						(error: unknown) => error,
					)
				expect(outcome).toBeInstanceOf(StudyError)
				expect(outcome).toMatchObject({ code, failure: { role: 'agent' } })
				expect(readStudyFailure(outcome).message).toContain(message)
				expect(captureError(() => fixture.transport.check())).toBe(outcome)
				expect(fixture.goal.usage()).toEqual([
					{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
				])
				const failure = requireStudyRecord(
					fixture.goal.evidence.find((row) => row.event === 'failure')?.value,
				)
				expect(failure).toMatchObject({ role: 'agent', status })
				// Observation is off, so the retained failure holds only its unobserved members.
				expect(Object.keys(failure).sort()).toEqual(['bytes', 'path', 'reason', 'role', 'status'])
				// Every byte read is retained, request included, up to the first chunk past the allowance.
				const read =
					encoder.encode(STUDY_OLLAMA_CHAT_BODY).byteLength + encoder.encode(body).byteLength
				expect(Math.min(Number(failure.bytes), allowance + 1)).toBe(Math.min(read, allowance + 1))
				expect(String(failure.reason)).toContain(message)
				expect(String(failure.reason).length).toBeLessThanOrEqual(256)
			} finally {
				await fixture.close()
			}
		},
	)

	it.each([
		[
			'a completion over its allowance',
			'agent',
			600,
			'Actual generation exceeded the output allowance',
		],
		[
			'a summary completion at its own output cap',
			'summary',
			256,
			'Substantive generation reached its output cap',
		],
	] as const)(
		'accounts the actual tokens and wire row before refusing %s',
		async (_name, role, completion, message) => {
			const fixture = await createOllamaTransportFixture([
				{ path: '/api/chat', body: buildOllamaRow({ prompt: 10, completion }) },
			])
			try {
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url, role)
				await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
					() => undefined,
					() => undefined,
				)
				const usage = fixture.goal.usage().map((row) => [row.role, row.tokens])
				expect(usage).toEqual([[role, 10 + completion]])
				const wire = fixture.goal.evidence.find((row) => row.event === 'wire')
				expect(wire?.value).toMatchObject({ role, prompt: 10, completion, finish: 'stop' })
				expect(fixture.goal.evidence.some((row) => row.event === 'failure')).toBe(false)
				expect(readStudyFailure(captureError(() => fixture.transport.check()))).toEqual({
					cause: 'capacity',
					message,
					role,
					stop: {
						layer: 'model',
						id: 'num_predict',
						max: role === 'summary' ? 256 : 512,
						consumed: completion,
					},
				})
			} finally {
				await fixture.close()
			}
		},
	)

	it('refuses a chat request whose reserved room exceeds the request token allowance before it reaches the server', async () => {
		const fixture = await createOllamaTransportFixture([], {
			room: { context: 65536, safety: 128 },
		})
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
				() => undefined,
				() => undefined,
			)
			expect(captureError(() => fixture.transport.check())).toMatchObject({
				code: 'CAPACITY',
				message: 'Request ceiling exceeds the request allowance',
			})
			expect(fixture.server.requests).toEqual([])
			expect(fixture.goal.usage()).toEqual([])
			expect(fixture.goal.evidence).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	it('aborts a hung response at its request deadline and retains the observed timeline without timing', async () => {
		const fixture = await createOllamaTransportFixture(
			[{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }],
			{ observe: true, limit: { duration: 200, bytes: 1048576 } },
		)
		try {
			const dispatch = { id: 1, revision: 'f'.repeat(64) }
			const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY }
			const outcome = await fixture.transport
				.fetch('agent', `${fixture.server.url}/api/chat`, init, dispatch)
				.then((response) => response.text())
				.then(
					() => undefined,
					(error: unknown) => error,
				)
			expect(outcome).toMatchObject({ name: 'TimeoutError' })
			expect(captureError(() => fixture.transport.check())).toBe(outcome)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			expect(fixture.goal.evidence.map((row) => row.event)).toEqual(['dispatch', 'failure'])
			const [sent, failure] = fixture.goal.evidence.map((row) => requireStudyRecord(row.value))
			expect(Object.keys(failure ?? {}).sort()).toEqual([
				'bytes',
				'canonical',
				'elapsed',
				'id',
				'path',
				'reason',
				'revision',
				'role',
				'sent',
				'started',
				'status',
			])
			expect(failure).toMatchObject({
				role: 'agent',
				path: '/api/chat',
				status: 200,
				id: sent?.id,
				canonical: 1,
				revision: 'f'.repeat(64),
			})
			expect(Number(failure?.elapsed)).toBeGreaterThan(0)
			// The request was admitted before it was sent, so its clock never starts after its send.
			expect(Number(failure?.sent)).toBeGreaterThanOrEqual(Number(failure?.started))
		} finally {
			await fixture.close()
		}
	})

	it('joins observed metadata, agent and judge dispatches to the previous model, reads raw judge units, keeps metadata timing null, and joins a canonical dispatch only to the agent requests the caller measured', async () => {
		const fixture = await createOllamaTransportFixture([], { observe: true })
		try {
			const signal = new AbortController().signal
			const revision = 'f'.repeat(64)
			const provider = createOllamaTransportProvider(
				fixture.transport,
				fixture.server.url,
				'agent',
				{
					id: 1,
					revision,
				},
			)
			const real = createOllamaJudgeFixture(
				fixture.server.url,
				(input: string | URL | Request, init?: RequestInit) =>
					fixture.transport.fetch('judge', input, init),
			)
			const judge = new StudyAgentJudge(real, fixture.transport)
			await provider.generate(STUDY_AGENT_MESSAGES, signal)
			await fixture.transport.verify()
			await judge.ask(STUDY_JUDGE_REQUEST, signal)
			await provider.generate(STUDY_AGENT_MESSAGES, signal)
			const dispatches = fixture.goal.evidence
				.filter((row) => row.event === 'dispatch')
				.map((row) => requireStudyRecord(row.value))
			expect(
				dispatches.map(({ id, role, model, previous, changed }) => [
					id,
					role,
					model,
					previous,
					changed,
				]),
			).toEqual([
				[1, 'agent', 'model', null, false],
				[2, 'metadata', null, 'model', false],
				[3, 'metadata', 'model', 'model', false],
				[4, 'metadata', 'judge', 'model', false],
				[5, 'judge', 'judge', 'model', true],
				[6, 'agent', 'model', 'judge', true],
			])
			const generate = requireValue(
				fixture.server.requests.find((request) => request.path === '/api/generate'),
			)
			const prompt = requireStudyRecord(parseJSON(generate.body)).prompt
			if (typeof prompt !== 'string') throw new Error('Missing raw judge prompt')
			expect(dispatches.map((value) => value.raw)).toEqual([
				undefined,
				undefined,
				undefined,
				undefined,
				{ encoding: 'utf-8', units: prompt.length, bytes: Buffer.byteLength(prompt, 'utf8') },
				undefined,
			])
			const wires = fixture.goal.evidence
				.filter((row) => row.event === 'wire')
				.map((row) => requireStudyRecord(row.value))
			const metadata = wires.filter((value) => value.role === 'metadata')
			expect(metadata.map((value) => value.timing)).toEqual([null, null, null])
			// Only the measured agent requests carry a canonical dispatch; metadata and judge rows join none.
			const joins = [
				['agent', 1, revision],
				['metadata', null, null],
				['metadata', null, null],
				['metadata', null, null],
				['judge', null, null],
				['agent', 1, revision],
			]
			expect(
				dispatches.map(({ role, canonical, revision: joined }) => [role, canonical, joined]),
			).toEqual(joins)
			expect(
				wires.map(({ role, canonical, revision: joined }) => [role, canonical, joined]),
			).toEqual(joins)
		} finally {
			await fixture.close()
		}
	})

	it('admits the one-token judge length finish only when its policy declares it', async () => {
		const options = buildOllamaTransportOptions('http://127.0.0.1:1')
		const judgePolicy = requireValue(options.roles.judge)
		const declared = await createOllamaTransportFixture()
		const undeclared = await createOllamaTransportFixture([], {
			roles: { ...options.roles, judge: { ...judgePolicy, length: false } },
		})
		try {
			const signal = new AbortController().signal
			for (const fixture of [declared, undeclared]) {
				const real = createOllamaJudgeFixture(
					fixture.server.url,
					(input: string | URL | Request, init?: RequestInit) =>
						fixture.transport.fetch('judge', input, init),
				)
				await new StudyAgentJudge(real, fixture.transport).ask(STUDY_JUDGE_REQUEST, signal).then(
					() => undefined,
					() => undefined,
				)
			}
			for (const fixture of [declared, undeclared])
				expect(fixture.goal.usage().map(({ role, tokens }) => [role, tokens])).toEqual([
					['judge', 11],
				])
			expect(() => declared.transport.check()).not.toThrow()
			expect(readStudyFailure(captureError(() => undeclared.transport.check()))).toEqual({
				cause: 'capacity',
				message: 'Substantive generation reached its output cap',
				role: 'judge',
				stop: { layer: 'model', id: 'num_predict', max: 1, consumed: 1 },
			})
		} finally {
			await declared.close()
			await undeclared.close()
		}
	})

	it('refuses a strict chat request the provider sent without native false flags, before admission', async () => {
		const options = buildOllamaTransportOptions('http://127.0.0.1:1')
		const agentPolicy = requireValue(options.roles.agent)
		const fixture = await createOllamaTransportFixture([], {
			roles: { ...options.roles, agent: { ...agentPolicy, strict: true } },
		})
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
				() => undefined,
				() => undefined,
			)
			expect(captureError(() => fixture.transport.check())).toMatchObject({
				code: 'CONFIG',
				message: 'Ollama transport must disable native truncation and shifting',
			})
			expect(fixture.goal.usage()).toEqual([])
			expect(fixture.server.requests).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	describe('configuration ownership', () => {
		const strictLabel = 'Ollama transport must disable native truncation and shifting'

		it.each(['strict flag', 'model', 'nested options', 'role'] as const)(
			'keeps a strict policy refusing an omitted truncate and shift after the caller changes its %s',
			async (axis) => {
				const roles = buildOllamaStrictRoles()
				const fixture = await createOllamaTransportFixture([], { roles })
				try {
					const changes = {
						'strict flag': () => Reflect.set(roles.agent, 'strict', false),
						model: () => Reflect.set(roles.agent, 'model', 'judge'),
						'nested options': () => Reflect.set(roles.agent.options, 'num_predict', 1),
						role: () => Reflect.set(roles, 'agent', undefined),
					}
					changes[axis]()
					const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
					await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
						() => undefined,
						() => undefined,
					)
					expect(captureError(() => fixture.transport.check())).toMatchObject({
						code: 'CONFIG',
						message: strictLabel,
					})
					expect(fixture.goal.usage()).toEqual([])
					expect(fixture.server.requests).toEqual([])
				} finally {
					await fixture.close()
				}
			},
		)

		it('keeps an originally non-strict policy working after the caller makes it strict', async () => {
			const roles = buildOllamaStrictRoles()
			Reflect.set(roles.agent, 'strict', false)
			const fixture = await createOllamaTransportFixture(
				[{ path: '/api/chat', body: buildOllamaStream(['ok'], { prompt: 1, completion: 1 }) }],
				{ roles },
			)
			try {
				Reflect.set(roles.agent, 'strict', true)
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
				expect(result.content).toBe('ok')
				expect(fixture.server.requests).toHaveLength(1)
				expect(() => fixture.transport.check()).not.toThrow()
			} finally {
				await fixture.close()
			}
		})

		it('keeps the declared request bounds after the caller shrinks its limit and room', async () => {
			const limit = { duration: 2000, bytes: 1048576 }
			const room = { context: 32768, safety: 128 }
			const fixture = await createOllamaTransportFixture(
				[{ path: '/api/chat', body: buildOllamaStream(['ok'], { prompt: 1, completion: 1 }) }],
				{ limit, room },
			)
			try {
				Reflect.set(limit, 'bytes', 1)
				Reflect.set(limit, 'duration', 1)
				Reflect.set(room, 'safety', 32768)
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
				expect(result.content).toBe('ok')
				expect(() => fixture.transport.check()).not.toThrow()
			} finally {
				await fixture.close()
			}
		})

		it('verifies the pinned inventory the caller declared after the caller changes its models', async () => {
			const models = {
				model: { name: 'model', digest: 'a'.repeat(64) },
				judge: { name: 'judge', digest: 'b'.repeat(64) },
			}
			const fixture = await createOllamaTransportFixture([], { models })
			try {
				Reflect.set(models.model, 'digest', 'c'.repeat(64))
				Reflect.set(models.judge, 'name', 'other')
				Reflect.set(models, 'extra', { name: 'extra', digest: 'd'.repeat(64) })
				await fixture.transport.verify()
				const inventory = fixture.goal.evidence.find((row) => row.event === 'inventory')
				expect(inventory?.value).toEqual({ model: 'a'.repeat(64), judge: 'b'.repeat(64) })
			} finally {
				await fixture.close()
			}
		})
	})

	describe('dispatch ownership', () => {
		it.each(['path', 'origin', 'body', 'headers', 'dispatch'] as const)(
			'sends and records the admitted request after the caller changes its %s before the meter answers',
			async (axis) => {
				const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
				const fixture = await createOllamaTransportFixture(
					[{ path: '/api/chat', body: reply }],
					{ observe: true },
					{ view: 'selected goal' },
				)
				try {
					const url = new URL(`${fixture.server.url}/api/chat`)
					const headers = new Headers({
						'content-type': 'application/json',
						'x-study-owned': 'original',
					})
					const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY, headers }
					const dispatch = { id: 1, revision: 'f'.repeat(64) }
					const pending = fixture.transport.fetch('agent', url, init, dispatch)
					const changes = {
						path: () => {
							url.pathname = '/outside'
						},
						origin: () => {
							url.port = '1'
						},
						body: () =>
							Reflect.set(
								init,
								'body',
								JSON.stringify({
									model: 'judge',
									stream: true,
									think: false,
									options: STUDY_OLLAMA_OPTIONS,
								}),
							),
						headers: () => headers.set('x-study-owned', 'changed'),
						dispatch: () => {
							Reflect.set(dispatch, 'id', 99)
							Reflect.set(dispatch, 'revision', '0'.repeat(64))
						},
					}
					changes[axis]()
					const response = await pending
					await response.text()
					expect(fixture.server.requests).toEqual([
						{ path: '/api/chat', body: STUDY_OLLAMA_CHAT_BODY },
					])
					expect(fixture.server.owned).toEqual(['original'])
					const [sent, wire] = fixture.goal.evidence.map((row) => requireStudyRecord(row.value))
					expect(sent).toMatchObject({
						role: 'agent',
						path: '/api/chat',
						model: 'model',
						bytes: encoder.encode(STUDY_OLLAMA_CHAT_BODY).byteLength,
						canonical: 1,
						revision: 'f'.repeat(64),
						body: STUDY_OLLAMA_CHAT_BODY,
					})
					expect(wire).toMatchObject({ canonical: 1, revision: 'f'.repeat(64) })
				} finally {
					await fixture.close()
				}
			},
		)

		it('still cancels an admitted request through the caller signal and sends nothing', async () => {
			const fixture = await createOllamaTransportFixture()
			try {
				const controller = new AbortController()
				const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY, signal: controller.signal }
				const pending = fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, init)
				controller.abort(new Error('Caller cancelled'))
				const outcome = await pending.then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(outcome).toBeInstanceOf(Error)
				expect(outcome).toHaveProperty('message', 'Caller cancelled')
				expect(fixture.server.requests).toEqual([])
			} finally {
				await fixture.close()
			}
		})

		it('still refuses a Request input before admission', async () => {
			const fixture = await createOllamaTransportFixture()
			try {
				const input = new Request(`${fixture.server.url}/api/chat`)
				const outcome = await fixture.transport.fetch('agent', input).then(
					() => undefined,
					(error: unknown) => error,
				)
				expect(outcome).toMatchObject({
					code: 'CONFIG',
					message: 'Ollama transport requires explicit URL requests',
				})
				expect(fixture.goal.usage()).toEqual([])
				expect(fixture.server.requests).toEqual([])
			} finally {
				await fixture.close()
			}
		})
	})

	it('cancels an open response on close, fails its ticket, and refuses later work', async () => {
		const fixture = await createOllamaTransportFixture([
			{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
		])
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const stream = provider.stream(STUDY_AGENT_MESSAGES, new AbortController().signal)
			expect(await stream.next()).toEqual({
				done: false,
				value: { channel: 'content', text: 'par' },
			})
			const next = { goal: 'second', context: fixture.goal.context, checkpoint: undefined }
			expect(() => fixture.transport.prepare(next)).toThrow('Previous model response is still open')
			await fixture.transport.close()
			await stream.next().then(
				() => undefined,
				() => undefined,
			)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			const failure = fixture.goal.evidence.find((row) => row.event === 'failure')
			expect(failure?.value).toMatchObject({ role: 'agent', reason: 'Ollama transport closed' })
			const retained = captureError(() => fixture.transport.check())
			expect(readStudyFailure(retained).message).toBe('Ollama transport closed')
		} finally {
			await fixture.close()
		}
	})

	it('retains the first failure with its identity and refuses dispatch after it', async () => {
		const fixture = await createOllamaTransportFixture()
		try {
			const first = new StudyError('FAULT', 'First failure')
			fixture.transport.fail(first)
			fixture.transport.fail(new StudyError('FAULT', 'Second failure'))
			expect(captureError(() => fixture.transport.check())).toBe(first)
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal).then(
				() => undefined,
				() => undefined,
			)
			expect(fixture.server.requests).toEqual([])
			expect(fixture.goal.usage()).toEqual([])
		} finally {
			await fixture.close()
		}
	})

	it.each([
		['undefined', undefined],
		['null', null],
		['an Error', new Error('First thrown value')],
	] as const)(
		'retains a first failure of %s exactly and keeps it against a later failure',
		async (_name, thrown) => {
			const fixture = await createOllamaTransportFixture()
			try {
				fixture.transport.fail(thrown)
				fixture.transport.fail(new StudyError('FAULT', 'Later failure'))
				fixture.transport.fail(undefined)
				const outcomes = [0, 1].map(() => {
					try {
						fixture.transport.check()
						return undefined
					} catch (error) {
						return { error }
					}
				})
				for (const outcome of outcomes) {
					expect(outcome).toBeDefined()
					expect(outcome?.error).toBe(thrown)
				}
			} finally {
				await fixture.close()
			}
		},
	)

	it.each([
		['undefined', undefined],
		['null', null],
		['an Error', new Error('Judge unavailable')],
	] as const)(
		'refuses the next judge ask after a failed ask that threw %s, without calling the judge',
		async (_name, thrown) => {
			const fixture = await createOllamaTransportFixture()
			try {
				const calls = createRecorder<[]>()
				const failing: JudgeInterface = {
					id: 'judge',
					name: 'ollama',
					model: 'judge',
					ask: () => {
						calls.handler()
						return Promise.reject(thrown)
					},
				}
				const judge = new StudyAgentJudge(failing, fixture.transport)
				const signal = new AbortController().signal
				const outcomes: Array<{ readonly error: unknown }> = []
				for (const request of [STUDY_JUDGE_REQUEST, STUDY_JUDGE_REQUEST]) {
					try {
						await judge.ask(request, signal)
					} catch (error) {
						outcomes.push({ error })
					}
				}
				expect(outcomes).toHaveLength(2)
				for (const outcome of outcomes) expect(outcome.error).toBe(thrown)
				expect(calls.calls).toEqual([[]])
			} finally {
				await fixture.close()
			}
		},
	)

	describe('goal binding', () => {
		const unbound = { code: 'FAULT', message: 'Model dispatch outside an active goal' }

		it('refuses dispatch and verification with no bound goal, before admission or any request', async () => {
			const transport = new StudyOllamaTransport(buildOllamaTransportOptions('http://127.0.0.1:1'))
			try {
				await expect(
					transport.fetch('agent', 'http://127.0.0.1:1/api/chat', {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					}),
				).rejects.toMatchObject(unbound)
				expect(() => transport.check()).not.toThrow()
				await expect(transport.verify()).rejects.toMatchObject(unbound)
				expect(captureError(() => transport.check())).toMatchObject(unbound)
			} finally {
				await transport.close()
			}
		})

		it('ends the bound goal on clear, refuses later dispatch, and binds the next prepared goal', async () => {
			const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }])
			try {
				fixture.transport.clear()
				await expect(
					fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
						method: 'POST',
						body: STUDY_OLLAMA_CHAT_BODY,
					}),
				).rejects.toMatchObject(unbound)
				expect(fixture.server.requests).toEqual([])
				expect(fixture.goal.usage()).toEqual([])
				expect(fixture.goal.evidence).toEqual([])
				expect(() => fixture.transport.clear()).not.toThrow()
				fixture.transport.prepare({
					goal: 'again',
					context: fixture.goal.context,
					checkpoint: undefined,
				})
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
				expect(result.content).toBe('ok')
				expect(fixture.goal.evidence.map((row) => [row.event, row.goal])).toEqual([
					['dispatch', 'again'],
					['wire', 'again'],
				])
				await fixture.transport.close()
				expect(() => fixture.transport.clear()).not.toThrow()
			} finally {
				await fixture.close()
			}
		})

		it('refuses a second preparation while a goal is bound and keeps the bound goal', async () => {
			const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
			const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }])
			try {
				const next = { goal: 'second', context: fixture.goal.context, checkpoint: undefined }
				expect(captureError(() => fixture.transport.prepare(next))).toMatchObject({
					code: 'FAULT',
					message: 'Previous goal is still bound',
				})
				expect(() => fixture.transport.check()).not.toThrow()
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
				expect(fixture.goal.evidence.map((row) => [row.event, row.goal])).toEqual([
					['dispatch', 'first'],
					['wire', 'first'],
				])
			} finally {
				await fixture.close()
			}
		})

		it('binds each goal evidence and checkpoint to its own goal and carries the previous model across goals', async () => {
			const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
			const fixture = await createOllamaTransportFixture(
				[
					{ path: '/api/chat', body: reply },
					{ path: '/api/chat', body: reply },
					{ path: '/api/chat', body: reply },
				],
				{ observe: true },
				{ view: 'first' },
			)
			const second = createOllamaContext()
			try {
				const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
				const signal = new AbortController().signal
				await provider.generate(STUDY_AGENT_MESSAGES, signal)
				fixture.transport.clear()
				fixture.transport.prepare({
					goal: 'second',
					context: second.context,
					checkpoint: { view: 'second' },
				})
				await provider.generate(STUDY_AGENT_MESSAGES, signal)
				await provider.generate(STUDY_AGENT_MESSAGES, signal)
				const opened = fixture.goal.evidence
					.filter((row) => row.event === 'dispatch')
					.map((row) => requireStudyRecord(row.value))
				const resumed = second.evidence
					.filter((row) => row.event === 'dispatch')
					.map((row) => requireStudyRecord(row.value))
				expect(opened).toHaveLength(1)
				expect(opened[0]).toMatchObject({ id: 1, previous: null, snapshot: { view: 'first' } })
				const [carried, later] = resumed
				expect(carried).toMatchObject({
					id: 2,
					previous: 'model',
					changed: false,
					snapshot: { view: 'second' },
				})
				expect(later).toMatchObject({ id: 3 })
				expect(later).not.toHaveProperty('snapshot')
				expect(fixture.goal.evidence.every((row) => row.goal === 'first')).toBe(true)
				expect(second.evidence.every((row) => row.goal === 'second')).toBe(true)
				expect(second.evidence.map((row) => row.event)).toEqual([
					'dispatch',
					'wire',
					'dispatch',
					'wire',
				])
			} finally {
				await fixture.close()
				second.close()
			}
		})

		it('attaches each goal checkpoint to that goal own first dispatch when the next goal is prepared during an admission', async () => {
			const reply = buildOllamaStream(['ok'], { prompt: 1, completion: 1 })
			const fixture = await createOllamaTransportFixture(
				[
					{ path: '/api/chat', body: reply },
					{ path: '/api/chat', body: reply },
				],
				{ observe: true },
				{ view: 'first' },
			)
			const second = createOllamaContext()
			try {
				const url = `${fixture.server.url}/api/chat`
				const init = { method: 'POST', body: STUDY_OLLAMA_CHAT_BODY }
				const pending = fixture.transport.fetch('agent', url, init)
				// Both calls pass: no wire exists yet, so the request is suspended in its admission.
				fixture.transport.clear()
				fixture.transport.prepare({
					goal: 'second',
					context: second.context,
					checkpoint: { view: 'second' },
				})
				await (await pending).text()
				await (await fixture.transport.fetch('agent', url, init)).text()
				expect(fixture.goal.evidence.map((row) => [row.event, row.goal])).toEqual([
					['dispatch', 'first'],
					['wire', 'first'],
				])
				expect(requireStudyRecord(fixture.goal.evidence[0]?.value).snapshot).toEqual({
					view: 'first',
				})
				expect(second.evidence.map((row) => [row.event, row.goal])).toEqual([
					['dispatch', 'second'],
					['wire', 'second'],
				])
				expect(requireStudyRecord(second.evidence[0]?.value).snapshot).toEqual({ view: 'second' })
			} finally {
				await fixture.close()
				second.close()
			}
		})
	})

	it('refuses a role policy whose model the inventory does not pin at construction', () => {
		const options = buildOllamaTransportOptions('http://127.0.0.1:1')
		const agent = { ...requireValue(options.roles.agent), model: 'unpinned' }
		expect(() => new StudyOllamaTransport({ ...options, roles: { agent } })).toThrow('does not pin')
	})

	it('sends the same bytes and accounts the same usage with observation on and off', async () => {
		const reply = buildOllamaRow({ prompt: 7, completion: 2, fields: { total_duration: 1234 } })
		const off = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }])
		const on = await createOllamaTransportFixture(
			[{ path: '/api/chat', body: reply }],
			{ observe: true },
			{ view: 'selected goal' },
		)
		try {
			const dispatch = { id: 1, revision: 'f'.repeat(64) }
			const signal = new AbortController().signal
			for (const fixture of [off, on]) {
				const url = fixture.server.url
				const provider = createOllamaTransportProvider(fixture.transport, url, 'agent', dispatch)
				await provider.generate(STUDY_AGENT_MESSAGES, signal)
			}
			expect(on.server.requests).toEqual(off.server.requests)
			expect(on.goal.usage()).toEqual(off.goal.usage())
			const [offDispatch, offWire] = off.goal.evidence.map((row) => requireStudyRecord(row.value))
			const [onDispatch, onWire] = on.goal.evidence.map((row) => requireStudyRecord(row.value))
			expect(onDispatch).toEqual({
				...offDispatch,
				id: 1,
				canonical: 1,
				revision: 'f'.repeat(64),
				digest: 'a'.repeat(64),
				previous: null,
				changed: false,
				body: requireValue(on.server.requests[0]).body,
				snapshot: { view: 'selected goal' },
			})
			expect(onWire).toMatchObject({
				...offWire,
				id: 1,
				canonical: 1,
				revision: 'f'.repeat(64),
				timing: {
					durations: { total: 1234, load: null, prompt: null, decode: null },
					counts: { prompt: 7, decode: 2, cached: null },
					invalid: [],
				},
			})
			const observed = ['canonical', 'elapsed', 'id', 'revision', 'sent', 'started', 'timing']
			expect(Object.keys(onWire ?? {}).sort()).toEqual(
				[...Object.keys(offWire ?? {}), ...observed].sort(),
			)
			// The timeline orders admission, send and settlement.
			expect(Number(onWire?.sent)).toBeGreaterThanOrEqual(Number(onWire?.started))
			expect(Number(onWire?.elapsed)).toBeGreaterThanOrEqual(0)
		} finally {
			await off.close()
			await on.close()
		}
	})

	it('runs the timing extractor once, on the terminal row of a streamed reply', async () => {
		const reply = buildOllamaStream(['Re', 'ceipt'], {
			prompt: 7,
			completion: 2,
			fields: { total_duration: 1234 },
		})
		const extractions = createRecorder<readonly [Readonly<Record<string, unknown>>]>()
		const fixture = await createOllamaTransportFixture([{ path: '/api/chat', body: reply }], {
			observe: true,
			timing: (record) => {
				extractions.handler(record)
				return extractTiming(record)
			},
		})
		try {
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const result = await provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal)
			expect(result.content).toBe('Receipt')
			expect(extractions.calls).toMatchObject([[{ done: true, total_duration: 1234 }]])
			const wire = requireStudyRecord(
				fixture.goal.evidence.find((row) => row.event === 'wire')?.value,
			)
			expect(wire.timing).toMatchObject({ durations: { total: 1234 } })
		} finally {
			await fixture.close()
		}
	})
})

describe('transport stop chain', () => {
	it('names the encoded request byte refusal before any admission', async () => {
		const fixture = await createOllamaTransportFixture([], { limit: { duration: 2000, bytes: 1 } })
		try {
			await expect(
				fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				}),
			).rejects.toMatchObject({
				failure: {
					cause: 'capacity',
					role: 'agent',
					stop: {
						layer: 'scope',
						id: 'Wire bytes',
						max: 1,
						consumed: Buffer.byteLength(STUDY_OLLAMA_CHAT_BODY),
					},
				},
			})
			expect(fixture.goal.usage()).toEqual([])
			expect(fixture.server.requests).toEqual([])
		} finally {
			await fixture.close()
		}
	})
	it('records a model cap after the wire with completion distinct from the cap and joins observed ids', async () => {
		for (const observe of STUDY_STOP_SWITCHES) {
			const fixture = await createOllamaTransportFixture(
				[
					{
						path: '/api/chat',
						body: buildOllamaRow({ reason: 'length', prompt: 7, completion: 9 }),
					},
				],
				{ observe },
			)
			try {
				const response = await fixture.transport.fetch(
					'agent',
					`${fixture.server.url}/api/chat`,
					{ method: 'POST', body: STUDY_OLLAMA_CHAT_BODY },
					{ id: 3, revision: 'f'.repeat(64) },
				)
				await expect(response.text()).rejects.toMatchObject({
					failure: { stop: { layer: 'model', id: 'num_predict', max: 512, consumed: 9 } },
				})
				expect(fixture.goal.evidence.map((row) => row.event)).toEqual(['dispatch', 'wire', 'stop'])
				const stopped = requireStudyRecord(fixture.goal.evidence[2]?.value)
				expect(stopped).toMatchObject({
					role: 'agent',
					path: '/api/chat',
					finish: 'length',
					prompt: 7,
					completion: 9,
					stop: { layer: 'model', id: 'num_predict', max: 512, consumed: 9 },
				})
				expect(stopped.id).toBe(observe ? 1 : undefined)
				expect(stopped.canonical).toBe(observe ? 3 : undefined)
				expect(stopped.revision).toBe(observe ? 'f'.repeat(64) : undefined)
				expect(typeof stopped.started).toBe(observe ? 'number' : 'undefined')
				expect(typeof stopped.sent).toBe(observe ? 'number' : 'undefined')
				expect(typeof stopped.elapsed).toBe(observe ? 'number' : 'undefined')
			} finally {
				await fixture.close()
			}
		}
	})

	it('records Context room refusals and records no stop for unsupported finish reasons', async () => {
		for (const window of STUDY_STOP_SWITCHES) {
			const fixture = await createOllamaTransportFixture([
				{
					path: '/api/chat',
					body: buildOllamaRow({
						reason: window ? 'stop' : 'unsupported',
						prompt: window ? 32300 : 7,
						completion: 1,
					}),
				},
			])
			try {
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				await expect(response.text()).rejects.toMatchObject({ code: window ? 'CAPACITY' : 'FAULT' })
				expect(fixture.goal.evidence.map((row) => row.event)).toEqual(
					window ? ['dispatch', 'wire', 'stop'] : ['dispatch', 'wire'],
				)
				expect(fixture.goal.evidence[2]?.value).toEqual(
					window
						? {
								role: 'agent',
								path: '/api/chat',
								finish: 'stop',
								prompt: 32300,
								completion: 1,
								stop: { layer: 'window', id: 'Context room', max: 32128, consumed: 32300 },
							}
						: undefined,
				)
			} finally {
				await fixture.close()
			}
		}
	})

	it('cuts a foreign budget abort during pull and accounts known bytes without latching it', async () => {
		const fixture = await createOllamaTransportFixture(
			[{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true }],
			{ observe: true },
		)
		try {
			const controller = new AbortController()
			const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
				signal: controller.signal,
			})
			const reader = requireValue(response.body).getReader()
			await reader.read()
			const reason = createForeignBudgetError()
			controller.abort(reason)
			await expect(reader.read()).rejects.toBe(reason)
			expect(fixture.goal.usage()).toMatchObject([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: expect.any(Number) },
			])
			expect(fixture.goal.evidence.map((row) => row.event)).toEqual(['dispatch', 'cut'])
			expect(fixture.goal.evidence[1]?.value).toMatchObject({
				role: 'agent',
				path: '/api/chat',
				status: 200,
				budget: { id: 'foreign', max: 1, consumed: 2 },
				id: 1,
			})
			expect(() => fixture.transport.check()).not.toThrow()
			fixture.transport.clear()
			expect(() =>
				fixture.transport.prepare({
					goal: 'second',
					context: fixture.goal.context,
					checkpoint: undefined,
				}),
			).not.toThrow()
		} finally {
			await fixture.close()
		}
	})

	it('cuts cancellation with a foreign budget and fails an unbranded cancellation', async () => {
		for (const branded of STUDY_STOP_SWITCHES) {
			const fixture = await createOllamaTransportFixture([
				{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
			])
			try {
				const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
				})
				const reader = requireValue(response.body).getReader()
				await reader.read()
				const reason = branded ? createForeignBudgetError() : createBudgetLookalike()
				await reader.cancel(reason)
				expect(fixture.goal.evidence.map((row) => row.event)).toEqual([
					'dispatch',
					branded ? 'cut' : 'failure',
				])
				expect(captureError(() => fixture.transport.check())).toBe(branded ? undefined : reason)
				expect(fixture.goal.usage()[0]?.tokens).toBeUndefined()
				expect(typeof fixture.goal.usage()[0]?.bytes).toBe(branded ? 'number' : 'undefined')
			} finally {
				await fixture.close()
			}
		}
	})

	it('accounts a branded abort before the wire exists and retains no failure', async () => {
		const fixture = await createOllamaTransportFixture()
		try {
			const controller = new AbortController()
			const reason = createForeignBudgetError()
			controller.abort(reason)
			await expect(
				fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
					method: 'POST',
					body: STUDY_OLLAMA_CHAT_BODY,
					signal: controller.signal,
				}),
			).rejects.toBe(reason)
			expect(fixture.goal.usage()).toEqual([
				{ role: 'agent', calls: 1, tokens: undefined, bytes: undefined },
			])
			expect(fixture.server.requests).toEqual([])
			expect(fixture.goal.evidence).toEqual([])
			expect(() => fixture.transport.check()).not.toThrow()
		} finally {
			await fixture.close()
		}
	})

	it('retains a Study refusal raised while writing a cut and delivers the stream error', async () => {
		const fixture = await createOllamaTransportFixture([
			{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
		])
		const refusal = new StudyError('CAPACITY', 'Evidence full', {
			cause: 'capacity',
			message: 'Evidence full',
			role: undefined,
			stop: { layer: 'custody', id: 'Goal evidence', max: 1, consumed: 2 },
		})
		try {
			fixture.transport.clear()
			fixture.transport.prepare({
				goal: 'first',
				checkpoint: undefined,
				context: {
					...fixture.goal.context,
					evidence: {
						append: async (row) => {
							if (row.event === 'cut') throw refusal
							await fixture.goal.context.evidence.append(row)
						},
					},
				},
			})
			const controller = new AbortController()
			const response = await fixture.transport.fetch('agent', `${fixture.server.url}/api/chat`, {
				method: 'POST',
				body: STUDY_OLLAMA_CHAT_BODY,
				signal: controller.signal,
			})
			const reader = requireValue(response.body).getReader()
			await reader.read()
			const reason = createForeignBudgetError()
			controller.abort(reason)
			await expect(reader.read()).rejects.toBe(reason)
			expect(captureError(() => fixture.transport.check())).toBe(refusal)
			expect(fixture.goal.meter.control.failure?.stop).toEqual({
				layer: 'custody',
				id: 'Goal evidence',
				max: 1,
				consumed: 2,
			})
		} finally {
			await fixture.close()
		}
	})
})
