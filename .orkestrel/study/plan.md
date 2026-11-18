# Studies salvage and reorganization

## Goal

Move the generic study machinery that Study, Agent, and taverna each duplicate into the package that owns it. The Ollama protocol fixture goes to `@orkestrel/ollama/server`. The install, rehearsal, context, grader, role, and quantile helpers go to `@orkestrel/study`. Reorganize Agent's studies so each kept study answers one question, records and compaction run as separate executions that can't run together, and `test:studies` runs green and faster.

## Exit criterion

All of the following hold:
- `@orkestrel/ollama` 0.0.41 and `@orkestrel/study` 0.0.23 serve the additions the design fixes, each release reviewed and gated;
- Agent depends on them, with its local copies deleted and no alias;
- Agent declares records and compaction in separate studies, behind a standing refusal of any declaration that names both;
- Agent has cut the `tools` and `context` studies, the labeling harness, and the `narrow` profile;
- Agent's `npm run test:studies` reads green, with a wall time below the U0 baseline;
- after U6, each kept study holds one fresh sealed baseline, with records and compaction in separate executions, each rehearsed first;
- a written comparison of each new baseline against the earlier readings shows no unexplained anomaly;
- the earlier results are deleted and the documents cite the new baseline, with no protected path read or removed.

## Repositories

| Package | Repository | Change |
| --- | --- | --- |
| `@orkestrel/study` | https://github.com/orkestrel/study | Additions per § Rulings, release 0.0.23 |
| `@orkestrel/ollama` | https://github.com/orkestrel/ollama | `createOllamaFixture`, release 0.0.41 |
| `@orkestrel/agent` | https://github.com/orkestrel/agent | studies reorganized, devDependencies re-pinned, no release |

Taverna's studies retire at taverna `cbd960ef` with no further run. Nothing in taverna changes.

## Governing skills

| Unit kind | Skill |
| --- | --- |
| The campaign across ollama, study, and agent | `orkestrel-align` |
| Each package unit | `orkestrel-harden` |
| Every brief, launch, and acceptance | `orkestrel-dispatch` |
| Peer sessions, the host lane | `orkestrel-parallel` |
| The audit round on the integrated result | `orkestrel-falsify` |
| Mapping and census | `orkestrel-scout` |
| The ollama and study releases | `orkestrel-publish` |

## Rulings

A read-only consultation set these rulings on 2026-11-17. The campaign's design round reconciled them the same day, and `designs/contracts.md` holds the contracts. `designs/split.md` holds Agent's records and compaction split.

| Candidate | Ruling | Home |
| --- | --- | --- |
| Ollama protocol fixture | In, callback first, with no built-in reply policy | `@orkestrel/ollama/server`: `OllamaFixture`, `createOllamaFixture`, `buildOllamaReply`, `buildOllamaReadout`, `buildOllamaInventory`, `buildOllamaAnswer` |
| Install, command runner, and rehearsal | In, as one entity: `StudyInstall` with `execute` and `rehearse`, built by `createStudyInstall` over `ArtifactLoader.materialize` | Study `./server` |
| Profile rebind, selectors, runtime walk, model deduplication | In | Study `./server`: `buildStudyFixtureProfile`, `buildStudySelectors`, `collectStudyRuntime`, `collectStudyOllamaModels` |
| Zero-based evidence rows | In | Study `./server`: `collectStudyRows` |
| Quantile | In, linear interpolation | Study core: `computeStudyQuantile` |
| `createStudyContext` | Deferred: the engine assembles at three lifetimes | none |
| `readStudyObservation`, `buildStudyVerdict`, `validateStudyTreatment`, `buildStudyOllamaRole` | Refused: one-line delegates or consumer policy | consumer |
| A test-support entry | Refused: `AGENTS.md` § Project model admits no testing face | none |
| Topology probe, progress reader, bounds derivation, predicate grader | Out: one consumer each, or domain policy | consumer |
| Profile overlay | Refused: profile bytes are execution identity | none |
| `study rehearse` verb | Refused: no consumer needs a command | none |
| Grading one sealed result under a second rubric | Needs no feature: two rubrics give two assessment identities over an unchanged seal, and the same rubric twice gives one (probe U1, 2026-11-17) | settled |
| Keyed replay satisfying the qualification gate | Share one recording per pair through `--replay <capacity> --roles <recorded roles> --offline true`: the quality twin seals with `manifest.qualification` equal to the capacity seal and sends no request, and a changed series bound refuses with `CONFIG` (probe U1, 2026-11-17). Both twins of a pair share one profile's bytes, because the capacity manifest's identity binds the profile digest | settled |
| One fixture for every reply policy | The consumer's `reply` callback sees every path first, and the fixture answers its own Ollama paths only when the callback declines; with the fixture answering first, Study's and Agent's scripted replies never arrive (probe U1, 2026-11-17) | settled |
| `/v1/systemone` | Study's triage route (`src/server/ollama/helpers.ts:283`), not an Ollama route; the fixture hands it to the consumer's reply callback | read 2026-11-17 |

