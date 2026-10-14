# Study

> Bounded comparative execution with captured artifacts and separate grading.

The host-independent engine is exported from `@orkestrel/study`; custody and native workers are exported from `@orkestrel/study/server`.

## Execution and evidence

Declare the question, purpose, arms, scenarios, repetition order, and rubric before execution. Each repetition row names every arm exactly once. The engine opens fresh state for each trial and retains state between that trial's ordered goals. It executes the declared schedule once; retries are disabled.

The request meter reserves token and byte ceilings before an adapter dispatches work. Request, goal, trial, and series limits bound enclosing work. Missing actual usage remains unknown and consumes the admitted ceiling. Capacity, infrastructure, deadline, and interruption are operational outcomes; a product never awards its own task verdict.

The driver receives a borrowed admission interface and an evidence sink. The concrete engine owns the meter's closing lifecycle. Native workers await parent admission and acknowledge request settlement; each trial runs in a fresh child. Trusted adapters can access native resources, so process supervision is not a hostile-code sandbox.

Execution custody creates a result directory exclusively, appends evidence, retains terminal attempts, and seals only a complete scheduled population. A result without a seal remains interrupted. Offline reading verifies the seal's exact file inventory and digests. Changed execution bytes refuse custody verification.

Grading uses a sealed result and independently selected rubric bytes. Immutable grading versions retain their own rubric, packet, mapping, and imported label bytes. Semantic criteria remain unknown until accountable labels are imported. Reports select an exact grading identity and retain unknown criteria in whole-horizon intervals.

### Admit a bounded request

Admit the ceiling before work, then settle the actual measurements. Close the owned resources after the goal ends.

```ts
import { StudyControl, StudyScope, StudyMeter } from '@orkestrel/study'

const control = new StudyControl()
const limit = { duration: 1000, calls: 1, tokens: 8, bytes: 64 }
const scope = new StudyScope({ limit, control, label: 'Goal' })
const meter = new StudyMeter({ request: limit, scopes: [scope], control })
try {
	const ticket = meter.admit({ role: 'tool', tokens: 8, bytes: 64 })
	ticket.finish({ role: 'tool', calls: 1, tokens: 3, bytes: 12, duration: 1 })
	meter.usage // [{ role: 'tool', calls: 1, tokens: 3, bytes: 12, duration: 1 }]
} finally {
	meter.close()
	scope.close()
	control.close()
}
```

### Retain complete execution custody

Supply a validated manifest, a nonexistent directory, and terminal attempts for every scheduled trial. This example's scenarios declare a goal named write. The caller supplies observations; custody validates and retains them without executing the domain driver.

```ts
import type { StudyAttempt, StudyManifest } from '@orkestrel/study'
import { StudyResults, readStudyResult } from '@orkestrel/study/server'

declare const directory: string
declare const manifest: StudyManifest
declare const attempts: readonly StudyAttempt[]

const results = new StudyResults({ directory, manifest })
await results.create()
for (const attempt of attempts) {
	const sink = await results.start(attempt.trial)
	await sink.append({ event: 'saved', goal: 'write', value: 'remember' })
	await results.finish(attempt)
}
const seal = await results.seal()
const reading = await readStudyResult(directory)
reading.status // 'sealed'
if (reading.status === 'sealed') reading.seal.id === seal.id // true
```

## Limits

Captured identities bind admitted files, module selections, and Node runtime settings. They do not identify the entire machine or replay external services. Neutral semantic identifiers omit treatment and model names, but input and product text can reveal design details. This guide's executable examples prove local admission and custody; they do not establish GPU capacity or model quality.

## Surface

The following declarations describe this concept.

