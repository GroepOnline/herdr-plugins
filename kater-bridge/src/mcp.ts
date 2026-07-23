import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { KATER_API_URL } from "./common";

const MCP_TIMEOUT_MS = 15000;

export function katerMcpUrl(): string {
  const explicit = (process.env.KATER_MCP_URL || "").replace(/\/$/, "");
  if (explicit) return explicit.endsWith("/sse") ? explicit : `${explicit}/sse`;
  const api = KATER_API_URL.replace(/\/$/, "");
  if (api.includes(":9091")) return api.replace(":9091", ":9090") + "/sse";
  return "http://127.0.0.1:9090/sse";
}

function parseToolPayload(result: unknown): unknown {
  if (!result || typeof result !== "object") return null;
  const obj = result as { content?: Array<{ type?: string; text?: string }> };
  const blocks = obj.content || [];
  const text = blocks
    .filter(b => b.type === "text" && b.text)
    .map(b => b.text as string)
    .join("\n")
    .trim();
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

  const timer = setTimeout(() => {
    try {
      transport.close();
    } catch {
      /* ignore */
    }
  }, MCP_TIMEOUT_MS);

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: args });
    return parseToolPayload(result) as T | null;
  } catch (err) {
    console.log(`kater-bridge mcp: ${toolName} failed`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}