Agent's reorganization:
- **Keep and simplify** `chat` and `disclosure`.
- **Replace** `memory`, `capacity`, `endurance`, and `qualification` with the eight single-strategy declarations of `designs/split.md`.
- **Cut** `tools` and `context` after a claim-by-claim coverage check, the labeling harness, and the `narrow` profile.
- **Records and compaction** run as separate studies, each pair under one strategy profile, behind the refusal `validateStudyMemoryStrategy` raises in the adapter's `validate`. No sealed result is rewritten.
- **The baseline replaces the earlier results.** After U6, record one fresh sealed baseline per kept study through the host lane, each rehearsed first, with records and compaction run separately. Before any long run, give the user the run plan with a time estimate per run.
  - Compare each new baseline against the earlier readings: Agent `studies/README.md` § What it measured, the O187 to O199 readings at agent `db86a3eb`, the 2026-11-12 disclosure reading, the `chat` battery rows, and the earlier sealed results in Agent's untracked study output. For each metric, give old against new, the setup difference (declaration split, build, runner, models), and whether that difference explains it.
  - When no anomaly stands, delete the earlier results and replace the readings in Agent's documents; git history keeps the earlier text.
  - When an anomaly stands, stop and report it to the user with its evidence before deleting anything.
  - The deletion never reads or removes Agent's sealed inputs and answer keys: its private endurance sources, its private and label study output, any packet or mapping file, or any rubric's criteria. Each Agent brief names those exact paths.
- **The `desk` catalog** stays byte-identical as the fixed input of the 2026-11-12 reading.
- **`StudyMemoryJudge`** stays in Agent until an application composes it (Agent `ROADMAP.md` item 4).
- **Other packages:** nothing moves to `tool`, `mcp`, or `workflow`, and Toolbox gains no study until a decision needs one.

## Claims

U4, in `@orkestrel/ollama/server`:

1. The fixture listens on `127.0.0.1` at port 0, and `url` stays readable after `destroy`.
2. The reply callback sees every request first, after the log append and the `request` event. A built-in answer applies only when the callback declines, and removing the callback-first branch turns its test red.
3. The built-in answers match the route table in `designs/contracts.md`. A declined chat or readout gets 500, and an unknown path 404.
4. The unload reply answers a body with no prompt, and Ollama's own `readOllamaTerminal` accepts it.
5. A callback's `Response` is written verbatim. An erroring body destroys the connection, a held body releases on client disconnect or `destroy`, and a throwing callback gets 500 and an `error` event.
6. `destroy` is idempotent, never rejects, frees the port, aborts every callback signal, and destroys the emitter last.
7. Invalid options refuse with `OllamaError` code `invalid` before anything listens.
8. Every builder round-trips through Ollama's own readers, and `createOllama` and the judge run against the fixture.
9. No daemon stand-in remains in Ollama's tests, and Ollama's runtime dependencies are unchanged.

U5, in `@orkestrel/study`:

10. `createStudyInstall` copies exactly the members `study freeze` retains, refuses each input `designs/contracts.md` names, removes what it made on a refusal, and copies no file planted under `sources/private/`.
11. A rebound profile passes `parseStudyProfile` unchanged.
12. `StudyInstall.execute` spawns the bin with no inherited `execArgv`, captures both streams, and returns 124 with the process tree terminated at its deadline.
13. The launcher's own stream bytes, timing, and exit codes are unchanged.
14. `rehearse` runs freeze, check, execute, read, grade, and report through the closure, and skips each step after a failed one.
15. `collectStudyRows` rows render one-based through `gradeStudyEvidence`, and `computeStudyQuantile` equals desk's median.
16. Study's tests adopt `createOllamaFixture` and `StudyInstall`, and no duplicate fixture or runner helper remains.
17. A test proves keyed offline replay passes the qualification gate, promoted from probe U1.

## Release bar

A finding outside the claims blocks only when it shows one of these:
- a built-in answer preempts the callback;
- a socket, port, or child process survives `destroy` or a deadline;
- `src/` imports a package outside its declared dependencies;
- a refused input still has an effect;
- a builder emits a body Ollama's readers refuse;
- the command line's output or exit codes change;
- a duplicate helper remains;
- the install copies a file outside freeze's members;
- a process proof Study already holds is added.

## Stops

| Seam | Stop | Reopens when |
| --- | --- | --- |
| Fixture teardown and streaming | Two repair rounds, then a design question | A verifier's repeat run under suite load fails |
| Wire faithfulness | The builders round-trip through Ollama's own readers | A service-project recording disagrees |
| Callback order | Settled by probe U1 | A policy needs pre-body or socket access |
| Install copy | `materialize`'s refusals are the contract | A consumer layout `materialize` refuses must install |
| Launcher capture | One review round | Captured mode flakes under load |
| Strategy refusal | The adapter's `validate` and its tests | A path that skips `validate` executes a study |

## Open decisions