| Name | Kind | Summary |
| --- | --- | --- |
| `STUDY_COMMAND_OPERATION` | const | Names the command route beneath the native supervisor. |
| `STUDY_CUSTODY_BYTES` | const | Limits untrusted metadata before JSON parsing or file allocation. |
| `STUDY_DURATION` | const | Limits resource durations to the native timer's supported range. |
| `STUDY_FRAME_BYTES` | const | Limits each serialized IPC envelope, including its JSON framing. |
| `STUDY_GOALS` | const | Caps a declared scenario horizon before execution. |
| `STUDY_LOG_BYTES` | const | Limits combined worker stdout and stderr before termination. |
| `STUDY_NAME` | const | Restricts identifiers to portable path-safe names. |
| `STUDY_PACKET_DISCLOSURE` | const | Discloses the limits of neutral identifiers when public text remains visible. |
| `STUDY_PENDING_LIMIT` | const | Limits outstanding bidirectional protocol work per process. |
| `STUDY_RESERVED_NAME` | const | Rejects names that Windows reserves even on other hosts. |
| `STUDY_TASK_DURATION` | const | Caps pure domain work independently of its event loop. |
| `STUDY_TASK_OPERATION` | const | Names the private bounded validation and grading route. |
| `STUDY_TRIALS` | const | Caps a declared trial population before schedule allocation. |
| `STUDY_WORKER_OPERATION` | const | Names the worker operation routed by the built application entry. |
| `StudyAdmissionInterface` | interface | Admits requests against enclosing limits before an adapter dispatches them. |
| `StudyArtifactIdentity` | interface | Holds the separately bound instrument and selected module inventory identities. |
| `StudyArtifactModules` | interface | Holds actual namespaces loaded only during worker execution. |
| `StudyArtifactOptions` | interface | Holds the trusted instrument and caller-selected built artifact locations. |
| `StudyArtifacts` | class | Binds consumer instrumentation separately from selected executable identities. |
| `StudyAttempt` | interface | Holds a terminal trial record, including goals never dispatched. |
| `StudyBounds` | interface | Holds nested execution allowances; each request also has a deadline. |
| `StudyCause` | type | Names an operational ending separately from task achievement. |
| `StudyChannel` | class | Correlates bounded IPC work and rejects every outstanding request on transport failure. |
| `StudyChannelOptions` | interface | Holds one native IPC endpoint and its domain handlers. |
| `StudyCharge` | interface | Holds a request's pre-dispatch upper bounds. |
| `StudyContext` | interface | Holds the resources visible to one running goal. |
| `StudyControl` | class | Retains the first operational failure while bounding asynchronous waits. |
| `StudyControlInterface` | interface | Owns the first operational failure and cancellation of enclosing work. |
| `StudyCriterion` | interface | Holds a grader-owned criterion outside the driver's public input. |
| `StudyCustodyBudget` | interface | Holds the evidence sink's shared admission budget. |
| `StudyCustodyPhase` | type | Names the execution custody lifecycle without inferring seal completeness. |
| `StudyCustodySinkInterface` | interface | Closes evidence admission and drains already admitted appends. |
| `StudyDefinition` | interface | Holds the frozen study question, population and explicit repetition orders. |
| `StudyDriverInterface` | interface | Creates isolated domain state through a concrete package consumer. |
| `StudyError` | class | Reports a study contract or operational failure with a stable code. |
| `StudyErrorCode` | type | Names malformed configuration, evidence, custody and operational failures. |
| `StudyEvidence` | interface | Holds append-only domain evidence in a JSON-compatible form. |
| `StudyEvidenceOptions` | interface | Holds the owned evidence descriptor and byte admission constraints. |
| `StudyEvidenceSink` | class | Retains admitted evidence in order and closes admission before terminal records. |
| `StudyFailure` | interface | Holds an attributable operational fault without awarding a task verdict. |
| `StudyFile` | interface | Holds the exact byte identity of one execution file. |
| `StudyFrame` | interface | Holds a correlated JSON request, reply or cancellation notification. |
| `StudyGoal` | interface | Holds a declared goal's public input without its grading truth. |
| `StudyGrading` | interface | Holds a grading identity that cannot replace or mutate execution bytes. |
| `StudyGradingOptions` | interface | Holds imported grading artifacts independently of execution. |
| `StudyGradings` | class | Retains immutable deterministic grading versions independently of execution bytes. |
| `StudyIdentity` | interface | Holds byte identities that qualification and comparisons must agree on. |
| `StudyInterruptedResult` | interface | Holds inspected execution metadata that is never gradeable before sealing. |
| `StudyJudgment` | interface | Holds an evidence-backed verdict; missing evidence stays unknown. |
| `StudyLabels` | interface | Holds imported semantic judgments and their accountable origin. |
| `StudyLimit` | interface | Holds finite allowances in milliseconds, calls, tokens and bytes. |
| `StudyManifest` | interface | Holds the execution declaration sealed before any trial begins. |
| `StudyMessageHandler` | type | Handles validated transport requests at their owning domain boundary. |
| `StudyMeter` | class | Admits request ceilings across every enclosing scope before dispatch. |
| `StudyMeterInterface` | interface | Owns request admission and the goal's terminal lifecycle. |
| `StudyMeterOptions` | interface | Supplies the request allowance and all enclosing admission scopes. |
| `StudyObservation` | interface | Holds the retained outcome of a scheduled goal. |
| `StudyOperation` | type | Names the bounded transport's domain operations. |
| `StudyPacketBundle` | interface | Holds exact neutral public packet bytes and private mapping bytes. |
| `StudyPacketEntry` | interface | Holds one neutral semantic grading input without treatment or model identifiers. |
| `StudyPacketLink` | interface | Holds the neutral identity mapping to a sealed semantic trial-criterion pair. |
| `StudyParentTicket` | interface | Holds an authoritative parent ticket and its transport listener lifetime. |
| `StudyProcessDriver` | class | Opens one fresh native child for each scheduled trial. |
| `StudyProcessOptions` | interface | Holds the parent-owned fresh trial process configuration. |
| `StudyProcessSession` | class | Keeps admission and evidence custody in the parent of one fresh trial process. |
| `StudyProcessSessionOptions` | interface | Holds one fresh child trial's launch parameters and cancellation. |
| `StudyProduct` | interface | Holds observed output and partial completion, never self-awarded success. |
| `StudyProfile` | interface | Holds execution settings independently of scenario and grading declarations. |
| `StudyProvider` | interface | Holds caller-selected provider artifacts and model identities. |
| `StudyPurpose` | type | Names the evidence a study can establish. |
| `StudyRemoteMeter` | class | Waits for authoritative parent admission and drains acknowledged settlements. |
| `StudyRemoteMeterInterface` | interface | Owns transported admission, parent cancellation, and settlement drainage. |
| `StudyRemoteMeterOptions` | interface | Holds the worker meter's parent-authorized transport and failure latch. |
| `StudyRemoteTicket` | class | Transmits one settlement without inventing local admission authority. |
| `StudyRemoteTicketOptions` | interface | Holds one transported ticket's identity and settlement owner. |
| `StudyRequest` | class | Settles an admitted request once and propagates operational failure to its owner. |
| `StudyRequestOptions` | interface | Supplies one admitted request with its shared failure owner and settlement sink. |
| `StudyResponse` | interface | Holds an outstanding bounded IPC response. |
| `StudyResultOptions` | interface | Holds the inert execution store configuration. |
| `StudyResultReading` | type | Holds an offline execution reading discriminated by custody completeness. |
| `StudyResults` | class | Owns append-only execution bytes and seals only a complete terminal population. |
| `StudyResultsInterface` | interface | Owns execution custody from exclusive creation through complete sealing. |
| `StudyRole` | type | Names a request's measured responsibility. |
| `StudyRoom` | interface | Holds the model context and generation allowance as separate measurements. |
| `StudyRubric` | interface | Holds a versioned grading declaration independently of execution. |
| `StudyScenario` | interface | Holds ordered goals sharing state within an isolated trial. |
| `StudyScope` | class | Reserves finite request ceilings around cumulative actual budgets and one deadline. |
| `StudyScopeInterface` | interface | Holds cumulative admission ceilings for one timed execution scope. |
| `StudyScopeOptions` | interface | Supplies one deadline and its shared failure owner. |
| `StudyScore` | interface | Holds an arm's whole-horizon counts without hiding unresolved criteria. |
| `StudySeal` | interface | Holds a complete execution inventory and its deterministic identity. |
| `StudySealedResult` | interface | Holds independently verified sealed execution bytes. |
| `StudySeries` | class | Executes a frozen serial study schedule with finite admission and sticky failures. |
| `StudySeriesOptions` | interface | Holds the common engine's fixed execution inputs. |
| `StudySessionInterface` | interface | Owns domain state across a trial and releases it before the next trial. |
| `StudySettlementHandler` | type | Records the settlement of one admitted request. |
| `StudySinkInterface` | interface | Holds an evidence sink whose implementation owns byte limits and custody. |
| `StudyStoreInterface` | interface | Appends terminal records without overwriting a prior attempt. |
| `StudyTask` | class | Bounds adapter evaluation by an independent native parent timer. |
| `StudyTaskOptions` | interface | Holds a bounded adapter-only native operation. |
| `StudyTaskRequest` | type | Carries only declarations or sealed evidence to an adapter child. |
| `StudyTaskResult` | interface | Returns adapter output with the exact active instrumentation digest. |
| `StudyTaskWorker` | class | Evaluates only admitted instrumentation in a disposable native child. |
| `StudyTicket` | interface | Holds one admitted request until its actual charge is recorded. |
| `StudyTrial` | interface | Holds a scheduled trajectory, with a fresh state for each repetition and arm. |
| `StudyTrialCustody` | interface | Holds the trial sink's admitted writes and terminal lifecycle. |
| `StudyUsage` | interface | Holds actual request measurements; absent token usage remains unknown. |
| `StudyWorker` | class | Executes one verified trial behind parent-authorized admission and custody. |
| `awaitStudyProcess` | function | Bounds process handshake or cleanup work independently of cancelled execution. |
| `buildStudyPacket` | function | Builds deterministic public semantic inputs and a separately retained private map. |
| `buildStudyPacketLinks` | function | Builds neutral semantic identities for the complete eligible sealed horizon. |
| `buildStudySchedule` | function | Builds a bounded schedule from explicit repetition rows and declared scenarios. |
| `checkStudyDirectory` | function | Refuses symbolic links and non-directory ancestors before custody operations. |
| `computeStudyPacketDigest` | function | Computes a bundle identity binding exact public packet and private map bytes. |
| `computeStudyProfileDigest` | function | Binds the canonical fully resolved execution profile carried over IPC. |
| `computeStudyScores` | function | Computes arm intervals over the complete declared criterion horizon. |
| `computeStudySealId` | function | Computes an execution seal identity from its exact sorted inventory. |
| `createStudyProcessFailure` | function | Creates attributable protocol infrastructure failure. |
| `encodeStudyJSON` | function | Encodes deterministic JSON bytes without synthesizing execution metadata. |
| `failureToStudyError` | function | Converts an operational reading to its throwable boundary. |
| `hashStudyBytes` | function | Computes the lowercase SHA-256 identity of exact bytes. |
| `isStudyBounds` | function | Checks whether nested scopes admit no larger allowance than their parent. |
| `isStudyCharge` | function | Checks a request's declared role and finite cost ceilings. |
| `isStudyCriterion` | function | Checks whether a criterion declares exact grading inputs and references. |
| `isStudyCustodyAttempt` | function | Checks whether an attempt terminally accounts for the exact scheduled goal horizon. |
| `isStudyCustodyEvidence` | function | Checks whether evidence is exact JSON with a declared event and goal name. |
| `isStudyCustodyFailure` | function | Checks whether a failure carries exact attributable operational fields. |
| `isStudyCustodyFile` | function | Checks whether an execution file inventory entry is path-safe and bounded. |
| `isStudyCustodyManifest` | function | Checks whether a manifest exactly binds its declared population and identities. |
| `isStudyCustodyName` | function | Checks whether a trial name is portable on all supported hosts. |
| `isStudyCustodyObservation` | function | Checks whether an observation preserves output or an explicit unexecuted failure. |
| `isStudyCustodySeal` | function | Checks whether a seal has an exact unique execution inventory. |
| `isStudyCustodyTrial` | function | Checks whether a scheduled trial has exact valid identity fields. |
| `isStudyDefinition` | function | Checks whether a study freezes a complete arm order for every repetition. |
| `isStudyDigest` | function | Checks whether a byte identity is a lowercase SHA-256 digest. |
| `isStudyError` | function | Narrows a caught value to an attributable study error. |
| `isStudyEvidence` | function | Checks append-only public evidence. |
| `isStudyFrame` | function | Checks the complete transport envelope before domain handling. |
| `isStudyGoal` | function | Checks whether a goal has a bounded identifier and exact JSON input. |
| `isStudyGrading` | function | Checks whether grading binds accountable judgments to unique attempt identities. |
| `isStudyIdentity` | function | Checks the exact digest fields carried by the execution declaration. |
| `isStudyJudgment` | function | Checks whether a judgment carries a supported verdict and evidence references. |
| `isStudyLabels` | function | Checks whether imported semantic labels have accountable packet provenance. |
| `isStudyLimit` | function | Checks whether all allowances are positive safe integers within timer bounds. |
| `isStudyName` | function | Checks whether an identifier is portable and bounded. |
| `isStudyProcessFailure` | function | Checks operational failure attribution arriving over IPC. |
| `isStudyProduct` | function | Checks a retained public product without awarding task achievement. |
| `isStudyProfile` | function | Checks whether a profile carries finite bounds and an optional explicit provider. |
| `isStudyProvider` | function | Checks whether a provider declaration names artifacts, an HTTP origin and models. |
| `isStudyRoom` | function | Checks whether generation room leaves positive context for input. |
| `isStudyRubric` | function | Checks whether a rubric declares nonempty criteria with unique identities. |
| `isStudyScenario` | function | Checks whether a scenario declares a nonempty horizon with unique goal ids. |
| `isStudyTimestamp` | function | Checks whether a timestamp is a canonical UTC millisecond instant. |
| `isStudyTrial` | function | Checks a fresh trial's declared identifiers. |
| `isStudyUsage` | function | Checks whether request usage contains nonnegative safe measurements. |
| `matchesStudyKeys` | function | Matches exact own enumerable data keys without evaluating accessors. |
| `parseStudyDefinition` | function | Parses a definition into an independent frozen validated snapshot. |
| `parseStudyGrading` | function | Parses grading into an independent frozen validated evidence snapshot. |
| `parseStudyLabels` | function | Parses semantic labels into an independent frozen validated evidence snapshot. |
| `parseStudyProfile` | function | Parses a profile into an independent frozen validated snapshot. |
| `parseStudyRubric` | function | Parses a rubric into an independent frozen validated snapshot. |
| `parseStudyScenario` | function | Parses a scenario into an independent frozen validated snapshot. |
| `readStudyBytes` | function | Reads bounded regular-file bytes without following a symbolic link. |
| `readStudyFailure` | function | Reads an operational error without inventing a task verdict. |
| `readStudyResult` | function | Inspects custody bytes offline and verifies complete execution before grading. |
| `resolveStudyInstrument` | function | Resolves the actual host package from its trusted executable entry. |
| `scanStudyExecution` | function | Scans regular execution files while refusing unknown directories and linked paths. |
| `terminateStudyChild` | function | Terminates the recorded native process tree under a finite cleanup allowance. |
| `toStudyWire` | function | Projects optional domain fields into the JSON wire representation. |
| `translateStudyPacketLabels` | function | Translates bound neutral imported labels through the sealed semantic horizon. |
| `validateStudyEvidenceBytes` | function | Validates complete evidence lines and per-goal encoded evidence bounds. |
| `validateStudyInputs` | function | Validates grading coverage and request room against the declared study inputs. |
| `validateStudyRuntime` | function | Refuses a profile that omits the actual host runtime's declared dependency bytes. |
| `writeStudyBytes` | function | Writes an exclusive regular record and synchronizes it before reporting success. |

