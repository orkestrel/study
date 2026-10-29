import type {
	StudyDefinition,
	StudyAssessment,
	StudyLabels,
	StudyProfile,
	StudyRubric,
	StudyScenario,
} from './types.js'
import { cloneJSONValue, isFiniteNumber } from '@orkestrel/contract'
import { StudyError } from './errors.js'
import { normalizeStudyProfile } from './helpers.js'
import {
	isStudyDefinition,
	isStudyAssessment,
	isStudyLabels,
	isStudyProfile,
	isStudyRubric,
	isStudyScenario,
} from './validators.js'

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
	try {
		if (!isStudyRubric(value)) throw new StudyError('CONFIG', 'Invalid study rubric')
		const snapshot = cloneJSONValue(value)
		if (isStudyRubric(snapshot)) return snapshot
	} catch {
		throw new StudyError('CONFIG', 'Invalid or unreadable study rubric')
	}
	throw new StudyError('CONFIG', 'Invalid study rubric snapshot')
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
		const { labels, packet, ...required } = value
		const snapshot = cloneJSONValue({
			...required,
			...(labels === undefined ? {} : { labels }),
			...(packet === undefined ? {} : { packet }),
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
	try {
		if (!isStudyLabels(value)) throw new StudyError('EVIDENCE', 'Invalid study labels')
		const snapshot = cloneJSONValue({
			...value,
			usage: value.usage.map(({ tokens, bytes, ...usage }) => ({
				...usage,
				...(tokens === undefined ? {} : { tokens }),
				...(bytes === undefined ? {} : { bytes }),
			})),
		})
		if (isStudyLabels(snapshot)) return snapshot
	} catch {
		throw new StudyError('EVIDENCE', 'Invalid or unreadable study labels')
	}
	throw new StudyError('EVIDENCE', 'Invalid study labels snapshot')
}
