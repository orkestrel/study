1. **CONFIRMED — Owned configuration remains owned across awaits.** Replacing selecting option fields cannot redirect the CLI, channel, meter, or ticket after construction: each retains a new bag, while the selected endpoint, callback, control, and signal retain identity. The Session separately clones declaration data and retains the original signal. I traced replacement through launch, subscription removal, settlement, and cancellation; independently executed the channel, Session, meter, and ticket ownership tests. Replacing the snapshots with the original options would change the endpoint receipt, remove listeners from the wrong endpoint, change the opening declaration, or call the replacement settlement callback; their assertions distinguish those mutations. See [CLI snapshot](C:/Users/mikes/WebstormProjects/study/src/server/launchers/StudyCLI.ts:22), [channel snapshot](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyChannel.ts:24), [Session snapshot](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyProcessSession.ts:49), [meter snapshot](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyRemoteMeter.ts:25), and [ticket snapshot](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyRemoteTicket.ts:14).

2. **CONFIRMED — Custody binds accepted identity and resources.** The caller-id mutation attack cannot alter the directory, retained trial entry, or starting reservation because those accesses use the private scheduled entry after admission. Replacing the sink descriptor after queuing an append cannot redirect that write or subsequent sync/close; mutating the original goal array and limits cannot admit foreign goals or larger writes. The descriptor and budget themselves remain live borrowed collaborators. I independently executed the sink tests, including actual failed descriptor I/O. Reverting the accepted-id uses would strand the starting reservation or terminal lookup and fail the seal assertion; removing the sink snapshot would change exact file contents, close the foreign handle, or admit the foreign goal. See [accepted id](C:/Users/mikes/WebstormProjects/study/src/server/stores/StudyResults.ts:103), [sink snapshot and admission](C:/Users/mikes/WebstormProjects/study/src/server/stores/StudyEvidenceSink.ts:20), [id mutation proof](C:/Users/mikes/WebstormProjects/study/tests/src/server/stores/StudyResults.test.ts:21), and [actual I/O refusal proof](C:/Users/mikes/WebstormProjects/study/tests/src/server/stores/StudyEvidenceSink.test.ts:139).

3. **CONFIRMED — Remote settlement retains the sent value.** The retained usage is the frozen value selected before transport, and usage is appended only after a correlated successful acknowledgment. Repeated settlements fail through the original owner; close checks unfinished admission/tickets and then drains settlement acknowledgments. I independently executed the mutation/acknowledgment tests and additional real-IPC probes: a rejected finish acknowledgment retained no usage and made close reject; mutation of failure.message after fail preserved the original sent and retained failure; acknowledged undefined token/byte usage remained accepted. Removing the accepted snapshot would fail the retained-usage equality in the mutation test. See [snapshot and acknowledgment](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyRemoteMeter.ts:100), [close admission check](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyRemoteMeter.ts:81), [repeated settlement](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyRemoteTicket.ts:34), and [mutation proof](C:/Users/mikes/WebstormProjects/study/tests/src/server/processes/StudyRemoteMeter.test.ts:103).

