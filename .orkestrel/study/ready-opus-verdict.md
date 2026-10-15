No claim broke. All 8 hold under a design-fit reading, so the verdict is PASS. I worked from the diff, source and test reads only. No shell was available, so no test ran in this lane; the runtime facts come from root's logs, which I used only as corroboration.

**1. CONFIRMED** — Owned configuration stays owned across awaits.
- **Attack:** change the caller's options bag after construction, before the first await.
- **What the code does:** each constructor copies the bag and keeps the borrowed objects as the same objects:
  - `C:\Users\mikes\WebstormProjects\study\src\server\launchers\StudyCLI.ts:22`
  - `C:\Users\mikes\WebstormProjects\study\src\server\processes\StudyChannel.ts:24`, which also attaches its listeners to the copied endpoint at lines 27-29
  - `C:\Users\mikes\WebstormProjects\study\src\server\processes\StudyRemoteMeter.ts:25`
  - `C:\Users\mikes\WebstormProjects\study\src\server\processes\StudyRemoteTicket.ts:14`
  - `C:\Users\mikes\WebstormProjects\study\src\server\processes\StudyProcessSession.ts:47-50`, which deep-clones only the declaration and keeps the signal itself
- **Clone safety:** the Session clone is safe. `StudyProcessOptions`, `StudyArtifactOptions` and `StudyTrial` hold only strings and plain declaration data (`C:\Users\mikes\WebstormProjects\study\src\server\processes\types.ts:37-62,95-98`). Signal, endpoint, handlers and control are not cloned.
- **Design fit:** this is the same idiom the core engines already use (`C:\Users\mikes\WebstormProjects\study\src\core\engines\StudyMeter.ts:25`, `StudyScope.ts:27`, `StudySeries.ts:32`).
- **Mutation that the tests reject:** removing the copy in the CLI, Channel, Meter, Ticket or Session.
  - CLI: the replacement entry exits 7 against an expected 0 (`C:\Users\mikes\WebstormProjects\study\tests\src\server\launchers\StudyCLI.test.ts:13-15`).
  - Channel: the request would go to the second peer and return `'replacement'`.
  - Meter: the `receipt.log` paths differ.
  - Ticket: the original recorder would be empty.
  - Session: the open frame would carry the changed values (`C:\Users\mikes\WebstormProjects\study\tests\src\server\processes\StudyProcessSession.test.ts:69-73`).

**2. CONFIRMED** — Custody binds the accepted identity and resources.
- **Attack:** change `trial.id` while `start` is awaiting.
- **What the code does:** every later use reads `scheduled.id` (`C:\Users\mikes\WebstormProjects\study\src\server\stores\StudyResults.ts:103-122`).
- **Mutation that the tests reject:** reverting to `trial.id`. The `#starting` entry for the original id is never deleted, so finish and seal fail. The test at `C:\Users\mikes\WebstormProjects\study\tests\src\server\stores\StudyResults.test.ts:21-54` catches this through its seal and reading assertions.
- **Sink:** the sink copies its goals and limits and keeps the file and budget as the same objects (`C:\Users\mikes\WebstormProjects\study\src\server\stores\StudyEvidenceSink.ts:20`). A replaced descriptor would fail the EBADF/caller-write assertions. Changed goals or limits would fail the `EVIDENCE` and `CAPACITY` assertions.

**3. CONFIRMED** — Remote settlement retains the value it sent.
- **What the code does:** one frozen copy, `accepted`, is both sent and retained (`C:\Users\mikes\WebstormProjects\study\src\server\processes\StudyRemoteMeter.ts:100-116`).
- **Mutation that the tests reject:** retaining `value` again when the reply arrives. The test changes `tokens` to 99 before the reply comes back 25 ms later (`C:\Users\mikes\WebstormProjects\study\tests\src\server\processes\StudyRemoteMeter.test.ts:134,138`).
- **Repeated settlement:** still refused with an attributed `fail` (`C:\Users\mikes\WebstormProjects\study\tests\src\server\processes\StudyRemoteTicket.test.ts:35-47`).
- **Shallow copy:** freezing only the top level is enough, because `StudyUsage` and `StudyFailure` contain no nested objects.

**4. CONFIRMED** — Output admission keeps terminal outcomes truthful.
- **What the code does:** `product = undefined` sits before `control.fail`, and the output budgets are consumed only on the admitted branch (`C:\Users\mikes\WebstormProjects\study\src\core\engines\StudySeries.ts:220-227`). The rest of the horizon is filled from `control.failure` (lines 156-174). A custody rejection still throws `CUSTODY` (lines 186-193).
- **Mutation that the tests reject:** deleting line 221.
  - The goal, trial and series tests assert the product is undefined (`C:\Users\mikes\WebstormProjects\study\tests\src\core\engines\StudySeries.test.ts:173,203,235`).
  - The sealed-reading test asserts the same (`C:\Users\mikes\WebstormProjects\study\tests\src\server\stores\StudyResults.test.ts:112`).
  - The genuine-custody test still requires a `CUSTODY` rejection and no seal (lines 118-153).
- **Already covered:** single use, parent abort and late opening are each pinned by recorder counts at `StudySeries.test.ts:12-145`.

