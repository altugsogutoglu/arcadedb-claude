---
description: "Record an architectural or implementation decision with rationale into the claude_memory graph."
argument-hint: "<summary> --rationale <reason>"
allowed-tools: Bash
---

# /graph-decision

Use this command to record a decision worth remembering across sessions.

## Args

- `<summary>` (positional): one-line decision summary in quotes.
- `--rationale <text>` (required): why this decision was made.
- `--repo <name>` (optional): which project this is about. Defaults to the project from SessionStart context, or "general" if unknown.
- `--db <name>` (optional): which memory DB. Defaults to `claude_memory`.
- `--session <id>` (optional): the ArcadeDB `:Session.id` to attach the decision to via `:DURING`. **The recipe auto-fills this** by reading `sessionDbId` from `~/.config/arcadedb/sessions/$CLAUDE_SESSION_ID.json` (the state file written by the SessionStart hook). As a secondary fallback, the `arcadedb-memory` CLI also honors the `ARCADEDB_SESSION_ID` env var if neither `--session` nor the state file is available.

## Behavior

Shell out to `arcadedb-memory record-decision`. Read the active session id from `~/.config/arcadedb/sessions/$CLAUDE_SESSION_ID.json` (field `sessionDbId`) and pass it via `--session`:

```bash
SESSION_FILE="$HOME/.config/arcadedb/sessions/${CLAUDE_SESSION_ID}.json"
SESSION_ID=""
if [ -f "$SESSION_FILE" ]; then
  SESSION_ID=$(grep '"sessionDbId"' "$SESSION_FILE" | head -1 | sed -E 's/.*"sessionDbId": *"([^"]+)".*/\1/')
  # guard against macOS/BSD sed returning the raw line on no-match
  case "$SESSION_ID" in
    [0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*) ;;
    *) SESSION_ID="" ;;
  esac
fi

arcadedb-memory record-decision "${1:-$ARGUMENTS}" \
  --rationale "${2:-RATIONALE_FROM_ARGS}" \
  --repo "${3:-CURRENT_PROJECT}" \
  ${SESSION_ID:+--session "$SESSION_ID"} \
  --db claude_memory
```

If `arcadedb-memory` is not on PATH, instruct the user to install `arcadedb-agent-memory` first.

## Example

```
/graph-decision "Use ArcadeDB instead of Neo4j" --rationale "GPL avoidance + Apache 2.0 license for the suite" --repo project-a
```

This writes a `:Decision` node to `claude_memory` with a UUID, the summary, rationale, current timestamp, and repo. If the SessionStart hook has captured a session for this Claude Code session, the decision is also linked via `-[:DURING]->(:Session)`. Returns the UUID.

## When to use this

After any conversation outcome that is:
- Non-obvious (not derivable from the code)
- Likely to be relevant later (next session, next teammate)
- A choice between alternatives with a reason

Examples worth recording:
- Library or framework choices ("we picked X over Y because Z")
- Reversed decisions ("we tried X, switching to Y because ...")
- Subtle constraints that affect future work ("never use deep equality on these objects because ...")

Not worth recording:
- Trivial code fixes
- Style choices that match existing patterns
- Single-session debugging steps