- **Prune the five top-level records** `.orkestrel/metrics.md`, `performance.md`, `promotion.md`, `semantic.md`, and `series.md`. They record the October records and compaction promotion campaign. They name machine-local and ignored paths and sibling repositories outside the tree, which the campaign rule refuses. Run the carry and promotion checks of scaffold `.agents/skills/orkestrel-debrief/references/retention.md`, then present the disposition to the user. Delete only on the user's go-ahead.

## Deferrals

| Item | Trigger | Owner |
| --- | --- | --- |
| A Toolbox catalog-disclosure study | A decision needs Toolbox's catalog disclosure measured on a small model | user |
| A predicate grader vocabulary in Study | A second consumer writes one | Study |
| The topology probe | A second consumer after taverna retires | Agent |
| `createStudyContext` | `StudySeries` routes its goal assembly through one factory | Study |
| `buildStudyVerdict` | `gradeStudyEvidence` takes over the method mapping | Study |
| Qualification on the definition | A third strategy, or a second consumer that needs it | Study and the user |
| Fault-policy builders published by Ollama | A second package needs them | Ollama |
| Per-model `context` in `/api/show` | A consumer with mixed context windows | Ollama |
| An endurance control arm | The user asks for that comparison | Agent |

## ROADMAP triggers

- Items 1, 2, and 3: not met. The campaign adds no duration allowance, planned stop, or milestone waiter.
- Item 5: not met. `@orkestrel/test` carries no standing-proof observation mechanism (scaffold `guides/test.md`, read 2026-11-17).
- Item 6: reopens when a `StudyResultStore` case fails under load in this campaign's gates. U5 adds no process proof to that file.

## State

- 2026-11-17, the campaign opens at study `897f85d`, ollama `4294bc4`, agent `6d5d34d7`, taverna `cbd960ef`.
- 2026-11-17, the user ruled on the consultation's decisions, then corrected the compaction decision (ledger).
- 2026-11-17, the contract 0.0.26 wave's closing round re-pins Agent's devDependencies to study `^0.0.22` and ollama `^0.0.40`, which covers U0. Its visits to ollama and study run before this campaign's first writer in each.
- 2026-11-17, probe U1 settled keyed-replay qualification, the second rubric, and the fixture's callback-first order, and the design round reconciled into `designs/contracts.md` and `designs/split.md`.
- 2026-11-17, the closing round's visits landed and pushed: agent `571f6989` (devDependencies at study `^0.0.22` and ollama `^0.0.40`), ollama `36f5653`, and study `9828cc3`.
- 2026-11-17, the carry check on the five top-level records sent three Agent-side items to A1, U7, and U7c: the memory grader's whole-attempt rule, compaction's request-room admission at goal `ev-16-4`, and the rate of blank recaps.
- Next: dispatch U5 (phases B then A) in study and U4 (phases A then B) in ollama. Agent's owner runs U0's proof, then U2, U3, and A1.

## Sequence

| Unit | Repository | Owner | Depends on | Release |
| --- | --- | --- | --- | --- |
| U0: Agent devDependency re-pin; proof `test:studies` green (2 failing before) | agent | closing round, then agent's owner | none | none |
| U1: probes for keyed-replay qualification, a second rubric, and one fixture serving both reply policies; closed, its cases promote in U4, U5, and A1 | study, untracked | `opus` | none | none |
| U2: cut the labeling harness, retire `narrow`, hoist the `chat` system text at the conversion | agent | agent's owner | U0 | none |
| U3: coverage check, then cut `tools` and `context` | agent | agent's owner | U0 | none |
| A1: the split of `designs/split.md`, the refusal, the memory test split and trims | agent | agent's owner | U2 | none |
| U4a: `OllamaFixture` and its builders | ollama | `opus` | the closing round's ollama visit | none |
| U4b: Ollama's tests adopt the fixture | ollama | `opus` | U4a | none |
| U4 review, document pass, gates, release | ollama | `reviewer`, Orchestrator, `verifier` | U4b | ollama 0.0.41 |
| U5a: `StudyInstall`, its factory, `rehearse`, and the launcher capture | study | `opus` | the closing round's study visit | none |
| U5b: `computeStudyQuantile` and `collectStudyRows` | study | `opus` | the closing round's study visit | none |
| U5c: Study's tests adopt the fixture and the install | study | `opus` | U5a, ollama 0.0.41 published | none |
| U5 review, document pass, gates, release | study | `reviewer`, Orchestrator, `verifier` | U5b, U5c | study 0.0.23 |
| U6: Agent adopts: re-pin, then `desk`, then `chat` and `memory` | agent | agent's owner | U5 published | none |
| U7: the run plan with a time estimate per run, given to the user, then one rehearsed, sealed baseline per kept study, records and compaction separate | agent | agent's owner | U6 | none |
| U7c: the comparison of each new baseline against the earlier readings, anomalies stopped and reported | agent | agent's owner | U7 | none |
| U7d: delete the earlier results outside the protected paths, replace the documents' readings | agent | agent's owner | U7c with no anomaly | none |
| U8: one document pass per repository | all three | each owner | with each release | with each release |
