import { describe, expect, it } from 'vitest'
import {
	buildCompactCustodyManifest,
	buildCustodyAttempt,
	buildCustodyManifest,
	buildStudyCapacityManifest,
	buildStudyObservation,
	buildStudyOperationAttempts,
	buildStudyProfile,
	buildStudySettingsProfile,
	buildOllamaReplies,
	buildStudyAgentOrigins,
	createStudyAgentSummary,
	createStudyAgentTrace,
	createStudyDriverFixture,
	createStudyMeterFixture,
	buildStudyScriptResponse,
	createStudyScriptFixture,
	createStudyScriptMeter,
	createStudySinkFixture,
	createStudyStoreFixture,
	importStudyErrorCopy,
	readOllamaMessages,
	STUDY_EXECUTION_CASES,
	STUDY_OLLAMA_PROVIDER,
	STUDY_PROFILE_SETTINGS,
	STUDY_SCRIPT_CALL,
	STUDY_SCRIPT_INVALID_RESPONSES,
	STUDY_SCRIPT_MANY_CALLS,
	STUDY_SCRIPT_VALID_RESPONSES,
	STUDY_SUMMARY_MESSAGES,
} from './setupStudy.js'
import { StudyError } from '../src/core/errors.js'

describe('study error module copies', () => {
	it('evaluates one distinct real error module per tag', async () => {
		const first = await importStudyErrorCopy('setup-first')
		const repeated = await importStudyErrorCopy('setup-first')
		const second = await importStudyErrorCopy('setup-second')
		expect(first.error).not.toBe(StudyError)
		expect(second.error).not.toBe(first.error)
		expect(repeated.error).toBe(first.error)
		const created = first.create('CONFIG', 'Copy refusal')
		expect(created).toBeInstanceOf(Error)
		expect(created).not.toBeInstanceOf(StudyError)
		expect(created).toMatchObject({ name: 'StudyError', code: 'CONFIG', message: 'Copy refusal' })
		expect(first.recognize(created)).toBe(true)
		expect(first.recognize(new Error('ordinary'))).toBe(false)
	})
})

describe('study boundary fixtures', () => {
	it('opens a fresh session per call and records every driver boundary call', async () => {
		const fixture = createStudyDriverFixture()
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		const goal = manifest.scenarios[0]?.goals[0]
		if (trial === undefined || goal === undefined) throw new Error('Missing fixture declaration')
		const signal = new AbortController().signal
		const first = await fixture.driver.open(trial, signal)
		const second = await fixture.driver.open(trial, signal)
		expect(first).not.toBe(second)
		expect(fixture.opened.calls).toEqual([[trial], [trial]])
		const meter = createStudyMeterFixture()
		try {
			const evidence = await createStudyStoreFixture().store.start(trial)
			const context = { signal, meter: meter.meter, evidence }
			expect(await first.execute(goal, context)).toEqual({ value: goal.id, partial: false })
		} finally {
			meter.close()
		}
		await first.close()
		expect(fixture.executed.calls).toEqual([[goal.id]])
		expect(fixture.closed.calls).toEqual([[trial.id]])
	})
	it('awaits the supplied opening promise and runs the supplied execution', async () => {
		const resolvers = Promise.withResolvers<void>()
		const fixture = createStudyDriverFixture({
			opening: resolvers.promise,
			execute: async () => ({ value: 'custom', partial: true }),
		})
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		const goal = manifest.scenarios[0]?.goals[0]
		if (trial === undefined || goal === undefined) throw new Error('Missing fixture declaration')
		const signal = new AbortController().signal
		const opening = fixture.driver.open(trial, signal)
		let settled = false
		void opening.then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(fixture.opened.count).toBe(1)
		expect(settled).toBe(false)
		resolvers.resolve()
		const session = await opening
		const meter = createStudyMeterFixture()
		try {
			const evidence = await createStudyStoreFixture().store.start(trial)
			expect(await session.execute(goal, { signal, meter: meter.meter, evidence })).toEqual({
				value: 'custom',
				partial: true,
			})
		} finally {
			meter.close()
		}
		expect(fixture.executed.calls).toEqual([[goal.id]])
	})
	it('records started trials and finished attempts without replicating custody', async () => {
		const fixture = createStudyStoreFixture()
		const manifest = buildCompactCustodyManifest()
		const trial = manifest.schedule[0]
		if (trial === undefined) throw new Error('Missing fixture trial')
		const sink = await fixture.store.start(trial)
		await expect(sink.append({ event: 'saved', goal: 'write', value: 1 })).resolves.toBeUndefined()
		const attempt = buildCustodyAttempt(manifest, trial)
		await fixture.store.finish(attempt)
		expect(fixture.started.calls).toEqual([[trial]])
		expect(fixture.attempts.calls).toEqual([[attempt]])
	})
})

