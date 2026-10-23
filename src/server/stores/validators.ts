import type {
	StudyAttempt,
	StudyAncestor,
	StudyEvidence,
	StudyFailure,
	StudyManifest,
	StudyObservation,
	StudyTrial,
} from '@src/core'
import type {
	StudyExchangeBytes,
	StudyExchangeDeclaration,
	StudyExchangeAncestor,
	StudyExchangeHistory,
	StudyExchangeIdentity,
	StudyExchangeReply,
	StudyExchangeRow,
	StudyFile,
	StudySeal,
} from './types.js'
import {
	buildStudySchedule,
	matchesStudyKeys,
	isStudyBounds,
	isStudyCause,
	isStudyDefinition,
	isStudyDigest,
	isStudyName,
	isStudyRole,
	isStudyRecord,
	isStudyScenario,
	isStudyStop,
	isStudyTimestamp,
	isStudyUsage,
} from '@src/core'
import {
	holds,
	canonicalStringify,
	isArray,
	isJSONValue,
	isNonEmptyString,
	isRecord,
} from '@orkestrel/contract'
import { STUDY_RESERVED_NAME } from './constants.js'
import { hashStudyBytes } from '../helpers.js'
import { isStudyIdentity } from '../processes/validators.js'
import {
	isStudyOllamaMetadata,
	isStudyOllamaModel,
	isStudyOllamaStep,
} from '../ollama/validators.js'

/**
 * Checks whether a trial name is portable on all supported hosts.
 * @param value - The candidate name
 * @returns True if the name is portable; false otherwise
 * @example
 * ```ts
 * isStudyCustodyName('r1-s1-a1') // true
 * ```
 */
export function isStudyCustodyName(value: unknown): value is string {
	return isStudyName(value) && !STUDY_RESERVED_NAME.test(value)
}

/** Checks a sealed source reference and its retained identities.
 * @param value - The candidate source reference.
 * @returns True if the reference has exactly its declared members; false otherwise.
 */
export function isStudyAncestor(value: unknown): value is StudyAncestor {
	return holds(
		() =>
			isRecord(value) &&
			matchesStudyKeys(value, ['result', 'seal', 'identity']) &&
			isStudyCustodyName(value.result) &&
			isStudyDigest(value.seal) &&
			isStudyIdentity(value.identity),
	)
}

/** Checks a sealed sidecar reference and its positive exchange prefix.
 * @param value - The candidate replay provenance.
 * @returns True if the sidecar reference is valid; false otherwise.
 */
export function isStudyExchangeAncestor(value: unknown): value is StudyExchangeAncestor {
	return holds(
		() =>
			isRecord(value) &&
			matchesStudyKeys(value, ['result', 'seal', 'identity', 'file', 'prefix']) &&
			isStudyAncestor({ result: value.result, seal: value.seal, identity: value.identity }) &&
			isStudyCustodyFile(value.file) &&
			Number.isSafeInteger(value.prefix) &&
			typeof value.prefix === 'number' &&
			value.prefix > 0,
	)
}

/**
 * Checks whether a manifest exactly binds its declared population and identities.
 * @param value - The candidate manifest
 * @returns True if the manifest is valid; false otherwise
 * @example
 * ```ts
 * isStudyCustodyManifest({}) // false
 * ```
 */
export function isStudyCustodyManifest(value: unknown): value is StudyManifest {
	return holds(() => {
		if (
			!isRecord(value) ||
			!matchesStudyKeys(
				value,
				['id', 'created', 'definition', 'scenarios', 'identity', 'schedule', 'bounds', 'host'],
				['qualification', 'record', 'ancestor'],
			) ||
			!isStudyCustodyName(value.id) ||
			!isStudyTimestamp(value.created) ||
			!isStudyDefinition(value.definition) ||
			!isArray(value.scenarios) ||
			!value.scenarios.every(isStudyScenario) ||
			!isStudyBounds(value.bounds) ||
			(value.record !== undefined && !isStudyRecord(value.record)) ||
			(value.ancestor !== undefined && !isStudyAncestor(value.ancestor)) ||
			!isRecord(value.identity) ||
			!matchesStudyKeys(
				value.identity,
				['agent', 'subject', 'instrument', 'fixtures', 'profile', 'runtime', 'content'],
				['provider'],
			) ||
			(value.identity.provider !== undefined && !isStudyDigest(value.identity.provider)) ||
			(value.qualification !== undefined && !isStudyDigest(value.qualification)) ||
			!isRecord(value.host) ||
			!Object.values(value.host).every((entry) => typeof entry === 'string') ||
			!isArray(value.schedule)
		)
			return false
		const identity = value.identity
		if (
			!['agent', 'subject', 'instrument', 'fixtures', 'profile', 'runtime', 'content'].every(
				(key) => isStudyDigest(identity[key]),
			)
		)
			return false
		const schedule = buildStudySchedule(value.definition, value.scenarios)
		return (
			value.schedule.every(isStudyCustodyTrial) &&
			canonicalStringify(schedule) === canonicalStringify(value.schedule)
		)
	})
}