## Methods

The following tables name the callable members.

#### `StudyAdmissionInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `admit` | Resolves admission before dispatch; local meters may return the ticket synchronously. |

#### `StudyArtifacts`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `adapter` | Loads the adapter from the trial inventory. |
| `inspect` | Inventories bytes without importing selected code. |
| `load` | Loads admitted built namespaces inside the trial child. |
| `verify` | Refuses instrument and inventory drift after inspection. |

#### `StudyChannel`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `abort` | Forwards cancellation without closing the cleanup transport. |
| `close` | Removes endpoint handlers and rejects all unresolved calls. |
| `request` | Sends one correlated domain request. |

#### `StudyControl`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `close` | Removes the lifecycle listener without changing the retained failure. |
| `fail` | Latches an operational failure and cancels all linked work. |
| `wait` | Races work against cancellation and removes its listener after either ending. |

#### `StudyControlInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `close` | Removes the lifecycle listener without changing the retained failure. |
| `fail` | Latches an operational failure and cancels all linked work. |
| `wait` | Races work against cancellation and removes its listener after either ending. |

#### `StudyCustodySinkInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `append` | Appends bounded domain evidence to the owned execution record. |
| `close` | Closes admission immediately and synchronizes all previously admitted writes. |

#### `StudyDriverInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `open` | Creates fresh domain state for one scheduled trial. |

