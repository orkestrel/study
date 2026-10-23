# Study

> Bounded comparative execution with captured artifacts and separate grading.

The host-independent engine is exported from `@orkestrel/study`; custody and native workers are exported from `@orkestrel/study/server`. Study requires Node.js 22.18.0 or later. TypeScript consumers of the server entry must install `@types/node` because its declarations import `node:` modules. The core entry needs no Node.js types.

## Execution and evidence

Declare the question, purpose, arms, scenarios, repetition order, and rubric before execution. Each repetition row names every arm exactly once. The engine opens fresh state for each trial and retains state between that trial's ordered goals. It executes the declared schedule once; retries are disabled.

The request meter reserves token and byte ceilings before an adapter dispatches work. Request, goal, trial, and series limits bound enclosing work. Missing actual usage remains unknown and consumes the admitted ceiling. Capacity, infrastructure, deadline, and interruption are operational outcomes; a product never awards its own task verdict. An error that carries a failure keeps that attribution; a study error without one reads as capacity for the `CAPACITY` code and as deadline for the `DEADLINE` code. A branded `BudgetError` from any module copy reads as capacity with a `budget` stop and retains its source readings. Every other rejection reads as infrastructure, including an unbranded budget lookalike.

A study error stamps an own, non-enumerable, non-writable `STUDY_ERROR_BRAND` descriptor whose value is the error itself. `isStudyError` requires that descriptor with an `Error` subclass, a declared code, and valid optional failure attribution. Subclasses can replace the name. Failure stops are checked structurally, including class instances and inherited fields; serialized admission retains its exact-record checks. The guard reads through the contract package's captured reflection inside its never-throw boundary, so a study error thrown by another package, ESM, CommonJS, or captured module copy keeps its code and attribution. The brand uses the global symbol registry: it is recognition, not unforgeable provenance. An unbranded older copy, an inherited or borrowed brand, a transparent proxy, malformed failure attribution, and a property-only lookalike read as infrastructure.

Within one module format, the root and server entries share one `StudyError` class, so both `instanceof StudyError` and `isStudyError` recognize server errors. The ESM and CommonJS builds carry separate classes. Across module formats, recognize a server error with `isStudyError`; `instanceof StudyError` is false.

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
import { StudyResultStore, readStudyResult } from '@orkestrel/study/server'

declare const directory: string
declare const manifest: StudyManifest
declare const attempts: readonly StudyAttempt[]

const results = new StudyResultStore({ directory, manifest })
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

Captured identities bind admitted files, module selections, and Node runtime settings. Recorded replay reproduces exact application HTTP bodies through the declared collaborator; it identifies neither the entire machine nor the external service, TLS records, or transfer framing. Neutral semantic identifiers omit treatment and model names, but input and product text can reveal design details. This guide's executable examples prove local admission and custody; they do not establish GPU capacity or model quality.

## Captured loading

Select canonical absolute package roots and built ESM entries under each package's dist directory. Inspection captures bytes without evaluating modules. Verification compares captured bytes to disk. Loading evaluates the selected entry through captured-byte hooks and verifies again after evaluation.

Admit every package root reached by native dependency resolution, including installed copies alongside a selected local package. Distinct canonical roots may share a package name; each root and its captured bytes retain their own identity. Repeated roots refuse inspection, and imports into omitted roots refuse loading before evaluation.

Select a consumer-owned source directory separately when the adapter needs strip-only TypeScript. Its graph cannot overlap a built package graph. Source JSON files cannot be executable imports. Explicit assets retain exact file bytes in custody without granting import eligibility. Fixture and rubric bytes retain separate execution identities. Native package exports and extension rules still govern resolution. The inventory records package manifests, captured files, explicit assets, selected entries, Node version, and runtime settings.

Select excluded built files to refuse every import edge that reaches them; exclusion leaves the inventory identity unchanged. Run loading in a disposable worker and terminate the worker afterwards. A process admits one loaded inventory. Trusted code can use native process APIs, evaluation, and external services; the loader does not replay those resources or sandbox hostile code.

Call the `materialize` method with an absent absolute destination under an existing physical parent. Materialization preserves the admitted physical forest, including nested node_modules and duplicate package copies. It copies exact bytes and verifies source before and after copying and the entire destination before returning. Explicit assets join the existing aggregate capture limits. Different source or destination volumes, overlap, occupied destinations, links and redirected ancestors, aliases, unsafe names, duplicate keys, and stale source references refuse before copying through them.

The portable closure digest binds sorted member keys, byte digests, sizes, and relative package identities. It excludes source provenance and the destination path. The relocated loader identity retains its canonical paths and runtime settings separately. Path checks and reads do not provide an atomic filesystem snapshot, concurrent hardlink-race resistance, or crash recovery.

### Inspect selected bytes

Supply a canonical named ESM package root and an admitted built entry. The returned inventory identifies the selected bytes without executing the entry.

```ts
import { ArtifactLoader } from '@orkestrel/study/server'

declare const root: string
declare const entry: string

const artifacts = new ArtifactLoader({ roots: [root], entries: [entry] })
const inventory = artifacts.inspect()
const selected = inventory.entries.includes(entry) // true
artifacts.verify()
```

## Consumer boundary

An authored consumer module exports a factory named createStudyAdapter. The factory returns an adapter with validation, driver construction, and retained-evidence grading. Validation receives generic declarations before agent, subject, or provider modules execute. During validation, an import edge that reaches the selected agent, subject, or provider entry, directly or through another module, refuses the check; other admitted modules still load. A driver receives admitted module namespaces, its execution profile, and exclusive scratch resources.

Keep grading criteria outside public goal input. Grade retained observations and evidence independently of execution. Return unknown judgments when evidence is unavailable; preserve the criterion's declared method. Adapter code runs as trusted instrumentation in bounded child work and is not a security sandbox.

Call `gradeStudyEvidence` from an adapter's grade method to traverse the declared schedule and criteria. The traversal validates the manifest, rubric, attempts, evidence, and every declared goal when called directly, so a public grading helper keeps that validation. It calls the supplied `StudyGradeFunction` for every trial and criterion of that trial's scenario, in schedule then rubric order, and a trial without a retained attempt still receives a judgment with no attempt and no evidence. The predicate returns the verdict, method, reason, and `StudyReference` citations. The traversal renders each citation as a retained path, with a one-based position for an evidence row, and refuses a citation of a trial that was not retained or a row that does not exist. Domain predicates, whole-attempt or per-goal success, and expected refusals remain in the consumer.

## Agent instrumentation

An Agent-backed consumer passes the admitted Agent namespace to the shared instrumentation, which imports Agent types only and constructs nothing from an installed Agent copy. Request measurements, the nominal Agent error, and daemon timing keep the types their owning Agent and Ollama packages export; Study declares no copy of them. The `StudyAgentObserver` class delegates every provider call unchanged and records one size reading before each dispatch. The gauge is explicit: without one, a reading carries no projection. The enforced option selects the usage policy separately from observation, so a passive reading refuses no return. The `StudyAgentJudge` class binds a real judge to a `StudyLatchInterface` owner, so a caught classification failure stays visible to the study.

The `StudyOllamaTransport` class admits model requests through the goal's meter and metadata through an independent declared budget for calls, bytes, and duration. Metadata has no model-meter parent. Each response retains its byte and duration limits, actual usage precedes a policy refusal, and the first operational failure keeps its identity. Each model role declares its exact Ollama options, think allowance, strict truncate and shift fields, and length-finish policy. Maintenance attribution carries no generation policy. The transport refuses an undeclared role and keeps unreported usage unknown. The `prepare` method binds later requests to one goal until the `clear` or `close` method ends it, and refuses with the `FAULT` code while a goal is bound or a response is open. The `fetch` and `verify` methods refuse with the `FAULT` code when no goal is bound, and `verify` retains that refusal. A request admitted before `clear` keeps its goal, and each goal's checkpoint joins only that goal's first observed dispatch.

Recording requires version, procedure, and exchange sink together. Preflight and postflight verify version, tags, and show for each distinct pinned model. Ordered exact steps compare UTF-8 bytes and verify their declared SHA-256 receipt; capture steps require their declared positive safe byte length and forbid body or input members. Goal, role, route, policy, and order are checked before sending. A second request and verification during request admission refuse. The sink supplies each HTTP ordinal, which joins dispatch and wire evidence even without passive observation. An attempt retains request bytes before sending. A validated response retains native status, selected headers, exact bytes, and chunk lengths; a failure retains bounded partial bytes and cannot produce completion. Successful postflight appends completion after every declared step has finished. The worker owns the preceding declaration and any maintenance prefix.

The transport owns its configuration before validation and snapshots each outbound URL, settings, headers, and request correlation before awaiting admission. Later caller mutation cannot change the admitted request. Cancellation signals, the timing callback, and the optional fetch collaborator retain their live identity.

The `StudyOllamaTransportOptions` interface accepts an optional `fetch` collaborator with the `StudyOllamaFetchFunction` signature. Omit the option to keep native fetch. When supplied, the collaborator receives the validated Study role, URL, encoded body, headers, bounded signal, and `redirect: 'error'` at the send boundary. Agent and summary keep distinct roles even when they share a model. Construction refuses a present non-callable collaborator with the `CONFIG` code.

The collaborator returns a native `Response` and never settles a Study ticket. Study keeps request validation, admission, dispatch evidence, response status and byte bounds, terminal and timing checks, cancellation, accounting, and the failure latch. A synchronous throw, HTTP refusal, incomplete stream, abort, or cap follows the existing accounting path. Caller abort, the request deadline, and the `close` method settle a pending collaborator wait with the signal's reason even if the collaborator ignores cancellation; Study accounts the request once, retains the failure, and cancels a response that arrives later.

### Forward admitted requests by role

Supply the forwarding function inside the process that constructs the transport. This example retains the roles and delegates the supplied request settings to native fetch.

```ts
import type { StudyRole } from '@orkestrel/study'
import type { StudyOllamaTransportOptions } from '@orkestrel/study/server'
import { StudyOllamaTransport } from '@orkestrel/study/server'

declare const configured: StudyOllamaTransportOptions
const roles: StudyRole[] = []
const transport = new StudyOllamaTransport({
	...configured,
	fetch: (role, input, init) => {
		roles.push(role)
		return globalThis.fetch(input, init)
	},
})
// Prepare the goal, then use transport.fetch or transport.verify as usual.
// Study reads each returned response before completing its accounting.
```

The server entry adds a trace, a gauged summary, and a scripted provider over the same admitted Agent capabilities. The consumer passes those capabilities as `runtime`; none of the three imports an Agent runtime. The consumer keeps its model prompts, treatment options, origin joins, and grade policy.

The `StudyAgentTrace` class numbers each measured request and retains its context, estimate, and capacity-refusal rows for the active goal. Ordinals, dispatch numbers, and role identities continue across a trial's goals. The `observe` option selects those measurement and refusal rows. When it is `false`, `append` still retains a domain row for an active goal, and a row outside a goal is dropped. The `start` method refuses with the `CONFIG` code while a goal is active and leaves that goal and its rows unchanged. The `flush` method appends the rows to a `StudySinkInterface` in order, keeps rows appended during the flush, and ends the goal and clears its rows, including when custody refuses a row. A `flush` with no active goal does nothing, and a `flush` while another is pending refuses with the `CONFIG` code and leaves the pending one untouched. The `origins` handler joins each measured message to its consumer origin.

The `StudyAgentSummary` class measures one canonical array, the folded messages followed by the instruction, and sends the very same array to the provider. Construction refuses with the `CONFIG` code unless `limit` is a positive safe integer and the copied gauge passes `isStudyAgentGauge`: its `scale` is finite and greater than 0 and its `overhead` is finite and at least 0. The summary reads each gauge field once and keeps that validated copy. The guard admits extra members; a consumer that requires exact settings keys composes its own key check. A projection that reaches `limit` fails with the `CAPACITY` code before any request is sent. A summary outside an active goal, or with blank content after its evidence row, fails with the `FAULT` code.

The `StudyAgentScript` class serves declared inert responses through the Agent provider boundary. Its constructor takes an explicit encoded `bytes` bound and refuses a value that is not a nonnegative safe integer. The `prepare` method keeps an owned snapshot of a goal's responses, so later caller mutation cannot change a served call. The `prepare` method refuses with the `CONFIG` code while a goal is prepared, and the `clear` method ends the prepared goal. A stream refuses with the `CONFIG` code when no goal is prepared, and a stream already running when `clear` is called finishes under its own goal. The `isStudyAgentResponse` guard accepts a response with JSON calls and sets no limit on content, call count, or `consume`; the consumer composes its own workload bounds. A stream abandoned after admission accounts for an Agent budget cut without latching a failure. Other abandoned streams fail the admitted request with the run signal's reason, or a `FAULT` when the signal carries none.

The `readStudyAgentMessages` function projects provider messages onto the role, content, and call fields a workload reads. The `buildStudyAgentReadings` function projects a Ledger result's readings onto JSON. The `buildStudyOllamaModels` function pins the model, and the judge when the provider declares both its name and digest. The `buildStudyOllamaOptions` function projects a role policy onto provider options and adds `truncate` and `shift` as `false` only for a strict policy.

The `buildStudyAgentToolResult` function projects an executed Agent tool call into its `id`, `name`, owned JSON `arguments`, boolean `success`, and owned JSON `value` or string `error`. The `buildStudyAgentToolDenial` function projects a denied call into its `id` and `name`, with a `reason` only when it is a string. Both refuse a malformed call with the `FAULT` code. The result projection also refuses a missing boolean `success`, non-JSON arguments or value, and a malformed failure error. Tool accounting, expected refusals, and workload grading remain in the consumer.

Both projections use `readStudyAgentToolCall` to read each foreign call field once and validate the fresh envelope. The reader retains the arguments record by reference; the result projection owns its JSON copy.

### Read an Agent tool call

Read the envelope before projecting executed or denied evidence.

```ts
import { readStudyAgentToolCall } from '@orkestrel/study/server'

const call = readStudyAgentToolCall({ id: 'c1', name: 'write', arguments: { path: 'note.txt' } })
// { id: 'c1', name: 'write', arguments: { path: 'note.txt' } }
```

