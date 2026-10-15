# Promote shared study instrumentation

The 2026-10-15 review recommends promoting reusable Agent instrumentation from Agent's
authored studies into Study. Agent is the common runtime for studies; the package under
study owns its workload, treatment choices, tools, and grading criteria. This document
records a completed source review and a proposed extraction. No extraction is implemented.

The review covers Agent `c3e0f41`, Study `a37cc37`, the authored `studies/` file census,
their proofs under `tests/studies/`, Study's execution and custody contracts, and the
relevant Ollama protocol readers. Both checkouts began clean. No builds, installations,
model calls, or test executions were needed for this review. The running Compaction
series and retained Records result are outside the extraction's mutation scope.

## Separate runtime from subject

The shared runtime and the package being studied are distinct roles. Both authored drivers
interpret `StudyDriverOptions.subject` as Agent: see
`../agent/studies/memory/types.ts:46` and `../agent/studies/tools/types.ts:19`.
Study only passes subject and provider namespaces today: see
`src/server/adapters/types.ts:23` and `src/server/processes/StudyArtifacts.ts:91`.

Add an explicit `agent` selection beside `subject` in the execution profile and loaded
driver dependencies. For an Agent study they may resolve to the same canonical entry;
deduplicate the capture, not the declared roles. For MCP, the subject selects MCP and the
Agent selection identifies the runtime exercising it. For Ollama, the subject and provider
may select the same admitted Ollama entry while Agent remains separately identified.

The existing roots inventory already captures transitive Agent bytes. The additional
selection identifies which admitted occurrence supplies the runtime when several Agent
copies exist; it does not replace or duplicate artifact capture. Extend the existing
loader, validation exclusions, identity checks, and worker protocol together. Do not add
automatic dependency discovery, an uncaptured dynamic import, or a second module loader.
Validation must remain unable to evaluate any selected execution entry, including Agent.

The profile also requires a judge model, judge digest, and recap allowance even when a
workflow uses neither: see `src/core/types.ts:62` and `src/core/types.ts:71`. Make auxiliary
model roles and their allowances conditional on the declared workflow. A plain Agent-backed
MCP study must not invent a judge merely to satisfy the memory profile. The memory adapter
still validates every role its selected treatment actually uses; omitted usage stays unknown.

Study can declare Agent as a dependency for its integration contracts. Import Agent types
in the shared instrumentation and construct runtime objects through the admitted namespace.
Do not eagerly import a constructor from Study's installed Agent. Agent has Study only as
a devDependency, so the manifest graph does not contain a production dependency cycle.
This is a declaration reading, not a published-package installation proof.

A consumer such as MCP can declare Study and Agent as devDependencies. Ollama already
declares Agent as a runtime dependency. Study tooling does not require MCP's published
runtime to depend on Agent. Use the published Orkestrel versions resolved at implementation
time; retain no local-file dependency after publication. Freeze installation changes out
of every running series.

## Rule on each authored file

The following matrix covers the authored files under Agent's `studies/`. Paths in this
matrix are relative to that directory. A split moves reusable declarations and their
proofs, updates every consumer, and removes the old declarations without re-exports.