4. **BROKEN — A deadline exception bypasses output admission and retains an oversized product.** The engine assigns product before checking parent/goal scopes, then checks byte admission only if those checks return. A valid consumer driver can return a product after finite synchronous work crosses the goal deadline: the scope check throws, the catch preserves product, and the over-allowance branch is never reached. The independent probe used a 50 ms goal deadline, a 64-byte goal allowance, and a 100 ms synchronous turn returning a 100-character string (102 JSON bytes). Real StudyResults fulfilled execution and sealed that oversized product with deadline attribution. This is a data-retention failure after the synchronous work returns, not a demand to preempt trusted code. See [assignment before checks](C:/Users/mikes/WebstormProjects/study/src/core/engines/StudySeries.ts:216), [skipped omission](C:/Users/mikes/WebstormProjects/study/src/core/engines/StudySeries.ts:221), and [scope elapsed-time check](C:/Users/mikes/WebstormProjects/study/src/core/engines/StudyScope.ts:101).

   Smallest correction: compute whether the returned candidate fits all output allowances before any intervening scope check can throw, and retain it only when it fits. Preserve the original scope-check ordering and sticky first failure before assigning capacity attribution; continue consuming output budgets only on the successful admission path. Do not clear all products on exceptions. The adjacent control returning within-budget partial {value:'ok', partial:true} after the same deadline retained that product, kept the deadline cause, and sealed; this existing behavior must remain. The fast oversized control omitted the product with capacity attribution and sealed. The existing unconditional oversize cases distinguish deleting product omission, but do not distinguish this intervening deadline exception. Single-use, parent cancellation, late-session cleanup, and genuine custody-error propagation remain intact by the separate paths at [single use](C:/Users/mikes/WebstormProjects/study/src/core/engines/StudySeries.ts:41), [late opening cleanup](C:/Users/mikes/WebstormProjects/study/src/core/engines/StudySeries.ts:141), [open cleanup](C:/Users/mikes/WebstormProjects/study/src/core/engines/StudySeries.ts:250), and [terminal custody rejection](C:/Users/mikes/WebstormProjects/study/src/core/engines/StudySeries.ts:187).

   Exact probe and controls, executed through `node node_modules/vitest/vitest.mjs run --config vite.config.ts --project probe tmp/probes/ready-astra-deadline.test.ts` from C:/Users/mikes/WebstormProjects/study, follow. The final combined run collected these cases and produced one failure with both controls passing. The source is preserved here before deleting the temporary file.

   ```ts
   import type { StudyManifest, StudyProduct } from '../../src/core/types.js'
   import { createScratch } from '@orkestrel/test/server'
   import { join } from 'node:path'
   import { describe, expect, it } from 'vitest'
   import { StudySeries } from '../../src/core/engines/StudySeries.js'
   import { StudyResults } from '../../src/server/stores/StudyResults.js'
   import { readStudyResult } from '../../src/server/stores/helpers.js'
   import { buildCompactCustodyManifest, createStudyDriverFixture } from '../../tests/setupStudy.js'

   describe('Astra independent deadline/output admission intersection', () => {
       it.each([{ expired: false, oversized: true }, { expired: true, oversized: true }, { expired: true, oversized: false }])('retains only admitted output across a goal deadline: %j', async ({ expired, oversized }) => {
           const scratch = createScratch()
           const baseline = buildCompactCustodyManifest()
           const manifest: StudyManifest = {
               ...baseline,
               bounds: {
                   ...baseline.bounds,
                   request: { ...baseline.bounds.request, duration: 25, bytes: 16 },
                   goal: { ...baseline.bounds.goal, duration: 50, bytes: 64 },
               },
           }
           const driver = createStudyDriverFixture({
               execute: async (): Promise<StudyProduct> => {
                   if (expired) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
                   return { value: oversized ? 'x'.repeat(100) : 'ok', partial: true }
               },
           })
           const directory = join(scratch.path, 'result')
           const results = new StudyResults({ directory, manifest })
           try {
               await results.create()
               const attempts = await new StudySeries({ manifest, driver: driver.driver, store: results, signal: new AbortController().signal }).execute()
               await results.seal()
               const reading = await readStudyResult(directory)
               console.log(JSON.stringify({ expired, oversized, status: reading.status, product: attempts[0]?.observations[0]?.product, failure: attempts[0]?.failure }))
               expect(attempts[0]?.failure?.cause).toBe(expired ? 'deadline' : 'capacity')
               if (oversized) expect(attempts[0]?.observations[0]?.product).toBeUndefined()
               else expect(attempts[0]?.observations[0]?.product).toEqual({ value: 'ok', partial: true })
           } finally {
               scratch.destroy()
           }
       })
   })
   ```

