import { describe, it, expect } from "vitest";
import { temporalClause } from "../src/search.js";
import { buildExtractorCypher } from "../src/agent-memory/extractor/cypher-builder.js";
import { hooksDisabled } from "../src/hook-input.js";
import { resolveConfig } from "../src/config.js";
import { buildContext } from "../src/context-builder.js";

describe("temporalClause", () => {
  it("hides superseded decisions by default and only for Decision", () => {
    expect(temporalClause("Decision", {})).toBe(" AND validTo IS NULL");
    expect(temporalClause("Turn", {})).toBe("");
    expect(temporalClause("Decision", { includeSuperseded: true })).toBe("");
  });
  it("as-of scopes decisions by validity window and other types by creation time", () => {
    expect(temporalClause("Decision", { asOf: "2026-06-01T00:00:00.000Z" }))
      .toBe(" AND coalesce(validFrom, decidedAt) <= '2026-06-01T00:00:00.000Z' AND (validTo IS NULL OR validTo > '2026-06-01T00:00:00.000Z')");
    expect(temporalClause("Turn", { asOf: "2026-06-01T00:00:00.000Z" })).toBe(" AND ts <= '2026-06-01T00:00:00.000Z'");
    expect(temporalClause("Session", { asOf: "2026-06-01T00:00:00.000Z" })).toBe(" AND summarizedAt <= '2026-06-01T00:00:00.000Z'");
  });
});

describe("extractor SUPERSEDES", () => {
  const naturalKeys = { Decision: ["id"], Concept: ["name"] };
  it("closes the old decision's validity window without deleting it", () => {
    const cy = buildExtractorCypher({
      triple: { subject: { label: "Decision", props: { id: "new", summary: "b" } }, verb: "SUPERSEDES", object: { label: "Decision", props: { id: "old", summary: "a" } }, evidence: "" },
      sessionDbId: "s", naturalKeys,
    });
    expect(cy).toContain("SET o.validTo = coalesce(o.validTo, s.validFrom, s.decidedAt, datetime())");
    expect(cy).toContain("o.supersededBy = coalesce(o.supersededBy, s.id)");
    expect(cy).not.toContain("DELETE");
  });
  it("leaves other verbs alone", () => {
    const cy = buildExtractorCypher({
      triple: { subject: { label: "Decision", props: { id: "d" } }, verb: "ABOUT", object: { label: "Concept", props: { name: "x" } }, evidence: "" },
      sessionDbId: "s", naturalKeys,
    });
    expect(cy).not.toContain("validTo");
  });
});

describe("hook guard and rollup config", () => {
  it("hooks are disabled inside plugin-spawned model calls", () => {
    expect(hooksDisabled({ ARCADEDB_HOOKS: "off" })).toBe(true);
    expect(hooksDisabled({ ARCADEDB_HOOKS: "OFF" })).toBe(true);
    expect(hooksDisabled({})).toBe(false);
  });
  it("rollup defaults on with haiku via claude -p; env overrides", () => {
    const cfg = resolveConfig({ envPath: "/nonexistent/.env", processEnv: {} });
    expect(cfg.rollup).toBe(true);
    expect(cfg.rollupModel).toBe("haiku");
    expect(cfg.rollupTransport).toBe("claude");
    const off = resolveConfig({ envPath: "/nonexistent/.env", processEnv: { ARCADEDB_ROLLUP: "off", ARCADEDB_ROLLUP_MODEL: "sonnet", ARCADEDB_ROLLUP_TRANSPORT: "API" } });
    expect(off.rollup).toBe(false);
    expect(off.rollupModel).toBe("sonnet");
    expect(off.rollupTransport).toBe("api");
  });
  it("banner shows rollup state and superseded count", () => {
    const base = { project: null, memory: { db: "m", decisionCount: 12, insightCount: 3 } };
    const on = buildContext({ ...base, supersededCount: 2, rollup: { on: true, model: "haiku", transport: "claude", pending: 1 } });
    expect(on).toContain("12 decisions, 2 superseded");
    expect(on).toContain("Rollup: on (haiku via claude -p");
    expect(on).toContain("1 session summarising in background");
    const off = buildContext({ ...base, rollup: { on: false, model: "haiku", transport: "claude", pending: 0 } });
    expect(off).toContain("Rollup: off");
  });
});
