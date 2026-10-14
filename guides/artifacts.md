# Artifact loading

> Captured module bytes and native resolution in disposable workers.

The public surface is exported from `@orkestrel/study/server`.

## Captured loading

Select canonical absolute package roots and built ESM entries under each package's dist directory. Inspection captures bytes without evaluating modules. Verification compares captured bytes to disk. Loading evaluates the selected entry through captured-byte hooks and verifies again after evaluation.

Select a consumer-owned source directory separately when the adapter needs strip-only TypeScript. Its graph cannot overlap a built package graph. Source JSON assets are excluded; fixture and rubric bytes retain separate identities. Native package exports and extension rules still govern resolution. The inventory records package manifests, captured files, selected entries, Node version, and runtime settings.

Run loading in a disposable worker and terminate the worker afterwards. A process admits one loaded inventory. Trusted code can use native process APIs, evaluation, and external services; the loader does not replay those resources or sandbox hostile code.

### Inspect selected bytes

Supply a canonical named ESM package root and an admitted built entry. The returned inventory identifies the selected bytes without executing the entry.

```ts
import { Artifacts } from '@orkestrel/study/server'

declare const root: string
declare const entry: string

const artifacts = new Artifacts({ roots: [root], entries: [entry] })
const inventory = artifacts.inspect()
inventory.entries.includes(entry) // true
artifacts.verify()
```

## Surface

The following declarations describe this concept.

| Name | Kind | Summary |
| --- | --- | --- |
| `ARTIFACT_BYTES` | const | Bounds all captured input bytes to 128 MiB. |
| `ARTIFACT_DEPTH` | const | Bounds directory nesting below each selected root. |
| `ARTIFACT_FILES` | const | Bounds admitted files before another capture is allocated. |
| `ARTIFACT_FILE_BYTES` | const | Bounds one captured input file to 16 MiB. |
| `ARTIFACT_ROOTS` | const | Bounds selected package roots before traversal begins. |
| `ARTIFACT_VISITS` | const | Bounds all visited directory entries, including ignored assets. |
| `ArtifactError` | class | Reports an invalid or drifted artifact inventory. |
| `ArtifactFile` | interface | Records the exact bytes admitted at one absolute file path. |
| `ArtifactHookInput` | interface | Supplies the private namespace and separate source selection to resolution. |
| `ArtifactInventory` | interface | Records all admitted module bytes, selections, and native runtime identity. |
| `ArtifactLoadHandler` | type | Names Node's synchronous loading continuation. |
| `ArtifactOptions` | interface | Selects built packages and an optional separate consumer source graph. |
| `ArtifactPackage` | interface | Records the identity declared by an admitted package manifest. |
| `ArtifactResolveHandler` | type | Names Node's synchronous resolution continuation. |
| `ArtifactRuntime` | interface | Binds native conditions and host-sensitive builtin behavior to the inventory. |
| `ArtifactSource` | interface | Retains captured bytes for the native loader. |
| `ArtifactSourceOptions` | interface | Selects a consumer-owned executable source directory and its exact adapter entry. |
| `Artifacts` | class | Captures built ESM and a separate strip-only consumer adapter in a fresh worker. |
| `Resolution` | class | Enforces captured inventory membership at every synchronous native import edge. |
| `containsArtifact` | function | Checks strict lexical containment under a selected directory. |
| `hashBytes` | function | Computes a SHA-256 identity for exact bytes. |
| `isArtifactError` | function | Narrows a caught value to an artifact refusal. |
| `readArtifact` | function | Reads a bounded regular file only through its canonical absolute path. |

## Methods

The following tables name the callable members.

#### `Artifacts`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `inspect` | Reads and identifies admitted files without evaluating selected modules. |
| `load` | Imports one selected entry through synchronous captured-byte hooks. |
| `verify` | Refuses byte and population drift since inspection. |

#### `Resolution`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `load` | Returns captured bytes after verifying their live disk identity. |
| `resolve` | Resolves native edges with source-local JavaScript-to-TypeScript substitution. |

## Examples

The following calls illustrate the declared contracts. Supply the arguments named by each declaration.

### Identify captured bytes

Use the exported declaration with its documented arguments.

```ts
import { hashBytes } from '@orkestrel/study/server'

hashBytes('retained evidence')
```

### Helper calls

Supply the argument tuple from each helper's signature.

```ts
import { containsArtifact, isArtifactError, readArtifact } from '@orkestrel/study/server'

declare const containsArtifactArguments: Parameters<typeof containsArtifact>
containsArtifact(...containsArtifactArguments)
declare const isArtifactErrorArguments: Parameters<typeof isArtifactError>
isArtifactError(...isArtifactErrorArguments)
declare const readArtifactArguments: Parameters<typeof readArtifact>
readArtifact(...readArtifactArguments)
```

### Call Artifacts methods

Supply an instance of the declared contract.

```ts
import type { Artifacts } from '@orkestrel/study/server'

declare const instance: Artifacts
declare const inspect: Parameters<Artifacts['inspect']>
instance.inspect(...inspect)
declare const load: Parameters<Artifacts['load']>
instance.load(...load)
declare const verify: Parameters<Artifacts['verify']>
instance.verify(...verify)
```

### Call Resolution methods

Supply an instance of the declared contract.

```ts
import type { Resolution } from '@orkestrel/study/server'

declare const instance: Resolution
declare const load: Parameters<Resolution['load']>
instance.load(...load)
declare const resolve: Parameters<Resolution['resolve']>
instance.resolve(...resolve)
```

## Tests

See the behavioral proofs in the following directories.

- [tests/src/server/artifacts](../tests/src/server/artifacts)
