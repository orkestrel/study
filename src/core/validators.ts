import type {
	StudyBounds,
	StudyDefinition,
	StudyCriterion,
	StudyErrorCode,
	StudyGrading,
	StudyJudgment,
	StudyLabels,
	StudyGoal,
	StudyLimit,
	StudyProfile,
	StudyProvider,
	StudyRoom,
	StudyScenario,
	StudyRubric,
	StudyUsage,
} from './types.js'
import { holds, canonicalStringify, isArray, isJSONValue, isRecord } from '@orkestrel/contract'
import { MAX_TIMEOUT_MS } from '@orkestrel/timeout'
import { STUDY_GOALS, STUDY_NAME, STUDY_TRIALS } from './constants.js'
import { matchesStudyKeys } from './helpers.js'

/**
 * Checks whether an identifier is portable and bounded.
 * @param value - The candidate identifier
 * @returns True if it is a portable study identifier; false otherwise
 * @example
 * ```ts
 * isStudyName('memory') // true
 * ```
 */
export function isStudyName(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 128 && STUDY_NAME.test(value)
}

/**
 * Checks whether all allowances are positive safe integers within timer bounds.
 * @param value - The candidate limit
 * @returns True if it defines finite positive allowances; false otherwise
 * @example
 * ```ts
 * isStudyLimit({ duration: 1000, calls: 1, tokens: 100, bytes: 1024 }) // true
 * ```
 */
export function isStudyLimit(value: unknown): value is StudyLimit {
	return holds(() => {
		if (!isRecord(value) || !matchesStudyKeys(value, ['duration', 'calls', 'tokens', 'bytes']))
			return false
		return (
			['duration', 'calls', 'tokens', 'bytes'].every(
				(key) =>
					typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] > 0,
			) &&
			typeof value.duration === 'number' &&
			value.duration <= MAX_TIMEOUT_MS
		)
	})
}

/**
 * Checks whether nested scopes admit no larger allowance than their parent.
 * @param value - The candidate bounds
 * @returns True if every nested allowance is ordered; false otherwise
 * @example
 * ```ts
 * isStudyBounds({}) // false
 * ```
 */
export function isStudyBounds(value: unknown): value is StudyBounds {
	return holds(() => {
		if (
			!isRecord(value) ||
			!matchesStudyKeys(value, ['request', 'goal', 'trial', 'series']) ||
			!isStudyLimit(value.request) ||
			!isStudyLimit(value.goal) ||
			!isStudyLimit(value.trial) ||
			!isStudyLimit(value.series)
		)
			return false
		const limits = [value.request, value.goal, value.trial, value.series]
		for (const [index, limit] of limits.entries()) {
			const next = limits[index + 1]
			if (next === undefined) continue
			if (
				limit.duration > next.duration ||
				limit.calls > next.calls ||
				limit.tokens > next.tokens ||
				limit.bytes > next.bytes
			)
				return false
		}
		return value.request.calls === 1
	})
}

/**
 * Checks whether a goal has a bounded identifier and exact JSON input.
 * @param value - The candidate goal
 * @returns True if the goal is valid; false otherwise
 * @example
 * ```ts
 * isStudyGoal({ id: 'write', input: { text: 'hello' } }) // true
 * ```
 */
export function isStudyGoal(value: unknown): value is StudyGoal {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['id', 'input']) &&
			isStudyName(value.id) &&
			isJSONValue(value.input)
		)
	})
}

/**
 * Checks whether a scenario declares a nonempty horizon with unique goal ids.
 * @param value - The candidate scenario
 * @returns True if the scenario has a valid horizon; false otherwise
 * @example
 * ```ts
 * isStudyScenario({ id: 'shift', goals: [{ id: 'handoff', input: 'Prepare handoff' }] }) // true
 * ```
 */
export function isStudyScenario(value: unknown): value is StudyScenario {
	return holds(() => {
		if (
			!isRecord(value) ||
			!matchesStudyKeys(value, ['id', 'goals']) ||
			!isStudyName(value.id) ||
			!isArray(value.goals)
		)
			return false
		return (
			value.goals.length > 0 &&
			value.goals.length <= STUDY_GOALS &&
			value.goals.every(isStudyGoal) &&
			new Set(value.goals.map((goal) => goal.id)).size === value.goals.length &&
			isJSONValue(value.goals)
		)
	})
}

