import { describe, it, expect } from "vitest";
import { resolveTitle } from "../src/title.js";

describe("resolveTitle", () => {
  it("uses frontmatter title when present", () => {
    expect(resolveTitle("Notes on Z.md", "# H1\nbody", { title: "Custom Title" })).toBe("Custom Title");
  });

  it("falls back to first H1 when no frontmatter title", () => {
    expect(resolveTitle("Foo.md", "# Actual H1\nbody", {})).toBe("Actual H1");
  });

  it("falls back to filename (without .md) when no H1 or frontmatter", () => {
    expect(resolveTitle("Foo.md", "no heading", {})).toBe("Foo");
  });

  it("strips folder path from filename fallback", () => {
    expect(resolveTitle("subfolder/Foo.md", "no heading", {})).toBe("Foo");
  });

  it("trims whitespace from H1 content", () => {
    expect(resolveTitle("X.md", "#   Spaced H1   \nbody", {})).toBe("Spaced H1");
  });
});