### Inspect Agent tool evidence

Validate the gauge independently of settings keys, then retain the Agent's executed or denied call.

```ts
import { isStudyAgentGauge } from '@orkestrel/study'
import { buildStudyAgentToolResult, buildStudyAgentToolDenial } from '@orkestrel/study/server'

const gauge = isStudyAgentGauge({ scale: 1, overhead: -0, label: 'summary' }) // true
const call = { id: 'c1', name: 'write', arguments: { path: 'note.txt' } }
const result = buildStudyAgentToolResult(call, { success: true, value: 'stored' })
// { id: 'c1', name: 'write', arguments: { path: 'note.txt' }, success: true, value: 'stored' }
const denial = buildStudyAgentToolDenial(call, 'refused')
// { id: 'c1', name: 'write', reason: 'refused' }
```

## Stop attribution

A `StudyFailure` record carries an optional reading under `stop`. The `StudyStop` record names the ceiling's `layer`, its `id`, its `max`, and the `consumed` tally including the refused charge. The `StudyLayer` union admits `scope`, `window`, `custody`, `meter`, `budget`, and `model`. A deadline has cause `deadline` and layer `scope`; its id names the duration allowance. An absent reading stays undefined in memory and projects to null through `studyStopToJSON`. The `isStudyStop` guard admits finite source readings, including negative and fractional values. Translation, IPC admission, and custody admission preserve those readings without clamping or relabelling them.

The `translateStudyAgentStop` function translates Agent's own result record. A consumer that refuses that stop throws the returned error. Meter and budget stops leave the Agent run partial; a model truncation can remain a complete answer when the consumer's policy admits it. Provider adapters finish a request cut by a branded budget error with unknown tokens so Agent's eventual record can attribute the layer. The scripted provider appends no row while closing a cut generator. An unbranded lookalike remains an infrastructure failure. A `StudyAgentResponse` declaration can set `truncated: true` to report the model's own token limit.

The report keeps `faults` by cause and adds `attributions` under both trial and goal operations. Each group partitions affected records by cause, role, layer, and execution fact. Groups follow `STUDY_CAUSES`, `STUDY_ROLES`, and `STUDY_LAYERS`, with absent role and layer last. Each group's `readings` preserves source order and carries the trial, the goal at goal level, and the ceiling's id, max, and consumed values. Unexecuted goals inherit the trial's stop and retain their own reading.

The Ollama transport appends a `stop` evidence row after its `wire` row when completion policy refuses a model cap or context room. The nested stop keeps its ceiling id separate from the observed wire id. Observation adds the canonical dispatch, revision, and wire timeline. A budget cut writes a `cut` row with the budget context and finishes the request with known wire bytes and unknown tokens. A failure sealed without a stop stays in the report with a null layer and an empty readings array. Study infers no layer from the old message or evidence.

## Native command

Recording declares `record.bytes` on the profile. The manifest retains the same declaration, and the parent reserves that complete allowance separately for each trial before starting workers. The allowance covers every serialized sidecar byte, including base64 expansion, opening and terminal rows, and LF framing. It consumes series custody without consuming goal evidence or model quota. Recording profiles explicitly supply `settings.version`, `settings.metadata`, and `settings.procedure`; the worker validates those declarations before constructing the adapter driver.

The `StudyExchangeSink` class owns the trial's exclusive exchanges.jsonl descriptor. Its `next` property derives the next HTTP ordinal from accepted attempts, including a verified maintenance prefix. Callers await every append before sending or appending another row. The sink reserves failure-terminal space before an attempt and retains its first refusal. Caught refusals prevent successful completion.

The store admits exchanges.jsonl only when recording is declared. Sealing requires each scheduled trial's complete sidecar, exact declaration order, paired identities, valid raw-body receipts, and one ordered dispatch and wire evidence row per HTTP ordinal. Duplicate, orphaned, reordered, failed, partial, missing, and unrequested histories refuse with the CUSTODY code. Every other unknown file remains refused. The `readStudyExchanges` function reverifies the complete seal and this evidence join before returning a replay history.

Replay execution requires `--replay <result> --prefix <JSON trial counts> --offline <true|false>`. Each positive prefix counts complete HTTP exchanges, including metadata and maintenance. The command verifies every selected trial before adapter validation or worker startup, and each worker rechecks its selected history. The executing profile supplies replay bounds. A supervisor fingerprint also pins changed execution bounds before dependent replay work.

The `StudyOllamaReplay` class validates the complete retained history before construction succeeds. Its projected procedure supplies recorded exact bodies inside the prefix, including bodies originally admitted as capture. A capture declaration without a sealed completed history cannot replay. A changed request inside the prefix refuses without forwarding. After the prefix, only an explicit live collaborator can send requests. Offline replay consumes the complete recorded population and constructs no daemon or native sender. Recorded maintenance consumes prefix positions without sending unload requests. Its `check` method refuses an incomplete prefix, unread responses, or a retained mismatch; its `close` method releases response readers.

The process driver accepts `StudyProcessDriverOptions`. Its optional `prepare` callback runs in the parent before session construction, preserves the reserved destination and allowance, and never crosses structured cloning or IPC. Offline replay refuses a preparation callback. A worker verifies any retained maintenance prefix before resuming the sidecar and projects those ordinals into its first goal's evidence.

A provider's optional `daemon` declaration makes live execution own a dedicated Ollama session at the provider URL. The declaration pins a canonical absolute executable, its SHA-256 digest, the exact version, explicit environment overrides, and distinct model names and inventory digests matching the provider. A relative executable, port 11434, a missing model digest, or conflicting environment-name casing refuses at profile load. The daemon owns the effective OLLAMA_HOST value. Without this declaration, the provider URL selects an external daemon.

The `StudyDaemonSession` class starts and verifies the daemon before trial execution. The manifest's `host.daemon` string retains the verified startup identity; startup version and inventory probes belong to no trial sidecar. Before each trial worker opens, preparation unloads the declared models in order. The `StudyDaemonTrial` class synchronizes each maintenance attempt before sending, retains status, allowed headers, original sender chunk lengths, and exact body bytes, and closes the prefix after daemon validation. A failed exchange retains a failure row. The worker joins the maintenance ordinals to the scenario's first declared goal. Every execution ending awaits daemon stop and process-tree join; an unconfirmed cleanup refuses completion. Offline replay constructs no daemon or preparation callback and sends no maintenance request.

Install the package in the consumer workspace, then run the study executable from that workspace. The selected declaration lives at studies/<name>/study.json, and its declared rubric path resolves inside that same directory. Its driver field selects a bundle at studies/<driver>/ containing scenarios/<scenario>.json, profiles/<profile>.json, and the adapter module index.ts. Several declarations can share one driver bundle while each keeps its own rubric. The profile defaults to local. JSON declarations use the public definition, scenario, profile, and rubric contracts.

The `readStudyDeclaration` function reads the selected definition, scenarios in declared order, and the rubric the definition names. It returns a `StudyDeclaration` record with the driver bundle and each scenario's bundle-relative fixture path and exact byte digest. It refuses a definition name or scenario identity that differs from its selection. The command uses this reader before reading the selected profile, so the refusal order is definition, scenarios, rubric, profile. The `StudyPreparation` record carries the driver's directory as `bundle`.

The `readStudyDeclarationBytes` function reads an already resolved, contained declaration path under the custody metadata allowance. A missing declaration, scenario, rubric, or profile, or a declaration path reached through a symbolic link or junction, refuses with the `CONFIG` code and exit code 64. The reader refuses a link before traversing it. Its diagnostic names the missing path or linked component relative to the consumer root with forward slashes. A missing result refuses with the `CUSTODY` code and exit code 1, naming the result selector as supplied. Result and grading storage retain their custody refusals.

The `matchesSystemError` predicate matches a system code only on an `Error` from this realm and returns false for a throwing code accessor. Structured cloning, such as a worker's `postMessage`, drops a Node error's system code, so the cloned error does not match.

A profile selects the Agent runtime entry in its required agent field and the package under study in its required subject field. The two fields can name the same entry or two entries, including entries from different installed copies of Agent. Each selected entry is captured and loaded once, and the driver receives both namespaces under the declared roles. The selected entries and their bytes are part of the execution identity.

The recap allowance of the room and the judge of the provider are optional. A study that produces no recap omits the recap allowance. A provider declares its judge model and its judge digest together or omits both; declaring only one refuses the profile. A declared recap and a declared judge keep their finite bounds.

A profile may carry an optional settings object of JSON values. The selected driver owns its interpretation; Study only validates the object, keeps an independent frozen copy, and refuses arrays, primitives, non-JSON values, and cycles. Settings are part of the resolved profile bytes, so changing one value changes the profile identity and the execution fingerprint. A profile without settings keeps the identity it had before the field existed.

The command supports explicit operations with operation-specific flags. Every flag takes a value and can appear once.

| Operation     | Command                                                                                                                                                                        | Result                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Validate      | study check <study> [--profile <name>] [--closure <directory>]                                                                                                                 | Fingerprint and suggested pinned execution arguments                  |
| Execute       | study execute <study> [--profile <name>] [--out <path>] [--expected <sha256>] [--closure <directory>] [--replay <result> --prefix <JSON trial counts> --offline <true\|false>] | Execution result identity and suggested independent grading arguments |
| Grade         | study grade <result> --rubric <path>                                                                                                                                           | Immutable grading identity and suggested report arguments             |
| Import labels | study label <result> --grading <sha256> --labels <path>                                                                                                                        | Another immutable grading identity and suggested report arguments     |
| Report        | study report <result> --grading <sha256>                                                                                                                                       | Whole-horizon results for the selected grading                        |
| Freeze        | study freeze <study> --profile <name> --to <directory>                                                                                                                         | Verified closure publication and relocated check fingerprint          |

Success writes a JSON document. The next field contains suggested argv and never executes it automatically. Execution returns a result identity independently of the original study selector. Result selection accepts an identity under tmp/studies, a contained root-relative path, or an absolute path. Relative output paths stay inside the consumer working directory; existing output directories refuse execution. A relative result, --out, --rubric or --labels path, and a declared rubric path, separates its names with forward slashes and names no . or .. segment; profile paths resolve against the consumer root. Without --out, execution writes its result under tmp/studies by its new identity; the suggested execution arguments a check returns carry no --out.

Freeze retains the selected declarations, exact scenario and profile bytes, the adapter graph, every admitted package member, and the trusted runtime entry. It validates the relocated selection in a fresh captured child, rechecks source and destination, and writes closure.json exclusively after those checks pass. The publication retains the original execution identity, the relocated identity, and the relocated fingerprint separately. A validation-time write leaves the destination available for inspection with no publication marker; retry with an absent destination.

Check and execute accept --closure <directory>. Each operation verifies the published member census and bytes, uses the relocated root, entry, profile, and adapter, and compares the fresh check to the retained relocated identity. Only the root closure.json marker sits outside the copied-member census. An added file, omitted member, or changed non-entry dependency or asset refuses validation. The suggested execution arguments retain the closure selection for the supervisor.

Check returns a fingerprint for the declared execution selection. Pass that fingerprint through --expected to pin execution. Both check and execute require a quality profile to declare a qualification path. Execute then requires that path to select a sealed capacity result with the same identity, bounds, schedule, and scenarios and no operational failures. Check validates the declaration offline without opening the capacity result. Capacity and mechanism studies execute without a qualification. Grade names an exact independent rubric path. Label and report require an exact grading identity; no operation guesses a grading version. Imported labels are caller-supplied bytes, not a labeler invoked by this command. A labeled grading binds the preceding grading's instrument, so equal labels over different gradings retain different identities.

The `validateStudyInputs` function enforces the quality qualification requirement after the existing population, profile, room, reference, and coverage checks. Direct callers receive the same `CONFIG` refusal as the command when a quality profile omits its qualification. Capacity and mechanism inputs require no qualification.

A labeled grading's instrument combines the executable entry's byte hash with the inventory digest for its owning Study package. The inventory binds the exact bytes of `package.json` and every `.js`, `.mjs`, `.cjs`, and `.json` file under `dist`, including the server and core entries, with the selected entry, canonical paths, package identity, file sizes, Node version, runtime arguments, `NODE_OPTIONS`, platform, and architecture. Declaration and source-map files are excluded from module capture unless explicitly selected as custody-only assets. Changing an admitted manifest, module, or explicit asset changes its inventory digest. Label identities are host-sensitive, as grading identities are.

Help succeeds on stdout when --help appears anywhere. Empty arguments and invalid public grammar report on stderr with exit code 64. Operational diagnostics carry a study:CODE prefix and the refused token or path when applicable. Other exits are 0 for success, 124 for deadline, 130 for interruption, and 1 for operational failure. Private child routes require the native IPC boundary.

The `study --version` command prints the installed Study package's version and a newline without reading consumer declarations or starting child work. The `readStudyVersion` function reads that package's manifest at run time, independently of the consumer's manifest. Additional version arguments refuse with exit code 64; `--help` still takes precedence. A missing or empty runtime version refuses with the `CONFIG` code.

An adapter error response preserves the `CONFIG` code and translates other returned codes to `FAULT`.

Check, freeze, grade, label, and report have a fixed 60-second allowance. Execution checks first with the selected closure, then forwards the complete closure and replay selections unchanged and uses the declared series duration with a 15-second cleanup allowance. The command supervises process trees; consumer adapters remain trusted code.

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

