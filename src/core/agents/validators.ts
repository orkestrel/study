import type { StudyAgentRuntime } from './types.js'
import { holds, isObject } from '@orkestrel/contract'

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
