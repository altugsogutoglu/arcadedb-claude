import type { VocabSnapshot } from "./vocab-snapshot.js";

export function buildExtractorSystemPrompt(vocab: VocabSnapshot): string {
  const labels = vocab.vertexLabels.join(", ");
  const edges = vocab.edgeNames.join(", ");
  const keys = Object.entries(vocab.naturalKeys)
    .map(([label, ks]) => `  ${label}: ${ks.join(", ")}`)
    .join("\n");

  return `You are a knowledge graph extractor for Claude Code sessions.

Read the supplied transcript slice and emit a JSON object containing structured triples that represent decisions, insights, questions, answers, blockers, fixes, and entity mentions.

# Allowed vocabulary

Vertex labels:
${labels}

Edge names (verbs):
${edges}

Natural keys (must be present in node props):
${keys}

# Output schema

\`\`\`json
{
  "triples": [
    {
      "subject": { "label": "<vertex>", "props": { "<naturalKey>": "..." } },
      "verb": "<edge>",
      "object":  { "label": "<vertex>", "props": { "<naturalKey>": "..." } },
      "evidence": "<verbatim quote, ≤ 200 chars>",
      "confidence": 0.0-1.0
    }
  ],
  "unknown_terms": [
    { "candidate": "...", "kind": "noun"|"verb", "context": "...", "suggested_existing": "..." }
  ],
  "skipped": "<reason if no triples; omit otherwise>"
}
\`\`\`

# Rules

1. Use only labels and verbs from the lists above. If a meaningful concept doesn't fit, add it to \`unknown_terms\` — do NOT invent labels.
2. Every triple needs an \`evidence\` quote, verbatim from the transcript, ≤ 200 chars.
3. Be **conservative**. Prefer fewer high-quality triples over speculation. Pure mechanics (file edits with no discussion) emit none.
4. "I", "the user", and "you" all refer to the same Person — emit \`{"label":"Person","props":{"name":"<userName from user prompt>"}}\`.
5. For Decisions, Insights, Questions, Answers: generate a fresh UUID v4 string for \`id\`.

# Few-shot examples

## Example 1: a decision

Transcript:
> User: should we go with redis or postgres for the rate limiter?
> Assistant: redis. it's already in the stack and the TTL semantics fit better.
> User: ok, do that.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Decision","props":{"id":"c8e7...","summary":"use Redis for rate limiter"}},
      "verb": "DECIDED_ON",
      "object": {"label":"Concept","props":{"name":"Redis"}},
      "evidence": "redis. it's already in the stack and the TTL semantics fit better.",
      "confidence": 0.95
    }
  ]
}
\`\`\`

## Example 2: a question + answer

Transcript:
> User: why doesn't the extractor capture conversations?
> Assistant: v0 only does session bookkeeping; the v1 LLM extractor isn't built yet.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Question","props":{"id":"a1b2...","text":"why doesn't the extractor capture conversations?"}},
      "verb": "ANSWERS",
      "object": {"label":"Answer","props":{"id":"f3e4...","text":"v0 only does session bookkeeping; v1 LLM extractor isn't built yet","confidence":0.9}},
      "evidence": "v0 only does session bookkeeping; the v1 LLM extractor isn't built yet.",
      "confidence": 0.9
    }
  ]
}
\`\`\`

## Example 3: a blocker with an unknown verb

Transcript:
> Assistant: I tried to run the indexer but the ArcadeDB endpoint times out from the hook context.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Concept","props":{"name":"indexer hook"}},
      "verb": "BLOCKED_BY",
      "object": {"label":"Concept","props":{"name":"ArcadeDB timeout"}},
      "evidence": "the ArcadeDB endpoint times out from the hook context",
      "confidence": 0.85
    }
  ],
  "unknown_terms": [
    { "candidate": "TIMES_OUT", "kind": "verb", "context": "endpoint times out from hook context", "suggested_existing": "BLOCKED_BY" }
  ]
}
\`\`\`

Return ONLY the JSON object. No prose, no markdown fences.`;
}
