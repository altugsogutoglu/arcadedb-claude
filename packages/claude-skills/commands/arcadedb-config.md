---
description: "Show or change ArcadeDB plugin settings (server, user, password, memory DB, auto-index), test the connection, forget a project, or index now. Everything else is automatic."
argument-hint: "[show | set <key> <value> | test | forget <project> [--drop-db] | index [<project>]]"
allowed-tools: Bash
---

# /arcadedb-config

The only knob. Defaults: server `http://localhost:2480`, user `root`, memory DB `claude_memory`, auto-index on. Settings live in `~/.config/arcadedb/.env`; shell `ARCADEDB_*` variables override the file.

Run the bundled CLI. `$ARGUMENTS` is passed through verbatim; with no arguments run `show`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/cli.js" config ${ARGUMENTS:-show}
```

## Subcommands

- `config show`: every setting with its source, server status, registered projects.
- `config set server http://host:port`, `config set user <name>`, `config set password <pw>`, `config set memory-db <name>`, `config set auto-index on|off`. Server/user/password changes print the probe result.
- `config test`: probe the server and print the result.
- `config forget <project> [--drop-db]`: remove a project from the registry. Before passing `--drop-db`, confirm with the user; it deletes the project's graph database.
- `config index [<project>]`: index now, in the foreground (the plugin also does this automatically in the background).

Print the CLI output as-is. If the output says the server is unreachable or unauthorized, tell the user which `config set` command fixes it.
