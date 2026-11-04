import type { StudyLabelLane, StudyLabelPool } from './types.js'
import { canonicalStringify } from '@orkestrel/contract'
import { parseStudyContract } from '@src/core'
import { studyLabelAnswersContract, studyLabelPoolContract } from './contracts.js'

/**
 * Parses one labeler's returned rows into an owned frozen lane.
 * @param value - The unknown answer, in the shape `studyLabelAnswersContract.schema` publishes
 * @param origin - The accountable name and method the lane carries
 * @returns The labeler, its method, and its rows
 * @throws StudyError - Thrown with `EVIDENCE` naming each refused field's path
 * @example
 * ```ts
 * parseStudyLabelLane({ rows: [{ row: 1, verdict: 'unknown', reason: 'No evidence' }] }, { labeler: 'first', method: 'model' })
 * ```
 */
export function parseStudyLabelLane(
	value: unknown,
	origin: Pick<StudyLabelLane, 'labeler' | 'method'>,
): StudyLabelLane {
	const { rows } = parseStudyContract(value, {
		code: 'EVIDENCE',
		noun: 'study label answers',
		contract: studyLabelAnswersContract,
		scan: () => [],
	})
	return { labeler: origin.labeler, method: origin.method, rows }
}

/**
 * Parses a pool a consumer kept between stages into an owned frozen pool.
 * @param value - The unknown pool
 * @returns The pool
 * @throws StudyError - Thrown with `EVIDENCE` naming each refused field's path, or a pair of one packet that repeats
 * @example
 * ```ts
 * parseStudyLabelPool({ requests: [], map: { links: [], checks: [] } }).requests // []
 * ```
 */
export function parseStudyLabelPool(value: unknown): StudyLabelPool {
	return parseStudyContract(value, {
		code: 'EVIDENCE',
		noun: 'study label pool',
		contract: studyLabelPoolContract,
		scan: ({ map }) => {
			const pairs = map.links.map((link) =>
				canonicalStringify([link.packet, link.trial, link.criterion]),
			)
			return pairs.flatMap((pair, index) =>
				pairs.indexOf(pair) === index ? [] : [`map.links.${String(index)}: repeats its pair`],
			)
		},
	})
}
