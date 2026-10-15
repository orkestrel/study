import { describe, expect, it } from 'vitest'
import { AgentError, measureRequest } from '@orkestrel/agent'
import { captureError } from '@orkestrel/test'
import {
	buildStudyAgentDispatch,
	buildStudyAgentParts,
	projectStudyAgentRequest,
	translateStudyAgentError,
	validateStudyAgentUsage,
} from '../../../../src/core/agents/helpers.js'
import { StudyError, isStudyError } from '../../../../src/core/errors.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'
import {
	STUDY_AGENT_MESSAGES,
	STUDY_AGENT_TOOLS,
	STUDY_AGENT_USAGE_FAILURE,
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

describe('buildStudyAgentParts', () => {
	it('projects every component in request order and adds no total', () => {
		const measure = measureRequest({ messages: STUDY_AGENT_MESSAGES, tools: STUDY_AGENT_TOOLS })
		expect(measure.tools).toBeGreaterThan(0)
		expect(buildStudyAgentParts(measure)).toEqual({
			messages: [
				{ id: 'm1', role: 'user', content: 4, framing: 4, calls: 0, thinking: 0, images: 0 },
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
