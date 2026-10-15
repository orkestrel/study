# Study

> Bounded comparative execution with captured artifacts and separate grading.

The host-independent engine is exported from `@orkestrel/study`; custody and native workers are exported from `@orkestrel/study/server`.

## Execution and evidence

Declare the question, purpose, arms, scenarios, repetition order, and rubric before execution. Each repetition row names every arm exactly once. The engine opens fresh state for each trial and retains state between that trial's ordered goals. It executes the declared schedule once; retries are disabled.

The request meter reserves token and byte ceilings before an adapter dispatches work. Request, goal, trial, and series limits bound enclosing work. Missing actual usage remains unknown and consumes the admitted ceiling. Capacity, infrastructure, deadline, and interruption are operational outcomes; a product never awards its own task verdict. An error that carries a failure keeps that attribution; a study error without one reads as capacity for the `CAPACITY` code and as deadline for the `DEADLINE` code, and every other rejection reads as infrastructure.

A study error stamps an own `STUDY_ERROR_BRAND` descriptor whose value is the error itself. `isStudyError` requires that descriptor with an `Error` subclass, the `StudyError` name, and a declared code, so a study error thrown by another package, ESM, CommonJS, or captured module copy keeps its code and attribution. The brand uses the global symbol registry: it is recognition, not unforgeable provenance. An unbranded older copy, an inherited or borrowed brand, a proxy, and a property-only lookalike read as infrastructure.

A product that exceeds its goal, trial, or series output allowance is omitted from custody with a capacity failure. Previously admitted products remain retained, and the remaining horizon is explicitly unexecuted. A genuine custody write or metadata-capacity failure still rejects execution and leaves the result unsealed.

Each observation and attempt records an explicit execution fact. An observation is executed when the engine dispatched its goal to the session, and unexecuted when it fills the horizon after a terminal failure; an unexecuted observation holds a failure and no product, usage, or duration. An attempt is executed when it entered trial execution without an inherited terminal series failure, including a failure before the driver opened, so the fact does not claim that the driver was opened. Executed goals form a prefix of the horizon, and an executed goal that fails ends it. Both facts are required booleans, never inferred from a product, usage, duration, or failure message, and custody refuses an attempt that omits one or contradicts them. A terminal attempt holds a failure whenever a goal failed or went unexecuted. Study carries no format counter; the artifact inventory records the exact implementation fingerprints, and the definition, rubric, and label versions are caller-authored metadata that identify supplied content.

A ticket reports `settled` from its own settlement, never from `signal.aborted`: a worker ticket whose signal aborted is unsettled locally because the parent owns that failure. After work escapes, call `failStudyTicket` with the caught value. It leaves a ticket that already settled or aborted untouched, so no request is accounted twice. Otherwise it fails the ticket once with the reading `readStudyFailure` gives the value; an optional role replaces any role that reading carries, and without one the carried role, then the ticket's admitted role, applies. A refusal thrown by the ticket's own settlement propagates. A consumer that must account known bytes when an operation throws, or finish an expected refusal, keeps that choice in its own code.

The driver receives a borrowed admission interface and an evidence sink. The concrete engine owns the meter's closing lifecycle. Native workers await parent admission and acknowledge request settlement; each trial runs in a fresh child. Trusted adapters can access native resources, so process supervision is not a hostile-code sandbox.

Execution custody creates a result directory exclusively, appends evidence, retains terminal attempts, and seals only a complete scheduled population. A result without a seal remains interrupted. Offline reading verifies the seal's exact file inventory and digests. Changed execution bytes refuse custody verification.

Grading uses a sealed result and independently selected rubric bytes. Immutable grading versions retain their own rubric, packet, mapping, and imported label bytes. Semantic criteria remain unknown until accountable labels are imported. Reports select an exact grading identity and retain unknown criteria in whole-horizon intervals.

Report operations partition trial records and goal records separately into executed and unexecuted by their explicit fact. The trial and goal counts overlap and are never added. Each fault row counts the affected trial or goal records for one cause, not independent failure events. The `content` cause names a request that completed but whose consumer refused the content as unusable. It claims no model or decoder cause and grades no semantic quality. Study bans no arbitrary substantive content: each consumer decides what it refuses, and generic Study only transports the explicit cause. A consumer that refuses content from a request it already settled leaves that accounting settled and does not fail the ticket again; it throws a `StudyError` with the `FAULT` code and an attached failure carrying `content` and its role. The first failed goal and the later unexecuted goals, including those of subsequent trials, keep the cause `content` and the role, and only the explicit executed fact tells them apart. A completed goal holds a non-partial product and no failure, and a completed trial holds no failure and only completed goals. Completion is an operational count, neither task success nor the qualification gate, and a partial product is retained and counted separately.

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
	const usage = meter.usage // [{ role: 'tool', calls: 1, tokens: 3, bytes: 12, duration: 1 }]
} finally {
	meter.close()
	scope.close()
	control.close()
}
```

### Retain complete execution custody

Supply a validated manifest, a nonexistent directory, and terminal attempts for every scheduled trial. This example's scenarios declare a goal named write. The caller supplies observations; custody validates and retains them without executing the domain driver. Each attempt and observation carries its execution fact.

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
const status = reading.status // 'sealed'
const sealed = reading.status === 'sealed' && reading.seal.id === seal.id // true
```

## Limits

Captured identities bind admitted files, module selections, and Node runtime settings. They do not identify the entire machine or replay external services. Neutral semantic identifiers omit treatment and model names, but input and product text can reveal design details. This guide's executable examples prove local admission and custody; they do not establish GPU capacity or model quality.

## Captured loading

Select canonical absolute package roots and built ESM entries under each package's dist directory. Inspection captures bytes without evaluating modules. Verification compares captured bytes to disk. Loading evaluates the selected entry through captured-byte hooks and verifies again after evaluation.

Admit every package root reached by native dependency resolution, including installed copies alongside a selected local package. Distinct canonical roots may share a package name; each root and its captured bytes retain their own identity. Repeated roots refuse inspection, and imports into omitted roots refuse loading before evaluation.

Select a consumer-owned source directory separately when the adapter needs strip-only TypeScript. Its graph cannot overlap a built package graph. Source JSON assets are excluded; fixture and rubric bytes retain separate identities. Native package exports and extension rules still govern resolution. The inventory records package manifests, captured files, selected entries, Node version, and runtime settings.

Select excluded built files to refuse every import edge that reaches them; exclusion leaves the inventory identity unchanged. Run loading in a disposable worker and terminate the worker afterwards. A process admits one loaded inventory. Trusted code can use native process APIs, evaluation, and external services; the loader does not replay those resources or sandbox hostile code.

### Inspect selected bytes

Supply a canonical named ESM package root and an admitted built entry. The returned inventory identifies the selected bytes without executing the entry.

```ts
import { Artifacts } from '@orkestrel/study/server'

declare const root: string
declare const entry: string

const artifacts = new Artifacts({ roots: [root], entries: [entry] })
const inventory = artifacts.inspect()
const selected = inventory.entries.includes(entry) // true
artifacts.verify()
```

## Consumer boundary