| Files | Disposition | Reason |
| --- | --- | --- |
| `memory/StudyMemoryObserver.ts` | Promote after splitting observation from enforcement | Exact request observation, delegation, replay policy, and usage readings apply to any Agent-backed study. Requiring usable actual usage is an explicit policy, not a side effect of enabling passive metrics. |
| `memory/StudyMemoryTransport.ts` | Split | Admission, settlement, bounded reads, cancellation, correlation, and evidence are shared instrumentation. Ollama request/response interpretation belongs in a named Ollama integration. Sampling, judge output, verification cadence, and strict overflow settings are declared treatment policy. |
| `memory/StudyMemoryJudge.ts` | Promote the failure-preserving integration | A caught classification failure must remain visible to the study. Bind the real judge to shared failure ownership; remove dependence on a memory-named transport. |
| `memory/StudyMemorySession.ts` | Split | Promote request-component capture, request revisions, dispatch correlation, and nominal Agent error attribution. Retain arrivals, released reference state, lookup semantics, prompts, arm construction, and summary policy. Keep lifecycle ownership with the session. |
| `memory/StudyMemoryDriver.ts` | Retain, then simplify | It selects supported memory arms and composes the memory session over admitted modules. Shared instrumentation removes construction detail without needing a base driver. |
| `memory/StudyMemoryAdapter.ts` | Retain, then simplify | The driver name, supported arms, public input shape, and capacity rubric restrictions are authored policy. Reuse shared validation or grading only where the contract is equivalent. |
| `memory/helpers.ts` | Split by responsibility | Promote request revision/parts, usage evidence projection, error translation, and common grading traversal. Put wire facts in the provider integration. Retain memory settings, provenance joins, and assertion predicates. |
| `memory/types.ts` | Split alongside the declarations | Shared observer and evidence contracts move with their implementation. Memory arms, input, released state, and assertions remain. Avoid copying Agent and Ollama public contracts. |
| `memory/validators.ts` | Split alongside the contracts | The shared Agent capability guard follows the runtime integration. Memory input, arms, settings, and assertions remain. Provider capability checks belong to that integration. |
| `memory/constants.ts` | Retain | Support-desk instructions, filing thresholds, topics, and workload ceilings are experimental choices. |
| `memory/factories.ts`, `memory/index.ts` | Retain and update | Keep the authored adapter entry; import promoted symbols from Study and remove obsolete barrel rows. |
| `tools/ScriptedStudyProvider.ts` | Retain | It consumes scripted responses, prior tool content, and deliberate cancellation/admission controls. It proves mechanisms and cannot establish real-model quality. Its settlement boilerplate can use the shared ticket capability. |
| `tools/StudyToolsSession.ts` | Split narrowly | Promote reusable Agent result/trace projection only where the semantics match. Use shared ticket settlement. Retain scratch read/write behavior, declared authority, workload cancellation, and resource disposal. |
| `tools/StudyToolsDriver.ts` | Retain | It owns a canonical scratch child and the actual tools workload session. Another resource kind need not use scratch files. |
| `tools/StudyToolsAdapter.ts` | Retain, then simplify | Mechanism purpose, scripted provider selection, and workload validation are specific to this study. |
| `tools/helpers.ts` | Split | Promote the grading traversal and evidence-reference mechanism. Retain scratch path/file observations, projected scripted messages, and file/tool/denial predicates. |
| `tools/types.ts`, `tools/validators.ts` | Split only with proven shared behavior | Keep response scripts, filenames, assertions, and operation arguments local. Share the admitted Agent capability boundary without requiring Ledger capabilities in a tools study. |
| `tools/parsers.ts`, `tools/errors.ts`, `tools/constants.ts` | Retain | These define bounded scripted input and scratch refusal policy. An expected tool refusal is not a Study operational failure. |
| `tools/factories.ts`, `tools/index.ts` | Retain and update | Keep the consumer factory and remove symbols after their actual promotion. |
| `capacity/study.json`, `memory/study.json`, `endurance/study.json`, `qualification/study.json`, `tools/study.json` | Retain | The research question, purpose, schedule, arms, horizon, and rubric selection belong to the consumer. |
| `capacity/rubric.json`, `memory/rubric.json`, `endurance/rubric.json`, `qualification/rubric.json`, `tools/rubric.json` | Retain | Quality criteria and treatment-specific mechanical predicates remain independent of execution. |
| `memory/profiles/local.json`, `memory/profiles/q4.json`, `memory/profiles/q4-room.json`, `tools/profiles/local.json` | Retain and update for the selected runtime contract | Package roots, provider identity, room, and allowances are experiment inputs. Do not promote the machine-local endpoint, model choices, or limits as defaults. |
| `memory/scenarios/handoff.json`, `memory/scenarios/endurance.json` | Retain | These are the public memory workloads and release schedules. |
| `tools/scenarios/write.json`, `tools/scenarios/refusal.json`, `tools/scenarios/admission.json`, `tools/scenarios/cancellation.json`, `tools/scenarios/continuation.json` | Retain | These are explicit scripted mechanism workloads. |
| `memory/provenance.json`, `endurance/provenance.json` | Retain | These bind workload adaptation and public release boundaries. They are neither engine configuration nor model input. |

