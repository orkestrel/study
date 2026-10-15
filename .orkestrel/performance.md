# Records, Agent, and Study performance

The user requested this investigation on 2026-10-14 while Study hardening and Agent's frozen capacity/quality chain were running. This is the next experiment plan, not a speedup claim or permission to change that chain. Scaffold's `quality.md` requires realistic workloads, predeclared sample counts and worthwhile differences, uncertainty, negative controls, and host-load readings. Production changes wait for those measurements.

## Evidence and priority

| Layer | First candidate | Why it deserves a measurement | Limit |
| --- | --- | --- | --- |
| Records | Reduce repeated judge work, then batch independent questions with a capable judge | The older c1 q4 run attributed 63 of 109 minutes to 2,626 one-token judge calls and 767,130 judge prompt tokens (`../agent/.orkestrel/agent/direction.md`). | Those are old budgets and models. Today's `OllamaJudge` splits questions into separate requests. Merely grouping the classifier's calls cannot remove those requests. |
| Agent | Avoid unproductive turns; measure model load, prefill, decode, and tool wait separately | Repeated lookups and clipped replies have retained examples. ToolManager already uses `Promise.all`; the Agent restores result order. | Parallelizing dependent turns is incorrect. A repeat guard must distinguish a repeated query after relevant state changes from a stuck loop. |
| Study | Overlap independent preparation and sealed-result analysis; keep execution isolation | Browser demonstrates sharing expensive infrastructure while issuing fresh contexts. Study already keeps one session across a trial and creates a new process for each trial. | Do not share conversation, judgments, mutable adapter state, or warm trial children across arms. First establish whether process/setup time is material. |

The root read the decision-bearing implementations: Agent `Classifier`, `JudgmentManager`, `AgentJudge`, `Agent.#dispatch`, the installed ToolManager and Ollama providers, the memory adapter transport; Browser's pool, grant/ping sharing and mutation queue; Study's serial engine and native launch path. Grok's read-only absorption returned session `9e7e9408-a024-44e8-ae45-57925928ddb0` in 666,634 ms, exit 0. Root corrected two remaining unknowns in that report: ToolManager already overlaps admitted tool handlers, and the active memory session uses OllamaJudge with `batch: false`.

At 2026-10-15 00:12 UTC, read-only `/api/show` responses identified **both** pinned q4 and Mica models as `qwen35`, with a declared 262,144-token model ceiling. That ceiling is not the daemon's allocation. The dedicated daemon version is 0.40.3. Its [tagged scheduler](https://github.com/ollama/ollama/blob/v0.40.3/server/sched.go#L478-L490) forces this family to one parallel slot. More concurrent requests to either runner will not create additional execution slots. This also rules out promising faster runs by turning up `OLLAMA_NUM_PARALLEL` alone.

An instantaneous `nvidia-smi` observation at approximately 00:08 UTC showed a GTX 1660 SUPER, 6,144 MiB total VRAM, 3,431 MiB used and 19% utilization, while the series and CPU hardening work ran. This is a host description, not a utilization study or evidence that two resident models fit. No model or daemon setting was changed.