#### `StudyEvidenceSink`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `append` | Admits exact encoded bytes before queuing an append in call order. |
| `close` | Closes admission immediately and synchronizes all previously admitted writes. |

#### `StudyGradings`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `read` | Reads an immutable grading version and verifies every bound artifact byte. |
| `write` | Retains a deterministic grading version or verifies identical existing bytes. |

#### `StudyMeter`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `admit` | Reserves one request atomically across all enclosing allowances. |
| `close` | Refuses unfinished requests before closing a goal's admission boundary. |

#### `StudyMeterInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `admit` | Resolves admission before dispatch; local meters may return the ticket synchronously. |
| `close` | Refuses unfinished requests before closing a goal's admission boundary. |

#### `StudyProcessDriver`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `open` | Opens isolated child state and waits for its verified readiness. |

#### `StudyProcessSession`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `close` | Requests verified cleanup, then terminates only this recorded process tree. |
| `execute` | Runs one ordered goal through parent-authorized requests and acknowledged evidence. |
| `start` | Starts the child and verifies its artifact-bound readiness. |

#### `StudyRemoteMeter`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `abort` | Propagates the parent's ticket cancellation without changing its cause. |
| `admit` | Requests and awaits the parent's dispatch grant. |
| `close` | Closes admission and requires every ticket and acknowledgment to finish. |

#### `StudyRemoteMeterInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `abort` | Propagates the parent's ticket cancellation without changing its cause. |
| `admit` | Resolves admission before dispatch; local meters may return the ticket synchronously. |
| `close` | Closes admission and requires every ticket and acknowledgment to finish. |

#### `StudyRemoteTicket`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `fail` | Sends operational failure while preserving unknown actual cost. |
| `finish` | Sends actual usage for authoritative parent settlement. |

#### `StudyRequest`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `fail` | Retains unknown cost conservatively and latches the first operational failure. |
| `finish` | Retains actual measurements and refuses invalid or excessive charges. |

#### `StudyResults`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `create` | Exclusively creates the result directory and initial manifest bytes. |
| `finish` | Closes evidence admission, drains admitted appends, and writes a terminal record. |
| `seal` | Seals exact execution inventory after every scheduled trial has terminated. |
| `start` | Exclusively creates the evidence sink for an exact scheduled trial. |

#### `StudyResultsInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `create` | Exclusively creates the result directory and initial manifest bytes. |
| `finish` | Retains the terminal record for one scheduled trial. |
| `seal` | Seals a complete terminal population with its exact execution-byte inventory. |
| `start` | Opens append-only evidence custody for one scheduled trial. |

#### `StudyScope`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `check` | Checks cumulative consumption and every pending ceiling before admission. |
| `close` | Checks deadline attribution before clearing the timer. |
| `reserve` | Reserves one request after the enclosing meter checked all scopes. |
| `settle` | Commits known charges while retaining ceilings for missing measurements. |

#### `StudyScopeInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `check` | Checks cumulative consumption and every pending ceiling before admission. |
| `close` | Checks deadline attribution before clearing the timer. |
| `reserve` | Reserves one request after the enclosing meter checked all scopes. |
| `settle` | Commits known charges while retaining ceilings for missing measurements. |