## Consolidate the shared mechanisms

Use `src/core/agents/` for host-independent Agent request observation and typed evidence
projection. Put the Node-dependent Agent integration in `src/server/agents/`. Place the
Ollama-specific study transport in `src/server/ollama/`, exposed through the existing
server barrel. These are proposed module homes within existing surfaces, not additional
packages, CLI commands, or subpath exports. Keep shared types in each module's `types.ts`.

Agent continues to own request measurement, conversation compaction, Records, tool dispatch,
and the agent loop. Study consumes those public capabilities; it must not implement another
version of any strategy. The consumer chooses strategy settings and task tools.

Reuse Study's existing `StudyMeter`, `StudyRequest`, `StudyControl`, `StudyScope`, evidence
sink, loader, and grading stores. They already own budget admission, finite deadlines,
first operational failure, cancellation, and custody. Add no parallel budget or retry engine.

Ticket cleanup is a concrete shared capability. Both ticket implementations already store
settlement state, while consumers duplicate terminal flags and aborted-ticket guards.
Expose that derived state and centralize failure settlement after escaped work. A remote
ticket's aborted signal does not establish local settlement: the parent may already own the
failure. Preserve the no-second-settlement invariant rather than treating aborted as settled.
See `src/core/engines/StudyRequest.ts:16`,
`src/server/processes/StudyRemoteTicket.ts:8`, and
`src/server/processes/StudyRemoteMeter.ts:71`.

Keep tool semantics explicit. Memory lookup accounts known bytes even when its operation
throws; tools finish an expected refusal and fail an operational error. A generic executor
must not erase this difference. Shared settlement state does not require a universal tool
wrapper or a session base class.

Promote the grading traversal over the declared schedule, criterion selection, missing
evidence handling, and evidence references into Study's adapter helpers. Retain domain
predicates as supplied behavior. Preserve input validation at the public grading boundary,
semantic unknowns, reason text, methods, order, and one-based evidence references. The
memory operational predicate requires whole-attempt success; keep that policy local and
do not replace it with per-goal success during extraction. Historical grading identities
remain immutable.

Do not copy provider parsers under a generic name. Ollama already exports `extractUsage`
and `extractTiming`; the latter is already injected into the memory transport. Its usage
projection does not have Study's partial-count and strict validation semantics. The audit
found no public wire-error, model inventory, context-support, or finish-reason reader in
Ollama's `src/core`. Put reusable protocol facts at their Ollama owner when added, and
keep Study's attribution and budget policy in the Study integration. Preserve the existing
decoding and failure classification until that change has its own proofs.

Use `hashStudyBytes` for an already rendered canonical request. Preserve the existing
request-rendering failure behavior; `encodeStudyJSON` is not an interchangeable replacement
because it normalizes through JSON and appends a newline.

## Preserve measurement and experimental meaning

Separate request measurement from treatment enforcement. Preserve the selected Agent's
`measureRequest` and `estimateRequest`, the frozen gauge, unknown usage, and the distinction
between component estimates and actual provider totals. Origins annotate components and
must not be added as another token partition. Join evidence by explicit identities, not
text matching or assumed message positions.

There is no measured speed improvement from this extraction. Duplicate deadline handles
deserve a focused attribution proof before consolidation: the ticket, provider, and native
fetch timeout can report different failure paths. Do not call that a verified runtime
defect based on source inspection alone.

