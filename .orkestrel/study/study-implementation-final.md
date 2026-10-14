**Final implementation plan: studies on the canonical app route**

**Decision.** Build a fresh prospective consumer of the built agent package. Runtime lives in the unpublished app environments, declarations and results live under `studies/`, and a native launcher drives a built app entry. No campaign code is ported or invoked. The route is Astra's wiring with Opus's engine shape and evidence rules. Opus's `configs/studies/` wrapper is rejected because the workspace law permits only `configs/src/`, `configs/app/`, and the three named leaves. Runtime under `studies/` scripts is rejected because scripts are `node:`-only and would force reimplementing budget, timeout, and abort that agent already declares.

## Route and wiring proof

- **Placement.** Host-free contract and engine in `app/core/studies/`. Node orchestration, stores, drivers, graders, and the scripted provider in `app/server/studies/`. Caller-selected loading in `tools/artifacts/`. Data only under `studies/<name>/`. Launcher `studies/study.ts` uses `node:` modules and relative imports, spawns `node dist/app/server/main.cjs <operation> …` under a recorded process id and a cap of series limit plus grace, and kills the recorded tree on overrun.
- **Configuration proof (U0, before any source).** In a scratch copy under `tmp/`, create empty `app/core/index.ts` and `app/server/main.ts`, add an authored `study` script, run the installed scaffold audit and repair, and diff the generated root config, `tsconfig.json`, `package.json`, and `configs/app/*`. Expected: `app:core` and `app:server` test projects, `check:app`, the app server build target, and the authored script preserved. Found: unknown until run. Evidence: scaffold guide lines 661 and 757 as root verified. Pass means root applies the same repair to the live checkout and `npm run test:config`, `test:policy`, and `check:app` go green. Fail means stop with expected, found, and diff; nothing is hand-edited.
- **Subject identity.** `tools/artifacts/subject.ts` computed-imports an absolute `dist/src/core/index.js` URL, refuses any path under `src/`, and returns the module plus entry digest. `tools/artifacts/resolution.ts` is a `node:module` resolve hook passed to the child by `--import`; it logs every resolved file URL, and the sealed closure is the sorted list of specifier, URL, and digest for the subject, the provider artifact, and the instrument. The instrument identity is the digest of the built entry plus its closure. A closure that differs from a qualification's closure refuses before dispatch.
- **Build.** Root builds once under exclusive ownership before the first `execute`. Freshness of `dist/src` is a scheduling fact root records, not an instrument claim.

## Contract and operations

```ts
// app/core/studies/types.ts (sketch)
interface StudyDefinition { readonly name; readonly version; readonly question
  readonly provider: 'scripted' | 'model'; readonly arms: readonly Arm[]
  readonly scenarios: readonly string[]; readonly order: readonly (readonly string[])[] // one row per repetition
  readonly bounds: StudyBounds; readonly retries: 0; readonly rubric: string
  readonly qualification?: string }
interface Limit { readonly duration: number; readonly requests?: number; readonly tokens?: number; readonly bytes?: number }
interface StudyBounds { readonly goal: Limit; readonly trial: Limit; readonly series: Limit }
interface Subject { readonly entry: string; readonly digest: string; readonly closure: readonly Resolution[] }
interface Manifest { readonly id; readonly definition: string; readonly subject: Subject; readonly provider: Subject | undefined
  readonly instrument: Subject; readonly fixtures: string; readonly profile: string; readonly schedule: readonly TrialKey[]
  readonly qualification?: string; readonly host: HostRecord }
interface TrialKey { readonly scenario: string; readonly arm: string; readonly repetition: number }
interface Attempt { readonly key: TrialKey; readonly ordinal: number; readonly ending: 'complete' | 'deadline' | 'fault'
  readonly goals: readonly GoalRecord[]; readonly usage: readonly RoleUsage[]; readonly evidence: readonly string[] }
interface GoalRecord { readonly goal: string; readonly served: boolean; readonly cause?: 'deadline' | 'fault' | 'interrupted' | 'unexecuted' }
interface DriverInterface { execute(trial: TrialContext): Promise<TrialProduct> }
interface GraderInterface { readonly name; readonly version; judge(evidence: SealedEvidence): readonly Judgment[] }
interface Judgment { readonly criterion; readonly verdict: 'achieved' | 'unsuccessful' | 'unknown'
  readonly method: 'state' | 'trace' | 'human' | 'model'; readonly reason; readonly reference }
```