/**
 * Checks whether a scheduled trial has exact valid identity fields.
 * @param value - The candidate trial
 * @returns True if its identity is valid; false otherwise
 * @example
 * ```ts
 * isStudyCustodyTrial({}) // false
 * ```
 */
export function isStudyCustodyTrial(value: unknown): value is StudyTrial {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['id', 'scenario', 'arm', 'repetition']) &&
			isStudyCustodyName(value.id) &&
			isStudyName(value.scenario) &&
			isStudyName(value.arm) &&
			typeof value.repetition === 'number' &&
			Number.isSafeInteger(value.repetition) &&
			value.repetition >= 0
		)
	})
}

/**
 * Checks whether evidence is exact JSON with a declared event and goal name.
 * @param value - The candidate evidence
 * @returns True if evidence is valid; false otherwise
 * @example
 * ```ts
 * isStudyCustodyEvidence({ event: 'saved', goal: 'write', value: true }) // true
 * ```
 */
export function isStudyCustodyEvidence(value: unknown): value is StudyEvidence {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['event', 'goal', 'value']) &&
			isStudyName(value.event) &&
			isStudyName(value.goal) &&
			isJSONValue(value.value)
		)
	})
}

/**
 * Checks whether a failure carries exact attributable operational fields.
 * @remarks
 * `role` and `stop` are optional keys. A `stop` is valid only on a `capacity` or `deadline` failure,
 * and it must satisfy `isStudyStop`; a failure sealed before the `stop` member existed has no key.
 * @param value - The candidate failure
 * @returns True if the failure is valid; false otherwise
 * @example
 * ```ts
 * isStudyCustodyFailure({}) // false
 * ```
 */
export function isStudyCustodyFailure(value: unknown): value is StudyFailure {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['cause', 'message'], ['role', 'stop']) &&
			isStudyCause(value.cause) &&
			isNonEmptyString(value.message) &&
			(value.role === undefined || isStudyRole(value.role)) &&
			(value.stop === undefined ||
				((value.cause === 'capacity' || value.cause === 'deadline') && isStudyStop(value.stop)))
		)
	})
}

/**
 * Checks whether an observation preserves output or an explicit unexecuted failure.
 * @param value - The candidate observation
 * @returns True if the observation is valid, with an executed fact or an unexecuted fact that holds a failure and no product, usage or duration; false otherwise
 * @example
 * ```ts
 * isStudyCustodyObservation({}) // false
 * ```
 */
export function isStudyCustodyObservation(value: unknown): value is StudyObservation {
	return holds(() => {
		if (
			!isRecord(value) ||
			!matchesStudyKeys(value, ['goal', 'usage', 'duration', 'executed'], ['product', 'failure']) ||
			!isStudyName(value.goal) ||
			!isArray(value.usage) ||
			!value.usage.every(isStudyUsage) ||
			typeof value.duration !== 'number' ||
			!Number.isSafeInteger(value.duration) ||
			value.duration < 0 ||
			(value.failure !== undefined && !isStudyCustodyFailure(value.failure)) ||
			typeof value.executed !== 'boolean' ||
			(value.executed === false &&
				(value.product !== undefined ||
					value.failure === undefined ||
					value.usage.length !== 0 ||
					value.duration !== 0))
		)
			return false
		if (value.product === undefined) return value.failure !== undefined
		return (
			isRecord(value.product) &&
			matchesStudyKeys(value.product, ['value', 'partial']) &&
			isJSONValue(value.product.value) &&
			typeof value.product.partial === 'boolean'
		)
	})
}