#### `StudySeries`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `execute` | Runs every declared trial once and retains explicit unexecuted observations after failure. Custody rejection leaves the run unsealed; callers must seal only a fulfilled execution. |

#### `StudySessionInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `close` | Releases the trial's domain resources. |
| `execute` | Executes one public goal against the trial's retained domain state. |

#### `StudySinkInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `append` | Appends bounded domain evidence to the owned execution record. |

#### `StudyStoreInterface`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `finish` | Retains the terminal record for one scheduled trial. |
| `start` | Opens append-only evidence custody for one scheduled trial. |

#### `StudyTask`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `execute` | Executes one validation or grading operation in a fresh child. |

#### `StudyTaskWorker`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `execute` | Processes exactly one inherited request and returns a bounded response. |

#### `StudyTicket`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `fail` | Records an attributable failure for one admitted request. |
| `finish` | Records actual measurements for one admitted request. |

#### `StudyWorker`

The declaration exposes these methods.

| Method | Summary |
| --- | --- |
| `execute` | Serves the inherited IPC channel until its parent disconnects. |

## Examples

The following calls illustrate the declared contracts. Supply the arguments named by each declaration.

### isStudyError

Use the exported declaration with its documented arguments.

```ts
import { isStudyError } from '@orkestrel/study'

isStudyError(new StudyError('CONFIG', 'missing definition')) // true
```

### Check exact keys

Use the exported declaration with its documented arguments.

```ts
import { matchesStudyKeys } from '@orkestrel/study'

matchesStudyKeys({ id: 'one' }, ['id']) // true
```

### buildStudySchedule

Use the exported declaration with its documented arguments.

```ts
import { buildStudySchedule } from '@orkestrel/study'

buildStudySchedule(definition, scenarios)
```

### validateStudyInputs

Use the exported declaration with its documented arguments.

```ts
import { validateStudyInputs } from '@orkestrel/study'

validateStudyInputs(definition, scenarios, rubric, profile)
```

### computeStudyScores

Use the exported declaration with its documented arguments.

```ts
import { computeStudyScores } from '@orkestrel/study'

computeStudyScores(manifest, rubric, grading)
```

### parseStudyDefinition

Use the exported declaration with its documented arguments.

```ts
import { parseStudyDefinition } from '@orkestrel/study'

parseStudyDefinition(configuration)
```

### parseStudyScenario

Use the exported declaration with its documented arguments.

```ts
import { parseStudyScenario } from '@orkestrel/study'

parseStudyScenario({ id: 'shift', goals: [{ id: 'write', input: {} }] })
```

### parseStudyProfile

Use the exported declaration with its documented arguments.

```ts
import { parseStudyProfile } from '@orkestrel/study'

parseStudyProfile(configuration)
```

### parseStudyRubric

Use the exported declaration with its documented arguments.

```ts
import { parseStudyRubric } from '@orkestrel/study'

parseStudyRubric(configuration)
```

### parseStudyGrading

Use the exported declaration with its documented arguments.

```ts
import { parseStudyGrading } from '@orkestrel/study'

parseStudyGrading(evidence)
```

### parseStudyLabels

Use the exported declaration with its documented arguments.

```ts
import { parseStudyLabels } from '@orkestrel/study'

parseStudyLabels(evidence)
```

### isStudyName

Use the exported declaration with its documented arguments.

```ts
import { isStudyName } from '@orkestrel/study'

isStudyName('memory') // true
```

### isStudyLimit

Use the exported declaration with its documented arguments.

```ts
import { isStudyLimit } from '@orkestrel/study'

isStudyLimit({ duration: 1000, calls: 1, tokens: 100, bytes: 1024 }) // true
```

### isStudyBounds

Use the exported declaration with its documented arguments.

```ts
import { isStudyBounds } from '@orkestrel/study'

isStudyBounds({}) // false
```

### isStudyGoal

Use the exported declaration with its documented arguments.

```ts
import { isStudyGoal } from '@orkestrel/study'

isStudyGoal({ id: 'write', input: { text: 'hello' } }) // true
```

### isStudyScenario

Use the exported declaration with its documented arguments.

```ts
import { isStudyScenario } from '@orkestrel/study'

isStudyScenario({ id: 'shift', goals: [{ id: 'handoff', input: 'Prepare handoff' }] }) // true
```

### isStudyDefinition

Use the exported declaration with its documented arguments.

```ts
import { isStudyDefinition } from '@orkestrel/study'

isStudyDefinition({ name: 'tools' }) // false
```

### isStudyRoom

Use the exported declaration with its documented arguments.

```ts
import { isStudyRoom } from '@orkestrel/study'

isStudyRoom({ context: 20480, output: 8192, safety: 512, recap: 2048, think: true }) // true
```

### isStudyProvider

Use the exported declaration with its documented arguments.

```ts
import { isStudyProvider } from '@orkestrel/study'

isStudyProvider({ entry: 'dist/index.js' }) // false
```

### isStudyProfile

Use the exported declaration with its documented arguments.

```ts
import { isStudyProfile } from '@orkestrel/study'

isStudyProfile({ name: 'local' }) // false
```

### isStudyDigest

Use the exported declaration with its documented arguments.

```ts
import { isStudyDigest } from '@orkestrel/study'

isStudyDigest('a'.repeat(64)) // true
```

### isStudyTimestamp

Use the exported declaration with its documented arguments.

```ts
import { isStudyTimestamp } from '@orkestrel/study'

isStudyTimestamp('2026-10-14T12:00:00.000Z') // true
```

### isStudyUsage

Use the exported declaration with its documented arguments.

```ts
import { isStudyUsage } from '@orkestrel/study'

isStudyUsage({ role: 'tool', calls: 0, bytes: 0, duration: 0 }) // true
```

### isStudyCriterion

Use the exported declaration with its documented arguments.

```ts
import { isStudyCriterion } from '@orkestrel/study'

isStudyCriterion({ id: 'saved', scenario: 'shift', goal: 'write', method: 'state', critical: true, assertion: true }) // true
```

