import type {
	StudyDefinition,
	StudyAssessment,
	StudyCriterion,
	StudyGoal,
	StudyJudgment,
	StudyLabels,
	StudyManifest,
	StudyProfile,
	StudyRange,
	StudyRubric,
	StudyScenario,
	StudyScore,
	StudyStop,
	StudyTrial,
} from './types.js'
import type { AuditFault, JSONValue } from '@orkestrel/contract'
import { holds, canonicalStringify, isArray, isRecord, isString } from '@orkestrel/contract'
import { StudyError } from './errors.js'
import {
	isStudyDefinition,
	isStudyAssessment,
	isStudyProfile,
	isStudyRubric,
	isStudyScenario,
	isStudyTimestamp,
} from './validators.js'

/**
 * Copies the own entries of a record that hold a value, in their original order.
 * @param value - The record whose undefined entries are absent declarations
 * @returns A fresh record without the undefined entries
 * @example
 * ```ts
 * omitStudyAbsent({ context: 512, recap: undefined }) // { context: 512 }
 * ```
 */
export function omitStudyAbsent(value: object): Readonly<Record<string, unknown>> {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

/**
 * Renders a contract fault as the path it names and what the value broke there.
 * @param fault - One audit fault
 * @param schema - The contract's published schema, which names a refused literal's allowed values
 * @returns The path, dotted, then the fault; a root fault names `value`
 * @example
 * ```ts
 * describeStudyFault({ reason: 'extra', path: ['judgments', '0', 'weight'] }) // 'judgments.0.weight: undeclared key'
 * ```
 */
export function describeStudyFault(fault: AuditFault, schema?: unknown): string {
	const steps = isString(fault.path) ? [fault.path] : fault.path
	const path = steps.join('.') || 'value'
	if (fault.reason === 'extra') return `${path}: undeclared key`
	if (fault.reason === 'missing') return `${path}: missing ${fault.expected}`
	if (fault.reason === 'type') {
		const node = steps.reduce<unknown>(
			(current, step) =>
				isRecord(current)
					? isRecord(current.properties) && Object.hasOwn(current.properties, step)
						? current.properties[step]
						: current.items
					: undefined,
			schema,
		)
		const allowed = isRecord(node) && isArray(node.enum) ? ` among ${node.enum.join(', ')}` : ''
		return `${path}: expected ${fault.expected}${allowed}, received ${fault.received}`
	}
	if (fault.reason === 'constraint')
		return `${path}: breaks ${fault.constraint}${fault.limit === undefined ? '' : ` ${String(fault.limit)}`}, received ${fault.received}`
	if (fault.reason === 'variant')
		return `${path}: matches none of ${String(fault.variants)} variants`
	return `${path}: matches ${String(fault.matched)} variants, not one`
}

/**
 * Lists what a judgment's shape cannot express: unique references and evidence behind a verdict.
 * @param judgment - A judgment its contract accepted
 * @param path - The judgment's dotted path in its document
 * @returns One line per fault, each naming its path
 * @example
 * ```ts
 * scanStudyJudgmentFaults({ trial: 't', criterion: 'c', verdict: 'achieved', method: 'state', reason: 'Saw it', references: [] }, 'judgments.0')
 * // ['judgments.0.references: a verdict needs evidence']
 * ```
 */
export function scanStudyJudgmentFaults(judgment: StudyJudgment, path: string): readonly string[] {
	return [
		...(new Set(judgment.references).size === judgment.references.length
			? []
			: [`${path}.references: repeats a reference`]),
		...(judgment.verdict === 'unknown' || judgment.references.length > 0
			? []
			: [`${path}.references: a verdict needs evidence`]),
	]
}

/**
 * Lists what a rubric's shape cannot express: unique criterion ids.
 * @param rubric - A rubric its contract accepted
 * @returns One line per repeated id, naming its path
 * @example
 * ```ts
 * scanStudyRubricFaults({ version: '1', criteria: [] }) // []
 * ```
 */
export function scanStudyRubricFaults(rubric: StudyRubric): readonly string[] {
	return rubric.criteria.flatMap((criterion, index) =>
		rubric.criteria.findIndex((entry) => entry.id === criterion.id) === index
			? []
			: [`criteria.${String(index)}.id: repeats ${criterion.id}`],
	)
}

/**
 * Lists what a labels file's shape cannot express: a real instant, one judgment per pair, and each judgment's own faults.
 * @param labels - Labels their contract accepted
 * @returns One line per fault, each naming its path
 * @example
 * ```ts
 * scanStudyLabelsFaults({ packet: 'a'.repeat(64), labeler: 'first', version: '1', created: '2026-02-30T00:00:00.000Z', usage: [], judgments: [] })
 * // ['created: names no real instant']
 * ```
 */
export function scanStudyLabelsFaults(labels: StudyLabels): readonly string[] {
	const pairs = labels.judgments.map((judgment) =>
		canonicalStringify([judgment.trial, judgment.criterion]),
	)
	return [
		...(isStudyTimestamp(labels.created) ? [] : ['created: names no real instant']),
		...labels.judgments.flatMap((judgment, index) => [
			...(pairs.indexOf(pairs[index]) === index
				? []
				: [`judgments.${String(index)}: repeats its trial and criterion`]),
			...scanStudyJudgmentFaults(judgment, `judgments.${String(index)}`),
		]),
	]
}

/**
 * Lists the members of a value that are not plain JSON data, by path, without reading an accessor.
 * @param value - The unknown value
 * @param path - The value's dotted path; the root names `value`
 * @returns One line per member, in key order
 * @example
 * ```ts
 * scanStudyJSONFaults({ version: undefined }) // ['version: holds no JSON value']
 * ```
 */
export function scanStudyJSONFaults(value: unknown, path = ''): readonly string[] {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
	)
		return []
	if (typeof value !== 'object') return [`${path || 'value'}: holds no JSON value`]
	return Reflect.ownKeys(value).flatMap((key) => {
		if (typeof key !== 'string') return [`${path || 'value'}: holds a symbol key`]
		if (key === 'length' && isArray(value)) return []
		const child = path === '' ? key : `${path}.${key}`
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
		return descriptor === undefined || !Object.hasOwn(descriptor, 'value')
			? [`${child}: is not a data property`]
			: scanStudyJSONFaults(descriptor.value, child)
	})
}

