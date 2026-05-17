# arcadedb-claude

ArcadeDB-powered graph intelligence for Claude Code. Four packages, one repo.

```
arcadedb-claude/
├── packages/
│   ├── agent-memory/    ← schemas + HTTP client + memory helpers + CLI
│   ├── code-indexer/    ← walks a code repo into an ArcadeDB graph
│   ├── obsidian-sync/   ← syncs an Obsidian vault into ArcadeDB
│   └── claude-skills/   ← Claude Code plugin (hooks, skills, slash commands)
└── .claude-plugin/marketplace.json
```

## Install the Claude Code plugin

```
/plugin marketplace add altugsogutoglu/arcadedb-claude
/plugin install arcadedb-claude-skills@arcadedb-claude
```

That's it. Hooks are pre-bundled; no `npm install`, no global PATH setup required.

## Use the libraries standalone

Each package is also published to npm independently:

```
npm i arcadedb-agent-memory
npm i arcadedb-code-indexer
npm i obsidian-to-arcadedb
```

## Dev

```
npm install        # one install, hoisted across workspaces
npm run build      # builds all packages
npm test           # runs vitest in all packages
```

## License

MIT