| Name                               | Kind      | Summary                                                                                                                        |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ARTIFACT_BYTES`                   | const     | Bounds all captured input bytes to 128 MiB.                                                                                    |
| `ARTIFACT_DEPTH`                   | const     | Bounds directory nesting below each selected root.                                                                             |
| `ARTIFACT_FILES`                   | const     | Bounds admitted files before another capture is allocated.                                                                     |
| `ARTIFACT_FILE_BYTES`              | const     | Bounds one captured input file to 16 MiB.                                                                                      |
| `ARTIFACT_ROOTS`                   | const     | Bounds selected package roots before traversal begins.                                                                         |
| `ARTIFACT_VISITS`                  | const     | Bounds all visited directory entries, including ignored assets.                                                                |
| `ArtifactError`                    | class     | Reports an invalid or drifted artifact inventory.                                                                              |
| `ArtifactFile`                     | interface | Records the exact bytes admitted at one absolute file path.                                                                    |
| `ArtifactHookInput`                | interface | Supplies the private namespace and separate source selection to resolution.                                                    |
| `ArtifactInventory`                | interface | Records all admitted module bytes, selections, and native runtime identity.                                                    |
| `ArtifactLoadHandler`              | type      | Names Node's synchronous loading continuation.                                                                                 |
| `ArtifactLoader`                   | class     | Captures built ESM and a separate strip-only consumer adapter in a fresh worker.                                               |
| `ArtifactLoaderOptions`            | interface | Selects built packages and an optional separate consumer source graph.                                                         |
| `ArtifactPackage`                  | interface | Records the identity declared by an admitted package manifest.                                                                 |
| `ArtifactResolveHandler`           | type      | Names Node's synchronous resolution continuation.                                                                              |
| `ArtifactRuntime`                  | interface | Binds native conditions and host-sensitive builtin behavior to the inventory.                                                  |
| `ArtifactSource`                   | interface | Retains captured bytes for the native loader.                                                                                  |
| `ArtifactSourceOptions`            | interface | Selects a consumer-owned executable source directory and its exact adapter entry.                                              |
| `ArtifactTally`                    | interface | Counts the directory entries visited and the file bytes admitted so far in one capture.                                        |
| `Resolution`                       | class     | Enforces captured inventory membership at every synchronous native import edge.                                                |
| `STUDY_CAUSES`                     | const     | Lists every operational ending in report order.                                                                                |
| `STUDY_COMMAND_DURATION`           | const     | Caps declared execution duration at the native supervisor's host ceiling.                                                      |
| `STUDY_COMMAND_GRADER`             | const     | Names the trusted command's independent offline predicate.                                                                     |
| `STUDY_COMMAND_HELP`               | const     | Defines the complete public CLI reference shared by help and grammar diagnostics.                                              |
| `STUDY_COMMAND_OPERATION`          | const     | Names the command route beneath the native supervisor.                                                                         |
| `STUDY_CUSTODY_BYTES`              | const     | Limits untrusted metadata before JSON parsing or file allocation.                                                              |
| `STUDY_DRAIN_DURATION`             | const     | Bounds how long inherited output handles stay open after native exit, in milliseconds.                                         |
| `STUDY_ERROR_BRAND`                | const     | Keys the own self-identity every study error stamps on itself.                                                                 |
| `STUDY_FRAME_BYTES`                | const     | Limits each serialized IPC envelope, including its JSON framing.                                                               |
| `STUDY_GOALS`                      | const     | Caps a declared scenario horizon before execution.                                                                             |
| `STUDY_LAUNCH_BYTES`               | const     | Bounds combined supervised command output to 16 MiB before terminating the tree.                                               |
| `STUDY_LAUNCH_CLEANUP`             | const     | Extends supervised execution beyond its declared series duration for cleanup.                                                  |
| `STUDY_LAUNCH_DURATION`            | const     | Bounds each supervised operation other than execution to 60 seconds.                                                           |
| `STUDY_LOG_BYTES`                  | const     | Limits combined worker stdout and stderr before termination.                                                                   |
| `STUDY_NAME`                       | const     | Restricts identifiers to portable path-safe names.                                                                             |
| `STUDY_PACKET_DISCLOSURE`          | const     | Discloses the limits of neutral identifiers when public text remains visible.                                                  |
| `STUDY_PENDING_LIMIT`              | const     | Limits outstanding bidirectional protocol work per process.                                                                    |
| `STUDY_PROCESS_LABEL`              | const     | Attributes an expired process handshake or cleanup deadline.                                                                   |
| `STUDY_RESERVED_NAME`              | const     | Rejects names that Windows reserves even on other hosts.                                                                       |
| `STUDY_ROLES`                      | const     | Lists every measured request role in report order.                                                                             |
| `STUDY_TASK_DURATION`              | const     | Caps pure domain work independently of its event loop.                                                                         |
| `STUDY_TASK_OPERATION`             | const     | Names the private bounded validation and grading route.                                                                        |
| `STUDY_TRIALS`                     | const     | Caps a declared trial population before schedule allocation.                                                                   |
| `STUDY_WORKER_OPERATION`           | const     | Names the worker operation routed by the built application entry.                                                              |
| `StudyAdapterInterface`            | interface | Defines the consumer's domain checks, driver construction, and retained-evidence grading.                                      |
| `StudyAdjudication`                | interface | Holds retained observations and independent criteria for a grading operation.                                                  |
| `StudyAdmissionInterface`          | interface | Admits requests against enclosing limits before an adapter dispatches them.                                                    |
| `StudyAgentDispatch`               | interface | Holds the trial-local canonical dispatch identity a wire request joins to.                                                     |
| `StudyAgentJudge`                  | class     | Latches a real judge's failure before an enclosing runtime can treat it as absent.                                             |
| `StudyAgentObserver`               | class     | Reads each Agent request's size before delegating it unchanged to the real provider.                                           |
| `StudyAgentObserverOptions`        | interface | Holds the observing provider's delegate, measurement seam and explicit policies.                                               |
| `StudyAgentOriginHandler`          | type      | Joins each message of a measured request to its origin, one JSON entry per message in order.                                   |
| `StudyAgentPlan`                   | interface | Holds one goal's scripted replies and the resources the provider charges and cancels through.                                  |
| `StudyAgentReading`                | interface | Holds one dispatched request's explicit size reading.                                                                          |
| `StudyAgentRecordHandler`          | type      | Receives one reading and the exact pre-encoding request it measured.                                                           |
| `StudyAgentResponse`               | interface | Declares one scripted reply.                                                                                                   |
| `StudyAgentRole`                   | type      | Names the model responsibilities whose requests the trace and summary measure.                                                 |
| `StudyAgentRuntime`                | interface | Holds the admitted Agent namespace capabilities the shared instrumentation invokes.                                            |
| `StudyAgentScript`                 | class     | Serves declared inert responses through the actual Agent provider boundary.                                                    |
| `StudyAgentScriptOptions`          | interface | Holds the scripted provider's fixed byte bound; the admitted token count defaults to one.                                      |
| `StudyAgentStage`                  | type      | Names where a measurement was taken.                                                                                           |
| `StudyAgentStamp`                  | interface | Holds the ordinal and revision one measurement received.                                                                       |
| `StudyAgentSummary`                | class     | Folds a conversation through the real provider under an explicit gauge and prompt limit.                                       |
| `StudyAgentSummaryOptions`         | interface | Holds the gauged summary's delegate, measurement seam, explicit limits and cancellation.                                       |
| `StudyAgentTrace`                  | class     | Correlates measured Agent requests and retains their evidence across a trial's goals.                                          |
| `StudyAgentTraceOptions`           | interface | Holds the trace's measuring runtime, failure owner and consumer origin join.                                                   |
| `StudyArtifactIdentity`            | interface | Holds the separately bound instrument and selected module inventory identities.                                                |
| `StudyArtifactLoader`              | class     | Binds consumer instrumentation separately from selected executable identities.                                                 |
| `StudyArtifactLoaderOptions`       | interface | Holds the trusted instrument and caller-selected built artifact locations.                                                     |
| `StudyArtifactModule`              | interface | Holds actual namespaces loaded only during worker execution.                                                                   |
| `StudyAttempt`                     | interface | Holds a terminal trial record, including goals never dispatched.                                                               |
| `StudyBounds`                      | interface | Holds nested execution allowances; each request also has a deadline.                                                           |
| `StudyCLI`                         | class     | Dispatches private child routes before the public native supervisor.                                                           |
| `StudyCause`                       | type      | Names an operational ending separately from task achievement.                                                                  |
| `StudyChannel`                     | class     | Correlates bounded IPC work and rejects every outstanding request on transport failure.                                        |
| `StudyChannelOptions`              | interface | Holds one native IPC endpoint and its domain handlers.                                                                         |
| `StudyCharge`                      | interface | Holds a request's pre-dispatch upper bounds.                                                                                   |
| `StudyCommand`                     | class     | Executes validated study operations with execution and grading custody kept independent.                                       |
| `StudyCommandArtifact`             | interface | Holds one bounded source artifact retained during offline validation.                                                          |
| `StudyCommandOptions`              | interface | Holds the trusted application entry and repository location.                                                                   |
| `StudyCommandRequest`              | type      | Names the independently dispatched study command operation.                                                                    |
| `StudyContext`                     | interface | Holds the resources visible to one running goal.                                                                               |
| `StudyControl`                     | class     | Retains the first operational failure while bounding asynchronous waits.                                                       |
| `StudyControlInterface`            | interface | Owns the first operational failure and cancellation of enclosing work.                                                         |
| `StudyCriterion`                   | interface | Holds a grader-owned criterion outside the driver's public input.                                                              |
| `StudyCustodyBudget`               | interface | Holds the evidence sink's shared admission budget.                                                                             |
| `StudyCustodyPhase`                | type      | Names the execution custody lifecycle without inferring seal completeness.                                                     |
| `StudyCustodySinkInterface`        | interface | Closes evidence admission and drains already admitted appends.                                                                 |
| `StudyDeadline`                    | class     | Bounds each independent operation with a fresh failure owner and deadline.                                                     |
| `StudyDeadlineInterface`           | interface | Bounds one independent asynchronous operation under its own deadline.                                                          |
| `StudyDeadlineOptions`             | interface | Supplies one bounded operation's finite deadline and diagnostic label.                                                         |
| `StudyDefinition`                  | interface | Holds the frozen study question, population and explicit repetition orders.                                                    |
| `StudyDriverInterface`             | interface | Creates isolated domain state through a concrete package consumer.                                                             |
| `StudyDriverOptions`               | interface | Supplies admitted modules and an exclusive scratch parent without grader truth.                                                |
| `StudyError`                       | class     | Reports a study contract or operational failure with a stable code.                                                            |
| `StudyErrorCode`                   | type      | Names malformed configuration, evidence, custody and operational failures.                                                     |
| `StudyEvidence`                    | interface | Holds append-only domain evidence in a JSON-compatible form.                                                                   |
| `StudyEvidenceSink`                | class     | Retains admitted evidence in order and closes admission before terminal records.                                               |
| `StudyEvidenceSinkOptions`         | interface | Holds the owned evidence descriptor and byte admission constraints.                                                            |
| `StudyExecutionRequest`            | interface | Holds a checked execution selection with optional output custody.                                                              |
| `StudyFailure`                     | interface | Holds an attributable operational fault without awarding a task verdict.                                                       |
| `StudyFile`                        | interface | Holds the exact byte identity of one execution file.                                                                           |
| `StudyFrame`                       | interface | Holds a correlated JSON request, reply or cancellation notification.                                                           |
| `StudyGoal`                        | interface | Holds a declared goal's public input without its grading truth.                                                                |
| `StudyGradeFunction`               | type      | Reads one declared target against the consumer's domain predicate.                                                             |
| `StudyGradeReading`                | interface | Holds a consumer predicate's reading of one target, citing only retained files and rows.                                       |
| `StudyGradeRequest`                | interface | Holds an offline predicate grading request.                                                                                    |
| `StudyGradeTarget`                 | interface | Holds one declared trial and criterion pair with its retained observations.                                                    |
| `StudyGrading`                     | interface | Holds a grading identity that cannot replace or mutate execution bytes.                                                        |
| `StudyGradingContext`              | interface | Holds artifacts already verified inside a selected immutable grading directory.                                                |
| `StudyGradingStore`                | class     | Retains immutable deterministic grading versions independently of execution bytes.                                             |
| `StudyGradingStoreOptions`         | interface | Holds imported grading artifacts independently of execution.                                                                   |
| `StudyIdentity`                    | interface | Holds byte identities that qualification and comparisons must agree on.                                                        |
| `StudyInterruptedResult`           | interface | Holds inspected execution metadata that is never gradeable before sealing.                                                     |
| `StudyJudgment`                    | interface | Holds an evidence-backed verdict; missing evidence stays unknown.                                                              |
| `StudyLabelRequest`                | interface | Holds an imported-label grading request.                                                                                       |
| `StudyLabeling`                    | interface | Holds imported semantic judgments and their accountable origin.                                                                |
| `StudyLatchInterface`              | interface | Retains the first operational failure of instrumented work and refuses work after it.                                          |
| `StudyLaunchOptions`               | interface | Selects the native command entry and the caller's consumer root.                                                               |
| `StudyLaunchResult`                | interface | Retains the bounded command exit and captured output.                                                                          |
| `StudyLauncher`                    | class     | Supervises finite command trees and binds offline check to execution.                                                          |
| `StudyLimit`                       | interface | Holds finite allowances in milliseconds, calls, tokens and bytes.                                                              |
| `StudyManifest`                    | interface | Holds the execution declaration sealed before any trial begins.                                                                |
| `StudyMessageHandler`              | type      | Handles validated transport requests at their owning domain boundary.                                                          |
| `StudyMeter`                       | class     | Admits request ceilings across every enclosing scope before dispatch.                                                          |
| `StudyMeterInterface`              | interface | Owns request admission and the goal's terminal lifecycle.                                                                      |
| `StudyMeterOptions`                | interface | Supplies the request allowance and all enclosing admission scopes.                                                             |
| `StudyObservation`                 | interface | Holds the retained outcome of a scheduled goal.                                                                                |
| `StudyOllamaActivity`              | interface | Holds one active goal's accounting and attribution.                                                                            |
| `StudyOllamaFetchFunction`         | type      | Sends one validated, admitted request under its Study role and returns the native response.                                    |
| `StudyOllamaModel`                 | interface | Pins one served model identity the inventory verifies.                                                                         |
| `StudyOllamaOptions`               | type      | Holds the Ollama provider options one role's declared policy determines.                                                       |
| `StudyOllamaPolicy`                | interface | Declares one model role's exact wire policy.                                                                                   |
| `StudyOllamaRequest`               | interface | Holds validated wire dispatch facts without retaining payload text.                                                            |
| `StudyOllamaRole`                  | type      | Names the model roles an Ollama study transport dispatches under a declared policy.                                            |
| `StudyOllamaSnapshot`              | interface | Holds one outbound request's facts as owned at admission.                                                                      |
| `StudyOllamaTerminal`              | interface | Holds a validated terminal's finish reason and actual usage, unknown when unreported.                                          |
| `StudyOllamaTransport`             | class     | Admits and accounts Ollama wire requests under declared policies and latches failure.                                          |
| `StudyOllamaTransportOptions`      | interface | Holds the Ollama study transport's immutable configuration.                                                                    |
| `StudyOllamaWire`                  | interface | Tracks one owned HTTP response until its end or cancellation.                                                                  |
| `StudyOperation`                   | type      | Names the bounded transport's domain operations.                                                                               |
| `StudyPacketBundle`                | interface | Holds exact neutral public packet bytes and private mapping bytes.                                                             |
| `StudyPacketEntry`                 | interface | Holds one neutral semantic grading input without treatment or model identifiers.                                               |
| `StudyPacketLink`                  | interface | Holds the neutral identity mapping to a sealed semantic trial-criterion pair.                                                  |
| `StudyParentTicket`                | interface | Holds an authoritative parent ticket and its transport listener lifetime.                                                      |
| `StudyPreparation`                 | interface | Holds checked public declarations and reproducible executable identities.                                                      |
| `StudyProcessDriver`               | class     | Opens one fresh native child for each scheduled trial.                                                                         |
| `StudyProcessOptions`              | interface | Holds the parent-owned fresh trial process configuration.                                                                      |
| `StudyProcessGoal`                 | class     | Holds one goal's parent context and the worker admission sequence it issues while the goal runs.                               |
| `StudyProcessSession`              | class     | Keeps admission and evidence custody in the parent of one fresh trial process.                                                 |
| `StudyProcessSessionOptions`       | interface | Holds one fresh child trial's launch parameters and cancellation.                                                              |
| `StudyProduct`                     | interface | Holds observed output and partial completion, never self-awarded success.                                                      |
| `StudyProfile`                     | interface | Holds execution settings independently of scenario and grading declarations.                                                   |
| `StudyProvider`                    | interface | Holds caller-selected provider artifacts and model identities.                                                                 |
| `StudyPurpose`                     | type      | Names the evidence a study can establish.                                                                                      |
| `StudyReference`                   | interface | Cites a retained trial file, or one evidence row of it by its zero-based position.                                             |
| `StudyReferenceFile`               | type      | Names a retained file of one trial that a judgment cites.                                                                      |
| `StudyRemoteMeter`                 | class     | Waits for authoritative parent admission and drains acknowledged settlements.                                                  |
| `StudyRemoteMeterInterface`        | interface | Owns transported admission, parent cancellation, and settlement drainage.                                                      |
| `StudyRemoteMeterOptions`          | interface | Holds the worker meter's parent-authorized transport and failure latch.                                                        |
| `StudyRemoteTicket`                | class     | Transmits one settlement without inventing local admission authority.                                                          |
| `StudyRemoteTicketOptions`         | interface | Holds one transported ticket's identity and settlement owner.                                                                  |
| `StudyReportRequest`               | interface | Holds a selected immutable report request.                                                                                     |
| `StudyRequest`                     | class     | Settles an admitted request once and propagates operational failure to its owner.                                              |
| `StudyRequestOptions`              | interface | Supplies one admitted request with its shared failure owner and settlement sink.                                               |
| `StudyResponse`                    | interface | Holds an outstanding bounded IPC response.                                                                                     |
| `StudyResultReading`               | type      | Holds an offline execution reading discriminated by custody completeness.                                                      |
| `StudyResultStore`                 | class     | Owns append-only execution bytes and seals only a complete terminal population.                                                |
| `StudyResultStoreInterface`        | interface | Owns execution custody from exclusive creation through complete sealing.                                                       |
| `StudyResultStoreOptions`          | interface | Holds the inert execution store configuration.                                                                                 |
| `StudyRole`                        | type      | Names a request's measured responsibility.                                                                                     |
| `StudyRoom`                        | interface | Holds the model context and generation allowance as separate measurements.                                                     |
| `StudyRubric`                      | interface | Holds a versioned grading declaration independently of execution.                                                              |
| `StudyScenario`                    | interface | Holds ordered goals sharing state within an isolated trial.                                                                    |
| `StudyScope`                       | class     | Reserves finite request ceilings around cumulative actual budgets and one deadline.                                            |
| `StudyScopeInterface`              | interface | Holds cumulative admission ceilings for one timed execution scope.                                                             |
| `StudyScopeOptions`                | interface | Supplies one deadline and its shared failure owner.                                                                            |
| `StudyScore`                       | interface | Holds an arm's whole-horizon counts without hiding unresolved criteria.                                                        |
| `StudySeal`                        | interface | Holds a complete execution inventory and its deterministic identity.                                                           |
| `StudySealedResult`                | interface | Holds independently verified sealed execution bytes.                                                                           |
| `StudySeries`                      | class     | Executes a frozen serial study schedule with finite admission and sticky failures.                                             |
| `StudySeriesOptions`               | interface | Holds the common engine's fixed execution inputs.                                                                              |
| `StudySessionInterface`            | interface | Owns domain state across a trial and releases it before the next trial.                                                        |
| `StudySettlementHandler`           | type      | Records the settlement of one admitted request.                                                                                |
| `StudySinkInterface`               | interface | Holds an evidence sink whose implementation owns byte limits and custody.                                                      |
| `StudyStoreInterface`              | interface | Appends terminal records without overwriting a prior attempt.                                                                  |
| `StudyTask`                        | class     | Bounds adapter evaluation by an independent native parent timer.                                                               |
| `StudyTaskOptions`                 | interface | Holds a bounded adapter-only native operation.                                                                                 |
| `StudyTaskRequest`                 | type      | Carries only declarations or sealed evidence to an adapter child.                                                              |
| `StudyTaskResult`                  | interface | Returns adapter output with the exact active instrumentation digest.                                                           |
| `StudyTaskWorker`                  | class     | Evaluates only admitted instrumentation in a disposable native child.                                                          |
| `StudyTicket`                      | interface | Holds one admitted request until its actual charge is recorded.                                                                |
| `StudyTrial`                       | interface | Holds a scheduled trajectory, with a fresh state for each repetition and arm.                                                  |
| `StudyTrialCustody`                | interface | Holds the trial sink's admitted writes and terminal lifecycle.                                                                 |
| `StudyUsage`                       | interface | Holds actual request measurements; absent token usage remains unknown.                                                         |
| `StudyValidation`                  | interface | Holds declarations for domain validation before agent, subject or provider execution.                                          |
| `StudyWorker`                      | class     | Executes one verified trial behind parent-authorized admission and custody.                                                    |
| `buildStudyAgentDispatch`          | function  | Builds the evidence join of a wire request to its canonical dispatch.                                                          |
| `buildStudyAgentParts`             | function  | Projects a request's structural components onto plain JSON without storing a total.                                            |
| `readStudyAgentToolCall`           | function  | Reads an Agent tool call into a validated envelope from one read of each foreign field.                                        |
| `buildStudyAgentToolResult`        | function  | Builds the JSON evidence form of an Agent tool call and its executed result.                                                   |
| `buildStudyAgentToolDenial`        | function  | Builds the JSON evidence form of an Agent tool call the Agent denied before dispatch.                                          |
| `buildStudyAgentReadings`          | function  | Builds the JSON evidence form of a Ledger result's logical classifier readings.                                                |
| `buildStudyAgentRevision`          | function  | Builds a request revision by hashing its canonical rendering exactly as rendered.                                              |
| `buildStudyOllamaModels`           | function  | Declares the pinned serving identities the Ollama transport verifies, keyed by the label their inventory evidence carries.     |
| `buildStudyOllamaBytes`            | function  | Encodes exact application bytes with their decoded size and SHA-256 identity.                                                  |
| `buildStudyOllamaOptions`          | function  | Builds the provider options one role's declared wire policy determines.                                                        |
| `buildStudyOllamaRaw`              | function  | Builds a reading of the raw prompt text an encoded request body carries, as sent.                                              |
| `buildStudyOllamaSnapshot`         | function  | Builds an owned snapshot of one outbound request before anything is awaited.                                                   |
| `buildStudyOllamaTiming`           | function  | Builds the JSON evidence form of a timing observation with raw nanoseconds and counts.                                         |
| `buildStudyOllamaTransportOptions` | function  | Builds a frozen owned copy of transport configuration that later caller mutation cannot reach.                                 |
| `buildStudyPacket`                 | function  | Builds deterministic public semantic inputs and a separately retained private map.                                             |
| `buildStudyPacketLinks`            | function  | Builds neutral semantic identities for the complete eligible sealed horizon.                                                   |
| `buildStudyReference`              | function  | Renders a citation of one retained trial file or evidence row.                                                                 |
| `buildStudySchedule`               | function  | Builds a bounded schedule from explicit repetition rows and declared scenarios.                                                |
| `checkStudyDirectory`              | function  | Refuses symbolic links and non-directory ancestors before custody operations.                                                  |
| `collectStudyAncestors`            | function  | Collects a directory and each of its ancestors up to the filesystem root, nearest first.                                       |
| `collectStudyEntries`              | function  | Collects the executable entries a profile selects, each canonical path once.                                                   |
| `collectStudyEvidence`             | function  | Reads sealed evidence bytes through custody checks without loading executable code.                                            |
| `computeStudyCommandFingerprint`   | function  | Computes the native supervisor's exact validated execution fingerprint.                                                        |
| `computeStudyFixtureDigest`        | function  | Computes public fixture identity from execution policy and exact scenario bytes.                                               |
| `computeStudyInstrumentDigest`     | function  | Computes the instrument identity binding trusted runtime bytes to the adapter inventory.                                       |
| `computeStudyPacketDigest`         | function  | Computes a bundle identity binding exact public packet and private map bytes.                                                  |
| `computeStudyPartition`            | function  | Partitions records by their explicit execution fact without inferring any.                                                     |
| `computeStudyProfileDigest`        | function  | Binds the canonical fully resolved execution profile carried over IPC.                                                         |
| `computeStudyReport`               | function  | Computes whole-horizon results with operational costs and repetitions kept distinct.                                           |
| `computeStudyScores`               | function  | Computes arm intervals over the complete declared criterion horizon.                                                           |
| `computeStudySealId`               | function  | Computes an execution seal identity from its exact sorted inventory.                                                           |
| `containsArtifact`                 | function  | Checks strict lexical containment under a selected directory.                                                                  |
| `createStudyProcessFailure`        | function  | Creates attributable protocol infrastructure failure.                                                                          |
| `decodeStudyJSON`                  | function  | Decodes strict UTF-8 custody bytes and parses their JSON text.                                                                 |
| `drainStudyChild`                  | function  | Releases inherited output handles a bounded time after native exit.                                                            |
| `encodeStudyJSON`                  | function  | Encodes deterministic JSON bytes without synthesizing execution metadata.                                                      |
| `failStudyTicket`                  | function  | Records an error that escaped admitted work as the failure of its ticket.                                                      |
| `failureToStudyError`              | function  | Converts an operational reading to its throwable boundary.                                                                     |
| `gradeStudyEvidence`               | function  | Grades every declared trial and criterion pair through the consumer's predicate.                                               |
| `hashStudyBytes`                   | function  | Computes the lowercase SHA-256 identity of exact bytes or UTF-8 text.                                                          |
| `isArtifactError`                  | function  | Narrows a caught value to an artifact refusal.                                                                                 |
| `isStudyAdapter`                   | function  | Checks whether a factory returned the complete consumer adapter contract.                                                      |
| `isStudyAgentResponse`             | function  | Checks whether a scripted response has JSON calls and workload controls.                                                       |
| `isStudyAgentGauge`                | function  | Checks whether a value is a gauge with a finite positive scale and a finite nonnegative overhead.                              |
| `isStudyAgentRuntime`              | function  | Checks whether a namespace exposes the Agent capabilities the instrumentation invokes.                                         |
| `isStudyBounds`                    | function  | Checks whether nested scopes admit no larger allowance than their parent.                                                      |
| `isStudyCause`                     | const     | Checks whether a value names an operational ending.                                                                            |
| `isStudyCharge`                    | function  | Checks a request's declared role and finite cost ceilings.                                                                     |
| `isStudyCriterion`                 | function  | Checks whether a criterion declares exact grading inputs and references.                                                       |
| `isStudyCustodyAttempt`            | function  | Checks whether an attempt terminally accounts for the exact scheduled goal horizon.                                            |
| `isStudyCustodyEvidence`           | function  | Checks whether evidence is exact JSON with a declared event and goal name.                                                     |
| `isStudyCustodyFailure`            | function  | Checks whether a failure carries exact attributable operational fields.                                                        |
| `isStudyCustodyFile`               | function  | Checks whether an execution file inventory entry is path-safe and bounded.                                                     |
| `isStudyCustodyManifest`           | function  | Checks whether a manifest exactly binds its declared population and identities.                                                |
| `isStudyCustodyName`               | function  | Checks whether a trial name is portable on all supported hosts.                                                                |
| `isStudyCustodyObservation`        | function  | Checks whether an observation preserves output or an explicit unexecuted failure.                                              |
| `isStudyCustodySeal`               | function  | Checks whether a seal has an exact unique execution inventory.                                                                 |
| `isStudyCustodyTrial`              | function  | Checks whether a scheduled trial has exact valid identity fields.                                                              |
| `isStudyDefinition`                | function  | Checks whether a study freezes a complete arm order for every repetition.                                                      |
| `isStudyDigest`                    | function  | Checks whether a byte identity is a lowercase SHA-256 digest.                                                                  |
| `isStudyError`                     | function  | Narrows a caught value to a branded study error with valid failure attribution.                                                |
| `isStudyErrorCode`                 | function  | Checks whether a value names a supported study error code.                                                                     |
| `isStudyEvidence`                  | function  | Checks append-only public evidence.                                                                                            |
| `isStudyFrame`                     | function  | Checks the complete transport envelope before domain handling.                                                                 |
| `isStudyGoal`                      | function  | Checks whether a goal has a bounded identifier and exact JSON input.                                                           |
| `isStudyGrading`                   | function  | Checks whether grading binds accountable judgments to unique attempt identities.                                               |
| `isStudyIdentity`                  | function  | Checks the exact digest fields carried by the execution declaration.                                                           |
| `isStudyJudgment`                  | function  | Checks whether a judgment carries a supported verdict and evidence references.                                                 |
| `isStudyLabeling`                  | function  | Checks whether imported semantic labels have accountable packet provenance.                                                    |
| `isStudyLimit`                     | function  | Checks whether all allowances are positive safe integers within timer bounds.                                                  |
| `isStudyName`                      | function  | Checks whether an identifier is portable and bounded.                                                                          |
| `isStudyProcessFailure`            | function  | Checks operational failure attribution arriving over IPC.                                                                      |
| `isStudyProduct`                   | function  | Checks a retained public product without awarding task achievement.                                                            |
| `isStudyProfile`                   | function  | Checks whether a profile carries finite bounds and an optional explicit provider.                                              |
| `isStudyProvider`                  | function  | Checks whether a provider declaration names artifacts, an HTTP origin and models.                                              |
| `isStudyRole`                      | const     | Checks whether a value names a measured request role.                                                                          |
| `isStudyRoom`                      | function  | Checks whether generation room leaves positive context for input.                                                              |
| `isStudyRubric`                    | function  | Checks whether a rubric declares nonempty criteria with unique identities.                                                     |
| `isStudyScenario`                  | function  | Checks whether a scenario declares a nonempty horizon with unique goal ids.                                                    |
| `isStudyTimestamp`                 | function  | Checks whether a timestamp is a canonical UTC millisecond instant.                                                             |
| `isStudyTrial`                     | function  | Checks a fresh trial's declared identifiers.                                                                                   |
| `isStudyUsage`                     | function  | Checks whether request usage contains nonnegative safe measurements.                                                           |
| `iterateArtifactEntries`           | function  | Iterates the remaining entries of an open directory handle lazily, in read order.                                              |
| `matchesStudyKeys`                 | function  | Matches exact own enumerable data keys without evaluating accessors.                                                           |
| `normalizeStudyProfile`            | function  | Omits every undefined optional declaration so the profile has one JSON form.                                                   |
| `omitStudyAbsent`                  | function  | Copies the own entries of a record that hold a value, in their original order.                                                 |
| `parseStudyArguments`              | function  | Parses public command tokens with operation-specific grammar diagnostics.                                                      |
| `parseStudyDefinition`             | function  | Parses a definition into an independent frozen validated snapshot.                                                             |
| `parseStudyGrading`                | function  | Parses grading into an independent frozen validated evidence snapshot.                                                         |
| `parseStudyLabeling`               | function  | Parses semantic labels into an independent frozen validated evidence snapshot.                                                 |
| `parseStudyProfile`                | function  | Parses a profile into an independent frozen validated snapshot.                                                                |
| `parseStudyRubric`                 | function  | Parses a rubric into an independent frozen validated snapshot.                                                                 |
| `parseStudyScenario`               | function  | Parses a scenario into an independent frozen validated snapshot.                                                               |
| `projectStudyAgentRequest`         | function  | Prices a runtime estimate through an explicit gauge.                                                                           |
| `readArtifact`                     | function  | Reads a bounded regular file only through its canonical absolute path.                                                         |
| `readArtifactBytes`                | function  | Fills a buffer from an open descriptor, one positioned read at a time.                                                         |
| `readStudyAdapter`                 | function  | Reads a complete adapter from an admitted module namespace.                                                                    |
| `readStudyAgentMessages`           | function  | Projects foreign provider messages onto the exact fields the workload reads.                                                   |
| `readStudyAgentResult`             | function  | Drains a scripted provider stream into its assembled result.                                                                   |
| `readStudyBytes`                   | function  | Reads bounded regular-file bytes without following a symbolic link.                                                            |
| `readStudyFailure`                 | function  | Reads an operational error without inventing a task verdict.                                                                   |
| `readStudyHandle`                  | function  | Reads from an open file handle into a buffer until the buffer is full or the file ends.                                        |
| `readStudyOllamaDigest`            | function  | Reads the pinned serving digest of an admitted request's model.                                                                |
| `readStudyOllamaFailure`           | function  | Reads a native Ollama error member as the attributable failure it names, without usage.                                        |
| `readStudyOllamaRequest`           | function  | Reads exact outbound Ollama facts and refuses a request outside its declared policy.                                           |
| `readStudyOllamaSupport`           | function  | Reads the declared model context ceiling without claiming daemon allocation.                                                   |
| `readStudyOllamaTerminal`          | function  | Reads one Ollama response row without inventing absent usage.                                                                  |
| `readStudyOllamaTiming`            | function  | Reads daemon timing from a terminal row without letting an observation fail the request.                                       |
| `readStudyResult`                  | function  | Inspects custody bytes offline and verifies complete execution before grading.                                                 |
| `resolveStudyAgentContent`         | function  | Resolves the content a scripted response serves, from its declaration or from a prior tool message.                            |
| `resolveStudyInstrument`           | function  | Resolves the actual host package from its trusted executable entry.                                                            |
| `resolveStudyPath`                 | function  | Resolves a portable relative artifact path strictly inside its selected directory.                                             |
| `resolveStudyProfile`              | function  | Resolves the execution profile's caller-selected built artifact paths.                                                         |
| `scanStudyExecution`               | function  | Scans regular execution files while refusing unknown directories and linked paths.                                             |
| `scanStudyTree`                    | function  | Scans one execution directory and the subdirectories it admits, reading each admitted file under the series bytes that remain. |
| `terminateStudyChild`              | function  | Terminates the recorded native process tree under a finite cleanup allowance.                                                  |
| `translateStudyAgentError`         | function  | Translates only a nominal Agent window refusal into the attributable capacity failure.                                         |
| `translateStudyPacketLabeling`     | function  | Translates bound neutral imported labels through the sealed semantic horizon.                                                  |
| `validateStudyAgentUsage`          | function  | Checks that a successful provider call reported a usable actual prompt count.                                                  |
| `validateStudyEvidenceBytes`       | function  | Validates complete evidence lines and per-goal encoded evidence bounds.                                                        |
| `validateStudyInputs`              | function  | Validates grading coverage and request room against the declared study inputs.                                                 |
| `validateStudyOllamaCompletion`    | function  | Checks terminal policy after the actual wire cost has been retained.                                                           |
| `validateStudyOllamaInventory`     | function  | Verifies that each pinned name resolves to one inventory entry with its pinned digest.                                         |
| `validateStudyOllamaRoles`         | function  | Validates declared role policies against the pinned inventory before any dispatch.                                             |
| `validateStudyOllamaRecording`     | function  | Validates independent metadata bounds and the complete optional recording group.                                               |
| `validateStudyOllamaStep`          | function  | Admits one model request against its next exact or capture declaration.                                                        |
| `isStudyOllamaMetadata`            | function  | Checks whether a value declares independent positive metadata allowances.                                                      |
| `isStudyOllamaModel`               | function  | Checks whether a value pins a served model name and SHA-256 digest.                                                            |
| `isStudyOllamaPolicy`              | function  | Checks whether a value declares a complete finite model-generation policy.                                                     |
| `isStudyOllamaStep`                | function  | Checks whether a value declares exclusive exact or capture admission with a valid receipt.                                     |
| `validateStudyRuntime`             | function  | Refuses a profile that omits the actual host runtime's declared dependency bytes.                                              |
| `valueToWire`                      | function  | Projects optional domain fields into the JSON wire representation.                                                             |
| `writeStudyBytes`                  | function  | Writes an exclusive regular record and synchronizes it before reporting success.                                               |
| `STUDY_LAYERS`                     | const     | Lists every ceiling a run can stop at in report order.                                                                         |
| `StudyLayer`                       | type      | Names the ceiling that stopped a run.                                                                                          |
| `StudyStop`                        | interface | Holds the ceiling that stopped a run and the readings it crossed.                                                              |
| `StudyAttributionSource`           | interface | Holds one failed record the report groups by cause, role, and layer.                                                           |
| `isStudyLayer`                     | const     | Checks whether a value names a ceiling a run can stop at.                                                                      |
| `isStudyStop`                      | function  | Checks whether a value is the exact record of a ceiling that stopped a run.                                                    |
| `studyStopToJSON`                  | function  | Projects a stop onto JSON with every unreported reading as null.                                                               |
| `translateStudyAgentStop`          | function  | Translates an Agent run's stop record into the attributable capacity failure of the layer that stopped it.                     |
| `computeStudyAttributions`         | function  | Groups failed records by cause, role, and layer, each group carrying its source readings.                                      |
| `parseStudyReading`                | function  | Parses a foreign reading into a number a stop can retain.                                                                      |
| `computeStudyAdmittedStop`         | function  | Computes the stop of a request whose actual usage crossed the ceiling it was admitted under.                                   |
| `computeStudyOutputStop`           | function  | Computes the stop of a product the output allowances cannot hold.                                                              |
| `StudyDeclaration`                 | interface | Holds a parsed study declaration with its driver bundle, scenarios, scenario fixtures, and rubric.                             |
| `readStudyDeclaration`             | function  | Reads a study declaration, its driver's scenarios, and its rubric as the command resolves them.                                |
| `readStudyDeclarationBytes`        | function  | Reads one declaration file and refuses a missing or linked path with its root-relative path.                                   |
| `readStudyVersion`                 | function  | Reads the version of the study package that owns an executable entry.                                                          |
| `matchesSystemError`               | function  | Reports whether a caught value is a Node error carrying the given system code.                                                 |
| `StudyDaemon`                      | interface | Pins an executable and the model population an execution owns until cleanup.                                                   |
| `StudyDaemonModel`                 | interface | Pins one model the declared daemon verifies and unloads before each trial.                                                     |
| `StudyRecord`                      | interface | Bounds the serialized exchange sidecar retained for each scheduled trial.                                                      |
| `ArtifactErrorCode`                | type      | Names the refused boundary of a captured or materialized artifact graph.                                                       |
| `ArtifactMember`                   | interface | Maps one admitted physical file to its exact bytes inside a materialized forest.                                               |
| `ArtifactClosure`                  | interface | Binds a verified physical forest to its relocated selections and complete membership.                                          |
| `ArtifactLoaderInterface`          | interface | Captures, verifies, loads, and materializes one admitted physical artifact graph.                                              |
| `computeArtifactClosureDigest`     | function  | Computes a destination-independent digest of members and relative package identities.                                          |
| `isArtifactClosure`                | function  | Checks a bounded materialization record before any path is used.                                                               |
| `isArtifactKey`                    | function  | Checks whether a key names portable, non-credential members within a closure.                                                  |
| `isArtifactLoaderOptions`          | function  | Checks the bounded loader selections retained in a publication.                                                                |
| `isArtifactMember`                 | function  | Checks the exact file identity and provenance of a closure member.                                                             |
| `isStudyClosure`                   | function  | Checks a closure publication before using its command inputs.                                                                  |
| `matchesArtifactCredential`        | function  | Checks whether a portable segment identifies credentials.                                                                      |
| `readArtifactPhysical`             | function  | Checks every existing physical ancestor before using a canonical absolute path.                                                |
| `readStudyClosure`                 | function  | Reads and independently verifies an exclusively published closure.                                                             |
| `relocateArtifactPath`             | function  | Relocates an original path through a closure's retained physical forest.                                                       |
| `resolveArtifactBase`              | function  | Finds the common physical parent that preserves every selected path's relative resolution.                                     |
| `resolveArtifactMember`            | function  | Resolves a portable member key without traversing outside its destination.                                                     |
| `resolveStudyClosurePath`          | function  | Resolves a profile path through a retained physical relocation when selected.                                                  |
| `verifyArtifactClosure`            | function  | Verifies complete copied membership, path safety, exact bytes, and portable identity.                                          |
| `StudyOllamaMetadata`              | interface | Bounds metadata calls, encoded bytes, and elapsed milliseconds outside model quotas.                                           |
| `StudyOllamaStage`                 | type      | Names the ordered verification, model work, and daemon maintenance stages.                                                     |
| `StudyOllamaStepIdentity`          | interface | Declares an ordered model request's goal, responsibility, route, and wire policy.                                              |
| `StudyOllamaExactStep`             | interface | Declares an exact UTF-8 request body and its SHA-256 input receipt.                                                            |
| `StudyOllamaCaptureStep`           | interface | Declares a captured request's positive safe byte length without predicting its content.                                        |
| `StudyOllamaStep`                  | type      | Separates exact request admission from length-declared capture admission.                                                      |
| `StudyOllamaReplaySelection`       | interface | Selects a sealed recording and an explicit replay prefix for every scheduled trial.                                            |
| `StudyOllamaReplayOptions`         | interface | Configures exact recorded replies and optional live continuation after a declared prefix.                                      |
| `StudyOllamaReplayInterface`       | interface | Answers an exact recorded prefix through the role-aware transport collaborator.                                                |
| `StudyExchangeDestination`         | interface | Holds the parent-reserved destination of one trial's exchange sidecar.                                                         |
| `StudyExchangeBytes`               | interface | Retains an application HTTP body's exact bytes independently of text decoding.                                                 |
| `StudyExchangeIdentity`            | interface | Binds one HTTP exchange to its trial-local position and declared execution stage.                                              |
| `StudyExchangeDeclaration`         | interface | Declares the complete trial procedure before any exchange attempt is appended.                                                 |
| `StudyExchangeAttempt`             | interface | Retains admitted request bytes durably before the corresponding send begins.                                                   |
| `StudyExchangeReply`               | interface | Retains response status, headers, and original application-body chunk lengths.                                                 |
| `StudyExchangeResponse`            | interface | Retains a fully consumed response only after status and terminal validation succeed.                                           |
| `StudyExchangeFailure`             | interface | Retains an attempted exchange's failure and any bounded response bytes already observed.                                       |
| `StudyExchangeCompletion`          | interface | Closes a sidecar after the declared procedure and postflight have fully completed.                                             |
| `StudyExchangeRow`                 | type      | Names every admitted row of the bounded per-trial exchange sidecar.                                                            |
| `StudyRecordedExchange`            | interface | Holds a strictly verified successful request and response pair.                                                                |
| `StudyExchangeHistory`             | interface | Binds complete ordered exchanges to a verified sealed sidecar and its declaration.                                             |
| `StudyExchangeSinkInterface`       | interface | Owns serialized exchange appends under a reserved trial byte allowance.                                                        |
| `StudyExchangeSinkOptions`         | interface | Supplies an exclusive sidecar descriptor and its parent-reserved byte allowance.                                               |
| `StudyFreezeRequest`               | interface | Requests exclusive materialization and captured validation before publishing closure.json.                                     |
| `StudyClosure`                     | interface | Publishes a validated closure with relocated command inputs and execution provenance.                                          |
| `StudyTrialPreparationFunction`    | type      | Prepares one trial's external resources before its worker starts.                                                              |
| `StudyProcessDriverOptions`        | interface | Supplies parent-only trial preparation separately from serializable worker options.                                            |
| `StudyExchangeSink`                | class     | Retains ordered exchange rows under a parent-reserved serialized byte allowance.                                               |
| `StudyOllamaReplay`                | class     | Answers declared HTTP prefixes from complete ordered recorded application bytes.                                               |
| `isStudyRecord`                    | function  | Checks whether a recording declaration bounds every serialized sidecar byte.                                                   |
| `isStudyExchangeBytes`             | function  | Checks whether encoded body bytes have their exact canonical base64 and SHA-256 identity.                                      |
| `isStudyExchangeIdentity`          | function  | Checks whether an exchange carries an admissible ordered HTTP identity.                                                        |
| `isStudyExchangeReply`             | function  | Checks whether a retained reply describes bounded successful application bytes and chunks.                                     |
| `isStudyExchangeDeclaration`       | function  | Checks whether the opening row declares a finite ordered procedure and serving identities.                                     |
| `isStudyExchangeRow`               | function  | Checks whether a sidecar row has exactly its declared fields and verified byte identities.                                     |
| `isStudyExchangeHistory`           | function  | Checks whether a history has verified row shapes before its complete relational validation.                                    |
| `buildStudyExchangeSequence`       | function  | Projects the declaration onto its complete ordered HTTP identity population.                                                   |
| `projectStudyExchangeIdentity`     | function  | Projects only the repeated identity fields of a retained HTTP exchange.                                                        |
| `validateStudyExchangeRequest`     | function  | Validates the exact declaration order and request bytes of an admitted exchange.                                               |
| `validateStudyExchangeRows`        | function  | Validates a serialized journal prefix or its complete successful population.                                                   |
| `readStudyExchangeRows`            | function  | Reads strict complete LF-framed exchange rows with verified bodies and declaration joins.                                      |
| `validateStudyExchangeHistory`     | function  | Validates complete history envelopes again before a replay may perform dependent work.                                         |
| `validateStudyExchangeEvidence`    | function  | Joins recorded exchanges to exactly one dispatch and wire evidence identity per ordinal.                                       |
| `readStudyTrialExchanges`          | function  | Reads and joins a complete trial sidecar before or after sealing.                                                              |
| `readStudyExchanges`               | function  | Reads a sealed trial's exact complete exchange history after reverifying its entire result.                                    |
| `isStudyExchangeDestination`       | function  | Checks whether a worker destination has an absolute sidecar path and finite reservation.                                       |
| `isStudyReplaySelection`           | function  | Checks whether replay explicitly selects a sealed directory and per-trial prefix counts.                                       |
| `readStudyRecordingDeclaration`    | function  | Reads the executing profile's explicit recording declarations before a worker starts.                                          |
| `readStudyPreparedDestination`     | function  | Validates parent preparation output without permitting a destination or allowance substitution.                                |
| `readStudyReplayHistory`           | function  | Rechecks the sealed source and this trial's prefix under the executing profile declaration.                                    |

| API                         | Kind      | Summary                                                                                     |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `StudyDaemonSession`        | class     | Owns the declared daemon and its serial trial preparation through permanent cleanup.        |
| `StudyDaemonTrial`          | class     | Records one trial's daemon maintenance before handing its verified prefix to a worker.      |
| `StudyDaemonSessionOptions` | interface | Supplies the resolved provider, trial population, workspace, and execution cancellation.    |
| `StudyDaemonTrialOptions`   | interface | Supplies one reserved sidecar and its complete maintenance declaration.                     |
| `isStudyDaemon`             | function  | Checks whether an owned daemon declaration pins an absolute executable and distinct models. |

## Methods

#### `StudyDaemonSession`

The execution host composes these methods.

| Method    | Summary                                                            |
| --------- | ------------------------------------------------------------------ |
| `start`   | Starts the daemon and returns its verified execution provenance.   |
| `prepare` | Unloads the declared population before opening one trial worker.   |
| `stop`    | Stops and joins the owned tree and refuses an unconfirmed cleanup. |

#### `StudyDaemonTrial`

The preparation sender composes these methods.

| Method    | Summary                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `execute` | Unloads declared models, drains the journal, and returns its exact retained identity.  |
| `fetch`   | Retains each request before sending and preserves the sender's native response chunks. |

The following tables name the callable members.

#### `ArtifactLoader`

The declaration exposes these methods.

| Method        | Summary                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `inspect`     | Reads and identifies admitted files without evaluating selected modules.   |
| `load`        | Imports one selected entry through synchronous captured-byte hooks.        |
| `materialize` | Copies the inspected physical forest into an exclusive absent destination. |
| `verify`      | Refuses byte and population drift since inspection.                        |

#### `ArtifactLoaderInterface`

The declaration exposes these methods.

| Method        | Summary                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `inspect`     | Captures the complete admitted population without evaluating modules.      |
| `verify`      | Refuses changed bytes or membership after inspection.                      |
| `load`        | Loads an admitted entry through captured-byte hooks in a fresh process.    |
| `materialize` | Copies the inspected physical forest into an exclusive absent destination. |

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

#### `StudyAgentJudge`

The declaration exposes these methods.

| Method | Summary                                                                                   |
| ------ | ----------------------------------------------------------------------------------------- |
| `ask`  | Refuses dispatch after a retained failure and retains a thrown failure with its identity. |

#### `StudyAgentObserver`

The declaration exposes these methods.

| Method     | Summary                                               |
| ---------- | ----------------------------------------------------- |
| `generate` | Records one reading, then awaits the real generation. |
| `stream`   | Records one reading, then relays the real stream.     |

#### `StudyAgentScript`

The declaration exposes these methods.

| Method     | Summary                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `clear`    | Ends the prepared goal so another goal can be prepared; a stream already running keeps serving its own goal. |
| `generate` | Consumes the same streaming response into its assembled provider result.                                     |
| `prepare`  | Prepares one goal's declared response sequence and metered operational boundary until `clear` ends the goal. |
| `stream`   | Streams a declared response after authoritative admission and retains actual request bytes.                  |

#### `StudyAgentSummary`

The declaration exposes these methods.

| Method      | Summary                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `summarize` | Measures one canonical request, refuses it at the limit, and sends the very same array to the provider. |

#### `StudyAgentTrace`

The declaration exposes these methods.

| Method      | Summary                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admit`     | Prices a window measurement and, when observing, retains it as the goal's admission.                                                                |
| `append`    | Retains one domain row for the active goal, whether or not observation is enabled; a row outside a goal is dropped.                                 |
| `canonical` | Reads the role's current dispatch identity for the wire request that follows it.                                                                    |
| `dispatch`  | Numbers a request about to be dispatched and retains it as its role's current dispatch; does nothing unless observing.                              |
| `flush`     | Appends the retained rows in order, including rows added during the flush, and ends the goal even when custody refuses a row.                       |
| `measure`   | Takes one synchronous measurement row; the goal's flush appends it, failure included.                                                               |
| `record`    | Retains a dispatching agent request's reading, names it for the wire request that follows, and records its estimate.                                |
| `start`     | Begins a goal's rows. Ordinals, dispatch numbers and role identities continue from earlier goals.                                                   |
| `translate` | Latches the study-level reading of a failure before an enclosing runtime can swallow it and retains one refusal row per refused identity in a goal. |

