import { describe, it, expect } from "vitest";
import { detectLanguage } from "../../src/code-indexer/languages.js";

describe("detectLanguage", () => {
  it("identifies TypeScript files", () => {
    expect(detectLanguage("app/page.tsx")).toBe("ts");
    expect(detectLanguage("lib/db.ts")).toBe("ts");
    expect(detectLanguage("types.d.ts")).toBe("ts");
  });

  it("identifies JavaScript files", () => {
    expect(detectLanguage("server.js")).toBe("js");
    expect(detectLanguage("next.config.mjs")).toBe("js");
    expect(detectLanguage("client.cjs")).toBe("js");
    expect(detectLanguage("App.jsx")).toBe("js");
  });

  it("identifies PHP files", () => {
    expect(detectLanguage("app/Models/User.php")).toBe("php");
  });

  it("identifies Java files", () => {
    expect(detectLanguage("src/main/java/com/example/Main.java")).toBe("java");
    expect(detectLanguage("App.java")).toBe("java");
  });

  it("returns 'other' for unknown extensions", () => {
    expect(detectLanguage("README.md")).toBe("other");
    expect(detectLanguage("package.json")).toBe("other");
    expect(detectLanguage("Dockerfile")).toBe("other");
  });
});
