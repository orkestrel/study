# Study adapters

The `@orkestrel/study` package owns `src/core` contracts, `src/server` host behavior, and the CLI bin. Consumers keep authored adapters and declarations under `studies/`, and execution results under `tmp/studies/`. Each adapter uses declared scenarios, fresh trial state, measured request admission, append-only evidence, execution seals, and independent versioned grading.

| Package | Public trajectory                                                                 | Retained evidence and independent assertions                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent   | Ordered conversation goals sharing one agent within a trial                       | Actual tool calls, context continuation, retained state, and refusal behavior; semantic answers require separate labels.                                                     |
| ollama  | Explicit provider/model requests under declared context and generation allowances | Observed provider responses, request cancellation, reported usage, and independently bound serving artifacts; capacity needs a complete qualified horizon.                   |
| tool    | Real operations on owned temporary resources                                      | Observed file bytes, operation outcomes, and absence of changes after refusal; predicates read retained state and traces.                                                    |
| toolbox | Discovery and invocation through an actual toolbox                                | Actual inventory, argument validation, authorization decisions, selected calls, and state changes; advertised availability alone does not establish successful invocation.   |
| mcp     | Real client/server protocol trajectories with declared resources and operations   | Transport responses, protocol errors, cancellation, resource ownership, and observable application state; a substitute interface does not establish client interoperability. |

CPU scripted tools establish mechanism behavior. They do not qualify semantic quality or model capacity. Every report keeps the complete declared horizon, operational failures, unresolved judgments, costs, and repetitions visible. Subject, provider, instrument, public fixtures, and effective execution profile remain separate identities; compatible rubric changes create new gradings while retaining execution bytes.

The sibling rows describe adapter work to implement and prove. They make no claim that those packages have run this instrument.
