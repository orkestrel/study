import type {
	StudyOllamaMetadata,
	StudyOllamaModel,
	StudyOllamaPolicy,
	StudyOllamaStep,
	StudySystemOnePolicy,
} from './types.js'
import { holds, isBoolean, isNumber, isRecord, isString } from '@orkestrel/contract'
import { STUDY_NAME } from '@src/core'
import { hashStudyBytes } from '../helpers.js'

/** Checks whether a value declares independent positive metadata allowances.
 * @param value - The untrusted metadata declaration.
 * @returns True if the declaration has positive safe calls and bytes and finite duration; false otherwise.
 * @example
 * ```ts
 * isStudyOllamaMetadata({ calls: 8, bytes: 1048576, duration: 2000 }) // true
 * ```
 */
export function isStudyOllamaMetadata(value: unknown): value is StudyOllamaMetadata {
	return holds(
		() =>
			isRecord(value) &&
			isNumber(value.calls) &&
			Number.isSafeInteger(value.calls) &&
			value.calls > 0 &&
			isNumber(value.bytes) &&
			Number.isSafeInteger(value.bytes) &&
			value.bytes > 0 &&
			isNumber(value.duration) &&
			Number.isFinite(value.duration) &&
			value.duration > 0,
	)
}

/** Checks whether a value pins a served model name and SHA-256 digest.
 * @param value - The untrusted model pin.
 * @returns True if the value declares a nonempty name and lowercase SHA-256 digest; false otherwise.
 * @example
 * ```ts
 * isStudyOllamaModel({ name: 'scribe', digest: 'a'.repeat(64) }) // true
 * ```
 */
export function isStudyOllamaModel(value: unknown): value is StudyOllamaModel {
	return holds(
		() =>
			isRecord(value) &&
			isString(value.name) &&
			value.name.length > 0 &&
			isString(value.digest) &&
			/^[a-f0-9]{64}$/.test(value.digest),
	)
}

/** Checks whether a value declares a complete finite model-generation policy.
 * @param value - The untrusted role policy.
 * @returns True if every policy member and output allowance is valid; false otherwise.
 * @example
 * ```ts
 * isStudyOllamaPolicy({ model: 'scribe', options: {}, think: false, strict: true, length: false }) // false
 * ```
 */
export function isStudyOllamaPolicy(value: unknown): value is StudyOllamaPolicy {
	return holds(
		() =>
			isRecord(value) &&
			isString(value.model) &&
			value.model.length > 0 &&
			isBoolean(value.think) &&
			isBoolean(value.strict) &&
			isBoolean(value.length) &&
			isRecord(value.options) &&
			Object.values(value.options).every((entry) => isNumber(entry) && Number.isFinite(entry)) &&
			isNumber(value.options.num_predict) &&
			Number.isSafeInteger(value.options.num_predict) &&
			value.options.num_predict > 0,
	)
}

/** Checks whether a value declares a pinned System One model and total token ceiling.
 * @param value - The untrusted triage policy.
 * @returns True if the model is nonempty and the token ceiling is a positive safe integer; false otherwise.
 * @example
 * ```ts
 * isStudySystemOnePolicy({ model: 'triage', tokens: 512 }) // true
 * ```
 */
export function isStudySystemOnePolicy(value: unknown): value is StudySystemOnePolicy {
	return holds(
		() =>
			isRecord(value) &&
			isString(value.model) &&
			value.model.length > 0 &&
			isNumber(value.tokens) &&
			Number.isSafeInteger(value.tokens) &&
			value.tokens > 0,
	)
}

/** Checks whether a value declares exclusive exact or capture admission with a valid receipt.
 * @param value - The untrusted ordered step.
 * @returns True if identity, policy, admission shape and exact receipt are valid; false otherwise.
 * @example
 * ```ts
 * isStudyOllamaStep({}) // false
 * ```
 */
export function isStudyOllamaStep(value: unknown): value is StudyOllamaStep {
	return holds(() => {
		if (
			!isRecord(value) ||
			!isNumber(value.ordinal) ||
			!Number.isSafeInteger(value.ordinal) ||
			value.ordinal <= 0 ||
			!isString(value.goal) ||
			!STUDY_NAME.test(value.goal) ||
			(value.role !== 'agent' && value.role !== 'judge' && value.role !== 'triage')
		)
			return false
		if (value.role === 'triage') {
			if (value.path !== '/v1/systemone' || !isStudySystemOnePolicy(value.policy)) return false
		} else if (
			value.path !== (value.role === 'judge' ? '/api/generate' : '/api/chat') ||
			!isStudyOllamaPolicy(value.policy) ||
			(value.role === 'judge' && value.policy.strict)
		)
			return false
		if (value.admission === 'capture')
			return (
				isNumber(value.bytes) &&
				Number.isSafeInteger(value.bytes) &&
				value.bytes > 0 &&
				!Object.hasOwn(value, 'body') &&
				!Object.hasOwn(value, 'input')
			)
		return (
			value.admission === 'exact' &&
			isString(value.body) &&
			value.body.length > 0 &&
			isString(value.input) &&
			value.input === hashStudyBytes(value.body) &&
			!Object.hasOwn(value, 'bytes')
		)
	})
}
