import { isRecord, parseJSON } from '@orkestrel/contract'
import { requireValue } from '@orkestrel/test'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStudyProfile } from '../../../../src/core/parsers.js'
import { StudyCommand } from '../../../../src/server/commands/StudyCommand.js'
import { readStudyClosure } from '../../../../src/server/commands/helpers.js'
import { STUDY_INSTALL_ENTRY } from '../../../../src/server/launchers/constants.js'
import { createStudyInstall } from '../../../../src/server/launchers/factories.js'
import {
	STUDY_INSTALL_DEPENDENCY,
	STUDY_INSTALL_PRIVATE,
	buildStudyCLI,
	collectStudyInstallFiles,
	createStudyConsumer,
	createStudyScratch,
	writeStudyInstallConsumer,
	writeStudyInstallDependency,
	writeStudyInstallProfile,
} from '../../../setupServer.js'

describe('createStudyInstall', () => {
	it('copies exactly the members freeze retains, without a runtime dependency the profile does not admit or a data file under sources/private', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			writeStudyInstallDependency(scratch, true)
			const entry = await buildStudyCLI(scratch, 'node_modules/@orkestrel/study')
			const frozen = join(scratch.path, 'frozen')
			await new StudyCommand({ root: scratch.path, entry }).execute(
				['freeze', 'assessment', '--profile', 'local', '--to', frozen],
				new AbortController().signal,
			)
			const directory = join(scratch.path, 'install')
			const install = await createStudyInstall({
				root: scratch.path,
				directory,
				studies: ['assessment'],
			})
			expect(install.root).toBe(directory)
			expect(install.entry).toBe(join(directory, STUDY_INSTALL_ENTRY))
			const members = readStudyClosure(frozen)
				.closure.members.map(({ key }) => key)
				.toSorted()
			expect(members).toContain(STUDY_INSTALL_ENTRY)
			expect(members).toContain('studies/files/index.ts')
			expect(members).toContain('studies/files/profiles/local.json')
			expect(collectStudyInstallFiles(directory)).toEqual(members)
			expect(scratch.has(STUDY_INSTALL_DEPENDENCY)).toBe(true)
			expect(members).not.toContain(STUDY_INSTALL_DEPENDENCY)
			expect(scratch.has(STUDY_INSTALL_PRIVATE)).toBe(true)
			expect(collectStudyInstallFiles(directory)).not.toContain(STUDY_INSTALL_PRIVATE)
		} finally {
			scratch.destroy()
		}
	}, 240000)

	it('installs over a runtime dependency that is not an ESM package, because freeze admits no such root', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			writeStudyInstallDependency(scratch, false)
			const directory = join(scratch.path, 'install')
			await createStudyInstall({ root: scratch.path, directory, studies: ['assessment'] })
			expect(collectStudyInstallFiles(directory)).toContain(STUDY_INSTALL_ENTRY)
			expect(collectStudyInstallFiles(directory)).not.toContain(STUDY_INSTALL_DEPENDENCY)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a consumer root without the installed Study executable before creating anything', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			scratch.remove('node_modules')
			const directory = join(scratch.path, 'install')
			await expect(
				createStudyInstall({ root: scratch.path, directory, studies: ['assessment'] }),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: expect.stringContaining(`no Study executable at ${STUDY_INSTALL_ENTRY}`),
			})
			expect(scratch.has('install')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses an installed Study package that resolves outside the consumer root, before creating anything', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		const outside = createStudyScratch(resolve('tmp/units'), 'install-outside-')
		try {
			outside.write(
				'package.json',
				JSON.stringify({ name: '@orkestrel/study', version: '0.0.0-outside', type: 'module' }),
			)
			outside.write('dist/bin/main.js', 'export {}\n')
			scratch.remove('node_modules/@orkestrel/study')
			scratch.link('node_modules/@orkestrel/study', outside.path)
			await expect(
				createStudyInstall({
					root: scratch.path,
					directory: join(scratch.path, 'install'),
					studies: ['assessment'],
				}),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: `root: ${STUDY_INSTALL_ENTRY} resolves to ${realpathSync(outside.path)} outside the consumer root; install @orkestrel/study inside the root without a link`,
			})
			expect(scratch.has('install')).toBe(false)
		} finally {
			scratch.remove('node_modules/@orkestrel/study')
			outside.destroy()
			scratch.destroy()
		}
	})

	it('refuses a profile name the bundle does not hold, by its key path', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			await expect(
				createStudyInstall({
					root: scratch.path,
					directory: join(scratch.path, 'install'),
					studies: ['assessment'],
					profiles: ['local', 'absent'],
				}),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: expect.stringContaining(
					'profiles[1] names "absent", which the bundle of studies[0] does not hold at studies/files/profiles/absent.json',
				),
			})
			expect(scratch.has('install')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses an absolute roots, agent, subject, or provider.entry entry, by its key path', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			const provider = {
				entry: 'subject/dist/index.js',
				url: 'http://127.0.0.1:1',
				model: 'model',
				digest: { model: 'a'.repeat(64) },
			}
			const absolute = resolve(scratch.path, 'subject/dist/index.js')
			for (const [key, change] of [
				['roots[1]', { roots: ['.', resolve(scratch.path, 'subject')] }],
				['agent', { agent: absolute }],
				['subject', { subject: absolute }],
				['provider.entry', { provider: { ...provider, entry: absolute } }],
			] as const) {
				writeStudyInstallConsumer(scratch)
				writeStudyInstallProfile(scratch, change)
				await expect(
					createStudyInstall({
						root: scratch.path,
						directory: join(scratch.path, 'install'),
						studies: ['assessment'],
					}),
				).rejects.toMatchObject({
					code: 'CONFIG',
					message: `studies/files/profiles/local.json: ${key} must name a path relative to the consumer root, not an absolute path`,
				})
			}
			expect(scratch.has('install')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a profile root that resolves outside the consumer root, by its key path', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			writeStudyInstallProfile(scratch, { roots: ['.', 'subject', '../outside'] })
			await expect(
				createStudyInstall({
					root: scratch.path,
					directory: join(scratch.path, 'install'),
					studies: ['assessment'],
				}),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: expect.stringContaining(
					'studies/files/profiles/local.json: roots[2] must resolve inside the consumer root',
				),
			})
			expect(scratch.has('install')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it("passes materialize's occupied and missing-parent refusals through unchanged", async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			scratch.write('install/kept.txt', 'kept')
			await expect(
				createStudyInstall({
					root: scratch.path,
					directory: join(scratch.path, 'install'),
					studies: ['assessment'],
				}),
			).rejects.toMatchObject({ code: 'OCCUPIED' })
			expect(scratch.read('install/kept.txt')).toBe('kept')
			await expect(
				createStudyInstall({
					root: scratch.path,
					directory: join(scratch.path, 'absent', 'install'),
					studies: ['assessment'],
				}),
			).rejects.toMatchObject({ code: 'PARENT' })
			expect(scratch.has('absent')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('rebinds each named profile to the fixture provider after copying and leaves the source profile', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			writeStudyInstallProfile(scratch, {
				provider: {
					entry: 'subject/dist/index.js',
					url: 'http://127.0.0.1:1',
					model: 'model',
					digest: { model: 'a'.repeat(64) },
				},
			})
			const source = requireValue(scratch.read('studies/files/profiles/local.json'))
			const digest = { model: 'b'.repeat(64), judge: undefined }
			await createStudyInstall({
				root: scratch.path,
				directory: join(scratch.path, 'install'),
				studies: ['assessment'],
				provider: { url: 'http://127.0.0.1:9', digest },
			})
			const original = parseStudyProfile(parseJSON(source))
			const rebound = parseStudyProfile(
				parseJSON(requireValue(scratch.read('install/studies/files/profiles/local.json'))),
			)
			expect(rebound.provider).toEqual({
				...original.provider,
				url: 'http://127.0.0.1:9',
				digest,
			})
			expect({ ...rebound, provider: undefined }).toEqual({ ...original, provider: undefined })
			expect(scratch.read('studies/files/profiles/local.json')).toBe(source)
		} finally {
			scratch.destroy()
		}
	})

	it('removes the directory it made when a rebind after copying refuses', async () => {
		const scratch = createStudyConsumer(writeStudyInstallConsumer)
		try {
			const profile = parseJSON(requireValue(scratch.read('studies/files/profiles/local.json')))
			expect(isRecord(profile) && profile.provider === undefined).toBe(true)
			await expect(
				createStudyInstall({
					root: scratch.path,
					directory: join(scratch.path, 'install'),
					studies: ['assessment'],
					provider: {
						url: 'http://127.0.0.1:9',
						digest: { model: 'b'.repeat(64), judge: undefined },
					},
				}),
			).rejects.toMatchObject({
				code: 'CONFIG',
				message: expect.stringContaining('declares no provider to rebind'),
			})
			expect(scratch.has('install')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})
