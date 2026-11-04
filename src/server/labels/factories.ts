import type { StudyJudgment } from '@src/core'
import type {
	StudyLabelAnswer,
	StudyLabelImport,
	StudyLabelImportOptions,
	StudyLabelLane,
	StudyLabelMap,
	StudyLabelPool,
	StudyLabelPoolOptions,
	StudyLabelRow,
	StudyLabelSegment,
} from './types.js'
import { StudyError, parseStudyLabels } from '@src/core'
import { decodeStudyJSON, hashStudyBytes } from '../helpers.js'
import { STUDY_LABEL_DISPUTE } from './constants.js'
import { collectStudyLabelAnswers } from './helpers.js'
import { parseStudyLabelPool } from './parsers.js'
import { isStudyLabelMapping, isStudyLabelPacket } from './validators.js'

/**
 * Pools sealed packets into one request per goal and arm under neutral row numbers, every identity in a separate map.
 * @param segments - Each segment's retained packet and mapping bytes
 * @param options - The order, the controls, and the partition of each source pair
 * @returns The blind requests and their map, through the pool's contract
 * @throws StudyError - Thrown with `EVIDENCE` when the bytes are malformed, a mapping names another result or does not cover its packet, a pair holds no partition, a control holds no request to join, or the pool breaks its contract
 * @example
 * ```ts
 * createStudyLabelPool([], { order: 'gate', controls: [], partition: () => undefined }).requests // []
 * ```
 */
