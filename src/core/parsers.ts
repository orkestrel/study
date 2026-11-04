import type {
	StudyContractOptions,
	StudyDefinition,
	StudyAssessment,
	StudyJudgment,
	StudyLabels,
	StudyProfile,
	StudyRubric,
	StudyScenario,
} from './types.js'
import {
	attempt,
	describeFaults,
	cloneJSONValue,
	isArray,
	isFiniteNumber,
	isRecord,
} from '@orkestrel/contract'
import { studyJudgmentContract, studyLabelsContract, studyRubricContract } from './contracts.js'
import { StudyError } from './errors.js'
import {
	matchesStudyKeys,
	normalizeStudyProfile,
	omitStudyAbsent,
	scanStudyJSONFaults,
	scanStudyJudgmentFaults,
	scanStudyLabelsFaults,
	scanStudyRubricFaults,
} from './helpers.js'
import {
	isStudyDefinition,
	isStudyAssessment,
	isStudyJudgment,
	isStudyProfile,
	isStudyScenario,
} from './validators.js'

/**
 * Parses a filled value into an owned frozen snapshot through one contract validation.
 * @param value - The unknown value
 * @param options - The refusal code, the value's name, the contract, and what its shape cannot express
 * @returns The owned value
 * @throws StudyError - Thrown with `options.code`, naming each refused field's path, or stating the value is unreadable when it holds a read that is not plain JSON data
 * @example
 * ```ts
 * parseStudyContract({}, { code: 'CONFIG', noun: 'study rubric', contract: studyRubricContract, scan: scanStudyRubricFaults })
 * // throws a StudyError naming version and criteria
 * ```
 */
export function parseStudyContract<T>(value: unknown, options: StudyContractOptions<T>): T {
	const { code, noun, contract, scan } = options
	const owned = attempt((): unknown => cloneJSONValue(value))
	if (!owned.success) {
		const found = attempt(() => scanStudyJSONFaults(value))
		throw new StudyError(
			code,
			`Invalid or unreadable ${noun}${found.success && found.value.length > 0 ? `: ${found.value.join('; ')}` : ''}`,
		)
	}
	const snapshot = owned.value
	if (!contract.is(snapshot))
		throw new StudyError(
			code,
			`Invalid ${noun}: ${describeFaults(contract.audit(snapshot), contract.schema)}`,
		)
	const faults = scan(snapshot)
	if (faults.length > 0) throw new StudyError(code, `Invalid ${noun}: ${faults.join('; ')}`)
	return snapshot
}

/**
 * Parses a foreign reading into a number a stop can retain.
 * @param value - The unknown reading a source reports
 * @returns The value when it is a finite number; undefined otherwise
 * @example
 * ```ts
 * parseStudyMeasurement(2048) // 2048
 * parseStudyMeasurement(Number.NaN) // undefined
 * ```
 */
export function parseStudyMeasurement(value: unknown): number | undefined {
	return isFiniteNumber(value) ? value : undefined
}

/**
 * Parses a definition into an independent frozen validated snapshot.
 * @param value - The unknown configuration
 * @returns The owned study definition
 * @throws StudyError - Thrown when configuration is invalid or cannot be owned
 * @example
 * ```ts
 * parseStudyDefinition(configuration)
 * ```
 */
export function parseStudyDefinition(value: unknown): StudyDefinition {
	try {
		if (!isStudyDefinition(value)) throw new StudyError('CONFIG', 'Invalid study definition')
		const snapshot = cloneJSONValue(value)
		if (isStudyDefinition(snapshot)) return snapshot
	} catch {
		throw new StudyError('CONFIG', 'Invalid or unreadable study definition')
	}
	throw new StudyError('CONFIG', 'Invalid study definition snapshot')
}

/**
 * Parses a scenario into an independent frozen validated snapshot.
 * @param value - The unknown configuration
 * @returns The owned scenario and goal inputs
 * @throws StudyError - Thrown when configuration is invalid or cannot be owned
 * @example
 * ```ts
 * parseStudyScenario({ id: 'shift', goals: [{ id: 'write', input: {} }] })
 * ```
 */
export function parseStudyScenario(value: unknown): StudyScenario {
	try {
		if (!isStudyScenario(value)) throw new StudyError('CONFIG', 'Invalid study scenario')
		const snapshot = cloneJSONValue(value)
		if (isStudyScenario(snapshot)) return snapshot
	} catch {
		throw new StudyError('CONFIG', 'Invalid or unreadable study scenario')
	}
	throw new StudyError('CONFIG', 'Invalid study scenario snapshot')
}

/**
 * Parses a profile into an independent frozen validated snapshot.
 * @param value - The unknown configuration
 * @returns The owned profile with absent optional settings preserved
 * @throws StudyError - Thrown when configuration is invalid or cannot be owned
 * @example
 * ```ts
 * parseStudyProfile(configuration)
 * ```
 */
