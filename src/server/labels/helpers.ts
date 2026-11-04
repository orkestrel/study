import type { StudyJudgment, StudyLabels } from '@src/core'
import type {
	StudyLabelAgreement,
	StudyLabelAnswer,
	StudyLabelImport,
	StudyLabelImportOptions,
	StudyLabelLane,
	StudyLabelMap,
	StudyLabelMember,
	StudyLabelPartitionFunction,
	StudyLabelPool,
	StudyLabelPoolOptions,
	StudyLabelReceipt,
	StudyLabelBatch,
	StudyLabelSeat,
	StudyLabelSegment,
} from './types.js'
import { StudyError } from '@src/core'
import { decodeStudyJSON, hashStudyBytes } from '../helpers.js'
import { STUDY_LABEL_DISPUTE } from './constants.js'
import { isStudyLabelMapping, isStudyLabelPacket } from './validators.js'

/**
 * Computes the rank that orders one pooled key under one order.
 * @param order - The order the rank moves with
 * @param key - The pooled key
 * @returns The rank's digest
 * @example
 * ```ts
 * computeStudyLabelRank('first', 'control/0') === computeStudyLabelRank('first', 'control/0') // true
 * ```
 */
export function computeStudyLabelRank(order: string, key: string): string {
	return hashStudyBytes(`${order}\n${key}`)
}

/**
 * Collects a segment's packet entries with their identities, refusing a mapping that does not cover its packet.
 * @param segment - The segment's retained bytes
 * @param partition - Reads each source pair's goal and class
 * @returns Each entry's group, row text, and link
 * @throws StudyError - Thrown with `EVIDENCE` when the bytes are malformed, the mapping names another result or does not cover the packet, or a pair holds no partition
 * @example
 * ```ts
 * collectStudyLabelMembers(segment, ({ criterion }) => ({ goal: criterion, class: 'quality' }))
 * ```
 */
export function collectStudyLabelMembers(
	segment: StudyLabelSegment,
	partition: StudyLabelPartitionFunction,
): readonly StudyLabelMember[] {
	const packet = decodeStudyJSON(segment.packet)
	const mapping = decodeStudyJSON(segment.mapping)
	if (!isStudyLabelPacket(packet))
		throw new StudyError('EVIDENCE', `The packet of ${segment.result} is malformed`)
	if (!isStudyLabelMapping(mapping))
		throw new StudyError('EVIDENCE', `The mapping of ${segment.result} is malformed`)
	if (mapping.result !== segment.result)
		throw new StudyError(
			'EVIDENCE',
			`The mapping names ${mapping.result}, and its segment holds ${segment.result}`,
		)
	if (mapping.entries.length !== packet.entries.length)
		throw new StudyError('EVIDENCE', `The mapping of ${segment.result} does not cover its packet`)
	const digest = hashStudyBytes(segment.packet)
	return packet.entries.map((entry): StudyLabelMember => {
		const source = mapping.entries.find(
			(link) => link.trial === entry.trial && link.criterion === entry.criterion,
		)?.source
		if (source === undefined)
			throw new StudyError('EVIDENCE', `The mapping of ${segment.result} does not cover its packet`)
		const parts = partition(source)
		if (parts === undefined)
			throw new StudyError(
				'EVIDENCE',
				`Criterion ${source.criterion} holds no goal and class to pool under`,
			)
		return {
			group: `${segment.arm}/${segment.result}/${source.trial}/${parts.goal}`,
			text: {
				input: entry.input,
				...(entry.product === undefined ? {} : { product: entry.product }),
				assertion: entry.assertion,
			},
			link: {
				packet: digest,
				result: segment.result,
				arm: segment.arm,
				trial: entry.trial,
				criterion: entry.criterion,
				source,
				goal: parts.goal,
				class: parts.class,
			},
		}
	})
}

/**
 * Pools sealed packets into one request per goal and arm under neutral row numbers, every identity in a separate map.
 * @param segments - Each segment's retained packet and mapping bytes
 * @param options - The order, the controls, and the partition of each source pair
 * @returns The blind requests and their map
 * @throws StudyError - Thrown with `EVIDENCE` when a control holds no request to join or a segment refuses per `collectStudyLabelMembers`
 * @example
 * ```ts
 * const { requests, map } = buildStudyLabelPool([segment], { order: 'gate', controls: [], partition })
 * ```
 */
export function buildStudyLabelPool(
	segments: readonly StudyLabelSegment[],
	options: StudyLabelPoolOptions,
): StudyLabelPool {
	const { order, controls, partition } = options
	const members = segments.flatMap((segment) => collectStudyLabelMembers(segment, partition))
	const groups = [...new Set(members.map((member) => member.group))]
		.map((group) => ({ group, rank: computeStudyLabelRank(order, group) }))
		.toSorted((left, right) => (left.rank < right.rank ? -1 : 1))
		.map((entry) => entry.group)
	if (groups.length === 0 && controls.length > 0)
		throw new StudyError('EVIDENCE', 'A control holds no request to join')
	const seats: readonly StudyLabelSeat[] = [
		...members.map((member) => ({
			rank: computeStudyLabelRank(
				order,
				`${member.group}/${member.link.trial}/${member.link.criterion}`,
			),
			request: groups.indexOf(member.group),
			text: member.text,
			link: member.link,
		})),
		...controls.map((control, index) => {
			const rank = computeStudyLabelRank(order, `control/${String(index)}`)
			return {
				rank,
				request: Number.parseInt(rank.slice(0, 8), 16) % groups.length,
				text: { input: control.input, product: control.product, assertion: control.assertion },
				verdict: control.verdict,
			}
		}),
	]
	const numbered = seats
		.toSorted((left, right) =>
			left.request === right.request
				? left.rank < right.rank
					? -1
					: 1
				: left.request - right.request,
		)
		.map((seat, index) => ({ ...seat, row: index + 1 }))
	return {
		requests: groups.map((_, request) => ({
			rows: numbered
				.filter((seat) => seat.request === request)
				.map((seat) => ({ row: seat.row, ...seat.text })),
		})),
		map: {
			links: numbered.flatMap((seat) =>
				seat.link === undefined ? [] : [{ ...seat.link, row: seat.row, request: seat.request }],
			),
			checks: numbered.flatMap((seat) =>
				seat.verdict === undefined
					? []
					: [{ row: seat.row, request: seat.request, verdict: seat.verdict }],
			),
		},
	}
}

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
 * Refuses a lane's row outside the map or repeated.
 * @param map - The pool's map
 * @param lanes - Every lane, the settling one included
 * @returns Nothing when every row belongs to the map once
 * @throws StudyError - Thrown with `EVIDENCE` naming the row
 * @example
 * ```ts
 * validateStudyLabelLanes(map, [{ labeler: 'first', rows: [] }])
 * ```
 */