**5. CONFIRMED** (Windows only; Linux unverified) — Native close is bounded without premature success.
- **What the code does:** `drainStudyChild` starts a 1 s timer on `exit`, then destroys stdout and stderr; `close` clears the timer (`C:\Users\mikes\WebstormProjects\study\src\server\processes\helpers.ts:104-113`). Calling it right after the child is spawned (`StudyTask.ts:46`, `StudyProcessSession.ts:71`) means it is attached before the exit can happen.
- **Exited roots:** `terminateStudyChild` now returns early for an exited root (`helpers.ts:119`). This is correct. Node sets `exitCode` only after reaping the process, and on POSIX the orphans have already been reparented, so walking the parent-PID tree finds nothing; signalling `child.pid` could hit a reused PID. Session's own group kill was already gated the same way (`StudyProcessSession.ts:271`).
- **Mutations the tests reject:**
  - Making the drain a no-op: the Task observation fails at 4000 ms, before the task's 5000 ms deadline (`C:\Users\mikes\WebstormProjects\study\tests\src\server\processes\StudyTask.test.ts:109-139`). The Session close deadline also fails (`StudyProcessSession.test.ts:82-126`), as does the helper close budget (`C:\Users\mikes\WebstormProjects\study\tests\src\server\processes\helpers.test.ts:95-123`).
  - An unconditional 1 s wait: the ordinary-exit control asserts close takes less than `STUDY_DRAIN_DURATION` (`StudyProcessSession.test.ts:155`).
- **Root's evidence:** `tmp/codex/ready-native-fix-tests.err:4-5` shows one failure, the Channel fixture's malformed-frame case. `ready-channel-green.jsonl:7` (5 passed) supersedes it, as the claims file states.

**6. CONFIRMED** — IPC admission keeps correlation and failure attribution.
- **Mutations that the tests reject:**
  - Off-by-one, or a missing outbound cap: the 65th request must reject while `signal.aborted === false`, and all 64 echoes must come back with their indices (`C:\Users\mikes\WebstormProjects\study\tests\src\server\processes\StudyChannel.test.ts:142-179`).
  - A missing inbound cap: `active` must equal exactly 64, the abort reason must match, the held outbound request must reject, and 64 replies must arrive after the gate opens (lines 181-245).
- **Copy effect:** copying the options only selects the endpoint; it does not touch frame validation.

**7. CONFIRMED** — The proofs and public description tell the repaired behaviours apart.
- **Each proof's mutation:** given under claims 1-6.
- **Launcher tests:**
  - 124: the outer deadline is 75000 ms and `elapsed >= STUDY_LAUNCH_DURATION` (`C:\Users\mikes\WebstormProjects\study\tests\src\server\launchers\StudyLauncher.test.ts:39-46`). Dropping the `expired` flag would give code 1.
  - Exit 7: lines 55-78.
  - Above and at the 24 h ceiling: lines 80-121. Changing `>` to `>=` fails the at-ceiling case; removing the check fails the command log.
  - 130: `stdout === '130\n'`, with a wrapper deadline of 15000 ms against an entry lifetime of 20000 ms (lines 123-141).
- **Guide wording:** no overclaim. `C:\Users\mikes\WebstormProjects\study\guides\study.md:13` keeps genuine custody failures unsealed. `guides/study.md:703` disclaims orphan discovery and termination and says Linux is unverified.

**8. CONFIRMED** — The retained package boundaries are coherent.
- **Exports:** `STUDY_DRAIN_DURATION` (`C:\Users\mikes\WebstormProjects\study\src\server\processes\constants.ts:11`) and `drainStudyChild` are exported through `src\server\processes\index.ts:2-3`. They are listed at `guides/study.md:170,318` and have consumption rows at lines 1379 and 1402-1403.
- **Setup files:** no new setup file was added. Fixtures went into the existing `tests/setupStudy.ts` and `tests/setupServer.ts`, as `.orkestrel/study/decisions.md:27` requires.
- **Process exclusion:** the reason is the loader origin rule (`decisions.md:21`). No source or guide file says Process can't accept native children.
- **Untouched contracts:** grading, seal and captured-loader code is not in the diff.

**Findings outside the claims:** none substantiated. No ADVISORY cost findings.

**Attacked and held** (things that look like defects but aren't):
- `StudyCLI.test.ts` never observes the `root` field. Only the entry is checked. Because the copy is a single spread, the "disable the copy" mutation is still caught. To pin `root` separately, have the original entry write `process.cwd()`.
- In `StudyResults.test.ts:48`, the "no `mutated` directory" assertion could never fail, because the old code built the directory path before its first await. The seal and reading checks are what catch the mutation.
- In `StudyProcessSession.test.ts:74`, `foreign.signal.aborted === false` could never fail, because the signal was always taken from the constructor argument. The `['open','abort','close']` frames are what prove cancellation works.
- `drainStudyChild` is impure but lives in `helpers.ts`. It follows the accepted `terminateStudyChild` precedent, so it adds no new placement defect.
- `C:\Users\mikes\WebstormProjects\study\src\server\launchers\StudyLauncher.ts:133` settles on `close` with no drain. That is outside claim 5. Task and Session children use silent pipes, so I found no reachable vector where they hold the launcher's output.
- On POSIX, an exited Session root's group is not killed even when a same-group descendant survives. This is unchanged and covered by the orphan disclaimer. Linux is unverified.

**Limits:** Linux and the minimum supported Node version are not covered, and the tree-wide and packed-consumer gates have not run yet.

VERDICT: PASS