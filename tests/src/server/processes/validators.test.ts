import { buildStudyManifest } from '../../../setupStudy.js'
import { describe, expect, it } from 'vitest'
import {
	isStudyCharge,
	isStudyEvidence,
	isStudyFrame,
	isStudyIdentity,
	isStudyProcessFailure,
	isStudyProduct,
	isStudyTrial,
} from '../../../../src/server/processes/validators.js'

describe('process validators', () => {
	it('refuses foreign envelopes and invalid domain leaves', () => {
		expect(isStudyFrame({ version: 1, id: 1, operation: 'goal', value: true })).toBe(true)
		expect(isStudyFrame({ version: 1, id: 1, operation: 'goal', value: true, extra: true })).toBe(
			false,
		)
		expect(isStudyFrame({ version: 1, id: NaN, operation: 'goal', value: true })).toBe(false)
		expect(isStudyFrame({ version: 1, id: 1, operation: 'unknown', value: true })).toBe(false)
		expect(isStudyCharge({ role: 'tool', tokens: 0, bytes: 0 })).toBe(true)
		expect(isStudyCharge({ role: 'tool', tokens: Infinity, bytes: 0 })).toBe(false)
		expect(isStudyProcessFailure({ cause: 'deadline', message: 'expired' })).toBe(true)
		expect(isStudyProcessFailure({ cause: 'success', message: 'won' })).toBe(false)
		expect(isStudyProduct({ value: { answer: 1 }, partial: true })).toBe(true)
		expect(isStudyProduct({ value: undefined, partial: false })).toBe(false)
		expect(isStudyEvidence({ event: 'saved', goal: 'write', value: 'one' })).toBe(true)
		expect(isStudyEvidence({ event: 'saved', goal: '', value: 'one' })).toBe(false)
		expect(isStudyTrial({ id: 'trial', scenario: 'first', arm: 'tool', repetition: 0 })).toBe(true)
		expect(isStudyTrial({ id: 'trial', scenario: 'first', arm: 'tool', repetition: -1 })).toBe(
			false,
		)
		expect(isStudyIdentity(buildStudyManifest().identity)).toBe(true)
		expect(isStudyIdentity({})).toBe(false)
	})
})