/**
 * Checks whether a study freezes a complete arm order for every repetition.
 * @param value - The candidate definition
 * @returns True if its population and repetition orders are valid; false otherwise
 * @example
 * ```ts
 * isStudyDefinition({ name: 'tools' }) // false
 * ```
 */
export function isStudyDefinition(value: unknown): value is StudyDefinition {
	return holds(() => {
		if (
			!isRecord(value) ||
			!isJSONValue(value) ||
			!matchesStudyKeys(value, [
				'name',
				'version',
				'question',
				'purpose',
				'driver',
				'arms',
				'scenarios',
				'order',
				'retries',
				'rubric',
			]) ||
			!isStudyName(value.name) ||
			!isStudyName(value.driver) ||
			typeof value.version !== 'string' ||
			value.version.length === 0 ||
			typeof value.question !== 'string' ||
			value.question.length === 0 ||
			(value.purpose !== 'mechanism' &&
				value.purpose !== 'quality' &&
				value.purpose !== 'capacity') ||
			!isArray(value.arms) ||
			value.arms.length === 0 ||
			!value.arms.every(isStudyName) ||
			new Set(value.arms).size !== value.arms.length ||
			!isArray(value.scenarios) ||
			value.scenarios.length === 0 ||
			!value.scenarios.every(isStudyName) ||
			new Set(value.scenarios).size !== value.scenarios.length ||
			!isArray(value.order) ||
			!isJSONValue(value.order) ||
			value.order.length === 0 ||
			value.retries !== 0 ||
			typeof value.rubric !== 'string' ||
			value.rubric.length === 0
		)
			return false
		const arms = value.arms
		if (arms.length * value.scenarios.length * value.order.length > STUDY_TRIALS) return false
		return value.order.every(
			(order) =>
				isArray(order) &&
				order.length === arms.length &&
				new Set(order).size === arms.length &&
				order.every((arm) => typeof arm === 'string' && arms.includes(arm)),
		)
	})
}

/**
 * Checks whether generation room leaves positive context for input.
 * @param value - The candidate room
 * @returns True if input, output and safety allowances fit; false otherwise
 * @example
 * ```ts
 * isStudyRoom({ context: 20480, output: 8192, safety: 512, recap: 2048, think: true }) // true
 * ```
 */
export function isStudyRoom(value: unknown): value is StudyRoom {
	return holds(() => {
		if (
			!isRecord(value) ||
			!matchesStudyKeys(value, ['context', 'output', 'safety', 'recap', 'think']) ||
			typeof value.think !== 'boolean'
		)
			return false
		if (
			!['context', 'output', 'safety', 'recap'].every(
				(key) =>
					typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] > 0,
			)
		)
			return false
		return (
			typeof value.context === 'number' &&
			typeof value.output === 'number' &&
			typeof value.safety === 'number' &&
			typeof value.recap === 'number' &&
			value.output + value.safety < value.context &&
			value.recap + value.safety < value.context
		)
	})
}

/**
 * Checks whether a provider declaration names artifacts, an HTTP origin and models.
 * @param value - The candidate provider declaration
 * @returns True if the declaration has a supported origin and nonempty names; false otherwise
 * @example
 * ```ts
 * isStudyProvider({ entry: 'dist/index.js' }) // false
 * ```
 */
export function isStudyProvider(value: unknown): value is StudyProvider {
	return holds(() => {
		if (
			!isRecord(value) ||
			!matchesStudyKeys(value, ['entry', 'url', 'model', 'judge', 'digest']) ||
			!['entry', 'url', 'model', 'judge'].every(
				(key) => typeof value[key] === 'string' && value[key].length > 0,
			) ||
			typeof value.url !== 'string' ||
			!isRecord(value.digest) ||
			!matchesStudyKeys(value.digest, ['model', 'judge']) ||
			!isStudyDigest(value.digest.model) ||
			!isStudyDigest(value.digest.judge)
		)
			return false
		const url = new URL(value.url)
		return (
			['http:', 'https:'].includes(url.protocol) &&
			url.username === '' &&
			url.password === '' &&
			url.search === '' &&
			url.hash === '' &&
			url.pathname === '/'
		)
	})
}

/**
 * Checks whether a profile carries finite bounds and an optional explicit provider.
 * @param value - The candidate profile
 * @returns True if the profile is structurally valid; false otherwise
 * @example
 * ```ts
 * isStudyProfile({ name: 'local' }) // false
 * ```
 */