#### `StudyArtifactLoader`

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

#### `StudyGradingStore`

The declaration exposes these methods.

| Method  | Summary                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| `read`  | Reads an immutable grading version and verifies every bound artifact byte.    |
| `write` | Retains a deterministic grading version or verifies identical existing bytes. |

#### `StudyLatchInterface`

The declaration exposes these methods.

| Method  | Summary                                                                   |
| ------- | ------------------------------------------------------------------------- |
| `check` | Refuses work after a retained failure or cancellation.                    |
| `fail`  | Retains an operational failure even when an enclosing runtime catches it. |

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

#### `StudyOllamaTransport`

The declaration exposes these methods.

| Method    | Summary                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------- |
| `check`   | Refuses work after any retained failure or cancellation.                                            |
| `clear`   | Ends the bound goal so another goal can be prepared; a request already admitted keeps its own goal. |
| `close`   | Cancels every outstanding native reader and permanently closes the transport.                       |
| `fail`    | Retains an operational failure even when an inner runtime catches it.                               |
| `fetch`   | Dispatches exactly one admitted request with bounded streaming reads.                               |
| `prepare` | Binds subsequent wire requests to one live goal until `clear` or `close` ends it.                   |
| `verify`  | Checks every pinned serving identity through admitted inventory and metadata requests.              |