### isStudyRubric

Use the exported declaration with its documented arguments.

```ts
import { isStudyRubric } from '@orkestrel/study'

isStudyRubric({ version: '1', criteria: [] }) // false
```

### isStudyJudgment

Use the exported declaration with its documented arguments.

```ts
import { isStudyJudgment } from '@orkestrel/study'

isStudyJudgment({ trial: 'r1-s1-a1', criterion: 'saved', verdict: 'unknown', method: 'state', reason: 'No evidence', references: [] }) // true
```

### isStudyLabels

Use the exported declaration with its documented arguments.

```ts
import { isStudyLabels } from '@orkestrel/study'

isStudyLabels({}) // false
```

### isStudyGrading

Use the exported declaration with its documented arguments.

```ts
import { isStudyGrading } from '@orkestrel/study'

isStudyGrading({ version: 1 }) // false
```

### Project a wire value

Use the exported declaration with its documented arguments.

```ts
import { toStudyWire } from '@orkestrel/study/server'

toStudyWire({ state: 'ready', failure: undefined }) // { state: 'ready' }
```

### Encode custody bytes

Use the exported declaration with its documented arguments.

```ts
import { encodeStudyJSON } from '@orkestrel/study/server'

encodeStudyJSON({ version: 1 })
```

### hashStudyBytes

Use the exported declaration with its documented arguments.

```ts
import { hashStudyBytes } from '@orkestrel/study/server'

hashStudyBytes(new Uint8Array())
```

### buildStudyPacketLinks

Use the exported declaration with its documented arguments.

```ts
import { buildStudyPacketLinks } from '@orkestrel/study/server'

buildStudyPacketLinks(result, rubric)
```

### buildStudyPacket

Use the exported declaration with its documented arguments.

```ts
import { buildStudyPacket } from '@orkestrel/study/server'

buildStudyPacket(result, rubric, rubricDigest)
```

### computeStudyPacketDigest

Use the exported declaration with its documented arguments.

```ts
import { computeStudyPacketDigest } from '@orkestrel/study/server'

computeStudyPacketDigest(packet)
```

### translateStudyPacketLabels

Use the exported declaration with its documented arguments.

```ts
import { translateStudyPacketLabels } from '@orkestrel/study/server'

translateStudyPacketLabels(result, rubric, rubricDigest, labels)
```

### checkStudyDirectory

Use the exported declaration with its documented arguments.

```ts
import { checkStudyDirectory } from '@orkestrel/study/server'

await checkStudyDirectory(directory)
```

### readStudyBytes

Use the exported declaration with its documented arguments.

```ts
import { readStudyBytes } from '@orkestrel/study/server'

await readStudyBytes(path, 1024)
```

### writeStudyBytes

Use the exported declaration with its documented arguments.

```ts
import { writeStudyBytes } from '@orkestrel/study/server'

await writeStudyBytes(path, bytes)
```

### scanStudyExecution

Use the exported declaration with its documented arguments.

```ts
import { scanStudyExecution } from '@orkestrel/study/server'

await scanStudyExecution(directory, manifest)
```

### validateStudyEvidenceBytes

Use the exported declaration with its documented arguments.

```ts
import { validateStudyEvidenceBytes } from '@orkestrel/study/server'

validateStudyEvidenceBytes(bytes, manifest, trial)
```

### computeStudySealId

Use the exported declaration with its documented arguments.

```ts
import { computeStudySealId } from '@orkestrel/study/server'

computeStudySealId('execution', files)
```

### readStudyResult

Use the exported declaration with its documented arguments.

```ts
import { readStudyResult } from '@orkestrel/study/server'

await readStudyResult(directory)
```

### isStudyCustodyName

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodyName } from '@orkestrel/study/server'

isStudyCustodyName('r1-s1-a1') // true
```

### isStudyCustodyManifest

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodyManifest } from '@orkestrel/study/server'

isStudyCustodyManifest({}) // false
```

### isStudyCustodyTrial

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodyTrial } from '@orkestrel/study/server'

isStudyCustodyTrial({}) // false
```

### isStudyCustodyEvidence

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodyEvidence } from '@orkestrel/study/server'

isStudyCustodyEvidence({ event: 'saved', goal: 'write', value: true }) // true
```

### isStudyCustodyFailure

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodyFailure } from '@orkestrel/study/server'

isStudyCustodyFailure({}) // false
```

### isStudyCustodyObservation

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodyObservation } from '@orkestrel/study/server'

isStudyCustodyObservation({}) // false
```

### isStudyCustodyAttempt

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodyAttempt } from '@orkestrel/study/server'

isStudyCustodyAttempt({}, manifest) // false
```

### isStudyCustodyFile

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodyFile } from '@orkestrel/study/server'

isStudyCustodyFile({}) // false
```

### isStudyCustodySeal

Use the exported declaration with its documented arguments.

```ts
import { isStudyCustodySeal } from '@orkestrel/study/server'

isStudyCustodySeal({}) // false
```

### Helper calls

Supply the argument tuple from each helper's signature.