export function createStudyLabelPool(
	segments: readonly StudyLabelSegment[],
	options: StudyLabelPoolOptions,
): StudyLabelPool {
	const { order, controls, partition } = options
	const members = segments.flatMap((segment) => {
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
		return packet.entries.map((entry) => {
			const source = mapping.entries.find(
				(link) => link.trial === entry.trial && link.criterion === entry.criterion,
			)?.source
			if (source === undefined)
				throw new StudyError(
					'EVIDENCE',
					`The mapping of ${segment.result} does not cover its packet`,
				)
			const parts = partition(source)
			if (parts === undefined)
				throw new StudyError(
					'EVIDENCE',
					`Criterion ${source.criterion} holds no goal and class to pool under`,
				)
			const text: Omit<StudyLabelRow, 'row'> = {
				input: entry.input,
				...(entry.product === undefined ? {} : { product: entry.product }),
				assertion: entry.assertion,
			}
			return {
				group: `${segment.arm}/${segment.result}/${source.trial}/${parts.goal}`,
				text,
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
	})
	const groups = [...new Set(members.map((member) => member.group))]
		.map((group) => ({ group, rank: hashStudyBytes(`${order}\n${group}`) }))
		.toSorted((left, right) => (left.rank < right.rank ? -1 : 1))
		.map((entry) => entry.group)
	if (groups.length === 0 && controls.length > 0)
		throw new StudyError('EVIDENCE', 'A control holds no request to join')
	const seats = [
		...members.map((member) => ({
			rank: hashStudyBytes(
				`${order}\n${member.group}/${member.link.trial}/${member.link.criterion}`,
			),
			request: groups.indexOf(member.group),
			text: member.text,
			link: member.link,
			verdict: undefined,
		})),
		...controls.map((control, index) => {
			const rank = hashStudyBytes(`${order}\ncontrol/${String(index)}`)
			const text: Omit<StudyLabelRow, 'row'> = {
				input: control.input,
				product: control.product,
				assertion: control.assertion,
			}
			return {
				rank,
				request: Number.parseInt(rank.slice(0, 8), 16) % groups.length,
				text,
				link: undefined,
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
	return parseStudyLabelPool({
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
	})
}

/**
 * Creates one labels file per packet from each lane's rows, settling agreement, dispute, and a third lane's answer.
 * @remarks
 * A row reaches a file only when every labeling lane answered it. A missing or blank answer refuses
 * unless `options.partial` is `true`, so a gate that means to read a partial pool says so. Each
 * judgment carries the `method` of the lane that settled it.
 * @param map - The pool's map
 * @param lanes - One or two labeling lanes
 * @param options - The file fields, the lane that settles disputes, and whether a missing answer is admitted
 * @returns The files, each through the labels contract, with the omitted rows, the disputes, and each lane's missed controls
 * @throws StudyError - Thrown with `EVIDENCE` on no lane or more than two, a row outside the map, a repeated row, a third-lane row holding no dispute, a missing answer without `partial`, or a file that breaks its contract
 * @example
 * ```ts
 * createStudyLabels({ links: [], checks: [] }, [{ labeler: 'first', method: 'model', rows: [] }], { created: '2026-11-02T00:00:00.000Z', version: '1' }).labels // []
 * ```
 */
export function createStudyLabels(
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
	if (every.some((lane) => lane.labeler.trim().length === 0))
		throw new StudyError('EVIDENCE', 'A lane names no labeler')
	const known = new Set([...map.links, ...map.checks].map((entry) => entry.row))
	for (const lane of every) {
		const foreign = lane.rows.find((entry) => !known.has(entry.row))
		if (foreign !== undefined)
			throw new StudyError('EVIDENCE', `Row ${String(foreign.row)} is outside the map`)
		const repeated = lane.rows.find(
			(entry, index) => lane.rows.findIndex((other) => other.row === entry.row) !== index,
		)
		if (repeated !== undefined)
			throw new StudyError('EVIDENCE', `A lane repeats row ${String(repeated.row)}`)
	}
	const answers = lanes.map((lane) => ({ lane, rows: collectStudyLabelAnswers(lane.rows) }))
	const unanswered = answers.flatMap(({ lane, rows }) =>
		map.links
			.filter((link) => !rows.has(link.row))
			.map((link) => `${lane.labeler} row ${String(link.row)}`),
	)
	if (unanswered.length > 0 && options.partial !== true)
		throw new StudyError(
			'EVIDENCE',
			`Labels leave ${String(unanswered.length)} answers missing: ${unanswered.slice(0, 8).join(', ')}; pass partial to admit them`,
		)
	const disputes = map.links
		.filter((link) => {
			const held = answers.map(({ rows }) => rows.get(link.row))
			return !held.includes(undefined) && new Set(held.map((entry) => entry?.verdict)).size > 1
		})
		.map((link) => link.row)
	const late = options.third?.rows.find((entry) => !disputes.includes(entry.row))
	if (late !== undefined)
		throw new StudyError('EVIDENCE', `Row ${String(late.row)} holds no dispute to settle`)
	const third = collectStudyLabelAnswers(options.third?.rows ?? [])
	const settled = map.links.flatMap((link) => {
		const held = answers.map(({ rows }) => rows.get(link.row))
		const [first] = held
		const lead = answers[0]?.lane
		if (first === undefined || lead === undefined || held.includes(undefined)) return []
		const decided = third.get(link.row)
		const answer: Pick<StudyLabelAnswer, 'verdict' | 'reason'> = disputes.includes(link.row)
			? (decided ?? { verdict: 'unknown', reason: STUDY_LABEL_DISPUTE })
			: first
		const judgment: StudyJudgment = {
			trial: link.trial,
			criterion: link.criterion,
			verdict: answer.verdict,
			method: decided === undefined ? lead.method : (options.third?.method ?? lead.method),
			reason: answer.reason,
			references: answer.verdict === 'unknown' ? [] : [link.packet],
		}
		return [{ packet: link.packet, judgment }]
	})
	const names = every.map((lane) => lane.labeler).join('+')
	return {
		labels: [...new Set(map.links.map((link) => link.packet))].map((packet) =>
			parseStudyLabels({
				packet,
				labeler: lanes.length === 1 ? `${names} single-labeled` : names,
				version: options.version,
				created: options.created,
				usage: [],
				judgments: settled
					.filter((entry) => entry.packet === packet)
					.map((entry) => entry.judgment),
			}),
		),
		omitted: unanswered.length,
		disputes,
		missed: answers.map(
			({ rows }) =>
				map.checks.filter((check) => rows.get(check.row)?.verdict !== check.verdict).length,
		),
	}
}
