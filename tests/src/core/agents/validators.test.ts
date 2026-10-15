import { describe, expect, it } from 'vitest'
import * as agent from '@orkestrel/agent'
import { isStudyAgentRuntime } from '../../../../src/core/agents/validators.js'
import { createAgentRuntime } from '../../../setupStudy.js'

describe('isStudyAgentRuntime', () => {
	it('admits the measurement and error capabilities without any Ledger factory', () => {
		const runtime = createAgentRuntime()
		expect(isStudyAgentRuntime(runtime)).toBe(true)
		expect('createLedger' in runtime).toBe(false)
	})

	it('admits the actual development Agent namespace', () => {
		expect(isStudyAgentRuntime(agent)).toBe(true)
	})

	it('refuses a namespace missing any capability', () => {
		const runtime = createAgentRuntime()
		const { estimateRequest, measureRequest, isAgentError } = runtime
		expect(isStudyAgentRuntime({ measureRequest, isAgentError })).toBe(false)
		expect(isStudyAgentRuntime({ estimateRequest, isAgentError })).toBe(false)
		expect(isStudyAgentRuntime({ estimateRequest, measureRequest })).toBe(false)
		expect(isStudyAgentRuntime({ ...runtime, estimateRequest: 1 })).toBe(false)
		expect(isStudyAgentRuntime(undefined)).toBe(false)
		expect(isStudyAgentRuntime('agent')).toBe(false)
	})

	it('returns false instead of throwing for a hostile accessor', () => {
		const hostile = Object.defineProperty({ ...createAgentRuntime() }, 'measureRequest', {
			get(): never {
				throw new Error('Refused read')
			},
		})
		expect(isStudyAgentRuntime(hostile)).toBe(false)
	})
})
