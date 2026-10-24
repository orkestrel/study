---
name: orkestrel-parallel
description: >-
  Run several writer lanes in one checkout at the same time, coordinated by messages: writers edit owned regions in phases, one runner lane owns every test and check process, and the Orchestrator rules and mediates. Use when a campaign has three or more units whose files are mostly disjoint and whose shared files are a few kind files, guides, or entry tests. Do not use it when two units rewrite the same region, when a unit needs a quiet tree for a measurement, or when the harness gives lanes no shared file system or no message channel that wakes an idle lane.
---

# Load the canonical workflow

Read `.agents/skills/orkestrel-parallel/SKILL.md` completely, then read every reference it requires. Follow that canonical workflow before acting.

This bridge contains no independent process. `AGENTS.md`, applicable rules, the canonical skill, and the governing guide/spec remain authoritative in that order.
