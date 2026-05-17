import { describe, it, expect } from "vitest";
import { extractTags } from "../src/tags.js";

describe("extractTags", () => {
  it("extracts inline hash tags from body", () => {
    expect(extractTags("Some #idea and #another", {})).toEqual(["idea", "another"]);
  });

  it("dedupes inline tags", () => {
    expect(extractTags("#x #y #x", {})).toEqual(["x", "y"]);
  });

  it("combines frontmatter tags array with inline tags", () => {
    const tags = extractTags("inline #c", { tags: ["a", "b"] });
    expect(tags).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("handles frontmatter tag as single string", () => {
    expect(extractTags("", { tags: "alpha" })).toEqual(["alpha"]);
  });

  it("ignores hash inside code spans (heuristic: skip lines starting with 4 spaces or backticks)", () => {
    const src = "    #not_a_tag\n\nreal #tag";
    expect(extractTags(src, {})).toEqual(["tag"]);
  });

  it("ignores hash followed by digits-only (markdown anchor link)", () => {
    expect(extractTags("[link](#123)", {})).toEqual([]);
  });

  it("returns empty array when no tags", () => {
    expect(extractTags("plain prose", {})).toEqual([]);
  });
});
