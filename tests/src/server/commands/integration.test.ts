import { isArray, isRecord, parseJSON } from '@orkestrel/contract'
import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { StudyCommand } from '../../../../src/server/commands/StudyCommand.js'
import { StudyArtifactLoader } from '../../../../src/server/processes/StudyArtifactLoader.js'
import { isStudyClosure } from '../../../../src/server/commands/validators.js'
import { requireValue } from '@orkestrel/test'
import { readStudyResult } from '../../../../src/server/stores/helpers.js'
import {
	buildStudyCLI,
	createStudyConsumer,
	createStudyReplayFixture,
} from '../../../setupServer.js'

it('RP3 keeps content equal across a renamed frozen consumer and JSON edits, binds runtime, and replays changed code with both identities', async () => {
	const fixture = await createStudyReplayFixture(true)
	const copies = createScratch({ parent: resolve('tmp/units') })
	try {
		const { scratch, command, entry, profile, result, history, recorded, server } = fixture
		expect(profile.roots[0]).toBe(scratch.path)
		expect(
			profile.roots.slice(1).every((root) => root.startsWith(join(scratch.path, 'node_modules'))),
		).toBe(true)
		const options = {
			root: scratch.path,
			entry,
			profile,
			adapter: join(scratch.path, 'studies/files/index.ts'),
		}
		for (const path of [
			'studies/files/scenarios/first.json',
			'studies/files/profiles/local.json',
			'studies/assessment/rubric.json',
		]) {
			const original = requireValue(scratch.read(path))
			scratch.write(path, original + ' ')
			expect((await new StudyArtifactLoader(options).inspect()).content).toBe(
				result.manifest.identity.content,
			)
			scratch.write(path, original)
		}
		const destination = join(copies.path, 'renamed-frozen-consumer')
		await command.execute(
			['freeze', 'assessment', '--profile', 'local', '--to', destination],
			new AbortController().signal,
		)
		const publication = parseJSON(readFileSync(join(destination, 'closure.json'), 'utf8'))
		if (!isStudyClosure(publication)) throw new Error('Missing verified frozen publication')
		expect(basename(publication.root)).not.toBe(basename(scratch.path))
		expect(publication.source.content).toBe(result.manifest.identity.content)
		expect(publication.identity.content).toBe(result.manifest.identity.content)
		expect(publication.identity.runtime).toBe(result.manifest.identity.runtime)
		const before = server.requests.length
		await command.execute(
			[
				'execute',
				'assessment',
				'--closure',
				destination,
				'--out',
				join(scratch.path, 'frozen-replay'),
				'--replay',
				recorded,
				'--prefix',
				JSON.stringify({ [history.declaration.trial]: history.completion.count }),
				'--offline',
				'true',
			],
			new AbortController().signal,
		)
		const frozen = await readStudyResult(join(scratch.path, 'frozen-replay'))
		expect(frozen.status).toBe('sealed')
		const adapter = requireValue(scratch.read('studies/files/index.ts'))
		scratch.write('studies/files/index.ts', adapter + ' ')
		const changed = await new StudyArtifactLoader(options).inspect()
		expect(changed.content).not.toBe(result.manifest.identity.content)
		expect(changed.runtime).toBe(result.manifest.identity.runtime)
		await command.execute(
			[
				'execute',
				'assessment',
				'--out',
				join(scratch.path, 'changed-code'),
				'--replay',
				recorded,
				'--prefix',
				JSON.stringify({ [history.declaration.trial]: history.completion.count }),
				'--offline',
				'true',
			],
			new AbortController().signal,
		)
		const replayed = await readStudyResult(join(scratch.path, 'changed-code'))
		if (replayed.status !== 'sealed') throw new Error('Changed content replay did not seal')
		expect(replayed.manifest.identity.content).toBe(changed.content)
		expect(replayed.manifest.ancestor?.identity).toEqual(result.manifest.identity)
		expect(replayed.manifest.identity.content).not.toBe(
			replayed.manifest.ancestor?.identity.content,
		)
		process.execArgv.push('--no-warnings')
		try {
			const runtime = (await new StudyArtifactLoader(options).inspect()).runtime
			expect(runtime).not.toBe(changed.runtime)
			process.stdout.write(
				`RP3 identity reading: ${JSON.stringify({ workspace: result.manifest.identity.content, frozen: publication.identity.content, changed: changed.content, runtime: changed.runtime, arguments: runtime })}\n`,
			)
			await expect(
				command.execute(
					[
						'execute',
						'assessment',
						'--out',
						join(scratch.path, 'changed-runtime'),
						'--replay',
						recorded,
						'--prefix',
						JSON.stringify({ [history.declaration.trial]: history.completion.count }),
						'--offline',
						'true',
					],
					new AbortController().signal,
				),
			).rejects.toThrow('Replay runtime declaration changed')
			expect(scratch.has('changed-runtime')).toBe(false)
		} finally {
			process.execArgv.pop()
		}
		expect(server.requests.length).toBe(before)
	} finally {
		copies.destroy()
		await fixture.close()
	}
}, 180000)

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