export function isStudyProfile(value: unknown): value is StudyProfile {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(
				value,
				['name', 'subject', 'roots', 'bounds', 'room'],
				['provider', 'qualification'],
			) &&
			isStudyName(value.name) &&
			isArray(value.roots) &&
			isJSONValue(value.roots) &&
			value.roots.length > 0 &&
			value.roots.every((root) => typeof root === 'string' && root.trim().length > 0) &&
			new Set(value.roots).size === value.roots.length &&
			typeof value.subject === 'string' &&
			value.subject.length > 0 &&
			isStudyBounds(value.bounds) &&
			isStudyRoom(value.room) &&
			(value.provider === undefined || isStudyProvider(value.provider)) &&
			(value.qualification === undefined ||
				(typeof value.qualification === 'string' && value.qualification.length > 0))
		)
	})
}

/**
 * Checks whether a byte identity is a lowercase SHA-256 digest.
 * @param value - The candidate identity
 * @returns True if it has exactly 64 hexadecimal digits; false otherwise
 * @example
 * ```ts
 * isStudyDigest('a'.repeat(64)) // true
 * ```
 */
export function isStudyDigest(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

/**
 * Checks whether a timestamp is a canonical UTC millisecond instant.
 * @param value - The candidate timestamp
 * @returns True if it is a valid canonical timestamp; false otherwise
 * @example
 * ```ts
 * isStudyTimestamp('2026-10-14T12:00:00.000Z') // true
 * ```
 */
export function isStudyTimestamp(value: unknown): value is string {
	return holds(() => {
		return (
			typeof value === 'string' &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
			new Date(value).toISOString() === value
		)
	})
}

/**
 * Checks whether request usage contains nonnegative safe measurements.
 * @param value - The candidate usage
 * @returns True if the role and every known measurement are valid; false otherwise
 * @example
 * ```ts
 * isStudyUsage({ role: 'tool', calls: 0, bytes: 0, duration: 0 }) // true
 * ```
 */
export function isStudyUsage(value: unknown): value is StudyUsage {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['role', 'calls', 'duration'], ['tokens', 'bytes']) &&
			['agent', 'judge', 'summary', 'metadata', 'tool'].includes(
				typeof value.role === 'string' ? value.role : '',
			) &&
			['calls', 'duration'].every(
				(key) =>
					typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0,
			) &&
			(value.bytes === undefined ||
				(typeof value.bytes === 'number' &&
					Number.isSafeInteger(value.bytes) &&
					value.bytes >= 0)) &&
			(value.tokens === undefined ||
				(typeof value.tokens === 'number' &&
					Number.isSafeInteger(value.tokens) &&
					value.tokens >= 0))
		)
	})
}

/**
 * Checks whether a criterion declares exact grading inputs and references.
 * @param value - The candidate criterion
 * @returns True if its structural grading declaration is valid; false otherwise
 * @example
 * ```ts
 * isStudyCriterion({ id: 'saved', scenario: 'shift', goal: 'write', method: 'state', critical: true, assertion: true }) // true
 * ```
 */
export function isStudyCriterion(value: unknown): value is StudyCriterion {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['id', 'scenario', 'goal', 'method', 'critical', 'assertion']) &&
			isStudyName(value.id) &&
			isStudyName(value.scenario) &&
			isStudyName(value.goal) &&
			(value.method === 'state' || value.method === 'trace' || value.method === 'semantic') &&
			typeof value.critical === 'boolean' &&
			isJSONValue(value.assertion)
		)
	})
}

/**
 * Checks whether a rubric declares nonempty criteria with unique identities.
 * @param value - The candidate rubric
 * @returns True if its version and criteria are valid; false otherwise
 * @example
 * ```ts
 * isStudyRubric({ version: '1', criteria: [] }) // false
 * ```
 */
export function isStudyRubric(value: unknown): value is StudyRubric {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['version', 'criteria']) &&
			typeof value.version === 'string' &&
			value.version.trim().length > 0 &&
			isArray(value.criteria) &&
			value.criteria.length > 0 &&
			value.criteria.every(isStudyCriterion) &&
			new Set(value.criteria.map((criterion) => criterion.id)).size === value.criteria.length &&
			isJSONValue(value.criteria)
		)
	})
}

