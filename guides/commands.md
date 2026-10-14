# Study commands

> Explicit execution, grading, label import, and report selection.

The public surface is exported from `@orkestrel/study/server`.

## Native command

Install the package in the consumer workspace, then run the study executable from that workspace. The workspace supplies studies/<name>/study.json, scenarios.json, profiles/<name>.json, and the separately selected adapter and rubric artifacts. The profile defaults to local. JSON declarations use the public definition, scenario, profile, and rubric contracts.

The command supports explicit operations with operation-specific flags. Every flag takes a value and can appear once.

| Operation | Command | Result |
| --- | --- | --- |
| Validate | study check <study> [--profile <name>] | Fingerprint and suggested pinned execution arguments |
| Execute | study execute <study> [--profile <name>] [--out <path>] [--expected <sha256>] | Execution result identity and suggested independent grading arguments |
| Grade | study grade <result> --rubric <path> | Immutable grading identity and suggested report arguments |
| Import labels | study label <result> --grading <sha256> --labels <path> | Another immutable grading identity and suggested report arguments |
| Report | study report <result> --grading <sha256> | Whole-horizon results for the selected grading |

Success writes a JSON document. The next field contains suggested argv and never executes it automatically. Execution returns a result identity independently of the original study selector. Result selection accepts an identity under tmp/studies, a contained root-relative path, or an absolute path. Relative output paths stay inside the consumer working directory; existing output directories refuse execution.

Check returns a fingerprint for the declared execution selection. Pass that fingerprint through --expected to pin execution. Grade names an exact independent rubric path. Label and report require an exact grading identity; no operation guesses a grading version. Imported labels are caller-supplied bytes, not a labeler invoked by this command.

Help succeeds on stdout when --help appears anywhere. Empty arguments and invalid public grammar report on stderr with exit code 64. Operational diagnostics carry a study:CODE prefix and the refused token or path when applicable. Other exits are 0 for success, 124 for deadline, 130 for interruption, and 1 for operational failure. Private child routes require the native IPC boundary.

Check, grade, label, and report have a fixed 60-second allowance. Execution checks first, then uses the declared series duration with a 15-second cleanup allowance. The command supervises process trees; consumer adapters remain trusted code.

## Guide parity

Run read-only parity before choosing a rewrite direction. An explicit direction updates compared summaries and titled examples, then reports unresolved drift.

```ts
// Run in the package checkout:
// npm run test:guides
// npm run test:guides -- --to guide
// npm run test:guides -- --to source
```

## Surface

The following declarations describe this concept.

| Name | Kind | Summary |
| --- | --- | --- |
| `STUDY_COMMAND_DURATION` | const | Caps declared execution duration at the native supervisor's host ceiling. |
| `STUDY_COMMAND_GRADER` | const | Fixes the trusted command's independent offline predicate version. |
| `STUDY_COMMAND_HELP` | const | Defines the complete public CLI reference shared by help and grammar diagnostics. |
| `StudyCLI` | class | Dispatches private child routes before the public native supervisor. |
| `StudyCommand` | class | Executes validated study operations with execution and grading custody kept independent. |
| `StudyCommandArtifact` | interface | Holds one bounded source artifact retained during offline validation. |
| `StudyCommandOptions` | interface | Holds the trusted application entry and repository location. |
| `StudyCommandRequest` | type | Names the independently dispatched study command operation. |
| `StudyExecutionRequest` | interface | Holds a checked execution selection with optional output custody. |
| `StudyGradeRequest` | interface | Holds an offline predicate grading request. |
| `StudyGradingContext` | interface | Holds artifacts already verified inside a selected immutable grading directory. |
| `StudyLabelRequest` | interface | Holds an imported-label grading request. |
| `StudyLaunchOptions` | interface | Selects the native command entry and the caller's consumer root. |
| `StudyLaunchResult` | interface | Retains the bounded command exit and captured output. |
| `StudyLauncher` | class | Supervises finite command trees and binds offline check to execution. |
| `StudyPreparation` | interface | Holds checked public declarations and reproducible executable identities. |
| `StudyReportRequest` | interface | Holds a selected immutable report request. |
| `collectStudyEvidence` | function | Reads sealed evidence bytes through custody checks without loading executable code. |
| `computeStudyCommandFingerprint` | function | Computes the native supervisor's exact validated execution fingerprint. |
| `computeStudyFixtureDigest` | function | Computes public fixture identity from execution policy and exact scenario bytes. |
| `computeStudyReport` | function | Computes whole-horizon results with operational costs and repetitions kept distinct. |
| `parseStudyArguments` | function | Parses public command tokens with operation-specific grammar diagnostics. |
| `resolveStudyPath` | function | Resolves a portable relative artifact path strictly inside its selected directory. |
| `resolveStudyProfile` | function | Resolves the execution profile's caller-selected built artifact paths. |

## Methods

The following tables name the callable members.

#### `StudyCLI`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `execute` | Executes one route with truthful public exit semantics. |

#### `StudyCommand`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `execute` | Parses command tokens once and executes their independent operation. |

#### `StudyLauncher`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `execute` | Checks and supervises the requested command under its finite native allowance. |

## Examples

The following calls illustrate the declared contracts. Supply the arguments named by each declaration.

### resolveStudyPath

Use the exported declaration with its documented arguments.

```ts
import { resolveStudyPath } from '@orkestrel/study/server'

resolveStudyPath(directory, 'profiles/local.json')
```

### resolveStudyProfile

Use the exported declaration with its documented arguments.

```ts
import { resolveStudyProfile } from '@orkestrel/study/server'

resolveStudyProfile(root, profile)
```

### computeStudyCommandFingerprint

Use the exported declaration with its documented arguments.

```ts
import { computeStudyCommandFingerprint } from '@orkestrel/study/server'

computeStudyCommandFingerprint(identity, bounds)
```

### computeStudyFixtureDigest

Use the exported declaration with its documented arguments.

```ts
import { computeStudyFixtureDigest } from '@orkestrel/study/server'

computeStudyFixtureDigest(definition, scenarios)
```

### collectStudyEvidence

Use the exported declaration with its documented arguments.

```ts
import { collectStudyEvidence } from '@orkestrel/study/server'

await collectStudyEvidence(result)
```

### computeStudyReport

Use the exported declaration with its documented arguments.

```ts
import { computeStudyReport } from '@orkestrel/study/server'

computeStudyReport(result, rubric, grading)
```

### Parse a study command

Use the exported declaration with its documented arguments.

```ts
import { parseStudyArguments } from '@orkestrel/study/server'

parseStudyArguments(['check', 'files', '--profile', 'local'])
```

### Call StudyCLI methods

Supply an instance of the declared contract.

```ts
import type { StudyCLI } from '@orkestrel/study/server'

declare const instance: StudyCLI
declare const execute: Parameters<StudyCLI['execute']>
instance.execute(...execute)
```

### Call StudyCommand methods

Supply an instance of the declared contract.

```ts
import type { StudyCommand } from '@orkestrel/study/server'

declare const instance: StudyCommand
declare const execute: Parameters<StudyCommand['execute']>
instance.execute(...execute)
```

### Call StudyLauncher methods

Supply an instance of the declared contract.

```ts
import type { StudyLauncher } from '@orkestrel/study/server'

declare const instance: StudyLauncher
declare const execute: Parameters<StudyLauncher['execute']>
instance.execute(...execute)
```

## Tests

See the behavioral proofs in the following directories.

- [tests/src/server/commands](../tests/src/server/commands)
- [tests/src/bin](../tests/src/bin)
