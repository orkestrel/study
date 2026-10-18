import type { LoadHookSync, ResolveHookSync } from 'node:module'

/** Names Node's synchronous resolution continuation. */
export type ArtifactResolveHandler = Parameters<ResolveHookSync>[2]

/** Names Node's synchronous loading continuation. */
export type ArtifactLoadHandler = Parameters<LoadHookSync>[2]

/** Selects a consumer-owned executable source directory and its exact adapter entry.
 * @remarks Source JSON assets are not admitted; parsed fixtures and rubrics retain separate identities.
 */
export interface ArtifactSourceOptions {
	readonly root: string
	readonly entry: string
}

/** Selects built packages and an optional separate consumer source graph. */
export interface ArtifactOptions {
	readonly entries: readonly string[]
	readonly roots: readonly string[]
	readonly source?: ArtifactSourceOptions
	/** Selects one already admitted trusted instrument package permitted to import loader builtins. */
	readonly instrument?: string
	/** Refuses these built files at every import edge; the inventory identity is unchanged. */
	readonly excluded?: readonly string[]
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