An authored consumer module exports a factory named createStudyAdapter. The factory returns an adapter with validation, driver construction, and retained-evidence grading. Validation receives generic declarations before agent, subject, or provider modules execute. During validation, an import edge that reaches the selected agent, subject, or provider entry, directly or through another module, refuses the check; other admitted modules still load. A driver receives admitted module namespaces, its execution profile, and exclusive scratch resources.

Keep grading criteria outside public goal input. Grade retained observations and evidence independently of execution. Return unknown judgments when evidence is unavailable; preserve the criterion's declared method. Adapter code runs as trusted instrumentation in bounded child work and is not a security sandbox.

Call `gradeStudyEvidence` from an adapter's grade method to traverse the declared schedule and criteria. The traversal validates the manifest, rubric, attempts, evidence, and every declared goal when called directly, so a public grading helper keeps that validation. It calls the supplied `StudyGradeFunction` for every trial and criterion of that trial's scenario, in schedule then rubric order, and a trial without a retained attempt still receives a judgment with no attempt and no evidence. The predicate returns the verdict, method, reason, and `StudyReference` citations. The traversal renders each citation as a retained path, with a one-based position for an evidence row, and refuses a citation of a trial that was not retained or a row that does not exist. Domain predicates, whole-attempt or per-goal success, and expected refusals remain in the consumer.

## Native command

Install the package in the consumer workspace, then run the study executable from that workspace. The selected declaration lives at studies/<name>/study.json. Its driver field selects a bundle at studies/<driver>/ containing scenarios/<scenario>.json, profiles/<profile>.json, the adapter module, and the declared rubric path. The profile defaults to local. JSON declarations use the public definition, scenario, profile, and rubric contracts.

A profile selects the Agent runtime entry in its required agent field and the package under study in its required subject field. The two fields can name the same entry or two entries, including entries from different installed copies of Agent. Each selected entry is captured and loaded once, and the driver receives both namespaces under the declared roles. The selected entries and their bytes are part of the execution identity.

The recap allowance of the room and the judge of the provider are optional. A study that produces no recap omits the recap allowance. A provider declares its judge model and its judge digest together or omits both; declaring only one refuses the profile. A declared recap and a declared judge keep their finite bounds.

A profile may carry an optional settings object of JSON values. The selected driver owns its interpretation; Study only validates the object, keeps an independent frozen copy, and refuses arrays, primitives, non-JSON values, and cycles. Settings are part of the resolved profile bytes, so changing one value changes the profile identity and the execution fingerprint. A profile without settings keeps the identity it had before the field existed.

The command supports explicit operations with operation-specific flags. Every flag takes a value and can appear once.

| Operation     | Command                                                                       | Result                                                                |
| ------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Validate      | study check <study> [--profile <name>]                                        | Fingerprint and suggested pinned execution arguments                  |
| Execute       | study execute <study> [--profile <name>] [--out <path>] [--expected <sha256>] | Execution result identity and suggested independent grading arguments |
| Grade         | study grade <result> --rubric <path>                                          | Immutable grading identity and suggested report arguments             |
| Import labels | study label <result> --grading <sha256> --labels <path>                       | Another immutable grading identity and suggested report arguments     |
| Report        | study report <result> --grading <sha256>                                      | Whole-horizon results for the selected grading                        |

Success writes a JSON document. The next field contains suggested argv and never executes it automatically. Execution returns a result identity independently of the original study selector. Result selection accepts an identity under tmp/studies, a contained root-relative path, or an absolute path. Relative output paths stay inside the consumer working directory; existing output directories refuse execution.

Check returns a fingerprint for the declared execution selection. Pass that fingerprint through --expected to pin execution. Both check and execute require a quality profile to declare a qualification path. Execute then requires that path to select a sealed capacity result with the same identity, bounds, schedule, and scenarios and no operational failures. Check validates the declaration offline without opening the capacity result. Capacity and mechanism studies execute without a qualification. Grade names an exact independent rubric path. Label and report require an exact grading identity; no operation guesses a grading version. Imported labels are caller-supplied bytes, not a labeler invoked by this command. A labeled grading binds the preceding grading's instrument, so equal labels over different gradings retain different identities.

Help succeeds on stdout when --help appears anywhere. Empty arguments and invalid public grammar report on stderr with exit code 64. Operational diagnostics carry a study:CODE prefix and the refused token or path when applicable. Other exits are 0 for success, 124 for deadline, 130 for interruption, and 1 for operational failure. Private child routes require the native IPC boundary.

An adapter error response preserves the `CONFIG` code and translates other returned codes to `FAULT`.

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

