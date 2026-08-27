# Glossary

Domain terminology for arcadedb-claude. One line per term. Add when a word gets used in two places with two meanings.

- **ArcadeDB**: multi-model DB (graph + document + vector) this suite writes to. Runs locally, HTTP API.
- **claude_memory**: shared memory database. Holds :Decision, :Insight, :Session, :Question, :Answer.
- **Project DB**: per-project code graph database (e.g. arcadedb_claude). Holds :Repo, :Module, :File, :IMPORTS, :CONTAINS, :CALLS.
- **Extractor**: subagent that reads a transcript slice and emits triples for claude_memory.
- **extract-write**: CLI that validates extractor output, writes JSONL audit batch, and (live mode) writes to graph.
- **Live / dryrun / off**: ARCADEDB_EXTRACTOR modes. dryrun writes JSONL only.
- **Hybrid memory**: vector (recall by meaning) + graph (recall by relationship) in one ArcadeDB store. See ADR-0001.
- **Indexer**: arcadedb-code-indexer. Walks a repo, writes code structure into project DB.
- **projects.json**: registry mapping local repo paths to project DB names (~/.config/arcadedb/). Entries are auto-created on SessionStart inside a git repo (0.6.2+); each entry tracks indexing state as of 0.7.0.
- **capture.log**: ~/.config/arcadedb/capture.log. JSONL of every extractor trigger, skip, write, and failure.
- **stale.log**: per-project log of edits since the last index run. Read by the background indexer to decide if a re-index is due.
- **/arcadedb-config**: slash command with subcommands show, set, test, forget, index. Replaces /arcadedb-init (0.7.0).
