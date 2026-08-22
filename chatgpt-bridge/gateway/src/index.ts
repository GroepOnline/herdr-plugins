// herdr-chatgpt-gateway — OAuth 2.1 front door for the Herdr MCP bridge.
//
// chatgpt.com → this Worker (OAuth AS + consent) → cloudflared tunnel →
// chatgpt-bridge on the laptop → herdr CLI.
//
// Consent is passcode-gated: ChatGPT's authorization flow only completes when
// Joep enters the shared CONSENT_PASSCODE. Scopes map 1:1 to bridge tool
// families (herdr:read, herdr:write).
import { OAuthProvider, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { McpGateway } from "./mcp";

const SCOPES = ["herdr:read", "herdr:write"] as const;

const CONSENT_TTL_SECONDS = 300;
const CONSENT_PREFIX = "consent:";

/**
 * Provider instances keyed by canonical gateway URL. This is configuration
 * caching (one entry per deployed origin), never request-scoped state.
 */
const providerCache = new Map<string, OAuthProvider>();

function getProvider(gatewayUrl: string): OAuthProvider {
  let provider = providerCache.get(gatewayUrl);
  if (!provider) {
    provider = new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler: McpGateway,
      // Provider stores handlers behind an env-erased type; ours is Env-typed.
      defaultHandler: defaultHandler as ExportedHandler,

      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",

      scopesSupported: [...SCOPES],

      // Derived from env so local dev (`wrangler dev`) and production each
      // advertise — and enforce — their own consistent audience.
      resourceMetadata: {
        resource: `${gatewayUrl}/mcp`,
        authorization_servers: [gatewayUrl],
        scopes_supported: [...SCOPES],
        bearer_methods_supported: ["header"],
        resource_name: "Herdr MCP gateway",
      },

      clientIdMetadataDocumentEnabled: true,
    });
    providerCache.set(gatewayUrl, provider);
  }
  return provider;
}

export default {
  /** Single source of truth for the canonical URL: GATEWAY_URL var in wrangler.jsonc / .dev.vars. */
  fetch(request: Request<unknown, IncomingRequestCfProperties>, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    return getProvider(env.GATEWAY_URL.replace(/\/$/, "")).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

/** Structural shape of validation errors thrown by parseAuthRequest (0.0.x). */
type AuthRequestError = Error & {
  code?: string;
  description?: string;
  redirectUri?: string;
  state?: string;
  issuer?: string;
};

function asAuthError(e: unknown): AuthRequestError | null {
  return e instanceof Error ? (e as AuthRequestError) : null;
}

/** SHA-256 then constant-time compare — portable timing-safe secret check. */
async function secretsMatch(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all(
    [a, b].map((v) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))),
  );
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}

function consentPage(clientName: string, scope: string, consentId: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Herdr gateway — authorize</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#0b0d10;color:#e6e9ee;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#14171c;padding:2rem;border-radius:12px;max-width:26rem}
h1{font-size:1.1rem;margin-top:0}code{color:#7fd4a0}
input,button{width:100%;box-sizing:border-box;padding:.6rem;margin-top:.75rem;border-radius:8px;border:1px solid #2a2f38;font-size:1rem}
button{background:#2563eb;color:#fff;border:none;cursor:pointer}</style></head>
<body><main>
<h1>Authorize <code>${escapeHtml(clientName)}</code></h1>
<p>Scopes requested: <code>${escapeHtml(scope || "(default)")}</code></p>
<form method="post" action="/authorize/consent">
<input type="hidden" name="consent_id" value="${escapeHtml(consentId)}">
<label for="passcode">Herdr consent passcode</label>
<input id="passcode" name="passcode" type="password" autocomplete="off" required autofocus>
<button type="submit">Approve</button>
</form></main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

interface StoredConsent {
  request: AuthRequest;
  clientName: string;
}

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, service: "herdr-chatgpt-gateway" });
    }

    if (url.pathname !== "/authorize" && url.pathname !== "/authorize/consent") {
      return new Response("Not found", { status: 404 });
    }

    // Step 2: consent form submitted — validate passcode and complete the grant.
    if (url.pathname === "/authorize/consent") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      const form = await request.formData();
      const consentId = String(form.get("consent_id") ?? "");
      const passcode = String(form.get("passcode") ?? "");

      const raw = consentId
        ? await env.OAUTH_KV.get(CONSENT_PREFIX + consentId)
        : null;
      if (!raw) {
        return new Response("Consent request expired — start over at the client.", {
          status: 400,
        });
      }

      if (!(await secretsMatch(passcode, env.CONSENT_PASSCODE))) {
        // Small delay so wrong-passcode attempts are not distinguishable by timing.
        await new Promise((r) => setTimeout(r, 500));
        return new Response("Invalid passcode.", { status: 403 });
      }

      await env.OAUTH_KV.delete(CONSENT_PREFIX + consentId);

      const stored = JSON.parse(raw) as StoredConsent;
      const granted = stored.request.scope.filter((s): s is (typeof SCOPES)[number] =>
        (SCOPES as readonly string[]).includes(s),
      );

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: stored.request,
        userId: "joep",
        metadata: { clientName: stored.clientName },
        scope: granted,
        props: { userId: "joep", displayName: "Joep", scopes: granted },
      });
      return Response.redirect(redirectTo, 302);
    }

    // Step 1: validate the incoming OAuth request and render the consent form.
    let oauthRequest: AuthRequest;
    try {
      oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch (error: unknown) {
      const authError = asAuthError(error);
      if (!authError) throw error;
      if (!authError.redirectUri) {
        // Unknown clients and invalid redirects must be rendered locally.
        return new Response(authError.description ?? "Invalid authorization request", {
          status: 400,
        });
      }
      const redirect = new URL(authError.redirectUri);
      redirect.searchParams.set("error", authError.code ?? "invalid_request");
      redirect.searchParams.set("error_description", authError.description ?? "");
      if (authError.state) redirect.searchParams.set("state", authError.state);
      if (authError.issuer) redirect.searchParams.set("iss", authError.issuer);
      return Response.redirect(redirect.toString(), 302);
    }

    const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
    if (!client) {
      return new Response("Unknown OAuth client", { status: 400 });
    }

    const consentId = crypto.randomUUID();
    await env.OAUTH_KV.put(
      CONSENT_PREFIX + consentId,
      JSON.stringify({
        request: oauthRequest,
        clientName: client.clientName ?? "client",
      } satisfies StoredConsent),
      { expirationTtl: CONSENT_TTL_SECONDS },
    );

    return consentPage(
      client.clientName ?? "client",
      oauthRequest.scope.join(" "),
      consentId,
    );
  },
};
