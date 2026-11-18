import type { StudyAgentResponse } from './types.js'
import { matchesStudyKeys } from '@src/core'
import {
	holds,
	isArray,
	isBoolean,
	isJSONValue,
	isNumber,
	isRecord,
	isString,
} from '@orkestrel/contract'
import { isToolCall } from '@orkestrel/tool'

/**
 * Checks whether a scripted response has JSON calls and workload controls.
 * @remarks
 * The guard accepts exact own data keys: `content` and `calls` are required; `consume`, `abort`,
 * `tokens`, `bytes` and `truncated` are optional. Each call must satisfy the Tool package's call
 * guard and carry JSON arguments. The guard sets no size limit on content, calls or `consume`; a
 * consumer composes its own workload bounds. A throwing accessor returns false.
 * @param value - The candidate response
 * @returns True if every declared response member is valid; false otherwise
 * @example
 * ```ts
 * isStudyAgentResponse({ content: 'done', calls: [] }) // true
 * ```
 */
export function isStudyAgentResponse(value: unknown): value is StudyAgentResponse {
	return holds(
		() =>
			isRecord(value) &&
			matchesStudyKeys(
				value,
				['content', 'calls'],
				['consume', 'abort', 'tokens', 'bytes', 'truncated'],
			) &&
			isString(value.content) &&
			isArray(value.calls) &&
			value.calls.every(isToolCall) &&
			isJSONValue(value.calls) &&
			(value.consume === undefined || (isString(value.consume) && value.consume.length > 0)) &&
			(value.abort === undefined || isBoolean(value.abort)) &&
			(value.truncated === undefined || isBoolean(value.truncated)) &&
			['tokens', 'bytes'].every(
				(key) =>
					value[key] === undefined ||
					(isNumber(value[key]) && Number.isSafeInteger(value[key]) && value[key] >= 0),
			),
	)
}
