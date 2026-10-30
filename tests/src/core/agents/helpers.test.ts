import { describe, expect, it } from 'vitest'
import { AgentError, measureRequest } from '@orkestrel/agent'
import { captureError, createRecorder } from '@orkestrel/test'
import {
	buildStudyAgentDispatch,
	buildStudyAgentParts,
	projectStudyAgentRequest,
	translateStudyAgentError,
	translateStudyAgentStop,
	validateStudyAgentUsage,
} from '../../../../src/core/agents/helpers.js'
import { StudyError, isStudyError } from '../../../../src/core/errors.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'
import {
	STUDY_AGENT_MESSAGES,
	STUDY_AGENT_TOOLS,
	STUDY_AGENT_USAGE_FAILURE,
	STUDY_AGENT_INVALID_STOPS,
	createAgentRuntime,
	createAgentWindowError,
} from '../../../setupStudy.js'

describe('projectStudyAgentRequest', () => {
	it('prices an estimate at overhead plus scale times the estimate, rounded up', () => {
		expect(projectStudyAgentRequest({ scale: 2, overhead: 5 }, 10)).toBe(25)
		expect(projectStudyAgentRequest({ scale: 1.5, overhead: 0 }, 3)).toBe(5)
		expect(projectStudyAgentRequest({ scale: 1e-9, overhead: 100 }, 1000)).toBe(101)
		expect(projectStudyAgentRequest({ scale: 1, overhead: 0 }, 0)).toBe(0)
	})
})

describe('validateStudyAgentUsage', () => {
	it('accepts a finite positive prompt count however it compares with any forecast', () => {
		for (const prompt of [1, 101, 1e9])
			expect(() =>
				validateStudyAgentUsage({ prompt, completion: 0, total: prompt }, 'agent'),
			).not.toThrow()
	})

	it.each([
		['absent usage', undefined],
		['a zero prompt', { prompt: 0, completion: 2, total: 2 }],
		['a negative prompt', { prompt: -1, completion: 2, total: 1 }],
		['a NaN prompt', { prompt: Number.NaN, completion: 2, total: 2 }],
		['an infinite prompt', { prompt: Number.POSITIVE_INFINITY, completion: 2, total: 2 }],
	] as const)('refuses %s with an attributable FAULT for the dispatching role', (_name, usage) => {
		const outcome = captureError(() => validateStudyAgentUsage(usage, 'agent'))
		expect(outcome).toBeInstanceOf(StudyError)
		expect(outcome).toMatchObject({ code: 'FAULT' })
		expect(readStudyFailure(outcome)).toEqual(STUDY_AGENT_USAGE_FAILURE)
	})

	it('retains the role the failure is attributed to', () => {
		const outcome = captureError(() => validateStudyAgentUsage(undefined, 'summary'))
		expect(readStudyFailure(outcome)).toEqual({ ...STUDY_AGENT_USAGE_FAILURE, role: 'summary' })
	})
})

describe('translateStudyAgentError', () => {
	const runtime = createAgentRuntime()

	it('translates a nominal Agent window refusal into an agent capacity failure', () => {
		const translated = translateStudyAgentError(createAgentWindowError('Window full'), runtime)
		expect(isStudyError(translated)).toBe(true)
		expect(translated).toMatchObject({ code: 'CAPACITY', message: 'Window full' })
		expect(readStudyFailure(translated)).toEqual({
			cause: 'capacity',
			message: 'Window full',
			role: 'agent',
			stop: { layer: 'window', id: 'Agent window', max: undefined, consumed: undefined },
		})
	})

	it('returns every other value with its identity', () => {
		const concurrency = new AgentError('CONCURRENCY', 'Run in flight')
		const lookalike = Object.assign(new Error('Window full'), { code: 'WINDOW' })
		const study = new StudyError('FAULT', 'Transport failure')
		for (const value of [concurrency, lookalike, study, 'WINDOW', undefined])
			expect(translateStudyAgentError(value, runtime)).toBe(value)
	})
})

