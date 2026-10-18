import { createRecorder } from '@orkestrel/test'
import { buildStudyManifest } from '../../../setupStudy.js'
import { STUDY_PROCESS_GUARDS } from '../../../setupServer.js'
import { describe, expect, it } from 'vitest'
import {
	isStudyCharge,
	isStudyEvidence,
	isStudyFrame,
	isStudyIdentity,
	isStudyProcessFailure,
	isStudyTrial,
} from '../../../../src/server/processes/validators.js'

describe('process validators', () => {
	it('contains hostile property reads after admitting a plain record', () => {
		for (const guard of STUDY_PROCESS_GUARDS) {
			const reads = createRecorder<[]>()
			const hostile = new Proxy(
				{},
				{
					get() {
						reads.handler()
						throw new Error('Hostile property read')
					},
				},
			)
			// Frame reads only after its enumerable-key cardinality passes.
			Object.assign(hostile, { id: 0, operation: 'goal', value: true })
			expect(guard(hostile)).toBe(false)
			expect(reads.calls).toEqual([[]])
			const revoked = Proxy.revocable({}, {})
			revoked.revoke()
			expect(guard(revoked.proxy)).toBe(false)
		}
	})

	it('contains throwing enumerable-key traps in transport envelopes', () => {
		const reads = createRecorder<[]>()
		const hostile = new Proxy(
			{},
			{
				ownKeys() {
					reads.handler()
					throw new Error('Hostile key read')
				},
			},
		)
		expect(isStudyFrame(hostile)).toBe(false)
		expect(reads.calls).toEqual([[]])
	})

	it('refuses foreign envelopes and invalid domain leaves', () => {
		expect(isStudyFrame({ id: 1, operation: 'goal', value: true })).toBe(true)
		expect(isStudyFrame({ id: 1, operation: 'goal', value: true, extra: true })).toBe(false)
		expect(isStudyFrame({ id: 1, operation: 'goal', extra: true })).toBe(false)
		expect(isStudyFrame({ id: 1, operation: 'goal' })).toBe(false)
		expect(isStudyFrame({ id: NaN, operation: 'goal', value: true })).toBe(false)
		expect(isStudyFrame({ id: 1, operation: 'unknown', value: true })).toBe(false)
		expect(isStudyCharge({ role: 'tool', tokens: 0, bytes: 0 })).toBe(true)
		expect(isStudyCharge({ role: 'tool', tokens: -0, bytes: -0 })).toBe(true)
		expect(isStudyCharge({ role: 'tool', tokens: Number.MAX_SAFE_INTEGER + 1, bytes: 0 })).toBe(
			false,
		)
		expect(isStudyCharge({ role: 'tool', tokens: Infinity, bytes: 0 })).toBe(false)
		expect(isStudyCharge({ role: 'foreign', tokens: 0, bytes: 0 })).toBe(false)
		expect(isStudyProcessFailure({ cause: 'deadline', message: 'expired' })).toBe(true)
		expect(isStudyProcessFailure({ cause: 'deadline', message: 'expired', role: 'judge' })).toBe(
			true,
		)
		expect(isStudyProcessFailure({ cause: 'deadline', message: 'expired', role: 'foreign' })).toBe(
			false,
		)
		expect(isStudyProcessFailure({ cause: 'success', message: 'won' })).toBe(false)
		expect(isStudyProcessFailure({ cause: 'content', message: 'unusable', role: 'summary' })).toBe(
			true,
		)
		expect(isStudyProcessFailure({ cause: 'content', message: 'unusable' })).toBe(true)
		expect(isStudyProcessFailure({ cause: 'Content', message: 'unusable' })).toBe(false)
		expect(isStudyEvidence({ event: 'saved', goal: 'write', value: 'one' })).toBe(true)
		expect(isStudyEvidence({ event: 'saved', goal: '', value: 'one' })).toBe(false)
		expect(isStudyTrial({ id: 'trial', scenario: 'first', arm: 'tool', repetition: 0 })).toBe(true)
		expect(isStudyTrial({ id: 'trial', scenario: 'first', arm: 'tool', repetition: -1 })).toBe(
			false,
		)
		expect(isStudyIdentity(buildStudyManifest().identity)).toBe(true)
		expect(isStudyIdentity({})).toBe(false)
		const { agent, ...unselected } = buildStudyManifest().identity
		expect(agent).toMatch(/^[a-f0-9]{64}$/)
		expect(isStudyIdentity(unselected)).toBe(false)
		expect(isStudyIdentity({ ...unselected, agent: 'unknown' })).toBe(false)
	})
})