#### `StudyProcessDriver`

The declaration exposes these methods.

| Method | Summary                                                          |
| ------ | ---------------------------------------------------------------- |
| `open` | Opens isolated child state and waits for its verified readiness. |

#### `StudyProcessGoal`

The declaration exposes these methods.

| Method  | Summary                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------- |
| `issue` | Issues the identifier of the next worker admission when the worker asked for exactly that one. |

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

#### `StudyResultStore`

The declaration exposes these methods.

| Method      | Summary                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `create`    | Exclusively creates the result directory and initial manifest bytes.              |
| `exchanges` | Reserves a trial's entire exchange allowance before any worker starts.            |
| `finish`    | Closes evidence admission, drains admitted appends, and writes a terminal record. |
| `seal`      | Seals exact execution inventory after every scheduled trial has terminated.       |
| `start`     | Exclusively creates the evidence sink for an exact scheduled trial.               |

#### `StudyExchangeSink`

The declaration exposes these methods.

| Method   | Summary                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| `append` | Appends one owned row after validating order and reserving its complete serialized size. |
| `close`  | Closes admission, drains accepted writes and synchronizes the owned descriptor.          |

#### `StudyExchangeSinkInterface`

The declaration exposes these methods.

| Method   | Summary                                                                             |
| -------- | ----------------------------------------------------------------------------------- |
| `append` | Appends one validated row after reserving its complete serialized size.             |
| `close`  | Closes admission and synchronizes all admitted writes without inventing completion. |