5. **CONFIRMED — Native Task/Session close is bounded without manufacturing success.** I independently executed the real detached-leaf, ordinary-exit, malformed/repeated reply, combined-output, deadline, and abort tests. The detached leaf remained alive when Task rejected its missing response and Session fulfilled close with released parent pipes. The helper subscribes immediately after fork, arms only on exit, destroys stdout/stderr after the drain duration, and cancels its timer on ordinary close. Task still settles on close, so the helper does not replace IPC handling with an exit-time success. Already-observed native exit prevents PID signaling. Removing drain would fail the detached-leaf close observation; treating exit as success would fail the missing-response assertion; dropping response or output checks would fail the relevant refusal assertions. See [drain helper](C:/Users/mikes/WebstormProjects/study/src/server/processes/helpers.ts:104), [exited-root guard](C:/Users/mikes/WebstormProjects/study/src/server/processes/helpers.ts:119), [Task close settlement](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyTask.ts:112), [Task native proofs](C:/Users/mikes/WebstormProjects/study/tests/src/server/processes/StudyTask.test.ts:39), and [Session detached-leaf proof](C:/Users/mikes/WebstormProjects/study/tests/src/server/processes/StudyProcessSession.test.ts:82). This confirms the named Windows behavior, not orphan termination or Linux execution.

6. **CONFIRMED — IPC bounds preserve correlation and first failure.** I independently ran the actual child-IPC tests. The 65th outbound call rejected while all prior replies resolved and the channel remained usable. The 65th active inbound call closed the channel, rejected pending outbound work, started no handler beyond the limit, and allowed accepted handlers to reply after their gate released. Out-of-order, malformed, foreign, oversized, invalid failure, and disconnect cases remained refusals. Removing either admission bound would fail the excess-call assertion or active-handler count; closing the channel on outbound capacity would fail the original replies; suppressing replies after inbound closure would fail the accepted-handler drainage receipt. See [outbound bound](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyChannel.ts:53), [inbound bound](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyChannel.ts:123), [first failure](C:/Users/mikes/WebstormProjects/study/src/server/processes/StudyChannel.ts:79), [outbound proof](C:/Users/mikes/WebstormProjects/study/tests/src/server/processes/StudyChannel.test.ts:142), and [inbound proof](C:/Users/mikes/WebstormProjects/study/tests/src/server/processes/StudyChannel.test.ts:181).

7. **CONFIRMED — The repaired-path proofs discriminate their named mutations; the deadline/output intersection remains the claim 4 defect.** The ownership, accepted-id, product-omission, drain, and correlation assertions distinguish removing their respective repairs as identified in the preceding verdicts. Tests use actual engine classes, filesystem descriptors, and native children; consumer boundary fixtures do not replace those engines. The launcher deadline proof gives the real 60000 ms supervisor a 75000 ms observation window and a 90000 ms test budget. Its code/elapsed/liveness assertions would fail if the supervisor deadline were removed; the exit-7 control distinguishes ordinary exit, the isolated SIGINT proof distinguishes 130, and dispatch receipts distinguish at-ceiling from over-ceiling admission. I read the bare launcher log and error footer: its measured 60137 ms deadline case completed uncapped. See [launcher proof](C:/Users/mikes/WebstormProjects/study/tests/src/server/launchers/StudyLauncher.test.ts:26), [ordinary-exit control](C:/Users/mikes/WebstormProjects/study/tests/src/server/launchers/StudyLauncher.test.ts:55), [ceiling proofs](C:/Users/mikes/WebstormProjects/study/tests/src/server/launchers/StudyLauncher.test.ts:80), [SIGINT proof](C:/Users/mikes/WebstormProjects/study/tests/src/server/launchers/StudyLauncher.test.ts:123), [bare log](C:/Users/mikes/WebstormProjects/study/tmp/codex/ready-launcher-tests.jsonl:4), and [uncapped footer](C:/Users/mikes/WebstormProjects/study/tmp/codex/ready-launcher-tests.err:3). The guide explicitly bounds orphan cleanup and calls Linux unverified at [native close description](C:/Users/mikes/WebstormProjects/study/guides/study.md:703); it does not confer external quality acceptance.