describe('translateStudyAgentStop', () => {
	it('translates meter and budget readings and keeps finite foreign numbers', () => {
		const meter = translateStudyAgentStop({ layer: 'meter', id: 'estimate', max: 2.5, consumed: 3 })
		expect(meter).toMatchObject({
			code: 'CAPACITY',
			message: 'Agent meter allowance reached its ceiling',
			failure: {
				cause: 'capacity',
				role: 'agent',
				stop: { layer: 'meter', id: 'estimate', max: 2.5, consumed: 3 },
			},
		})
		expect(
			translateStudyAgentStop({ layer: 'budget', id: 'cost', max: -1, consumed: 0 }),
		).toMatchObject({
			code: 'CAPACITY',
			message: 'Agent budget reached its ceiling',
			failure: { stop: { layer: 'budget', id: 'cost', max: -1, consumed: 0 } },
		})
	})

	it('reads only the selected foreign arm once and accepts additional members and class instances', () => {
		const reads = createRecorder<readonly [string]>()
		const stop = Object.defineProperties(new Error('foreign stop'), {
			layer: {
				get: () => {
					reads.handler('layer')
					return 'meter'
				},
			},
			id: {
				get: () => {
					reads.handler('id')
					return 'estimate'
				},
			},
			max: {
				get: () => {
					reads.handler('max')
					return 2
				},
			},
			consumed: {
				get: () => {
					reads.handler('consumed')
					return 3
				},
			},
			usage: {
				get: () => {
					throw new Error('irrelevant usage')
				},
			},
		})
		expect(translateStudyAgentStop(stop)).toMatchObject({
			code: 'CAPACITY',
			failure: { stop: { layer: 'meter' } },
		})
		expect(reads.calls).toEqual([['layer'], ['id'], ['max'], ['consumed']])
		const completion = createRecorder<readonly []>()
		expect(
			translateStudyAgentStop(
				Object.defineProperties(
					{ layer: 'model', id: 'provider', extra: true },
					{
						max: {
							get: () => {
								throw new Error('irrelevant max')
							},
						},
						consumed: {
							get: () => {
								throw new Error('irrelevant consumed')
							},
						},
						usage: {
							get: () =>
								Object.defineProperty({}, 'completion', {
									get: () => {
										completion.handler()
										return 7
									},
								}),
						},
					},
				),
			),
		).toMatchObject({
			message: 'Agent model reached its own token limit',
			failure: { stop: { layer: 'model', id: 'provider', max: undefined, consumed: 7 } },
		})
		expect(completion.calls).toEqual([[]])
	})

	it('keeps an absent stop absent and contains malformed and throwing records', () => {
		expect(translateStudyAgentStop(undefined)).toBeUndefined()
		for (const stop of STUDY_AGENT_INVALID_STOPS) {
			expect(translateStudyAgentStop(stop)).toMatchObject({
				code: 'FAULT',
				failure: {
					cause: 'infrastructure',
					message: 'Agent stop record is malformed',
					role: 'agent',
					stop: undefined,
				},
			})
		}
		expect(translateStudyAgentStop({ layer: 'model', id: 'provider' })).toMatchObject({
			failure: { stop: { max: undefined, consumed: undefined } },
		})
		expect(
			translateStudyAgentStop({ layer: 'model', id: 'provider', usage: { completion: Infinity } }),
		).toMatchObject({ failure: { stop: { consumed: undefined } } })
	})

	it('reads finite window context and leaves missing readings unknown', () => {
		expect(
			readStudyFailure(
				translateStudyAgentError(
					new AgentError('WINDOW', 'Window full', { context: { max: 8.5, consumed: 9 } }),
					createAgentRuntime(),
				),
			).stop,
		).toEqual({ layer: 'window', id: 'Agent window', max: 8.5, consumed: 9 })
	})
})

describe('buildStudyAgentParts', () => {
	it('projects every component in request order and adds no total', () => {
		const measure = measureRequest({ messages: STUDY_AGENT_MESSAGES, tools: STUDY_AGENT_TOOLS })
		expect(measure.tools).toBeGreaterThan(0)
		expect(buildStudyAgentParts(measure)).toEqual({
			messages: [
				{ id: 'm1', role: 'user', content: 4, uniform: 4, calls: 0, thinking: 0, images: 0 },
			],
			tools: measure.tools,
			schema: 0,
		})
	})
})

describe('buildStudyAgentDispatch', () => {
	it('joins a measured dispatch by its explicit identities and keeps unknowns null', () => {
		expect(buildStudyAgentDispatch({ id: 3, revision: 'a'.repeat(64) })).toEqual({
			canonical: 3,
			revision: 'a'.repeat(64),
		})
		expect(buildStudyAgentDispatch({ id: 4, revision: undefined })).toEqual({
			canonical: 4,
			revision: null,
		})
		expect(buildStudyAgentDispatch(undefined)).toEqual({ canonical: null, revision: null })
	})
})