| Name                             | Kind      | Summary                                                                                   |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `ARTIFACT_BYTES`                 | const     | Bounds all captured input bytes to 128 MiB.                                               |
| `ARTIFACT_DEPTH`                 | const     | Bounds directory nesting below each selected root.                                        |
| `ARTIFACT_FILES`                 | const     | Bounds admitted files before another capture is allocated.                                |
| `ARTIFACT_FILE_BYTES`            | const     | Bounds one captured input file to 16 MiB.                                                 |
| `ARTIFACT_ROOTS`                 | const     | Bounds selected package roots before traversal begins.                                    |
| `ARTIFACT_VISITS`                | const     | Bounds all visited directory entries, including ignored assets.                           |
| `ArtifactError`                  | class     | Reports an invalid or drifted artifact inventory.                                         |
| `ArtifactFile`                   | interface | Records the exact bytes admitted at one absolute file path.                               |
| `ArtifactHookInput`              | interface | Supplies the private namespace and separate source selection to resolution.               |
| `ArtifactInventory`              | interface | Records all admitted module bytes, selections, and native runtime identity.               |
| `ArtifactLoadHandler`            | type      | Names Node's synchronous loading continuation.                                            |
| `ArtifactOptions`                | interface | Selects built packages and an optional separate consumer source graph.                    |
| `ArtifactPackage`                | interface | Records the identity declared by an admitted package manifest.                            |
| `ArtifactResolveHandler`         | type      | Names Node's synchronous resolution continuation.                                         |
| `ArtifactRuntime`                | interface | Binds native conditions and host-sensitive builtin behavior to the inventory.             |
| `ArtifactSource`                 | interface | Retains captured bytes for the native loader.                                             |
| `ArtifactSourceOptions`          | interface | Selects a consumer-owned executable source directory and its exact adapter entry.         |
| `Artifacts`                      | class     | Captures built ESM and a separate strip-only consumer adapter in a fresh worker.          |
| `Resolution`                     | class     | Enforces captured inventory membership at every synchronous native import edge.           |
| `STUDY_CAUSES`                   | const     | Lists every operational ending in report order.                                           |
| `STUDY_COMMAND_DURATION`         | const     | Caps declared execution duration at the native supervisor's host ceiling.                 |
| `STUDY_COMMAND_GRADER`           | const     | Names the trusted command's independent offline predicate.                                |
| `STUDY_COMMAND_HELP`             | const     | Defines the complete public CLI reference shared by help and grammar diagnostics.         |
| `STUDY_COMMAND_OPERATION`        | const     | Names the command route beneath the native supervisor.                                    |
| `STUDY_CUSTODY_BYTES`            | const     | Limits untrusted metadata before JSON parsing or file allocation.                         |
| `STUDY_DRAIN_DURATION`           | const     | Bounds how long inherited output handles stay open after native exit, in milliseconds.    |
| `STUDY_ERROR_BRAND`              | const     | Keys the own self-identity every study error stamps on itself.                            |
| `STUDY_FRAME_BYTES`              | const     | Limits each serialized IPC envelope, including its JSON framing.                          |
| `STUDY_GOALS`                    | const     | Caps a declared scenario horizon before execution.                                        |
| `STUDY_LAUNCH_BYTES`             | const     | Bounds combined supervised command output to 16 MiB before terminating the tree.          |
| `STUDY_LAUNCH_CLEANUP`           | const     | Extends supervised execution beyond its declared series duration for cleanup.             |
| `STUDY_LAUNCH_DURATION`          | const     | Bounds each supervised operation other than execution to 60 seconds.                      |
| `STUDY_LOG_BYTES`                | const     | Limits combined worker stdout and stderr before termination.                              |
| `STUDY_NAME`                     | const     | Restricts identifiers to portable path-safe names.                                        |
| `STUDY_PACKET_DISCLOSURE`        | const     | Discloses the limits of neutral identifiers when public text remains visible.             |
| `STUDY_PENDING_LIMIT`            | const     | Limits outstanding bidirectional protocol work per process.                               |
| `STUDY_PROCESS_LABEL`            | const     | Attributes an expired process handshake or cleanup deadline.                              |
| `STUDY_RESERVED_NAME`            | const     | Rejects names that Windows reserves even on other hosts.                                  |
| `STUDY_ROLES`                    | const     | Lists every measured request role in report order.                                        |
| `STUDY_TASK_DURATION`            | const     | Caps pure domain work independently of its event loop.                                    |
| `STUDY_TASK_OPERATION`           | const     | Names the private bounded validation and grading route.                                   |
| `STUDY_TRIALS`                   | const     | Caps a declared trial population before schedule allocation.                              |
| `STUDY_WORKER_OPERATION`         | const     | Names the worker operation routed by the built application entry.                         |
| `StudyAdapterInterface`          | interface | Defines the consumer's domain checks, driver construction, and retained-evidence grading. |
| `StudyAdjudication`              | interface | Holds retained observations and independent criteria for a grading operation.             |
| `StudyAdmissionInterface`        | interface | Admits requests against enclosing limits before an adapter dispatches them.               |
| `StudyArtifactIdentity`          | interface | Holds the separately bound instrument and selected module inventory identities.           |
| `StudyArtifactModules`           | interface | Holds actual namespaces loaded only during worker execution.                              |
| `StudyArtifactOptions`           | interface | Holds the trusted instrument and caller-selected built artifact locations.                |
| `StudyArtifacts`                 | class     | Binds consumer instrumentation separately from selected executable identities.            |
| `StudyAttempt`                   | interface | Holds a terminal trial record, including goals never dispatched.                          |
| `StudyBounds`                    | interface | Holds nested execution allowances; each request also has a deadline.                      |
| `StudyCLI`                       | class     | Dispatches private child routes before the public native supervisor.                      |
| `StudyCause`                     | type      | Names an operational ending separately from task achievement.                             |
| `StudyChannel`                   | class     | Correlates bounded IPC work and rejects every outstanding request on transport failure.   |
| `StudyChannelOptions`            | interface | Holds one native IPC endpoint and its domain handlers.                                    |
| `StudyCharge`                    | interface | Holds a request's pre-dispatch upper bounds.                                              |
| `StudyCommand`                   | class     | Executes validated study operations with execution and grading custody kept independent.  |
| `StudyCommandArtifact`           | interface | Holds one bounded source artifact retained during offline validation.                     |
| `StudyCommandOptions`            | interface | Holds the trusted application entry and repository location.                              |
| `StudyCommandRequest`            | type      | Names the independently dispatched study command operation.                               |
| `StudyContext`                   | interface | Holds the resources visible to one running goal.                                          |
| `StudyControl`                   | class     | Retains the first operational failure while bounding asynchronous waits.                  |
| `StudyControlInterface`          | interface | Owns the first operational failure and cancellation of enclosing work.                    |
| `StudyCriterion`                 | interface | Holds a grader-owned criterion outside the driver's public input.                         |
| `StudyCustodyBudget`             | interface | Holds the evidence sink's shared admission budget.                                        |
| `StudyCustodyPhase`              | type      | Names the execution custody lifecycle without inferring seal completeness.                |
| `StudyCustodySinkInterface`      | interface | Closes evidence admission and drains already admitted appends.                            |
| `StudyDeadline`                  | class     | Bounds each independent operation with a fresh failure owner and deadline.                |
| `StudyDeadlineInterface`         | interface | Bounds one independent asynchronous operation under its own deadline.                     |
| `StudyDeadlineOptions`           | interface | Supplies one bounded operation's finite deadline and diagnostic label.                    |
| `StudyDefinition`                | interface | Holds the frozen study question, population and explicit repetition orders.               |
| `StudyDriverInterface`           | interface | Creates isolated domain state through a concrete package consumer.                        |
| `StudyDriverOptions`             | interface | Supplies admitted modules and an exclusive scratch parent without grader truth.           |
| `StudyError`                     | class     | Reports a study contract or operational failure with a stable code.                       |
| `StudyErrorCode`                 | type      | Names malformed configuration, evidence, custody and operational failures.                |
| `StudyEvidence`                  | interface | Holds append-only domain evidence in a JSON-compatible form.                              |
| `StudyEvidenceOptions`           | interface | Holds the owned evidence descriptor and byte admission constraints.                       |
| `StudyEvidenceSink`              | class     | Retains admitted evidence in order and closes admission before terminal records.          |
| `StudyExecutionRequest`          | interface | Holds a checked execution selection with optional output custody.                         |
| `StudyFailure`                   | interface | Holds an attributable operational fault without awarding a task verdict.                  |
| `StudyFile`                      | interface | Holds the exact byte identity of one execution file.                                      |
| `StudyFrame`                     | interface | Holds a correlated JSON request, reply or cancellation notification.                      |
| `StudyGoal`                      | interface | Holds a declared goal's public input without its grading truth.                           |
| `StudyGradeFunction`             | type      | Reads one declared target against the consumer's domain predicate.                        |
| `StudyGradeReading`              | interface | Holds a consumer predicate's reading of one target, citing only retained files and rows.  |
| `StudyGradeRequest`              | interface | Holds an offline predicate grading request.                                               |
| `StudyGradeTarget`               | interface | Holds one declared trial and criterion pair with its retained observations.               |
| `StudyGrading`                   | interface | Holds a grading identity that cannot replace or mutate execution bytes.                   |
| `StudyGradingContext`            | interface | Holds artifacts already verified inside a selected immutable grading directory.           |
| `StudyGradingOptions`            | interface | Holds imported grading artifacts independently of execution.                              |
| `StudyGradings`                  | class     | Retains immutable deterministic grading versions independently of execution bytes.        |
| `StudyIdentity`                  | interface | Holds byte identities that qualification and comparisons must agree on.                   |
| `StudyInterruptedResult`         | interface | Holds inspected execution metadata that is never gradeable before sealing.                |
| `StudyJudgment`                  | interface | Holds an evidence-backed verdict; missing evidence stays unknown.                         |
| `StudyLabelRequest`              | interface | Holds an imported-label grading request.                                                  |
| `StudyLabels`                    | interface | Holds imported semantic judgments and their accountable origin.                           |
| `StudyLaunchOptions`             | interface | Selects the native command entry and the caller's consumer root.                          |
| `StudyLaunchResult`              | interface | Retains the bounded command exit and captured output.                                     |
| `StudyLauncher`                  | class     | Supervises finite command trees and binds offline check to execution.                     |
| `StudyLimit`                     | interface | Holds finite allowances in milliseconds, calls, tokens and bytes.                         |
| `StudyManifest`                  | interface | Holds the execution declaration sealed before any trial begins.                           |
| `StudyMessageHandler`            | type      | Handles validated transport requests at their owning domain boundary.                     |
| `StudyMeter`                     | class     | Admits request ceilings across every enclosing scope before dispatch.                     |
| `StudyMeterInterface`            | interface | Owns request admission and the goal's terminal lifecycle.                                 |
| `StudyMeterOptions`              | interface | Supplies the request allowance and all enclosing admission scopes.                        |
| `StudyObservation`               | interface | Holds the retained outcome of a scheduled goal.                                           |
| `StudyOperation`                 | type      | Names the bounded transport's domain operations.                                          |
| `StudyPacketBundle`              | interface | Holds exact neutral public packet bytes and private mapping bytes.                        |
| `StudyPacketEntry`               | interface | Holds one neutral semantic grading input without treatment or model identifiers.          |
| `StudyPacketLink`                | interface | Holds the neutral identity mapping to a sealed semantic trial-criterion pair.             |
| `StudyParentTicket`              | interface | Holds an authoritative parent ticket and its transport listener lifetime.                 |
| `StudyPreparation`               | interface | Holds checked public declarations and reproducible executable identities.                 |
| `StudyProcessDriver`             | class     | Opens one fresh native child for each scheduled trial.                                    |
| `StudyProcessOptions`            | interface | Holds the parent-owned fresh trial process configuration.                                 |
| `StudyProcessSession`            | class     | Keeps admission and evidence custody in the parent of one fresh trial process.            |
| `StudyProcessSessionOptions`     | interface | Holds one fresh child trial's launch parameters and cancellation.                         |
| `StudyProduct`                   | interface | Holds observed output and partial completion, never self-awarded success.                 |
| `StudyProfile`                   | interface | Holds execution settings independently of scenario and grading declarations.              |
| `StudyProvider`                  | interface | Holds caller-selected provider artifacts and model identities.                            |
| `StudyPurpose`                   | type      | Names the evidence a study can establish.                                                 |
| `StudyReference`                 | interface | Cites a retained trial file, or one evidence row of it by its zero-based position.        |
| `StudyReferenceFile`             | type      | Names a retained file of one trial that a judgment cites.                                 |
| `StudyRemoteMeter`               | class     | Waits for authoritative parent admission and drains acknowledged settlements.             |
| `StudyRemoteMeterInterface`      | interface | Owns transported admission, parent cancellation, and settlement drainage.                 |
| `StudyRemoteMeterOptions`        | interface | Holds the worker meter's parent-authorized transport and failure latch.                   |
| `StudyRemoteTicket`              | class     | Transmits one settlement without inventing local admission authority.                     |
| `StudyRemoteTicketOptions`       | interface | Holds one transported ticket's identity and settlement owner.                             |
| `StudyReportRequest`             | interface | Holds a selected immutable report request.                                                |
| `StudyRequest`                   | class     | Settles an admitted request once and propagates operational failure to its owner.         |
| `StudyRequestOptions`            | interface | Supplies one admitted request with its shared failure owner and settlement sink.          |
| `StudyResponse`                  | interface | Holds an outstanding bounded IPC response.                                                |
| `StudyResultOptions`             | interface | Holds the inert execution store configuration.                                            |
| `StudyResultReading`             | type      | Holds an offline execution reading discriminated by custody completeness.                 |
| `StudyResults`                   | class     | Owns append-only execution bytes and seals only a complete terminal population.           |
| `StudyResultsInterface`          | interface | Owns execution custody from exclusive creation through complete sealing.                  |
| `StudyRole`                      | type      | Names a request's measured responsibility.                                                |
| `StudyRoom`                      | interface | Holds the model context and generation allowance as separate measurements.                |
| `StudyRubric`                    | interface | Holds a versioned grading declaration independently of execution.                         |
| `StudyScenario`                  | interface | Holds ordered goals sharing state within an isolated trial.                               |
| `StudyScope`                     | class     | Reserves finite request ceilings around cumulative actual budgets and one deadline.       |
| `StudyScopeInterface`            | interface | Holds cumulative admission ceilings for one timed execution scope.                        |
| `StudyScopeOptions`              | interface | Supplies one deadline and its shared failure owner.                                       |
| `StudyScore`                     | interface | Holds an arm's whole-horizon counts without hiding unresolved criteria.                   |
| `StudySeal`                      | interface | Holds a complete execution inventory and its deterministic identity.                      |
| `StudySealedResult`              | interface | Holds independently verified sealed execution bytes.                                      |
| `StudySeries`                    | class     | Executes a frozen serial study schedule with finite admission and sticky failures.        |
| `StudySeriesOptions`             | interface | Holds the common engine's fixed execution inputs.                                         |
| `StudySessionInterface`          | interface | Owns domain state across a trial and releases it before the next trial.                   |
| `StudySettlementHandler`         | type      | Records the settlement of one admitted request.                                           |
| `StudySinkInterface`             | interface | Holds an evidence sink whose implementation owns byte limits and custody.                 |
| `StudyStoreInterface`            | interface | Appends terminal records without overwriting a prior attempt.                             |
| `StudyTask`                      | class     | Bounds adapter evaluation by an independent native parent timer.                          |
| `StudyTaskOptions`               | interface | Holds a bounded adapter-only native operation.                                            |
| `StudyTaskRequest`               | type      | Carries only declarations or sealed evidence to an adapter child.                         |
| `StudyTaskResult`                | interface | Returns adapter output with the exact active instrumentation digest.                      |
| `StudyTaskWorker`                | class     | Evaluates only admitted instrumentation in a disposable native child.                     |
| `StudyTicket`                    | interface | Holds one admitted request until its actual charge is recorded.                           |
| `StudyTrial`                     | interface | Holds a scheduled trajectory, with a fresh state for each repetition and arm.             |
| `StudyTrialCustody`              | interface | Holds the trial sink's admitted writes and terminal lifecycle.                            |
| `StudyUsage`                     | interface | Holds actual request measurements; absent token usage remains unknown.                    |
| `StudyValidation`                | interface | Holds declarations for domain validation before agent, subject or provider execution.     |
| `StudyWorker`                    | class     | Executes one verified trial behind parent-authorized admission and custody.               |
| `buildStudyPacket`               | function  | Builds deterministic public semantic inputs and a separately retained private map.        |
| `buildStudyPacketLinks`          | function  | Builds neutral semantic identities for the complete eligible sealed horizon.              |
| `buildStudyReference`            | function  | Renders a citation of one retained trial file or evidence row.                            |
| `buildStudySchedule`             | function  | Builds a bounded schedule from explicit repetition rows and declared scenarios.           |
| `checkStudyDirectory`            | function  | Refuses symbolic links and non-directory ancestors before custody operations.             |
| `collectStudyEntries`            | function  | Collects the executable entries a profile selects, each canonical path once.              |
| `collectStudyEvidence`           | function  | Reads sealed evidence bytes through custody checks without loading executable code.       |
| `computeStudyCommandFingerprint` | function  | Computes the native supervisor's exact validated execution fingerprint.                   |
| `computeStudyFixtureDigest`      | function  | Computes public fixture identity from execution policy and exact scenario bytes.          |
| `computeStudyInstrumentDigest`   | function  | Computes the instrument identity binding trusted runtime bytes to the adapter inventory.  |
| `computeStudyPacketDigest`       | function  | Computes a bundle identity binding exact public packet and private map bytes.             |
| `computeStudyPartition`          | function  | Partitions records by their explicit execution fact without inferring any.                |
| `computeStudyProfileDigest`      | function  | Binds the canonical fully resolved execution profile carried over IPC.                    |
| `computeStudyReport`             | function  | Computes whole-horizon results with operational costs and repetitions kept distinct.      |
| `computeStudyScores`             | function  | Computes arm intervals over the complete declared criterion horizon.                      |
| `computeStudySealId`             | function  | Computes an execution seal identity from its exact sorted inventory.                      |
| `containsArtifact`               | function  | Checks strict lexical containment under a selected directory.                             |
| `createStudyProcessFailure`      | function  | Creates attributable protocol infrastructure failure.                                     |
| `decodeStudyJSON`                | function  | Decodes strict UTF-8 custody bytes and parses their JSON text.                            |
| `drainStudyChild`                | function  | Releases inherited output handles a bounded time after native exit.                       |
| `encodeStudyJSON`                | function  | Encodes deterministic JSON bytes without synthesizing execution metadata.                 |
| `failStudyTicket`                | function  | Records an error that escaped admitted work as the failure of its ticket.                 |
| `failureToStudyError`            | function  | Converts an operational reading to its throwable boundary.                                |
| `gradeStudyEvidence`             | function  | Grades every declared trial and criterion pair through the consumer's predicate.          |
| `hashStudyBytes`                 | function  | Computes the lowercase SHA-256 identity of exact bytes or UTF-8 text.                     |
| `isArtifactError`                | function  | Narrows a caught value to an artifact refusal.                                            |
| `isStudyAdapter`                 | function  | Checks whether a factory returned the complete consumer adapter contract.                 |
| `isStudyBounds`                  | function  | Checks whether nested scopes admit no larger allowance than their parent.                 |
| `isStudyCause`                   | const     | Checks whether a value names an operational ending.                                       |
| `isStudyCharge`                  | function  | Checks a request's declared role and finite cost ceilings.                                |
| `isStudyCriterion`               | function  | Checks whether a criterion declares exact grading inputs and references.                  |
| `isStudyCustodyAttempt`          | function  | Checks whether an attempt terminally accounts for the exact scheduled goal horizon.       |
| `isStudyCustodyEvidence`         | function  | Checks whether evidence is exact JSON with a declared event and goal name.                |
| `isStudyCustodyFailure`          | function  | Checks whether a failure carries exact attributable operational fields.                   |
| `isStudyCustodyFile`             | function  | Checks whether an execution file inventory entry is path-safe and bounded.                |
| `isStudyCustodyManifest`         | function  | Checks whether a manifest exactly binds its declared population and identities.           |
| `isStudyCustodyName`             | function  | Checks whether a trial name is portable on all supported hosts.                           |
| `isStudyCustodyObservation`      | function  | Checks whether an observation preserves output or an explicit unexecuted failure.         |
| `isStudyCustodySeal`             | function  | Checks whether a seal has an exact unique execution inventory.                            |
| `isStudyCustodyTrial`            | function  | Checks whether a scheduled trial has exact valid identity fields.                         |
| `isStudyDefinition`              | function  | Checks whether a study freezes a complete arm order for every repetition.                 |
| `isStudyDigest`                  | function  | Checks whether a byte identity is a lowercase SHA-256 digest.                             |
| `isStudyError`                   | function  | Narrows a caught value to an attributable study error.                                    |
| `isStudyErrorCode`               | function  | Checks whether a value names a supported study error code.                                |
| `isStudyEvidence`                | function  | Checks append-only public evidence.                                                       |
| `isStudyFrame`                   | function  | Checks the complete transport envelope before domain handling.                            |
| `isStudyGoal`                    | function  | Checks whether a goal has a bounded identifier and exact JSON input.                      |
| `isStudyGrading`                 | function  | Checks whether grading binds accountable judgments to unique attempt identities.          |
| `isStudyIdentity`                | function  | Checks the exact digest fields carried by the execution declaration.                      |
| `isStudyJudgment`                | function  | Checks whether a judgment carries a supported verdict and evidence references.            |
| `isStudyLabels`                  | function  | Checks whether imported semantic labels have accountable packet provenance.               |
| `isStudyLimit`                   | function  | Checks whether all allowances are positive safe integers within timer bounds.             |
| `isStudyName`                    | function  | Checks whether an identifier is portable and bounded.                                     |
| `isStudyProcessFailure`          | function  | Checks operational failure attribution arriving over IPC.                                 |
| `isStudyProduct`                 | function  | Checks a retained public product without awarding task achievement.                       |
| `isStudyProfile`                 | function  | Checks whether a profile carries finite bounds and an optional explicit provider.         |
| `isStudyProvider`                | function  | Checks whether a provider declaration names artifacts, an HTTP origin and models.         |
| `isStudyRole`                    | const     | Checks whether a value names a measured request role.                                     |
| `isStudyRoom`                    | function  | Checks whether generation room leaves positive context for input.                         |
| `isStudyRubric`                  | function  | Checks whether a rubric declares nonempty criteria with unique identities.                |
| `isStudyScenario`                | function  | Checks whether a scenario declares a nonempty horizon with unique goal ids.               |
| `isStudyTimestamp`               | function  | Checks whether a timestamp is a canonical UTC millisecond instant.                        |
| `isStudyTrial`                   | function  | Checks a fresh trial's declared identifiers.                                              |
| `isStudyUsage`                   | function  | Checks whether request usage contains nonnegative safe measurements.                      |
| `matchesStudyKeys`               | function  | Matches exact own enumerable data keys without evaluating accessors.                      |
| `normalizeStudyProfile`          | function  | Omits every undefined optional declaration so the profile has one JSON form.              |
| `omitStudyAbsent`                | function  | Copies the own entries of a record that hold a value, in their original order.            |
| `parseStudyArguments`            | function  | Parses public command tokens with operation-specific grammar diagnostics.                 |
| `parseStudyDefinition`           | function  | Parses a definition into an independent frozen validated snapshot.                        |
| `parseStudyGrading`              | function  | Parses grading into an independent frozen validated evidence snapshot.                    |
| `parseStudyLabels`               | function  | Parses semantic labels into an independent frozen validated evidence snapshot.            |
| `parseStudyProfile`              | function  | Parses a profile into an independent frozen validated snapshot.                           |
| `parseStudyRubric`               | function  | Parses a rubric into an independent frozen validated snapshot.                            |
| `parseStudyScenario`             | function  | Parses a scenario into an independent frozen validated snapshot.                          |
| `readArtifact`                   | function  | Reads a bounded regular file only through its canonical absolute path.                    |
| `readStudyAdapter`               | function  | Reads a complete adapter from an admitted module namespace.                               |
| `readStudyBytes`                 | function  | Reads bounded regular-file bytes without following a symbolic link.                       |
| `readStudyFailure`               | function  | Reads an operational error without inventing a task verdict.                              |
| `readStudyResult`                | function  | Inspects custody bytes offline and verifies complete execution before grading.            |
| `resolveStudyInstrument`         | function  | Resolves the actual host package from its trusted executable entry.                       |
| `resolveStudyPath`               | function  | Resolves a portable relative artifact path strictly inside its selected directory.        |
| `resolveStudyProfile`            | function  | Resolves the execution profile's caller-selected built artifact paths.                    |
| `scanStudyExecution`             | function  | Scans regular execution files while refusing unknown directories and linked paths.        |
| `terminateStudyChild`            | function  | Terminates the recorded native process tree under a finite cleanup allowance.             |
| `toStudyWire`                    | function  | Projects optional domain fields into the JSON wire representation.                        |
| `translateStudyPacketLabels`     | function  | Translates bound neutral imported labels through the sealed semantic horizon.             |
| `validateStudyEvidenceBytes`     | function  | Validates complete evidence lines and per-goal encoded evidence bounds.                   |
| `validateStudyInputs`            | function  | Validates grading coverage and request room against the declared study inputs.            |
| `validateStudyRuntime`           | function  | Refuses a profile that omits the actual host runtime's declared dependency bytes.         |
| `writeStudyBytes`                | function  | Writes an exclusive regular record and synchronizes it before reporting success.          |