#### `StudyOllamaReplay`

The declaration exposes these methods.

| Method  | Summary                                                                    |
| ------- | -------------------------------------------------------------------------- |
| `check` | Refuses a mismatch, an unread response or an incompletely consumed prefix. |
| `close` | Closes admission and cancels retained replay responses.                    |

#### `StudyOllamaReplayInterface`

The declaration exposes these methods.

| Method  | Summary                                                                             |
| ------- | ----------------------------------------------------------------------------------- |
| `check` | Refuses a latched mismatch, an unread response, or an incompletely consumed prefix. |
| `close` | Closes admission and cancels or drains owned response readers.                      |

#### `StudyResultStoreInterface`

The declaration exposes these methods.

| Method      | Summary                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------ |
| `create`    | Exclusively creates the result directory and initial manifest bytes.                       |
| `exchanges` | Reserves a declared trial's sidecar allowance and returns its exclusive write destination. |
| `finish`    | Retains the terminal record for one scheduled trial.                                       |
| `seal`      | Seals a complete terminal population with its exact execution-byte inventory.              |
| `start`     | Opens append-only evidence custody for one scheduled trial.                                |

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

### parseStudyLabeling

Use the exported declaration with its documented arguments.

```ts
import { parseStudyLabeling } from '@orkestrel/study'

parseStudyLabeling(evidence)
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

### isStudyLabeling

Use the exported declaration with its documented arguments.

```ts
import { isStudyLabeling } from '@orkestrel/study'

isStudyLabeling({}) // false
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
import { valueToWire } from '@orkestrel/study/server'

valueToWire({ state: 'ready', failure: undefined }) // { state: 'ready' }
```

### Issue worker admissions in sequence

Use the exported declaration with its documented arguments.

```ts
import type { StudyContext } from '@orkestrel/study'
import { StudyProcessGoal } from '@orkestrel/study/server'

declare const context: StudyContext

const goal = new StudyProcessGoal(context)
goal.issue(2) // undefined
goal.issue(1) // 1
goal.issue(1) // undefined
goal.issue(2) // 2
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

### translateStudyPacketLabeling

Use the exported declaration with its documented arguments.

```ts
import { translateStudyPacketLabeling } from '@orkestrel/study/server'

translateStudyPacketLabeling(result, rubric, rubricDigest, labels)
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

### readStudyAgentMessages

Use the exported declaration with its documented arguments.

```ts
import { readStudyAgentMessages } from '@orkestrel/study/server'

readStudyAgentMessages([{ id: 'm1', role: 'user', content: 'Hi' }]) // [{ role: 'user', content: 'Hi' }]
```

### isStudyAgentResponse

Use the exported declaration with its documented arguments.

```ts
import { isStudyAgentResponse } from '@orkestrel/study/server'

isStudyAgentResponse({ content: 'done', calls: [] }) // true
```

### Retain a goal's rows in a trace

Construct the trace over the admitted Agent capabilities and the study's failure owner, then flush the active goal's rows into the evidence sink.

```ts
import type { StudyAgentRuntime, StudyLatchInterface, StudySinkInterface } from '@orkestrel/study'
import { StudyAgentTrace } from '@orkestrel/study/server'

