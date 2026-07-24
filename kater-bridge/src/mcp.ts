import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { katerApiUrl } from "./common";

const MCP_TIMEOUT_MS = 15000;

/** Kater gateway exposes MCP over SSE on :9090 (not Streamable HTTP). */
export function katerMcpUrl(): string {
  const explicit = (process.env.KATER_MCP_URL || "").replace(/\/$/, "");
  if (explicit) return explicit.endsWith("/sse") ? explicit : `${explicit}/sse`;
  const api = katerApiUrl();
  if (api.includes(":9091")) return api.replace(":9091", ":9090") + "/sse";
  return "http://127.0.0.1:9090/sse";
}

export type McpFailure = { __mcp_error: true; message: string };

export function isMcpFailure(value: unknown): value is McpFailure {
  return !!value && typeof value === "object" && (value as McpFailure).__mcp_error === true;
}

function parseToolPayload(result: unknown): unknown {
  if (!result || typeof result !== "object") return null;
  const obj = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  const blocks = obj.content || [];
  const text = blocks
    .filter(b => b.type === "text" && b.text)
    .map(b => b.text as string)
    .join("\n")
    .trim();

  if (obj.isError === true) {
    return { __mcp_error: true, message: text || "MCP tool returned isError" } satisfies McpFailure;
  }

  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function katerCallTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<T | null> {
  const transport = new SSEClientTransport(new URL(katerMcpUrl()));
  const client = new Client({ name: "kater-bridge", version: "0.2.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = await client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { timeout: MCP_TIMEOUT_MS, resetTimeoutOnProgress: true },
    );
    const payload = parseToolPayload(result);
    if (isMcpFailure(payload)) return null;
    return payload as T | null;
  } catch (err) {
    console.log(`kater-bridge mcp: ${toolName} failed`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}
