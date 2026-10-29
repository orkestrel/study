import { describe, expect, it } from 'vitest'
import { StudyAgentJudge } from '../../../../src/core/agents/StudyAgentJudge.js'
import { StudyError } from '../../../../src/core/errors.js'

import { createRejectedStudyJudge } from '../../../setupStudy.js'
import {
	STUDY_JUDGE_REQUEST,
	STUDY_OLLAMA_ORIGIN,
	createOllamaFetch,
	createOllamaJudgeFixture,
	createStudyLatch,
} from '../../../setupStudy.js'

describe('StudyAgentJudge', () => {
	it('forwards identity and returns the real answer after one check, latching nothing', async () => {
		const plainWire = createOllamaFetch()
		const judgedWire = createOllamaFetch()
		const plain = createOllamaJudgeFixture(STUDY_OLLAMA_ORIGIN, plainWire.fetch)
		const latch = createStudyLatch()
		const inner = createOllamaJudgeFixture(STUDY_OLLAMA_ORIGIN, judgedWire.fetch)
		const judge = new StudyAgentJudge(inner, latch)
		expect([judge.id, judge.name, judge.model]).toEqual([inner.id, inner.name, inner.model])
		const signal = new AbortController().signal
		const expected = await plain.ask(STUDY_JUDGE_REQUEST, signal)
		expect(await judge.ask(STUDY_JUDGE_REQUEST, signal)).toEqual(expected)
		expect(judgedWire.requests).toEqual(plainWire.requests)
		expect(latch.checks.calls).toEqual([[]])
		expect(latch.failures.calls).toEqual([])
	})

	it('retains a thrown judge failure with its identity and rethrows that same value', async () => {
		const wire = createOllamaFetch([{ path: '/api/generate', body: 'unavailable', status: 500 }])
		const latch = createStudyLatch()
		const judge = new StudyAgentJudge(
			createOllamaJudgeFixture(STUDY_OLLAMA_ORIGIN, wire.fetch),
			latch,
		)
		const outcome = await judge.ask(STUDY_JUDGE_REQUEST, new AbortController().signal).then(
			() => undefined,
			(error: unknown) => error,
		)
		expect(outcome).toBeInstanceOf(Error)
		expect(latch.failures.calls).toHaveLength(1)
		expect(latch.failures.calls[0]?.[0]).toBe(outcome)
		expect(wire.requests).toHaveLength(1)
	})

	it('refuses dispatch with the retained failure before the real judge is called', async () => {
		const retained = new StudyError('FAULT', 'Earlier transport failure')
		const wire = createOllamaFetch()
		const latch = createStudyLatch({ error: retained })
		const judge = new StudyAgentJudge(
			createOllamaJudgeFixture(STUDY_OLLAMA_ORIGIN, wire.fetch),
			latch,
		)
		await expect(judge.ask(STUDY_JUDGE_REQUEST, new AbortController().signal)).rejects.toBe(
			retained,
		)
		expect(wire.requests).toEqual([])
		expect(latch.failures.calls).toEqual([])
	})

	it.each([
		['undefined', undefined],
		['null', null],
		['an Error', new Error('Judge unavailable')],
	] as const)(
		'hands a thrown %s to the failure owner and rethrows that same value',
		async (_name, thrown) => {
			const failing = createRejectedStudyJudge(thrown)
			const latch = createStudyLatch()
			const judge = new StudyAgentJudge(failing, latch)
			const outcome = await judge.ask(STUDY_JUDGE_REQUEST, new AbortController().signal).then(
				() => undefined,
				(error: unknown) => ({ error }),
			)
			expect(outcome).toBeDefined()
			expect(outcome?.error).toBe(thrown)
			expect(latch.failures.calls).toHaveLength(1)
			expect(latch.failures.calls[0]?.[0]).toBe(thrown)
		},
	)
})
