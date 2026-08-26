export type ProbeStatus = "ok" | "unreachable" | "no_password" | "unauthorized";

export interface ProbeResult {
  status: ProbeStatus;
  httpUri: string;
  latencyMs: number;
  detail?: string;
}

async function get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return { status: res.status };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeServer(
  cfg: { httpUri: string; username: string; password: string },
  timeoutMs = 2000,
): Promise<ProbeResult> {
  const started = Date.now();
  const ready = await get(`${cfg.httpUri}/api/v1/ready`, {}, timeoutMs);
  if ("error" in ready || ready.status < 200 || ready.status >= 300) {
    return { status: "unreachable", httpUri: cfg.httpUri, latencyMs: Date.now() - started, detail: "error" in ready ? ready.error : `HTTP ${ready.status}` };
  }
  if (cfg.password === "") {
    return { status: "no_password", httpUri: cfg.httpUri, latencyMs: Date.now() - started };
  }
  const auth = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const dbs = await get(`${cfg.httpUri}/api/v1/databases`, { Authorization: auth }, timeoutMs);
  const latencyMs = Date.now() - started;
  if ("error" in dbs) return { status: "unreachable", httpUri: cfg.httpUri, latencyMs, detail: dbs.error };
  if (dbs.status === 401 || dbs.status === 403) return { status: "unauthorized", httpUri: cfg.httpUri, latencyMs };
  if (dbs.status >= 200 && dbs.status < 300) return { status: "ok", httpUri: cfg.httpUri, latencyMs };
  return { status: "unreachable", httpUri: cfg.httpUri, latencyMs, detail: `HTTP ${dbs.status}` };
}

const OFF_LINE = "  Capture and code graph are off until then.";

export function probeBanner(r: ProbeResult, username: string): string[] {
  switch (r.status) {
    case "ok":
      return [`  Server: ${r.httpUri} (ok, ${r.latencyMs} ms)`];
    case "unreachable":
      return [`ArcadeDB: server not reachable at ${r.httpUri}. Start ArcadeDB or run: /arcadedb-config set server http://host:port`, OFF_LINE];
    case "no_password":
      return [`ArcadeDB: server reachable at ${r.httpUri} but no password configured. Run: /arcadedb-config set password <root-password>`, OFF_LINE];
    case "unauthorized":
      return [`ArcadeDB: authentication failed at ${r.httpUri} for user ${username}. Run: /arcadedb-config set password <root-password>`, OFF_LINE];
  }
}
