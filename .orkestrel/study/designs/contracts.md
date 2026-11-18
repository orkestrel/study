# Contracts: the Ollama fixture and Study's install

This design was reconciled on 2026-11-17 from one independent design round. Two `planner` lanes worked in clean contexts, the second holding the objective lane for an unavailable `analyst`, and probe U1 settled three of their open questions. Each row names what the Orchestrator ruled where the lanes differed.

## `createOllamaFixture` in `@orkestrel/ollama/server`

- `src/server/OllamaFixture.ts` holds one class over `node:http`.
  - `factories.ts` adds `createOllamaFixture(options): Promise<OllamaFixtureInterface>`, which constructs the fixture and awaits `start`.
  - The class is barrelled.
  - Ollama's runtime dependencies stay `agent`, `budget`, `contract`, `emitter`, `ndjson`, `process`, and `tool`. Nothing in `src/` imports `@orkestrel/test`, `@orkestrel/router`, or `@orkestrel/server`.
- **The reply callback sees every request first,** after the fixture appends that request to its log and emits `request`. A built-in answer applies only when the callback returns `undefined`. `/v1/systemone` reaches the callback like any other path. Probe U1 measured this order: with the fixture answering first, Study's and Agent's scripted replies never arrived.
- **The callback returns a WHATWG `Response`,** which the fixture writes verbatim: status, headers, and body chunks in order.
  - A body stream that errors destroys the connection, before the head when no chunk was read. That expresses a disconnect, a partial body, and a reset.
  - A body that never closes holds the reply until the client disconnects or `destroy` runs.
  - A callback that throws gets a 500 carrying the message, plus an `error` event, and the fixture keeps serving.
  - The callback receives an `AbortSignal` that aborts when the client disconnects or `destroy` runs.
  - Ruled for the native `Response`, over a fixture-owned reply record with `pause`, `gap`, and `finish` modes: the platform primitive carries every observed fault, and the fault vocabulary stays in each package's tests.
- **No built-in reply policy.** A declined `/api/chat`, and a declined `/api/generate` that is not an unload, get 500 with `{"error":"no reply policy answers <path>"}`. The consumers' defaults disagree (Agent's readout tokens `A` to `G` against the prototype's `Yes`/`No`), so a default is product policy. Ruled against built-in defaults.
- **Built-in answers:**

  | Request the callback declined | Answer |
  | --- | --- |
  | `GET /api/version` | `{"version": version}` |
  | `GET /api/tags` | `buildOllamaInventory(models)` |
  | `POST /api/show` naming a pinned model | `model_info` with architecture `fixture` and `fixture.context_length` set to `context` |
  | `POST /api/show` naming an unpinned model | Ollama's own refusal status and body |
  | `POST /api/generate` with `keep_alive: 0` and an absent or empty `prompt`, pinned model | `{model, created_at, response: "", done: true, done_reason: "unload"}` |
  | Malformed JSON on a built-in route | 400 with `{"error": …}` |
  | Any other method or path | 404 |

  Copy the refusal bodies from a reading or a test of Ollama's own daemon (`.claude/rules/tests.md` § Shared test infrastructure). When neither exists, the writer reports it, and nothing is invented. Ollama's daemon sends its unload with no prompt (`src/server/OllamaDaemon.ts:393`).
- **Declarations.** In `src/server/types.ts`, every member is `readonly`:
  - `OllamaFixtureRequest { method, path, headers, body }`: no position field, because order is the log's.
  - `OllamaFixtureHandler = (request, signal) => Response | undefined | Promise<Response | undefined>`.
  - `OllamaFixtureOptions { on?, error?, models: readonly OllamaModel[], version: string, context: number, reply? }`. `version` and `context` are required because consumers differ on both. `models` holds unique, nonempty names; a duplicate refuses.
  - `OllamaFixtureEventMap { request: [request], error: [error: unknown] }`.
  - `OllamaFixtureInterface { url, requests, emitter, start(), destroy() }`.
