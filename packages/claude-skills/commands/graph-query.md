---
description: "Translate a natural-language question into a Cypher query against the ArcadeDB graph and return the result."
argument-hint: "<question or cypher>"
allowed-tools: Bash
---

# /graph-query

Run a query against the ArcadeDB graph. Accepts either a natural-language question (which Claude translates to Cypher) or raw Cypher.

## Behavior

1. If the argument starts with `MATCH`, `CREATE`, `RETURN`, or other Cypher keywords, treat as raw Cypher.
2. If the question is about past conversation by meaning ("what did we say about X", "have we discussed Y", "how did we solve Z last time", anything fuzzy), use semantic search instead of Cypher:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/cli.js search "<question>" --limit 10
   ```
   Add `--types Turn` for raw conversation only, `--types Decision,Insight` for distilled notes, `--repo <name>` to scope, `--json` for context/related turns as data. Search is hybrid (vector + full-text + ref); exact identifiers work as-is. If the question names a file, class, commit or ticket ("where did we touch HeisterkampClient"), prefer:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/cli.js refs HeisterkampClient
   ```
   Without the embedding runtime, search still answers from full-text and refs (a note goes to stderr).
3. Otherwise, translate the question to Cypher using the schema cheat-sheet from `arcadedb-graph` skill.
4. Determine the target DB:
   - For code-intelligence questions ("what calls", "what imports", "files in"), use the project DB from SessionStart context.
   - For memory questions ("decisions about", "have we tried"), use `claude_memory`.
5. Execute via the MCP server (preferred) or shell+curl fallback (see `arcadedb-graph` skill).
6. Return the result. If empty, say so explicitly; do not fabricate.

## Examples

```
/graph-query "what files import the Button component?"
```

Translates to:
```cypher
MATCH (b:File {path: '<project>/components/Button.tsx'})<-[:IMPORTS]-(f:File) RETURN f.path
```

```
/graph-query "MATCH (d:Decision) WHERE d.repo='project-a' RETURN d.summary, d.decidedAt ORDER BY d.decidedAt DESC LIMIT 5"
```

Runs the raw Cypher directly.

## Limitations

- Path aliases and external packages are stored as unresolvedImports strings, not as edges. Queries about external libraries will return strings, not file nodes.
- The graph is only as fresh as the last `/graph-index`. If results look stale, re-run indexing.