/**
 * Checks whether an attempt terminally accounts for the exact scheduled goal horizon.
 * @param value - The candidate attempt
 * @param manifest - The authoritative declaration
 * @returns True if the terminal record is compatible and its execution facts are consistent; false otherwise
 * @remarks
 * Executed goals form a prefix of the horizon and an executed goal with a failure ends it.
 * An unexecuted attempt holds only unexecuted goals, and an attempt without a failure holds only
 * executed goals that did not fail.
 * @example
 * ```ts
 * isStudyCustodyAttempt({}, manifest) // false
 * ```
 */
export function isStudyCustodyAttempt(
	value: unknown,
	manifest: StudyManifest,
): value is StudyAttempt {
	return holds(() => {
		if (
			!isRecord(value) ||
			!matchesStudyKeys(value, ['trial', 'observations', 'duration', 'executed'], ['failure']) ||
			!isStudyCustodyTrial(value.trial) ||
			!isArray(value.observations) ||
			!value.observations.every(isStudyCustodyObservation) ||
			typeof value.duration !== 'number' ||
			!Number.isSafeInteger(value.duration) ||
			value.duration < 0 ||
			(value.failure !== undefined && !isStudyCustodyFailure(value.failure))
		)
			return false
		const identity = value.trial
		const trial = manifest.schedule.find((entry) => entry.id === identity.id)
		const scenario = manifest.scenarios.find((entry) => entry.id === identity.scenario)
		if (
			trial === undefined ||
			scenario === undefined ||
			canonicalStringify(trial) !== canonicalStringify(value.trial) ||
			value.observations.length !== scenario.goals.length ||
			!value.observations.every(
				(observation, index) => observation.goal === scenario.goals[index]?.id,
			)
		)
			return false
		const executed = value.executed
		if (typeof executed !== 'boolean') return false
		// A terminal record without a failure holds only executed goals that did not fail.
		if (
			value.failure === undefined &&
			!value.observations.every((entry) => entry.executed && entry.failure === undefined)
		)
			return false
		// An executed goal needs an executed attempt and no earlier goal that was unexecuted or failed,
		// so it lies at or before the first goal that was unexecuted or failed. A hole reads as an
		// absent observation, which refuses the record, as visiting every position does.
		const observations = Array.from(value.observations)
		const stop = observations.findIndex(
			(observation) => !observation.executed || observation.failure !== undefined,
		)
		return observations.every(
			(observation, index) => !observation.executed || (executed && (stop === -1 || index <= stop)),
		)
	})
}

/**
 * Checks whether an execution file inventory entry is path-safe and bounded.
 * @param value - The candidate entry
 * @returns True if the entry is valid; false otherwise
 * @example
 * ```ts
 * isStudyCustodyFile({}) // false
 * ```
 */
export function isStudyCustodyFile(value: unknown): value is StudyFile {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['path', 'bytes', 'digest']) &&
			typeof value.path === 'string' &&
			(value.path === 'manifest.json' ||
				/^trials\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:evidence.jsonl|attempt.json|exchanges.jsonl)$/.test(
					value.path,
				)) &&
			value.path.split('/').every((name) => !STUDY_RESERVED_NAME.test(name)) &&
			typeof value.bytes === 'number' &&
			Number.isSafeInteger(value.bytes) &&
			value.bytes >= 0 &&
			isStudyDigest(value.digest)
		)
	})
}

/**
 * Checks whether a seal has an exact unique execution inventory.
 * @param value - The candidate seal
 * @returns True if the seal is structurally valid; false otherwise
 * @example
 * ```ts
 * isStudyCustodySeal({}) // false
 * ```
 */
export function isStudyCustodySeal(value: unknown): value is StudySeal {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['result', 'id', 'files']) &&
			isStudyCustodyName(value.result) &&
			isStudyDigest(value.id) &&
			isArray(value.files) &&
			value.files.length > 0 &&
			value.files.every(isStudyCustodyFile) &&
			new Set(value.files.map((entry) => entry.path)).size === value.files.length
		)
	})
}

