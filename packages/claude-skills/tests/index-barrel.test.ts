import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("package barrel", () => {
  it("exposes the extractor functions the manifest imports", () => {
    expect(typeof api.buildExtractorSystemPrompt).toBe("function");
    expect(typeof api.buildVocabSnapshot).toBe("function");
    expect(typeof api.validateExtraction).toBe("function");
  });

  it("buildExtractorSystemPrompt(buildVocabSnapshot()) returns a non-empty string", () => {
    const out = api.buildExtractorSystemPrompt(api.buildVocabSnapshot());
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