## Methods

The following tables name the callable members.

#### `Artifacts`

The declaration exposes these methods.

| Method    | Summary                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `inspect` | Reads and identifies admitted files without evaluating selected modules. |
| `load`    | Imports one selected entry through synchronous captured-byte hooks.      |
| `verify`  | Refuses byte and population drift since inspection.                      |

#### `Resolution`

The declaration exposes these methods.

| Method    | Summary                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `load`    | Returns captured bytes after verifying their live disk identity.               |
| `resolve` | Resolves native edges with source-local JavaScript-to-TypeScript substitution. |

#### `StudyAdapterInterface`

The declaration exposes these methods.

| Method     | Summary                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `driver`   | Constructs the consumer's driver over admitted module namespaces.                |
| `grade`    | Judges retained evidence without changing the executed trajectory.               |
| `validate` | Checks domain declarations before loading a selected agent, subject or provider. |

#### `StudyAdmissionInterface`

The declaration exposes these methods.

| Method  | Summary                                                                               |
| ------- | ------------------------------------------------------------------------------------- |
| `admit` | Resolves admission before dispatch; local meters may return the ticket synchronously. |

#### `StudyArtifacts`

The declaration exposes these methods.

| Method    | Summary                                                  |
| --------- | -------------------------------------------------------- |
| `adapter` | Loads the adapter from the trial inventory.              |
| `inspect` | Inventories bytes without importing selected code.       |
| `load`    | Loads admitted built namespaces inside the trial child.  |
| `verify`  | Refuses instrument and inventory drift after inspection. |

