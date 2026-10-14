import type { StudyFrame } from './types.js'
import type {
	StudyCharge,
	StudyEvidence,
	StudyFailure,
	StudyProduct,
	StudyTrial,
	StudyIdentity,
} from '../../core/types.js'
import { isStudyDigest, isStudyName } from '../../core/validators.js'
import { isJSONValue, isRecord } from '@orkestrel/contract'

/** Checks the complete transport envelope before domain handling.
 * @param value - Native IPC decoded value.
 * @returns True if the envelope is bounded in shape and JSON-compatible; false otherwise.
 */
export function isStudyFrame(value: unknown): value is StudyFrame {
	return (
		isRecord(value) &&
		Object.keys(value).length === 4 &&
		value.version === 1 &&
		typeof value.id === 'number' &&
		Number.isSafeInteger(value.id) &&
		value.id >= 0 &&
		typeof value.operation === 'string' &&
		[
			'open',
			'goal',
			'close',
			'admit',
			'finish',
			'fail',
			'evidence',
			'reply',
			'error',
			'abort',
		].includes(value.operation) &&
		isJSONValue(value.value)
	)
}

/** Checks operational failure attribution arriving over IPC.
 * @param value - Decoded failure value.
 * @returns True if the failure carries a known cause and optional role; false otherwise.
 */
export function isStudyProcessFailure(value: unknown): value is StudyFailure {
	return (
		isRecord(value) &&
		typeof value.message === 'string' &&
		typeof value.cause === 'string' &&
		['capacity', 'infrastructure', 'deadline', 'interrupted'].includes(value.cause) &&
		(value.role === undefined ||
			(typeof value.role === 'string' &&
				['agent', 'judge', 'summary', 'metadata', 'tool'].includes(value.role)))
	)
}

/** Checks a request's declared role and finite cost ceilings.
 * @param value - Decoded charge.
 * @returns True if all charge leaves are valid; false otherwise.
 */
export function isStudyCharge(value: unknown): value is StudyCharge {
	return (
		isRecord(value) &&
		typeof value.role === 'string' &&
		['agent', 'judge', 'summary', 'metadata', 'tool'].includes(value.role) &&
		typeof value.tokens === 'number' &&
		Number.isSafeInteger(value.tokens) &&
		value.tokens >= 0 &&
		typeof value.bytes === 'number' &&
		Number.isSafeInteger(value.bytes) &&
		value.bytes >= 0
	)
}

/** Checks a retained public product without awarding task achievement.
 * @param value - Decoded product.
 * @returns True if the product carries JSON output and partial status; false otherwise.
 */
export function isStudyProduct(value: unknown): value is StudyProduct {
	return isRecord(value) && typeof value.partial === 'boolean' && isJSONValue(value.value)
}

/** Checks append-only public evidence.
 * @param value - Decoded evidence.
 * @returns True if event, goal and payload are valid; false otherwise.
 */
export function isStudyEvidence(value: unknown): value is StudyEvidence {
	return (
		isRecord(value) &&
		isStudyName(value.event) &&
		isStudyName(value.goal) &&
		isJSONValue(value.value)
	)
}

/** Checks a fresh trial's declared identifiers.
 * @param value - Decoded trial.
 * @returns True if every identifier and repetition is valid; false otherwise.
 */
export function isStudyTrial(value: unknown): value is StudyTrial {
	return (
		isRecord(value) &&
		isStudyName(value.id) &&
		isStudyName(value.scenario) &&
		isStudyName(value.arm) &&
		typeof value.repetition === 'number' &&
		Number.isSafeInteger(value.repetition) &&
		value.repetition >= 0
	)
}

/** Checks the exact digest fields carried by the execution declaration.
 * @param value - Decoded identity.
 * @returns True if all required identities are digests; false otherwise.
 */
export function isStudyIdentity(value: unknown): value is StudyIdentity {
	return (
		isRecord(value) &&
		isStudyDigest(value.subject) &&
		(value.provider === undefined || isStudyDigest(value.provider)) &&
		isStudyDigest(value.instrument) &&
		isStudyDigest(value.fixtures) &&
		isStudyDigest(value.profile)
	)
}
