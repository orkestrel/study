import { isArray, isRecord, parseJSON } from '@orkestrel/contract'
import { destroyScratch } from '@orkestrel/test/server'
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { StudyCommand } from '../../../../src/server/commands/StudyCommand.js'
import { readStudyResult } from '../../../../src/server/stores/helpers.js'
import { buildStudyCLI, createStudyConsumer } from '../../../setupServer.js'

it('freezes twice with equal closure digests and checks and executes relocated bytes in fresh children', async () => {
	const scratch = createStudyConsumer()
	try {
		const entry = await buildStudyCLI(scratch)
		const command = new StudyCommand({ root: scratch.path, entry })
		scratch.write('studies/files/helper.ts', 'export const helper = true\n')
		const first = join(scratch.path, 'first')
		const second = join(scratch.path, 'second')
		await command.execute(
			['freeze', 'assessment', '--profile', 'local', '--to', first],
			new AbortController().signal,
		)
		await command.execute(
			['freeze', 'assessment', '--profile', 'local', '--to', second],
			new AbortController().signal,
		)
		const publication = parseJSON(readFileSync(join(first, 'closure.json'), 'utf8'))
		const other = parseJSON(readFileSync(join(second, 'closure.json'), 'utf8'))
		if (
			!isRecord(publication) ||
			!isRecord(publication.closure) ||
			!isRecord(other) ||
			!isRecord(other.closure)
		)
			throw new Error('Missing closure publication')
		expect(publication.closure.digest).toBe(other.closure.digest)
		expect(publication.source).not.toEqual(publication.identity)
		for (const destination of [first, second]) {
			const checked = await command.execute(
				['check', 'assessment', '--profile', 'local', '--closure', destination],
				new AbortController().signal,
			)
			expect(checked).toMatchObject({ command: 'check' })
		}
		if (!isArray(publication.closure.members)) throw new Error('Missing copied members')
		const helper = publication.closure.members.find(
			(member: unknown) =>
				isRecord(member) &&
				typeof member.key === 'string' &&
				member.key.endsWith('studies/files/helper.ts'),
		)
		if (!isRecord(helper) || typeof helper.key !== 'string')
			throw new Error('Missing non-entry module')
		const path = join(first, ...helper.key.split('/'))
		const original = readFileSync(path)
		appendFileSync(path, '\n// changed non-entry module\n')
		await expect(
			command.execute(['execute', 'assessment', '--closure', first], new AbortController().signal),
		).rejects.toThrow(/drift/)
		writeFileSync(path, original)
		const executed = await command.execute(
			[
				'execute',
				'assessment',
				'--profile',
				'local',
				'--closure',
				first,
				'--out',
				join(scratch.path, 'result'),
			],
			new AbortController().signal,
		)
		const retained = await readStudyResult(join(scratch.path, 'result'))
		if (retained.status !== 'sealed') throw new Error('Relocated execution did not seal')
		expect({
			execution: executed,
			failures: retained.attempts.flatMap((attempt) =>
				attempt.failure === undefined ? [] : [attempt.failure],
			),
		}).toMatchObject({ execution: { command: 'execute', status: 'completed' }, failures: [] })
	} finally {
		await destroyScratch(scratch)
	}
}, 120000)

it('refuses check-time writes before publishing closure.json', async () => {
	const scratch = createStudyConsumer()
	try {
		const entry = await buildStudyCLI(scratch)
		const original = scratch.read('studies/files/index.ts') ?? ''
		scratch.write(
			'studies/files/index.ts',
			original.replace(
				'validate(input) {',
				"validate(input) { if (import.meta.url.includes('/refused/')) appendFileSync(new URL('./helper.ts', import.meta.url), '\\n// validation write\\n');",
			),
		)
		scratch.write('studies/files/helper.ts', 'export const helper = true\n')
		const destination = join(scratch.path, 'refused')
		await expect(
			new StudyCommand({ root: scratch.path, entry }).execute(
				['freeze', 'assessment', '--profile', 'local', '--to', destination],
				new AbortController().signal,
			),
		).rejects.toThrow(/drift|changed/i)
		expect(scratch.has('refused/closure.json')).toBe(false)
		expect(scratch.has('refused')).toBe(true)
		expect(scratch.read('studies/files/helper.ts')).toBe('export const helper = true\n')
	} finally {
		await destroyScratch(scratch)
	}
}, 120000)
