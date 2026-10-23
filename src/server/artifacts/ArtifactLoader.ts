import type {
	ArtifactInventory,
	ArtifactLoaderOptions,
	ArtifactLoaderInterface,
	ArtifactClosure,
	ArtifactMember,
	ArtifactPackage,
	ArtifactSource,
	ArtifactTally,
} from './types.js'
import { isNonEmptyString, isRecord } from '@orkestrel/contract'
import { randomUUID } from 'node:crypto'
import { lstatSync, opendirSync, realpathSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
	ARTIFACT_BYTES,
	ARTIFACT_DEPTH,
	ARTIFACT_FILES,
	ARTIFACT_ROOTS,
	ARTIFACT_VISITS,
} from './constants.js'
import { containsArtifact, hashStudyBytes, matchesSystemError } from '../helpers.js'
import { ArtifactError, isArtifactError } from './errors.js'
import {
	computeArtifactClosureDigest,
	iterateArtifactEntries,
	readArtifact,
	readArtifactPhysical,
	relocateArtifactPath,
	resolveArtifactBase,
	resolveArtifactMember,
	verifyArtifactClosure,
} from './helpers.js'
import { Resolution } from './Resolution.js'

/** Captures built ESM and a separate strip-only consumer adapter in a fresh worker.
 * @remarks
 * Loads trusted code without sandboxing untrusted code. Native process APIs, eval and external
 * services are not replayed. One inventory may load per process; terminate it afterwards.
 */
export class ArtifactLoader implements ArtifactLoaderInterface {
	static #active = false
	#options: ArtifactLoaderOptions
	#inventory: ArtifactInventory | undefined
	#sources: readonly ArtifactSource[] = []
	#token: string | undefined
	#references: ReadonlyMap<string, string> = new Map()