#### `StudyCLI`

The declaration exposes these methods.

| Method    | Summary                                                 |
| --------- | ------------------------------------------------------- |
| `execute` | Executes one route with truthful public exit semantics. |

#### `StudyChannel`

The declaration exposes these methods.

| Method    | Summary                                                      |
| --------- | ------------------------------------------------------------ |
| `abort`   | Forwards cancellation without closing the cleanup transport. |
| `close`   | Removes endpoint handlers and rejects all unresolved calls.  |
| `request` | Sends one correlated domain request.                         |

#### `StudyCommand`

The declaration exposes these methods.

| Method    | Summary                                                              |
| --------- | -------------------------------------------------------------------- |
| `execute` | Parses command tokens once and executes their independent operation. |

#### `StudyControl`

The declaration exposes these methods.

| Method  | Summary                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| `close` | Removes the lifecycle listener without changing the retained failure.         |
| `fail`  | Latches an operational failure and cancels all linked work.                   |
| `wait`  | Races work against cancellation and removes its listener after either ending. |

#### `StudyControlInterface`

The declaration exposes these methods.

| Method  | Summary                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| `close` | Removes the lifecycle listener without changing the retained failure.         |
| `fail`  | Latches an operational failure and cancels all linked work.                   |
| `wait`  | Races work against cancellation and removes its listener after either ending. |

