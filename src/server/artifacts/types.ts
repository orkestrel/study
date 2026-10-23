import type { LoadHookSync, ResolveHookSync } from 'node:module'

/** Names Node's synchronous resolution continuation. */
export type ArtifactResolveHandler = Parameters<ResolveHookSync>[2]

/** Names Node's synchronous loading continuation. */
export type ArtifactLoadHandler = Parameters<LoadHookSync>[2]

/** Selects a consumer-owned executable source directory and its exact adapter entry.
 * @remarks Source JSON assets are not executable imports; explicitly selected assets retain custody only.
 */
export interface ArtifactSourceOptions {
	readonly root: string
	readonly entry: string
}

/** Selects built packages and an optional separate consumer source graph. */
export interface ArtifactLoaderOptions {
	readonly entries: readonly string[]
	readonly roots: readonly string[]
	readonly source?: ArtifactSourceOptions
	/** Selects one already admitted trusted instrument package permitted to import loader builtins. */
	readonly instrument?: string
	/** Refuses these built files at every import edge; the inventory identity is unchanged. */
	readonly excluded?: readonly string[]
	/** Admits explicitly selected canonical regular files without granting import eligibility. */
	readonly assets?: readonly string[]
}

/** Names the refused boundary of a captured or materialized artifact graph. */
export type ArtifactErrorCode =
	| 'ARTIFACT'
	| 'TRAVERSAL'
	| 'REDIRECT'
	| 'ALIAS'
	| 'NAME'
	| 'DUPLICATE'
	| 'OCCUPIED'
	| 'OVERLAP'
	| 'STALE'
	| 'VOLUME'
	| 'DRIFT'
	| 'LIMIT'

/** Maps one admitted physical file to its exact bytes inside a materialized forest. */
export interface ArtifactMember {
	/** Names the canonical source path retained as provenance, never used for relocated loading. */
	readonly source: string
	/** Names a portable slash-separated key relative to the closure destination. */
	readonly key: string
	readonly digest: string
	readonly size: number
}

/** Binds a verified physical forest to its relocated selections and complete membership.
 * @remarks
 * Digest hashes sorted member keys, digests, sizes, and package roots relative to destination
 * with their names and versions. Source paths and destination are excluded from that digest.
 * Options contains canonical destination paths and preserves nested node_modules and distinct
 * physical copies of one package. Members include non-entry dependencies and explicit assets.
 * This value proves copying and verification, not successful adapter validation or publication.
 */
export interface ArtifactClosure {
	readonly destination: string
	readonly digest: string
	readonly options: ArtifactLoaderOptions
	readonly members: readonly ArtifactMember[]
}

/** Captures, verifies, loads, and materializes one admitted physical artifact graph. */
export interface ArtifactLoaderInterface {
	/** Captures the complete admitted population without evaluating modules.
	 * @returns The immutable inventory and runtime identity.
	 */
	inspect(): ArtifactInventory
	/** Refuses changed bytes or membership after inspection.
	 * @returns Nothing when the inspected population still matches.
	 */
	verify(): void
	/** Loads an admitted entry through captured-byte hooks in a fresh process.
	 * @param entry - The canonical selected module path.
	 * @returns The actual module namespace.
	 */
	load(entry: string): Promise<unknown>
	/** Copies the inspected physical forest into an exclusive absent destination.
	 * @remarks
	 * Preserves relative resolution and duplicate package copies. Refuses different source or
	 * destination volumes, overlapping or occupied destinations, redirected ancestors, aliases, unsafe names,
	 * duplicate keys, traversal, and stale source references before copying through them. Applies
	 * the aggregate ARTIFACT limits to the whole population, verifies source before and after copy,
	 * and independently verifies destination bytes and membership before returning. Separate path
	 * checks and reads do not establish an atomic snapshot or concurrent hardlink-race resistance.
	 * This operation writes no completion marker; freeze validates in a fresh captured child first.
	 * @param destination - The absolute absent directory under an existing physical parent.
	 * @returns The verified relocation and complete physical membership.
	 * @throws ArtifactError - Thrown with the refused boundary's ArtifactErrorCode.
	 */
	materialize?(destination: string): Promise<ArtifactClosure>
}

/** Records the exact bytes admitted at one absolute file path. */
export interface ArtifactFile {
	readonly path: string
	readonly digest: string
	readonly size: number
}

/** Records the identity declared by an admitted package manifest. */
export interface ArtifactPackage {
	readonly root: string
	readonly name: string
	readonly version: string
}

/** Records all admitted module bytes, selections, and native runtime identity. */
export interface ArtifactInventory {
	readonly digest: string
	readonly node: string
	readonly runtime: ArtifactRuntime
	readonly entries: readonly string[]
	readonly packages: readonly ArtifactPackage[]
	readonly source?: ArtifactSourceOptions
	readonly instrument?: string
	readonly files: readonly ArtifactFile[]
	/** Binds explicit custody-only selections independently of executable entries. */
	readonly assets?: readonly string[]
}

/** Binds native conditions and host-sensitive builtin behavior to the inventory. */
export interface ArtifactRuntime {
	readonly arguments: readonly string[]
	readonly platform: string
	readonly architecture: string
	readonly options?: string
}

/** Retains captured bytes for the native loader. */
export interface ArtifactSource extends ArtifactFile {
	readonly source: Uint8Array
}

/** Counts the directory entries visited and the file bytes admitted so far in one capture. */
export interface ArtifactTally {
	readonly visits: number
	readonly bytes: number
}

/** Supplies the private namespace and separate source selection to resolution. */
export interface ArtifactHookInput {
	readonly token: string
	readonly files: readonly ArtifactSource[]
	readonly source?: ArtifactSourceOptions
	readonly instrument?: string
	readonly excluded?: readonly string[]
}
