import type {
	StudyDefinition,
	StudyGrading,
	StudyManifest,
	StudyProfile,
	StudyRubric,
	StudyScenario,
	StudyScore,
	StudyTrial,
} from './types.js'
import { holds, canonicalStringify, isRecord } from '@orkestrel/contract'
import { StudyError } from './errors.js'
import {
	isStudyDefinition,
	isStudyGrading,
	isStudyProfile,
	isStudyRubric,
	isStudyScenario,
} from './validators.js'

/**
 * Copies the own entries of a record that hold a value, in their original order.
 * @param value - The record whose undefined entries are absent declarations
 * @returns A new record without the undefined entries
 * @example
 * ```ts
 * omitStudyAbsent({ context: 512, recap: undefined }) // { context: 512 }
 * ```
 */
export function omitStudyAbsent(value: object): Readonly<Record<string, unknown>> {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
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
	const { provider, qualification, settings, room, ...required } = profile
	return {
		...required,
		room: omitStudyAbsent(room),
		...(provider === undefined
			? {}
			: { provider: { ...omitStudyAbsent(provider), digest: omitStudyAbsent(provider.digest) } }),
		...(qualification === undefined ? {} : { qualification }),
		...(settings === undefined ? {} : { settings }),
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
	const trials: StudyTrial[] = []
	for (const [repetition, row] of definition.order.entries()) {
		for (const [scenario, id] of definition.scenarios.entries()) {
			for (const arm of row) {
				trials.push(
					Object.freeze({
						id: `r${repetition + 1}-s${scenario + 1}-a${definition.arms.indexOf(arm) + 1}`,
						scenario: id,
						arm,
						repetition,
					}),
				)
			}
		}
	}
	return Object.freeze(trials)
}

/**
 * Validates grading coverage and request room against the declared study inputs.
 * @param definition - The population declaration
 * @param scenarios - The complete scenario declarations
 * @param rubric - The independently held grading declaration
 * @param profile - The execution bounds and model room
 * @returns Nothing when every cross-input invariant holds
 * @throws StudyError - Thrown when any input or cross-reference is invalid
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
	const covered = new Set<string>()
	for (const criterion of rubric.criteria) {
		const scenario = scenarios.find((entry) => entry.id === criterion.scenario)
		if (scenario === undefined || !scenario.goals.some((goal) => goal.id === criterion.goal))
			throw new StudyError('CONFIG', 'Criterion references an undeclared goal')
		if (definition.purpose === 'mechanism' && criterion.method === 'semantic')
			throw new StudyError('CONFIG', 'Mechanism studies cannot establish semantic quality')
		covered.add(canonicalStringify([criterion.scenario, criterion.goal]) ?? '')
	}
	for (const scenario of scenarios) {
		for (const goal of scenario.goals) {
			if (!covered.has(canonicalStringify([scenario.id, goal.id]) ?? ''))
				throw new StudyError('CONFIG', 'Every declared goal needs a criterion')
		}
	}
}

/**
 * Computes arm intervals over the complete declared criterion horizon.
 * @param manifest - The sealed population and schedule
 * @param rubric - The criterion declaration
 * @param grading - Judgments bound to the complete scheduled attempt set
 * @returns Whole-horizon scores in declared arm order
 * @throws StudyError - Thrown when schedule, attempts or judgments are incompatible
 * @example
 * ```ts
 * computeStudyScores(manifest, rubric, grading)
 * ```
 */
export function computeStudyScores(
	manifest: StudyManifest,
	rubric: StudyRubric,
	grading: StudyGrading,
): readonly StudyScore[] {
	if (!isStudyRubric(rubric) || !isStudyGrading(grading))
		throw new StudyError('EVIDENCE', 'Invalid rubric or grading')
	const expected = buildStudySchedule(manifest.definition, manifest.scenarios)
	if (canonicalStringify(expected) !== canonicalStringify(manifest.schedule))
		throw new StudyError('EVIDENCE', 'Manifest schedule differs from the declared population')
	const trials = new Map(expected.map((trial) => [trial.id, trial]))
	if (
		grading.attempts.length !== expected.length ||
		!grading.attempts.every((id) => trials.has(id))
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
	const judgments = new Map<string, (typeof grading.judgments)[number]>()
	for (const judgment of grading.judgments) {
		const trial = trials.get(judgment.trial)
		const criterion = criteria.get(judgment.criterion)
		const key = canonicalStringify([judgment.trial, judgment.criterion]) ?? ''
		if (
			trial === undefined ||
			criterion === undefined ||
			criterion.scenario !== trial.scenario ||
			judgments.has(key)
		)
			throw new StudyError('EVIDENCE', 'Duplicate or foreign trial criterion judgment')
		if (
			criterion.method === 'semantic'
				? judgment.method !== 'human' && judgment.method !== 'model'
				: judgment.method !== criterion.method
		)
			throw new StudyError('EVIDENCE', 'Judgment method differs from the criterion')
		judgments.set(key, judgment)
	}
	return Object.freeze(
		manifest.definition.arms.map((arm): StudyScore => {
			let total = 0
			let achieved = 0
			let unsuccessful = 0
			let critical = 0
			for (const trial of expected) {
				if (trial.arm !== arm) continue
				for (const criterion of rubric.criteria) {
					if (criterion.scenario !== trial.scenario) continue
					total++
					const judgment = judgments.get(canonicalStringify([trial.id, criterion.id]) ?? '')
					if (judgment?.verdict === 'achieved') achieved++
					if (judgment?.verdict === 'unsuccessful') {
						unsuccessful++
						if (criterion.critical) critical++
					}
				}
			}
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
