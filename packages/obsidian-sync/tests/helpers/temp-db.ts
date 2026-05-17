import { loadEnv } from "arcadedb-agent-memory";

const env = loadEnv();

export interface TempDb {
  name: string;
  drop(): Promise<void>;
}

export async function createTempDb(prefix = "obsidian"): Promise<TempDb> {
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await fetch(`${env.httpUri}/api/v1/server`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basic() },
    body: JSON.stringify({ command: `create database ${name}` }),
  });
  return {
    name,
    async drop() {
      await fetch(`${env.httpUri}/api/v1/server`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: basic() },
        body: JSON.stringify({ command: `drop database ${name}` }),
      });
    },
  };
}

function basic(): string {
  return "Basic " + Buffer.from(`${env.username}:${env.password}`).toString("base64");
}

export { env };
