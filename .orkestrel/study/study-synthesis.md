**Decision:** adopt `study` as the optional comparison surface, owned solely by the `@orkestrel/agent` checkout as unpublished development tooling under a top-level `studies/` folder, driven by one npm script with one operation per invocation. Capacity qualification becomes its own paid study, semantic grading becomes a versioned paid operation, and every result carries a whole-scenario headline denominator. This is a proposal. No file moves, no command exists, and nothing in it claims that records, compaction, or full history wins.

## Name, ownership, vocabulary

`study` survives from all three positions. It is short common English, collides with no inspected guide owner, and avoids the taken words `evaluate`, `test`, `check` as a gate, `bench`, `probe`, `prove`, `journey`, `showcase`, `trace`, `meter`, `audit`, and `log`. Registry and fleet availability were not checked. Nothing is exported, so a later collision costs a folder rename.

The agent checkout is the only owner. The package publishes `dist/src` and `README.md` and has no `bin`, so `studies/` stays out of the tarball without a surface change. Scaffold owns nothing until a second package consumes the surface. A configured sibling path to a scaffold checkout is possible but adds a second checkout to every invocation for no present consumer.

The folder is development tooling, like `tests/`, and is distinct from a campaign record. The c1 campaign under `.orkestrel/agent/` stays a campaign record and retires under the orchestration rules. I do not read "package" as only the tarball to escape the campaign rule.

Each term has one meaning:

- **study**: one declared question, its folder `studies/<study>/`, and its frozen `study.json`.
- **scenario**: one agent-visible workload. The 96-goal trajectory is one scenario. **goal** stays the unit inside it.
- **arm**: one strategy configuration: `records`, `compaction`, `full`, and `null`.
- **trial**: one arm's complete trajectory on one scenario from a clean world and fresh arm memory. This matches the existing `TrialConfig` meaning.
- **attempt**: the ordinal of a trial pair re-executed after an infrastructure void. Request retries are recorded inside a trial, never as attempts.
- **result**: the evidence from one execution, `results/<id>/`. Every execution creates a new id and never appends. This replaces "trial-set"; `series` stays an internal scheduler word.
- **grading**: one grader version's verdicts over one result, `grades/<grader-digest>/`.
- **oracle**: grader-only truth. **subject**: the measured artifact, labeled `vendor`, `tarball`, or `workspace`.
- **profile**: model plus context, output, safety, and time budgets.

## Command flow and layout (proposed)

```text
npm run study -- check memory                        # no model calls
npm run study -- execute capacity --profile local    # paid qualification, own limits
npm run study -- execute memory --profile local      # refuses without a passing capacity result
npm run study -- grade <result>                      # paid blind grading, prints judge limits
npm run study -- report <result> --grade <digest>    # reads only, no model calls

studies/
  study.ts                                  entry; one operation per invocation
  memory/study.json   capacity/study.json   arms, profiles, limits, repeats, predicates, digests
  memory/scenarios/                         agent-visible workload
  memory/oracle/                            visible development truth; grader-only
  memory/results/<id>/manifest.json         subject, scenario, grader digests; host load
  memory/results/<id>/trials/               digests; raw bytes in external storage
  memory/results/<id>/grades/<digest>/      report.json, report.md
```

`check` validates schema, resets, reference solvability, oracle coverage, and the `null` arm, none of which needs a model call. `execute` writes the manifest with the subject digest at start, re-hashes at end, refuses without request, goal, trajectory, and series caps, prints population and limits before spending, and keeps live GPU calls serial. `execute memory` refuses unless a passing `capacity` result exists for the same profile and subject digests. `grade` scores with arm identity hidden and never overwrites an earlier grading. `report` joins labels and reads a named grading. The separate `freeze` phase folds into the manifest `execute` writes.

A trial workspace is a fresh temporary directory holding scenario material only. Trial output is sealed by digest before grading. A held-out oracle lives outside the checkout at an owner-held path, and only its digest enters `study.json`.

## Measurement and reporting contract

Failure classes are frozen in `study.json` before execution.

