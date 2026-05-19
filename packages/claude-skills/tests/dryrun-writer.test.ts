import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDryrunBatch } from "../src/dryrun-writer.js";

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-dryrun-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("writeDryrunBatch", () => {
  it("appends a batch meta line followed by one triple line per valid triple", () => {
    writeDryrunBatch({
      sessionDbId: "test-sess",
      claudeCodeSessionId: "claude-sess",
      turnRange: "1..10",
      valid: [{
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "use redis",
      }],
      invalid: [],
      pendingVocab: [],
      unknownTerms: [],
    });

    const path = join(tmpHome, ".config", "arcadedb", "dryrun", "test-sess.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const meta = JSON.parse(lines[0]);
    expect(meta.kind).toBe("batch");
    expect(meta.turnRange).toBe("1..10");
    expect(meta.counts.valid).toBe(1);

    const triple = JSON.parse(lines[1]);
    expect(triple.kind).toBe("triple");
    expect(triple.triple.verb).toBe("DECIDED_ON");
    expect(triple.cypher).toMatch(/MERGE \(s:Person/);
    expect(triple.cypher).toMatch(/MERGE \(o:Concept/);
  });

  it("emits batch meta even when there are no triples", () => {
    writeDryrunBatch({
      sessionDbId: "s2",
      claudeCodeSessionId: "c2",
      turnRange: "1..3",
      valid: [],
      invalid: [{ triple: { subject:{label:"Person",props:{}}, verb:"DECIDED_ON", object:{label:"Concept",props:{name:"x"}}, evidence: "" } as any, reason: "missing evidence" }],
      pendingVocab: [],
      unknownTerms: [],
    });
    const path = join(tmpHome, ".config", "arcadedb", "dryrun", "s2.jsonl");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({
      kind: "batch",
      turnRange: "1..3",
      counts: { valid: 0, invalid: 1, pendingVocab: 0 },
    });
    expect(JSON.parse(lines[1])).toMatchObject({ kind: "invalid", reason: "missing evidence" });
  });

  it("appends to an existing file (multiple batches per session)", () => {
    const args = {
      sessionDbId: "s3",
      claudeCodeSessionId: "c3",
      turnRange: "1..5",
      valid: [],
      invalid: [],
      pendingVocab: [],
      unknownTerms: [],
    };
    writeDryrunBatch(args);
    writeDryrunBatch({ ...args, turnRange: "6..10" });
    const path = join(tmpHome, ".config", "arcadedb", "dryrun", "s3.jsonl");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).turnRange).toBe("1..5");
    expect(JSON.parse(lines[1]).turnRange).toBe("6..10");
  });

  it("writes pendingVocab and unknownTerms lines", () => {
    writeDryrunBatch({
      sessionDbId: "s4",
      claudeCodeSessionId: "c4",
      turnRange: "1..2",
      valid: [],
      invalid: [],
      pendingVocab: [{ subject:{label:"X",props:{name:"a"}}, verb:"UNKNOWN", object:{label:"Y",props:{name:"b"}}, evidence:"hmm" } as any],
      unknownTerms: [{ candidate: "UNKNOWN", kind: "verb", context: "hmm" }],
    });
    const path = join(tmpHome, ".config", "arcadedb", "dryrun", "s4.jsonl");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1]).kind).toBe("pendingVocab");
    expect(JSON.parse(lines[2]).kind).toBe("unknownTerm");
  });
});
