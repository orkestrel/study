import type { StudyCharge, StudyEvidence, StudyFailure, StudyTrial, StudyIdentity } from '@src/core'
import type { StudyFrame } from './types.js'
import type { StudyExchangeDestination } from '../stores/types.js'
import type { StudyOllamaReplaySelection } from '../ollama/types.js'
import {
	isStudyCause,
	isStudyDigest,
	isStudyName,
	isStudyRole,
	isStudyStop,
	matchesStudyKeys,
} from '@src/core'
import { isAbsolute, basename } from 'node:path'
import {
	isStudyCustodyFile,
	isStudyCustodyName,
	isStudyExchangeDeclaration,
} from '../stores/validators.js'
import { holds, isJSONValue, isRecord } from '@orkestrel/contract'

/** Checks whether a worker destination has an absolute sidecar path and finite reservation.
 * @param value - The decoded destination.
 * @returns True if its path, allowance and optional retained identity are valid; false otherwise.
 */
export function isStudyExchangeDestination(value: unknown): value is StudyExchangeDestination {
	return holds(
		() =>
			isRecord(value) &&
			matchesStudyKeys(value, ['path', 'declaration'], ['retained']) &&
			typeof value.path === 'string' &&
			isAbsolute(value.path) &&
			basename(value.path) === 'exchanges.jsonl' &&
			isStudyExchangeDeclaration(value.declaration) &&
			(value.retained === undefined || isStudyCustodyFile(value.retained)),
	)
}

/** Checks whether replay explicitly selects a sealed directory and per-trial prefix counts.
 * @param value - The decoded replay selection.
 * @returns True if result, offline and every prefix are declared; false otherwise.
 */
export function isStudyReplaySelection(value: unknown): value is StudyOllamaReplaySelection {
	return holds(
		() =>
			isRecord(value) &&
			matchesStudyKeys(value, ['result', 'prefix', 'offline']) &&
			typeof value.result === 'string' &&
			value.result.length > 0 &&
			typeof value.offline === 'boolean' &&
			isRecord(value.prefix) &&
			Object.keys(value.prefix).length > 0 &&
			Object.entries(value.prefix).every(
				([trial, count]) =>
					isStudyCustodyName(trial) &&
					typeof count === 'number' &&
					Number.isSafeInteger(count) &&
					count > 0,
			),
	)
}

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
 * @returns True if the failure carries a known cause, an optional role, and an optional stop that satisfies `isStudyStop` on a `capacity` or `deadline` cause; false otherwise.
 */
export function isStudyProcessFailure(value: unknown): value is StudyFailure {
	return holds(
		() =>
			isRecord(value) &&
			typeof value.message === 'string' &&
			isStudyCause(value.cause) &&
			(value.role === undefined || isStudyRole(value.role)) &&
			(value.stop === undefined ||
				((value.cause === 'capacity' || value.cause === 'deadline') && isStudyStop(value.stop))),
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
			isStudyDigest(value.agent) &&
			isStudyDigest(value.subject) &&
			(value.provider === undefined || isStudyDigest(value.provider)) &&
			isStudyDigest(value.instrument) &&
			isStudyDigest(value.fixtures) &&
			isStudyDigest(value.profile),
	)
}