declare const runtime: StudyAgentRuntime
declare const latch: StudyLatchInterface
declare const sink: StudySinkInterface

const trace = new StudyAgentTrace({
	runtime,
	latch,
	observe: false,
	origins: (messages) => messages.map((message) => ({ source: message.id })),
})
trace.append('note', 'dropped') // no active goal
trace.start('count')
trace.append('note', 'kept')
trace.goal // 'count'
await trace.flush(sink) // appends one `note` row for the goal `count`
trace.goal // undefined
```

### Validate recorded admission

Validate the owned recording group, then check its next model request before dispatch.

```ts
import type { StudyOllamaTransportOptions, StudyOllamaRequest } from '@orkestrel/study/server'
import {
	buildStudyOllamaBytes,
	isStudyOllamaMetadata,
	isStudyOllamaModel,
	isStudyOllamaPolicy,
	isStudyOllamaStep,
	validateStudyOllamaRecording,
	validateStudyOllamaStep,
} from '@orkestrel/study/server'

declare const configured: StudyOllamaTransportOptions
declare const request: StudyOllamaRequest
declare const body: string
validateStudyOllamaRecording(configured)
isStudyOllamaMetadata(configured.metadata)
isStudyOllamaModel(configured.models.model)
isStudyOllamaPolicy(configured.roles.agent)
isStudyOllamaStep(configured.procedure?.[0])
validateStudyOllamaStep(configured.procedure?.[0], 'write', request, body)
buildStudyOllamaBytes(new TextEncoder().encode(body))
```

### Own transport inputs

Copy declared configuration and mutable request headers before asynchronous admission.

```ts
import type { StudyOllamaTransportOptions } from '@orkestrel/study/server'
import { buildStudyOllamaSnapshot, buildStudyOllamaTransportOptions } from '@orkestrel/study/server'

declare const configured: StudyOllamaTransportOptions
const owned = buildStudyOllamaTransportOptions(configured)
const headers = new Headers({ 'x-request': 'original' })
const request = buildStudyOllamaSnapshot(new URL('/api/chat', owned.url), { headers }, undefined)
headers.set('x-request', 'changed')
new Headers(request.init?.headers).get('x-request') // 'original'
owned.signal === configured.signal // true
```

### isStudyStop

Validate an owned ceiling reading.

```ts
import { isStudyStop } from '@orkestrel/study'

isStudyStop({ layer: 'scope', id: 'Goal tokens', max: 100, consumed: 120 }) // true
```

### studyStopToJSON

Project unknown readings without inventing a value.

```ts
import { studyStopToJSON } from '@orkestrel/study'

studyStopToJSON({ layer: 'model', id: 'num_predict', max: 2048, consumed: undefined })
// { layer: 'model', id: 'num_predict', max: 2048, consumed: null }
```

### translateStudyAgentStop

Translate the Agent record after the run settles.

```ts
import { translateStudyAgentStop } from '@orkestrel/study'

translateStudyAgentStop({ layer: 'meter', id: 'meter', max: 2000, consumed: 2001 })
// a CAPACITY StudyError whose failure.stop is { layer: 'meter', id: 'meter', max: 2000, consumed: 2001 }
```

### computeStudyAttributions

Group failed records while retaining their source readings.

```ts
import { computeStudyAttributions } from '@orkestrel/study/server'

computeStudyAttributions([{ trial: 'r1-s1-a1', goal: undefined, failure, executed: true }])
```

### parseStudyReading

Keep only a finite foreign reading.

```ts
import { parseStudyReading } from '@orkestrel/study'

parseStudyReading(2048) // 2048
parseStudyReading(Number.NaN) // undefined
```

### computeStudyAdmittedStop

Read the first admitted usage ceiling crossed.

```ts
import { computeStudyAdmittedStop } from '@orkestrel/study'

computeStudyAdmittedStop({ role: 'agent', tokens: 10, bytes: 100 }, usage) // { layer: 'scope', id: 'Admitted tokens', max: 10, consumed: 12 }
```

### computeStudyOutputStop

Read the first output allowance that refuses the encoded product.

```ts
import { computeStudyOutputStop } from '@orkestrel/study'

computeStudyOutputStop(2048, 1024, []) // { layer: 'scope', id: 'Goal bytes', max: 1024, consumed: 2048 }
```

### Read a study declaration

Read the selected declaration and its driver fixtures before selecting a profile.

```ts
import type { StudyDeclaration } from '@orkestrel/study/server'
import { readStudyDeclaration } from '@orkestrel/study/server'

declare const root: string
const declaration: StudyDeclaration = await readStudyDeclaration(root, 'assessment')
```

### Read declaration bytes

Pass an already resolved and contained declaration path.

```ts
import { readStudyDeclarationBytes } from '@orkestrel/study/server'

declare const root: string
declare const path: string
await readStudyDeclarationBytes(root, path)
```

### Read the installed version

Pass the installed executable entry to read its owning package's manifest.

```ts
import { readStudyVersion } from '@orkestrel/study/server'

declare const entry: string
readStudyVersion(entry)
```

### Match a system error

Match a caught Error without accepting an unbranded record.

```ts
import { matchesSystemError } from '@orkestrel/study/server'

const error = Object.assign(new Error('Missing declaration'), { code: 'ENOENT' })
matchesSystemError(error, 'ENOENT') // true
matchesSystemError({ code: 'ENOENT' }, 'ENOENT') // false
```

### Helper calls

Supply the argument tuple from each helper's signature.

```ts
import {
	buildStudyAgentDispatch,
	buildStudyAgentParts,
	failureToStudyError,
	isStudyAgentRuntime,
	projectStudyAgentRequest,
	readStudyFailure,
	translateStudyAgentError,
	validateStudyAgentUsage,
} from '@orkestrel/study'
import {
	buildStudyAgentReadings,
	buildStudyAgentRevision,
	buildStudyOllamaModels,
	buildStudyOllamaOptions,
	buildStudyOllamaRaw,
	buildStudyOllamaTiming,
	collectStudyAncestors,
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
	iterateArtifactEntries,
	readArtifact,
	readArtifactBytes,
	readStudyAdapter,
	readStudyAgentResult,
	readStudyHandle,
	readStudyOllamaDigest,
	readStudyOllamaFailure,
	readStudyOllamaRequest,
	readStudyOllamaSupport,
	readStudyOllamaTerminal,
	readStudyOllamaTiming,
	resolveStudyAgentContent,
	resolveStudyInstrument,
	scanStudyTree,
	terminateStudyChild,
	validateStudyOllamaCompletion,
	validateStudyOllamaInventory,
	validateStudyOllamaRoles,
	validateStudyRuntime,
} from '@orkestrel/study/server'

declare const collectStudyAncestorsArguments: Parameters<typeof collectStudyAncestors>
collectStudyAncestors(...collectStudyAncestorsArguments)
declare const collectStudyEntriesArguments: Parameters<typeof collectStudyEntries>
collectStudyEntries(...collectStudyEntriesArguments)
declare const buildStudyAgentDispatchArguments: Parameters<typeof buildStudyAgentDispatch>
buildStudyAgentDispatch(...buildStudyAgentDispatchArguments)
declare const buildStudyAgentPartsArguments: Parameters<typeof buildStudyAgentParts>
buildStudyAgentParts(...buildStudyAgentPartsArguments)
declare const buildStudyAgentReadingsArguments: Parameters<typeof buildStudyAgentReadings>
buildStudyAgentReadings(...buildStudyAgentReadingsArguments)
declare const buildStudyAgentRevisionArguments: Parameters<typeof buildStudyAgentRevision>
buildStudyAgentRevision(...buildStudyAgentRevisionArguments)
declare const buildStudyOllamaModelsArguments: Parameters<typeof buildStudyOllamaModels>
buildStudyOllamaModels(...buildStudyOllamaModelsArguments)
declare const buildStudyOllamaOptionsArguments: Parameters<typeof buildStudyOllamaOptions>
buildStudyOllamaOptions(...buildStudyOllamaOptionsArguments)
declare const buildStudyOllamaRawArguments: Parameters<typeof buildStudyOllamaRaw>
buildStudyOllamaRaw(...buildStudyOllamaRawArguments)
declare const buildStudyOllamaTimingArguments: Parameters<typeof buildStudyOllamaTiming>
buildStudyOllamaTiming(...buildStudyOllamaTimingArguments)
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
declare const isStudyAgentRuntimeArguments: Parameters<typeof isStudyAgentRuntime>
isStudyAgentRuntime(...isStudyAgentRuntimeArguments)
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
declare const iterateArtifactEntriesArguments: Parameters<typeof iterateArtifactEntries>
iterateArtifactEntries(...iterateArtifactEntriesArguments)
declare const projectStudyAgentRequestArguments: Parameters<typeof projectStudyAgentRequest>
projectStudyAgentRequest(...projectStudyAgentRequestArguments)
declare const readArtifactArguments: Parameters<typeof readArtifact>
readArtifact(...readArtifactArguments)
declare const readArtifactBytesArguments: Parameters<typeof readArtifactBytes>
readArtifactBytes(...readArtifactBytesArguments)
declare const readStudyAdapterArguments: Parameters<typeof readStudyAdapter>
readStudyAdapter(...readStudyAdapterArguments)
declare const readStudyAgentResultArguments: Parameters<typeof readStudyAgentResult>
readStudyAgentResult(...readStudyAgentResultArguments)
declare const readStudyHandleArguments: Parameters<typeof readStudyHandle>
readStudyHandle(...readStudyHandleArguments)
declare const readStudyFailureArguments: Parameters<typeof readStudyFailure>
readStudyFailure(...readStudyFailureArguments)
declare const readStudyOllamaDigestArguments: Parameters<typeof readStudyOllamaDigest>
readStudyOllamaDigest(...readStudyOllamaDigestArguments)
declare const readStudyOllamaFailureArguments: Parameters<typeof readStudyOllamaFailure>
readStudyOllamaFailure(...readStudyOllamaFailureArguments)
declare const readStudyOllamaRequestArguments: Parameters<typeof readStudyOllamaRequest>
readStudyOllamaRequest(...readStudyOllamaRequestArguments)
declare const readStudyOllamaSupportArguments: Parameters<typeof readStudyOllamaSupport>
readStudyOllamaSupport(...readStudyOllamaSupportArguments)
declare const readStudyOllamaTerminalArguments: Parameters<typeof readStudyOllamaTerminal>
readStudyOllamaTerminal(...readStudyOllamaTerminalArguments)
declare const readStudyOllamaTimingArguments: Parameters<typeof readStudyOllamaTiming>
readStudyOllamaTiming(...readStudyOllamaTimingArguments)
declare const resolveStudyAgentContentArguments: Parameters<typeof resolveStudyAgentContent>
resolveStudyAgentContent(...resolveStudyAgentContentArguments)
declare const resolveStudyInstrumentArguments: Parameters<typeof resolveStudyInstrument>
resolveStudyInstrument(...resolveStudyInstrumentArguments)
declare const scanStudyTreeArguments: Parameters<typeof scanStudyTree>
scanStudyTree(...scanStudyTreeArguments)
declare const terminateStudyChildArguments: Parameters<typeof terminateStudyChild>
terminateStudyChild(...terminateStudyChildArguments)
declare const translateStudyAgentErrorArguments: Parameters<typeof translateStudyAgentError>
translateStudyAgentError(...translateStudyAgentErrorArguments)
declare const validateStudyAgentUsageArguments: Parameters<typeof validateStudyAgentUsage>
validateStudyAgentUsage(...validateStudyAgentUsageArguments)
declare const validateStudyOllamaCompletionArguments: Parameters<
	typeof validateStudyOllamaCompletion
>
validateStudyOllamaCompletion(...validateStudyOllamaCompletionArguments)
declare const validateStudyOllamaInventoryArguments: Parameters<typeof validateStudyOllamaInventory>
validateStudyOllamaInventory(...validateStudyOllamaInventoryArguments)
declare const validateStudyOllamaRolesArguments: Parameters<typeof validateStudyOllamaRoles>
validateStudyOllamaRoles(...validateStudyOllamaRolesArguments)
declare const validateStudyRuntimeArguments: Parameters<typeof validateStudyRuntime>
validateStudyRuntime(...validateStudyRuntimeArguments)
```

### Call closure helpers

Supply the declared selections, captured records, and physical paths.

```ts
import {
	computeArtifactClosureDigest,
	isArtifactClosure,
	isArtifactKey,
	isArtifactLoaderOptions,
	isArtifactMember,
	isStudyClosure,
	matchesArtifactCredential,
	readArtifactPhysical,
	readStudyClosure,
	relocateArtifactPath,
	resolveArtifactBase,
	resolveArtifactMember,
	resolveStudyClosurePath,
	verifyArtifactClosure,
} from '@orkestrel/study/server'

declare const digest: Parameters<typeof computeArtifactClosureDigest>
computeArtifactClosureDigest(...digest)
declare const closure: Parameters<typeof isArtifactClosure>
isArtifactClosure(...closure)
declare const key: Parameters<typeof isArtifactKey>
isArtifactKey(...key)
declare const options: Parameters<typeof isArtifactLoaderOptions>
isArtifactLoaderOptions(...options)
declare const member: Parameters<typeof isArtifactMember>
isArtifactMember(...member)
declare const publication: Parameters<typeof isStudyClosure>
isStudyClosure(...publication)
declare const credential: Parameters<typeof matchesArtifactCredential>
matchesArtifactCredential(...credential)
declare const physical: Parameters<typeof readArtifactPhysical>
readArtifactPhysical(...physical)
declare const reader: Parameters<typeof readStudyClosure>
readStudyClosure(...reader)
declare const relocation: Parameters<typeof relocateArtifactPath>
relocateArtifactPath(...relocation)
declare const base: Parameters<typeof resolveArtifactBase>
resolveArtifactBase(...base)
declare const target: Parameters<typeof resolveArtifactMember>
resolveArtifactMember(...target)
declare const selection: Parameters<typeof resolveStudyClosurePath>
resolveStudyClosurePath(...selection)
declare const verification: Parameters<typeof verifyArtifactClosure>
verifyArtifactClosure(...verification)
```

### Call ArtifactLoader methods

Supply an instance of the declared contract.

```ts
import type { ArtifactLoader } from '@orkestrel/study/server'