#### `StudyCustodySinkInterface`

The declaration exposes these methods.

| Method   | Summary                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| `append` | Appends bounded domain evidence to the owned execution record.                |
| `close`  | Closes admission immediately and synchronizes all previously admitted writes. |

#### `StudyDeadline`

The declaration exposes these methods.

| Method | Summary                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| `wait` | Waits for work under a fresh failure owner and releases its timer and listener. |

#### `StudyDeadlineInterface`

The declaration exposes these methods.

| Method | Summary                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| `wait` | Waits for work under a fresh failure owner and releases its timer and listener. |

#### `StudyDriverInterface`

The declaration exposes these methods.

| Method | Summary                                             |
| ------ | --------------------------------------------------- |
| `open` | Creates fresh domain state for one scheduled trial. |

#### `StudyEvidenceSink`

The declaration exposes these methods.

| Method   | Summary                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| `append` | Admits exact encoded bytes before queuing an append in call order.            |
| `close`  | Closes admission immediately and synchronizes all previously admitted writes. |

#### `StudyGradings`

The declaration exposes these methods.

| Method  | Summary                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| `read`  | Reads an immutable grading version and verifies every bound artifact byte.    |
| `write` | Retains a deterministic grading version or verifies identical existing bytes. |

#### `StudyLauncher`

The declaration exposes these methods.

| Method    | Summary                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `execute` | Checks and supervises the requested command under its finite native allowance. |

#### `StudyMeter`

The declaration exposes these methods.

| Method  | Summary                                                                 |
| ------- | ----------------------------------------------------------------------- |
| `admit` | Reserves one request atomically across all enclosing allowances.        |
| `close` | Refuses unfinished requests before closing a goal's admission boundary. |

#### `StudyMeterInterface`

The declaration exposes these methods.