describe('study meter fixture lifecycle', () => {
	it('owns its primitive lifetimes and closes admission without cancelling completed work', () => {
		const fixture = createStudyMeterFixture()
		fixture.meter
			.admit({ role: 'tool', tokens: 0, bytes: 1 })
			.finish({ role: 'tool', calls: 1, tokens: 0, bytes: 1, duration: 0 })
		fixture.close()
		fixture.close()
		expect(fixture.control.failure).toBeUndefined()
		expect(fixture.meter.usage).toHaveLength(1)
		expect(() => fixture.meter.admit({ role: 'tool', tokens: 0, bytes: 1 })).toThrow(/closed/)
	})
})

describe('study declaration fixtures', () => {
	it('varies byte allowances without changing the compact horizon or sharing caller data', () => {
		const bytes = { request: 16, goal: 64, trial: 4096, series: 65536 }
		const manifest = buildStudyCapacityManifest(bytes)
		bytes.goal = 128
		expect(manifest.bounds).toEqual({
			request: { duration: 1000, calls: 1, tokens: 1000, bytes: 16 },
			goal: { duration: 2000, calls: 2, tokens: 2000, bytes: 64 },
			trial: { duration: 4000, calls: 4, tokens: 4000, bytes: 4096 },
			series: { duration: 32000, calls: 32, tokens: 32000, bytes: 65536 },
		})
		expect(manifest.schedule.map(({ scenario, arm }) => ({ scenario, arm }))).toEqual([
			{ scenario: 'first', arm: 'small' },
			{ scenario: 'second', arm: 'small' },
		])
	})
	it('keeps both scenarios in the compact custody population', () => {
		const manifest = buildCompactCustodyManifest()
		expect(
			manifest.schedule.map(({ scenario, arm, repetition }) => ({ scenario, arm, repetition })),
		).toEqual([
			{ scenario: 'first', arm: 'small', repetition: 0 },
			{ scenario: 'second', arm: 'small', repetition: 0 },
		])
	})
	it('builds independent declarations and terminal horizons from their actual schedule', () => {
		const first = buildCustodyManifest()
		const second = buildCustodyManifest()
		expect(first).not.toBe(second)
		expect(first.bounds).not.toBe(second.bounds)
		const trial = first.schedule[0]
		if (trial === undefined) throw new Error('Missing fixture trial')
		const attempt = buildCustodyAttempt(first, trial)
		expect(attempt.trial).toEqual(trial)
		expect(attempt.observations.map((observation) => observation.goal)).toEqual(['write', 'read'])
		expect(() => buildCustodyAttempt(first, { ...trial, scenario: 'foreign' })).toThrow(
			'no scenario',
		)
	})
	it('builds terminal horizons that carry explicit execution facts', () => {
		const current = buildCustodyManifest()
		const trial = current.schedule[0]
		if (trial === undefined) throw new Error('Missing fixture trial')
		expect(Object.hasOwn(current, 'version')).toBe(false)
		expect(buildCustodyAttempt(current, trial)).toMatchObject({
			executed: true,
			observations: [{ executed: true }, { executed: true }],
		})
		expect(buildStudyObservation('write', false)).toEqual({
			goal: 'write',
			product: undefined,
			failure: { cause: 'interrupted', message: 'Goal unexecuted: Stopped', role: undefined },
			usage: [],
			duration: 0,
			executed: false,
		})
	})
	it('covers accepted and refused execution shapes', () => {
		expect(new Set(STUDY_EXECUTION_CASES.map(({ valid }) => valid))).toEqual(new Set([true, false]))
		expect(new Set(STUDY_EXECUTION_CASES.map(({ name }) => name)).size).toBe(
			STUDY_EXECUTION_CASES.length,
		)
	})
	it('builds one attempt per scheduled trial with each operational partition represented', () => {
		const manifest = buildCustodyManifest()
		const attempts = buildStudyOperationAttempts(manifest)
		expect(attempts.map((attempt) => attempt.trial.id)).toEqual(
			manifest.schedule.map((trial) => trial.id),
		)
		expect(attempts.map((attempt) => attempt.executed)).toEqual([
			true,
			true,
			true,
			true,
			false,
			true,
			true,
			true,
		])
		expect(attempts.map((attempt) => attempt.failure?.cause)).toEqual([
			undefined,
			'capacity',
			undefined,
			'infrastructure',
			'interrupted',
			'deadline',
			undefined,
			undefined,
		])
	})
	it('rejects each driver open with the supplied error after recording the call', async () => {
		const refusal = new Error('Open refused')
		const fixture = createStudyDriverFixture({ refuse: refusal })
		const trial = buildCompactCustodyManifest().schedule[0]
		if (trial === undefined) throw new Error('Missing fixture trial')
		await expect(fixture.driver.open(trial, new AbortController().signal)).rejects.toBe(refusal)
		expect(fixture.opened.calls).toEqual([[trial]])
	})
	it('builds settings profiles that differ from the base only by their settings', () => {
		const base = buildStudyProfile()
		expect(base.settings).toBeUndefined()
		const distinct = new Set(STUDY_PROFILE_SETTINGS.map((settings) => JSON.stringify(settings)))
		expect(distinct.size).toBe(STUDY_PROFILE_SETTINGS.length)
		for (const settings of STUDY_PROFILE_SETTINGS) {
			const profile = buildStudySettingsProfile(settings)
			expect(profile.settings).toBe(settings)
			expect({ ...profile, settings: undefined }).toEqual(base)
		}
	})
})

