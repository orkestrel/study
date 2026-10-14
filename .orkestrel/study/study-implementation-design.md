# Study implementation design

## Recommendation
Build the study engine fresh in the agent checkout. Do not port the campaign instrument, and do not call it as an external instrument. Keep the existing comparison by importing its evidence once, after the series finishes, into the study evidence format, with the legacy instrument identity attached. After that import, nothing reads the campaign tree. The first real consumers are:

- **`protocol`**: a mechanism study with a scripted provider. It runs on CPU today, against the built `dist`.
- **`capacity`**: the imported legacy result plus a fresh qualification study.
- **`memory`**: the paid comparison. `check` runs offline now. `execute` waits until the live series releases the GPU.

## Contract sketch (`studies/types.ts`)
```ts
export interface StudyDefinition {
	readonly name: string; readonly version: string; readonly question: string
	readonly provider: 'model' | 'scripted' | 'none'
	readonly arms: readonly Arm[]; readonly scenarios: readonly string[]
	readonly bounds: StudyBounds; readonly retry: RetryPolicy
	readonly qualification?: string // a study name; for memory this is 'capacity'
	readonly criteria: readonly Criterion[]
}
export interface Limit { readonly duration: number; readonly requests?: number; readonly tokens?: number }
export interface StudyBounds { readonly goal?: Limit; readonly trial: Limit; readonly series: Limit }
export interface RetryPolicy { readonly attempts: number; readonly budget: number } // fixed at execution start
export interface Subject { readonly origin: 'dist' | 'tarball' | 'vendor'; readonly path: string; readonly digest: string; readonly version: string }
export interface Instrument { readonly origin: 'studies' | 'legacy'; readonly digest: string }
export interface Manifest {
	readonly id: string; readonly definition: string; readonly subject: Subject
	readonly instrument: Instrument; readonly qualification?: string // a result id
	readonly profile: string; readonly host: HostRecord
	readonly planned: number; readonly attempts: readonly Attempt[]
}
export interface Attempt { readonly trial: string; readonly arm: string; readonly scenario: string; readonly ordinal: number; readonly ending: 'complete' | 'deadline' | 'fault'; readonly evidence: string; readonly cost: Cost }
export interface DriverInterface { execute(input: TrialInput, signal: AbortSignal): Promise<TrialEvidence> }
export interface GraderInterface { readonly version: string; judge(evidence: TrialEvidence): readonly Judgment[] }
export interface Judgment { readonly criterion: string; readonly verdict: 'pass' | 'fail' | 'unknown'; readonly method: 'predicate' | 'human' | 'model' }
```

All studies share one engine: definition, manifest, series bounds, results, gradings and report. Studies differ only in their `DriverInterface` and `GraderInterface` and in the `provider` label. Evidence is state plus a trace of events, not generated text, so a protocol study does not have to look like a text-generation study.

## Ownership and wiring
| Path | Holds |
|---|---|
| `studies/{types,constants,errors,validators,parsers,helpers}.ts` | Contract and pure leaves: canonical JSON, SHA-256 through `node:crypto`, aggregation |
| `studies/series/Series.ts` | Schedules trials, enforces bounds, records attempts |
| `studies/stores/Results.ts` | Writes once with exclusive create (`wx`) and verifies digests on read |
| `studies/drivers/{Protocol,Memory}.ts`, `studies/graders/{Protocol,Memory,Capacity}.ts` | One class per file |
| `studies/migrations/Capacity.ts` | The legacy importer (`execute`) |
| `studies/study.ts` | Fixed entry for `check`, `execute`, `grade` and `report`. It declares nothing at module scope. |
| `studies/<name>/` | Data only: `study.json`, `scenarios/`, `results/<id>/{manifest.json,trials/,raw/<sha256>,grades/<digest>/}` |
| `tools/artifacts/subject.ts` | The only computed import. It loads the chosen `dist` or tarball file by absolute URL and returns `Subject` plus a guarded export record. |
| `configs/studies/{vite.config.ts,tsconfig.json}` | Thin wrapper over the root config: one Node project over `tests/studies/**`, and a scope with `lib` ESNext and `types` node |
| `package.json` (shared; returned as a patch) | `study: node studies/study.ts`, `test:studies`, `check:studies` |

Study code uses `import type` from `@orkestrel/agent` only for typechecking. Runtime values come only through `subject.ts`. The bare package specifier never runs inside `studies/`, so measuring `dist` cannot quietly turn into testing source through the alias.

## Execution and grading bounds
- **Bounds.** `Series` combines `AbortSignal.timeout` for each goal, trial and series limit with a recording `fetch`. That `fetch` counts requests and tokens, aborts when a cap is reached, and refuses any origin other than the one the run declares.
- **Default policy.** Zero retries, matching the successor profile.
- **Outcomes.** An ordinary unsuccessful goal is a measured outcome. A trial that reaches its limit ends as `deadline` and the series continues. An operational fault ends as `fault` and stops the series.
- **Incomplete results.** Incompleteness is derived from `attempts.length` being below `planned`; no flag is stored.
- **Retries.** Each retry is a new `Attempt` with its own ordinal. The retry budget is aggregate across the series and never resets.
- **Grading.** `grade` runs predicate graders only. A criterion that needs interpretation produces `unknown` with method `human` or `model`, and its product stays in the trial evidence for a separate, bounded grading. That grading later lands as a new grading version.
- **Grading identity.** The grading directory digest is the hash of grader version, grader source digest and result manifest digest. Grading again with the same grader re-verifies that directory and never rewrites it.