export function parseStudyProfile(value: unknown): StudyProfile {
	try {
		if (!isStudyProfile(value)) throw new StudyError('CONFIG', 'Invalid study profile')
		const snapshot = cloneJSONValue(normalizeStudyProfile(value))
		if (isStudyProfile(snapshot)) return snapshot
	} catch {
		throw new StudyError('CONFIG', 'Invalid or unreadable study profile')
	}
	throw new StudyError('CONFIG', 'Invalid study profile snapshot')
}

/**
 * Parses a rubric into an independent frozen validated snapshot.
 * @param value - The unknown grading declaration
 * @returns The owned rubric and assertion inputs
 * @throws StudyError - Thrown when configuration is invalid or cannot be owned
 * @example
 * ```ts
 * parseStudyRubric(configuration)
 * ```
 */
export function parseStudyRubric(value: unknown): StudyRubric {
	return parseStudyContract(value, {
		code: 'CONFIG',
		noun: 'study rubric',
		contract: studyRubricContract,
		scan: scanStudyRubricFaults,
	})
}

/**
 * Parses grading into an independent frozen validated evidence snapshot.
 * @param value - The unknown grading evidence
 * @returns The owned grading identity and judgments
 * @throws StudyError - Thrown when evidence is invalid or cannot be owned
 * @example
 * ```ts
 * parseStudyAssessment(evidence)
 * ```
 */
export function parseStudyAssessment(value: unknown): StudyAssessment {
	try {
		if (!isStudyAssessment(value)) throw new StudyError('EVIDENCE', 'Invalid study grading')
		const { labels, packet, unselected, ...required } = value
		const snapshot = cloneJSONValue({
			...required,
			...(labels === undefined ? {} : { labels }),
			...(packet === undefined ? {} : { packet }),
			...(unselected === undefined ? {} : { unselected }),
		})
		if (isStudyAssessment(snapshot)) return snapshot
	} catch {
		throw new StudyError('EVIDENCE', 'Invalid or unreadable study grading')
	}
	throw new StudyError('EVIDENCE', 'Invalid study grading snapshot')
}

/**
 * Parses semantic labels into an independent frozen validated evidence snapshot.
 * @param value - The unknown imported labels
 * @returns The owned packet provenance, usage and judgments
 * @throws StudyError - Thrown when evidence is invalid or cannot be owned
 * @example
 * ```ts
 * parseStudyLabels(evidence)
 * ```
 */
export function parseStudyLabels(value: unknown): StudyLabels {
	// Labels written in memory can hold an undefined reading, which has no JSON form to own.
	const normalized = attempt(() =>
		isRecord(value) && matchesStudyKeys(value, [], Object.keys(value)) && isArray(value.usage)
			? {
					...value,
					usage: Array.from(value.usage, (entry) =>
						isRecord(entry) && matchesStudyKeys(entry, [], Object.keys(entry))
							? omitStudyAbsent(entry)
							: entry,
					),
				}
			: value,
	)
	if (!normalized.success) throw new StudyError('EVIDENCE', 'Invalid or unreadable study labels')
	return parseStudyContract(normalized.value, {
		code: 'EVIDENCE',
		noun: 'study labels',
		contract: studyLabelsContract,
		scan: scanStudyLabelsFaults,
	})
}

/**
 * Parses a grader's returned judgments, checking each element with the hand guard and naming a refused one's fields by the contract.
 * @param value - The unknown returned list
 * @returns The list, each element a judgment
 * @throws StudyError - Thrown with `FAULT` naming the refused element's fields
 * @example
 * ```ts
 * parseStudyJudgments([]) // []
 * ```
 */
export function parseStudyJudgments(value: unknown): readonly StudyJudgment[] {
	if (!isArray(value))
		throw new StudyError('FAULT', 'Grader returned invalid judgments: value: expected array')
	const faults = attempt(() =>
		value.flatMap((entry, index) => {
			if (isStudyJudgment(entry)) return []
			const found = attempt(() =>
				studyJudgmentContract
					.audit(entry)
					.map(
						(fault) => `${String(index)}: ${describeFaults([fault], studyJudgmentContract.schema)}`,
					),
			)
			if (!found.success) return [`${String(index)}: unreadable`]
			return found.value.length > 0 || !studyJudgmentContract.is(entry)
				? found.value
				: scanStudyJudgmentFaults(entry, String(index))
		}),
	)
	if (!faults.success)
		throw new StudyError('FAULT', 'Grader returned invalid judgments: unreadable')
	if (faults.value.length > 0)
		throw new StudyError('FAULT', `Grader returned invalid judgments: ${faults.value.join('; ')}`)
	return value.filter(isStudyJudgment)
}
