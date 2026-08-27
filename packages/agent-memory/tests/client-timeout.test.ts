import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { Client } from "../src/client.js";
import { ArcadeDBConnectionError } from "../src/errors.js";

let server: Server | undefined;

/** A server that accepts the connection and then never answers, so only a client-side timeout ends the request. */
function startBlackHole(): Promise<number> {
  return new Promise(resolve => {
    server = createServer(() => { /* never respond */ });
    server.listen(0, "127.0.0.1", () => {
      resolve((server!.address() as { port: number }).port);
    });
  });
}

afterEach(async () => {
  if (server) {
    const s = server;
    server = undefined;
    s.closeAllConnections?.();
    await new Promise<void>(r => s.close(() => r()));
  }
});

describe("Client request timeout", () => {
  it("rejects with ArcadeDBConnectionError when the server never responds", async () => {
    const port = await startBlackHole();
    const client = new Client(
      { httpUri: `http://127.0.0.1:${port}`, username: "root", password: "x" },
      { timeoutMs: 200 },
    );
    await expect(client.query("db", "cypher", "RETURN 1")).rejects.toBeInstanceOf(ArcadeDBConnectionError);
  });

  it("applies the timeout to listDatabases too", async () => {
    const port = await startBlackHole();
    const client = new Client(
      { httpUri: `http://127.0.0.1:${port}`, username: "root", password: "x" },
      { timeoutMs: 200 },
    );
    await expect(client.listDatabases()).rejects.toBeInstanceOf(ArcadeDBConnectionError);
  });
});