/** Checks whether encoded body bytes have their exact canonical base64 and SHA-256 identity.
 * @param value - The candidate byte envelope.
 * @returns True if decoded length and digest match; false otherwise.
 */
export function isStudyExchangeBytes(value: unknown): value is StudyExchangeBytes {
	return holds(() => {
		if (
			!isRecord(value) ||
			typeof value.body !== 'string' ||
			typeof value.size !== 'number' ||
			!Number.isSafeInteger(value.size) ||
			value.size < 0 ||
			!isStudyDigest(value.digest)
		)
			return false
		const bytes = Buffer.from(value.body, 'base64')
		return (
			bytes.length === value.size &&
			bytes.toString('base64') === value.body &&
			hashStudyBytes(bytes) === value.digest
		)
	})
}

/** Checks whether an exchange carries an admissible ordered HTTP identity.
 * @param value - The candidate identity.
 * @returns True if identity and stage fields are valid; false otherwise.
 */
export function isStudyExchangeIdentity(value: unknown): value is StudyExchangeIdentity {
	return holds(() => {
		if (
			!isRecord(value) ||
			typeof value.ordinal !== 'number' ||
			!Number.isSafeInteger(value.ordinal) ||
			value.ordinal <= 0 ||
			!isStudyName(value.goal) ||
			!isStudyRole(value.role) ||
			(value.method !== 'GET' && value.method !== 'POST')
		)
			return false
		if (value.stage === 'execution')
			return (
				(value.role === 'agent' || value.role === 'summary' || value.role === 'judge') &&
				value.method === 'POST' &&
				value.path === (value.role === 'judge' ? '/api/generate' : '/api/chat') &&
				typeof value.step === 'number' &&
				Number.isSafeInteger(value.step) &&
				value.step > 0
			)
		if (Object.hasOwn(value, 'step')) return false
		if (value.stage === 'maintenance')
			return (
				value.role === 'maintenance' && value.method === 'POST' && value.path === '/api/generate'
			)
		return (
			(value.stage === 'preflight' || value.stage === 'postflight') &&
			value.role === 'metadata' &&
			(value.path === '/api/version' || value.path === '/api/tags'
				? value.method === 'GET'
				: value.path === '/api/show' && value.method === 'POST')
		)
	})
}

/** Checks whether a retained reply describes bounded successful application bytes and chunks.
 * @param value - The candidate reply.
 * @returns True if status, selected headers and chunk lengths are valid; false otherwise.
 */
export function isStudyExchangeReply(value: unknown): value is StudyExchangeReply {
	return holds(
		() =>
			isRecord(value) &&
			isStudyExchangeBytes(value) &&
			'status' in value &&
			typeof value.status === 'number' &&
			Number.isSafeInteger(value.status) &&
			value.status >= 200 &&
			value.status <= 599 &&
			'headers' in value &&
			isArray(value.headers) &&
			value.headers.every(
				(header) =>
					isArray(header) &&
					header.length === 2 &&
					(header[0] === 'content-type' || header[0] === 'content-encoding') &&
					typeof header[1] === 'string' &&
					!/[\r\n]/.test(header[1]),
			) &&
			'chunks' in value &&
			isArray(value.chunks) &&
			value.chunks.every(
				(size) => typeof size === 'number' && Number.isSafeInteger(size) && size > 0,
			) &&
			value.chunks.reduce<number>(
				(total, size) => total + (typeof size === 'number' ? size : 0),
				0,
			) === value.size,
	)
}

/** Checks whether the opening row declares bounded execution, ordered goals and serving identities.
 * @param value - The candidate declaration.
 * @returns True if all declared populations are valid; false otherwise.
 */
