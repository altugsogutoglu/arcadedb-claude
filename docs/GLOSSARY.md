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
- **projects.json**: registry mapping local repo paths to project DB names (~/.config/arcadedb/).
