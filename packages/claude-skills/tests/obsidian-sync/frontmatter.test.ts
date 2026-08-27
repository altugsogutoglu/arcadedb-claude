import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/obsidian-sync/frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns empty frontmatter and full body when no frontmatter", () => {
    const r = parseFrontmatter("Just body content");
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe("Just body content");
  });

  it("extracts string fields", () => {
    const src = `---\ntitle: My Note\nauthor: Bob\n---\nbody`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter["title"]).toBe("My Note");
    expect(r.frontmatter["author"]).toBe("Bob");
    expect(r.body).toBe("body");
  });

  it("extracts inline arrays", () => {
    const src = `---\ntags: [a, b, c]\n---\nbody`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter["tags"]).toEqual(["a", "b", "c"]);
  });

  it("extracts dashed list arrays", () => {
    const src = `---\ntags:\n  - project\n  - active\n---\nbody`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter["tags"]).toEqual(["project", "active"]);
  });

  it("handles values with surrounding quotes", () => {
    const src = `---\ntitle: "Quoted Title"\n---\nbody`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter["title"]).toBe("Quoted Title");
  });

  it("strips the frontmatter block from the body", () => {
    const src = `---\ntitle: x\n---\nLine 1\nLine 2`;
    const r = parseFrontmatter(src);
    expect(r.body.startsWith("Line 1")).toBe(true);
  });
});