export function validateStudyLabelLanes(
	map: StudyLabelMap,
	lanes: readonly StudyLabelLane[],
): void {
	const known = new Set([...map.links, ...map.checks].map((entry) => entry.row))
	for (const lane of lanes) {
		const foreign = lane.rows.find((entry) => !known.has(entry.row))
		if (foreign !== undefined)
			throw new StudyError('EVIDENCE', `Row ${String(foreign.row)} is outside the map`)
		const seen = new Set(lane.rows.map((entry) => entry.row))
		if (seen.size !== lane.rows.length) {
			const repeated = lane.rows.find(
				(entry, index) => lane.rows.findIndex((other) => other.row === entry.row) !== index,
			)
			throw new StudyError('EVIDENCE', `A lane repeats row ${String(repeated?.row)}`)
		}
	}
}

/**
 * Builds one labels file per packet from each lane's rows, settling agreement, dispute, and a third lane's answer.
 * @param map - The pool's map
 * @param lanes - One or two labeling lanes
 * @param options - The file fields and the lane that settles disputes
 * @returns The files, with the omitted rows, the disputes, and each lane's missed controls
 * @throws StudyError - Thrown with `EVIDENCE` on no lane or more than two, a row outside the map, a repeated row, or a third-lane row holding no dispute
 * @example
 * ```ts
 * buildStudyLabels(map, [{ labeler: 'first', rows }], { created, version: '1' })
 * ```
 */
export function buildStudyLabels(
	map: StudyLabelMap,
	lanes: readonly StudyLabelLane[],
	options: StudyLabelImportOptions,
): StudyLabelImport {
	if (lanes.length === 0 || lanes.length > 2)
		throw new StudyError(
			'EVIDENCE',
			`An import takes one or two lanes, and it holds ${String(lanes.length)}`,
		)
	const every = [...lanes, ...(options.third === undefined ? [] : [options.third])]
	validateStudyLabelLanes(map, every)
	const answers = lanes.map((lane) => collectStudyLabelAnswers(lane.rows))
	const disputes = map.links
		.filter((link) => {
			const held = answers.map((entry) => entry.get(link.row))
			return !held.includes(undefined) && new Set(held.map((entry) => entry?.verdict)).size > 1
		})
		.map((link) => link.row)
	const late = options.third?.rows.find((entry) => !disputes.includes(entry.row))
	if (late !== undefined)
		throw new StudyError('EVIDENCE', `Row ${String(late.row)} holds no dispute to settle`)
	const third = collectStudyLabelAnswers(options.third?.rows ?? [])
	const settled = map.links.flatMap((link) => {
		const held = answers.map((entry) => entry.get(link.row))
		const [first] = held
		if (first === undefined || held.includes(undefined)) return []
		const answer: Pick<StudyLabelAnswer, 'verdict' | 'reason'> = disputes.includes(link.row)
			? (third.get(link.row) ?? { verdict: 'unknown', reason: STUDY_LABEL_DISPUTE })
			: first
		const judgment: StudyJudgment = {
			trial: link.trial,
			criterion: link.criterion,
			verdict: answer.verdict,
			method: 'model',
			reason: answer.reason,
			references: answer.verdict === 'unknown' ? [] : [link.packet],
		}
		return [{ packet: link.packet, judgment }]
	})
	const names = every.map((lane) => lane.labeler).join('+')
	return {
		labels: [...new Set(map.links.map((link) => link.packet))].map((packet): StudyLabels => ({
			packet,
			labeler: lanes.length === 1 ? `${names} single-labeled` : names,
			version: options.version,
			created: options.created,
			usage: [],
			judgments: settled.filter((entry) => entry.packet === packet).map((entry) => entry.judgment),
		})),
		omitted: answers.flatMap((entry) => map.links.filter((link) => !entry.has(link.row))).length,
		disputes,
		missed: answers.map(
			(entry) =>
				map.checks.filter((check) => entry.get(check.row)?.verdict !== check.verdict).length,
		),
	}
}

/**
 * Compares two lanes per class over the rows both answered, with controls aside.
 * @param left - The first lane's rows
 * @param right - The second lane's rows
 * @param map - The pool's map
 * @returns The agreement of each class that holds a shared row, in the map's first-seen class order
 * @example
 * ```ts
 * compareStudyLabels(first, second, map) // [{ class: 'quality', count: 4, agreement: 0.75, kappa: 0.5, overlap: 0.5 }]
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
		const chance = (['achieved', 'unsuccessful', 'unknown'] as const).reduce(
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
