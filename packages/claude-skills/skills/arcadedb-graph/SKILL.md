---
name: arcadedb-graph
description: "Query the ArcadeDB graph (code intelligence + memory) before answering structural questions or recording decisions. Triggers on: how does X work, what calls X, what depends on X, where is X defined, decision about X, why did we choose X, what did we decide, prior decisions, related insights, find in graph, search graph, query graph."
allowed-tools: Bash
---

# arcadedb-graph: Query the ArcadeDB Graph

This project has an ArcadeDB graph with two databases:
- The **project graph** (named in `~/.config/arcadedb/projects.json`) holds code intelligence: `:Repo`, `:Module`, `:File`, `:Class`, `:Function`, `:Route`, `:Component`, `:Person`; edges `:CONTAINS`, `:IMPORTS`, `:CALLS`, `:EXTENDS`, `:IMPLEMENTS`, `:HANDLES`, `:RENDERS`.
- The **memory graph** (default: `claude_memory`) holds agent context: `:Turn` (every prompt and answer, raw), `:Decision`, `:Insight`, `:Session`, `:Question`, `:Answer`; edges `:ABOUT`, `:DURING`, `:FOLLOWS`, `:ANSWERS`, `:SUPERSEDES`. `:Turn` and the note types carry a local `embedding` and a FULL_TEXT index; each `:Turn` `-[:MENTIONS]->` `:Ref` nodes (`kind` path|symbol|commit|ticket|url, `value`) extracted without a model. `node ${CLAUDE_PLUGIN_ROOT}/hooks/cli.js search "<question>"` fuses vector, full-text and ref lookup and returns hits with session context and related turns across repos; `... refs <value>` lists every turn naming a file, class, commit or ticket.

Run `mcp__arcadedb__get_schema database=<db-name>` (or `/graph-status`) to confirm which types actually exist in your DB — the indexer only writes types the parser populates, so `:Function`/`:Class`/`:Route`/`:Component` may be absent until call-graph / route extraction lands.

Use the graph instead of reading files when the question is structural ("how does X work", "what calls X") or memory-related ("decisions about X", "have we tried Y before").

## When to use

Trigger on the user asking:
- "How does X work?" — query the project graph for X's incoming and outgoing edges.
- "What calls X?" — `MATCH (caller:Function)-[:CALLS]->(:Function {name: 'X'}) RETURN caller`.
- "What depends on X?" — reverse traversal of `:IMPORTS` from X.
- "Have we decided about X?" — `MATCH (d:Decision) WHERE d.summary CONTAINS 'X' RETURN d.summary, d.rationale, d.repo`.
- "What did we learn about X?" — search `:Insight` nodes.

## How to query

The graph is accessed via the `arcadedb-memory` MCP server (preferred, if available) or via shell:

```bash
# preferred: MCP tool
mcp__arcadedb__query database=<db-name> language=cypher query="MATCH (f:File) RETURN f.path LIMIT 10"

# fallback: shell with curl + jq
curl -s -u "root:$(grep ARCADEDB_ROOT_PASSWORD ~/.config/arcadedb/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:2480/api/v1/query/<db-name>" \
  -d '{"language": "cypher", "command": "MATCH (f:File) RETURN f.path LIMIT 10"}' \
  | jq -r '.result[]'
```

## Workflow

1. **Identify the database.** The SessionStart hook printed which DB this project uses. If unsure, run `arcadedb-memory status` or `/graph-status`.
2. **Pick the right vertex types.** Code questions use the project DB; memory questions use `claude_memory`.
3. **Write a Cypher query.** Prefer `MATCH ... RETURN ... LIMIT N` patterns. Use `count(<var>)` not `count(*)` (ArcadeDB overcounts the wildcard in patterns).
4. **Run it via MCP or shell.** Cite the result in your answer.
5. **Don't fabricate.** If the graph returns nothing, say so. The graph may be stale; suggest re-running `/graph-index`.

## Recording decisions and insights

After a non-obvious decision in conversation, use `/graph-decision "<summary>" --rationale "<reason>"` to persist it. After a non-obvious finding worth keeping, use `/graph-insight` (manual `arcadedb-memory record-insight` for now).

## Schema cheat-sheet

| Vertex type | Domain | Key properties |
|---|---|---|
| `:Repo` | core | `name` (pk), `path`, `stack`, `lastIndexedAt` |
| `:Person` | core | `name` (pk), `email`, `role` |
| `:Module` | code | `name`, `path` (pk), `language` |
| `:File` | code | `path` (pk), `language`, `loc`, `hash`, `modifiedAt` |
| `:Class` | code | `name`, `kind`, `exported` |
| `:Function` | code | `name`, `signature`, `async`, `exported`, `kind` |
| `:Route` | code | `path`, `method`, `framework` |
| `:Component` | code | `name`, `path`, `kind` |
| `:Turn` | memory | `id` (pk), `sessionId`, `idx`, `role` (user/assistant), `text`, `ts`, `repo`, `embedding` |
| `:Ref` | memory | `id` (pk, `kind:value`), `kind` (path/symbol/commit/ticket/url), `value`; `(:Turn)-[:MENTIONS]->(:Ref)` |
| `:Session` | memory | `id` (pk), `startedAt`, `endedAt`, `repo`, `summary` |
| `:Decision` | memory | `id` (pk), `summary`, `rationale`, `decidedAt`, `repo` |
| `:Insight` | memory | `id` (pk), `topic`, `text`, `createdAt`, `repo` |
| `:Question` | memory | `id` (pk), `text`, `askedAt`, `repo` |
| `:Answer` | memory | `id` (pk), `text`, `answeredAt`, `confidence` |

| Edge type | Domain | Typical pattern |
|---|---|---|
| `:CONTAINS` | code | `(:Repo)-[:CONTAINS]->(:Module)-[:CONTAINS]->(:File)` |
| `:IMPORTS` | code | `(:File)-[:IMPORTS]->(:File)` |
| `:CALLS` | code | `(:Function)-[:CALLS]->(:Function)` |
| `:EXTENDS` | code | `(:Class)-[:EXTENDS]->(:Class)` |
| `:IMPLEMENTS` | code | `(:Class)-[:IMPLEMENTS]->(:Class)` |
| `:HANDLES` | code | `(:Function)-[:HANDLES]->(:Route)` |
| `:RENDERS` | code | `(:Component)-[:RENDERS]->(:Component)` |
| `:ABOUT` | memory | `(:Decision|:Insight|:Question)-[:ABOUT]->(:Repo|:File|...)` |
| `:DURING` | memory | `(:Decision|:Insight)-[:DURING]->(:Session)` |
| `:FOLLOWS` | memory | `(:Session)-[:FOLLOWS]->(:Session)` |
| `:ANSWERS` | memory | `(:Answer)-[:ANSWERS]->(:Question)` |
| `:SUPERSEDES` | memory | `(:Decision)-[:SUPERSEDES]->(:Decision)` |

The `business` (`:Store`, `:Product`, `:Category`, `:Order`, `:Customer`, `:Concept`; edges `:SELLS`, `:BELONGS_TO`, `:PLACED`, `:CONTAINS_PRODUCT`) and `notes` (`:Note`, `:Tag`; edges `:LINKS_TO`, `:TAGGED`, `:MENTIONS`) domains exist as optional schemas — apply with `arcadedb-memory migrate <db> --domains business,notes` if needed.
