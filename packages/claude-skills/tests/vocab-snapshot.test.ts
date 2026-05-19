import { describe, it, expect } from "vitest";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";

describe("buildVocabSnapshot", () => {
  it("returns the union of vertex labels across schemas", () => {
    const v = buildVocabSnapshot();
    expect(v.vertexLabels).toContain("Person");
    expect(v.vertexLabels).toContain("Decision");
    expect(v.vertexLabels).toContain("Question");
    expect(v.vertexLabels).toContain("Answer");
    expect(v.vertexLabels).toContain("File");
  });

  it("returns the union of edge names across schemas", () => {
    const v = buildVocabSnapshot();
    expect(v.edgeNames).toContain("DECIDED_ON");
    expect(v.edgeNames).toContain("ANSWERS");
    expect(v.edgeNames).toContain("DURING");
    expect(v.edgeNames).toContain("CONTAINS");
  });

  it("emits natural keys per label", () => {
    const v = buildVocabSnapshot();
    expect(v.naturalKeys["Person"]).toEqual(["name"]);
    expect(v.naturalKeys["File"]).toEqual(["path"]);
    expect(v.naturalKeys["Decision"]).toEqual(["id"]);
  });
});
