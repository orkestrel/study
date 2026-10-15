import { describe, expect, it } from 'vitest'
import { isStudyAgentResponse } from '../../../../src/server/agents/validators.js'
import {
	STUDY_SCRIPT_INVALID_RESPONSES,
	STUDY_SCRIPT_MANY_CALLS,
	STUDY_SCRIPT_VALID_RESPONSES,
} from '../../../setupStudy.js'

describe('isStudyAgentResponse', () => {
	it('accepts every bounded response, including the exact text, call and identifier limits', () => {
		for (const response of STUDY_SCRIPT_VALID_RESPONSES)
			expect(isStudyAgentResponse(response), JSON.stringify(response)).toBe(true)
	})

	it('refuses each malformed, unbounded, non-JSON or hostile response', () => {
		for (const response of STUDY_SCRIPT_INVALID_RESPONSES)
			expect(isStudyAgentResponse(response), String(response)).toBe(false)
	})

	it('sets no size limit on content, calls or the consumed call identifier', () => {
		expect(isStudyAgentResponse({ content: 'x'.repeat(4096), calls: [] })).toBe(true)
		expect(isStudyAgentResponse({ content: '', calls: STUDY_SCRIPT_MANY_CALLS })).toBe(true)
		expect(isStudyAgentResponse({ content: '', calls: [], consume: 'c'.repeat(256) })).toBe(true)
	})

	it('refuses a throwing accessor instead of throwing', () => {
		const hostile = Object.defineProperty({ calls: [] }, 'content', {
			enumerable: true,
			get(): never {
				throw new Error('Refused read')
			},
		})
		expect(isStudyAgentResponse(hostile)).toBe(false)
	})
})
