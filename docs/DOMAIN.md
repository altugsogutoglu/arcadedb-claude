# Domain

Business and problem context for arcadedb-claude. Not code structure (see README).

## Problem

AI coding agents are stateless. Decisions, insights, and cross-repo structure evaporate each session.

## Users

- Solo developer running Claude Code across many repos (primary: the maintainer).
- Anyone running an Anthropic/OpenAI SDK agent that can shell out to a CLI.

## Core loop

1. SessionStart hook injects project graph context.
2. During session, agent queries graph (/graph-query, arcadedb-graph skill) before structural answers.
3. Extractor captures decisions/insights/Q&A into claude_memory.
4. Next session recalls by graph, later by meaning (vector, ADR-0001).

## Competitors / adjacent

- claude-mem: vector-only, hosted sync option. Reference point, not target.
- Obsidian vault: user's second brain. Synced in via the `obsidian-sync` CLI.