- **Capacity**, charged to the arm: context overflow, output reservation refusal, or declared budget expiry with no recorded host-fault evidence. Never re-executed to improve the arm.
- **Infrastructure**, voids the trial pair for that scenario: provider or connection error, reset failure, subject digest drift, or recorded host fault. Re-execution is a new attempt and every attempt stays listed.
- **Grader**: judge error or unscored output. It appears as coverage and is re-gradable without a rollout.
- **Outcome**: a wrong, partial, or incomplete answer with normal stops. It is neither capacity nor infrastructure. A configuration is measurable without good semantic performance, and a capacity failure is never erased to improve a quality score.

Denominator rules:

- The headline per arm covers every declared goal. Unserved and capacity-failed goals count as unachieved and carry their cause label.
- Served-only scores are secondary and compare only goals every arm served.
- Facts, downstream work, obligations, critical violations, coverage, blind semantic score, feasibility, and cost remain separate columns. Cost is actual tokens, calls, and elapsed time per role: agent, memory filing, summarization, simulated user, grader.
- A report carries verdicts and coverage, never oracle values.

Repetition rules:

- One trajectory per arm and scenario is a point observation. The report labels its paired differences descriptive and makes no reliability claim.
- When a decision needs consistency, a declared subset repeats. The count is written into `study.json` before execution from pilot dispersion and the paid budget. Success on every repeat and success on at least one repeat are reported separately.
- Repeats counterbalance arm order and record host load per trial. This applies to future executions and is not retrofitted onto c1.

Grading rules:

- Deterministic predicates settle state facts, obligations, and critical violations. Each predicate ships with a negative control.
- `check` fails when `null` passes a goal that requires an action. A `null` pass on a refusal or abstention goal is a coverage finding that requires an evidence check, not an automatic failure.
- A model judge scores only what predicates cannot settle, blind to arm, with randomized order and retained outputs. A human calibration slice is deferred until a rubric is frozen. No fixed agreement floor is adopted.
- The equal context and output envelope is a controlled resource envelope, not equal compute. A cost-matched comparison is a different study.

## Adoption path and custody

1. Record the name decision only. Q2 qualification and its correctness review proceed untouched. Source and build stay frozen.
2. At c1 closure and before `.orkestrel/agent/` retires, copy the ignored raw runs and builds to external artifact storage keyed by recorded digests. The tracked trimmed vendor build and the tracked oracle survive in git history. Frozen manifests are provenance and are never rewritten. A c1 result is replayable only when archived bytes match their digests, otherwise interpretable.
3. Port the harness once into `studies/study.ts` with relative paths. Import curated c1 reports as a result whose manifest names the old layout and the `vendor` subject.
4. Run `check` and `execute capacity` before the first `execute memory`. The port is a new subject and inherits no qualification.
5. Keep the paid study outside the deterministic test gate.

## Reconciliation

Rejected from the original proposal: the dual agent and scaffold ownership with no seam; `check` as the home of capacity qualification; the single `report.json` slot that re-scoring would overwrite; three names for one execution's output.

Rejected from the independent design: an offline `preflight` that also covers the live synthetic qualification, which spends 512 calls; a separate `freeze` phase; reading "package" as the tarball to dodge the campaign rule. Its oracle sealing, fresh trial workspace, `null` arm rules, and no-move custody survive.

Rejected from the review: that only an absolute path or a published executable can bridge two checkouts, since a configured path can; that git history loses every vendored byte, since the trimmed build and oracle are tracked. Its single owner, capacity as a study, versioned paid grading, pair voiding, whole-scenario headline, and host-load recording survive. Its subcommand names are design choices adopted here, not established APIs.

Rejected from all positions: any inference about the Q2 result, and any claim that a strategy succeeds.

## Product decisions versus future checks

Product decisions above: name, single owner, vocabulary, five operations, failure classes, denominators, repetition, grading, custody order.

Future scoped units must settle: a scoped typecheck wrapper and Vitest project so `studies/` TypeScript and predicate tests pass gates with no exclusion; whether the project model admits a new top-level folder beside `src`, `app`, `tests`, and `configs`; how the `tarball` subject records installed integrity and resolved module path; the capacity qualifier's treatment of ordinary partial responses, which an active review owns.

Unresolved boundaries: the ruling that `studies/` is development tooling rather than a campaign artifact needs the user's confirmation; repository visibility is unknown, so the tracked oracle must not be treated as secret or recommended for publication; whether scenarios use a scripted or model user is unknown, so the primary comparison fixes the event schedule; spend limits and held-out set custody remain owner decisions.