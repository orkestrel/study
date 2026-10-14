import type {
	ArtifactInventory,
	ArtifactOptions,
	ArtifactPackage,
	ArtifactSource,
} from './types.js'
import { isRecord } from '@orkestrel/contract'
import { randomUUID } from 'node:crypto'
import { lstatSync, opendirSync, realpathSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
	ARTIFACT_BYTES,
	ARTIFACT_DEPTH,
	ARTIFACT_FILES,
	ARTIFACT_ROOTS,
	ARTIFACT_VISITS,
} from './constants.js'
import { ArtifactError } from './errors.js'
import { containsArtifact, hashBytes, readArtifact } from './helpers.js'
import { Resolution } from './Resolution.js'

/** Captures built ESM and a separate strip-only consumer adapter in a fresh worker.
 * @remarks
 * Loads trusted code, not a hostile-code sandbox. Native process APIs, eval and external
 * services are not replayed. One inventory may load per process; terminate it afterwards.
 */
export class Artifacts {
	static #active = false
	#options: ArtifactOptions
	#inventory: ArtifactInventory | undefined
	#sources: readonly ArtifactSource[] = []
	#token: string | undefined
	#visits = 0
	#bytes = 0

	/** Captures selections without reading or executing selected modules.
	 * @param options - Canonical built selections and optional consumer source selection.
	 */
	constructor(options: ArtifactOptions) {
		if (options.roots.length > ARTIFACT_ROOTS || options.entries.length > ARTIFACT_FILES)
			throw new ArtifactError('Artifact selection exceeds its limit')
		this.#options = {
			...options,
			entries: [...options.entries],
			roots: [...options.roots],
			...(options.source === undefined ? {} : { source: { ...options.source } }),
			...(options.excluded === undefined ? {} : { excluded: [...options.excluded] }),
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
		const packages: ArtifactPackage[] = []
		for (const root of [...this.#options.roots].sort()) {
			const manifest = sources.find((file) => file.path === join(root, 'package.json'))
			if (manifest === undefined) throw new ArtifactError(`Artifact manifest is missing: ${root}`)
			const value: unknown = JSON.parse(Buffer.from(manifest.source).toString('utf8'))
			if (
				!isRecord(value) ||
				value.type !== 'module' ||
				typeof value.name !== 'string' ||
				value.name.length === 0 ||
				typeof value.version !== 'string' ||
				value.version.length === 0
			)
				throw new ArtifactError(`Artifact requires a named, versioned ESM package: ${root}`)
			if (packages.some((item) => item.name === value.name || item.root === root))
				throw new ArtifactError(`Artifact package identity is duplicated: ${value.name}`)
			packages.push(Object.freeze({ root, name: value.name, version: value.version }))
		}
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
		}
		this.#sources = sources
		this.#inventory = Object.freeze({ digest: hashBytes(JSON.stringify(evidence)), ...evidence })
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
			if (Artifacts.#active) throw new ArtifactError('Artifact loading requires a fresh process')
			const token = randomUUID()
			const resolution = new Resolution({
				token,
				files: this.#sources,
				...(inventory.source === undefined ? {} : { source: inventory.source }),
				...(inventory.instrument === undefined ? {} : { instrument: inventory.instrument }),
				...(this.#options.excluded === undefined ? {} : { excluded: this.#options.excluded }),
			})
			registerHooks({
				resolve: (specifier, context, next) => resolution.resolve(specifier, context, next),
				load: (href, context, next) => resolution.load(href, context, next),
			})
			this.#token = token
			Artifacts.#active = true
		}
		const url = pathToFileURL(entry)
		url.searchParams.set('artifact', this.#token)
		const namespace: unknown = await import(url.href)
		this.verify()
		return namespace
	}

	#capture(): ArtifactSource[] {
		this.#visits = 0
		this.#bytes = 0
		const sources: ArtifactSource[] = []
		for (const root of this.#options.roots) {
			if (
				!isAbsolute(root) ||
				resolve(root) !== root ||
				realpathSync(root) !== root ||
				!lstatSync(root).isDirectory()
			)
				throw new ArtifactError(`Artifact requires a canonical package root: ${root}`)
			this.#append(join(root, 'package.json'), sources)
			this.#walk(join(root, 'dist'), sources, false, 0)
		}
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
			this.#walk(source.root, sources, true, 0)
		}
		return sources
	}

	#append(path: string, sources: ArtifactSource[]): void {
		if (sources.length >= ARTIFACT_FILES)
			throw new ArtifactError('Artifact file count limit exceeded')
		const file = readArtifact(path, ARTIFACT_BYTES - this.#bytes)
		this.#bytes += file.size
		sources.push(file)
	}

	#walk(directory: string, sources: ArtifactSource[], source: boolean, depth: number): void {
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
			for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
				if (++this.#visits > ARTIFACT_VISITS)
					throw new ArtifactError('Artifact traversal limit exceeded')
				const path = join(directory, entry.name)
				if (entry.isSymbolicLink())
					throw new ArtifactError(`Artifact links are unsupported: ${path}`)
				if (entry.isDirectory()) this.#walk(path, sources, source, depth + 1)
				else if (
					(source ? ['.ts', '.mts', '.js', '.mjs'] : ['.js', '.mjs', '.cjs', '.json']).includes(
						extname(path),
					) &&
					!path.endsWith('.d.ts') &&
					!path.endsWith('.d.mts')
				)
					this.#append(path, sources)
			}
		} finally {
			handle.closeSync()
		}
	}
}
