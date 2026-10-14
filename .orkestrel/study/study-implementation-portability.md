# Package and workspace evidence

Root-saved distillate of native Luna-max `study_portability`, 2026-10-14. No edits, tests, builds, services, or models were run.

| Package | Actual-use seam | Observable and limitation | Evidence |
| --- | --- | --- | --- |
| agent | createAgent(provider, options), context/conversation/window strategies | AgentResult content/usage/partial plus chunks/tool events; external state/obligation checks decide success. Scripted provider proves mechanism, not model quality. | src/core/agents/factories.ts:67, src/core/agents/types.ts:325, tests/src/core/integration.test.ts:254 |
| ollama | OllamaProvider, OllamaJudge, createOllama from public core entry | Real model content/tools/thinking/usage; model claims require the daemon. Recording transports prove the wire only. | ../ollama/src/core/OllamaProvider.ts:33, ../ollama/src/core/types.ts:65, ../ollama/tests/service/OllamaProvider.test.ts:27 |
| tool | createTool/createToolManager and ToolManager.execute | Correlated ToolResult and real handler state change; isolated state, no GPU. | ../tool/src/core/factories.ts:38, ../tool/src/core/types.ts:221, ../tool/tests/src/core/tools/ToolManager.test.ts:478 |
| toolbox | createDatabaseTool/createWorkflowTool; core and server entries | Returned result plus database/workflow state; existing memory-backed tests need no model. | ../toolbox/src/core/factories.ts:465, ../toolbox/src/core/factories.ts:1138, ../toolbox/tests/src/core/factories.test.ts:1041 |
| mcp | Public core/browser/server, client connect/list/call, real server/HTTP transport | Version/advertised tools/native call outcome/remote effects; local socket and cleanup. Foreign-client compatibility requires an actual foreign client. | ../mcp/src/core/factories.ts:74, ../mcp/src/core/factories.ts:132, ../mcp/tests/src/server/integration.test.ts:35 |

Common mechanism: isolated scenario execution, clean initial state per arm, retained trace/native output, budgets, status, artifact identity. Package adapters own actual public calls and reset/cleanup. Text alone cannot establish task success.

Agent directly declares and installs abort 0.0.13, budget 0.0.13, contract 0.0.19, timeout 0.0.13, and tool 0.0.19. Reuse their cancellation, accumulation, guard/parser, deadline, and registry surfaces. Inspect installed declarations before implementing overlapping primitives. Ollama and toolbox are absent from root dependencies and node_modules. MCP 0.0.38 is installed but is not an agent dependency. Only agent and tool are available as supported package entries without a dependency decision. A sibling source import would measure that source path, not a package entry.

The root Vite configuration owns the factories and registry. srcCore(override) at vite.config.ts:119 receives birth-owned configs/src/vite.core.config.ts options; it collects tests/src/core only at vite.config.ts:131. No study project exists at vite.config.ts:247. tests/studies would not be collected by present gates. A direct Node study-test command can join the authored npm test chain; adding a Vite project requires changing the generated root configuration through its supported mechanism.

Root tsconfig maps @orkestrel/agent to source and includes ordinary studies TypeScript by default. Runtime package exports resolve to dist/src/core/index.js. Its existing bytes were observed, freshness was not established. Record actual resolution and loaded artifact/dependency identity, not the source alias. The published allowlist is dist/src and README.md; no study binary/export exists. Node >=22.12.0 is the declared floor, and the guide gate demonstrates --experimental-strip-types.

The background series owns the GPU. Real model and MCP foreign-client claims remain unmeasured by this reader. The primary research supports methods, not a demonstrated winner in this package's comparison.

## Root verification after the reader

Scaffold has a supported generation path if app environments are selected: ../scaffold/guides/scaffold.md:661 says audit/repair derive environment axes from directories; its writable-script description at line 757 distinguishes generated direct scripts from maintainer-owned check/build/test aggregates. Using installed scaffold repair after adding authored environment facts is distinct from manually editing its managed copies. Exact repair effects still need a scratch target audit before applying them to the live checkout. No such repair has run.

The orkestrel-build skill describes app/server as a private Node runtime built to dist/app/server/main.cjs with only node modules external. This makes bundled subject imports a provenance risk: the subject must still execute from its explicit measured artifact, not from an inlined alias. An app split is a design option, not an established implementation.