/**
 * Omits every undefined optional declaration so the profile has one JSON form.
 * @param profile - The validated profile whose optional leaves may be undefined
 * @returns The profile fields with absent qualification, settings, provider, judge and recap removed
 * @example
 * ```ts
 * normalizeStudyProfile(profile) // no `recap` key when the room declares none
 * ```
 */
export function normalizeStudyProfile(profile: StudyProfile): Readonly<Record<string, unknown>> {
	const { provider, qualification, settings, record, room, ...required } = profile
	return {
		...required,
		room: omitStudyAbsent(room),
		...(provider === undefined
			? {}
			: {
					provider: {
						...omitStudyAbsent(provider),
						digest: omitStudyAbsent(provider.digest),
						...(provider.daemon === undefined ? {} : { daemon: omitStudyAbsent(provider.daemon) }),
					},
				}),
		...(qualification === undefined ? {} : { qualification }),
		...(settings === undefined ? {} : { settings }),
		...(record === undefined ? {} : { record }),
	}
}

/**
 * Projects a stop onto JSON with every unreported reading as null.
 * @param stop - The ceiling that stopped a run
 * @returns The stop's layer, id, and readings, with an undefined `max` or `consumed` as null
 * @example
 * ```ts
 * studyStopToJSON({ layer: 'model', id: 'num_predict', max: 2048, consumed: undefined })
 * // { layer: 'model', id: 'num_predict', max: 2048, consumed: null }
 * ```
 */