| Method  | Summary                                                                               |
| ------- | ------------------------------------------------------------------------------------- |
| `admit` | Resolves admission before dispatch; local meters may return the ticket synchronously. |
| `close` | Refuses unfinished requests before closing a goal's admission boundary.               |

#### `StudyProcessDriver`

The declaration exposes these methods.

| Method | Summary                                                          |
| ------ | ---------------------------------------------------------------- |
| `open` | Opens isolated child state and waits for its verified readiness. |

#### `StudyProcessSession`

The declaration exposes these methods.

| Method    | Summary                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `close`   | Requests verified cleanup, then terminates only this recorded process tree.         |
| `execute` | Runs one ordered goal through parent-authorized requests and acknowledged evidence. |
| `start`   | Starts the child and verifies its artifact-bound readiness.                         |

#### `StudyRemoteMeter`

The declaration exposes these methods.

| Method  | Summary                                                                  |
| ------- | ------------------------------------------------------------------------ |
| `abort` | Propagates the parent's ticket cancellation without changing its cause.  |
| `admit` | Requests and awaits the parent's dispatch grant.                         |
| `close` | Closes admission and requires every ticket and acknowledgment to finish. |

#### `StudyRemoteMeterInterface`

The declaration exposes these methods.

| Method  | Summary                                                                               |
| ------- | ------------------------------------------------------------------------------------- |
| `abort` | Propagates the parent's ticket cancellation without changing its cause.               |
| `admit` | Resolves admission before dispatch; local meters may return the ticket synchronously. |
| `close` | Closes admission and requires every ticket and acknowledgment to finish.              |

#### `StudyRemoteTicket`

The declaration exposes these methods.

| Method   | Summary                                                         |
| -------- | --------------------------------------------------------------- |
| `fail`   | Sends operational failure while preserving unknown actual cost. |
| `finish` | Sends actual usage for authoritative parent settlement.         |

#### `StudyRequest`

The declaration exposes these methods.

| Method   | Summary                                                                        |
| -------- | ------------------------------------------------------------------------------ |
| `fail`   | Retains unknown cost conservatively and latches the first operational failure. |
| `finish` | Retains actual measurements and refuses invalid or excessive charges.          |

#### `StudyResults`

The declaration exposes these methods.

| Method   | Summary                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| `create` | Exclusively creates the result directory and initial manifest bytes.              |
| `finish` | Closes evidence admission, drains admitted appends, and writes a terminal record. |
| `seal`   | Seals exact execution inventory after every scheduled trial has terminated.       |
| `start`  | Exclusively creates the evidence sink for an exact scheduled trial.               |

#### `StudyResultsInterface`

The declaration exposes these methods.

| Method   | Summary                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| `create` | Exclusively creates the result directory and initial manifest bytes.          |
| `finish` | Retains the terminal record for one scheduled trial.                          |
| `seal`   | Seals a complete terminal population with its exact execution-byte inventory. |
| `start`  | Opens append-only evidence custody for one scheduled trial.                   |

#### `StudyScope`

The declaration exposes these methods.

| Method    | Summary                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `check`   | Checks cumulative consumption and every pending ceiling before admission. |
| `close`   | Checks deadline attribution before clearing the timer.                    |
| `reserve` | Reserves one request after the enclosing meter checked all scopes.        |
| `settle`  | Commits known charges while retaining ceilings for missing measurements.  |

#### `StudyScopeInterface`

The declaration exposes these methods.

| Method    | Summary                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `check`   | Checks cumulative consumption and every pending ceiling before admission. |
| `close`   | Checks deadline attribution before clearing the timer.                    |
| `reserve` | Reserves one request after the enclosing meter checked all scopes.        |
| `settle`  | Commits known charges while retaining ceilings for missing measurements.  |

#### `StudySeries`

The declaration exposes these methods.

| Method    | Summary                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute` | Runs every declared trial once and retains explicit unexecuted observations after failure. Custody rejection leaves the run unsealed; callers must seal only a fulfilled execution. |

#### `StudySessionInterface`

The declaration exposes these methods.

| Method    | Summary                                                             |
| --------- | ------------------------------------------------------------------- |
| `close`   | Releases the trial's domain resources.                              |
| `execute` | Executes one public goal against the trial's retained domain state. |

#### `StudySinkInterface`

The declaration exposes these methods.

| Method   | Summary                                                        |
| -------- | -------------------------------------------------------------- |
| `append` | Appends bounded domain evidence to the owned execution record. |

#### `StudyStoreInterface`

The declaration exposes these methods.

| Method   | Summary                                                     |
| -------- | ----------------------------------------------------------- |
| `finish` | Retains the terminal record for one scheduled trial.        |
| `start`  | Opens append-only evidence custody for one scheduled trial. |

#### `StudyTask`

The declaration exposes these methods.

| Method    | Summary                                                        |
| --------- | -------------------------------------------------------------- |
| `execute` | Executes one validation or grading operation in a fresh child. |

Task and trial children settle on their close event, which waits for inherited output handles. After a child's native exit those handles are destroyed once `STUDY_DRAIN_DURATION` (1 second) elapses, so a descendant that holds the output cannot leave the parent unsettled. A task still rejects for a missing complete response, and a session still rejects its start and fulfills its close. This releases only the parent's read handles: a descendant that survives an exited root is outside discoverable-tree cleanup and is neither found nor terminated. Linux behavior is unverified.

#### `StudyTaskWorker`

The declaration exposes these methods.

| Method    | Summary                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `execute` | Processes exactly one inherited request and returns a bounded response. |

#### `StudyTicket`

The declaration exposes these methods.

| Method   | Summary                                                   |
| -------- | --------------------------------------------------------- |
| `fail`   | Records an attributable failure for one admitted request. |
| `finish` | Records actual measurements for one admitted request.     |

#### `StudyWorker`

The declaration exposes these methods.

| Method    | Summary                                                        |
| --------- | -------------------------------------------------------------- |
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

### omitStudyAbsent

Use the exported declaration with its documented arguments.

```ts
import { omitStudyAbsent } from '@orkestrel/study'

omitStudyAbsent({ context: 512, recap: undefined }) // { context: 512 }
```

### normalizeStudyProfile

Use the exported declaration with its documented arguments.

```ts
import { normalizeStudyProfile } from '@orkestrel/study'

normalizeStudyProfile(profile) // no `recap` key when the room declares none
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
isStudyRoom({ context: 20480, output: 8192, safety: 512, think: true }) // true
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

### isStudyProduct

Use the exported declaration with its documented arguments.

```ts
import { isStudyProduct } from '@orkestrel/study'

isStudyProduct({ value: { answer: 1 }, partial: true }) // true
```

### isStudyCriterion

Use the exported declaration with its documented arguments.

```ts
import { isStudyCriterion } from '@orkestrel/study'

isStudyCriterion({
	id: 'saved',
	scenario: 'shift',
	goal: 'write',
	method: 'state',
	critical: true,
	assertion: true,
}) // true
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

isStudyJudgment({
	trial: 'r1-s1-a1',
	criterion: 'saved',
	verdict: 'unknown',
	method: 'state',
	reason: 'No evidence',
	references: [],
}) // true
```

### isStudyLabels

