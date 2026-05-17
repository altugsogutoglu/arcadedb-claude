import { describe, it, expect } from "vitest";
import { extractWikilinks } from "../src/wikilinks.js";

describe("extractWikilinks", () => {
  it("extracts a simple wikilink", () => {
    expect(extractWikilinks("See [[Other Note]] for more.")).toEqual(["Other Note"]);
  });

  it("extracts multiple wikilinks", () => {
    expect(extractWikilinks("Read [[A]] and [[B]] and [[C]].")).toEqual(["A", "B", "C"]);
  });

  it("handles aliased wikilinks (target only, drop alias)", () => {
    expect(extractWikilinks("[[Real Note|display name]]")).toEqual(["Real Note"]);
  });

  it("handles folder-prefixed wikilinks (keep full path)", () => {
    expect(extractWikilinks("[[folder/Nested Note]]")).toEqual(["folder/Nested Note"]);
  });

  it("handles embed wikilinks (!![[..]])", () => {
    expect(extractWikilinks("![[Embedded Note]]")).toEqual(["Embedded Note"]);
  });

  it("returns empty array when no wikilinks", () => {
    expect(extractWikilinks("Plain text with no links.")).toEqual([]);
  });

  it("preserves order and deduplicates duplicates", () => {
    expect(extractWikilinks("[[A]] [[B]] [[A]]")).toEqual(["A", "B"]);
  });
});