8. **BROKEN — The drain exports have concrete guide/source summary drift.** Installed findDrift reports a summary mismatch for both additions. The constant's guide row says “Bounds inherited output handles after native exit as a cleanup limit.” while the source says “Bounds how long inherited output handles stay open after native exit, in milliseconds.” The helper's source summary also includes the orphan-limit paragraph, while its guide row contains only the first sentence. These are actual parity failures, independently reproduced against nonempty exported-symbol reflection; this verdict does not treat a pending gate as a defect. See [constant guide row](C:/Users/mikes/WebstormProjects/study/guides/study.md:170), [constant source](C:/Users/mikes/WebstormProjects/study/src/server/processes/constants.ts:10), [helper guide row](C:/Users/mikes/WebstormProjects/study/guides/study.md:318), [helper source](C:/Users/mikes/WebstormProjects/study/src/server/processes/helpers.ts:98), and [required parity assertion](C:/Users/mikes/WebstormProjects/study/tests/guides.test.ts:51). Smallest correction: align the constant row with its source summary and place the helper's explanatory limit under @remarks, or carry that full summary in its row. Keep the behavior limit documented.

   The exported paths themselves agree through [process barrel](C:/Users/mikes/WebstormProjects/study/src/server/processes/index.ts:2) and [server barrel](C:/Users/mikes/WebstormProjects/study/src/server/index.ts:6). No item-specific setup file or captured-loader widening appears in the supplied diff. The Process exclusion is accurately about origin: [Resolution](C:/Users/mikes/WebstormProjects/study/src/server/artifacts/Resolution.ts:52) admits child_process only from captured Study dist; the installed [Process stopChild contract](C:/Users/mikes/WebstormProjects/study/node_modules/@orkestrel/process/dist/src/server/index.d.ts:901) accepts a native-child boundary. The unchanged grading, seal, and captured-loader paths have no identified regression from these edits.

   Exact focused parity probe and corrected-text control follow. Run through the probe project as ready-astra-parity.test.ts. The nonempty export assertion is required: an initial probe without the barrel reflected no exported symbols and was discarded as evidence. The executed corrected probe printed both drift records; the corrected constant control produced none, while the current constant assertion failed. The additional helper equality below expresses the same observed helper drift.

   ```ts
   import { createGuide, createSource, findDrift } from '@orkestrel/guide'
   import { readFileSync } from 'node:fs'
   import { expect, it } from 'vitest'

   it('compares changed drain summaries with a corrected-text control', () => {
       const constants = readFileSync('src/server/processes/constants.ts', 'utf8')
       const helpers = readFileSync('src/server/processes/helpers.ts', 'utf8')
       const guide = readFileSync('guides/study.md', 'utf8')
       const source = createSource({
           files: {
               'src/server/processes/index.ts': "export * from './constants.js'\nexport * from './helpers.js'",
               'src/server/processes/constants.ts': constants,
               'src/server/processes/helpers.ts': helpers,
           },
           module: 'src/server/processes',
       })
       expect(source.surface().some((symbol) => symbol.name === 'STUDY_DRAIN_DURATION')).toBe(true)
       const helper = findDrift(createGuide(guide), source).filter((drift) => drift.key.includes('drainStudyChild'))
       const original = findDrift(createGuide(guide), source).filter((drift) => drift.key.includes('STUDY_DRAIN_DURATION'))
       const corrected = findDrift(createGuide(guide.replace('Bounds inherited output handles after native exit as a cleanup limit.', 'Bounds how long inherited output handles stay open after native exit, in milliseconds.')), source).filter((drift) => drift.key.includes('STUDY_DRAIN_DURATION'))
       console.log(JSON.stringify({ helper, original, corrected }))
       expect(corrected).toEqual([])
       expect(original).toEqual([])
       expect(helper).toEqual([])
   })
   ```

Findings outside the claims: none substantiated.

ADVISORY costs: none asserted.

Attacked and held: the expired, within-budget partial-product control preserves its output and deadline cause; the fast oversized control remains omitted. A detached descendant surviving root exit is the documented limit, not a failed cleanup claim. Actual descriptor I/O failure still rejects drainage. Undefined usage remains unknown rather than being fabricated as zero. The independent combined probe run executed the existing channel, Session, remote meter, remote ticket, Task, and sink proof tests successfully; the separate remote settlement probes passed 3/3. Linux, minimum-supported Node, final tree-wide gates, and release-mode packaged consumption remain unverified in this lane. No source or test file was edited, no broad gate ran, and the owned temporary probe files were removed before return.

VERDICT: FAIL 4, 8; outside the claims: none