declare const instance: ArtifactLoader
declare const inspect: Parameters<ArtifactLoader['inspect']>
instance.inspect(...inspect)
declare const load: Parameters<ArtifactLoader['load']>
instance.load(...load)
declare const materialize: Parameters<ArtifactLoader['materialize']>
instance.materialize(...materialize)
declare const verify: Parameters<ArtifactLoader['verify']>
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

### Call StudyAgentJudge methods

Supply an instance of the declared contract.

```ts
import type { StudyAgentJudge } from '@orkestrel/study'

declare const instance: StudyAgentJudge
declare const ask: Parameters<StudyAgentJudge['ask']>
instance.ask(...ask)
```

### Call StudyAgentObserver methods

Supply an instance of the declared contract.

```ts
import type { StudyAgentObserver } from '@orkestrel/study'

declare const instance: StudyAgentObserver
declare const generate: Parameters<StudyAgentObserver['generate']>
instance.generate(...generate)
declare const stream: Parameters<StudyAgentObserver['stream']>
instance.stream(...stream)
```

### Call StudyAgentScript methods

Supply an instance of the declared contract.

```ts
import type { StudyAgentScript } from '@orkestrel/study/server'

declare const instance: StudyAgentScript
declare const clear: Parameters<StudyAgentScript['clear']>
instance.clear(...clear)
declare const generate: Parameters<StudyAgentScript['generate']>
instance.generate(...generate)
declare const prepare: Parameters<StudyAgentScript['prepare']>
instance.prepare(...prepare)
declare const stream: Parameters<StudyAgentScript['stream']>
instance.stream(...stream)
```

### Call StudyAgentSummary methods

Supply an instance of the declared contract.

```ts
import type { StudyAgentSummary } from '@orkestrel/study/server'

declare const instance: StudyAgentSummary
declare const summarize: Parameters<StudyAgentSummary['summarize']>
instance.summarize(...summarize)
```

### Call StudyAgentTrace methods

Supply an instance of the declared contract.

```ts
import type { StudyAgentTrace } from '@orkestrel/study/server'

declare const instance: StudyAgentTrace
declare const admit: Parameters<StudyAgentTrace['admit']>
instance.admit(...admit)
declare const append: Parameters<StudyAgentTrace['append']>
instance.append(...append)
declare const canonical: Parameters<StudyAgentTrace['canonical']>
instance.canonical(...canonical)
declare const dispatch: Parameters<StudyAgentTrace['dispatch']>
instance.dispatch(...dispatch)
declare const flush: Parameters<StudyAgentTrace['flush']>
instance.flush(...flush)
declare const measure: Parameters<StudyAgentTrace['measure']>
instance.measure(...measure)
declare const record: Parameters<StudyAgentTrace['record']>
instance.record(...record)
declare const start: Parameters<StudyAgentTrace['start']>
instance.start(...start)
declare const translate: Parameters<StudyAgentTrace['translate']>
instance.translate(...translate)
```

### Call StudyArtifactLoader methods

Supply an instance of the declared contract.

```ts
import type { StudyArtifactLoader } from '@orkestrel/study/server'

declare const instance: StudyArtifactLoader
declare const adapter: Parameters<StudyArtifactLoader['adapter']>
instance.adapter(...adapter)
declare const inspect: Parameters<StudyArtifactLoader['inspect']>
instance.inspect(...inspect)
declare const load: Parameters<StudyArtifactLoader['load']>
instance.load(...load)
declare const verify: Parameters<StudyArtifactLoader['verify']>
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

### Call StudyGradingStore methods

Supply an instance of the declared contract.

```ts
import type { StudyGradingStore } from '@orkestrel/study/server'

declare const instance: StudyGradingStore
declare const read: Parameters<StudyGradingStore['read']>
instance.read(...read)
declare const write: Parameters<StudyGradingStore['write']>
instance.write(...write)
```

### Call StudyLatchInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyLatchInterface } from '@orkestrel/study'

declare const instance: StudyLatchInterface
declare const check: Parameters<StudyLatchInterface['check']>
instance.check(...check)
declare const fail: Parameters<StudyLatchInterface['fail']>
instance.fail(...fail)
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

### Call StudyOllamaTransport methods

Supply an instance of the declared contract.

```ts
import type { StudyOllamaTransport } from '@orkestrel/study/server'

declare const instance: StudyOllamaTransport
declare const check: Parameters<StudyOllamaTransport['check']>
instance.check(...check)
declare const clear: Parameters<StudyOllamaTransport['clear']>
instance.clear(...clear)
declare const close: Parameters<StudyOllamaTransport['close']>
instance.close(...close)
declare const fail: Parameters<StudyOllamaTransport['fail']>
instance.fail(...fail)
declare const fetch: Parameters<StudyOllamaTransport['fetch']>
instance.fetch(...fetch)
declare const prepare: Parameters<StudyOllamaTransport['prepare']>
instance.prepare(...prepare)
declare const verify: Parameters<StudyOllamaTransport['verify']>
instance.verify(...verify)
```

### Call StudyProcessDriver methods

Supply an instance of the declared contract.

```ts
import type { StudyProcessDriver } from '@orkestrel/study/server'

declare const instance: StudyProcessDriver
declare const open: Parameters<StudyProcessDriver['open']>
instance.open(...open)
```

### Call StudyProcessGoal methods

Supply an instance of the declared contract.

```ts
import type { StudyProcessGoal } from '@orkestrel/study/server'

declare const instance: StudyProcessGoal
declare const issue: Parameters<StudyProcessGoal['issue']>
instance.issue(...issue)
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

### Call StudyResultStore methods

Supply an instance of the declared contract.

```ts
import type { StudyResultStore } from '@orkestrel/study/server'

declare const instance: StudyResultStore
declare const exchanges: Parameters<StudyResultStore['exchanges']>
instance.exchanges(...exchanges)
declare const create: Parameters<StudyResultStore['create']>
instance.create(...create)
declare const finish: Parameters<StudyResultStore['finish']>
instance.finish(...finish)
declare const seal: Parameters<StudyResultStore['seal']>
instance.seal(...seal)
declare const start: Parameters<StudyResultStore['start']>
instance.start(...start)
```

### Call StudyResultStoreInterface methods

Supply an instance of the declared contract.

```ts
import type { StudyResultStoreInterface } from '@orkestrel/study/server'

declare const instance: StudyResultStoreInterface
declare const exchanges: Parameters<StudyResultStoreInterface['exchanges']>
instance.exchanges(...exchanges)
declare const create: Parameters<StudyResultStoreInterface['create']>
instance.create(...create)
declare const finish: Parameters<StudyResultStoreInterface['finish']>
instance.finish(...finish)
declare const seal: Parameters<StudyResultStoreInterface['seal']>
instance.seal(...seal)
declare const start: Parameters<StudyResultStoreInterface['start']>
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

### Declare and compose daemon staging

The command owns staging for ordinary execution. A custom execution host can compose the same session and preparation contracts.

```ts
import { isStudyDaemon } from '@orkestrel/study'
import { StudyDaemonSession, StudyDaemonTrial } from '@orkestrel/study/server'
import { createOllamaDaemon } from '@orkestrel/ollama/server'
import type { StudyDaemonSessionOptions, StudyDaemonTrialOptions } from '@orkestrel/study/server'

isStudyDaemon({ executable: 'ollama' }) // false
declare const options: StudyDaemonSessionOptions
const session = new StudyDaemonSession(options)
declare const prepare: Parameters<StudyDaemonSession['prepare']>
try {
	await session.start()
	await session.prepare(...prepare)
} finally {
	await session.stop()
}

declare const trialOptions: StudyDaemonTrialOptions
const trial = new StudyDaemonTrial(trialOptions)
declare const declaration: Parameters<typeof createOllamaDaemon>[0]
const daemon = createOllamaDaemon({
	...declaration,
	fetch: (input, init) =>
		new URL(new Request(input, init).url).pathname === '/api/generate'
			? trial.fetch(input, init)
			: globalThis.fetch(input, init),
})
try {
	await daemon.start()
	await trial.execute(daemon)
} finally {
	await daemon.destroy()
}
```

## Tests

The staging proofs drive the real command and worker over a Node protocol daemon on an ephemeral loopback port. The daemon records whether each unload's attempt was already readable on disk. The source suite proves repeated maintenance prefixes, exact ordinal joins, offline replay without a daemon or request, and startup, trial, unload, and cancellation cleanup while an unrelated sentinel survives. Setup proofs validate fixture declarations without starting a child.

### Call exchange and replay helpers

Supply validated declarations, retained bytes, or a selected sealed result as each contract requires.

```ts
import { isStudyRecord } from '@orkestrel/study'
import {
	buildStudyExchangeSequence,
	isStudyExchangeBytes,
	isStudyExchangeDeclaration,
	isStudyExchangeDestination,
	isStudyExchangeHistory,
	isStudyExchangeIdentity,
	isStudyExchangeReply,
	isStudyExchangeRow,
	isStudyReplaySelection,
	projectStudyExchangeIdentity,
	readStudyExchangeRows,
	readStudyExchanges,
	readStudyPreparedDestination,
	readStudyRecordingDeclaration,
	readStudyReplayHistory,
	readStudyTrialExchanges,
	validateStudyExchangeEvidence,
	validateStudyExchangeHistory,
	validateStudyExchangeRequest,
	validateStudyExchangeRows,
} from '@orkestrel/study/server'

declare const isStudyRecordArguments: Parameters<typeof isStudyRecord>
isStudyRecord(...isStudyRecordArguments)
declare const buildStudyExchangeSequenceArguments: Parameters<typeof buildStudyExchangeSequence>
buildStudyExchangeSequence(...buildStudyExchangeSequenceArguments)
declare const isStudyExchangeBytesArguments: Parameters<typeof isStudyExchangeBytes>
isStudyExchangeBytes(...isStudyExchangeBytesArguments)
declare const isStudyExchangeDeclarationArguments: Parameters<typeof isStudyExchangeDeclaration>
isStudyExchangeDeclaration(...isStudyExchangeDeclarationArguments)
declare const isStudyExchangeDestinationArguments: Parameters<typeof isStudyExchangeDestination>
isStudyExchangeDestination(...isStudyExchangeDestinationArguments)
declare const isStudyExchangeHistoryArguments: Parameters<typeof isStudyExchangeHistory>
isStudyExchangeHistory(...isStudyExchangeHistoryArguments)
declare const isStudyExchangeIdentityArguments: Parameters<typeof isStudyExchangeIdentity>
isStudyExchangeIdentity(...isStudyExchangeIdentityArguments)
declare const isStudyExchangeReplyArguments: Parameters<typeof isStudyExchangeReply>
isStudyExchangeReply(...isStudyExchangeReplyArguments)
declare const isStudyExchangeRowArguments: Parameters<typeof isStudyExchangeRow>
isStudyExchangeRow(...isStudyExchangeRowArguments)
declare const isStudyReplaySelectionArguments: Parameters<typeof isStudyReplaySelection>
isStudyReplaySelection(...isStudyReplaySelectionArguments)
declare const projectStudyExchangeIdentityArguments: Parameters<typeof projectStudyExchangeIdentity>
projectStudyExchangeIdentity(...projectStudyExchangeIdentityArguments)
declare const readStudyExchangeRowsArguments: Parameters<typeof readStudyExchangeRows>
readStudyExchangeRows(...readStudyExchangeRowsArguments)
declare const readStudyExchangesArguments: Parameters<typeof readStudyExchanges>
readStudyExchanges(...readStudyExchangesArguments)
declare const readStudyPreparedDestinationArguments: Parameters<typeof readStudyPreparedDestination>
readStudyPreparedDestination(...readStudyPreparedDestinationArguments)
declare const readStudyRecordingDeclarationArguments: Parameters<
	typeof readStudyRecordingDeclaration
>
readStudyRecordingDeclaration(...readStudyRecordingDeclarationArguments)
declare const readStudyReplayHistoryArguments: Parameters<typeof readStudyReplayHistory>
readStudyReplayHistory(...readStudyReplayHistoryArguments)
declare const readStudyTrialExchangesArguments: Parameters<typeof readStudyTrialExchanges>
readStudyTrialExchanges(...readStudyTrialExchangesArguments)
declare const validateStudyExchangeEvidenceArguments: Parameters<
	typeof validateStudyExchangeEvidence
>
validateStudyExchangeEvidence(...validateStudyExchangeEvidenceArguments)
declare const validateStudyExchangeHistoryArguments: Parameters<typeof validateStudyExchangeHistory>
validateStudyExchangeHistory(...validateStudyExchangeHistoryArguments)
declare const validateStudyExchangeRequestArguments: Parameters<typeof validateStudyExchangeRequest>
validateStudyExchangeRequest(...validateStudyExchangeRequestArguments)
declare const validateStudyExchangeRowsArguments: Parameters<typeof validateStudyExchangeRows>
validateStudyExchangeRows(...validateStudyExchangeRowsArguments)
```

### Call exchange sink methods

Supply the worker-owned sink or its declared interface.

```ts
import type { StudyExchangeSink, StudyExchangeSinkInterface } from '@orkestrel/study/server'

declare const sink: StudyExchangeSink
declare const append: Parameters<StudyExchangeSink['append']>
sink.append(...append)
sink.close()
declare const contract: StudyExchangeSinkInterface
declare const row: Parameters<StudyExchangeSinkInterface['append']>
contract.append(...row)
contract.close()
```

### Call replay methods

Supply a replay over a completely verified selected history.

```ts
import type { StudyOllamaReplay, StudyOllamaReplayInterface } from '@orkestrel/study/server'

declare const replay: StudyOllamaReplay
replay.check()
replay.close()
declare const contract: StudyOllamaReplayInterface
contract.check()
contract.close()
```

See the behavioral proofs in the following directories.

- [tests/src/core](../tests/src/core)
- [tests/src/server](../tests/src/server)
- [tests/src/bin](../tests/src/bin)
