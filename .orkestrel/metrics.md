# Measurements after strict qualification

This cross-package follow-up does not block the current series repair. Ship exact request
components and refused-admission evidence first. Keep host measurements outside model context.
Recovery and model-visible metadata require separate frozen treatments; neither is enabled in
the strict primary comparison.

## Decisions the measurements must support

| Decision | Evidence | Interpretation |
| --- | --- | --- |
| Does the strategy complete useful work? | Full declared criterion population, achieved/unsuccessful/unknown, critical violations, grading coverage | Study score lower/upper bounds describe unresolved grading, not statistical confidence. |
| Where does execution stop? | First attempted failure, admission refusal, attempted goals, subsequent unexecuted goals, partial products | Preserve strict failure and distinguish its cascade from additional independent failures. |
| What consumes context? | Disjoint heuristic message fields, advertised tools/schema, known origins, actual prompt totals, request revision | Origins annotate components; they are not another additive partition. Unknown origins remain explicit. |
| What consumes time and usage? | End-to-end wall time, role timings, provider load/prefill/decode, calls, known tokens/bytes and unknown counts | Nested or overlapping durations cannot be added as wall time. Unknown usage is not zero. |
| Did an optimization help? | Paired complete runs under pinned identities; critical path and quality alongside component changes | Follow the accepted performance protocol. A faster component is not automatically a whole-run improvement. |

## Verified report limitations to repair before interpreting aggregate operations

The Haiku exact map (session bc140989-6ea8-43aa-a6cd-877142b2c89f, 120092 ms, exit 0)
identified these paths; root checked the current implementation directly:

- `src/server/commands/helpers.ts` labels every observation without a product `unexecuted`.
  An attempted goal can fail without producing a product, so that label overstates unexecuted work.
- The same report counts copied terminal failure causes across remaining goals and trials.
  These are affected observations, not independent failure events.
- `src/core/engines/StudySeries.ts` currently represents unexecuted goals with empty usage,
  zero duration and a prefixed failure message. Add an explicit execution fact at its owner
  before exposing an attempted/unexecuted metric; do not infer it from timing or message text.
- `src/core/helpers.ts` derives score lower/upper from unknown outcomes. Keep that distinction
  explicit when reporting a single repetition.
- Agent's `studies/memory/helpers.ts` requires an entirely successful attempt for every
  per-goal operational judgment. The 2026-10-15 Compaction diagnostic therefore reports96
  unsuccessful criteria despite21 completed goals and one real attempted failure. This is the
  consumer grader's whole-attempt policy, separate from Study's affected-observation counts.
  Give per-goal completion and whole-trajectory qualification distinct meanings before changing
  that grading surface; preserve existing grading identities.

Preserve old sealed artifacts. Decide the versioned observation contract and its persistence
before changing reporting. These findings do not change the raw candidate-3 result: Records
completed 96 goals; Compaction failed on attempted goal 64, leaving 32 goals unexecuted.

## Optional model context

Agent already supports named instructions, instruction scope and a render callback. Use those
seams before proposing another public context surface. Rendering occurs when context is built,
not necessarily every tool turn; a remaining-budget value can become stale.

An experiment must specify task date versus host date, units, source, freshness, budget scope,
reserved versus actual usage, and absence. A heuristic window estimate is not exact remaining
token capacity. Metadata itself consumes context and changes the request identity. Never expose
private rubric, oracle, grading outcomes or evaluation status. Do not manufacture precision or
an accuracy benefit. Default visibility remains off.

The research motivates a bounded ablation, not an implementation prerequisite:
[AI Agents That Matter](https://arxiv.org/abs/2407.01502) supports evaluating cost with quality
and protecting held-out evidence; [Token-Budget-Aware LLM Reasoning](https://arxiv.org/abs/2412.18547)
shows that explicit reasoning budgets can change efficiency and accuracy in its tested settings.
Neither establishes a benefit for this Qwen agent workload. Select only measurements tied to a
decision, with a defined denominator, missing-data rule and collection cost.