Repetitions derive from `order.length`; no flag is stored. `TrialContext` carries the key, the abort signal, a budget claim boundary over goal, trial, and series allowances built on the declared budget, timeout, and abort packages, and an append-only evidence sink. A product carries artifact references and termination, never success.

Operations, all through `npm run study -- <operation>`:

| Operation | Network | Writes |
|---|---|---|
| `check <study> --profile <p>` | none | nothing; loads subject and provider in a fresh child and verifies closure, fixtures, rubric, qualification |
| `execute <study> --profile <p>` | declared host only | `results/<id>/` with exclusive create, per-trial append, terminal `attempt.json`, final `seal.json` |
| `grade <result>` | none | `grades/<id>/` from state and trace predicates; semantic criteria become `unknown` and emit a blind packet |
| `label <result> --grading <id> --labels <file>` | none | a new grading from a schema-checked labels file carrying labeler or engine identity |
| `report <result> [--grading <id>]` | none | rendered report; refuses digest mismatch or unsealed results |

Rules the engine enforces:

- **Bounds and endings.** Zero retries. A goal past its deadline is unserved with cause `deadline` and the trial continues. A trial past its limit ends `deadline`, remaining goals unserved, series continues. An operational fault (connection failure, 5xx, loader failure, budget exhaustion) ends the trial `fault` and stops the series; later trials are `unexecuted`. Memory and capacity profiles fail fast because the first real request is the probe.
- **Incompleteness from seal.** A result is complete only with `seal.json` over every byte. A trial directory without a terminal record is `interrupted`. Count comparison is never the test.
- **Grading identity.** A grading id is the digest of its `grading.json`, which binds seal digest, rubric digest, grader name and version, instrument digest, attempt set, and for `human` or `model` the labels bytes, identity, usage, and creation time. Predicate regrading is idempotent and refuses rewrite; stochastic gradings get distinct ids.
- **Reporting.** Denominator is the declared horizon. Confirmed achievement is `achieved/N`; the possible interval ends at `(achieved+unknown)/N`; coverage is `(achieved+unsuccessful)/N`; unserved goals are listed by cause. Capacity, infrastructure, grading, and task outcomes appear in separate sections. Common-served comparison is secondary. A single trajectory is labeled descriptive. Pooling refuses results with differing subject, provider, or instrument closures.
- **Qualification.** `execute memory --profile gpu` refuses unless a sealed, fault-free capacity result binds the same subject, provider, instrument, fixtures, and profile digests. The legacy c1 series cannot match by construction.

## Consumers, units, acceptance

**First consumers, all complete.**

- **tools (CPU now).** `providers/Scripted.ts` implements agent's provider contract with inert declared responses. `drivers/Tools.ts` loads the built agent, registers real `@orkestrel/tool` tools over a temporary directory, and runs scenarios for admission, permitted write, refusal, cancellation, and continuation from a prior tool result. `graders/Tools.ts` checks file bytes and tool call order and outcomes. A `quality` criterion in a scripted study fails `check`. The header says mechanism only.
- **memory (implement now, paid validation deferred).** Arms are agent's declared memory strategies. The provider is a caller-selected built `@orkestrel/ollama` artifact named in the profile and loaded through `tools/artifacts`, closure recorded, no dependency added. Scenarios are copied from the frozen inputs with source digests. `graders/Memory.ts` runs exact fact, obligation, and violation predicates and leaves semantic criteria `unknown` with a blind packet. The `local` profile runs on CPU against a protocol-faithful Ollama fixture in `tests/setupOllama.ts` and is labeled mechanism evidence. The `gpu` profile is implemented and refused until root records isolation.
- **capacity.** Same driver over declared cells with the successor profile; `graders/Capacity.ts` holds operational predicates only. A fresh qualification runs after the live series ends.

