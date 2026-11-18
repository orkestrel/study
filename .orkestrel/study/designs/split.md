# Split: records and compaction as separate studies in Agent

## Current set (2026-11-18)

The user's rulings of 2026-11-18 superseded the split below: records is Agent's one native memory strategy, so compaction, its four declarations, its profiles, and the 2B left the studies and Agent itself. The four records declarations then returned to the plain names before any baseline recorded under them (agent `71d0105a`).

| Declaration | Kind | Arms | Workload | Profile |
| --- | --- | --- | --- | --- |
| `memory` | quality | `[records, full]`, `[full, records]` | handoff | `local` |
| `capacity` | capacity | as `memory` | handoff | `local` |
| `endurance` | quality | `[records]` | endurance | `recommended` |
| `qualification` | capacity | `[records]` | endurance | `recommended` |

- Each rubric moved whole, and its digest equals its `2a7c4e9f` pin under the new name.
- Each capacity and quality pair runs from one frozen closure, because Study's qualification gate compares whole identity, the root included.
- The adapter still refuses a declaration with only `full`.
- The install proof runs `capacity`, then keyed `memory`, through Study's `StudyInstall`.

The rest of this file is the 2026-11-17 design, kept as written.

## The 2026-11-17 split

This design was reconciled on 2026-11-17 from the campaign's design round, under the user's 2026-11-17 ruling: compaction stays, and records and compaction run as separate executions, only when requested, that can't run together by mistake.

### Declarations

- **One strategy per declaration,** with the strategy word first, so that every study of one strategy lists together:

  | Declaration | Purpose | Arms and order | Scenario |
  | --- | --- | --- | --- |
  | `recordsmemory` | quality | `[records, full]`, `[full, records]` | handoff |
  | `recordscapacity` | capacity | as `recordsmemory` | handoff |
  | `compactionmemory` | quality | `[compaction, full]`, `[full, compaction]` | handoff |
  | `compactioncapacity` | capacity | as `compactionmemory` | handoff |
  | `recordsendurance` | quality | `[records]` | endurance |
  | `recordsqualification` | capacity | `[records]` | endurance |
  | `compactionendurance` | quality | `[compaction]` | endurance |
  | `compactionqualification` | capacity | `[compaction]` | endurance |

- **Names.** Each name joins two words because Study's name pattern admits no separator that `.claude/rules/names.md` § Files and folders permits in a tracked folder name (no hyphen). The design round weighed single dictionary words and ruled them out as unpredictable.
- **Rubrics.** Each declaration's `rubric.json` is a byte copy of its predecessor's, because criteria key on scenario and goal, never on arm (`study/src/core/types.ts`, `StudyCriterion`). Nobody opens a rubric's criteria to make the copy.
- **Removed.** `studies/memory/study.json`, `studies/capacity/`, `studies/endurance/study.json` and its `rubric.json`, and `studies/qualification/` go, with no alias. `studies/endurance/sources/` stays where it is, unopened.
- **Earlier results.** Results recorded under the earlier declarations stay untouched until the U7c comparison rules on them.

### Control arm

- **`full` sits beside each handoff strategy,** so each comparison stays inside one sealed result and one counterbalanced order. `full` is recorded once per requested strategy.
- **Endurance carries no control,** as before. A records-against-compaction reading on endurance is arithmetic across two reports, run only when the user asks.

### Qualification gate

- **One profile per strategy.** Each capacity and quality pair runs under one profile's bytes, because the capacity manifest's identity binds the profile digest (probe U1, 2026-11-17).
- **Each strategy profile names exactly the capacity result its quality twin pairs with.** Where one workload's twins share a profile slot with the other workload's, they run serially, as before.
- **The profile set derives from Agent's real use of `local`, `recommended`, and `smallest`.** `narrow` is retired. Name each profile strategy first (`recordsrecommended`, `compactionsmallest`).
- **A test asserts** that each pair's two profiles agree canonically on every member except `qualification`.
- **Ruled against** moving qualification onto the definition. It would be a Study contract change with one consumer, and Study's own gate already refuses a cross-strategy pairing: `identity.fixtures` binds arms and order.

### Keyed replay

- **Each quality twin replays its own capacity twin offline:**

  ```text
  study execute recordsmemory --profile <records profile> --replay <capacity result> --roles <roles> --offline true
  ```

- **Roles.** Derive the role list as the union of `Object.keys(buildStudyMemoryRoles(profile, arm))` over the declaration's arms, plus `metadata`. Never type it by hand.
- **Probe U1 read yes** for this path. Its fallback is `study grade <capacity result> --rubric studies/<quality>/rubric.json`, which needs no feature.

### Refusal

- **`validateStudyMemoryStrategy(name, arms)`** in `studies/memory/helpers.ts`, called from `StudyMemoryAdapter.validate` right after the arm filter. That door runs inside every check and execute before any subject module loads, so no run starts without passing it.
- **It throws `StudyError` code `CONFIG`** with the declaration name JSON-encoded and capped:

  ```text
  Memory declaration "<name>" lists both strategies in arms ["records","compaction"]; list one of records or compaction, with full as the only other arm, and run the other strategy as its own study
  ```

- **Tests:**
  - a table over strategy combinations in the helper's test;
  - an adapter case where records with compaction refuses and records with full passes, with removing the call turning the refusal case red;
  - a census in `tests/studies/memory/study.test.ts` that admits every memory-driver `study.json` through the real adapter. It asserts membership equal to the eight names, sibling rubrics byte-equal, and twin profiles in agreement.

### Tests that move

- **`tests/studies/capacity/study.test.ts`** goes. Its pairing and refusal cases fold into the census as a table over the four pairs, and its offline adapter cases join `StudyMemoryAdapter.test.ts`.
- **`tests/studies/endurance/study.test.ts`** keeps its workload pins once, and its schedule case joins the pair table.
- **`tests/studies/memory/integration.test.ts`:**
  - splits so that no file holds more than one install proof;
  - freezes once per bundle;
  - deletes each proof Study's own tests already hold (`--seed`, `--extend`, owned-daemon replay), naming the Study test that holds each;
  - sends any claim Study lacks to the Orchestrator for U5, and adds no Study test.
- **The bundle's one install proof** runs on `recordscapacity`, then keyed `recordsmemory`, from U6 on, through Study's `StudyInstall`.
