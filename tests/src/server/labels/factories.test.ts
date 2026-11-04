import type { StudyLabelAnswer, StudyLabelMap } from '../../../../src/server/labels/types.js'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { requireValue } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { parseStudyLabels } from '../../../../src/core/parsers.js'
import { StudyError } from '../../../../src/core/errors.js'
import { hashStudyBytes } from '../../../../src/server/helpers.js'
import { STUDY_LABEL_DISPUTE } from '../../../../src/server/labels/constants.js'
import { createStudyLabelPool, createStudyLabels } from '../../../../src/server/labels/factories.js'
import { translateStudyPacketLabels } from '../../../../src/server/stores/helpers.js'
import {
	STUDY_LABEL_CONTROLS,
	STUDY_LABEL_CREATED,
	buildStudyLabelMap,
	createStudyLabelFixture,
	partitionStudyLabel,
} from '../../../setupServer.js'

describe('createStudyLabelPool', () => {
	it('pools goals and arms under neutral rows with every identity in the map alone', async () => {
		const scratch = createScratch()
		try {
			const fixture = await createStudyLabelFixture(scratch)
			const { requests, map } = createStudyLabelPool([fixture.segment], {
				order: 'fixture order',
				controls: STUDY_LABEL_CONTROLS,
				partition: partitionStudyLabel,
			})
			const shown = requests.flatMap((request) => request.rows)
			expect(requests).toHaveLength(fixture.result.manifest.schedule.length)
			expect(shown.map((row) => row.row)).toEqual(shown.map((_, index) => index + 1))
			const text = JSON.stringify(requests)
			// A row shows only what a labeler reads, so a control's authored verdict stays in the map.
			expect(
				shown.every((row) =>
					Object.keys(row).every((key) => ['row', 'input', 'product', 'assertion'].includes(key)),
				),
			).toBe(true)
			expect(text).not.toContain('"verdict"')
			expect(text).not.toMatch(/[tc]-[a-f0-9]{64}/)
			expect(text).not.toContain(fixture.result.seal.id)
			expect(text).not.toContain(hashStudyBytes(fixture.segment.packet))
			expect(text).not.toContain('"arm"')
			for (const trial of fixture.result.manifest.schedule) expect(text).not.toContain(trial.id)
			expect(map.links).toHaveLength(shown.length - STUDY_LABEL_CONTROLS.length)
			expect(
				new Set(map.links.map((link) => `${link.source.trial}/${link.source.criterion}`)).size,
			).toBe(map.links.length)
			expect(
				map.links.every(
					(link) =>
						link.packet === hashStudyBytes(fixture.segment.packet) &&
						link.result === fixture.result.seal.id &&
						link.arm === 'full' &&
						link.goal === 'read' &&
						link.source.criterion.endsWith(`-${link.class}`) &&
						/^t-[a-f0-9]{64}$/.test(link.trial) &&
						/^c-[a-f0-9]{64}$/.test(link.criterion),
				),
			).toBe(true)
			for (const [index] of requests.entries()) {
				expect(
					new Set(
						map.links.filter((link) => link.request === index).map((link) => link.source.trial),
					).size,
				).toBeLessThanOrEqual(1)
			}
			expect(map.checks.map((check) => check.verdict).toSorted()).toEqual([
				'achieved',
				'unsuccessful',
			])
			expect(
				map.checks.every((check) => {
					const hosted = requests[check.request]?.rows.map((row) => row.row) ?? []
					return hosted.includes(check.row) && !map.links.some((link) => link.row === check.row)
				}),
			).toBe(true)
			expect(text).toContain('blue lantern')
		} finally {
			scratch.destroy()
		}
	})

	it('repeats for one order and moves with another', async () => {
		const scratch = createScratch()
		try {
			const { segment } = await createStudyLabelFixture(scratch)
			const pools = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].map((order) =>
				createStudyLabelPool([segment], {
					order,
					controls: STUDY_LABEL_CONTROLS,
					partition: partitionStudyLabel,
				}),
			)
			expect(
				createStudyLabelPool([segment], {
					order: 'first',
					controls: STUDY_LABEL_CONTROLS,
					partition: partitionStudyLabel,
				}),
			).toEqual(pools[0])
			expect(new Set(pools.map((pool) => JSON.stringify(pool.map.links))).size).toBeGreaterThan(1)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a mapping that does not cover its packet, by length and by entry', async () => {
		const scratch = createScratch()
		try {
			const { segment } = await createStudyLabelFixture(scratch)
			const options = { order: 'o', controls: [], partition: partitionStudyLabel }
			const mapping = parseJSON(new TextDecoder().decode(segment.mapping))
			if (!isRecord(mapping) || !Array.isArray(mapping.entries)) throw new Error('Missing mapping')
			const encoder = new TextEncoder()
			const empty = encoder.encode(JSON.stringify({ ...mapping, entries: [] }))
			const shorter = encoder.encode(
				JSON.stringify({ ...mapping, entries: mapping.entries.slice(1) }),
			)
			const longer = encoder.encode(
				JSON.stringify({ ...mapping, entries: [...mapping.entries, mapping.entries[0]] }),
			)
			const swapped = encoder.encode(
				JSON.stringify({
					...mapping,
					entries: mapping.entries.map((entry: unknown) =>
						isRecord(entry) ? { ...entry, trial: 't-other' } : entry,
					),
				}),
			)
			for (const bytes of [empty, shorter, longer, swapped]) {
				expect(() => createStudyLabelPool([{ ...segment, mapping: bytes }], options)).toThrow(
					expect.objectContaining({
						code: 'EVIDENCE',
						message: expect.stringContaining('does not cover its packet'),
					}),
				)
			}
			expect(() => createStudyLabelPool([{ ...segment, result: 'other-seal' }], options)).toThrow(
				/mapping names/,
			)
			expect(() =>
				createStudyLabelPool([{ ...segment, packet: encoder.encode('{}') }], options),
			).toThrow(/packet of .* is malformed/)
			expect(() =>
				createStudyLabelPool([{ ...segment, mapping: encoder.encode('{}') }], options),
			).toThrow(/mapping of .* is malformed/)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a pair the consumer holds no partition for and a control with no request to join', async () => {
		const scratch = createScratch()
		try {
			const { segment } = await createStudyLabelFixture(scratch)
			expect(() =>
				createStudyLabelPool([segment], { order: 'o', controls: [], partition: () => undefined }),
			).toThrow(/holds no goal and class/)
			expect(() =>
				createStudyLabelPool([], {
					order: 'o',
					controls: STUDY_LABEL_CONTROLS,
					partition: partitionStudyLabel,
				}),
			).toThrow(StudyError)
			expect(
				createStudyLabelPool([], { order: 'o', controls: [], partition: partitionStudyLabel }),
			).toEqual({ requests: [], map: { links: [], checks: [] } })
		} finally {
			scratch.destroy()
		}
	})

	it('leaves out the product of a goal that failed and groups by arm, result, trial, and goal', () => {
		const encoder = new TextEncoder()
		const source = { trial: 'trial-one', criterion: 'read-work' }
		const { requests, map } = createStudyLabelPool(
			[
				{
					result: 'seal',
					arm: 'full',
					packet: encoder.encode(
						JSON.stringify({
							entries: [{ trial: 't', criterion: 'c', input: 'Ask', assertion: { holds: true } }],
						}),
					),
					mapping: encoder.encode(
						JSON.stringify({ result: 'seal', entries: [{ trial: 't', criterion: 'c', source }] }),
					),
				},
			],
			{ order: 'o', controls: [], partition: partitionStudyLabel },
		)
		expect(requests[0]?.rows).toEqual([{ row: 1, input: 'Ask', assertion: { holds: true } }])
		expect(map.links[0]).toMatchObject({ goal: 'read', class: 'work', source, request: 0, row: 1 })
	})

	it('returns its pool through the contract, a repeated pair and a blank identity refused', () => {
		const encoder = new TextEncoder()
		const source = { trial: 'a', criterion: 'read-work' }
		const entry = { trial: 't', criterion: 'c', input: 1, assertion: 1 }
		const link = { trial: 't', criterion: 'c', source }
		const options = { order: 'o', controls: [], partition: partitionStudyLabel }
		expect(() =>
			createStudyLabelPool(
				[
					{
						result: 'seal',
						arm: 'full',
						packet: encoder.encode(JSON.stringify({ entries: [entry, entry] })),
						mapping: encoder.encode(JSON.stringify({ result: 'seal', entries: [link, link] })),
					},
				],
				options,
			),
		).toThrow(
			expect.objectContaining({
				code: 'EVIDENCE',
				message: expect.stringContaining('repeats its pair'),
			}),
		)
		expect(() =>
			createStudyLabelPool(
				[
					{
						result: '',
						arm: 'full',
						packet: encoder.encode(JSON.stringify({ entries: [entry] })),
						mapping: encoder.encode(JSON.stringify({ result: '', entries: [link] })),
					},
				],
				options,
			),
		).toThrow(/map\.links\.0\.result/)
	})
})

describe('createStudyLabels', () => {
	const options = { created: STUDY_LABEL_CREATED, version: 'fixture' }

	it('round trips each row to its own source pair through the packet translation', async () => {
		const scratch = createScratch()
		try {
			const fixture = await createStudyLabelFixture(scratch)
			const { requests, map } = createStudyLabelPool([fixture.segment], {
				order: 'round trip',
				controls: [],
				partition: partitionStudyLabel,
			})
			const rows = requests
				.flatMap((request) => request.rows)
				.map((row): StudyLabelAnswer => {
					const link = requireValue(map.links.find((entry) => entry.row === row.row))
					return {
						row: row.row,
						verdict: link.class === 'work' ? 'achieved' : 'unsuccessful',
						reason: `Quotes ${link.source.trial}/${link.source.criterion}`,
					}
				})
			const disputed = requireValue(map.links[0])
			const built = createStudyLabels(
				map,
				[
					{ labeler: 'first', method: 'model', rows },
					{
						labeler: 'second',
						method: 'model',
						rows: rows.map((answer) =>
							answer.row === disputed.row ? { ...answer, verdict: 'unknown' } : answer,
						),
					},
				],
				options,
			)
			expect(built.disputes).toEqual([disputed.row])
			expect(built.labels).toHaveLength(1)
			const translated = translateStudyPacketLabels(
				fixture.result,
				fixture.rubric,
				fixture.digest,
				parseStudyLabels(built.labels[0]),
			)
			expect(translated).toHaveLength(map.links.length)
			expect(
				translated.map(({ trial, criterion, verdict, reason }) => [
					trial,
					criterion,
					verdict,
					reason,
				]),
			).toEqual(
				map.links.map((link) =>
					link.row === disputed.row
						? [link.source.trial, link.source.criterion, 'unknown', STUDY_LABEL_DISPUTE]
						: [
								link.source.trial,
								link.source.criterion,
								link.class === 'work' ? 'achieved' : 'unsuccessful',
								`Quotes ${link.source.trial}/${link.source.criterion}`,
							],
				),
			)
		} finally {
			scratch.destroy()
		}
	})

	it('settles agreement, dispute, and references per verdict', () => {
		const map = buildStudyLabelMap(['work', 'work', 'work'])
		const { labels, disputes, omitted } = createStudyLabels(
			map,
			[
				{
					labeler: 'first',
					method: 'model',
					rows: [
						{ row: 1, verdict: 'achieved', reason: 'Left one' },
						{ row: 2, verdict: 'achieved', reason: 'Left two' },
						{ row: 3, verdict: 'unknown', reason: 'Left three' },
					],
				},
				{
					labeler: 'second',
					method: 'model',
					rows: [
						{ row: 1, verdict: 'unsuccessful', reason: 'Right one' },
						{ row: 2, verdict: 'achieved', reason: 'Right two' },
						{ row: 3, verdict: 'unknown', reason: 'Right three' },
					],
				},
			],
			options,
		)
		expect(disputes).toEqual([1])
		expect(omitted).toBe(0)
		expect(parseStudyLabels(labels[0])).toEqual({
			packet: 'a'.repeat(64),
			labeler: 'first+second',
			version: 'fixture',
			created: STUDY_LABEL_CREATED,
			usage: [],
			judgments: [
				{
					trial: 't-1',
					criterion: 'c-1',
					verdict: 'unknown',
					method: 'model',
					reason: STUDY_LABEL_DISPUTE,
					references: [],
				},
				{
					trial: 't-2',
					criterion: 'c-2',
					verdict: 'achieved',
					method: 'model',
					reason: 'Left two',
					references: ['a'.repeat(64)],
				},
				{
					trial: 't-3',
					criterion: 'c-3',
					verdict: 'unknown',
					method: 'model',
					reason: 'Left three',
					references: [],
				},
			],
		})
	})

	it('lets a third lane replace a dispute and only a dispute', () => {
		const map = buildStudyLabelMap(['work', 'work'])
		const left = [
			{ row: 1, verdict: 'achieved', reason: 'Left one' },
			{ row: 2, verdict: 'achieved', reason: 'Left two' },
		] as const
		const right = [
			{ row: 1, verdict: 'unsuccessful', reason: 'Right one' },
			{ row: 2, verdict: 'unsuccessful', reason: 'Right two' },
		] as const
		const { labels, disputes } = createStudyLabels(
			map,
			[
				{ labeler: 'first', method: 'model', rows: left },
				{ labeler: 'second', method: 'model', rows: right },
			],
			{
				...options,
				third: {
					labeler: 'third',
					method: 'model',
					rows: [
						{ row: 1, verdict: 'unsuccessful', reason: 'Third one' },
						{ row: 2, verdict: 'achieved', reason: '  ' },
					],
				},
			},
		)
		expect(disputes).toEqual([1, 2])
		expect(labels[0]?.labeler).toBe('first+second+third')
		expect(labels[0]?.judgments.map((entry) => [entry.verdict, entry.reason])).toEqual([
			['unsuccessful', 'Third one'],
			['unknown', STUDY_LABEL_DISPUTE],
		])
		expect(() =>
			createStudyLabels(
				map,
				[
					{ labeler: 'first', method: 'model', rows: left },
					{ labeler: 'second', method: 'model', rows: left },
				],
				{
					...options,
					third: {
						labeler: 'third',
						method: 'model',
						rows: [{ row: 1, verdict: 'achieved', reason: 'Late' }],
					},
				},
			),
		).toThrow(/no dispute/)
	})

	it('names a single lane and leaves an omitted or blank row absent', () => {
		const map = buildStudyLabelMap(['work', 'work', 'completion'])
		const single = createStudyLabels(
			map,
			[
				{
					labeler: 'first',
					method: 'model',
					rows: [
						{ row: 1, verdict: 'achieved', reason: 'One' },
						{ row: 2, verdict: 'unsuccessful', reason: ' \n' },
					],
				},
			],
			{ ...options, partial: true },
		)
		expect(single.labels[0]?.labeler).toBe('first single-labeled')
		expect(single.labels[0]?.judgments.map((entry) => entry.trial)).toEqual(['t-1'])
		expect(single.omitted).toBe(2)
		expect(parseStudyLabels(single.labels[0]).judgments).toHaveLength(1)
		const double = createStudyLabels(
			map,
			[
				{
					labeler: 'first',
					method: 'model',
					rows: [
						{ row: 1, verdict: 'achieved', reason: 'One' },
						{ row: 2, verdict: 'achieved', reason: 'Two' },
						{ row: 3, verdict: 'achieved', reason: 'Three' },
					],
				},
				{
					labeler: 'second',
					method: 'model',
					rows: [
						{ row: 1, verdict: 'achieved', reason: 'One' },
						{ row: 3, verdict: 'unknown', reason: '' },
					],
				},
			],
			{ ...options, partial: true },
		)
		expect(double.labels[0]?.judgments.map((entry) => entry.trial)).toEqual(['t-1'])
		expect(double.omitted).toBe(2)
		expect(double.disputes).toEqual([])
	})

	it('keeps a control out of the files and counts each lane that missed it', () => {
		const map: StudyLabelMap = {
			...buildStudyLabelMap(['work']),
			checks: [
				{ row: 2, request: 0, verdict: 'achieved' },
				{ row: 3, request: 0, verdict: 'unsuccessful' },
			],
		}
		const { labels, missed, omitted } = createStudyLabels(
			map,
			[
				{
					labeler: 'first',
					method: 'model',
					rows: [
						{ row: 1, verdict: 'achieved', reason: 'One' },
						{ row: 2, verdict: 'achieved', reason: 'Control' },
						{ row: 3, verdict: 'unsuccessful', reason: 'Control' },
					],
				},
				{
					labeler: 'second',
					method: 'model',
					rows: [
						{ row: 1, verdict: 'achieved', reason: 'One' },
						{ row: 2, verdict: 'unsuccessful', reason: 'Control' },
					],
				},
			],
			options,
		)
		expect(labels[0]?.judgments.map((entry) => entry.trial)).toEqual(['t-1'])
		expect(missed).toEqual([0, 2])
		expect(omitted).toBe(0)
	})

	it('writes one file per packet and refuses a repeated row or a wrong lane count', () => {
		const inert = buildStudyLabelMap(['work', 'work'])
		const map: StudyLabelMap = {
			...inert,
			links: inert.links.map((link) =>
				link.row === 2 ? { ...link, packet: 'b'.repeat(64) } : link,
			),
		}
		const rows = [
			{ row: 1, verdict: 'achieved', reason: 'One' },
			{ row: 2, verdict: 'unsuccessful', reason: 'Two' },
		] as const
		const { labels } = createStudyLabels(
			map,
			[{ labeler: 'first', method: 'model', rows }],
			options,
		)
		expect(labels.map((file) => [file.packet, file.judgments[0]?.references])).toEqual([
			['a'.repeat(64), ['a'.repeat(64)]],
			['b'.repeat(64), ['b'.repeat(64)]],
		])
		expect(() =>
			createStudyLabels(
				map,
				[{ labeler: 'first', method: 'model', rows: [...rows, ...rows] }],
				options,
			),
		).toThrow(/repeats/)
		expect(() => createStudyLabels(map, [], options)).toThrow(/lane/)
		expect(() =>
			createStudyLabels(
				map,
				[
					{ labeler: 'first', method: 'model', rows },
					{ labeler: 'second', method: 'model', rows },
					{ labeler: 'third', method: 'model', rows },
				],
				options,
			),
		).toThrow(/lane/)
	})

	it('refuses a missing answer unless the call admits a partial import', () => {
		const map = buildStudyLabelMap(['work', 'work'])
		const lane = { labeler: 'first', method: 'model', rows: [] } as const
		expect(() =>
			createStudyLabels(map, [lane], { created: STUDY_LABEL_CREATED, version: '1' }),
		).toThrow(
			expect.objectContaining({
				code: 'EVIDENCE',
				message: expect.stringContaining('2 answers missing: first row 1, first row 2'),
			}),
		)
		expect(
			createStudyLabels(map, [lane], { created: STUDY_LABEL_CREATED, version: '1', partial: true }),
		).toMatchObject({ omitted: 2, labels: [{ judgments: [] }] })
	})

	it('carries the method of the lane that settled each row', () => {
		const map = buildStudyLabelMap(['work', 'work'])
		const person = {
			labeler: 'person',
			method: 'human',
			rows: [
				{ row: 1, verdict: 'achieved', reason: 'Saw it' },
				{ row: 2, verdict: 'achieved', reason: 'Saw it' },
			],
		} as const
		const model = {
			labeler: 'second',
			method: 'model',
			rows: [
				{ row: 1, verdict: 'achieved', reason: 'Saw it' },
				{ row: 2, verdict: 'unsuccessful', reason: 'Missed it' },
			],
		} as const
		const { labels } = createStudyLabels(map, [person, model], {
			created: STUDY_LABEL_CREATED,
			version: '1',
			third: {
				labeler: 'third',
				method: 'model',
				rows: [{ row: 2, verdict: 'achieved', reason: 'Settled' }],
			},
		})
		expect(labels[0]?.judgments.map((entry) => entry.method)).toEqual(['human', 'model'])
	})

	it('returns each file through the contract, so what it refuses never leaves', () => {
		const map = buildStudyLabelMap(['work'])
		const rows = [{ row: 1, verdict: 'achieved', reason: 'Why' }] as const
		const lane = { labeler: 'first', method: 'model', rows } as const
		const fields = { created: STUDY_LABEL_CREATED, version: '1' }
		for (const [lanes, change, path] of [
			[[{ ...lane, labeler: ' ' }], fields, 'labeler'],
			[[lane], { ...fields, created: 'yesterday' }, 'created'],
			[[lane], { ...fields, version: ' ' }, 'version'],
			[[{ ...lane, method: 'state' }], fields, 'judgments.0.method'],
			[[{ ...lane, rows: [{ ...rows[0], verdict: 'oracle' }] }], fields, 'judgments.0.verdict'],
		] as const) {
			expect(() => Reflect.apply(createStudyLabels, undefined, [map, lanes, change])).toThrow(
				expect.objectContaining({ code: 'EVIDENCE', message: expect.stringContaining(path) }),
			)
		}
		const twin: StudyLabelMap = {
			checks: [],
			links: [
				requireValue(buildStudyLabelMap(['work']).links[0]),
				{ ...requireValue(buildStudyLabelMap(['work']).links[0]), row: 2 },
			],
		}
		expect(() =>
			createStudyLabels(twin, [{ ...lane, rows: [...rows, { ...rows[0], row: 2 }] }], fields),
		).toThrow(/repeats its trial and criterion/)
	})
})