**Units in dependency order, disjoint files.**

1. U0 wiring proof: scratch audit; returns the repair diff and `package.json` patch.
2. U1 contract: `app/core/studies/{types,constants,errors,index}.ts`, barrel row in `app/core/index.ts`.
3. U2 core leaves (parallel with U4): `app/core/studies/{validators,parsers,helpers}.ts`, canonical JSON, WebCrypto digest, schedule and interval derivation; tests under `tests/app/core/studies/`.
4. U4 artifacts: `tools/artifacts/{subject,resolution}.ts`; proof spawns a child against a temporary dist copy.
5. U3 engine: `app/core/studies/engines/Series.ts`, `app/core/studies/reports/Report.ts`; tests with short real timers.
6. U5 server shell: `app/server/studies/{types,index}.ts`, `stores/Results.ts`, `stores/Gradings.ts`, `app/server/main.ts`; tests with temporary directories.
7. U6 tools consumer (parallel with U7): driver, scripted provider, grader, `studies/tools/{study.json,rubric.json,profiles/,scenarios/}`.
8. U7 memory and capacity: drivers, graders, `tests/setupOllama.ts` plus its proof, `studies/memory/*`, `studies/capacity/*`.
9. U8 launcher: `studies/study.ts`, `studies/map.md` sibling mapping.
10. Root: apply repair, build under exclusive ownership, run `check`, `execute tools --profile local`, `grade`, `report`, commit the result as evidence, one independent review, verifier tree-wide gates.

**Falsifiable acceptance claims.** Each must fail when its load-bearing line is disabled.

1. Tools study completes `check`, `execute`, `grade`, `report` on CPU from the committed result.
2. A subject copy with one changed exported byte yields a different recorded digest and the changed value at runtime, proving execution from the artifact and not an inlined alias.
3. A subject path under `src/` is refused; a closure differing from a qualification's refuses before dispatch.
4. A second write to a sealed trial throws; one flipped byte makes `report` refuse; killing the child mid-trial leaves no seal and reports `interrupted`.
5. Stalled fixture yields `deadline` and the series continues; fixture 500 yields `fault`, stops the series, and later trials show `unexecuted`; a request past the cap aborts the trial.
6. `check`, `grade`, `label`, and `report` open no socket, observed by a listener on the declared host receiving nothing.
7. All-`unknown` grading gives coverage 0 and interval 0 to 1 with no criterion marked unsuccessful.
8. Predicate regrading reproduces the same id; a labels file produces a new id and leaves the result untouched; a labels file missing identity is refused.
9. `execute memory --profile gpu` is refused without a matching capacity result and with the legacy series present.
10. The tools study with a `quality` criterion fails `check`.

**Implementation checks, not research.** K1 repair output in scratch. K2 the resolve hook form under type stripping. K3 agent's provider contract shape, whether memory strategies map to record, compact, and full arms, and whether the Ollama provider accepts a `host` and `fetch` option; without `fetch`, request caps come from usage events and the limitation is reported. K4 whether a built Ollama artifact exists locally and whether its closure loads a second agent copy, which `check` refuses. K5 the app bundle keeps the computed import computed. K6 git custody and size policy for result bytes. K7 frozen scenario inputs' format.

**Exclusions.** Legacy import, archive, and retirement wait until the series and Sol labeling close; c1 stays readable under its frozen protocol. No model or human grading executes inside the instrument. No MCP or foreign-client claims. No dependency, version bump, bin, or publication. No GPU request before isolation.