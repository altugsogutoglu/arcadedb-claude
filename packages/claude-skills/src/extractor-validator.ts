import type { VocabSnapshot } from "./vocab-snapshot.js";

export interface Triple {
  subject: { label: string; props: Record<string, unknown> };
  verb: string;
  object: { label: string; props: Record<string, unknown> };
  evidence?: string;
  confidence?: number;
}

export interface InvalidTriple {
  triple: Triple;
  reason: string;
}

export type ValidationResult =
  | { ok: false; reason: string }
  | { ok: true; valid: Triple[]; invalid: InvalidTriple[]; pendingVocab: Triple[]; unknownTerms: unknown[] };

export function validateExtraction(raw: string, vocab: VocabSnapshot): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `JSON parse failure: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "expected JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.triples)) {
    return { ok: false, reason: "missing or invalid triples array" };
  }

  const labels = new Set(vocab.vertexLabels);
  const edges = new Set(vocab.edgeNames);
  const valid: Triple[] = [];
  const invalid: InvalidTriple[] = [];
  const pendingVocab: Triple[] = [];

  for (const t of obj.triples as Triple[]) {
    if (!t.evidence || typeof t.evidence !== "string") {
      invalid.push({ triple: t, reason: "missing evidence" });
      continue;
    }
    if (!labels.has(t.subject?.label) || !labels.has(t.object?.label) || !edges.has(t.verb)) {
      pendingVocab.push(t);
      continue;
    }
    const subKey = (vocab.naturalKeys[t.subject.label] ?? [])[0];
    const objKey = (vocab.naturalKeys[t.object.label] ?? [])[0];
    if (!subKey || t.subject.props?.[subKey] == null) {
      invalid.push({ triple: t, reason: `missing natural key '${subKey}' on subject ${t.subject.label}` });
      continue;
    }
    if (!objKey || t.object.props?.[objKey] == null) {
      invalid.push({ triple: t, reason: `missing natural key '${objKey}' on object ${t.object.label}` });
      continue;
    }
    valid.push(t);
  }

  return {
    ok: true,
    valid,
    invalid,
    pendingVocab,
    unknownTerms: Array.isArray(obj.unknown_terms) ? obj.unknown_terms : [],
  };
}
