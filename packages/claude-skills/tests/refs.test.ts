import { describe, it, expect } from "vitest";
import { extractRefs, refId, MAX_REFS_PER_TURN } from "../src/refs.js";

describe("extractRefs", () => {
  it("finds paths, symbols, commits, tickets and urls, once each", () => {
    const refs = extractRefs(
      "Both done. Commit `ef71e31d`. `config/heisterkamp.php`: default removed. HeisterkampClient now throws. " +
      "See BACKLOG:69 and https://example.com/docs/a.php?x=1. Also config/heisterkamp.php again, ef71e31d again.",
    );
    expect(refs).toEqual([
      { kind: "url", value: "https://example.com/docs/a.php?x=1" },
      { kind: "path", value: "config/heisterkamp.php" },
      { kind: "commit", value: "ef71e31d" },
      { kind: "ticket", value: "BACKLOG:69" },
      { kind: "symbol", value: "HeisterkampClient" },
    ]);
  });

  it("ignores plain numbers, plain words, UTF-8 style tokens and short PascalCase", () => {
    const refs = extractRefs("12345678 deadbeef UTF-8 ISO-8601 Done. FooBar is fine? Ab Cd.");
    expect(refs.map(r => r.value)).toEqual(["FooBar"]);
  });

  it("strips leading ./ from paths and trailing punctuation from urls", () => {
    expect(extractRefs("open ./src/a/b.ts, then https://x.y/z.").map(r => r.value)).toEqual(["https://x.y/z", "src/a/b.ts"]);
  });

  it("caps output", () => {
    const text = Array.from({ length: 50 }, (_, i) => `src/f${i}/x.ts`).join(" ");
    expect(extractRefs(text)).toHaveLength(MAX_REFS_PER_TURN);
  });

  it("refId is case-insensitive per kind", () => {
    expect(refId({ kind: "symbol", value: "HeisterkampClient" })).toBe("symbol:heisterkampclient");
  });
});
