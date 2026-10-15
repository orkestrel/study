import type { StudyFrame } from './types.js'
import type {
	StudyCharge,
	StudyEvidence,
	StudyFailure,
	StudyTrial,
	StudyIdentity,
} from '../../core/types.js'
import { isStudyCause, isStudyDigest, isStudyName, isStudyRole } from '../../core/validators.js'
import { holds, isJSONValue, isRecord } from '@orkestrel/contract'

/** Checks the complete transport envelope before domain handling.
 * @param value - Native IPC decoded value.
 * @returns True if the envelope is bounded in shape and JSON-compatible; false otherwise.
 */
export function isStudyFrame(value: unknown): value is StudyFrame {
	return holds(
		() =>
			isRecord(value) &&
			Object.keys(value).length === 3 &&
			Object.hasOwn(value, 'id') &&
			Object.hasOwn(value, 'operation') &&
			Object.hasOwn(value, 'value') &&
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
			isJSONValue(value.value),
	)
}

/** Checks operational failure attribution arriving over IPC.
 * @param value - Decoded failure value.
 * @returns True if the failure carries a known cause and optional role; false otherwise.
 */
export function isStudyProcessFailure(value: unknown): value is StudyFailure {
	return holds(
		() =>
			isRecord(value) &&
			typeof value.message === 'string' &&
			isStudyCause(value.cause) &&
			(value.role === undefined || isStudyRole(value.role)),
	)
}

/** Checks a request's declared role and finite cost ceilings.
 * @param value - Decoded charge.
 * @returns True if all charge leaves are valid; false otherwise.
 */
export function isStudyCharge(value: unknown): value is StudyCharge {
	return holds(
		() =>
			isRecord(value) &&
			isStudyRole(value.role) &&
			typeof value.tokens === 'number' &&
			Number.isSafeInteger(value.tokens) &&
			value.tokens >= 0 &&
			typeof value.bytes === 'number' &&
			Number.isSafeInteger(value.bytes) &&
			value.bytes >= 0,
	)
}

/** Checks append-only public evidence.
 * @param value - Decoded evidence.
 * @returns True if event, goal and payload are valid; false otherwise.
 */
export function isStudyEvidence(value: unknown): value is StudyEvidence {
	return holds(
		() =>
			isRecord(value) &&
			isStudyName(value.event) &&
			isStudyName(value.goal) &&
			isJSONValue(value.value),
	)
}

/** Checks a fresh trial's declared identifiers.
 * @param value - Decoded trial.
 * @returns True if every identifier and repetition is valid; false otherwise.
 */
export function isStudyTrial(value: unknown): value is StudyTrial {
	return holds(
		() =>
			isRecord(value) &&
			isStudyName(value.id) &&
			isStudyName(value.scenario) &&
			isStudyName(value.arm) &&
			typeof value.repetition === 'number' &&
			Number.isSafeInteger(value.repetition) &&
			value.repetition >= 0,
	)
}

/** Checks the exact digest fields carried by the execution declaration.
 * @param value - Decoded identity.
 * @returns True if all required identities are digests; false otherwise.
 */
export function isStudyIdentity(value: unknown): value is StudyIdentity {
	return holds(
		() =>
			isRecord(value) &&
			isStudyDigest(value.subject) &&
			(value.provider === undefined || isStudyDigest(value.provider)) &&
			isStudyDigest(value.instrument) &&
			isStudyDigest(value.fixtures) &&
			isStudyDigest(value.profile),
	)
}
