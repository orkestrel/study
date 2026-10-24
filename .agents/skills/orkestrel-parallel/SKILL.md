---
name: orkestrel-parallel
description: >-
  Run several writer lanes in one checkout at the same time, coordinated by messages: writers edit owned regions in phases, one runner lane owns every test and check process, and the Orchestrator rules and mediates. Use when a campaign has three or more units whose files are mostly disjoint and whose shared files are a few kind files, guides, or entry tests. Do not use it when two units rewrite the same region, when a unit needs a quiet tree for a measurement, or when the harness gives lanes no shared file system or no message channel that wakes an idle lane.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-parallel/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-parallel/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; `AGENTS.md`, the applicable
rules, and the canonical skill remain authoritative in that order.