## Evidence and uncertainty
- **Immutability.** Results are write-once. Every trial and raw file is content-addressed and listed in the manifest. `report` refuses any digest mismatch.
- **Headline.** Whole-scenario achievement is reported as an interval from `pass/N` to `(pass+unknown)/N`. Coverage is `(pass+fail)/N`. The pass, fail and unknown counts are always printed.
- **Report sections.** Capacity, infrastructure, grading and task outcomes appear separately. Comparisons restricted to served goals are secondary.
- **No pooling.** `report` refuses to pool results whose `instrument.origin` or `subject.digest` differ.
- **Qualification binding.** `memory execute` refuses to start unless its referenced `capacity` result binds the same subject digest, instrument digest and profile. The legacy qualification therefore cannot vouch for altered code.
- **Scripted providers.** A study marked `provider: 'scripted'` cannot declare a criterion of category `quality`. Its report header says it measures mechanism only.

## Units and order
1. **U0, seam.** Covers the `configs/studies/*` files and the `package.json` patch. Prove it with `test:policy`, `test:config` and `check:studies`.
2. **U1, contract.** `types.ts`, `constants.ts`, `errors.ts`. Can run alongside U0.
3. **U2, leaves.** `validators.ts`, `parsers.ts`, `helpers.ts`, with tests.
4. **U4, subject loader.** `tools/artifacts/subject.ts`, with tests. Can run alongside U2.
5. **U3.** `Results` and `Series`, with tests using temporary directories and short real timers.
6. **U5, protocol consumer.** `drivers/Protocol`, `graders/Protocol`, and `studies/protocol/*`.
7. **U6, memory and capacity.** Their drivers, graders and definitions, plus scenarios copied from the frozen campaign inputs. Tested against an Ollama fixture server that follows the real wire protocol on `127.0.0.1` with port `0`. Can run alongside U5.
8. **U8, entry.** `studies/study.ts`.
9. **U7, legacy import.** Runs after the live series ends and needs U2 and U3. Reads a temporary copy of the campaign, never the originals.
10. **U9.** `studies/map.md`, describing how sibling packages would adopt this.

Root runs the build that writes root `dist` only when no other writer or consumer is using it.

## Acceptance controls (each must fail when its load-bearing line is disabled)
1. **Protocol end to end.** `check`, `execute`, `grade` and `report` complete on CPU only. A scripted study that declares a `quality` criterion makes `check` exit non-zero.
2. **Write-once.** A second write to a trial throws. Flipping one byte makes `report` refuse.
3. **Unknown stays visible.** A grader that returns only `unknown` gives coverage 0 and interval 0–1, and no criterion is reported as failed.
4. **Bounds.**
   - A fixture that stalls yields `deadline`, and the series continues.
   - A fixture HTTP 500 yields `fault` and stops the series, and the report shows planned versus attempted counts.
   - Going over the request cap aborts the trial.
5. **Isolation.** A request to `127.0.0.1:11434` or `11435` is refused before any connection opens.
6. **Subject.** The loader refuses any path under `src/`. Changing one `dist` byte changes `subject.digest`.
7. **Legacy independence.** Import from a temporary copy and then delete the copy. `grade` and `report` still succeed. Pooling the legacy result with a fresh one is refused.
8. **Qualification.** `memory execute` bound to the legacy capacity result is refused.
9. **Grade versioning.** Grading twice with the same grader produces the same digest and an unchanged directory. A new grader version produces a new directory and leaves the result unchanged.

## Strongest counterexample and its correction
**Counterexample.** The legacy capacity records use absolute manifest paths, vendor hashes and formats defined by the older harness modules. If grading or report has to reopen those records through campaign code or campaign paths, the capacity study stays a facade that depends on the campaign forever. The same happens if `Capacity` grading calls into the vendored harness to stay faithful.

**Correction.**
- U7 translates each legacy record once into `TrialEvidence`.
- The original bytes are kept content-addressed under `raw/`. The translation is recorded with its own version and digest.
- The manifest binds `instrument.origin: 'legacy'` with the campaign harness and vendor hashes as provenance only.
- `graders/Capacity` reads only study-format evidence.
- Control 7 proves this: the import must work with the campaign copy removed.
- Translation code is fresh. It is written against the recorded format and does not copy harness modules.

## Named checks (unresolved; these are not permission to explore)
- **C1, test seam.** Expected: a Vitest project for `tests/studies/**`. Found: the scaffold-owned `vite.config.ts` cannot be edited locally. Proposed resolution: the U0 wrapper at `configs/studies/`. If the policy sweep rejects that wrapper or the top-level `studies/` folder, U0 stops with expected, found and the evidence, and root decides.
- **C2.** The relative-import extension convention required by Node type stripping under the root `tsconfig.json`.
- **C3.** Whether `@orkestrel/ollama` is a declared dependency of agent, and whether the current public API accepts an injected `fetch` for recording. If it does not, U6 stops; no dependency is added.
- **C4.** Whether the legacy raw record format is fully represented in the frozen inputs.
- **C5.** The git custody of `raw/`: whether it is ignored and what size limit applies. Changing ignore rules may itself be a scaffold-owned edit.
- **C6.** The workflow for the root `dist` build.

## Exclusions
- MCP client and provider validation: not yet measured, because it needs a running service or an undeclared dependency.
- Rollout to sibling packages: the U9 map only.
- Running model or human semantic grading.
- Independent repeats and counterbalancing.
- Archiving or retiring the campaign.
- Any GPU execution before the series ends.
- A `bin` entry, publication or a version bump.

## Deviation report
- **Expected:** the brief says Node scripts use native modules only. **Found:** the drivers need the agent subject at runtime. **Evidence:** `facts.md` limits caller-selected computed imports to `tools/artifacts`. **Resolution:** load the subject only through `tools/artifacts/subject.ts`.