describe('study agent trace fixtures', () => {
	const row = { event: 'lookup', goal: 'write', value: { id: 'order-1' } }

	it('records accepted rows in order and runs its hook before each append', async () => {
		const seen: string[] = []
		const fixture = createStudySinkFixture({
			during: () => {
				seen.push('hook')
			},
		})
		await fixture.sink.append(row)
		await fixture.sink.append({ ...row, event: 'summary' })
		expect(fixture.rows.map(({ event }) => event)).toEqual(['lookup', 'summary'])
		expect(seen).toEqual(['hook', 'hook'])
	})

	it('refuses exactly the named row with the supplied error and keeps the others', async () => {
		const refusal = new Error('Custody refused')
		const fixture = createStudySinkFixture({ refuse: { error: refusal, row: 1 } })
		await fixture.sink.append(row)
		await expect(fixture.sink.append({ ...row, event: 'summary' })).rejects.toBe(refusal)
		await fixture.sink.append({ ...row, event: 'arrival' })
		expect(fixture.rows.map(({ event }) => event)).toEqual(['lookup', 'arrival'])
	})

	it('builds a trace over a recorded latch that refuses with the supplied value', () => {
		const free = createStudyAgentTrace(true)
		free.latch.check()
		expect(free.latch.checks.count).toBe(1)
		expect(free.trace.goal).toBe(undefined)
		const failure = new Error('Latched')
		const refused = createStudyAgentTrace(false, { error: failure })
		expect(() => refused.latch.check()).toThrow(failure)
		expect(refused.latch.checks.count).toBe(1)
	})

	it('builds a summary whose real provider answers the queued wire reply and whose signal defaults live', async () => {
		const fixture = createStudyAgentSummary({
			replies: buildOllamaReplies('Queued recap'),
			observe: false,
			limit: 1000,
		})
		fixture.trace.start('write')
		await expect(fixture.summary.summarize(STUDY_SUMMARY_MESSAGES, undefined)).resolves.toBe(
			'Queued recap',
		)
		expect(fixture.wire.requests.map(({ path }) => path)).toEqual(['/api/chat'])
		expect(fixture.latch.checks.count).toBe(2)
	})

	it('joins every message to its own id and reads wire messages back in order', () => {
		expect(buildStudyAgentOrigins(STUDY_SUMMARY_MESSAGES)).toEqual([
			{ origin: 'history', source: 'h1' },
			{ origin: 'history', source: 'h2' },
		])
		const body = JSON.stringify({
			messages: [
				{ role: 'user', content: 'One' },
				{ role: 'assistant', content: 'Two' },
			],
		})
		expect(readOllamaMessages(body)).toEqual([
			{ role: 'user', content: 'One' },
			{ role: 'assistant', content: 'Two' },
		])
		expect(() => readOllamaMessages('{"messages":[{"role":"user"}]}')).toThrow(
			'Invalid chat message',
		)
		expect(() => readOllamaMessages('{}')).toThrow('Invalid chat request')
	})
})

