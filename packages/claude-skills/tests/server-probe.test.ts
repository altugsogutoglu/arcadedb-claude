import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { probeServer, probeBanner } from "../src/server-probe.js";

let server: Server | null = null;
afterEach(async () => { if (server) await new Promise(r => server!.close(r)); server = null; });

function listen(handler: (path: string, auth: string | undefined, res: import("node:http").ServerResponse) => void): Promise<string> {
  return new Promise(resolve => {
    server = createServer((req, res) => handler(req.url ?? "", req.headers.authorization, res));
    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

describe("probeServer", () => {
  it("ok when ready and databases authorizes", async () => {
    const uri = await listen((path, auth, res) => {
      if (path === "/api/v1/ready") { res.writeHead(204); res.end(); return; }
      if (path === "/api/v1/databases") {
        const expected = "Basic " + Buffer.from("root:pw").toString("base64");
        res.writeHead(auth === expected ? 200 : 401, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: ["claude_memory"] }));
        return;
      }
      res.writeHead(404); res.end();
    });
    const r = await probeServer({ httpUri: uri, username: "root", password: "pw" });
    expect(r.status).toBe("ok");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it("unauthorized on 401", async () => {
    const uri = await listen((path, _auth, res) => {
      if (path === "/api/v1/ready") { res.writeHead(204); res.end(); return; }
      res.writeHead(401); res.end();
    });
    expect((await probeServer({ httpUri: uri, username: "root", password: "bad" })).status).toBe("unauthorized");
  });
  it("no_password when ready but password empty, without calling databases", async () => {
    let dbCalls = 0;
    const uri = await listen((path, _auth, res) => {
      if (path === "/api/v1/databases") dbCalls++;
      res.writeHead(204); res.end();
    });
    expect((await probeServer({ httpUri: uri, username: "root", password: "" })).status).toBe("no_password");
    expect(dbCalls).toBe(0);
  });
  it("unreachable when nothing listens", async () => {
    const r = await probeServer({ httpUri: "http://127.0.0.1:1", username: "root", password: "pw" }, 500);
    expect(r.status).toBe("unreachable");
  });
});

describe("probeBanner", () => {
  it("renders the exact lines per status", () => {
    expect(probeBanner({ status: "ok", httpUri: "http://h:1", latencyMs: 12 }, "root")).toEqual(["  Server: http://h:1 (ok, 12 ms)"]);
    expect(probeBanner({ status: "unreachable", httpUri: "http://h:1", latencyMs: 0 }, "root")).toEqual([
      "ArcadeDB: server not reachable at http://h:1. Start ArcadeDB or run: /arcadedb-config set server http://host:port",
      "  Capture and code graph are off until then.",
    ]);
    expect(probeBanner({ status: "no_password", httpUri: "http://h:1", latencyMs: 0 }, "root")).toEqual([
      "ArcadeDB: server reachable at http://h:1 but no password configured. Run: /arcadedb-config set password <root-password>",
      "  Capture and code graph are off until then.",
    ]);
    expect(probeBanner({ status: "unauthorized", httpUri: "http://h:1", latencyMs: 0 }, "root")).toEqual([
      "ArcadeDB: authentication failed at http://h:1 for user root. Run: /arcadedb-config set password <root-password>",
      "  Capture and code graph are off until then.",
    ]);
  });
});