export function isStudyExchangeDeclaration(value: unknown): value is StudyExchangeDeclaration {
	return holds(() => {
		if (
			!isRecord(value) ||
			!matchesStudyKeys(
				value,
				[
					'phase',
					'trial',
					'version',
					'models',
					'metadata',
					'maintenance',
					'record',
					'goals',
					'configuration',
				],
				['procedure', 'ancestor'],
			) ||
			value.phase !== 'declaration' ||
			!isStudyCustodyName(value.trial) ||
			!isNonEmptyString(value.version) ||
			!isRecord(value.models) ||
			Object.keys(value.models).length === 0 ||
			!Object.values(value.models).every(isStudyOllamaModel) ||
			!isStudyOllamaMetadata(value.metadata) ||
			!isStudyRecord(value.record) ||
			(value.ancestor !== undefined && !isStudyExchangeAncestor(value.ancestor)) ||
			!isStudyDigest(value.configuration) ||
			!isArray(value.goals) ||
			value.goals.length === 0 ||
			!value.goals.every(isStudyName) ||
			new Set(value.goals).size !== value.goals.length ||
			(value.procedure !== undefined &&
				(!isArray(value.procedure) ||
					value.procedure.length === 0 ||
					!value.procedure.every(isStudyOllamaStep))) ||
			!isArray(value.maintenance) ||
			!value.maintenance.every(isStudyOllamaModel)
		)
			return false
		const models = Object.values(value.models).filter(isStudyOllamaModel)
		const goals = value.goals
		return (
			(value.procedure === undefined ||
				value.procedure.every(
					(step, index) =>
						step.ordinal === index + 1 &&
						goals.includes(step.goal) &&
						models.some((model) => model.name === step.policy.model),
				)) &&
			value.maintenance.every(
				(model, index, entries) =>
					entries.findIndex((entry) => entry.name === model.name) === index &&
					models.some((entry) => entry.name === model.name && entry.digest === model.digest),
			) &&
			models.every((model) =>
				models.every((other) => model.name !== other.name || model.digest === other.digest),
			)
		)
	})
}

/** Checks whether a sidecar row has exactly its declared fields and verified byte identities.
 * @param value - The candidate row.
 * @returns True if the row belongs to the closed sidecar grammar; false otherwise.
 */
export function isStudyExchangeRow(value: unknown): value is StudyExchangeRow {
	return holds(() => {
		if (!isRecord(value)) return false
		if (value.phase === 'declaration') return isStudyExchangeDeclaration(value)
		if (value.phase === 'complete')
			return (
				matchesStudyKeys(value, ['phase', 'count']) &&
				typeof value.count === 'number' &&
				Number.isSafeInteger(value.count) &&
				value.count > 0
			)
		const identity = ['phase', 'ordinal', 'goal', 'role', 'path', 'method', 'stage']
		if (!isStudyExchangeIdentity(value)) return false
		if (value.phase === 'attempt')
			return (
				matchesStudyKeys(value, [...identity, 'body', 'size', 'digest'], ['step']) &&
				isStudyExchangeBytes(value)
			)
		if (value.phase === 'response')
			return (
				matchesStudyKeys(
					value,
					[...identity, 'body', 'size', 'digest', 'status', 'headers', 'chunks'],
					['step'],
				) &&
				isStudyExchangeReply(value) &&
				value.status < 300
			)
		return (
			value.phase === 'failure' &&
			matchesStudyKeys(value, [...identity, 'reason'], ['step', 'response']) &&
			typeof value.reason === 'string' &&
			(value.response === undefined || isStudyExchangeReply(value.response))
		)
	})
}

/** Checks whether a history has verified row shapes before its complete relational validation.
 * @param value - The candidate history.
 * @returns True if its envelopes and rows have valid types; false otherwise.
 */
export function isStudyExchangeHistory(value: unknown): value is StudyExchangeHistory {
	return holds(
		() =>
			isRecord(value) &&
			matchesStudyKeys(value, ['seal', 'file', 'declaration', 'exchanges', 'completion']) &&
			isStudyDigest(value.seal) &&
			isStudyCustodyFile(value.file) &&
			isStudyExchangeDeclaration(value.declaration) &&
			isArray(value.exchanges) &&
			value.exchanges.every(
				(pair) =>
					isRecord(pair) &&
					matchesStudyKeys(pair, ['attempt', 'response']) &&
					isStudyExchangeRow(pair.attempt) &&
					pair.attempt.phase === 'attempt' &&
					isStudyExchangeRow(pair.response) &&
					pair.response.phase === 'response',
			) &&
			isStudyExchangeRow(value.completion) &&
			value.completion.phase === 'complete',
	)
}