- **Builders,** in `src/server/helpers.ts`, each returning wire text built on the core `OllamaCounts`, `OllamaDurations`, and `Logprob` types:
  - `buildOllamaReply(options?)`: optional delta rows from `parts`, then one terminal NDJSON row. `OllamaReplyOptions { model?, content?, parts?, thinking?, calls?, reason?, counts?, durations? }`.
  - `buildOllamaReadout(options)`: `OllamaReadoutOptions { model?, token, top: readonly Logprob[], counts? }`.
  - `buildOllamaInventory(models)`: replaces the test-side `buildDaemonInventory`.
  - `buildOllamaAnswer(request, options)`: the built-in answer as a pure function returning a `Response`. The class and Study's fetch-level fixture both call it.
  - Every builder round-trips through Ollama's own readers.
- **Lifecycle.**
  - `start` listens on `127.0.0.1` at port 0, and repeated calls share the first result.
  - `url` stays readable after `destroy`.
  - `url` read before `start`, and `start` after `destroy`, refuse with `OllamaError` code `state`. Invalid options refuse with code `invalid` before anything listens.
  - `destroy` is idempotent, shares one barrier, never rejects, aborts every callback signal, cancels held bodies, closes all connections, closes the server, and destroys the emitter last.
  - A callback that settles after `destroy` writes nothing.
  - Nothing polls.
- **The request log** appends each record frozen, after its whole body arrives and before the callback runs. The getter returns a copy.
- **Ollama's tests afterward.**
  - Delete `FixtureDaemon`, `DaemonInterface`, `DaemonPeer`, `DaemonPeerOptions`, `createDaemonPeer`, and `buildDaemonInventory`. Delete `createChatUpstream` too when it stands in for a daemon.
  - Fault modes and per-case answers become reply-policy data and one policy class in `tests/setupServer.ts`.
  - The relay, proxy, and page servers stay, along with the raw `tests/src/server/fixtures/daemon.mjs` child.
- **Inventory derivation in Study.** `collectStudyOllamaModels(buildStudyOllamaModels(provider))` deduplicates the pins by name. A duplicate tags entry fails the `matches.length !== 1` check in `validateStudyOllamaInventory` (`study/src/server/ollama/helpers.ts:678`). The existing deduplications in `src/server/stores/helpers.ts` route through it.

## Study's install, runner, and rehearsal in `@orkestrel/study/server`

- **`StudyInstall`,** in `src/server/launchers/StudyInstall.ts`, is one class. Its constructor takes the existing `StudyLaunchOptions { root, entry }`, so a test install and a frozen closure are both installs.
  - `execute(arguments_, duration?)` spawns `process.execPath` with the entry and arguments only, in the install root, with no shell and no inherited `execArgv`. It supervises the child through `StudyLaunchChild`, capturing both streams, and returns `StudyInstallResult { code, stdout, stderr, duration }`, with `duration` read from `performance.now()`.
  - A deadline terminates the process tree through `terminateStudyChild` and returns 124.
  - The default duration is `STUDY_LAUNCH_DURATION + STUDY_LAUNCH_CLEANUP`.
  - Ruled for a child process over driving `StudyLauncher` in process. `StudyLauncher.execute` registers `SIGINT` and `SIGTERM` on the calling process (`StudyLauncher.ts:34-35`), and its child receives the caller's `process.execArgv` (`:123`). From a test worker, that binds the worker's flags into the recording's runtime identity, so the recording can't replay from the command line.
- **`StudyLaunchResult`** becomes `{ code, stdout, stderr }`. The names mirror the process streams. `StudyLaunchChild` gains stderr capture, and the launcher's own stream bytes and timing don't change: its check diagnostics still stream live.
- **`createStudyInstall(options): Promise<StudyInstall>`,** in `src/server/launchers/factories.ts`.
  - `StudyInstallOptions { root, directory, studies, profiles?, provider? }`, where `provider` is `Pick<StudyProvider, 'url' | 'digest'>`.
  - It copies through one `ArtifactLoader({ roots, entries, assets }).materialize(directory)` call.
    - The roots are the dependency walk from `root`'s manifest plus the installed Study package. `collectStudyRuntime(root)` is extracted from `validateStudyRuntime` in `src/server/processes/helpers.ts`, which then calls it, so there is one walk.
    - The assets are exactly the members `study freeze` retains for each selected declaration: its definition, rubric, scenarios, profiles, and adapter graph. Reuse freeze's member selection rather than writing a second one.
    - It never copies a directory wholesale, and it never copies a file outside those members. A test plants a file under the bundle's `sources/private/` and asserts it is absent from the install.
  - Ruled for `materialize` over a hand copy, because it already preserves the physical forest and verifies before and after. Its refusals (`OCCUPIED`, `PARENT`, `VOLUME`, `OVERLAP`, `ALIAS`) pass through unchanged and are the install's contract.
  - When `provider` is given, the factory rebinds each profile named in `profiles` through `buildStudyFixtureProfile`, after copying.
  - It refuses with `StudyError` code `CONFIG`, and on any refusal after creating `directory` it removes what it made. It refuses:
    - a root outside `root`;
    - an absolute `roots`, `agent`, `subject`, or `provider.entry` entry;
    - a profile name no copied bundle holds;
    - a missing executable at `STUDY_INSTALL_ENTRY`.

    Each refusal names its key path and the fix.
