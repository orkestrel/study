import { describe, expect, it } from 'vitest'
import * as agent from '@orkestrel/agent'
import { isStudyAgentGauge, isStudyAgentRuntime } from '../../../../src/core/agents/validators.js'
import {
	STUDY_AGENT_VALID_GAUGES,
	STUDY_AGENT_INVALID_GAUGES,
	STUDY_AGENT_GAUGE_FIELDS,
	createAgentRuntime,
} from '../../../setupStudy.js'

describe('isStudyAgentGauge', () => {
	it.each(STUDY_AGENT_VALID_GAUGES)('admits a bounded gauge %o without exact keys', (gauge) => {
		expect(isStudyAgentGauge(gauge)).toBe(true)
	})

	it.each(STUDY_AGENT_INVALID_GAUGES)('refuses malformed gauge %o', (gauge) => {
		expect(isStudyAgentGauge(gauge)).toBe(false)
	})

	it('returns false for throwing gauge getters and revoked proxies', () => {
		for (const key of STUDY_AGENT_GAUGE_FIELDS) {
			const gauge = Object.defineProperty({ scale: 1, overhead: 0 }, key, {
				get(): never {
					throw new Error('Unreadable gauge')
				},
			})
			expect(isStudyAgentGauge(gauge)).toBe(false)
		}
		const revoked = Proxy.revocable({}, {})
		revoked.revoke()
		expect(isStudyAgentGauge(revoked.proxy)).toBe(false)
	})
})

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
