# Agent studies

Adopt **study** as the optional comparison surface, owned by the agent checkout as unpublished development tooling under **studies/**. This is the design recommendation from the user-requested Opus5.5 adversarial round and Fable5.1 synthesis on 2026-10-14. No command, folder move, or published API has been implemented.

See [Fable's final synthesis](study-synthesis.md) for the complete design and reconciliation. The original proposal, blind Opus proposal, and Opus adversarial review are archived at commit cdb94447248fc0b135dc62dd3a81ae244d8bb2a9 under their original study-original.md, study-independent.md, and study-review.md paths in .orkestrel/agent. The [round receipt](study-round.json) retains their historical paths and byte hashes. The [acceptance record](study-round.md) retains the resolved findings. Active implementation uses [the implementation plan](study-implementation.md) and its adjacent final design.

## Proposed surface

The command flow separates local checks, paid execution, paid grading, and report rendering:

```text
npm run study -- check memory
npm run study -- execute capacity --profile local
npm run study -- execute memory --profile local
npm run study -- grade <result>
npm run study -- report <result> --grade <digest>
```

A study declares the question. A scenario supplies continuing work. A trial executes one arm on one scenario from a clean initial world and fresh arm memory, preserving memory within the trajectory. A result retains one execution's evidence. A grading retains a versioned set of judgments over that evidence. The internal series schedules trials.

The proposed durable tree is in the agent checkout:

```text
studies/
  study.ts
  capacity/study.json
  memory/study.json
  memory/scenarios/
  memory/results/<id>/manifest.json
  memory/results/<id>/trials/
  memory/results/<id>/grades/<digest>/
```

Keep held-out truth outside agent-visible inputs and the published package. A checkout-local development oracle is not secret merely because it is named private. Raw evidence can use local or external artifact storage; retain its digests and preserve the bytes needed for any replay claim.

## Measurement decisions

Use the whole declared scenario as the main denominator. Keep served-only comparisons secondary and restricted to common served goals. Report capacity, infrastructure, grading, and task outcomes separately, along with facts, completed work, obligations, critical violations, coverage, and actual per-role costs. An ordinary incomplete answer is an outcome to measure; it does not invalidate an otherwise measurable configuration. Unknown or unscored judgments must stay visible as unknown, rather than silently becoming successful or disappearing.

Freeze failure predicates and retry policy before execution. Preserve every attempt. Infrastructure re-execution must remain within a declared finite policy and aggregate budget; it cannot reset allowances until the result improves. Request retries and re-executed scenario groups need distinct identities. Keep GPU calls serial and record host load; counterbalance future repeated comparisons.

Use state and trace predicates where the evidence permits exact checks. Use blind, human-calibrated semantic grading for criteria that require interpretation. Keep grading revisions separate from immutable trajectories. A no-action control may legitimately succeed on refusal or abstention, but its reasoning and evidence still need checking.

Treat the 96-goal sequence as one dependent trajectory. Report a single execution descriptively; add independent repeats only when a decision needs consistency evidence. Equal context/output envelopes do not imply equal compute.

## Adoption boundary

Finish the active capacity comparison before promotion. Preserve ignored historical artifacts before retiring the campaign; leave frozen manifests unchanged as provenance. Bind future measurements to the actually loaded vendor, workspace, or installed tarball artifact, and label those subjects distinctly. A qualification must also bind its instrument and fixture/configuration identity; a profile name alone is insufficient.

The implementation unit must wire the development entry, typecheck/test scope, artifact identities, bounded re-grading, and custody migration under the existing workspace rules. Fable's request for a separate confirmation of the development-tool distinction is an interpretation, not an approval requirement in the authority. This proposal creates no approval step and changes no campaign-retirement rule.

See the [article review](study-article.md), [methods matrix](study-methods.md), and [naming evidence](study-canon.md) for the research. The naming evidence predates the adversarial round; its scaffold ownership sketch is superseded by this recommendation.