- **`buildStudyFixtureProfile(profile, url, digests)`,** in `src/server/launchers/helpers.ts`, changes `provider.url` and `provider.digest`, removes `provider.daemon`, and returns a profile `parseStudyProfile` admits unchanged. It refuses a profile with no provider.
- **`buildStudySelectors(selection)`** renders `--trial`, `--goals`, and `--seed` for both `StudyLauncher` and `rehearse`.
- **`STUDY_INSTALL_ENTRY`**, in `constants.ts`, is the installed Study package's built executable, as a path relative to the install root.
- **`rehearse(options): Promise<StudyRehearsal>`** is a method of `StudyInstall`, because it composes the sibling `execute`.
  - `StudyRehearsalOptions { study, profile, directory, selection? }`. `directory` is absent and on the install's volume. `selection` is `Pick<StudyExecutionRequest, 'trial' | 'goals' | 'seed'>`.
  - It runs, in order:
    1. freeze the declaration to `<directory>/closure`;
    2. check through the closure with the selection;
    3. execute through the closure to `<directory>/result`;
    4. read the result;
    5. grade with the closure's own entry and relocated rubric;
    6. report with the assessment that grade's JSON names.
  - Each step runs only when the step before it exited 0. A skipped step reads `undefined`.
  - `StudyRehearsal { closure: StudyInstall, freeze, check, execute, result, grade, report }`.
  - The execute deadline derives from the profile's `bounds.series.duration` plus `STUDY_LAUNCH_CLEANUP` and `STUDY_LAUNCH_DURATION`, so there is no duration option. There is no progress callback either: `study progress <directory>/result` reads a live run.
  - Ruled for a method over a free `rehearseStudy`, which would construct a class from a function kind file (`.claude/rules/architecture.md` § Kind purity), and over a one-shot `StudyRehearsal` class whose only method runs once.
- **Consumers.**
  - Study's own command tests.
  - Agent's one install proof per kept bundle inside `test:studies`.
  - The on-demand full-schedule rehearsal and the pre-run rehearsal, as one call from a Node TypeScript script outside every chain.

## Study's smaller additions and refusals

| Candidate | Ruling | Reason |
| --- | --- | --- |
| `collectStudyRows(target, event?)` in `src/server/adapters/helpers.ts` | In | Returns `{ row, evidence }` pairs with a zero-based `row` that `buildStudyReference` renders one-based. Its test asserts `#1` for row 0 through `gradeStudyEvidence`, with taverna's `index + 1` as the control. `collect*` rather than `filter*`, because it returns new pairs, not members |
| `computeStudyQuantile(values, quantile)` in `src/core/helpers.ts` | In | Linear interpolation between closest ranks, which equals desk's median. Chat's floor-rank quantile changes under it; that change is recorded as a setup difference in the U7c comparison. U6 reads memory's method before adopting |
| `createStudyContext` | Deferred | The engine builds control and series scope, trial scope, and goal scope with meter at three lifetimes (`StudySeries.ts:55-56`, `StudyTrialLease.ts:73`, `StudySeries.ts:212-213`). A flat factory would be a second assembly |
| `readStudyObservation`, `buildStudyVerdict` | Refused | A one-line `find` and a literal; which observations count as gradable is consumer policy |
| `validateStudyTreatment` | Refused | `parseStudyProfile` already refuses an unpaired judge. What remains is arm-keyed presence policy, which belongs to Agent |
| `buildStudyOllamaRole` | Refused | A positional builder renames a policy literal |