describe('study script fixtures', () => {
	it('builds a complete empty response and applies only the supplied changes', () => {
		expect(buildStudyScriptResponse()).toEqual({
			content: '',
			calls: [],
			consume: undefined,
			cancel: undefined,
			tokens: undefined,
			bytes: undefined,
		})
		expect(buildStudyScriptResponse({ content: 'done', cancel: true })).toMatchObject({
			content: 'done',
			cancel: true,
			calls: [],
		})
	})

	it('supplies disjoint valid and invalid response populations and a call population beyond any consumer bound', () => {
		expect(STUDY_SCRIPT_VALID_RESPONSES.length).toBeGreaterThan(0)
		expect(STUDY_SCRIPT_INVALID_RESPONSES.length).toBeGreaterThan(0)
		for (const response of STUDY_SCRIPT_VALID_RESPONSES)
			expect(STUDY_SCRIPT_INVALID_RESPONSES).not.toContain(response)
		expect(STUDY_SCRIPT_MANY_CALLS.every((call) => call === STUDY_SCRIPT_CALL)).toBe(true)
		expect(STUDY_SCRIPT_MANY_CALLS.length).toBeGreaterThan(8)
	})

	it('builds a plan over the real meter whose sink records rows and whose workload is separate from the meter', async () => {
		const meter = createStudyScriptMeter(500, 50)
		try {
			const fixture = createStudyScriptFixture(meter, [buildStudyScriptResponse()])
			expect(fixture.plan.goal).toBe('script')
			expect(fixture.plan.responses).toHaveLength(1)
			expect(fixture.plan.workload).toBe(fixture.workload)
			expect(fixture.workload.signal).not.toBe(meter.control.signal)
			await fixture.plan.context.evidence.append({ event: 'probe', goal: 'script', value: 1 })
			expect(fixture.rows.calls).toEqual([[{ event: 'probe', goal: 'script', value: 1 }]])
			const ticket = await fixture.plan.context.meter.admit({
				role: 'agent',
				tokens: 50,
				bytes: 500,
			})
			expect(ticket.settled).toBe(false)
			ticket.finish({ role: 'agent', calls: 1, tokens: 50, bytes: 500, duration: 0 })
			expect(ticket.settled).toBe(true)
		} finally {
			meter.close()
		}
	})

	it('sizes every enclosing scope for the requested number of full-size requests', async () => {
		const meter = createStudyScriptMeter(500, 50, 2)
		try {
			const first = await meter.meter.admit({ role: 'agent', tokens: 1, bytes: 500 })
			const second = await meter.meter.admit({ role: 'agent', tokens: 1, bytes: 500 })
			first.finish({ role: 'agent', calls: 1, tokens: 1, bytes: 500, duration: 0 })
			second.finish({ role: 'agent', calls: 1, tokens: 1, bytes: 500, duration: 0 })
			// The two settled requests fill the scope allowance, so a third reservation is refused.
			expect(() => meter.meter.admit({ role: 'agent', tokens: 1, bytes: 500 })).toThrow(
				'cannot admit',
			)
		} finally {
			meter.close()
		}
	})

	it('pins the declared serving identities of the Ollama provider fixture', () => {
		expect(STUDY_OLLAMA_PROVIDER).toMatchObject({
			model: 'model',
			judge: 'judge',
			digest: { model: 'a'.repeat(64), judge: 'b'.repeat(64) },
		})
	})
})
