import { spawn } from "node:child_process";

export interface LlmCall {
  system: string;
  prompt: string;
  model: string;
  maxTokens?: number;
}

export interface LlmResult {
  text: string;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type LlmTransport = (call: LlmCall) => Promise<LlmResult>;

/**
 * The user's own Claude Code login, headless. Settings, tools, MCP and hooks are all switched off so the
 * call carries only our prompt (a few hundred input tokens) and can never re-enter this plugin.
 */
export const claudeTransport: LlmTransport = (call) => new Promise((resolve, reject) => {
  const args = [
    "-p", "--model", call.model, "--output-format", "json", "--no-session-persistence",
    "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--system-prompt", call.system,
  ];
  const child = spawn("claude", args, {
    env: { ...process.env, ARCADEDB_HOOKS: "off", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", d => { out += d; });
  child.stderr.on("data", d => { err += d; });
  child.on("error", reject);
  child.on("close", code => {
    if (code !== 0) return reject(new Error(`claude -p exited ${code}: ${err.trim().slice(0, 300)}`));
    let parsed: { result?: string; is_error?: boolean; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } };
    try {
      parsed = JSON.parse(out);
    } catch {
      return reject(new Error(`claude -p returned non-JSON: ${out.slice(0, 200)}`));
    }
    if (parsed.is_error || typeof parsed.result !== "string") return reject(new Error(`claude -p error: ${String(parsed.result).slice(0, 300)}`));
    if (/not logged in/i.test(parsed.result)) return reject(new Error("claude -p: not logged in (run `claude` once, or set ARCADEDB_ROLLUP_TRANSPORT=api with ANTHROPIC_API_KEY)"));
    resolve({
      text: parsed.result,
      costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null,
      inputTokens: parsed.usage?.input_tokens ?? null,
      outputTokens: parsed.usage?.output_tokens ?? null,
    });
  });
  child.stdin.end(call.prompt);
});

const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
};

/** Direct Messages API call with ANTHROPIC_API_KEY, for machines without a Claude Code login. */
export const apiTransport: LlmTransport = async (call) => {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (ARCADEDB_ROLLUP_TRANSPORT=api)");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL_ALIASES[call.model] ?? call.model,
      max_tokens: call.maxTokens ?? 2048,
      system: call.system,
      messages: [{ role: "user", content: call.prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Messages API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json() as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (body.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("");
  return { text, costUsd: null, inputTokens: body.usage?.input_tokens ?? null, outputTokens: body.usage?.output_tokens ?? null };
};

export function selectTransport(name: "claude" | "api"): LlmTransport {
  return name === "api" ? apiTransport : claudeTransport;
}
