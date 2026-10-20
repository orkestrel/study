import type { StudyAgentRuntime } from './types.js'
import type { LedgerGauge } from '@orkestrel/agent'
import { holds, isFiniteNumber, isObject } from '@orkestrel/contract'

/**
 * Checks whether a value is a gauge with a finite positive scale and a finite nonnegative overhead.
 * @param value - The candidate gauge; additional members are admitted
 * @returns True if the gauge readings are finite and within their bounds; false otherwise
 * @example
 * ```ts
 * isStudyAgentGauge({ scale: 1, overhead: 0 }) // true
 * ```
 */
export function isStudyAgentGauge(value: unknown): value is LedgerGauge {
	return holds(() => {
		if (!isObject(value) || !('scale' in value) || !('overhead' in value)) return false
		const { scale, overhead } = value
		return isFiniteNumber(scale) && scale > 0 && isFiniteNumber(overhead) && overhead >= 0
	})
}

/**
 * Checks whether a namespace exposes the Agent capabilities the instrumentation invokes.
 * @remarks
 * The guard reads only `estimateRequest`, `measureRequest`, and `isAgentError`, so a namespace
 * without Ledger or conversation factories passes. A throwing accessor returns false.
 * @param value - The admitted namespace
 * @returns True if every required capability is a function; false otherwise
 */
export function isStudyAgentRuntime(value: unknown): value is StudyAgentRuntime {
	return holds(
		() =>
			isObject(value) &&
			'estimateRequest' in value &&
			typeof value.estimateRequest === 'function' &&
			'measureRequest' in value &&
			typeof value.measureRequest === 'function' &&
			'isAgentError' in value &&
			typeof value.isAgentError === 'function',
	)
}