	/** Captures selections without reading or executing selected modules.
	 * @param options - Canonical built selections and optional consumer source selection.
	 */
	constructor(options: ArtifactLoaderOptions) {
		if (options.roots.length > ARTIFACT_ROOTS || options.entries.length > ARTIFACT_FILES)
			throw new ArtifactError('Artifact selection exceeds its limit')
		this.#options = {
			...options,
			entries: [...options.entries],
			roots: [...options.roots],
			...(options.source === undefined
				? {}
				: { source: { root: options.source.root, entry: options.source.entry } }),
			...(options.excluded === undefined ? {} : { excluded: [...options.excluded] }),
			...(options.assets === undefined ? {} : { assets: [...options.assets] }),
		}
	}

	/** Reads and identifies admitted files without evaluating selected modules.
	 * @returns Frozen evidence identifying all captured bytes and the native runtime.
	 * @throws Thrown for invalid selections, unsupported TypeScript, limits, or drift.
	 */
	inspect(): ArtifactInventory {
		if (this.#inventory !== undefined) {
			this.verify()
			return this.#inventory
		}
		if (
			(this.#options.entries.length === 0 && this.#options.source === undefined) ||
			this.#options.roots.length > ARTIFACT_ROOTS ||
			this.#options.entries.length > ARTIFACT_FILES
		)
			throw new ArtifactError('Artifact selection is empty or exceeds its limit')
		if (
			this.#options.instrument !== undefined &&
			!this.#options.roots.includes(this.#options.instrument)
		)
			throw new ArtifactError('Artifact instrument must be an admitted package root')
		const sources = this.#capture()
		const packages = [...this.#options.roots].sort().map((root, index, sorted): ArtifactPackage => {
			const manifest = sources.find((file) => file.path === join(root, 'package.json'))
			if (manifest === undefined) throw new ArtifactError(`Artifact manifest is missing: ${root}`)
			const value: unknown = JSON.parse(Buffer.from(manifest.source).toString('utf8'))
			if (
				!isRecord(value) ||
				value.type !== 'module' ||
				!isNonEmptyString(value.name) ||
				!isNonEmptyString(value.version)
			)
				throw new ArtifactError(`Artifact requires a named, versioned ESM package: ${root}`)
			if (sorted.indexOf(root) !== index)
				throw new ArtifactError(`Artifact package identity is duplicated: ${value.name}`)
			return Object.freeze({ root, name: value.name, version: value.version })
		})
		for (const entry of this.#options.entries) {
			if (
				!['.js', '.mjs'].includes(extname(entry)) ||
				!sources.some((file) => file.path === entry) ||
				!packages.some((item) => containsArtifact(join(item.root, 'dist'), entry))
			)
				throw new ArtifactError(`Artifact entry must be admitted built ESM: ${entry}`)
		}
		const source = this.#options.source
		if (source !== undefined) {
			if (
				!['.ts', '.mts', '.js', '.mjs'].includes(extname(source.entry)) ||
				!containsArtifact(source.root, source.entry) ||
				!sources.some((file) => file.path === source.entry)
			)
				throw new ArtifactError('Artifact source entry must be an admitted module')
			for (const file of sources.filter((candidate) =>
				containsArtifact(source.root, candidate.path),
			)) {
				if (file.path.endsWith('.ts') || file.path.endsWith('.mts')) {
					const counterpart = file.path.endsWith('.mts')
						? `${file.path.slice(0, -4)}.mjs`
						: `${file.path.slice(0, -3)}.js`
					if (sources.some((candidate) => candidate.path === counterpart))
						throw new ArtifactError(`Artifact source target is ambiguous: ${file.path}`)
					stripTypeScriptTypes(Buffer.from(file.source).toString('utf8'), { mode: 'strip' })
				}
			}
		}
		sources.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
		const settings = process.env.NODE_OPTIONS
		const evidence = {
			node: process.version,
			runtime: Object.freeze({
				arguments: Object.freeze([...process.execArgv]),
				platform: process.platform,
				architecture: process.arch,
				...(settings === undefined ? {} : { options: settings }),
			}),
			entries: Object.freeze(
				[
					...new Set([...this.#options.entries, ...(source === undefined ? [] : [source.entry])]),
				].sort(),
			),
			packages: Object.freeze(packages),
			...(source === undefined ? {} : { source: Object.freeze({ ...source }) }),
			...(this.#options.instrument === undefined ? {} : { instrument: this.#options.instrument }),
			files: Object.freeze(
				sources.map(({ path, digest, size }) => Object.freeze({ path, digest, size })),
			),
			...(this.#options.assets === undefined
				? {}
				: { assets: Object.freeze([...this.#options.assets].sort()) }),
		}
		this.#sources = sources
		this.#references = new Map(
			sources.map((file) => {
				const stat = readArtifactPhysical(file.path)
				return [file.path, `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}`]
			}),
		)
		this.#inventory = Object.freeze({
			digest: hashStudyBytes(JSON.stringify(evidence)),
			...evidence,
		})
		this.verify()
		return this.#inventory
	}

	/** Refuses byte and population drift since inspection.
	 * @throws Thrown when any admitted file or the admitted population changes.
	 */
	verify(): void {
		if (this.#inventory === undefined) throw new ArtifactError('Artifact inspection is required')
		const current = this.#capture()
		const captured = new Map(this.#sources.map((file) => [file.path, file.digest]))
		if (
			current.length !== this.#sources.length ||
			current.some((file) => captured.get(file.path) !== file.digest)
		)
			throw new ArtifactError('Artifact inventory drifted')
	}

	/** Imports one selected entry through synchronous captured-byte hooks.
	 * @param entry - The exact canonical built entry or selected source adapter entry.
	 * @returns The actual module namespace for the caller to narrow.
	 * @throws Thrown for drift, unsupported edges, evaluation failures, or a reused worker.
	 */
	async load(entry: string): Promise<unknown> {
		const inventory = this.inspect()
		if (!inventory.entries.includes(entry))
			throw new ArtifactError('Artifact entry was not selected')
		if (this.#token === undefined) {
			if (ArtifactLoader.#active)
				throw new ArtifactError('Artifact loading requires a fresh process')
			const token = randomUUID()
			const resolution = new Resolution({
				token,
				files: this.#sources.filter(
					(file) =>
						this.#options.roots.some(
							(root) =>
								file.path === join(root, 'package.json') ||
								containsArtifact(join(root, 'dist'), file.path),
						) ||
						(this.#options.source !== undefined &&
							containsArtifact(this.#options.source.root, file.path)),
				),
				...(inventory.source === undefined ? {} : { source: inventory.source }),
				...(inventory.instrument === undefined ? {} : { instrument: inventory.instrument }),
				...(this.#options.excluded === undefined ? {} : { excluded: this.#options.excluded }),
			})
			registerHooks({
				resolve: (specifier, context, next) => resolution.resolve(specifier, context, next),
				load: (href, context, next) => resolution.load(href, context, next),
			})
			this.#token = token
			ArtifactLoader.#active = true
		}
		const url = pathToFileURL(entry)
		url.searchParams.set('artifact', this.#token)
		const namespace: unknown = await import(url.href)
		this.verify()
		return namespace
	}

	/** Copies the inspected physical forest into an exclusive absent destination.
	 * @param destination - The canonical absent absolute directory under an existing physical parent.
	 * @returns The independently verified copied membership and relocated selections.
	 * @throws ArtifactError - Thrown at the refused path, stale-source, volume, or drift boundary.
	 */
	async materialize(destination: string): Promise<ArtifactClosure> {
		if (new Set(this.#options.roots).size !== this.#options.roots.length)
			throw new ArtifactError('Artifact package root is duplicated', 'DUPLICATE')
		if (!isAbsolute(destination) || resolve(destination) !== destination)
			throw new ArtifactError('Artifact destination must be canonical and absolute', 'TRAVERSAL')
		const boundaries = [
			...this.#options.roots,
			...(this.#options.source === undefined ? [] : [this.#options.source.root]),
			...(this.#options.assets ?? []),
		]
		if (boundaries.some((path) => parse(path).root !== parse(destination).root))
			throw new ArtifactError('Artifact closure requires one volume', 'VOLUME')
		if (
			boundaries.some(
				(path) =>
					path === destination ||
					containsArtifact(path, destination) ||
					containsArtifact(destination, path),
			)
		)
			throw new ArtifactError('Artifact destination overlaps a source', 'OVERLAP')
		const parent = readArtifactPhysical(dirname(destination))
		resolveArtifactMember(dirname(destination), relative(dirname(destination), destination))
		if (!parent.isDirectory())
			throw new ArtifactError('Artifact destination parent must be a directory', 'REDIRECT')
		try {
			lstatSync(destination)
			throw new ArtifactError('Artifact destination must be absent', 'OCCUPIED')
		} catch (error) {
			if (!matchesSystemError(error, 'ENOENT')) throw error
		}
		const inspected = this.#inventory !== undefined
		try {
			for (const path of boundaries) readArtifactPhysical(path)
			this.inspect()
			for (const file of this.#sources) {
				const stat = readArtifactPhysical(file.path)
				if (stat.dev !== parent.dev)
					throw new ArtifactError('Artifact closure requires one volume', 'VOLUME')
				if (
					`${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}` !==
					this.#references.get(file.path)
				)
					throw new ArtifactError('Artifact source reference is stale', 'STALE')
			}
		} catch (error) {
			if (
				inspected &&
				!(isArtifactError(error) && ['REDIRECT', 'ALIAS', 'NAME', 'VOLUME'].includes(error.code))
			)
				throw new ArtifactError('Artifact source inspection is stale', 'STALE')
			throw error
		}
		const base = resolveArtifactBase([
			...this.#sources.map((file) => file.path),
			...this.#options.roots,
			...(this.#options.source === undefined ? [] : [this.#options.source.root]),
		])
		const members: readonly ArtifactMember[] = Object.freeze(
			this.#sources.map((file) =>
				Object.freeze({
					source: file.path,
					key: relative(base, file.path).split(sep).join('/'),
					digest: file.digest,
					size: file.size,
				}),
			),
		)
		const keys = new Set(members.map((member) => member.key))
		if (keys.size !== members.length)
			throw new ArtifactError('Artifact member key is duplicated', 'DUPLICATE')
		if (new Set(members.map((member) => member.key.toLowerCase())).size !== members.length)
			throw new ArtifactError('Artifact member keys have a case alias', 'ALIAS')
		if (members.some((member) => member.key.split('/').length - 1 > ARTIFACT_DEPTH))
			throw new ArtifactError('Artifact closure directory depth limit exceeded', 'LIMIT')
		const directories = new Set(
			members.flatMap((member) =>
				member.key
					.split('/')
					.slice(0, -1)
					.map((_name, index, names) => names.slice(0, index + 1).join('/')),
			),
		)
		if (directories.size + members.length > ARTIFACT_VISITS)
			throw new ArtifactError('Artifact closure traversal limit exceeded', 'LIMIT')
		for (const member of members) resolveArtifactMember(destination, member.key)
		const identities = this.#sources.map((file) => {
			const stat = readArtifactPhysical(file.path)
			return `${stat.dev}:${stat.ino}`
		})
		if (new Set(identities).size !== identities.length)
			throw new ArtifactError('Artifact members have a physical alias', 'ALIAS')
		const relocation = { destination, digest: '', options: this.#options, members }
		const options: ArtifactLoaderOptions = Object.freeze({
			entries: Object.freeze(
				this.#options.entries.map((path) => relocateArtifactPath(relocation, path)),
			),
			roots: Object.freeze(
				this.#options.roots.map((path) => relocateArtifactPath(relocation, path)),
			),
			...(this.#options.source === undefined
				? {}
				: {
						source: Object.freeze({
							root: relocateArtifactPath(relocation, this.#options.source.root),
							entry: relocateArtifactPath(relocation, this.#options.source.entry),
						}),
					}),
			...(this.#options.instrument === undefined
				? {}
				: { instrument: relocateArtifactPath(relocation, this.#options.instrument) }),
			...(this.#options.excluded === undefined
				? {}
				: {
						excluded: Object.freeze(
							this.#options.excluded.map((path) => relocateArtifactPath(relocation, path)),
						),
					}),
			...(this.#options.assets === undefined
				? {}
				: {
						assets: Object.freeze(
							this.#options.assets.map((path) => relocateArtifactPath(relocation, path)),
						),
					}),
		})
		const inventory = this.inspect()
		const packages = inventory.packages.map((entry) => ({
			...entry,
			root: relocateArtifactPath(relocation, entry.root),
		}))
		const closure = Object.freeze({
			destination,
			digest: computeArtifactClosureDigest(members, packages, destination),
			options,
			members,
		})
		mkdirSync(destination)
		for (const file of this.#sources) {
			const target = relocateArtifactPath(closure, file.path)
			this.#directory(closure.destination, dirname(target))
			await writeFile(target, file.source, { flag: 'wx' })
		}
		try {
			this.verify()
		} catch {
			throw new ArtifactError('Artifact source drifted during copying', 'DRIFT')
		}
		verifyArtifactClosure(closure)
		return closure
	}

	#directory(destination: string, target: string): void {
		const names = relative(destination, target).split(sep).filter(Boolean)
		readArtifactPhysical(destination)
		for (const [index] of names.entries()) {
			const path = join(destination, ...names.slice(0, index + 1))
			try {
				mkdirSync(path)
			} catch (error) {
				if (!matchesSystemError(error, 'EEXIST')) throw error
			}
			if (!readArtifactPhysical(path).isDirectory())
				throw new ArtifactError('Artifact destination ancestor is redirected', 'REDIRECT')
		}
	}

	// Captures every root's manifest and built files, then the optional source graph, threading the visit and byte tally through each step.
	#capture(): ArtifactSource[] {
		const sources: ArtifactSource[] = []
		const tally = this.#options.roots.reduce<ArtifactTally>(
			(counted, root) => {
				if (
					!isAbsolute(root) ||
					resolve(root) !== root ||
					realpathSync(root) !== root ||
					!lstatSync(root).isDirectory()
				)
					throw new ArtifactError(`Artifact requires a canonical package root: ${root}`)
				return this.#walk(
					join(root, 'dist'),
					sources,
					false,
					0,
					this.#append(join(root, 'package.json'), sources, counted),
				)
			},
			Object.freeze({ visits: 0, bytes: 0 }),
		)
		const source = this.#options.source
		if (source !== undefined) {
			if (
				this.#options.roots.some(
					(root) =>
						join(root, 'dist') === source.root ||
						containsArtifact(join(root, 'dist'), source.root) ||
						containsArtifact(source.root, join(root, 'dist')),
				)
			)
				throw new ArtifactError('Artifact source and built inventories must not overlap')
			const counted = this.#walk(source.root, sources, true, 0, tally)
			this.#assets(sources, counted)
		} else this.#assets(sources, tally)
		return sources
	}

	#assets(sources: ArtifactSource[], tally: ArtifactTally): void {
		const assets = this.#options.assets ?? []
		if (assets.length > ARTIFACT_FILES)
			throw new ArtifactError('Artifact asset count limit exceeded', 'LIMIT')
		if (new Set(assets).size !== assets.length)
			throw new ArtifactError('Artifact asset key is duplicated', 'DUPLICATE')
		assets.reduce((counted, path) => {
			readArtifactPhysical(path)
			return sources.some((file) => file.path === path)
				? counted
				: this.#append(path, sources, counted)
		}, tally)
	}

	// Reads one admitted file under the bytes that remain and returns the tally including it.
	#append(path: string, sources: ArtifactSource[], tally: ArtifactTally): ArtifactTally {
		if (sources.length >= ARTIFACT_FILES)
			throw new ArtifactError('Artifact file count limit exceeded')
		const file = readArtifact(path, ARTIFACT_BYTES - tally.bytes)
		sources.push(file)
		return Object.freeze({ visits: tally.visits, bytes: tally.bytes + file.size })
	}

	// Visits a directory's entries lazily, so a limit refusal stops reading it, and returns the tally including its subtree.
	#walk(
		directory: string,
		sources: ArtifactSource[],
		source: boolean,
		depth: number,
		tally: ArtifactTally,
	): ArtifactTally {
		if (depth > ARTIFACT_DEPTH) throw new ArtifactError('Artifact directory depth limit exceeded')
		if (
			!isAbsolute(directory) ||
			resolve(directory) !== directory ||
			realpathSync(directory) !== directory ||
			!lstatSync(directory).isDirectory()
		)
			throw new ArtifactError(`Artifact directory must be canonical and not linked: ${directory}`)
		const handle = opendirSync(directory)
		try {
			return iterateArtifactEntries(handle).reduce<ArtifactTally>((counted, entry) => {
				const visited = Object.freeze({ visits: counted.visits + 1, bytes: counted.bytes })
				if (visited.visits > ARTIFACT_VISITS)
					throw new ArtifactError('Artifact traversal limit exceeded')
				const path = join(directory, entry.name)
				if (entry.isSymbolicLink())
					throw new ArtifactError(`Artifact links are unsupported: ${path}`, 'REDIRECT')
				if (entry.isDirectory()) return this.#walk(path, sources, source, depth + 1, visited)
				return (source
					? ['.ts', '.mts', '.js', '.mjs']
					: ['.js', '.mjs', '.cjs', '.json']
				).includes(extname(path)) &&
					!path.endsWith('.d.ts') &&
					!path.endsWith('.d.mts')
					? this.#append(path, sources, visited)
					: visited
			}, tally)
		} finally {
			handle.closeSync()
		}
	}
}
