import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client.js";
import { applySchemas } from "../../src/migrations/apply.js";
import {
  startSession,
  endSession,
  findLatestSessionForRepo,
} from "../../src/memory/sessions.js";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("follows");
  await applySchemas(client, db.name, ["core", "memory"]);
});
afterAll(async () => { await db.drop(); });

describe("findLatestSessionForRepo", () => {
  it("returns null when no prior session exists for repo", async () => {
    const found = await findLatestSessionForRepo(client, db.name, "no-such-repo");
    expect(found).toBeNull();
  });

  it("returns the most recent session id for a repo", async () => {
    const old = await startSession(client, db.name, { repo: "repo-x" });
    await endSession(client, db.name, old);
    // small delay to ensure distinct startedAt timestamps
    await new Promise(r => setTimeout(r, 20));
    const newer = await startSession(client, db.name, { repo: "repo-x" });
    const found = await findLatestSessionForRepo(client, db.name, "repo-x");
    expect(found).toBe(newer);
  });

  it("ignores sessions for other repos", async () => {
    await startSession(client, db.name, { repo: "repo-other" });
    const target = await startSession(client, db.name, { repo: "repo-target" });
    const found = await findLatestSessionForRepo(client, db.name, "repo-target");
    expect(found).toBe(target);
  });
});
