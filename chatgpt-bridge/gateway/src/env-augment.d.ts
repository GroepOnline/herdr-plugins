// Ambient augmentation of the wrangler-generated Env: secrets are not known
// to `wrangler types` (they live outside wrangler.jsonc by design), and the
// OAuth provider injects OAUTH_PROVIDER into every handler env.
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    OAUTH_PROVIDER: OAuthHelpers;
    /** Set via `wrangler secret put CONSENT_PASSCODE`. */
    CONSENT_PASSCODE: string;
    /** Set via `wrangler secret put ORIGIN_BEARER_TOKEN`; forwarded to the bridge. */
    ORIGIN_BEARER_TOKEN: string;
  }
}

export {};
