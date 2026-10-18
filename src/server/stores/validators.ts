import type {
	StudyAttempt,
	StudyEvidence,
	StudyFailure,
	StudyManifest,
	StudyObservation,
	StudyTrial,
} from '../../core/types.js'
import type { StudyFile, StudySeal } from './types.js'
import {
	holds,
	canonicalStringify,
	isArray,
	isJSONValue,
	isNonEmptyString,
	isRecord,
} from '@orkestrel/contract'
import { buildStudySchedule, matchesStudyKeys } from '../../core/helpers.js'
import {
	isStudyBounds,
	isStudyCause,
	isStudyDefinition,
	isStudyDigest,
	isStudyName,
	isStudyRole,
	isStudyScenario,
	isStudyTimestamp,
	isStudyUsage,
} from '../../core/validators.js'
import { STUDY_RESERVED_NAME } from './constants.js'

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
				['qualification'],
			) ||
			!isStudyCustodyName(value.id) ||
			!isStudyTimestamp(value.created) ||
			!isStudyDefinition(value.definition) ||
			!isArray(value.scenarios) ||
			!value.scenarios.every(isStudyScenario) ||
			!isStudyBounds(value.bounds) ||
			!isRecord(value.identity) ||
			!matchesStudyKeys(
				value.identity,
				['agent', 'subject', 'instrument', 'fixtures', 'profile'],
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
			!['agent', 'subject', 'instrument', 'fixtures', 'profile'].every((key) =>
				isStudyDigest(identity[key]),
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
			matchesStudyKeys(value, ['cause', 'message'], ['role']) &&
			isStudyCause(value.cause) &&
			isNonEmptyString(value.message) &&
			(value.role === undefined || isStudyRole(value.role))
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
		// so it lies at or before the first goal that was unexecuted or failed.
		const observations = value.observations
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
				/^trials\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:evidence.jsonl|attempt.json)$/.test(value.path)) &&
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