/**
 * Checks whether a judgment carries a supported verdict and evidence references.
 * @param value - The candidate judgment
 * @returns True if the judgment is attributable and structurally valid; false otherwise
 * @example
 * ```ts
 * isStudyJudgment({ trial: 'r1-s1-a1', criterion: 'saved', verdict: 'unknown', method: 'state', reason: 'No evidence', references: [] }) // true
 * ```
 */
export function isStudyJudgment(value: unknown): value is StudyJudgment {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, [
				'trial',
				'criterion',
				'verdict',
				'method',
				'reason',
				'references',
			]) &&
			isStudyName(value.trial) &&
			isStudyName(value.criterion) &&
			(value.verdict === 'achieved' ||
				value.verdict === 'unsuccessful' ||
				value.verdict === 'unknown') &&
			(value.method === 'state' ||
				value.method === 'trace' ||
				value.method === 'human' ||
				value.method === 'model') &&
			typeof value.reason === 'string' &&
			value.reason.trim().length > 0 &&
			isArray(value.references) &&
			isJSONValue(value.references) &&
			value.references.every(
				(reference) => typeof reference === 'string' && reference.trim().length > 0,
			) &&
			new Set(value.references).size === value.references.length &&
			(value.verdict === 'unknown' || value.references.length > 0)
		)
	})
}

/**
 * Checks whether imported semantic labels have accountable packet provenance.
 * @param value - The candidate labels
 * @returns True if provenance, usage and semantic judgments are valid; false otherwise
 * @example
 * ```ts
 * isStudyLabels({}) // false
 * ```
 */
export function isStudyLabels(value: unknown): value is StudyLabels {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(value, ['packet', 'labeler', 'version', 'created', 'usage', 'judgments']) &&
			isStudyDigest(value.packet) &&
			typeof value.labeler === 'string' &&
			value.labeler.trim().length > 0 &&
			typeof value.version === 'string' &&
			value.version.trim().length > 0 &&
			isStudyTimestamp(value.created) &&
			isArray(value.usage) &&
			Reflect.ownKeys(value.usage).length === value.usage.length + 1 &&
			Array.from(value.usage).every(isStudyUsage) &&
			isArray(value.judgments) &&
			value.judgments.every(isStudyJudgment) &&
			value.judgments.every(
				(judgment) => judgment.method === 'human' || judgment.method === 'model',
			) &&
			new Set(
				value.judgments.map((judgment) => canonicalStringify([judgment.trial, judgment.criterion])),
			).size === value.judgments.length &&
			isJSONValue(value.judgments)
		)
	})
}

/**
 * Checks whether a value names a supported study error code.
 * @param value - The candidate code
 * @returns True if it is a declared study error code; false otherwise
 * @example
 * ```ts
 * isStudyErrorCode('CONFIG') // true
 * ```
 */
export function isStudyErrorCode(value: unknown): value is StudyErrorCode {
	return (
		value === 'CONFIG' ||
		value === 'EVIDENCE' ||
		value === 'CUSTODY' ||
		value === 'CAPACITY' ||
		value === 'FAULT' ||
		value === 'DEADLINE'
	)
}

/**
 * Checks whether grading binds accountable judgments to unique attempt identities.
 * @param value - The candidate grading
 * @returns True if its identities, attempts and judgments are valid; false otherwise
 * @example
 * ```ts
 * isStudyGrading({ version: 1 }) // false
 * ```
 */
export function isStudyGrading(value: unknown): value is StudyGrading {
	return holds(() => {
		return (
			isRecord(value) &&
			matchesStudyKeys(
				value,
				['version', 'result', 'rubric', 'grader', 'instrument', 'attempts', 'judgments'],
				['labels', 'packet'],
			) &&
			value.version === 1 &&
			isStudyDigest(value.result) &&
			isStudyDigest(value.rubric) &&
			isStudyDigest(value.instrument) &&
			typeof value.grader === 'string' &&
			value.grader.trim().length > 0 &&
			(value.labels === undefined || isStudyDigest(value.labels)) &&
			(value.packet === undefined || isStudyDigest(value.packet)) &&
			isArray(value.attempts) &&
			isJSONValue(value.attempts) &&
			value.attempts.every(isStudyName) &&
			new Set(value.attempts).size === value.attempts.length &&
			isArray(value.judgments) &&
			value.judgments.every(isStudyJudgment) &&
			new Set(
				value.judgments.map((judgment) => canonicalStringify([judgment.trial, judgment.criterion])),
			).size === value.judgments.length &&
			isJSONValue(value.judgments)
		)
	})
}