Use the exported declaration with its documented arguments.

```ts
import { isStudyLabels } from '@orkestrel/study'

isStudyLabels({}) // false
```

### isStudyErrorCode

Use the exported declaration with its documented arguments.

```ts
import { isStudyErrorCode } from '@orkestrel/study'

isStudyErrorCode('CONFIG') // true
```

### isStudyGrading

Use the exported declaration with its documented arguments.

```ts
import { isStudyGrading } from '@orkestrel/study'

isStudyGrading({}) // false
```

### Refuse an incomplete adapter

Use the exported declaration with its documented arguments.

```ts
import { isStudyAdapter } from '@orkestrel/study/server'

isStudyAdapter({}) // false
```

### Fail an escaped request

Use the exported declaration with its documented arguments.

```ts
import type { StudyTicket } from '@orkestrel/study'
import { failStudyTicket } from '@orkestrel/study'

declare const ticket: StudyTicket

failStudyTicket(ticket, new Error('Provider refused'), 'tool')
```

### Cite a retained evidence row

Use the exported declaration with its documented arguments.

```ts
import type { StudyGradeTarget } from '@orkestrel/study/server'
import { buildStudyReference } from '@orkestrel/study/server'

declare const target: StudyGradeTarget

buildStudyReference(target, { file: 'evidence', row: 0 }) // 'trials/r1-s1-a1/evidence.jsonl#1'
```

### Grade retained evidence with a consumer predicate

Use the exported declaration with its documented arguments.

```ts
import type { StudyAdjudication, StudyGradeFunction } from '@orkestrel/study/server'
import { gradeStudyEvidence } from '@orkestrel/study/server'

declare const input: StudyAdjudication
declare const grade: StudyGradeFunction

gradeStudyEvidence(input, grade)
```

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

### computeStudyPartition

Use the exported declaration with its documented arguments.

```ts
import { computeStudyPartition } from '@orkestrel/study/server'

computeStudyPartition(attempts) // { executed: 2, unexecuted: 1 }
```

### Parse a study command

Use the exported declaration with its documented arguments.

```ts
import { parseStudyArguments } from '@orkestrel/study/server'

parseStudyArguments(['check', 'files', '--profile', 'local'])
```

### Identify captured bytes

Use the exported declaration with its documented arguments.

```ts
import { hashStudyBytes } from '@orkestrel/study/server'

hashStudyBytes('retained evidence')
```

### Encode custody bytes

Use the exported declaration with its documented arguments.

```ts
import { encodeStudyJSON } from '@orkestrel/study/server'

encodeStudyJSON({ id: 1 })
```

### decodeStudyJSON

Use the exported declaration with its documented arguments.

```ts
import { decodeStudyJSON } from '@orkestrel/study/server'

decodeStudyJSON(new TextEncoder().encode('{"id":1}')) // { id: 1 }
```

### Project a wire value

Use the exported declaration with its documented arguments.

```ts
import { toStudyWire } from '@orkestrel/study/server'

toStudyWire({ state: 'ready', failure: undefined }) // { state: 'ready' }
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
import {
	collectStudyEntries,
	computeStudyInstrumentDigest,
	computeStudyProfileDigest,
	containsArtifact,
	createStudyProcessFailure,
	drainStudyChild,
	isArtifactError,
	isStudyCharge,
	isStudyEvidence,
	isStudyFrame,
	isStudyIdentity,
	isStudyProcessFailure,
	isStudyTrial,
	readArtifact,
	readStudyAdapter,
	resolveStudyInstrument,
	terminateStudyChild,
	validateStudyRuntime,
} from '@orkestrel/study/server'

declare const collectStudyEntriesArguments: Parameters<typeof collectStudyEntries>
collectStudyEntries(...collectStudyEntriesArguments)
declare const computeStudyInstrumentDigestArguments: Parameters<typeof computeStudyInstrumentDigest>
computeStudyInstrumentDigest(...computeStudyInstrumentDigestArguments)
declare const computeStudyProfileDigestArguments: Parameters<typeof computeStudyProfileDigest>
computeStudyProfileDigest(...computeStudyProfileDigestArguments)
declare const containsArtifactArguments: Parameters<typeof containsArtifact>
containsArtifact(...containsArtifactArguments)
declare const createStudyProcessFailureArguments: Parameters<typeof createStudyProcessFailure>
createStudyProcessFailure(...createStudyProcessFailureArguments)
declare const drainStudyChildArguments: Parameters<typeof drainStudyChild>
drainStudyChild(...drainStudyChildArguments)
declare const failureToStudyErrorArguments: Parameters<typeof failureToStudyError>
failureToStudyError(...failureToStudyErrorArguments)
declare const isArtifactErrorArguments: Parameters<typeof isArtifactError>
isArtifactError(...isArtifactErrorArguments)
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
declare const isStudyTrialArguments: Parameters<typeof isStudyTrial>
isStudyTrial(...isStudyTrialArguments)
declare const readArtifactArguments: Parameters<typeof readArtifact>
readArtifact(...readArtifactArguments)
declare const readStudyAdapterArguments: Parameters<typeof readStudyAdapter>
readStudyAdapter(...readStudyAdapterArguments)
declare const readStudyFailureArguments: Parameters<typeof readStudyFailure>
readStudyFailure(...readStudyFailureArguments)
declare const resolveStudyInstrumentArguments: Parameters<typeof resolveStudyInstrument>
resolveStudyInstrument(...resolveStudyInstrumentArguments)
declare const terminateStudyChildArguments: Parameters<typeof terminateStudyChild>
terminateStudyChild(...terminateStudyChildArguments)
declare const validateStudyRuntimeArguments: Parameters<typeof validateStudyRuntime>
validateStudyRuntime(...validateStudyRuntimeArguments)
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

### Call StudyCLI methods

Supply an instance of the declared contract.

```ts
import type { StudyCLI } from '@orkestrel/study/server'

declare const instance: StudyCLI
declare const execute: Parameters<StudyCLI['execute']>
instance.execute(...execute)
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

### Call StudyCommand methods

Supply an instance of the declared contract.

```ts
import type { StudyCommand } from '@orkestrel/study/server'

declare const instance: StudyCommand
declare const execute: Parameters<StudyCommand['execute']>
instance.execute(...execute)
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

### Call StudyDeadline methods

Supply an instance of the declared contract.

```ts
import type { StudyDeadline } from '@orkestrel/study'

declare const instance: StudyDeadline
declare const wait: Parameters<StudyDeadline['wait']>
instance.wait(...wait)
```

### Call StudyDeadlineInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyDeadlineInterface } from '@orkestrel/study'

declare const instance: StudyDeadlineInterface
declare const wait: Parameters<StudyDeadlineInterface['wait']>
instance.wait(...wait)
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

### Call StudyLauncher methods

Supply an instance of the declared contract.

```ts
import type { StudyLauncher } from '@orkestrel/study/server'

declare const instance: StudyLauncher
declare const execute: Parameters<StudyLauncher['execute']>
instance.execute(...execute)
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
- [tests/src/server](../tests/src/server)
- [tests/src/bin](../tests/src/bin)
