import type { StudyLabelLane, StudyLabelPool } from './types.js'
import { parseStudyContract } from '@src/core'
import { studyLabelAnswersContract, studyLabelPoolContract } from './contracts.js'

/**
 * Parses one labeler's returned rows into an owned frozen lane.
 * @param value - The unknown answer, in the shape `studyLabelAnswersContract.schema` publishes
 * @param labeler - The accountable name the lane carries
 * @returns The labeler and its rows
 * @throws StudyError - Thrown with `EVIDENCE` naming each refused field's path
 * @example
 * ```ts
 * parseStudyLabelLane({ rows: [{ row: 1, verdict: 'unknown', reason: 'No evidence' }] }, 'first')
 * ```
 */
export function parseStudyLabelLane(value: unknown, labeler: string): StudyLabelLane {
	const { rows } = parseStudyContract(value, {
		code: 'EVIDENCE',
		noun: 'study label answers',
		contract: studyLabelAnswersContract,
		scan: () => [],
	})
	return { labeler, rows }
}

/**
 * Parses a pool a consumer kept between stages into an owned frozen pool.
 * @param value - The unknown pool
 * @returns The pool
 * @throws StudyError - Thrown with `EVIDENCE` naming each refused field's path
 * @example
 * ```ts
 * parseStudyLabelPool({ requests: [], map: { links: [], checks: [] } })
 * ```
 */
export function parseStudyLabelPool(value: unknown): StudyLabelPool {
	return parseStudyContract(value, {
		code: 'EVIDENCE',
		noun: 'study label pool',
		contract: studyLabelPoolContract,
		scan: () => [],
	})
}