export function studyStopToJSON(stop: StudyStop): JSONValue {
	return {
		layer: stop.layer,
		id: stop.id,
		max: stop.max ?? null,
		consumed: stop.consumed ?? null,
	}
}

/**
 * Matches exact own enumerable data keys without evaluating accessors.
 * @param value - The candidate record
 * @param required - Required keys
 * @param optional - Allowed optional keys
 * @returns True if the record has exactly the allowed data keys; false otherwise
 * @example Check exact keys
 * ```ts
 * import { matchesStudyKeys } from '@orkestrel/study'
 *
 * matchesStudyKeys({ id: 'one' }, ['id']) // true
 * ```
 */
export function matchesStudyKeys(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	return holds(() => {
		if (!isRecord(value)) return false
		const keys = Reflect.ownKeys(value)
		return (
			required.every((key) => Object.hasOwn(value, key)) &&
			keys.every((key) => {
				if (typeof key !== 'string' || (!required.includes(key) && !optional.includes(key)))
					return false
				const descriptor = Object.getOwnPropertyDescriptor(value, key)
				return (
					descriptor !== undefined &&
					descriptor.enumerable === true &&
					Object.hasOwn(descriptor, 'value')
				)
			})
		)
	})
}

/**
 * Builds a bounded schedule from explicit repetition rows and declared scenarios.
 * @param definition - The frozen population declaration
 * @param scenarios - The complete scenario declarations
 * @returns Owned trials in repetition, scenario and row-arm order
 * @throws StudyError - Thrown when the population or scenario set is invalid
 * @example
 * ```ts
 * buildStudySchedule(definition, scenarios)
 * ```
 */
export function buildStudySchedule(
	definition: StudyDefinition,
	scenarios: readonly StudyScenario[],
): readonly StudyTrial[] {
	if (!isStudyDefinition(definition) || !scenarios.every(isStudyScenario))
		throw new StudyError('CONFIG', 'Invalid study population')
	const ids = new Set(scenarios.map((scenario) => scenario.id))
	if (
		ids.size !== scenarios.length ||
		ids.size !== definition.scenarios.length ||
		!definition.scenarios.every((id) => ids.has(id))
	)
		throw new StudyError('CONFIG', 'Scenario declarations must match the population exactly')
	return Object.freeze(
		[...definition.order.entries()].flatMap(([repetition, row]) =>
			[...definition.scenarios.entries()].flatMap(([scenario, id]) =>
				row.map((arm): StudyTrial =>
					Object.freeze({
						id: `r${repetition + 1}-s${scenario + 1}-a${definition.arms.indexOf(arm) + 1}`,
						scenario: id,
						arm,
						repetition,
					}),
				),
			),
		),
	)
}

/**
 * Returns the scheduled trials a selection names, or every trial when it names none.
 * @param schedule - The built schedule
 * @param trial - The selected trial id; undefined keeps every trial
 * @returns The trials whose id equals `trial`, in schedule order
 * @example
 * ```ts
 * filterStudySchedule(buildStudySchedule(definition, scenarios), 'r1-s1-a2') // [{ id: 'r1-s1-a2', … }]
 * ```
 */
export function filterStudySchedule(
	schedule: readonly StudyTrial[],
	trial: string | undefined,
): readonly StudyTrial[] {
	return trial === undefined ? schedule : schedule.filter((entry) => entry.id === trial)
}

/**
 * Returns the goals of an inclusive range named by its first and last goal ids, in declared order.
 * @param goals - The declared goals of one scenario
 * @param range - The inclusive range; undefined keeps every goal
 * @returns The goals from `first` through `last`, or none when either id is absent or the range is reversed
 * @example
 * ```ts
 * filterStudyGoals(scenario.goals, { first: 'g3', last: 'g5' }) // the goals g3, g4, and g5
 * ```
 */