```ts
import { failureToStudyError, readStudyFailure } from '@orkestrel/study'
import { awaitStudyProcess, computeStudyProfileDigest, createStudyProcessFailure, isStudyCharge, isStudyEvidence, isStudyFrame, isStudyIdentity, isStudyProcessFailure, isStudyProduct, isStudyTrial, resolveStudyInstrument, terminateStudyChild, validateStudyRuntime } from '@orkestrel/study/server'

declare const awaitStudyProcessArguments: Parameters<typeof awaitStudyProcess>
awaitStudyProcess(...awaitStudyProcessArguments)
declare const computeStudyProfileDigestArguments: Parameters<typeof computeStudyProfileDigest>
computeStudyProfileDigest(...computeStudyProfileDigestArguments)
declare const createStudyProcessFailureArguments: Parameters<typeof createStudyProcessFailure>
createStudyProcessFailure(...createStudyProcessFailureArguments)
declare const failureToStudyErrorArguments: Parameters<typeof failureToStudyError>
failureToStudyError(...failureToStudyErrorArguments)
declare const isStudyChargeArguments: Parameters<typeof isStudyCharge>
isStudyCharge(...isStudyChargeArguments)
declare const isStudyEvidenceArguments: Parameters<typeof isStudyEvidence>
isStudyEvidence(...isStudyEvidenceArguments)
declare const isStudyFrameArguments: Parameters<typeof isStudyFrame>
isStudyFrame(...isStudyFrameArguments)
declare const isStudyIdentityArguments: Parameters<typeof isStudyIdentity>
isStudyIdentity(...isStudyIdentityArguments)
declare const isStudyProcessFailureArguments: Parameters<typeof isStudyProcessFailure>
isStudyProcessFailure(...isStudyProcessFailureArguments)
declare const isStudyProductArguments: Parameters<typeof isStudyProduct>
isStudyProduct(...isStudyProductArguments)
declare const isStudyTrialArguments: Parameters<typeof isStudyTrial>
isStudyTrial(...isStudyTrialArguments)
declare const readStudyFailureArguments: Parameters<typeof readStudyFailure>
readStudyFailure(...readStudyFailureArguments)
declare const resolveStudyInstrumentArguments: Parameters<typeof resolveStudyInstrument>
resolveStudyInstrument(...resolveStudyInstrumentArguments)
declare const terminateStudyChildArguments: Parameters<typeof terminateStudyChild>
terminateStudyChild(...terminateStudyChildArguments)
declare const validateStudyRuntimeArguments: Parameters<typeof validateStudyRuntime>
validateStudyRuntime(...validateStudyRuntimeArguments)
```

### Call StudyAdmissionInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyAdmissionInterface } from '@orkestrel/study'

declare const instance: StudyAdmissionInterface
declare const admit: Parameters<StudyAdmissionInterface['admit']>
instance.admit(...admit)
```

### Call StudyArtifacts methods

Supply an instance of the declared contract.

```ts
import type { StudyArtifacts } from '@orkestrel/study/server'

declare const instance: StudyArtifacts
declare const adapter: Parameters<StudyArtifacts['adapter']>
instance.adapter(...adapter)
declare const inspect: Parameters<StudyArtifacts['inspect']>
instance.inspect(...inspect)
declare const load: Parameters<StudyArtifacts['load']>
instance.load(...load)
declare const verify: Parameters<StudyArtifacts['verify']>
instance.verify(...verify)
```

### Call StudyChannel methods

Supply an instance of the declared contract.

```ts
import type { StudyChannel } from '@orkestrel/study/server'

declare const instance: StudyChannel
declare const abort: Parameters<StudyChannel['abort']>
instance.abort(...abort)
declare const close: Parameters<StudyChannel['close']>
instance.close(...close)
declare const request: Parameters<StudyChannel['request']>
instance.request(...request)
```

### Call StudyControl methods

Supply an instance of the declared contract.

```ts
import type { StudyControl } from '@orkestrel/study'

declare const instance: StudyControl
declare const close: Parameters<StudyControl['close']>
instance.close(...close)
declare const fail: Parameters<StudyControl['fail']>
instance.fail(...fail)
declare const wait: Parameters<StudyControl['wait']>
instance.wait(...wait)
```

### Call StudyControlInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyControlInterface } from '@orkestrel/study'

declare const instance: StudyControlInterface
declare const close: Parameters<StudyControlInterface['close']>
instance.close(...close)
declare const fail: Parameters<StudyControlInterface['fail']>
instance.fail(...fail)
declare const wait: Parameters<StudyControlInterface['wait']>
instance.wait(...wait)
```

### Call StudyCustodySinkInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyCustodySinkInterface } from '@orkestrel/study/server'

declare const instance: StudyCustodySinkInterface
declare const append: Parameters<StudyCustodySinkInterface['append']>
instance.append(...append)
declare const close: Parameters<StudyCustodySinkInterface['close']>
instance.close(...close)
```

### Call StudyDriverInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyDriverInterface } from '@orkestrel/study'

declare const instance: StudyDriverInterface
declare const open: Parameters<StudyDriverInterface['open']>
instance.open(...open)
```

### Call StudyEvidenceSink methods

Supply an instance of the declared contract.

```ts
import type { StudyEvidenceSink } from '@orkestrel/study/server'

declare const instance: StudyEvidenceSink
declare const append: Parameters<StudyEvidenceSink['append']>
instance.append(...append)
declare const close: Parameters<StudyEvidenceSink['close']>
instance.close(...close)
```

### Call StudyGradings methods

Supply an instance of the declared contract.

```ts
import type { StudyGradings } from '@orkestrel/study/server'

declare const instance: StudyGradings
declare const read: Parameters<StudyGradings['read']>
instance.read(...read)
declare const write: Parameters<StudyGradings['write']>
instance.write(...write)
```

### Call StudyMeter methods

Supply an instance of the declared contract.

```ts
import type { StudyMeter } from '@orkestrel/study'

declare const instance: StudyMeter
declare const admit: Parameters<StudyMeter['admit']>
instance.admit(...admit)
declare const close: Parameters<StudyMeter['close']>
instance.close(...close)
```

### Call StudyMeterInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyMeterInterface } from '@orkestrel/study'

declare const instance: StudyMeterInterface
declare const admit: Parameters<StudyMeterInterface['admit']>
instance.admit(...admit)
declare const close: Parameters<StudyMeterInterface['close']>
instance.close(...close)
```

### Call StudyProcessDriver methods

Supply an instance of the declared contract.

```ts
import type { StudyProcessDriver } from '@orkestrel/study/server'

declare const instance: StudyProcessDriver
declare const open: Parameters<StudyProcessDriver['open']>
instance.open(...open)
```

### Call StudyProcessSession methods

Supply an instance of the declared contract.

```ts
import type { StudyProcessSession } from '@orkestrel/study/server'

declare const instance: StudyProcessSession
declare const close: Parameters<StudyProcessSession['close']>
instance.close(...close)
declare const execute: Parameters<StudyProcessSession['execute']>
instance.execute(...execute)
declare const start: Parameters<StudyProcessSession['start']>
instance.start(...start)
```

### Call StudyRemoteMeter methods

Supply an instance of the declared contract.

```ts
import type { StudyRemoteMeter } from '@orkestrel/study/server'

