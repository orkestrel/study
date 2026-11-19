import type { Dir, Dirent, BigIntStats } from 'node:fs'
import type {
	ArtifactSource,
	ArtifactClosure,
	ArtifactMember,
	ArtifactPackage,
	ArtifactInventory,
	ArtifactLoaderOptions,
} from './types.js'
import { isRecord, isString, parseJSON } from '@orkestrel/contract'
import {
	closeSync,
	fstatSync,
	lstatSync,
	openSync,
	opendirSync,
	readSync,
	realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { containsArtifact, encodeStudyJSON, hashStudyBytes } from '../helpers.js'
import {
	ARTIFACT_BYTES,
	ARTIFACT_DEPTH,
	ARTIFACT_FILES,
	ARTIFACT_FILE_BYTES,
	ARTIFACT_MANIFEST_INTENT,
	ARTIFACT_VISITS,
} from './constants.js'
import { ArtifactError } from './errors.js'
import { isArtifactClosure, isArtifactKey } from './validators.js'

/** Checks whether a portable segment identifies credentials.
 * @param value - One untrusted path segment.
 * @returns True if the segment has a credential filename; false otherwise.
 * @example
 * ```ts
 * matchesArtifactCredential('.npmrc') // true
 * matchesArtifactCredential('index.js') // false
 * ```
 */
export function matchesArtifactCredential(value: string): boolean {
	return (
		/^(?:\.env(?:\..*)?|\.npmrc|auth\.json|id_(?:rsa|dsa|ecdsa|ed25519))$/i.test(value) ||
		/\.(?:key|pem|p12|pfx)$/i.test(value) ||
		/(?:^|[._-])token(?:$|[._-])/i.test(value)
	)
}

/** Resolves a portable member key without traversing outside its destination.
 * @param destination - The canonical absolute destination.
 * @param key - The slash-separated member key.
 * @returns The contained host path.
 * @throws ArtifactError - Thrown for traversal or an unsafe name.
 * @example
 * ```ts
 * declare const destination: string
 * resolveArtifactMember(destination, 'dist/index.js') // the member's path under destination
 * resolveArtifactMember(destination, '../outside.js') // throws a TRAVERSAL ArtifactError
 * ```
 */
export function resolveArtifactMember(destination: string, key: string): string {
	if (
		isAbsolute(key) ||
		key.split('/').some((name) => name === '..' || name === '.') ||
		/[\\:]/.test(key)
	)
		throw new ArtifactError('Artifact member traverses its boundary', 'TRAVERSAL')
	if (!isArtifactKey(key)) throw new ArtifactError('Artifact member name is unsafe', 'NAME')
	const path = resolve(destination, ...key.split('/'))
	if (!containsArtifact(resolve(destination), path))
		throw new ArtifactError('Artifact member traverses its boundary', 'TRAVERSAL')
	return path
}

/** Checks whether a destination overlaps what a loader copies or holds a selected path.
 * @remarks
 * A package root contributes its `package.json` and its `dist` tree alone, so a destination elsewhere inside a root copies nothing into itself.
 * @param options - The loader's selections.
 * @param destination - The canonical absolute destination.
 * @returns True if the destination equals, contains, or sits inside a copied path, or contains a selected root; false otherwise.
 * @example
 * ```ts
 * matchesArtifactOverlap({ entries: [], roots: ['/work'] }, '/work/tmp/closure') // false
 * matchesArtifactOverlap({ entries: [], roots: ['/work'] }, '/work/dist/closure') // true
 * ```
 */
export function matchesArtifactOverlap(
	options: ArtifactLoaderOptions,
	destination: string,
): boolean {
	const source = options.source === undefined ? [] : [options.source.root]
	const assets = options.assets ?? []
	return (
		[...options.roots, ...source, ...assets].some(
			(path) => path === destination || containsArtifact(destination, path),
		) ||
		[
			...options.roots.flatMap((root) => [join(root, 'package.json'), join(root, 'dist')]),
			...source,
			...assets,
		].some((path) => path === destination || containsArtifact(path, destination))
	)
}

/** Checks every existing physical ancestor before using a canonical absolute path.
 * @param path - The existing absolute file or directory.
 * @returns Its physical filesystem metadata.
 * @throws ArtifactError - Thrown for traversal, unsafe names, aliases or redirects before reading bytes.
 * @example
 * ```ts
 * declare const path: string
 * readArtifactPhysical(path).isFile() // true for a regular file
 * ```
 */
export function readArtifactPhysical(path: string): BigIntStats {
	if (!isAbsolute(path) || resolve(path) !== path)
		throw new ArtifactError('Artifact path must be canonical and absolute', 'TRAVERSAL')
	const origin = parse(path).root
	const names = relative(origin, path).split(sep).filter(Boolean)
	if (names.some((name) => !isArtifactKey(name)))
		throw new ArtifactError('Artifact physical path has an unsafe name', 'NAME')
	for (const [index] of names.entries()) {
		const candidate = join(origin, ...names.slice(0, index + 1))
		const stat = lstatSync(candidate, { bigint: true })
		if (stat.isSymbolicLink()) throw new ArtifactError('Artifact path is redirected', 'REDIRECT')
		const physical = realpathSync(candidate)
		if (physical !== candidate)
			throw new ArtifactError(
				'Artifact path has a physical alias or redirect',
				physical.toLowerCase() === candidate.toLowerCase() ? 'ALIAS' : 'REDIRECT',
			)
	}
	return lstatSync(path, { bigint: true })
}

/** Finds the common physical parent that preserves every selected path's relative resolution.
 * @param paths - Existing absolute members or selected roots on one volume.
 * @returns Their common ancestor directory.
 * @throws ArtifactError - Thrown when selections span volumes or contain no files.
 * @example
 * ```ts
 * declare const subject: string
 * declare const agent: string
 * resolveArtifactBase([subject, agent]) // the deepest directory both paths sit under
 * ```
 */
export function resolveArtifactBase(paths: readonly string[]): string {
	const first = paths[0]
	if (first === undefined) throw new ArtifactError('Artifact population is empty')
	if (paths.some((path) => parse(path).root !== parse(first).root))
		throw new ArtifactError('Artifact sources require one volume', 'VOLUME')
	const origin = parse(first).root
	const names = relative(origin, dirname(first)).split(sep).filter(Boolean)
	const parents = Array.from({ length: names.length + 1 }, (_entry, index) =>
		join(origin, ...names.slice(0, index)),
	).reverse()
	const base = parents.find((parent) =>
		paths.every((path) => parent === path || containsArtifact(parent, path)),
	)
	if (base === undefined)
		throw new ArtifactError('Artifact sources have no common parent', 'VOLUME')
	return base
}

/** Relocates an original path through a closure's retained physical forest.
 * @param closure - The verified closure record.
 * @param path - An original member or ancestor within its forest.
 * @returns The corresponding destination path.
 * @throws ArtifactError - Thrown when provenance or containment is inconsistent.
 * @example
 * ```ts
 * declare const closure: ArtifactClosure
 * declare const original: string
 * relocateArtifactPath(closure, original) // the same member under closure.destination
 * ```
 */
export function relocateArtifactPath(closure: ArtifactClosure, path: string): string {
	const first = closure.members[0]
	if (first === undefined) throw new ArtifactError('Artifact population is empty')
	const origin = resolve(first.source, ...first.key.split('/').map(() => '..'))
	if (path !== origin && !containsArtifact(origin, path))
		throw new ArtifactError('Artifact relocation traverses its forest', 'TRAVERSAL')
	if (closure.members.some((member) => resolveArtifactMember(origin, member.key) !== member.source))
		throw new ArtifactError('Artifact member provenance is inconsistent', 'TRAVERSAL')
	return path === origin
		? closure.destination
		: resolveArtifactMember(closure.destination, relative(origin, path).split(sep).join('/'))
}

/** Computes a destination-independent digest of members and relative package identities.
 * @remarks
 * A package root's manifest member binds by its projection digest alone, without its byte size.
 * @param members - Complete copied membership, with source provenance excluded from identity.
 * @param packages - Package identities with relocated roots.
 * @param destination - The common destination directory.
 * @returns The portable SHA-256 identity.
 * @example
 * ```ts
 * declare const closure: ArtifactClosure
 * declare const packages: readonly ArtifactPackage[]
 * computeArtifactClosureDigest(closure.members, packages, closure.destination) // a SHA-256 hex digest
 * ```
 */
export function computeArtifactClosureDigest(
	members: readonly ArtifactMember[],
	packages: readonly ArtifactPackage[],
	destination: string,
): string {
	const manifests = packages.map((entry) =>
		relative(destination, join(entry.root, 'package.json')).split(sep).join('/'),
	)
	return hashStudyBytes(
		encodeStudyJSON({
			members: members
				.map(({ key, digest, size }) => ({
					key,
					digest,
					size: manifests.includes(key) ? undefined : size,
				}))
				.toSorted((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
			packages: packages
				.map((entry) => ({
					...entry,
					root: relative(destination, entry.root).split(sep).join('/'),
				}))
				.toSorted((left, right) => (left.root < right.root ? -1 : left.root > right.root ? 1 : 0)),
		}),
	)
}

/** Computes the location-independent native execution identity.
 * @param inventory - The captured Node version and execution settings.
 * @returns The SHA-256 identity of the native runtime declaration.
 * @example
 * ```ts
 * declare const loader: ArtifactLoader
 * computeArtifactRuntimeDigest(loader.inspect()) // a SHA-256 hex digest
 * ```
 */
export function computeArtifactRuntimeDigest(inventory: ArtifactInventory): string {
	return hashStudyBytes(encodeStudyJSON({ node: inventory.node, runtime: inventory.runtime }))
}

/** Computes a location-independent identity of captured code and selected entries.
 * @remarks
 * A package root's manifest binds by its projection digest alone, without its byte size.
 * @param inventory - The code inventory, without custody-only assets.
 * @param entry - The trusted Study executable's byte digest; undefined leaves the executable out of the identity.
 * @returns The SHA-256 identity relative to the admitted roots' common base.
 * @example
 * ```ts
 * declare const loader: ArtifactLoader
 * declare const entry: string
 * computeArtifactContentDigest(loader.inspect(), entry) // a SHA-256 hex digest
 * ```
 */
export function computeArtifactContentDigest(inventory: ArtifactInventory, entry?: string): string {
	const manifests = inventory.packages.map((member) => join(member.root, 'package.json'))
	const base = resolveArtifactBase(manifests)
	return hashStudyBytes(
		encodeStudyJSON({
			entry,
			entries: inventory.entries.map((path) => relative(base, path).split(sep).join('/')).sort(),
			source:
				inventory.source === undefined
					? undefined
					: {
							root: relative(base, inventory.source.root).split(sep).join('/'),
							entry: relative(base, inventory.source.entry).split(sep).join('/'),
						},
			packages: inventory.packages
				.map((member) => ({ ...member, root: relative(base, member.root).split(sep).join('/') }))
				.toSorted((left, right) => (left.root < right.root ? -1 : left.root > right.root ? 1 : 0)),
			files: inventory.files
				.map(({ path, digest, size }) => ({
					key: relative(base, path).split(sep).join('/'),
					digest,
					size: manifests.includes(path) ? undefined : size,
				}))
				.toSorted((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
		}),
	)
}

/** Verifies complete copied membership, path safety, exact bytes, and portable identity.
 * @param closure - The materialization record to verify independently.
 * @param published - If true, permits the root publication marker; if false, refuses every extra file. Default: false.
 * @returns Nothing when the entire forest matches.
 * @throws ArtifactError - Thrown for malformed records, changed membership, bytes, or physical paths.
 * @example
 * ```ts
 * declare const closure: ArtifactClosure
 * verifyArtifactClosure(closure, true) // returns when the published forest matches the record
 * ```
 */
export function verifyArtifactClosure(closure: ArtifactClosure, published = false): void {
	if (!isArtifactClosure(closure))
		throw new ArtifactError('Artifact closure record is invalid', 'NAME')
	if (!readArtifactPhysical(closure.destination).isDirectory())
		throw new ArtifactError('Artifact closure requires a directory', 'DRIFT')
	const keys = new Set(closure.members.map((member) => member.key))
	if (keys.size !== closure.members.length)
		throw new ArtifactError('Artifact member key is duplicated', 'DUPLICATE')
	if (
		new Set(closure.members.map((member) => member.key.toLowerCase())).size !==
		closure.members.length
	)
		throw new ArtifactError('Artifact member keys have a case alias', 'ALIAS')
	const directories = [{ path: closure.destination, depth: 0 }]
	const visited: string[] = []
	const files: Array<{ readonly path: string; readonly identity: string; readonly size: number }> =
		[]
	for (const directory of directories) {
		if (directory.depth > ARTIFACT_DEPTH)
			throw new ArtifactError('Artifact directory depth limit exceeded', 'LIMIT')
		const handle = opendirSync(directory.path)
		try {
			for (const entry of iterateArtifactEntries(handle)) {
				const path = join(directory.path, entry.name)
				visited.push(path)
				if (visited.length > ARTIFACT_VISITS)
					throw new ArtifactError('Artifact traversal limit exceeded', 'LIMIT')
				const stat = readArtifactPhysical(path)
				if (stat.isDirectory()) {
					if (
						!closure.members.some((member) =>
							containsArtifact(path, resolveArtifactMember(closure.destination, member.key)),
						)
					)
						throw new ArtifactError('Artifact closure membership drifted', 'DRIFT')
					directories.push({ path, depth: directory.depth + 1 })
					continue
				}
				if (!stat.isFile()) throw new ArtifactError('Artifact closure contains a non-file', 'DRIFT')
				if (published && path === join(closure.destination, 'closure.json')) continue
				const key = relative(closure.destination, path).split(sep).join('/')
				if (!keys.has(key)) throw new ArtifactError('Artifact closure membership drifted', 'DRIFT')
				files.push({ path, identity: `${stat.dev}:${stat.ino}`, size: Number(stat.size) })
				if (files.length > ARTIFACT_FILES)
					throw new ArtifactError('Artifact closure exceeds its capture allowance', 'LIMIT')
			}
		} finally {
			handle.closeSync()
		}
	}
	if (files.length !== closure.members.length)
		throw new ArtifactError('Artifact closure membership drifted', 'DRIFT')
	if (files.reduce((sum, file) => sum + file.size, 0) > ARTIFACT_BYTES)
		throw new ArtifactError('Artifact closure exceeds its capture allowance', 'LIMIT')
	if (new Set(files.map((file) => file.identity)).size !== files.length)
		throw new ArtifactError('Artifact members have a physical alias', 'ALIAS')
	const manifests = new Set(closure.options.roots.map((root) => join(root, 'package.json')))
	for (const member of closure.members) {
		const path = resolveArtifactMember(closure.destination, member.key)
		const file = readArtifact(path)
		if (
			manifests.has(path)
				? computeArtifactManifestDigest(file.source) !== member.digest
				: file.digest !== member.digest || file.size !== member.size
		)
			throw new ArtifactError('Artifact closure bytes drifted', 'DRIFT')
	}
	const selected = [
		...closure.options.entries,
		...(closure.options.assets ?? []),
		...(closure.options.excluded ?? []),
		...(closure.options.source === undefined ? [] : [closure.options.source.entry]),
	]
	if (
		selected.some((path) => !files.some((file) => file.path === path)) ||
		closure.options.roots.some(
			(root) => root !== closure.destination && !containsArtifact(closure.destination, root),
		) ||
		(closure.options.source !== undefined &&
			closure.options.source.root !== closure.destination &&
			!containsArtifact(closure.destination, closure.options.source.root))
	)
		throw new ArtifactError('Artifact closure selection traverses its population', 'TRAVERSAL')
	const packages = closure.options.roots.map((root): ArtifactPackage => {
		const manifest = readArtifact(join(root, 'package.json'))
		const value = parseJSON(Buffer.from(manifest.source).toString('utf8'))
		if (!isRecord(value) || !isString(value.name) || !isString(value.version))
			throw new ArtifactError('Artifact closure manifest is invalid', 'DRIFT')
		return { root, name: value.name, version: value.version }
	})
	if (
		computeArtifactClosureDigest(closure.members, packages, closure.destination) !== closure.digest
	)
		throw new ArtifactError('Artifact closure identity drifted', 'DRIFT')
}

/** Fills a buffer from an open descriptor, one positioned read at a time.
 * @param descriptor - The open file descriptor to read.
 * @param target - The buffer to fill.
 * @param offset - The position in the file and the buffer to continue from; Default: 0.
 * @returns The bytes read, as the whole buffer when the file filled it or as its leading part when the file ended first.
 * @example
 * ```ts
 * declare const descriptor: number
 * readArtifactBytes(descriptor, Buffer.alloc(4)) // the file's first 4 bytes, or fewer when it is shorter
 * ```
 */
export function readArtifactBytes(descriptor: number, target: Buffer, offset = 0): Buffer {
	if (offset >= target.length) return target
	const count = readSync(descriptor, target, offset, target.length - offset, offset)
	return count === 0
		? target.subarray(0, offset)
		: readArtifactBytes(descriptor, target, offset + count)
}

/** Iterates the remaining entries of an open directory handle lazily, in read order.
 * @param handle - The open synchronous directory handle; the caller owns it and closes it.
 * @returns Each remaining entry until the handle reports the end. An entry is read only when the consumer asks for it, so a consumer that stops early leaves the rest unread.
 * @example
 * ```ts
 * import { opendirSync } from 'node:fs'
 *
 * declare const directory: string
 * const handle = opendirSync(directory)
 * const names = [...iterateArtifactEntries(handle)].map((entry) => entry.name) // every entry's name
 * handle.closeSync()
 * ```
 */
export function* iterateArtifactEntries(handle: Dir): Generator<Dirent, void> {
	for (;;) {
		const entry = handle.readSync()
		if (entry === null) return
		yield entry
	}
}

/** Computes a package-root manifest's identity: its parsed JSON with each install intent member deleted whole, serialized by `JSON.stringify` in the remaining member order.
 * @remarks
 * Capture and every later comparison of a package root's `package.json` use this digest; the
 * captured copy keeps its exact bytes.
 * @param source - The manifest's exact bytes.
 * @returns The SHA-256 digest of the projection's text.
 * @throws ArtifactError - Thrown when the bytes do not parse as a JSON object.
 * @example
 * ```ts
 * const declared = Buffer.from('{"name":"fixture","version":"1.0.0","dependencies":{"helper":"^1.0.0"}}')
 * const bare = Buffer.from('{"name":"fixture","version":"1.0.0"}')
 * computeArtifactManifestDigest(declared) === computeArtifactManifestDigest(bare) // true
 * ```
 */
export function computeArtifactManifestDigest(source: Uint8Array): string {
	const value = parseJSON(Buffer.from(source).toString('utf8'))
	if (!isRecord(value)) throw new ArtifactError('Artifact manifest is not a JSON object')
	return hashStudyBytes(
		JSON.stringify(
			Object.fromEntries(
				Object.entries(value).filter(([key]) => !ARTIFACT_MANIFEST_INTENT.includes(key)),
			),
		),
	)
}

/** Reads a bounded regular file only through its canonical absolute path.
 * @param path - The absolute path to inspect.
 * @param maximum - The remaining capture budget; Default: 16 MiB.
 * @returns Captured bytes with their identity.
 * @throws Thrown when the path is linked, noncanonical, oversized, or changes while read.
 * @example
 * ```ts
 * declare const path: string
 * readArtifact(path).source // the file's captured bytes
 * ```
 */
export function readArtifact(path: string, maximum = ARTIFACT_FILE_BYTES): ArtifactSource {
	if (
		!Number.isSafeInteger(maximum) ||
		maximum < 0 ||
		!isAbsolute(path) ||
		resolve(path) !== path ||
		realpathSync(path) !== path ||
		!lstatSync(path).isFile()
	) {
		throw new ArtifactError(`Artifact requires a canonical regular file and byte budget: ${path}`)
	}
	readArtifactPhysical(path)
	const descriptor = openSync(path, 'r')
	try {
		const before = fstatSync(descriptor)
		if (!before.isFile() || before.size > Math.min(maximum, ARTIFACT_FILE_BYTES))
			throw new ArtifactError(`Artifact byte limit exceeded: ${path}`)
		const source = readArtifactBytes(descriptor, Buffer.alloc(before.size))
		if (source.length !== before.size)
			throw new ArtifactError(`Artifact file drifted while reading: ${path}`)
		const after = fstatSync(descriptor)
		if (
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs ||
			realpathSync(path) !== path ||
			!lstatSync(path).isFile()
		)
			throw new ArtifactError(`Artifact file drifted while reading: ${path}`)
		return { path, digest: hashStudyBytes(source), size: source.byteLength, source }
	} finally {
		closeSync(descriptor)
	}
}
