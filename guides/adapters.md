# Consumer adapters

> Trusted domain validation, isolated drivers, and independent grading.

The public surface is exported from `@orkestrel/study/server`.

## Consumer boundary

An authored consumer module exports a factory named createStudyAdapter. The factory returns an adapter with validation, driver construction, and retained-evidence grading. Validation receives generic declarations before subject or provider modules execute. A driver receives admitted module namespaces, its execution profile, and exclusive scratch resources.

Keep grading criteria outside public goal input. Grade retained observations and evidence independently of execution. Return unknown judgments when evidence is unavailable; preserve the criterion's declared method. Adapter code runs as trusted instrumentation in bounded child work and is not a security sandbox.

## Surface

The following declarations describe this concept.

| Name | Kind | Summary |
| --- | --- | --- |
| `StudyAdapterInterface` | interface | Defines the consumer's domain checks, driver construction, and retained-evidence grading. |
| `StudyAdjudication` | interface | Holds retained observations and independent criteria for a grading operation. |
| `StudyDriverOptions` | interface | Supplies admitted modules and an exclusive scratch parent without grader truth. |
| `StudyValidation` | interface | Holds declarations for domain validation before subject or provider execution. |
| `isStudyAdapter` | function | Checks whether a factory returned the complete consumer adapter contract. |
| `readStudyAdapter` | function | Reads a complete adapter from an admitted module namespace. |

## Methods

The following tables name the callable members.

#### `StudyAdapterInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `driver` | Constructs the consumer's driver over admitted module namespaces. |
| `grade` | Judges retained evidence without changing the executed trajectory. |
| `validate` | Checks domain declarations before loading a selected subject or provider. |

## Examples

The following calls illustrate the declared contracts. Supply the arguments named by each declaration.

### Refuse an incomplete adapter

Use the exported declaration with its documented arguments.

```ts
import { isStudyAdapter } from '@orkestrel/study/server'

isStudyAdapter({}) // false
```

### Helper calls

Supply the argument tuple from each helper's signature.

```ts
import { readStudyAdapter } from '@orkestrel/study/server'

declare const readStudyAdapterArguments: Parameters<typeof readStudyAdapter>
readStudyAdapter(...readStudyAdapterArguments)
```

### Call StudyAdapterInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyAdapterInterface } from '@orkestrel/study/server'

declare const instance: StudyAdapterInterface
declare const driver: Parameters<StudyAdapterInterface['driver']>
instance.driver(...driver)
declare const grade: Parameters<StudyAdapterInterface['grade']>
instance.grade(...grade)
declare const validate: Parameters<StudyAdapterInterface['validate']>
instance.validate(...validate)
```

## Tests

See the behavioral proofs in the following directories.

- [tests/src/server/adapters](../tests/src/server/adapters)
