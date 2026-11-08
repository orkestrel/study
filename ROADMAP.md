Each item is a chunk that reaches green before the next. An item keeps its number for life: a closed
item leaves this file and its number is never reused, so a commit message citing an item by number
stays true.

- **1.** When a record backstop stops a run whose summed inference duration is more than 10% under its cap, or a cap must span trials, design a duration allowance on `StudyLimit` in `src/core/types.ts` and its accounting in `src/core/engines/StudyMeter.ts`. Distinguish provider execution time from wall-clock deadlines.
- **2.** When curtailment must stop a trial mid-segment, add a planned-stop cause to `StudyCause` in `src/core/types.ts` and the execution path in `src/core/engines/StudySeries.ts` so the trial can finish and seal in process.
- **3.** When a segment must detach, design an event-driven milestone waiter over `StudyEvidence` and `StudyStoreInterface` in `src/core/types.ts` and its execution consumer in `src/core/engines/StudySeries.ts`. Park on evidence events rather than polling.
- **4.** At the next package visit, design a root-relative or environment-resolved executable for `StudyDaemon` in `src/core/types.ts` and `isStudyDaemon` in `src/core/validators.ts`. Preserve canonical executable verification and configuration identity; retain Agent’s `studies/memory/profiles/smallest.json` as the consumer.
- **5.** After the shared standing-proof observation mechanism lands in `@orkestrel/test`, adopt it for `buildStudyContractCases` in `tests/setupStudy.ts` and `tests/src/core/contracts.test.ts`. Keep explicit generation-refusal expectations, reference semantics, digest, timestamp, labels, snapshot restoration, and freezing local. Preserve the distinction between structural admission and semantic refusal.