declare const instance: StudyRemoteMeter
declare const abort: Parameters<StudyRemoteMeter['abort']>
instance.abort(...abort)
declare const admit: Parameters<StudyRemoteMeter['admit']>
instance.admit(...admit)
declare const close: Parameters<StudyRemoteMeter['close']>
instance.close(...close)
```

### Call StudyRemoteMeterInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyRemoteMeterInterface } from '@orkestrel/study/server'

declare const instance: StudyRemoteMeterInterface
declare const abort: Parameters<StudyRemoteMeterInterface['abort']>
instance.abort(...abort)
declare const admit: Parameters<StudyRemoteMeterInterface['admit']>
instance.admit(...admit)
declare const close: Parameters<StudyRemoteMeterInterface['close']>
instance.close(...close)
```

### Call StudyRemoteTicket methods

Supply an instance of the declared contract.

```ts
import type { StudyRemoteTicket } from '@orkestrel/study/server'

declare const instance: StudyRemoteTicket
declare const fail: Parameters<StudyRemoteTicket['fail']>
instance.fail(...fail)
declare const finish: Parameters<StudyRemoteTicket['finish']>
instance.finish(...finish)
```

### Call StudyRequest methods

Supply an instance of the declared contract.

```ts
import type { StudyRequest } from '@orkestrel/study'

declare const instance: StudyRequest
declare const fail: Parameters<StudyRequest['fail']>
instance.fail(...fail)
declare const finish: Parameters<StudyRequest['finish']>
instance.finish(...finish)
```

### Call StudyResults methods

Supply an instance of the declared contract.

```ts
import type { StudyResults } from '@orkestrel/study/server'

declare const instance: StudyResults
declare const create: Parameters<StudyResults['create']>
instance.create(...create)
declare const finish: Parameters<StudyResults['finish']>
instance.finish(...finish)
declare const seal: Parameters<StudyResults['seal']>
instance.seal(...seal)
declare const start: Parameters<StudyResults['start']>
instance.start(...start)
```

### Call StudyResultsInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyResultsInterface } from '@orkestrel/study/server'

declare const instance: StudyResultsInterface
declare const create: Parameters<StudyResultsInterface['create']>
instance.create(...create)
declare const finish: Parameters<StudyResultsInterface['finish']>
instance.finish(...finish)
declare const seal: Parameters<StudyResultsInterface['seal']>
instance.seal(...seal)
declare const start: Parameters<StudyResultsInterface['start']>
instance.start(...start)
```

### Call StudyScope methods

Supply an instance of the declared contract.

```ts
import type { StudyScope } from '@orkestrel/study'

declare const instance: StudyScope
declare const check: Parameters<StudyScope['check']>
instance.check(...check)
declare const close: Parameters<StudyScope['close']>
instance.close(...close)
declare const reserve: Parameters<StudyScope['reserve']>
instance.reserve(...reserve)
declare const settle: Parameters<StudyScope['settle']>
instance.settle(...settle)
```

### Call StudyScopeInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyScopeInterface } from '@orkestrel/study'

declare const instance: StudyScopeInterface
declare const check: Parameters<StudyScopeInterface['check']>
instance.check(...check)
declare const close: Parameters<StudyScopeInterface['close']>
instance.close(...close)
declare const reserve: Parameters<StudyScopeInterface['reserve']>
instance.reserve(...reserve)
declare const settle: Parameters<StudyScopeInterface['settle']>
instance.settle(...settle)
```

### Call StudySeries methods

Supply an instance of the declared contract.

```ts
import type { StudySeries } from '@orkestrel/study'

declare const instance: StudySeries
declare const execute: Parameters<StudySeries['execute']>
instance.execute(...execute)
```

### Call StudySessionInterface methods

Supply an instance of the declared contract.

```ts
import type { StudySessionInterface } from '@orkestrel/study'

declare const instance: StudySessionInterface
declare const close: Parameters<StudySessionInterface['close']>
instance.close(...close)
declare const execute: Parameters<StudySessionInterface['execute']>
instance.execute(...execute)
```

### Call StudySinkInterface methods

Supply an instance of the declared contract.

```ts
import type { StudySinkInterface } from '@orkestrel/study'

declare const instance: StudySinkInterface
declare const append: Parameters<StudySinkInterface['append']>
instance.append(...append)
```

### Call StudyStoreInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyStoreInterface } from '@orkestrel/study'

declare const instance: StudyStoreInterface
declare const finish: Parameters<StudyStoreInterface['finish']>
instance.finish(...finish)
declare const start: Parameters<StudyStoreInterface['start']>
instance.start(...start)
```

### Call StudyTask methods

Supply an instance of the declared contract.

```ts
import type { StudyTask } from '@orkestrel/study/server'

declare const instance: StudyTask
declare const execute: Parameters<StudyTask['execute']>
instance.execute(...execute)
```

### Call StudyTaskWorker methods

Supply an instance of the declared contract.

```ts
import type { StudyTaskWorker } from '@orkestrel/study/server'

declare const instance: StudyTaskWorker
declare const execute: Parameters<StudyTaskWorker['execute']>
instance.execute(...execute)
```

### Call StudyTicket methods

Supply an instance of the declared contract.

```ts
import type { StudyTicket } from '@orkestrel/study'

declare const instance: StudyTicket
declare const fail: Parameters<StudyTicket['fail']>
instance.fail(...fail)
declare const finish: Parameters<StudyTicket['finish']>
instance.finish(...finish)
```

### Call StudyWorker methods

Supply an instance of the declared contract.

```ts
import type { StudyWorker } from '@orkestrel/study/server'

declare const instance: StudyWorker
declare const execute: Parameters<StudyWorker['execute']>
instance.execute(...execute)
```

## Tests

See the behavioral proofs in the following directories.

- [tests/src/core](../tests/src/core)
- [tests/src/server/stores](../tests/src/server/stores)
- [tests/src/server/processes](../tests/src/server/processes)