export function filterStudyGoals(
	goals: readonly StudyGoal[],
	range: StudyRange | undefined,
): readonly StudyGoal[] {
	if (range === undefined) return goals
	const first = goals.findIndex((goal) => goal.id === range.first)
	const last = goals.findIndex((goal) => goal.id === range.last)
	return first === -1 || last < first ? [] : goals.slice(first, last + 1)
}

/**
 * Returns the criteria whose scenario and goal the scenarios declare, in rubric order.
 * @param criteria - The tracked rubric's criteria
 * @param scenarios - The declared or projected scenarios
 * @returns The criteria that grade a declared scenario goal
 * @example
 * ```ts
 * filterStudyCriteria(rubric.criteria, manifest.scenarios) // the criteria a goal range keeps
 * ```
 */
export function filterStudyCriteria(
	criteria: readonly StudyCriterion[],
	scenarios: readonly StudyScenario[],
): readonly StudyCriterion[] {
	return criteria.filter((criterion) =>
		scenarios.some(
			(scenario) =>
				scenario.id === criterion.scenario &&
				scenario.goals.some((goal) => goal.id === criterion.goal),
		),
	)
}

/**
 * Validates grading coverage and request room against the declared study inputs.
 * @param definition - The population declaration
 * @param scenarios - The complete scenario declarations
 * @param rubric - The independently held grading declaration
 * @param profile - The execution bounds and model room
 * @returns Nothing when every cross-input invariant holds
 * @throws StudyError - Thrown when any input or cross-reference is invalid, or a quality study has no capacity qualification
 * @example
 * ```ts
 * validateStudyInputs(definition, scenarios, rubric, profile)
 * ```
 */
export function validateStudyInputs(
	definition: StudyDefinition,
	scenarios: readonly StudyScenario[],
	rubric: StudyRubric,
	profile: StudyProfile,
): void {
	buildStudySchedule(definition, scenarios)
	if (!isStudyRubric(rubric) || !isStudyProfile(profile))
		throw new StudyError('CONFIG', 'Invalid rubric or profile')
	if (
		profile.bounds.request.tokens > profile.room.context - profile.room.safety ||
		profile.room.output > profile.bounds.request.tokens
	)
		throw new StudyError('CONFIG', 'Request allowance does not fit the model room')
	for (const criterion of rubric.criteria) {
		const scenario = scenarios.find((entry) => entry.id === criterion.scenario)
		if (scenario === undefined || !scenario.goals.some((goal) => goal.id === criterion.goal))
			throw new StudyError('CONFIG', 'Criterion references an undeclared goal')
		if (definition.purpose === 'mechanism' && criterion.method === 'semantic')
			throw new StudyError('CONFIG', 'Mechanism studies cannot establish semantic quality')
	}
	const covered = new Set(
		rubric.criteria.map(
			(criterion) => canonicalStringify([criterion.scenario, criterion.goal]) ?? '',
		),
	)
	for (const scenario of scenarios) {
		for (const goal of scenario.goals) {
			if (!covered.has(canonicalStringify([scenario.id, goal.id]) ?? ''))
				throw new StudyError('CONFIG', 'Every declared goal needs a criterion')
		}
	}
	if (definition.purpose === 'quality' && profile.qualification === undefined)
		throw new StudyError('CONFIG', 'Quality studies require a capacity qualification')
}

/**
 * Computes arm intervals over the complete scheduled criterion horizon.
 * @param manifest - The sealed population and schedule, projected by its selection when present
 * @param rubric - The criterion declaration
 * @param assessment - Judgments bound to the complete scheduled attempt set
 * @returns Whole-horizon scores in declared arm order, one per arm that holds a scheduled trial
 * @throws StudyError - Thrown when schedule, attempts or judgments are incompatible
 * @example
 * ```ts
 * computeStudyScores(manifest, rubric, assessment)
 * ```
 */
