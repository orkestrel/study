# Studies salvage and reorganization

## Goal

Move the generic study machinery that Study, Agent, and taverna each duplicate into the package that owns it. The Ollama protocol fixture goes to `@orkestrel/ollama/server`. The install, rehearsal, rows, and quantile helpers go to `@orkestrel/study`. Reorganize Agent's studies so each kept study answers one question on the records strategy alone, on the 4B model, and `test:studies` runs green and faster.

## Exit criterion

All of the following hold:
- `@orkestrel/ollama` 0.0.41 and `@orkestrel/study` 0.0.23 serve the additions the design fixes, each release reviewed and gated;
- Agent depends on them, with its local copies deleted and no alias;
- Agent declares the four memory studies `memory`, `capacity`, `endurance`, and `qualification` on records alone, with `full` as the handoff control, on the `local` and `recommended` profiles, and Agent 0.0.47 holds no compaction (the user's rulings of 2026-11-18);
- Agent has cut the `tools` and `context` studies, the labeling harness, and the `narrow` and 2B profiles;
- Agent's `npm run test:studies` reads green, with a wall time below the U0 baseline;
- after the records-native work's last unit (its D1), each kept study holds one fresh sealed baseline on the 4B, each rehearsed first;
- a written comparison of each new baseline against the earlier readings shows no unexplained anomaly;
- the earlier results are deleted and the documents cite the new baseline, with no protected path read or removed.

## Repositories

| Package | Repository | Change |
| --- | --- | --- |
| `@orkestrel/study` | https://github.com/orkestrel/study | Additions per § Rulings, release 0.0.23; the bridge 0.0.24 (the observer's `model`); the records-native S1, 0.0.25 |
| `@orkestrel/ollama` | https://github.com/orkestrel/ollama | `createOllamaFixture`, release 0.0.41 (`1e78302`); the records-native O0 (0.0.42), the provider's `model` (0.0.43), and O1 (0.0.44) |
| `@orkestrel/agent` | https://github.com/orkestrel/agent | studies reorganized, devDependencies re-pinned; its records-native release, 0.0.47, is that work's |

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

A read-only consultation set these rulings on 2026-11-17. The campaign's design round reconciled them the same day, and `designs/contracts.md` holds the contracts. `designs/split.md` holds Agent's records and compaction split, headed by the records-only set that superseded it.

| Candidate | Ruling | Home |
| --- | --- | --- |
| Ollama protocol fixture | In, callback first, with no built-in reply policy | `@orkestrel/ollama/server`: `OllamaFixture`, `createOllamaFixture`, `buildOllamaReply`, `buildOllamaReadout`, `buildOllamaInventory`, `buildOllamaAnswer` |
| Install, command runner, and rehearsal | In, as one entity: `StudyInstall` with `execute` and `rehearse`, built by `createStudyInstall` over `ArtifactLoader.materialize` | Study `./server` |
| Profile rebind, selectors, freeze's member selection, model deduplication | In | Study `./server`: `buildStudyFixtureProfile`, `buildStudySelectors`, `buildStudyFreezeOptions`, `collectStudyOllamaModels` |
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
- **Replace** `memory`, `capacity`, `endurance`, and `qualification` with single-strategy declarations: agent `2a7c4e9f` landed the eight of `designs/split.md`, and the user's rulings of 2026-11-18 keep only the records four, with `full` as the handoff control, and return them to the plain names before any baseline records: `memory`, `capacity`, `endurance`, and `qualification`, on the `local` and `recommended` profiles (agent `71d0105a`, each rubric moved whole with its pinned digest unchanged).
- **Cut** `tools` and `context` after a claim-by-claim coverage check, the labeling harness, and the `narrow` profile.
- **Compaction left** the studies and Agent itself (the user, 2026-11-18): the four `compaction*` declarations, the compaction arm, the compaction and 2B profiles, and `validateStudyMemoryStrategy` are gone; the adapter keeps the refusal of a declaration with only `full`. Agent 0.0.47, ollama 0.0.44, and study 0.0.25 hold no compaction. No sealed result is rewritten.
- **The baseline replaces the earlier results.** After the records-native work's D1, record one fresh sealed baseline per kept study on the 4B through the host lane, each rehearsed first. Before any long run, give the user the run plan with a time estimate per run.
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

10. `createStudyInstall` copies exactly the members `study freeze` retains for the same studies and profiles, refuses each input `designs/contracts.md` names, and removes what it made on a refusal.
11. A rebound profile passes `parseStudyProfile` unchanged.
12. `StudyInstall.execute` spawns the bin with no inherited `execArgv` and captures both streams. At its deadline it returns 124 with the tree a live leader reaches terminated. After any termination it begins, it settles within `STUDY_DRAIN_DURATION` of the later of that moment and the leader's exit. A descendant of an exited leader is beyond reach on every host, as Study's task and trial children already state (U5d; narrowed on 2026-11-18 after the review's O1).
13. The launcher's own stream bytes, timing, and exit codes are unchanged.
14. `rehearse` runs freeze, check, execute, read, grade, and report through the closure, and skips each step after a failed one.
15. `collectStudyRows` rows render one-based through `gradeStudyEvidence`, and `computeStudyQuantile` equals desk's median.
16. Study's tests adopt `createOllamaFixture` and `StudyInstall`, and no duplicate fixture or runner helper remains.
17. A test proves keyed offline replay passes the qualification gate, promoted from probe U1.

## Release bar

A finding outside the claims blocks only when it shows one of these:
- a built-in answer preempts the callback;
- a socket or port survives `destroy`, a reachable child process survives a deadline, or `execute` stays pending after a termination it began;
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

none.

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
| F1: the fixture's untested `error` emission in the window between `destroy()` starting and the emitter's destruction | The next change to the fixture's teardown | Ollama |
| F3: the inline unload literal in `DaemonPolicy.reply` (ollama `tests/setupServer.ts`), the shape `buildOllamaAnswer` builds | The next change to `DaemonPolicy` | Ollama |
| The fixture's unbounded request text without `drain` handling, and unknown event names in `on` | A consumer under realistic load, or a misspelled hook | Ollama |
| The scaffold catalog's mirrors of `guides/ollama.md` and `guides/study.md` | Met 2026-11-18 (ollama 0.0.42 and study 0.0.23 serve); no scaffold session is live to take it, so it goes to the user | scaffold's owner session |
| `terminateStudyChild` throwing inside `StudyLaunchChild`'s timer and abort listener with no guard (by reading; unverified) | A reading that it throws | Study |
| Adopting `@orkestrel/process` for every supervised Study child | Study moves every child onto it, or a POSIX descendant in the leader's group must die; the dependency needs the user's go-ahead | Study and the user |
| A sparse top-logprob list handed directly to Ollama's `computeAnswer` throws a `TypeError` at the hole | A direct caller passes a sparse list | Ollama |
| `StudyCommand`'s inline `--trial` and `--goals` rendering beside `buildStudySelectors`, with a different seed rendering | The next change to `StudyCommand`'s selection argv | Study |
| The launch child's drain is pinned only on its interruption arm: mutants routing the deadline, overflow, or pre-aborted path straight to `terminateStudyChild`, or arming per call, survive (review 3) | The next change to `StudyLaunchChild`'s termination | Study |
| `buildOllamaRow` beside `createOllamaReply`'s default row (review 3, advisory) | The next change to either | Study |
| Toolbox 0.0.35 and every other package on `@orkestrel/agent ^0.0.46` at runtime re-pin to 0.0.47, run their gates, and republish (records-native T1) | The user's go-ahead after the wave | Orchestrator, on the user's word |
| Agent's seven records-native findings below the bar (`share` and `thresholds` admit unknown keys, `Selection.recoveries` unvalidated, role and member agreement at `add`, `Ledger#flush`'s positional pending, `reference()`'s default label, two consumerless helpers, the "fitted" sentence) | The next Agent unit at each seam | Agent's owner |

## ROADMAP triggers

- Items 1, 2, and 3: not met. The campaign adds no duration allowance, planned stop, or milestone waiter.
- Item 5: not met. `@orkestrel/test` carries no standing-proof observation mechanism (scaffold `guides/test.md`, read 2026-11-17).
- Item 6: met in U5c, when a `StudyResultStore` case timed out under the full suite; closed in study `35d8321`, and the item is removed. U5 adds no process proof to that file.

## State

- 2026-11-17, the campaign opens at study `897f85d`, ollama `4294bc4`, agent `6d5d34d7`, taverna `cbd960ef`.
- 2026-11-17, the user ruled on the consultation's decisions, then corrected the compaction decision (ledger).
- 2026-11-17, the contract 0.0.26 wave's closing round re-pins Agent's devDependencies to study `^0.0.22` and ollama `^0.0.40`, which covers U0. Its visits to ollama and study run before this campaign's first writer in each.
- 2026-11-17, probe U1 settled keyed-replay qualification, the second rubric, and the fixture's callback-first order, and the design round reconciled into `designs/contracts.md` and `designs/split.md`.
- 2026-11-17, the closing round's visits landed and pushed: agent `571f6989` (devDependencies at study `^0.0.22` and ollama `^0.0.40`), ollama `36f5653`, and study `9828cc3`.
- 2026-11-17, the carry check on the five top-level records sent three Agent-side items to A1, U7, and U7c: the memory grader's whole-attempt rule, compaction's request-room admission at goal `ev-16-4`, and the rate of blank recaps. On the user's go-ahead the five records were pruned; the prune commit carries the promotion record.
- 2026-11-17, U0's proof read green (agent `571f6989`); U2 landed (agent `f679477e`, `e0c8e59d`, `147ba8eb`, `1c937991`); U3's Agent-side cases landed (agent `8e041d6b`, `3508558c`); A1 landed (agent `2a7c4e9f`).
- 2026-11-17, U4 landed in ollama (`086cfe3`, `ae3b947`) and ollama 0.0.41 published from `1e78302`.
- 2026-11-18, the user ruled records the one native strategy: compaction and the 2B leave the studies and Agent itself. The records-native work, in Agent, runs the source removal. The baseline stays in this campaign and runs after that work's D1 (ledger).
- 2026-11-18, U5's phases B, B2, and A landed (study `322eed7`) after one review, two repair rounds, a re-audit, and the Orchestrator's closure check. Ollama O0 landed (ollama `019c8ee`), and 0.0.42's chain is green, awaiting the user's word on its live service run.
- 2026-11-18, ollama 0.0.42 published from `4ebc609` on the user's word, its live service run 90 of 90 against a second daemon.
- 2026-11-18, U3's cut landed (agent `60274406`). U5d landed (study `8c0ff3a`), study took ollama `^0.0.42` (`239f429`), U5c landed with the successor round (`35d8321`) after review 3 passed, and U8's study pass landed (`7b413d1`). Study 0.0.23 published from `833cbe0`.
- 2026-11-18, the records-native work landed A1 and A2 with A4's compaction cut (agent `11df7b32`) and A3a (agent `2b995b19`).
- 2026-11-18, ollama 0.0.43 published from `3b44cc6` (the provider's `model`); U6 landed (agent `de2bc0ad`).
- 2026-11-18, the user ruled one wave on local tarball pins in place of one-off publishes, scoped to ollama, study, and agent, with only dist-moving and gate-required work before it. The wave published study 0.0.24 (`a32874b`, the bridge), Agent 0.0.47 (agent `f39e638e`), ollama 0.0.44 (`f727f4c`, O1), and study 0.0.25 (`9e8ffa0`, S1).
- 2026-11-18, Agent's D1 landed (agent `48a53228`), P2 read byte-identical on the published set, and the user approved U7's run plan. Rows 1 to 3 sealed (`disclosure`, `chat` at `full` and `compact`); `tight` reruns at its re-estimated cap.
- 2026-11-18, the user ruled the plain names back before rows 5 to 8 record; the rename, ROADMAP item 65's class move (it changed the memory fingerprints), `local`'s record allowance, and `recommended`'s 9,600,000 ms durations landed together (agent `71d0105a`). Each capacity and quality pair runs from one frozen closure, because the qualification gate compares whole identity, root included.
- Next: U7's `tight` rerun and rows 5 to 8, then U7c.

## Sequence

| Unit | Repository | Owner | Depends on | Release |
| --- | --- | --- | --- | --- |
| Records-native D1: Agent's devDependencies at study 0.0.25 and ollama 0.0.44, latching through its own transport, P2 and `test:studies` green | agent | agent's owner | study 0.0.25 | none unless `compare` exits 3 |
| U7: the run plan with a time estimate per run, given to the user, then one rehearsed, sealed baseline per kept study on the 4B | agent | agent's owner | records-native D1 | none |
| U7c: the comparison of each new baseline against the earlier readings, anomalies stopped and reported | agent | agent's owner | U7 | none |
| U7d: delete the earlier results outside the protected paths, replace the documents' readings | agent | agent's owner | U7c with no anomaly | none |
| U8: Agent's readings in U7d | agent | agent's owner | U7d | none |
