import type {
	StudyOllamaMetadata,
	StudyOllamaModel,
	StudyOllamaPolicy,
	StudyOllamaStep,
} from './types.js'
import { holds, isRecord } from '@orkestrel/contract'
import { STUDY_NAME } from '@src/core'
import { hashStudyBytes } from '../helpers.js'

/** Checks whether a value declares independent positive metadata allowances.
 * @param value - The untrusted metadata declaration.
 * @returns True if the declaration has positive safe calls and bytes and finite duration; false otherwise.
 */
export function isStudyOllamaMetadata(value: unknown): value is StudyOllamaMetadata {
	return holds(
		() =>
			isRecord(value) &&
			typeof value.calls === 'number' &&
			Number.isSafeInteger(value.calls) &&
			value.calls > 0 &&
			typeof value.bytes === 'number' &&
			Number.isSafeInteger(value.bytes) &&
			value.bytes > 0 &&
			typeof value.duration === 'number' &&
			Number.isFinite(value.duration) &&
			value.duration > 0,
	)
}

/** Checks whether a value pins a served model name and SHA-256 digest.
 * @param value - The untrusted model pin.
 * @returns True if the value declares a nonempty name and lowercase SHA-256 digest; false otherwise.
 */
export function isStudyOllamaModel(value: unknown): value is StudyOllamaModel {
	return holds(
		() =>
			isRecord(value) &&
			typeof value.name === 'string' &&
			value.name.length > 0 &&
			typeof value.digest === 'string' &&
			/^[a-f0-9]{64}$/.test(value.digest),
	)
}

/** Checks whether a value declares a complete finite model-generation policy.
 * @param value - The untrusted role policy.
 * @returns True if every policy member and output allowance is valid; false otherwise.
 */
export function isStudyOllamaPolicy(value: unknown): value is StudyOllamaPolicy {
	return holds(
		() =>
			isRecord(value) &&
			typeof value.model === 'string' &&
			value.model.length > 0 &&
			typeof value.think === 'boolean' &&
			typeof value.strict === 'boolean' &&
			typeof value.length === 'boolean' &&
			isRecord(value.options) &&
			Object.values(value.options).every(
				(entry) => typeof entry === 'number' && Number.isFinite(entry),
			) &&
			typeof value.options.num_predict === 'number' &&
			Number.isSafeInteger(value.options.num_predict) &&
			value.options.num_predict > 0,
	)
}

/** Checks whether a value declares exclusive exact or capture admission with a valid receipt.
 * @param value - The untrusted ordered step.
 * @returns True if identity, policy, admission shape and exact receipt are valid; false otherwise.
 */
export function isStudyOllamaStep(value: unknown): value is StudyOllamaStep {
	return holds(() => {
		if (
			!isRecord(value) ||
			typeof value.ordinal !== 'number' ||
			!Number.isSafeInteger(value.ordinal) ||
			value.ordinal <= 0 ||
			typeof value.goal !== 'string' ||
			!STUDY_NAME.test(value.goal) ||
			(value.role !== 'agent' && value.role !== 'summary' && value.role !== 'judge') ||
			value.path !== (value.role === 'judge' ? '/api/generate' : '/api/chat') ||
			!isStudyOllamaPolicy(value.policy) ||
			(value.role === 'judge' && value.policy.strict)
		)
			return false
		if (value.admission === 'capture')
			return (
				typeof value.bytes === 'number' &&
				Number.isSafeInteger(value.bytes) &&
				value.bytes > 0 &&
				!Object.hasOwn(value, 'body') &&
				!Object.hasOwn(value, 'input')
			)
		return (
			value.admission === 'exact' &&
			typeof value.body === 'string' &&
			value.body.length > 0 &&
			typeof value.input === 'string' &&
			value.input === hashStudyBytes(value.body) &&
			!Object.hasOwn(value, 'bytes')
		)
	})
}