The checked-in memory profiles omit the required compaction gauge; proof setup and frozen
run preparation supply it. Preserve explicit calibration and reject an incomplete selected
profile. Do not introduce an identity gauge or silently reuse a previous result's gauge.

Real-model studies execute actual package workflows, retain bounded failures and products,
and grade independently. Deterministic tests prove that this instrumentation behaves as
declared. The scripted tools workload remains a mechanism proof. Do not turn scripted
outcomes into evidence for an MCP strategy's model quality.

## Implement in bounded units

1. Define and prove the explicit Agent selection through existing profile, artifact,
   validation, and worker contracts. Exercise both a shared Agent/subject entry and distinct
   Agent/subject entries, including a second installed Agent occurrence. Prove that a changed
   selected runtime changes the execution identity and validation evaluates none of it.
   Admit workflows without an unused judge or summarizer, and refuse a memory treatment
   whose required auxiliary role is missing.
2. Promote the request observer and evidence projections with their existing proofs. Keep
   observation switches independent of admission policy. Prove identical requests, products,
   and outcomes with observation disabled and enabled; retain the changed-byte controls.
3. Extract the Ollama study integration with declared wire policy. Prove stream completion,
   finite reads, malformed/absent usage, non-2xx bodies, native context failures, accounting
   before rejection, and first-failure retention. Preserve the intentional one-token judge
   finish and the Compaction-only strict flags.
4. Consolidate ticket settlement and retained-evidence grading. Prove local/remote abort,
   thrown settlement, no duplicate accounting, complete declared judgment populations,
   invalid evidence references, semantic unknowns, and consumer predicate equivalence.
5. Migrate Agent's authored consumers, remove the promoted copies, and update guide parity.
   Shared implementation proofs move to Study's mirrored `tests/src/` paths and existing
   environment setup files. Agent workload proofs remain in `tests/studies/`, with shared
   authored-study infrastructure in `tests/setupStudy.ts`.
6. Prove package consumption through a real non-Agent subject using the selected Agent
   runtime. A bounded MCP protocol fixture can prove the hookup without claiming model
   quality. A live MCP or Ollama comparative workload requires its own declared question,
   arms, limits, and independent rubric; do not add such a workload as a hidden migration step.

The implementation exit is shared instrumentation consumed by Agent, verified distinct
runtime/subject selection, equivalent retained evidence semantics, and no duplicate copies.
Changing treatment, rerunning Records, publishing, and adding unrelated studies are outside
that extraction. Validate future source in an isolated build while any captured installation
remains live; do not rebuild, reinstall, or modify a frozen series to adopt the extraction.

## Reconcile the design opinion

Actual Opus proposed the ticket and grading promotions, and recommended leaving all
Agent-aware code in consumers. Accept the concrete settlement and grading findings and its
warning about selecting the wrong Agent copy. Reject the blanket exclusion of Agent-aware
instrumentation: the user's common-runtime requirement supports a typed shared integration,
and admitted namespace injection preserves runtime selection without eager imports.

Opus proposed deleting consumer validation because the host also validates it. Preserve the
contract of directly callable public grading helpers; consolidate the checks at the shared
boundary instead. Do not treat a host call path as proof that a public helper's validation
is redundant. The review did not establish a failure of cross-copy Agent error recognition,
so that remains a proof requirement rather than a defect claim.

Grok supplied the file and overlap map; Luna checked exact dependency and protocol seams;
Astra read the decision-bearing contracts and implementations and made these rulings.
Opus session `022c7fb9-3f3a-47e7-8995-d8bfa06f4159` completed in 430581 ms, exit 0,
uncapped. Grok session `c8db85b1-b360-40c6-91ef-4ea7a90f8c3c` completed in 444135 ms,
exit 0, uncapped. Citation checks resolved the map's 76 references and the opinion's
44 references after expanding its shortened paths. Those checks establish location,
not semantic correctness. No Fable lane was dispatched.
