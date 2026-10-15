# Records, Agent, and Study performance

For execution state and accepted source, see Agent's
[handoff](../../agent/.orkestrel/agent/handoff.md). The 2026-10-15 22:04 UTC
`compaction-output` qualification uses recap 4096 and the accepted Study extraction at
`422d549`; earlier 2048-room and stopped/running entries in this document are historical.
The measurement gates and conditional candidate decisions remain in force. Records remains
sealed and labeled without replay, and no optimization or speedup is accepted.

## Current implementation and retained reading

Observation is implemented: Agent request components, classifier/cache readings, Ollama
load/prefill/decode timing, request correlation and selected exact inputs. The Study promotion
moves reusable observation and transport accounting out of Agent's consumer. Runtime selection
and shared grading/settlement are integrated at `717dc7b` and `dbce00b`; instrumentation is
integrated at `00269ee` after independent checks (104 core, 233 server and 8 guide tests).
Its first-failure mutation produced 3 failures and restored to 7 passing cases. Integrated
verification passed core/server/bin typechecks, scoped format/lint, 118 core tests, 256
server tests, 23 setup tests, 8 guide tests and an isolated build at `c28acbc`. The real
MCP consumption proof is integrated at `2359ac5`: changed tool results and a remote refusal
traverse the captured Agent worker with their accounting intact. Its independent server gate
passed 257 tests; setup passed 28. Agent's consumer migration passed its 158 service tests
and is integrated. Root accepted the promotion at Study `019f5ce` and Agent `8a9087b` after
the independent audit, the repair controls, the focused MCP review and the host gates; see
[promotion acceptance](promotion.md#acceptance) for the measurements. No version bump or
publication accompanies the acceptance. No speedup is accepted. The Compaction qualification
in Agent's `tmp/studies/compaction-content-3` failed at goal 11 after 10 complete products on
2026-10-15. An empty recap triggered the content guard; 85 goals remained unexecuted. The
261007 ms execute exited 1, uncapped. Its sealed usage records 10604 prompt tokens, 1 completion
token and finish `stop` for the failed summary, not a context or output-limit refusal.
Agent's study adapter request framing is repaired at `7bd2a44` after an Opus decision, real
render-only checks, discriminating regression/mutations and 159 passing service tests. A
separate Compaction-only qualification began at 19:37 UTC in `tmp/studies/compaction-task`,
with the same model, gauge, room, workload, rubric and limits. It stopped at 20:14 UTC after
78 complete products: goal 79 exhausted the 2048-token summary output allowance, leaving 17
goals unexecuted. The 2216817 ms execute exited 1 uncapped; the terminal reader and public
report reject qualification. No performance screen has started. The Records
96/96 result is retained, with no rerun or replay. See [series evidence](series.md).

The rolling Compaction attempt closed 96/96, but qualification rejected 8 empty recaps among
12. The verified retained reading attributes 676819.806 ms to Agent prefill: 25.29% of Agent
request wall and 19.92% of the 3398495 ms attempt. Summary prefill is 601988.864 ms: 85.05%
of summary request wall and 17.71% of attempt wall. Agent and summary loading together took
6487.786 ms, under 1% of attempt wall. These observations prioritize prompt-processing research
over warmup for this run; they do not establish an optimization or qualify a quality baseline.
The empty outputs affect the cost population, and historical host load is not fully known.

The retained context reader joins all 132 request estimates by goal, canonical request ID,
ordinal and revision, then reconciles the disjoint components. Message content accounts for
629105 of 653788 Agent estimate units (96.22%) and 123259 of 125790 summary estimate units
(97.99%). Provider prompt tokens remain separate: 680373 and 126509 respectively. Agent
quarter content shares range from 95.10% to 96.79%, and summary shares from 96.86% to 98.34%.

The origin reader further partitions message content by the capture's recorded positional
annotations. Agent history accounts for 476575 units (75.75% of its content), arrivals for
78990 (12.56%), and prior recaps for 43029 (6.84%). Summary history accounts for 103490
units (83.96%), arrivals for 14704 (11.93%), and prior recaps for 3960 (3.21%). Instructions,
input and tool-result text account for the remainder. No unknown or mixed origin was recorded.
This partition reconciles to message content alone; it is not another additive dimension of
request size and does not independently prove the labels from the message text.

All 132 request joins and the fixed quarter groups reconcile to the earlier component
projection. Changed custody, missing or duplicate context, missing provenance, duplicate
message identity, changed request identity and changed recap identity controls reject with
their expected errors. Strict typechecking and execution passed. See Agent
`tmp/units/rolling-origin-correction-report.md` and `rolling-origin-read-projection-v2.json`.
The readings identify history as a context-reduction research target, not a measured saving.

Changed-custody, missing-component and malformed-component controls were rejected. See Agent
`tmp/units/rolling-context-read-report.md` and `rolling-context-read-projection-v3.json`.
These measurements describe the rejected run. They establish neither causal wall savings
nor task quality, and do not authorize replay of Records. The candidate gates and paired
acceptance threshold in this protocol still apply.

The metadata-only verifier binds the reader, seal, attempt and evidence digests, checks every
Agent request body and snapshot at the fixed checkpoint positions, and passes changed-custody
and missing-timing controls. All 12 positions have their captured inputs. Evidence lives in
Agent `tmp/units/rolling-performance-read-v5-report.md` and its projection. Input presence
does not admit model replay before the qualification prerequisite. The sealed identity is
`3bf2316f53f28af8a49d2894b93d24e2e35804176091892ab80ea485c5719426`.

The quality repair rejects blank recap content before history replacement, retaining the
attempted text and cost with a distinct `content` failure. Study's cause and propagation proof
are integrated at `fa7d1ea`; the Agent guard passed the combined consumer suite. Removing
the guard or recording evidence after refusal each failed the intended empty/whitespace
cases, and restoring the source passed the selected tests.
It changes no prompt or budget and adds no retry. The completed result remains rejected.
Records remains sealed and labeled; no replay is selected. The paired speed and quality
thresholds below remain unchanged.

## Generation and runner attribution, 2026-10-15

History's share of estimated message content is not its share of elapsed time. The rejected
rolling attempt records 102945 Agent completion tokens across 120 requests and
1988482.027 ms of Ollama decode time, 58.51% of attempt wall. Decode is the largest measured
phase in that run. These are backend counters, not time spent executing the Agent package.
Do not infer that Records or summarization is the sole bottleneck from the context partition.

Separate the amount of requested work from the rate at which the runner executes it:

| Owner | Question | Evidence required |
| --- | --- | --- |
| Agent and strategy | Are long responses, repeated turns, or avoidable auxiliary calls increasing total work? | Per-goal call and output-token counts, finish reasons, actual tool/summary turns, and blinded quality. Preserve output room while diagnosing. |
| Ollama provider | Are usage, timing, finish reasons, cancellation, and errors retained correctly? | Terminal wire fields beside the public provider projection; unavailable fields remain unknown. |
| Ollama runner and host | Is generation limited by memory capacity, bandwidth, computation, caching, or contention? | Model placement, context allocation, residency, cached prompt count, phase durations and observed host load correlated with each request. |
| Study and consumer | Are admission, evidence, worker preparation, or grading adding material delay? | Monotonic spans at their own boundaries, with overlapping spans kept separate. Client wall minus backend time remains unattributed until measured. |

The retained daemon log reports 33/33 layers on CUDA0, a 2515.44 MiB CUDA model buffer,
a 497.31 MiB CUDA_Host model buffer, a 640 MiB CUDA KV buffer, a 50.25 MiB recurrent-state
buffer, context 20480, and one slot. It also records backend startup warmup and an enabled
prompt cache. These records establish allocation and configuration for that runner, not the
absence of memory pressure or actual prefix reuse. See Agent
`tmp/codex/compaction-rolling-daemon.err` and `tmp/units/model-residency-read-report.md`.
The host buffer must not be omitted when describing placement; the layer count alone is
not a complete memory profile. No historical GPU bandwidth or competing-work trace exists.

The captured provider sends `keep_alive: '5m'` on normal Agent, summary, and judge requests.
Compaction constructs Agent and summary providers with the same model identity; it does not
construct the Records judge. Session cleanup aborts and closes local resources without an
explicit model-unload call. No explicit preload request occurs in the inspected session.
Backend startup warmup is distinct from application preloading. Model residency is distinct
from prompt-prefix reuse; inspect the documented `prompt_eval_cached_count` field where
present rather than infer reuse from a shared provider or model name. See
[Ollama usage metrics](https://docs.ollama.com/api/usage).

One Ollama daemon can keep several models resident when memory permits. Its per-model
request concurrency is a separate limit; see [Ollama concurrency](https://docs.ollama.com/faq).
The pinned [Ollama 0.40.3 scheduler](https://github.com/ollama/ollama/blob/v0.40.3/server/sched.go#L478-L490)
forces the active Qwen 3.5 architecture to one parallel request slot. Its zero maximum-loaded
setting chooses an automatic model limit, not one model. Adding a daemon supplies no extra
VRAM and is not an admitted performance treatment. Combined model loading consumed under
1% of the rejected Compaction attempt, so preloading alone does not meet this run's candidate gate.

Keep generation allowance at 8192, context at 20480, recap allowance at 2048, and the
prospective finite run bound while observing the successor Compaction attempt. Do not shorten
answers or change the estimator to manufacture a speedup. Diagnose blank recap output as a
separate quality failure; the guard records and rejects it but does not identify its model cause.
The first comparison remains whole-trajectory wall and quality under the retained protocol.
Records is not rerun to fill the missing diagnostic evidence.

The scheduling research maps revision-bound background filing, exact pending joins,
independent judge batching, and incremental summaries to the existing classifier and
conversation barriers. These remain conditional candidates. In particular, shared work must
retain question/state identity, and a stale summary must never replace a changed conversation.
Source examples establish feasible designs, not gains on this host. Root independently checked
the Ollama usage, concurrency, and pinned scheduler sources; the broader research report is
`tmp/units/memory-scheduling-research-report.md` and is not accepted performance evidence.

## Retained protocol and prior readings

The user limited the successor execution to Compaction on 2026-10-15. Retain candidate-3
Records at its original build and seal; do not rerun it to collect checkpoints or timing fields.
This instruction supersedes the Records checkpoint collection proposed later in this document.
The observation implementation passed review and package gates. The Compaction room attempt
ended after 37 completed goals and a refusal on attempted goal 38. The user authorized a
separate recap-cap treatment; preparation follows `series.md`. Records replay that depends on missing
exact request checkpoints remains unavailable. No optimization or speed gain is accepted.

The partial attempt attributes 27.575% of Agent request wall time to prefill, representing
20.389% of attempt wall time. Model loading is 0.372% of Agent request wall time. The exact-byte
packet at Agent/tmp/studies/performance-terminal-inputs contains checkpoints 8, 16, 24 and 32;
the later checkpoints required by the twelve-checkpoint screen are unavailable. Manifest hash:
d3ba2d7bd39bb2d1bd28216a977f4fa614d32c09f28f6b8b4221bfa631203464.
The accepted successor verifier preserved every packet byte and passed strict TypeScript plus
3 positive and 6 negative controls. This preparation does not admit the incomplete performance
screen or establish an optimization result.

The CPU fixture against the frozen Conversation reproduced the final fold's 95-to-162-unit
expansion and verified section-cap merging, source identities, the protected exchange, and
initial/merge throw and abort behavior. It made no model calls. Its cap-2 case is a mechanism
fixture, not a selected treatment or evidence that model-generated merging preserves quality.

The user requested this investigation on 2026-10-14 and authorized Fable 5.1 to settle the proposal on 2026-10-15. Adopt observation-only timing as the first implementation unit, with Agent requests as the first measurement priority. No optimization candidate is admitted for implementation yet. Scaffold's `quality.md` requires realistic workloads, predeclared sample counts and worthwhile differences, uncertainty, negative controls, and host-load readings. Production changes wait for those measurements.

## Close the failed qualification before another model run

Capacity candidate 3 sealed as operationally failed: Records completed 96 products, while Compaction completed 63, failed on attempted goal 64 and left 32 unexecuted, with no partial products. Execution exited 1, uncapped, after 8,735,637 ms. The result is `fe9bd623-258a-44fa-91dd-cb6cd5a564ff`, seal `3fbafc2bbcc7c551438adba20ee90654209bff0720bb18a2499210e8f6e35b6f`; mechanical grading is `d762730c1a9b2c92242079d9fc8f1c69f7ee8e03050877f274c971f7f0a3d792`. Root checked the terminal reader and the closed-attempt aggregates. No quality execution is admitted by this result.

The triggering Compaction goal, `ev-16-4`, received a normal `stop` response with 12,194 prompt tokens and 1,630 completion tokens. The reserved prompt allowance was 20,480 minus 8,192 minus 512, or 11,776 tokens. The prompt exceeded that allowance by 418. This proves a reserved-output-space violation, not an actual model context overflow or a daemon failure. Agent's `../agent/studies/memory/helpers.ts:205` rejects it after wire accounting in `../agent/studies/memory/StudyMemoryTransport.ts:214`. The report calls it infrastructure because `StudyError('CAPACITY', message)` carries no attached failure, and Study's `readStudyFailure` falls back to infrastructure. Root verified both the installed converter and the authored `src/core/engines/helpers.ts:21`. There is one triggering failure and 32 cascade skips.

Preserve the sealed result and the frozen installed runtime. Before another qualification, reproduce and repair Compaction's request-room admission against this retained case, and preserve capacity attribution at the error-conversion boundary. A source check shows Compaction sizes its window with `estimateMessages`; that does not establish why its estimate admitted this exact request. The diagnostic must account for the rendered instructions, tool definitions, template overhead, and subsequent tool turns before selecting a repair. Do not shrink the output reserve or treat a normal completion as admission evidence. Prove rejection before provider dispatch with an oversized-request control and admit the corresponding in-budget case. The original chain deadline remains `2026-10-15T08:54:21.154Z`; this plan neither resets it nor silently resumes the failed chain.

## Evidence and priority

| Layer | First candidate | Why it deserves a measurement | Limit |
| --- | --- | --- | --- |
| Records | Measure judge load, prefill, and decode before selecting a candidate | The completed candidate-3 Records arm attributes 29.5 of 105.1 minutes to 729 judge calls. | OllamaJudge 0.0.23 splits questions into separate requests and refuses multi-question encoding. Batching requires a separately qualified provider. |
| Agent | Measure request load, prefill, and decode first; count repeated-turn cost | Agent requests account for 74.2 of 105.1 minutes. ToolManager already uses `Promise.all`; the Agent restores result order. | Parallelizing dependent turns is incorrect. A repeat guard must distinguish a repeated query after relevant state changes from a stuck loop. |
| Study | Read retained inter-attempt gaps before adding preparation or process instrumentation | Browser demonstrates sharing expensive infrastructure while issuing fresh contexts. Study keeps one session across a trial and creates a fresh process for each trial. | Share no conversation, judgments, mutable adapter state, or used trial worker. The residual request accounting does not bound harness overhead. |

The root read the decision-bearing implementations: Agent `Classifier`, `JudgmentManager`, `AgentJudge`, `Agent.#dispatch`, the installed ToolManager and Ollama providers, the memory adapter transport; Browser's pool, grant/ping sharing and mutation queue; Study's serial engine and native launch path. Grok's read-only absorption returned session `9e7e9408-a024-44e8-ae45-57925928ddb0` in 666,634 ms, exit 0. Root corrected two remaining unknowns in that report: ToolManager already overlaps admitted tool handlers, and the active memory session uses OllamaJudge with `batch: false`.

### Completed arm, observed 2026-10-15

Candidate 3 Records (`r1-s1-a1`) closed after 6,303,563 ms: 96 observations, no observation or attempt failure field, no partial product. The whole capacity series subsequently failed on Compaction as recorded earlier. Root read and reran the bounded aggregate reader over the closed attempt; these are recorded request durations, not a causal decomposition of model compute or a quality baseline.

| Role | Calls | Accounted time | Share of attempt wall |
| --- | ---: | ---: | ---: |
| Agent | 209 | 74.23 minutes | 70.66% |
| Judge | 729 | 29.51 minutes | 28.09% |
| Metadata | 576 | 10.953 seconds | 0.17% |
| Tool | 100 | 100 ms | Less than 0.01% |

Summed usage leaves 67.553 seconds outside those counters; this remainder is not a measurement of Study overhead because boundaries and any overlap differ. Wire records show agent prompt/completion totals 1,024,721/92,688 tokens, maximum prompt 11,309, maximum completion 2,053, and all 209 agent finishes `stop`. The judge totals 335,490 prompt tokens and 729 completion tokens; all judge finishes are `length`, which is the intentional one-token logit readout, not a clipped agent product. Room stays at context 20,480 / output 8,192 / safety 512. Do not shrink it to the observed maxima.

The older c1 63/109-minute judge reading remains historical evidence only. The new arm makes Agent requests the largest observed target. It also shows that eliminating metadata checks cannot provide a material whole-run gain. Host load included this session's CPU tests and CLI agents, so these readings are not a quiet-host performance baseline.

As a prioritization calculation, holding the rest of this serial reading fixed, reducing judge time by 25% would save about 7.38 minutes, or 7.02% of attempt wall time; halving it would save about 14.05%. These are conditional arithmetic, not measured gains. The whole-run target therefore requires a larger judge improvement or savings in Agent calls too. Records' effect on selected context belongs in that measurement alongside its filing cost.

At 2026-10-15 00:12 UTC, read-only `/api/show` responses identified **both** pinned q4 and Mica models as `qwen35`, with a declared 262,144-token model ceiling. That ceiling is not the daemon's allocation. The dedicated daemon version is 0.40.3. Its [tagged scheduler](https://github.com/ollama/ollama/blob/v0.40.3/server/sched.go#L478-L490) forces this family to one parallel slot. More concurrent requests to either runner will not create additional execution slots. This also rules out promising faster runs by turning up `OLLAMA_NUM_PARALLEL` alone.

An instantaneous `nvidia-smi` observation at approximately 00:08 UTC showed a GTX 1660 SUPER, 6,144 MiB total VRAM, 3,431 MiB used and 19% utilization, while the series and CPU hardening work ran. This is a host description, not a utilization study or evidence that two resident models fit. No model or daemon setting was changed.

Both installed Ollama providers already send a five-minute keep-alive. Ollama can evict models when memory is insufficient; warming everything may therefore hurt residency. Its [response timing fields](https://docs.ollama.com/api/generate) separate loading, prompt evaluation and generation. Its [FAQ](https://docs.ollama.com/faq) describes model residency and concurrency memory costs. Record those fields before choosing a warmup or scheduling policy.

## Transfer Browser's ownership rules

1. **Share infrastructure; isolate state.** Browser keeps Chromium alive but gives holders separate contexts. Keep the model service alive across trials, but retain fresh Study children and fresh conversations/judgment stores. Freeze and report the initial model residency condition for every measured arm.
2. **Join identical pending work.** Browser shares setup, holder grants and per-slot pings. Agent at `13c1d0a` caches completed judgments but has no pending-call map. Its serial classification path supplies no overlapping misses to optimize. If eager filing is justified later, join one pending request for the exact model behavior, state, ordered sources and question identity as part of that barrier. A canceled waiter must not cancel work another waiter owns; a failed request must not become a successful cache entry.
3. **Serialize mutations at their owner.** Browser queues mutations within a holder and overlaps independent holders. Keep conversation mutation and dependent classifier phases ordered; overlap independent conversations, CPU preparation, and separate sealed-result analysis only within explicit resource bounds.
4. **Prepare what is likely to be used.** Browser prepares an initial context and does not block vocabulary listing on all warm slots. Study can prepare immutable declarations and grading inputs ahead of use. Any prepared artifact needs a digest/revision check at consumption; never remove execution's integrity check merely because check ran earlier.

Browser's guide records 49.73 s versus 29.72 s for one versus two contexts through the built binary on a quiet Windows host, and no established gain from two to three. That supports bounded experiments, not a transferable Study speedup. Its grant and ping mechanisms are in `../browser/src/server/BrowserMCPServer.ts`; per-holder mutation serialization is in `../browser/src/core/BrowserToolset.ts`.

## Experiments, in order

### 1. Read the cost of the real workload

Implement timing capture in authored trees with deterministic proofs, without replacing the frozen installed consumer. The first real model diagnostic waits for operational repair and closure of the failed qualification. Assign each mechanism to its owner:

| Owner | First-unit observations | First consumer |
| --- | --- | --- |
| Ollama provider | Monotonic request wall, daemon load/prompt/decode durations and counts, tokens, finish reason, and model identity | Agent's memory adapter request evidence |
| Agent classifier and judgment store | Classifier phase and completed-cache hit/miss, with logical questions distinct from transport calls | The memory adapter's correlated evidence |
| Memory adapter | Role, frozen model digest, request correlation, model-switch residency, and retained provider observations | The diagnostic reader |

Inspect installed provider declarations before extending a contract. Expose only missing observations through the lowest owning package, with this adapter as its real first consumer. Preserve raw duration units and mark unavailable fields as unknown. Tool wait, pending-join counts, and Study prepare/fork/close/custody instrumentation wait for evidence of material cost. A near-one-percent residual in the earlier accounting is not a bound on Study overhead.

The bounded Haiku lookup found no typed daemon timing fields in installed Ollama 0.0.23: `extractUsage` returns token counts, and `OllamaProvider.read` accepts a raw record and returns Agent's `ProviderIncrement`. Root verified the declaration and Agent's installed `ProviderIncrement`/`ProviderResult`, which expose content, tools, thinking, and token usage without timing. The extension therefore belongs at the provider observation boundary; the implementation must verify the pinned daemon's actual fields rather than infer them from declarations. Retained dispatch metadata identifies Agent requests as `qwen3.5:4b-q4_K_M` and judge requests as `hf.co/sky7350/Mica-v0.1-4B:Q4_K_M`, with distinct pinned digests. These are request identities, not evidence of reload cost or simultaneous residency.

Freeze 12 actual checkpoints by fixed goal positions, three per trajectory quarter. Capture positions 8, 16, 24; 32, 40, 48; 56, 64, 72; and 80, 88, 96 during the required successor Records qualification. Retain each checkpoint's exact wire inputs, conversation/judgment snapshot, released reference state and surrounding Agent/judge switching order; a judge-only input set cannot answer the Agent-first question. The public snapshot does not restore the Ledger's private state, so replay of captured wire inputs must not be described as a restored Ledger run. Run a cold-start pass followed by a warm-start pass within **60 minutes combined**, with the same explicit context/output room. Define and record the initial residency condition; retain the real interleaving rather than silently warming the judge throughout. This is a diagnostic, not a candidate comparison or quality baseline. Finish both passes or report incomplete and stop; extend nothing automatically.

Checkpoint provenance changed after the custody check on 2026-10-15. The completed candidate-3 Records attempt retained products and counters, but no request bodies or snapshots. Root streamed all 3,928 evidence rows: 1,514 dispatches and 1,514 wire records carry metadata and token counts only. The bounded Haiku lookup and the authored capture sites agree. Reconstructing the missing intermediate responses would invent evidence. Capture during the already-required successor qualification avoids an additional full trajectory solely for this diagnostic; retain the original result unchanged and disclose this provenance change.

Record `/api/ps` residency at model switches and GPU memory/utilization plus other host work at fixed intervals. Establish repeat-prefix versus changed-prefix behavior before interpreting prompt counters as cache reuse. A cold-versus-warm control must prove load timing reaches the record. Keep request usage separate from logical questions; invent no per-question allocation. Publish critical-path wall time beside sums because overlapping durations are not additive wall time.

Before the diagnostic, prove capture-on versus capture-off preserves request bytes, product bytes, scheduling, and admission against a deterministic real adapter. A changed-request byte must fail that comparison. Disclose observation overhead on the real workload. Do not rerun a full trajectory merely to rediscover retained role totals.

### 2. Records: remove work before moving it

Choose at most two candidates after the interleaved timing split. Prioritize a component only when it occupies at least 20% of the relevant role's request wall time; otherwise keep it advisory. Admit a component as the sole whole-run candidate only when its measured cost exceeds 15% of attempt wall, so eliminating it could reach the declared target. Smaller components are combination-only or advisory. These are candidate gates, not promised gains.

Use these decisions after observation:

| Candidate | Ruling | Evidence needed |
| --- | --- | --- |
| Residency or scheduling | Conditional | Load duration occupies at least 20% of either role's request wall; preserve capacity and measured residency conditions. |
| Plain-Agent repeat guard | Conditional | Retained stuck-loop turns occupy at least 20% of Agent wall; preserve legitimate repeated lookup after a state change. |
| Mica provider qualification | Defer | Judge prompt evaluation occupies at least 20% of judge wall after reloads are measured, and host build/memory admission passes separately. |
| Eager filing | Defer | Measured response wait can overlap prior arrivals or independent CPU work; design the ledger revision barrier first. |
| Joining pending judgments | Defer | A real overlapping duplicate-miss population exists; serial classification supplies none. |
| Prepared unused workers | Defer | Retained inter-attempt gaps or attributable preparation reach 5% of series wall; then measure the component before implementation. |

If a batching provider qualifies, group independent topic questions after category/quiet/request gates. Keep correction-pair `amends` then conditional `supersedes` dependencies intact. A move from OllamaJudge to SystemOneJudge is a separate provider/protocol treatment, even with the same model weights. Expose malformed, missing, duplicate and canceled batch responses without turning them into negative labels.

A concrete research candidate is Mica's pinned [v0.1.2 direct backend](https://github.com/akivet/Mica/blob/v0.1.2/mica/direct_backend.py). It implements independent sequence state, optional shared-prefix decoding, and session-bound full attention/recurrent checkpoints, with an isolation comparison for alone, batched and reordered questions. That is relevant to Qwen3.5's hybrid state; ordinary attention-only reuse is insufficient. Its [server documentation](https://github.com/akivet/Mica/tree/v0.1.2) supplies a SystemOne endpoint and an 8,192-token input refusal. These are source capabilities, not a verified installation or speedup on this host. Keep the pinned v0.1 weights for provider qualification; do not combine it with the separately published v0.5 preview. Compare serial/batched/shared-prefix modes within the qualified provider, pin calibration and request rendering, and grade every changed decision. Host build compatibility, memory, endpoint cancellation and isolation remain admission gates; install nothing or touch the live daemon for this investigation.

Use the fixed-position checkpoints for candidate replay, retaining the full state and inputs each observed. Preserve measured Agent/judge switching and residency around those inputs; an isolated warm-judge replay is only a separate diagnostic. Predeclare three paired blocks in **AB, BA, AB** order with clean stores, the same model bytes and options, and no unrelated GPU workload. Report the unbalanced order and model-load readings; order alone does not remove carry-over. There are 12 distinct checkpoints, not 72 independent samples; 72 evaluations include repetitions and arms. Before the first run, name paired whole-block wall-time ratio as the screening statistic and report its range across the three blocks, plus each checkpoint's timing. This range describes observed variation and is not a population confidence interval. Cap screening at **90 minutes per candidate**; an unfinished sample is inconclusive, not an excuse to extend automatically.

Keep a candidate for end-to-end validation only if its targeted role's wall time falls at least **25% in every paired screening block**: judge wall for a judge treatment, Agent wall for an Agent treatment. Count the retained repeated-loop population before replaying a guard. Twenty-five percent is a prioritization threshold for a material cost, not a forecast. Request count, input tokens, total wall time and malformed/missing answers must be reported even if a preferred metric improves. Exact reuse must preserve every judgment; batching disagreements require independent grading against the frozen oracle. Negative controls change one question/state byte, source order and model identity, and exercise gated questions and cancellation.

Eager filing is a separate candidate after this screen. It may reduce response wait only when arrivals precede response or independent tool/CPU work exists. A ledger revision barrier must make immediate `add` then `respond` wait for that revision; late results from obsolete revisions cannot enter selection. Compare arrival-to-ready, response wait and total work. Do not count latency moved before the clock as a speedup.

### 3. Agent: spend fewer turns and preserve useful context

Measure redundant lookup/tool turns, answer-pass recovery, completion-length stops, re-prefill tokens and reload time. Retain the existing Records repeat stop and answer-pass rethrow. Test a plain-Agent repeat policy only against an observed repeated-loop population, with a legitimate repeated lookup after a state change as its negative control. Keep output room explicit and report cut replies; shrinking generation room to win elapsed time is a quality change.

Current Ledger already reuses its selected briefing through ordinary tool turns and explicitly reuses the entered messages/briefing in answer recovery (`Ledger.ts:574`, `Agent.ts:371,552`). A new request clears that selection and classifies again (`Ledger.ts:310,582`). Root verified these paths after a bounded source lookup. Measure consecutive calls within one pass, recovery calls sharing a briefing, and successive goals selecting overlapping records as separate prefix populations. Existing content reuse is not proof of provider cache reuse. Avoid adding another render cache without a CPU-cost reading; selection/render trimming is already performed before the agent pass. A changed record-selection policy would be a separate quality treatment, not an observation-only optimization.

Prompt-prefix reuse is a provider/runner experiment, not a semantic judgment cache. Preserve stable prompt bytes and ordering where they are already semantically fixed; measure actual prompt-evaluation time. Changing placement or text gets a separate arm and quality evaluation. Given the current single-slot runners and 6 GiB GPU, first measure reloads and residency; do not schedule parallel GPU arms by default. Independent CPU tools can overlap, but current ToolManager already does so and resource-mutating tools need their own ownership policy.

### 4. Study: overlap independent work, keep the experiment interpretable

Run packet preparation, independent label batches, rubric validation and reports beside generation only when they consume separate resources and their artifacts are sealed/immutable. Verify GPU/CPU placement and actual contention first: CPU-side preparation can contend with an offloaded model. Treat overlap as an explicitly measured treatment rather than invisible background load. Bound label concurrency and stop scheduling on quota/access failure; retain an identical shared instruction prefix and fixed model. No reuse of labels across changed packet or rubric bytes. Avoid fine-grained IPC/file buffering until its measured cost matters; a fast run with incomplete evidence is invalid.

Consider prepared immutable execution inputs or a prestarted **unused** next worker only if preparation accounts for at least 5% of real series wall time or a user-visible startup delay. Require at least a 20% reduction in that component and a 5% series gain before keeping the complexity. Revalidate at use, bound abandoned preparation, and prove no trial state crosses the boundary. Never pool an already-used trial worker.

## Whole-run acceptance

After a screen passes, freeze exactly one candidate and its baseline as separate instruments. Start with one paired full 96-goal validation, alternating order from the screening sequence, with identical budgets and cold/warm conditions. This first-pair gate concerns horizon completion, operational outcomes and critical violations only; it supplies no confidence interval. If those conditions hold, run the predeclared two further pairs, three pairs total. Cap each run at **160 minutes**, rounding the observed 105.1-minute Records attempt plus half upward. This cap belongs to this measured workload, not a universal Study default. Stop early on operational failure, a new critical violation, or any exceeded cap. If uncertainty remains material after the declared population, report inconclusive and stop.

The proposed performance campaign has these finite model-run limits; they do not extend the failed qualification's deadline or authorize running every stage before its gate passes:

| Stage | Population | Combined limit |
| --- | --- | --- |
| Diagnostic | Cold-start and warm-start passes over the 12 fixed checkpoints | 60 minutes |
| Screening | At most two candidates, 90 minutes each | 180 minutes |
| Full validation | At most three pairs, six runs at 160 minutes each | 960 minutes |
| Total model-run budget | All admitted stages | **1,200 minutes / 20 hours** |

Grading and local validation are outside this model-run accounting and need finite launcher and usage limits fixed before execution; this table is not a 20-hour bound on all elapsed work. If the diagnostic identifies no component meeting its gate, stop and leave every candidate advisory.

The worthwhile end-to-end target is **at least 15% lower complete-trajectory wall time in every measured pair**, no worsening p95 goal latency hidden by throughput, all 96 goals accounted for, no new operational failures or critical violations, and no observed regression in facts/work/obligations under blind grading. Report the paired trajectory ratios and their observed range, not a false precision interval from repeated atoms. Three pairs only screen a large, repeatable effect on this fixed workload. Quality parity with sparse failures cannot be proven by three pairs: disclose that limitation instead of claiming equivalence. Also report tokens, request count, peak memory, cancellation and cleanup behavior. No optimization is accepted merely because a microbenchmark is faster.

Opus's focused review (session a2cf2777-7b0a-4ffb-b11c-d1f7f008c9cd, 130544 ms, exit 0) identified the blocked batching arm, missing duplicate-miss population, residency confound and sample-unit ambiguity. Root verified the decision-bearing OllamaJudge/AgentJudge source and incorporated those corrections. Four abbreviated citations did not resolve automatically, so the report was not used as sole evidence. Its suggestion that reloads dominate remains unmeasured; the new completed-arm aggregate supports Agent-first timing, not a causal reload claim. Grok's abbreviated citations also remain lookup hints rather than acceptance evidence.

Fable's final decision ran as actual `claude-fable-5-1`, session `c5d704ad-3d92-4eb4-aa4f-023d4b66fcfc`: 164,090 ms, exit 0, uncapped, five turns, USD 0.9698718 API-equivalent accounting. It read only four fixed packet files, spawned no subagents, and made no web calls. Root adopted its sequencing, owner split, conditional candidates, diagnostic, and finite budgets. Two factual qualifications remain explicit: judge-only savings can mathematically exceed 15% when the reduction exceeds roughly 53.4%, so Agent-first is a priority rather than an impossibility claim; the residual accounting cannot bound harness overhead. Do not force model eviction merely from the one-slot constraint. Further Fable use requires fresh user permission.

Fable requested two non-blocking implementation checks, delegated to actual `claude-haiku-5-5`, session `df06d134-7b61-4888-82e0-31e37aa87bda`: 22,334 ms, exit 0, uncapped, four turns, USD 0.00568121 API-equivalent accounting. Haiku read only its brief, the installed provider declaration, and sanitized retained dispatch/profile metadata. Root checked the decision-bearing declarations directly. No further synthesis, broad absorption, or workload execution was needed to close the proposal.

The next implementation unit is observation-only timing; its first model diagnostic depends on resolving the failed qualification. Study hardening closed locally on Windows with admission/native regressions, full gates, and packed-consumer proof. Agent's copied runtime and sealed evidence remain unchanged. No performance change, concurrency setting, provider setting, installed consumer dependency, or captured artifact changed during this investigation.
# October 15 series constraint

The user requires the resumed series to rerun Compaction only. Reuse completed candidate3
Records with its original identity. The checkpoint collection described below must not cause
another Records qualification or hold up Compaction. Historical candidate3 lacks exact request
bodies and Ledger snapshots; no faithful checkpoint replay can be reconstructed from it. Keep
source instrumentation and fixture proofs, but defer checkpoint-dependent Records diagnostics
until suitable captured work is available. This constraint supersedes the proposed collection
during a successor Records qualification; it does not weaken the paired measurement thresholds.