Both installed Ollama providers already send a five-minute keep-alive. Ollama can evict models when memory is insufficient; warming everything may therefore hurt residency. Its [response timing fields](https://docs.ollama.com/api/generate) separate loading, prompt evaluation and generation. Its [FAQ](https://docs.ollama.com/faq) describes model residency and concurrency memory costs. Record those fields before choosing a warmup or scheduling policy.

## Transfer Browser's ownership rules

1. **Share infrastructure; isolate state.** Browser keeps Chromium alive but gives holders separate contexts. Keep the model service alive across trials, but retain fresh Study children and fresh conversations/judgment stores. Freeze and report the initial model residency condition for every measured arm.
2. **Join identical pending work.** Browser shares setup, holder grants and per-slot pings. Records currently caches completed judgments but has no pending-call map. Consider one pending request for the exact model behavior, state, ordered sources and question identity. A canceled waiter must not cancel work another waiter owns; a failed request must not become a successful cache entry. Measure duplicate misses first: the serial current classifier may provide little opportunity.
3. **Serialize mutations at their owner.** Browser queues mutations within a holder and overlaps independent holders. Keep conversation mutation and dependent classifier phases ordered; overlap independent conversations, CPU preparation, and separate sealed-result analysis only within explicit resource bounds.
4. **Prepare what is likely to be used.** Browser prepares an initial context and does not block vocabulary listing on all warm slots. Study can prepare immutable declarations and grading inputs ahead of use. Any prepared artifact needs a digest/revision check at consumption; never remove execution's integrity check merely because check ran earlier.

Browser's guide records 49.73 s versus 29.72 s for one versus two contexts through the built binary on a quiet Windows host, and no established gain from two to three. That supports bounded experiments, not a transferable Study speedup. Its grant and ping mechanisms are in `../browser/src/server/BrowserMCPServer.ts`; per-holder mutation serialization is in `../browser/src/core/BrowserToolset.ts`.

## Experiments, in order

### 1. Read the cost of the real workload

After the frozen chain releases its inputs, add observation-only timing to the next memory-adapter revision. Retain monotonic request wall time, Ollama load/prompt/decode durations, role, model digest, input/output tokens, finish reason, cache hit/miss/join counts, classifier phase, tool wait, and Study prepare/fork/close/custody time. Keep logical questions distinct from actual transport calls. Batched usage belongs to the request; do not invent per-question attribution. Publish critical-path wall time alongside sums; overlapping durations are not additive wall time.

Use the existing 96-goal workload and the same explicit context/output room. Record GPU memory/utilization and other host work at fixed intervals. First inspect retained terminal attempts for role-level duration already available; do not rerun merely to rediscover that aggregate. New timing must not change request bytes, product bytes, scheduling or admission. Prove this against a deterministic real adapter, with a changed-request negative control; then disclose timing overhead on the actual workload.

### 2. Records: remove work before moving it

Screen at most two candidates: (a) exact pending-request sharing, only if duplicate misses occur in a real concurrent caller trace; (b) grouping independent topic questions after category/quiet/request gates, on a provider that really sends a batch. Keep correction-pair `amends` then conditional `supersedes` dependencies intact. A move from Mica/OllamaJudge to SystemOneJudge is a separate judge/protocol treatment, not a batching-only improvement. Expose malformed, missing, duplicate and canceled batch responses without turning them into negative labels.

Before coding a candidate, freeze 12 actual classification inputs: three from each quarter of a completed 96-goal trajectory, retaining the full state each input observed. Select by fixed goal positions, not observed success. Run three paired replays with alternating AB/BA order, clean stores, the same model bytes and options, and no other GPU workload. This is 72 arrival evaluations per candidate. Cap screening at 90 minutes per candidate; an unfinished sample is inconclusive, not an excuse to extend automatically.

Keep a candidate for end-to-end validation only if judge wall time falls at least 25% and the paired uncertainty excludes no improvement. Twenty-five percent is a prioritization threshold for a historically dominant cost, not a forecast. Request count, input tokens, total wall time and malformed/missing answers must be reported even if a preferred metric improves. Exact reuse must preserve every judgment; batching disagreements require independent grading against the frozen oracle. Negative controls change one question/state byte, source order and model identity, and exercise gated questions and cancellation.

Eager filing is a separate candidate after this screen. It may reduce response wait only when arrivals precede response or independent tool/CPU work exists. A ledger revision barrier must make immediate `add` then `respond` wait for that revision; late results from obsolete revisions cannot enter selection. Compare arrival-to-ready, response wait and total work. Do not count latency moved before the clock as a speedup.

### 3. Agent: spend fewer turns and preserve useful context

Measure redundant lookup/tool turns, answer-pass recovery, completion-length stops, re-prefill tokens and reload time. Retain the existing Records repeat stop and answer-pass rethrow. Test a plain-Agent repeat policy only against an observed repeated-loop population, with a legitimate repeated lookup after a state change as its negative control. Keep output room explicit and report cut replies; shrinking generation room to win elapsed time is a quality change.

Prompt-prefix reuse is a provider/runner experiment, not a semantic judgment cache. Preserve stable prompt bytes and ordering where they are already semantically fixed; measure actual prompt-evaluation time. Changing placement or text gets a separate arm and quality evaluation. Given the current single-slot runners and 6 GiB GPU, first measure reloads and residency; do not schedule parallel GPU arms by default. Independent CPU tools can overlap, but current ToolManager already does so and resource-mutating tools need their own ownership policy.

### 4. Study: overlap independent work, keep the experiment interpretable

Run packet preparation, independent label batches, rubric validation and reports beside generation only when they consume separate resources and their artifacts are sealed/immutable. Bound label concurrency and stop scheduling on quota/access failure; retain an identical shared instruction prefix and fixed model. No reuse of labels across changed packet or rubric bytes. Avoid fine-grained IPC/file buffering until its measured cost matters; a fast run with incomplete evidence is invalid.

Consider prepared immutable execution inputs or a prestarted **unused** next worker only if preparation accounts for at least 5% of real series wall time or a user-visible startup delay. Require at least a 20% reduction in that component and a 5% series gain before keeping the complexity. Revalidate at use, bound abandoned preparation, and prove no trial state crosses the boundary. Never pool an already-used trial worker.

## Whole-run acceptance

After a screen passes, freeze exactly one candidate and its baseline as separate instruments. Start with one paired full 96-goal validation, alternating order from the screening sequence, with identical budgets and cold/warm conditions. This catches horizon regressions; it does not establish a reliable stochastic quality improvement by itself. If it passes, predeclare two further paired runs (three pairs total), each within the established per-run cap and a fixed campaign budget. Stop early on operational failure or new critical violations. If uncertainty remains material after the declared population, report inconclusive and stop.

The worthwhile end-to-end target is **at least 15% lower complete-trajectory wall time**, with a paired interval excluding no improvement, no worsening p95 goal latency hidden by throughput, all 96 goals accounted for, no new operational failures or critical violations, and no observed regression in facts/work/obligations under blind grading. Report uncertainty clustered by trajectory; atoms within one trajectory are not independent trials. Quality parity with sparse failures cannot be proven by three pairs: disclose that limitation instead of claiming equivalence. Also report tokens, request count, peak memory, cancellation and cleanup behavior. No optimization is accepted merely because a microbenchmark is faster.

The next implementation unit is instrumentation after the current frozen series and grading finish. Study hardening remains a separate active campaign. No performance change, concurrency setting, provider setting, installed consumer dependency, or captured artifact changed during this investigation.
