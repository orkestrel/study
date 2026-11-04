import type {
	StudyLabelAgreement,
	StudyLabelAnswer,
	StudyLabelBatch,
	StudyLabelMap,
	StudyLabelReceipt,
} from './types.js'
import { STUDY_VERDICTS } from '@src/core'

/**
 * Renders a request's rows as JSON-encoded data under the instruction.
 * @param request - The rows one labeler answers
 * @param instruction - The fixed instruction
 * @param receipts - One goal and arm's public evidence rows, when the consumer shows them
 * @returns The prompt, each row and receipt on its own line
 * @example
 * ```ts
 * buildStudyLabelPrompt({ rows: [] }, 'Judge each row.') // 'Judge each row.\n\nRows, one JSON value per line:'
 * ```
 */
export function buildStudyLabelPrompt(
	request: StudyLabelBatch,
	instruction: string,
	receipts?: readonly StudyLabelReceipt[],
): string {
	return [
		instruction.trim(),
		'',
		'Rows, one JSON value per line:',
		...request.rows.map((row) => JSON.stringify(row)),
		...(receipts === undefined
			? []
			: [
					'',
					'Evidence the run recorded for these rows, one JSON value per line:',
					...receipts.map((receipt) => JSON.stringify(receipt)),
				]),
	].join('\n')
}

/**
 * Collects a labeler's answered rows by row number, leaving out a blank reason, which the labels contract refuses.
 * @param rows - The rows the labeler returned
 * @returns Each usable answer under its row
 * @example
 * ```ts
 * collectStudyLabelAnswers([{ row: 1, verdict: 'unknown', reason: ' ' }]).size // 0
 * ```
 */
export function collectStudyLabelAnswers(
	rows: readonly StudyLabelAnswer[],
): ReadonlyMap<number, StudyLabelAnswer> {
	return new Map(
		rows
			.filter((entry) => entry.reason.trim().length > 0)
			.map((entry): readonly [number, StudyLabelAnswer] => [entry.row, entry]),
	)
}

/**
 * Compares two lanes per class over the rows both answered, with controls aside.
 * @param left - The first lane's rows
 * @param right - The second lane's rows
 * @param map - The pool's map
 * @returns The agreement of each class that holds a shared row, in the map's first-seen class order
 * @example
 * ```ts
 * compareStudyLabels([], [], { links: [], checks: [] }) // []
 * ```
 */
export function compareStudyLabels(
	left: readonly StudyLabelAnswer[],
	right: readonly StudyLabelAnswer[],
	map: StudyLabelMap,
): readonly StudyLabelAgreement[] {
	const lefts = collectStudyLabelAnswers(left)
	const rights = collectStudyLabelAnswers(right)
	return [...new Set(map.links.map((link) => link.class))].flatMap((entry) => {
		const pairs = map.links
			.filter((link) => link.class === entry)
			.flatMap((link) => {
				const one = lefts.get(link.row)?.verdict
				const two = rights.get(link.row)?.verdict
				return one === undefined || two === undefined ? [] : [{ one, two }]
			})
		if (pairs.length === 0) return []
		const count = pairs.length
		const agreement = pairs.filter((pair) => pair.one === pair.two).length / count
		const chance = STUDY_VERDICTS.reduce(
			(sum, verdict) =>
				sum +
				(pairs.filter((pair) => pair.one === verdict).length / count) *
					(pairs.filter((pair) => pair.two === verdict).length / count),
			0,
		)
		const either = pairs.filter((pair) => pair.one === 'achieved' || pair.two === 'achieved')
		const both = either.filter((pair) => pair.one === pair.two)
		return [
			{
				class: entry,
				count,
				agreement,
				kappa: chance === 1 ? undefined : (agreement - chance) / (1 - chance),
				overlap: either.length === 0 ? undefined : both.length / either.length,
			},
		]
	})
}