export function computeStudyScores(
	manifest: StudyManifest,
	rubric: StudyRubric,
	assessment: StudyAssessment,
): readonly StudyScore[] {
	if (!isStudyRubric(rubric) || !isStudyAssessment(assessment))
		throw new StudyError('EVIDENCE', 'Invalid rubric or grading')
	const expected = filterStudySchedule(
		buildStudySchedule(manifest.definition, manifest.scenarios),
		manifest.selection?.trial,
	)
	if (canonicalStringify(expected) !== canonicalStringify(manifest.schedule))
		throw new StudyError('EVIDENCE', 'Manifest schedule differs from the declared population')
	const trials = new Map(expected.map((trial) => [trial.id, trial]))
	if (
		assessment.attempts.length !== expected.length ||
		!assessment.attempts.every((id) => trials.has(id))
	)
		throw new StudyError('EVIDENCE', 'Grading attempts differ from the declared schedule')
	const criteria = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion]))
	for (const scenario of manifest.scenarios) {
		for (const goal of scenario.goals) {
			if (
				!rubric.criteria.some(
					(criterion) => criterion.scenario === scenario.id && criterion.goal === goal.id,
				)
			)
				throw new StudyError('EVIDENCE', 'Rubric omits a declared goal')
		}
	}
	for (const criterion of rubric.criteria) {
		if (
			!manifest.scenarios.some(
				(scenario) =>
					scenario.id === criterion.scenario &&
					scenario.goals.some((goal) => goal.id === criterion.goal),
			) ||
			(manifest.definition.purpose === 'mechanism' && criterion.method === 'semantic')
		)
			throw new StudyError('EVIDENCE', 'Criterion is incompatible with the study')
	}
	const keyed = assessment.judgments.map((judgment) => ({
		judgment,
		key: canonicalStringify([judgment.trial, judgment.criterion]) ?? '',
	}))
	// Reversed so the earliest index of each key is the one the lookup retains.
	const firsts = new Map([...keyed.entries()].reverse().map(([index, { key }]) => [key, index]))
	for (const [index, { judgment, key }] of keyed.entries()) {
		const trial = trials.get(judgment.trial)
		const criterion = criteria.get(judgment.criterion)
		if (
			trial === undefined ||
			criterion === undefined ||
			criterion.scenario !== trial.scenario ||
			firsts.get(key) !== index
		)
			throw new StudyError('EVIDENCE', 'Duplicate or foreign trial criterion judgment')
		if (
			criterion.method === 'semantic'
				? judgment.method !== 'human' && judgment.method !== 'model'
				: judgment.method !== criterion.method
		)
			throw new StudyError('EVIDENCE', 'Judgment method differs from the criterion')
	}
	const judgments = new Map(keyed.map(({ key, judgment }) => [key, judgment]))
	const arms = manifest.definition.arms.filter((arm) => expected.some((trial) => trial.arm === arm))
	return Object.freeze(
		arms.map((arm): StudyScore => {
			const pairs = expected
				.filter((trial) => trial.arm === arm)
				.flatMap((trial) =>
					rubric.criteria
						.filter((criterion) => criterion.scenario === trial.scenario)
						.map((criterion) => ({
							criterion,
							judgment: judgments.get(canonicalStringify([trial.id, criterion.id]) ?? ''),
						})),
				)
			const refuted = pairs.filter(({ judgment }) => judgment?.verdict === 'unsuccessful')
			const total = pairs.length
			const achieved = pairs.filter(({ judgment }) => judgment?.verdict === 'achieved').length
			const unsuccessful = refuted.length
			const critical = refuted.filter(({ criterion }) => criterion.critical).length
			const unknown = total - achieved - unsuccessful
			return Object.freeze({
				arm,
				total,
				achieved,
				unsuccessful,
				unknown,
				critical,
				lower: achieved / total,
				upper: (achieved + unknown) / total,
				coverage: (achieved + unsuccessful) / total,
			})
		}),
	)
}
