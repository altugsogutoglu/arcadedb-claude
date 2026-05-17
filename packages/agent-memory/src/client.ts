import type { ArcadeDBEnv } from "./env.js";
import { ArcadeDBConnectionError, DatabaseNotFoundError } from "./errors.js";

export type Language = "cypher" | "sql" | "sqlscript" | "gremlin";

export class Client {
  constructor(private env: ArcadeDBEnv) {}

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.env.username}:${this.env.password}`).toString("base64");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.env.httpUri}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.authHeader() },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new ArcadeDBConnectionError(this.env.httpUri, cause);
    }
    if (!res.ok) {
      const text = await res.text();
      if (/database.*is not available|database.*not.*found|does not exist/i.test(text)) {
        const m = text.match(/'([^']+)'/);
        throw new DatabaseNotFoundError(m?.[1] ?? "unknown");
      }
      throw new Error(`ArcadeDB ${res.status} ${res.statusText}: ${text}`);
    }
    return (await res.json()) as T;
  }

  async query<T = Record<string, unknown>>(db: string, language: Language, q: string): Promise<T[]> {
    type Wire = { result: T[] };
    const data = await this.post<Wire>(`/api/v1/query/${db}`, { language, command: q });
    return data.result;
  }

  async execute<T = Record<string, unknown>>(db: string, language: Language, q: string): Promise<T[]> {
    type Wire = { result: T[] };
    const data = await this.post<Wire>(`/api/v1/command/${db}`, { language, command: q });
    return data.result;
  }

  async command(serverCommand: string): Promise<unknown> {
    return this.post<unknown>(`/api/v1/server`, { command: serverCommand });
  }

  async listDatabases(): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(`${this.env.httpUri}/api/v1/databases`, {
        headers: { Authorization: this.authHeader() },
      });
    } catch (cause) {
      throw new ArcadeDBConnectionError(this.env.httpUri, cause);
    }
    if (!res.ok) throw new Error(`ArcadeDB ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { result: string[] };
    return data.result;
  }
}
