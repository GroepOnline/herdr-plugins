// MCP gateway handler: forwards authenticated /mcp traffic to the Herdr bridge
// behind the cloudflared tunnel. The OAuth provider has already validated the
// bearer token before we are invoked; ctx.props carries the grant metadata.
import { WorkerEntrypoint } from "cloudflare:workers";

const ALLOWED_METHODS = new Set(["POST", "GET", "DELETE"]);

interface GrantProps {
  userId: string;
  displayName?: string;
}

export class McpGateway extends WorkerEntrypoint<Env, GrantProps> {
  override async fetch(request: Request): Promise<Response> {
    if (!ALLOWED_METHODS.has(request.method)) {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    const origin = new URL(request.url);
    const upstream = `${this.env.ORIGIN_URL.replace(/\/$/, "")}/mcp`;

    // Stream the body straight through — never buffer unbounded payloads.
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${this.env.ORIGIN_BEARER_TOKEN}`);
    headers.set("x-gateway-user", this.ctx.props?.userId ?? "unknown");
    headers.delete("host");

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstream, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "DELETE" ? undefined : request.body,
        // @ts-expect-error -- Workers-specific duplex streaming for request bodies
        duplex: "half",
      });
    } catch (err) {
      return Response.json(
        {
          error: "origin_unreachable",
          hint: "is the herdr chatgpt-bridge serve action running and the tunnel up?",
          detail: String(err),
        },
        { status: 502 },
      );
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("set-cookie");
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }
}
