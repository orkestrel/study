import type { ArtifactSourceOptions } from '../artifacts/types.js'
import type { StudyInstallOptions } from './types.js'
import { StudyError, parseStudyProfile } from '@src/core'
import { lstatSync, realpathSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { ArtifactLoader } from '../artifacts/ArtifactLoader.js'
import { relocateArtifactPath } from '../artifacts/helpers.js'
import {
	buildStudyFreezeOptions,
	readStudyDeclaration,
	readStudyDeclarationBytes,
	resolveStudyPath,
	resolveStudyProfile,
} from '../commands/helpers.js'
import { containsArtifact, decodeStudyJSON, encodeStudyJSON } from '../helpers.js'
import { resolveStudyInstrument } from '../processes/helpers.js'
import { STUDY_INSTALL_ENTRY } from './constants.js'
import { buildStudyFixtureProfile, scanStudyAbsolutePaths } from './helpers.js'
import { StudyInstall } from './StudyInstall.js'

/**
 * Copies what the `study freeze` command retains for each listed study and profile into an absent directory and returns an install over it.
 * @param options - The consumer root, the install directory, the studies and profiles, and an optional provider
 * @returns An install whose root is the directory and whose entry is its copied Study executable
 * @throws StudyError - Thrown with code `CONFIG`, naming the key path and the fix, when the root holds no Study executable at the `STUDY_INSTALL_ENTRY` path or one that resolves outside it, a listed profile is missing from its bundle, or a profile path is absolute or a root resolves outside the consumer root
 * @throws ArtifactError - Thrown unchanged from the `materialize` method, as for an occupied directory or a missing parent
 * @remarks
 * A refusal before copying creates nothing. After the factory creates the directory, a refusal
 * removes it.
 * @example Install studies for a command run
 * ```ts
 * import { createStudyInstall } from '@orkestrel/study/server'
 *
 * declare const root: string
 * declare const directory: string
 * const install = await createStudyInstall({ root, directory, studies: ['assessment'] })
 * const checked = await install.execute(['check', 'assessment', '--profile', 'local'])
 * const valid = checked.code === 0
 * ```
 */
export async function createStudyInstall(options: StudyInstallOptions): Promise<StudyInstall> {
	const root = realpathSync(resolve(options.root))
	const entry = join(root, STUDY_INSTALL_ENTRY)
	if (lstatSync(entry, { throwIfNoEntry: false })?.isFile() !== true)
		throw new StudyError(
			'CONFIG',
			`root holds no Study executable at ${STUDY_INSTALL_ENTRY}; install @orkestrel/study in ${root}`,
		)
	const instrument = resolveStudyInstrument(entry)
	if (instrument !== root && !containsArtifact(root, instrument))
		throw new StudyError(
			'CONFIG',
			`root: ${STUDY_INSTALL_ENTRY} resolves to ${instrument} outside the consumer root; install @orkestrel/study inside the root without a link`,
		)
	const profiles = options.profiles ?? ['local']
	const declarations = await Promise.all(
		options.studies.map((study) => readStudyDeclaration(root, study)),
	)
	const selections = await Promise.all(
		declarations.flatMap((declaration, index) =>
			profiles.map(async (profile, position) => {
				const path = resolveStudyPath(declaration.bundle, `profiles/${profile}.json`)
				const name = relative(root, path).split(sep).join('/')
				if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true)
					throw new StudyError(
						'CONFIG',
						`profiles[${position}] names ${JSON.stringify(profile)}, which the bundle of studies[${index}] does not hold at ${name}; add that profile or name a profile the bundle holds`,
					)
				const source = parseStudyProfile(
					decodeStudyJSON(await readStudyDeclarationBytes(root, path)),
				)
				const absolute = scanStudyAbsolutePaths(source)
				if (absolute.length > 0)
					throw new StudyError(
						'CONFIG',
						`${name}: ${absolute.join(', ')} must name a path relative to the consumer root, not an absolute path`,
					)
				const resolved = resolveStudyProfile(root, source)
				const outside = resolved.roots.flatMap((location, offset) =>
					location === root || containsArtifact(root, location) ? [] : [`roots[${offset}]`],
				)
				if (outside.length > 0)
					throw new StudyError(
						'CONFIG',
						`${name}: ${outside.join(', ')} must resolve inside the consumer root ${root}`,
					)
				return {
					path,
					options: buildStudyFreezeOptions(
						root,
						entry,
						{ target: declaration.definition.name, profile },
						{ bundle: declaration.bundle, definition: declaration.definition, profile: resolved },
					),
				}
			}),
		),
	)
	const sources = new Map(
		selections.flatMap(
			({ options: selected }): ReadonlyArray<readonly [string, ArtifactSourceOptions]> =>
				selected.source === undefined ? [] : [[selected.source.root, selected.source]],
		),
	)
	const loader = new ArtifactLoader({
		roots: [...new Set(selections.flatMap(({ options: selected }) => selected.roots))],
		entries: [...new Set(selections.flatMap(({ options: selected }) => selected.entries))],
		assets: [
			...new Set([
				...[...sources.values()].flatMap((source) =>
					new ArtifactLoader({ entries: [], roots: [], source })
						.inspect()
						.files.map((file) => file.path),
				),
				...selections.flatMap(({ options: selected }) => selected.assets ?? []),
			]),
		],
	})
	const present = lstatSync(options.directory, { throwIfNoEntry: false }) !== undefined
	try {
		const closure = await loader.materialize(options.directory)
		const provider = options.provider
		if (provider !== undefined)
			await Promise.all(
				[...new Set(selections.map(({ path }) => path))].map(async (path) => {
					const target = relocateArtifactPath(closure, path)
					const profile = parseStudyProfile(decodeStudyJSON(await readFile(target)))
					await writeFile(
						target,
						encodeStudyJSON(buildStudyFixtureProfile(profile, provider.url, provider.digest)),
					)
				}),
			)
	} catch (error) {
		if (!present && lstatSync(options.directory, { throwIfNoEntry: false }) !== undefined)
			await rm(options.directory, { recursive: true, force: true })
		throw error
	}
	return new StudyInstall({
		root: options.directory,
		entry: join(options.directory, STUDY_INSTALL_ENTRY),
	})
}
