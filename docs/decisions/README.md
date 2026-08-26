# Decisions (ADRs)

Architecture Decision Records. One file per decision, numbered sequentially:
`0001-short-slug.md`.

## Format

```markdown
# NNNN - Short title

**Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
**Date:** YYYY-MM-DD

## Context

(What problem are we solving? What constraints apply?)

## Decision

(What did we decide?)

## Consequences

(What follows: positive, negative, neutral?)

## Alternatives considered

(What else did we look at? Why reject it?)
```

## Conventions

- ADRs are immutable once Accepted. To revise, write a new ADR that supersedes the
  old one and update the old one's Status line.
- Every meaningful decision gets an ADR.
- Cross-reference ADRs in JOURNAL entries by number (e.g., "see ADR-0001").
