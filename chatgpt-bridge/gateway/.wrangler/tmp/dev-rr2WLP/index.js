var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js
import { WorkerEntrypoint } from "cloudflare:workers";
var OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
var AuthorizationError = class extends Error {
  static {
    __name(this, "AuthorizationError");
  }
  constructor(code, options) {
    super(options.description);
    this.name = "AuthorizationError";
    this.code = code;
    this.description = options.description;
    this.redirectUri = options.redirectUri;
    this.state = options.state;
    this.issuer = options.issuer;
  }
};
function withAuthorizationRedirect(error, redirectUri, state, issuer) {
  return new AuthorizationError(error.code, {
    description: error.description,
    redirectUri,
    state,
    issuer
  });
}
__name(withAuthorizationRedirect, "withAuthorizationRedirect");
function buildOAuthServerCapabilities(options) {
  return {
    grantTypes: [
      "authorization_code",
      "refresh_token",
      ...options.allowImplicitFlow ? ["implicit"] : [],
      ...options.allowTokenExchangeGrant ? ["urn:ietf:params:oauth:grant-type:token-exchange"] : [],
      ...options.enterpriseManagedAuthorization ? ["urn:ietf:params:oauth:grant-type:jwt-bearer"] : []
    ],
    responseTypes: options.allowImplicitFlow ? ["code", "token"] : ["code"],
    tokenEndpointAuthMethods: [
      "client_secret_basic",
      "client_secret_post",
      "none"
    ],
    codeChallengeMethods: options.allowPlainPKCE ? ["plain", "S256"] : ["S256"]
  };
}
__name(buildOAuthServerCapabilities, "buildOAuthServerCapabilities");
function validateClientCapabilities(server, client) {
  if (!server.tokenEndpointAuthMethods.includes(client.tokenEndpointAuthMethod)) throw new Error(`Unsupported token_endpoint_auth_method: ${client.tokenEndpointAuthMethod}`);
  const unsupportedGrant = client.grantTypes.find((grantType) => !server.grantTypes.includes(grantType));
  if (unsupportedGrant) throw new Error(`Unsupported grant_type: ${unsupportedGrant}`);
  const unsupportedResponse = client.responseTypes.find((responseType) => !server.responseTypes.includes(responseType));
  if (unsupportedResponse) throw new Error(`Unsupported response_type: ${unsupportedResponse}`);
  if (client.grantTypes.includes("authorization_code") !== client.responseTypes.includes("code")) throw new Error("grant_types authorization_code and response_types code must be registered together");
  if (client.grantTypes.includes("implicit") !== client.responseTypes.includes("token")) throw new Error("grant_types implicit and response_types token must be registered together");
}
__name(validateClientCapabilities, "validateClientCapabilities");
var SHARED_SECRET_TOKEN_ENDPOINT_AUTH_METHODS = /* @__PURE__ */ new Set([
  "client_secret_basic",
  "client_secret_post",
  "client_secret_jwt"
]);
function negotiateTokenEndpointAuthMethod(options) {
  const { acceptedMethods, defaultMethod, preferredMethod, supportedMethods, context } = options;
  if (preferredMethod !== void 0 && supportedMethods !== void 0 && !supportedMethods.includes(preferredMethod)) throw new Error("token_endpoint_auth_method must be included in token_endpoint_auth_methods_supported");
  const advertisedMethods = supportedMethods ?? [preferredMethod ?? defaultMethod];
  const effectiveMethod = preferredMethod !== void 0 && acceptedMethods.includes(preferredMethod) ? preferredMethod : acceptedMethods.find((method) => advertisedMethods.includes(method));
  if (effectiveMethod !== void 0) return effectiveMethod;
  const advertised = [.../* @__PURE__ */ new Set([...preferredMethod === void 0 ? [] : [preferredMethod], ...advertisedMethods])];
  throw new Error(`${context} does not support an accepted token endpoint authentication method. Supported methods: ${acceptedMethods.join(", ")}. Client advertised: ${advertised.length > 0 ? advertised.join(", ") : "(none)"}`);
}
__name(negotiateTokenEndpointAuthMethod, "negotiateTokenEndpointAuthMethod");
function negotiateCimdTokenEndpointAuthMethod(server, preferredMethod, supportedMethods) {
  if (preferredMethod !== void 0 && SHARED_SECRET_TOKEN_ENDPOINT_AUTH_METHODS.has(preferredMethod)) throw new Error(`CIMD clients cannot use symmetric token endpoint authentication method: ${preferredMethod}`);
  return negotiateTokenEndpointAuthMethod({
    acceptedMethods: server.tokenEndpointAuthMethods.filter((method) => !SHARED_SECRET_TOKEN_ENDPOINT_AUTH_METHODS.has(method)),
    defaultMethod: "none",
    preferredMethod,
    supportedMethods,
    context: "CIMD client"
  });
}
__name(negotiateCimdTokenEndpointAuthMethod, "negotiateCimdTokenEndpointAuthMethod");
function negotiateDynamicClientRegistrationCapabilities(server, client) {
  const effective = {
    grantTypes: [...client.grantTypes],
    responseTypes: [...client.responseTypes],
    tokenEndpointAuthMethod: negotiateTokenEndpointAuthMethod({
      acceptedMethods: server.tokenEndpointAuthMethods,
      defaultMethod: "client_secret_basic",
      preferredMethod: client.tokenEndpointAuthMethod,
      supportedMethods: client.tokenEndpointAuthMethodsSupported,
      context: "Client"
    })
  };
  validateClientCapabilities(server, effective);
  return effective;
}
__name(negotiateDynamicClientRegistrationCapabilities, "negotiateDynamicClientRegistrationCapabilities");
function negotiateCimdClientCapabilities(server, client) {
  const effective = {
    grantTypes: client.grantTypes.filter((grantType) => server.grantTypes.includes(grantType)),
    responseTypes: client.responseTypes.filter((responseType) => server.responseTypes.includes(responseType)),
    tokenEndpointAuthMethod: negotiateCimdTokenEndpointAuthMethod(server, client.tokenEndpointAuthMethod, client.tokenEndpointAuthMethodsSupported)
  };
  validateClientCapabilities(server, effective);
  return effective;
}
__name(negotiateCimdClientCapabilities, "negotiateCimdClientCapabilities");
function validateAuthorizationResponseType(server, responseType, clientResponseTypes) {
  if (!responseType) throw new AuthorizationError("invalid_request", { description: "response_type is required" });
  if (!server.responseTypes.includes(responseType)) throw new AuthorizationError("unsupported_response_type", { description: `The authorization server does not support response_type ${responseType}` });
  if (!(clientResponseTypes ?? ["code"]).includes(responseType)) throw new AuthorizationError("unauthorized_client", { description: `The client is not registered for response_type ${responseType}` });
}
__name(validateAuthorizationResponseType, "validateAuthorizationResponseType");
function normalizePkceCodeChallengeMethod(method) {
  const effectiveMethod = method ?? "plain";
  if (effectiveMethod !== "plain" && effectiveMethod !== "S256") throw new AuthorizationError("invalid_request", { description: `Unsupported PKCE code_challenge_method: ${effectiveMethod}` });
  return effectiveMethod;
}
__name(normalizePkceCodeChallengeMethod, "normalizePkceCodeChallengeMethod");
function validatePkceCodeChallengeMethod(server, method) {
  const effectiveMethod = normalizePkceCodeChallengeMethod(method);
  if (!server.codeChallengeMethods.includes(effectiveMethod)) throw new AuthorizationError("invalid_request", { description: "The plain PKCE method is not allowed. Use S256 instead." });
  return effectiveMethod;
}
__name(validatePkceCodeChallengeMethod, "validatePkceCodeChallengeMethod");
function validateAuthorizationPkce(server, request, client) {
  if (request.codeChallenge) {
    validatePkceCodeChallengeMethod(server, request.codeChallengeMethod);
    return;
  }
  if (request.codeChallengeMethod) throw new AuthorizationError("invalid_request", { description: "PKCE code_challenge is required when code_challenge_method is provided." });
  if (request.responseType === "code" && client.tokenEndpointAuthMethod === "none") throw new AuthorizationError("invalid_request", { description: "Public clients must use PKCE with the authorization code flow." });
}
__name(validateAuthorizationPkce, "validateAuthorizationPkce");
function validateAuthorizationServerScopes(scopes) {
  if (!scopes) return;
  if (scopes.some((scope) => !isValidOAuthScopeToken(scope))) throw new TypeError("scopesSupported must contain valid OAuth scope tokens");
  if (new Set(scopes).size !== scopes.length) throw new TypeError("scopesSupported must not contain duplicate values");
}
__name(validateAuthorizationServerScopes, "validateAuthorizationServerScopes");
function isValidOAuthScopeToken(scopeToken) {
  return OAUTH_SCOPE_TOKEN_PATTERN.test(scopeToken);
}
__name(isValidOAuthScopeToken, "isValidOAuthScopeToken");
var CIMD_MAX_SIZE_BYTES = 5 * 1024;
var CIMD_FETCH_TIMEOUT_MS = 1e4;
var CIMD_CACHE_NAME = "workers-oauth-provider:cimd:v1";
var CIMD_CACHE_MAX_TTL_SECONDS = 10080 * 60;
function requireJsonObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Client metadata must be a JSON object");
  return value;
}
__name(requireJsonObject, "requireJsonObject");
function optionalString(value, fieldName) {
  if (value === void 0) return void 0;
  if (typeof value !== "string") throw new Error(`Invalid ${fieldName}: expected string, got ${typeof value}`);
  return value;
}
__name(optionalString, "optionalString");
function optionalStringArray(value, fieldName) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new Error(`Invalid ${fieldName}: expected array, got ${typeof value}`);
  if (!value.every((item) => typeof item === "string")) throw new Error(`Invalid ${fieldName}: array must contain only strings`);
  return [...value];
}
__name(optionalStringArray, "optionalStringArray");
function optionalHttpUri(value, fieldName) {
  const uri = optionalString(value, fieldName);
  if (uri === void 0) return void 0;
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid ${fieldName}: must be an absolute http: or https: URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Invalid ${fieldName}: must be an absolute http: or https: URL`);
  return uri;
}
__name(optionalHttpUri, "optionalHttpUri");
var I18N_FIELDS = {
  client_name: "string",
  client_uri: "uri",
  logo_uri: "uri",
  tos_uri: "uri",
  policy_uri: "uri"
};
function extractI18nFields(raw) {
  const result = {};
  for (const key of Object.keys(raw)) {
    const hashIndex = key.indexOf("#");
    if (hashIndex <= 0 || hashIndex === key.length - 1) continue;
    const kind = I18N_FIELDS[key.slice(0, hashIndex)];
    if (!kind) continue;
    const value = kind === "uri" ? optionalHttpUri(raw[key], key) : optionalString(raw[key], key);
    if (value !== void 0) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : void 0;
}
__name(extractI18nFields, "extractI18nFields");
function validateChoiceConsistency(preferredName, preferredValue, choicesName, choices) {
  if (preferredValue !== void 0 && choices !== void 0 && !choices.includes(preferredValue)) throw new Error(`${preferredName} must be included in ${choicesName}`);
}
__name(validateChoiceConsistency, "validateChoiceConsistency");
function parseOAuthClientMetadata(raw) {
  const tokenEndpointAuthMethod = optionalString(raw.token_endpoint_auth_method, "token_endpoint_auth_method");
  const tokenEndpointAuthMethodsSupported = optionalStringArray(raw.token_endpoint_auth_methods_supported, "token_endpoint_auth_methods_supported");
  const tokenEndpointAuthSigningAlg = optionalString(raw.token_endpoint_auth_signing_alg, "token_endpoint_auth_signing_alg");
  const tokenEndpointAuthSigningAlgValuesSupported = optionalStringArray(raw.token_endpoint_auth_signing_alg_values_supported, "token_endpoint_auth_signing_alg_values_supported");
  validateChoiceConsistency("token_endpoint_auth_method", tokenEndpointAuthMethod, "token_endpoint_auth_methods_supported", tokenEndpointAuthMethodsSupported);
  validateChoiceConsistency("token_endpoint_auth_signing_alg", tokenEndpointAuthSigningAlg, "token_endpoint_auth_signing_alg_values_supported", tokenEndpointAuthSigningAlgValuesSupported);
  return {
    clientId: optionalString(raw.client_id, "client_id"),
    redirectUris: optionalStringArray(raw.redirect_uris, "redirect_uris"),
    clientName: optionalString(raw.client_name, "client_name"),
    clientUri: optionalHttpUri(raw.client_uri, "client_uri"),
    logoUri: optionalHttpUri(raw.logo_uri, "logo_uri"),
    policyUri: optionalHttpUri(raw.policy_uri, "policy_uri"),
    tosUri: optionalHttpUri(raw.tos_uri, "tos_uri"),
    jwksUri: optionalHttpUri(raw.jwks_uri, "jwks_uri"),
    i18n: extractI18nFields(raw),
    contacts: optionalStringArray(raw.contacts, "contacts"),
    grantTypes: optionalStringArray(raw.grant_types, "grant_types"),
    responseTypes: optionalStringArray(raw.response_types, "response_types"),
    tokenEndpointAuthMethod,
    tokenEndpointAuthMethodsSupported,
    tokenEndpointAuthSigningAlg,
    tokenEndpointAuthSigningAlgValuesSupported
  };
}
__name(parseOAuthClientMetadata, "parseOAuthClientMetadata");
function pickDisplayMetadata(metadata) {
  const { clientName, clientUri, logoUri, policyUri, tosUri, jwksUri, i18n, contacts } = metadata;
  return {
    clientName,
    clientUri,
    logoUri,
    policyUri,
    tosUri,
    jwksUri,
    i18n,
    contacts
  };
}
__name(pickDisplayMetadata, "pickDisplayMetadata");
function validateRedirectUriScheme(redirectUri) {
  const dangerousSchemes = [
    "javascript:",
    "data:",
    "vbscript:",
    "file:",
    "mailto:",
    "blob:"
  ];
  const normalized = redirectUri.trim();
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code >= 0 && code <= 31 || code >= 127 && code <= 159) throw new Error("Invalid redirect URI");
  }
  const colonIndex = normalized.indexOf(":");
  if (colonIndex === -1) throw new Error("Invalid redirect URI");
  const scheme = normalized.slice(0, colonIndex + 1).toLowerCase();
  if (dangerousSchemes.includes(scheme)) throw new Error("Invalid redirect URI");
}
__name(validateRedirectUriScheme, "validateRedirectUriScheme");
function requireValidRedirectUris(redirectUris) {
  if (!redirectUris || redirectUris.length === 0) throw new Error("redirect_uris is required and must not be empty");
  for (const redirectUri of redirectUris) validateRedirectUriScheme(redirectUri);
  return redirectUris;
}
__name(requireValidRedirectUris, "requireValidRedirectUris");
function resolveDynamicClientRegistrationMetadata(raw, server) {
  const metadata = parseOAuthClientMetadata(raw);
  const capabilities = negotiateDynamicClientRegistrationCapabilities(server, {
    tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
    tokenEndpointAuthMethodsSupported: metadata.tokenEndpointAuthMethodsSupported,
    grantTypes: metadata.grantTypes ?? ["authorization_code"],
    responseTypes: metadata.responseTypes ?? ["code"]
  });
  return {
    ...pickDisplayMetadata(metadata),
    redirectUris: requireValidRedirectUris(metadata.redirectUris),
    ...capabilities,
    authMethodExplicit: metadata.tokenEndpointAuthMethod !== void 0 || metadata.tokenEndpointAuthMethodsSupported !== void 0
  };
}
__name(resolveDynamicClientRegistrationMetadata, "resolveDynamicClientRegistrationMetadata");
function rawPath(clientId) {
  const schemeEnd = clientId.indexOf("://");
  if (schemeEnd === -1) return "";
  const authorityStart = schemeEnd + 3;
  const authorityEndOffset = clientId.slice(authorityStart).search(/[/?#]/);
  if (authorityEndOffset === -1) return "";
  const pathStart = authorityStart + authorityEndOffset;
  if (clientId[pathStart] !== "/") return "";
  const pathEndOffset = clientId.slice(pathStart).search(/[?#]/);
  return pathEndOffset === -1 ? clientId.slice(pathStart) : clientId.slice(pathStart, pathStart + pathEndOffset);
}
__name(rawPath, "rawPath");
function validateClientIdentifierUrl(clientId) {
  if (clientId !== clientId.trim() || /[\x00-\x20\x7f-\x9f\\]/.test(clientId)) throw new Error("Client Identifier URL contains invalid whitespace or characters");
  if (!/^https:\/\//i.test(clientId)) throw new Error("Client Identifier URL must use an absolute HTTPS URL");
  let parsed;
  try {
    parsed = new URL(clientId);
  } catch {
    throw new Error("Client Identifier URL must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:") throw new Error("Client Identifier URL must use HTTPS");
  if (parsed.username || parsed.password) throw new Error("Client Identifier URL must not contain userinfo");
  if (parsed.hash) throw new Error("Client Identifier URL must not contain a fragment");
  const path = rawPath(clientId);
  if (!path) throw new Error("Client Identifier URL must contain a path component");
  for (const segment of path.split("/")) {
    let decodedSegment;
    try {
      decodedSegment = decodeURIComponent(segment);
    } catch {
      throw new Error("Client Identifier URL contains invalid percent encoding");
    }
    if (decodedSegment === "." || decodedSegment === "..") throw new Error("Client Identifier URL must not contain dot path segments");
  }
}
__name(validateClientIdentifierUrl, "validateClientIdentifierUrl");
function isClientIdMetadataDocumentUrl(clientId) {
  try {
    return new URL(clientId).protocol === "https:" && rawPath(clientId) !== "";
  } catch {
    return false;
  }
}
__name(isClientIdMetadataDocumentUrl, "isClientIdMetadataDocumentUrl");
function containsPrivateJwkMaterial(value) {
  if (value === void 0) return false;
  const jwks = requireJsonObject(value);
  if (!Array.isArray(jwks.keys)) throw new Error("Invalid jwks: keys must be an array");
  const privateMembers = /* @__PURE__ */ new Set([
    "d",
    "p",
    "q",
    "dp",
    "dq",
    "qi",
    "oth",
    "k"
  ]);
  for (const value$1 of jwks.keys) {
    const key = requireJsonObject(value$1);
    if (Object.keys(key).some((member) => privateMembers.has(member))) return true;
  }
  return false;
}
__name(containsPrivateJwkMaterial, "containsPrivateJwkMaterial");
function resolveClientIdMetadataDocument(metadataUrl, value, server) {
  const raw = requireJsonObject(value);
  const metadata = parseOAuthClientMetadata(raw);
  if (metadata.clientId !== metadataUrl) throw new Error(`client_id "${metadata.clientId}" does not match metadata URL "${metadataUrl}"`);
  if (!metadata.clientName?.trim()) throw new Error("client_name is required and must not be empty");
  const redirectUris = requireValidRedirectUris(metadata.redirectUris);
  if ("client_secret" in raw || "client_secret_expires_at" in raw) throw new Error("CIMD documents must not contain client secrets");
  if (containsPrivateJwkMaterial(raw.jwks)) throw new Error("CIMD documents must not contain private key material");
  const capabilities = negotiateCimdClientCapabilities(server, {
    tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
    tokenEndpointAuthMethodsSupported: metadata.tokenEndpointAuthMethodsSupported,
    grantTypes: metadata.grantTypes ?? ["authorization_code"],
    responseTypes: metadata.responseTypes ?? ["code"]
  });
  return {
    ...pickDisplayMetadata(metadata),
    clientId: metadata.clientId,
    clientName: metadata.clientName,
    redirectUris,
    ...capabilities
  };
}
__name(resolveClientIdMetadataDocument, "resolveClientIdMetadataDocument");
function readStreamChunk(reader, signal) {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = /* @__PURE__ */ __name(() => {
      reader.cancel().catch(() => void 0);
      reject(new DOMException("Aborted", "AbortError"));
    }, "abort");
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
__name(readStreamChunk, "readStreamChunk");
async function readJsonWithSizeLimit$1(response, maxBytes, signal) {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null) {
    const declaredSize = Number(contentLength);
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      await response.body?.cancel().catch(() => void 0);
      throw new Error(`Client metadata exceeds size limit: ${contentLength} bytes (max ${maxBytes})`);
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Client metadata response body is empty");
  const chunks = [];
  let totalSize = 0;
  while (true) {
    const { done, value } = await readStreamChunk(reader, signal);
    if (done) break;
    if (!value) continue;
    totalSize += value.length;
    if (totalSize > maxBytes) {
      await reader.cancel().catch(() => void 0);
      throw new Error(`Response exceeded size limit of ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const bytes = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false
    }).decode(bytes);
  } catch {
    throw new Error("Client metadata response is not valid UTF-8");
  }
  try {
    return {
      value: JSON.parse(text),
      bytes
    };
  } catch {
    throw new Error("Client metadata response is not valid JSON");
  }
}
__name(readJsonWithSizeLimit$1, "readJsonWithSizeLimit$1");
function fetchCimdOrigin(metadataUrl, signal) {
  return fetch(metadataUrl, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-store"
    },
    signal,
    cache: "no-store"
  });
}
__name(fetchCimdOrigin, "fetchCimdOrigin");
async function openCimdCache() {
  if (typeof caches === "undefined") return void 0;
  try {
    return await caches.open(CIMD_CACHE_NAME);
  } catch {
    return;
  }
}
__name(openCimdCache, "openCimdCache");
function cacheTtlSeconds(response) {
  const cacheControl = response.headers.get("Cache-Control");
  if (cacheControl === null || /(?:^|,)\s*(?:no-cache|no-store|private)\b/i.test(cacheControl)) return void 0;
  const directive = /(?:^|,)\s*s-maxage\s*=\s*"?(\d+)/i.exec(cacheControl) ?? /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(cacheControl);
  if (!directive) return void 0;
  const ttl = Math.min(Number(directive[1]), CIMD_CACHE_MAX_TTL_SECONDS);
  return ttl > 0 ? ttl : void 0;
}
__name(cacheTtlSeconds, "cacheTtlSeconds");
async function cacheValidatedDocument(cache, metadataUrl, response, bytes) {
  if (!cache) return;
  const ttl = cacheTtlSeconds(response);
  if (ttl === void 0) return;
  const headers = new Headers({ "Cache-Control": `public, max-age=${ttl}` });
  for (const name of [
    "Content-Type",
    "ETag",
    "Last-Modified"
  ]) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  try {
    await cache.put(metadataUrl, new Response(bytes, {
      status: 200,
      headers
    }));
  } catch {
  }
}
__name(cacheValidatedDocument, "cacheValidatedDocument");
async function tryResolveFromCache(cache, metadataUrl, server, signal) {
  let cached;
  try {
    cached = await cache?.match(metadataUrl);
  } catch {
    return;
  }
  if (!cached) return void 0;
  try {
    const { value } = await readJsonWithSizeLimit$1(cached, CIMD_MAX_SIZE_BYTES, signal);
    return resolveClientIdMetadataDocument(metadataUrl, value, server);
  } catch (error) {
    if (signal.aborted) throw error;
    try {
      await cache?.delete(metadataUrl);
    } catch {
    }
    return;
  }
}
__name(tryResolveFromCache, "tryResolveFromCache");
async function fetchClientIdMetadataDocument(metadataUrl, server) {
  validateClientIdentifierUrl(metadataUrl);
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), CIMD_FETCH_TIMEOUT_MS);
  try {
    const cache = await openCimdCache();
    const cachedDocument = await tryResolveFromCache(cache, metadataUrl, server, abortController.signal);
    if (cachedDocument) return cachedDocument;
    const response = await fetchCimdOrigin(metadataUrl, abortController.signal);
    if (!response.ok) throw new Error(`Failed to fetch client metadata: HTTP ${response.status}`);
    const { value, bytes } = await readJsonWithSizeLimit$1(response, CIMD_MAX_SIZE_BYTES, abortController.signal);
    const resolved = resolveClientIdMetadataDocument(metadataUrl, value, server);
    clearTimeout(timeoutId);
    await cacheValidatedDocument(cache, metadataUrl, response, bytes);
    return resolved;
  } catch (error) {
    if (abortController.signal.aborted) throw new Error(`Client metadata fetch timed out after ${CIMD_FETCH_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
__name(fetchClientIdMetadataDocument, "fetchClientIdMetadataDocument");
var EMA_ID_JAG_JWT_TYPE = "oauth-id-jag+jwt";
var EMA_ID_JAG_GRANT_PROFILE = "urn:ietf:params:oauth:grant-profile:id-jag";
var EMA_MAX_JWT_BYTES = 16 * 1024;
var EMA_JWKS_MAX_SIZE_BYTES = 64 * 1024;
var EMA_JWKS_FETCH_TIMEOUT_MS = 1e4;
var EMA_DEFAULT_JWKS_CACHE_TTL_SECONDS = 300;
var EMA_DEFAULT_CLOCK_SKEW_SECONDS = 60;
var EMA_DEFAULT_MAX_ASSERTION_LIFETIME_SECONDS = 300;
var EMA_JWKS_FORCE_REFRESH_COOLDOWN_SECONDS = 30;
var EMA_DEFAULT_JWT_ALGORITHM = "RS256";
var EMA_SUPPORTED_JWT_ALGORITHMS = /* @__PURE__ */ new Set(["RS256", "ES256"]);
var ok = /* @__PURE__ */ __name((value) => ({
  ok: true,
  value
}), "ok");
var err = /* @__PURE__ */ __name((error) => ({
  ok: false,
  error
}), "err");
function emaErrorToWire(e) {
  switch (e.reason) {
    case "assertion_missing":
      return {
        code: "invalid_request",
        message: "assertion is required"
      };
    case "invalid_scope_param":
      return {
        code: "invalid_request",
        message: "Invalid scope parameter format"
      };
    case "resource_invalid":
    case "resource_mismatch":
      return {
        code: "invalid_target",
        message: "Invalid resource"
      };
    case "mapper_denied":
    case "mapper_threw":
      return {
        code: "invalid_grant",
        message: "Assertion was not authorized"
      };
    case "invalid_mapped_user":
      return {
        code: "invalid_grant",
        message: "Invalid mapped user"
      };
    case "invalid_mapped_scope":
      return {
        code: "invalid_grant",
        message: "Invalid mapped scope"
      };
    case "invalid_mapped_props":
      return {
        code: "invalid_grant",
        message: "Invalid mapped props"
      };
    case "invalid_mapped_ttl":
      return {
        code: "invalid_grant",
        message: "Invalid access token TTL"
      };
    case "assertion_expired_after_processing":
      return {
        code: "invalid_grant",
        message: "Assertion has expired"
      };
    case "assertion_too_large":
    case "assertion_malformed":
    case "invalid_typ":
    case "invalid_alg":
    case "issuer_not_trusted":
    case "no_matching_key":
    case "signature_failed":
    case "jwks_fetch_failed":
    case "invalid_claim":
    case "aud_mismatch":
    case "unsupported_claim":
    case "expired":
    case "iat_in_future":
    case "nbf_in_future":
    case "lifetime_too_long":
    case "replayed":
    case "client_id_mismatch":
      return {
        code: "invalid_grant",
        message: "Invalid assertion"
      };
  }
}
__name(emaErrorToWire, "emaErrorToWire");
async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
var EMA_JTI_KV_PREFIX = "enterprise-jti:";
function createKvJtiStore() {
  return { async markUsed({ issuer, jti, exp, now, env }) {
    const ttl = Math.max(1, exp - now);
    const key = `${EMA_JTI_KV_PREFIX}${await sha256Hex(`${issuer}
${jti}`)}`;
    if (await env.OAUTH_KV.get(key)) return err({
      reason: "replayed",
      jti
    });
    await env.OAUTH_KV.put(key, "1", { expirationTtl: ttl });
    return ok(void 0);
  } };
}
__name(createKvJtiStore, "createKvJtiStore");
function createDefaultJwksProvider(opts = {}) {
  const cache = /* @__PURE__ */ new Map();
  const cacheTtl = opts.cacheTtlSeconds ?? EMA_DEFAULT_JWKS_CACHE_TTL_SECONDS;
  return { async fetch(issuer, { forceRefresh, now }) {
    const cached = cache.get(issuer.issuer);
    if (!forceRefresh && cached && cached.expiresAt > now) return ok(cached.jwks);
    if (forceRefresh && cached && cached.nextForceRefreshAllowedAt > now) return ok(cached.jwks);
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), EMA_JWKS_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(issuer.jwksUri, {
        headers: { Accept: "application/json" },
        signal: abortController.signal,
        cf: { cacheEverything: true }
      });
      if (!response.ok) return err({
        reason: "jwks_fetch_failed",
        status: response.status
      });
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > EMA_JWKS_MAX_SIZE_BYTES) return err({
        reason: "jwks_fetch_failed",
        status: response.status
      });
      const rawJwks = await readJsonWithSizeLimit(response, EMA_JWKS_MAX_SIZE_BYTES);
      if (!rawJwks.ok) return err({ reason: "jwks_fetch_failed" });
      if (!Array.isArray(rawJwks.value.keys)) return err({ reason: "jwks_fetch_failed" });
      const jwks = { keys: rawJwks.value.keys };
      cache.set(issuer.issuer, {
        jwks,
        expiresAt: now + cacheTtl,
        nextForceRefreshAllowedAt: now + EMA_JWKS_FORCE_REFRESH_COOLDOWN_SECONDS
      });
      return ok(jwks);
    } catch {
      return err({ reason: "jwks_fetch_failed" });
    } finally {
      clearTimeout(timeoutId);
    }
  } };
}
__name(createDefaultJwksProvider, "createDefaultJwksProvider");
async function readJsonWithSizeLimit(response, maxBytes) {
  if (!response.body) return { ok: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(merged));
    if (typeof parsed !== "object" || parsed === null) return { ok: false };
    return {
      ok: true,
      value: parsed
    };
  } catch {
    return { ok: false };
  }
}
__name(readJsonWithSizeLimit, "readJsonWithSizeLimit");
function parseIdJag(assertion, maxBytes) {
  if (typeof assertion !== "string" || assertion.length === 0) return err({ reason: "assertion_missing" });
  if (assertion.length > maxBytes) return err({
    reason: "assertion_too_large",
    size: assertion.length,
    max: maxBytes
  });
  const parts = assertion.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return err({ reason: "assertion_malformed" });
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  let header;
  let rawClaims;
  let signature;
  try {
    header = parseJwtJsonPart(encodedHeader);
    rawClaims = parseJwtJsonPart(encodedClaims);
    signature = base64UrlToBytes(encodedSignature);
  } catch {
    return err({ reason: "assertion_malformed" });
  }
  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
  return ok({
    header,
    rawClaims,
    signingInput,
    signature
  });
}
__name(parseIdJag, "parseIdJag");
function selectJwk(jwks, alg, kid) {
  const matching = (jwks.keys ?? []).filter((key) => {
    if (kid && key.kid !== kid) return false;
    if (key.alg && key.alg !== alg) return false;
    if (key.use && key.use !== "sig") return false;
    if (Array.isArray(key.key_ops) && !key.key_ops.includes("verify")) return false;
    if (alg.startsWith("RS") && key.kty !== "RSA") return false;
    if (alg.startsWith("ES") && key.kty !== "EC") return false;
    return true;
  });
  if (kid) {
    const picked = matching[0];
    if (!picked) return err({
      reason: "no_matching_key",
      kid
    });
    return ok(picked);
  }
  if (matching.length !== 1) return err({ reason: "no_matching_key" });
  return ok(matching[0]);
}
__name(selectJwk, "selectJwk");
async function verifyIdJagSignature(input) {
  try {
    const { importAlgorithm, verifyAlgorithm } = getJwtCryptoAlgorithms(input.alg);
    const key = await crypto.subtle.importKey("jwk", input.jwk, importAlgorithm, false, ["verify"]);
    return await crypto.subtle.verify(verifyAlgorithm, key, input.signature, input.signingInput);
  } catch {
    return false;
  }
}
__name(verifyIdJagSignature, "verifyIdJagSignature");
function validateIdJagHeader(header, expectedTyp, supportedAlgs) {
  const typ = header.typ;
  if (typeof typ !== "string" || typ !== expectedTyp) return err({
    reason: "invalid_typ",
    got: typ
  });
  const alg = header.alg;
  if (typeof alg !== "string" || alg === "none" || !supportedAlgs.has(alg)) return err({
    reason: "invalid_alg",
    got: alg
  });
  const kidRaw = header.kid;
  return ok({
    typ,
    alg,
    kid: typeof kidRaw === "string" && kidRaw.length > 0 ? kidRaw : void 0
  });
}
__name(validateIdJagHeader, "validateIdJagHeader");
async function resolveTrustedIssuer(input) {
  const { iss, alg, resolver, env, request, clientInfo } = input;
  if (typeof iss !== "string" || iss.length === 0) return err({
    reason: "invalid_claim",
    claim: "iss"
  });
  let resolved;
  try {
    resolved = await resolver({
      iss,
      env,
      request,
      clientInfo
    });
  } catch {
    return err({
      reason: "issuer_not_trusted",
      iss
    });
  }
  if (!resolved) return err({
    reason: "issuer_not_trusted",
    iss
  });
  if (resolved.issuer !== iss) return err({
    reason: "issuer_not_trusted",
    iss
  });
  if (!isWellFormedTrustedIssuer(resolved)) return err({
    reason: "issuer_not_trusted",
    iss
  });
  if (!(resolved.algorithms ?? [EMA_DEFAULT_JWT_ALGORITHM]).includes(alg)) return err({
    reason: "issuer_not_trusted",
    iss
  });
  return ok(resolved);
}
__name(resolveTrustedIssuer, "resolveTrustedIssuer");
function isWellFormedTrustedIssuer(issuer) {
  let issuerUrl;
  try {
    issuerUrl = new URL(issuer.issuer);
  } catch {
    return false;
  }
  if (issuerUrl.protocol !== "https:") return false;
  let jwksUrl;
  try {
    jwksUrl = new URL(issuer.jwksUri);
  } catch {
    return false;
  }
  if (jwksUrl.protocol !== "https:") return false;
  const algorithms = issuer.algorithms ?? [EMA_DEFAULT_JWT_ALGORITHM];
  if (algorithms.length === 0) return false;
  for (const alg of algorithms) if (!EMA_SUPPORTED_JWT_ALGORITHMS.has(alg)) return false;
  if (issuer.audience !== void 0) try {
    new URL(issuer.audience);
  } catch {
    return false;
  }
  return true;
}
__name(isWellFormedTrustedIssuer, "isWellFormedTrustedIssuer");
function validateIdJagClaims(input) {
  const { rawClaims, trustedIssuer, expectedAudience, clientId, configuredResource, matchOriginOnly } = input;
  const { now, clockSkewSeconds, maxAssertionLifetimeSeconds } = input;
  const iss = readRequiredString(rawClaims, "iss");
  if (!iss.ok) return iss;
  if (iss.value !== trustedIssuer.issuer) return err({
    reason: "issuer_not_trusted",
    iss: iss.value
  });
  const sub = readRequiredString(rawClaims, "sub");
  if (!sub.ok) return sub;
  const aud = readAudienceClaim(rawClaims);
  if (!aud.ok) return aud;
  for (const claim of ["authorization_details", "cnf"]) if (rawClaims[claim] !== void 0) return err({
    reason: "unsupported_claim",
    claim
  });
  const resource = rawClaims.resource === void 0 ? ok(configuredResource) : readRequiredString(rawClaims, "resource");
  if (!resource.ok) return resource;
  const claimClientId = readRequiredString(rawClaims, "client_id");
  if (!claimClientId.ok) return claimClientId;
  const jti = readRequiredString(rawClaims, "jti");
  if (!jti.ok) return jti;
  const exp = readNumericDateClaim(rawClaims, "exp");
  if (!exp.ok) return exp;
  const iat = readNumericDateClaim(rawClaims, "iat");
  if (!iat.ok) return iat;
  if ((Array.isArray(aud.value) ? aud.value[0] : aud.value) !== expectedAudience) return err({
    reason: "aud_mismatch",
    expected: expectedAudience,
    got: aud.value
  });
  if (claimClientId.value !== clientId) return err({
    reason: "client_id_mismatch",
    expected: clientId,
    got: claimClientId.value
  });
  if (!validateResourceUri(resource.value)) return err({
    reason: "resource_invalid",
    resource: resource.value
  });
  if (!resourceMatches(resource.value, configuredResource, matchOriginOnly)) return err({
    reason: "resource_mismatch",
    expected: configuredResource,
    got: resource.value
  });
  if (exp.value + clockSkewSeconds <= now) return err({
    reason: "expired",
    exp: exp.value,
    now
  });
  if (iat.value > now + clockSkewSeconds) return err({
    reason: "iat_in_future",
    iat: iat.value,
    now,
    skew: clockSkewSeconds
  });
  if (rawClaims.nbf !== void 0) {
    const nbf = readNumericDateClaim(rawClaims, "nbf");
    if (!nbf.ok) return nbf;
    if (nbf.value > now + clockSkewSeconds) return err({
      reason: "nbf_in_future",
      nbf: nbf.value,
      now,
      skew: clockSkewSeconds
    });
  }
  const lifetime = exp.value - iat.value;
  if (lifetime > maxAssertionLifetimeSeconds + clockSkewSeconds) return err({
    reason: "lifetime_too_long",
    lifetime,
    max: maxAssertionLifetimeSeconds
  });
  let scope;
  let assertionScopes = [];
  if (rawClaims.scope !== void 0) {
    const parsed = readRequiredString(rawClaims, "scope");
    if (!parsed.ok) return parsed;
    const tokens = parsed.value.split(" ").filter(Boolean);
    for (const token of tokens) if (!isValidOAuthScopeToken(token)) return err({
      reason: "invalid_claim",
      claim: "scope"
    });
    scope = parsed.value;
    assertionScopes = tokens;
  }
  return ok({
    claims: {
      ...rawClaims,
      iss: iss.value,
      sub: sub.value,
      aud: aud.value,
      resource: resource.value,
      client_id: claimClientId.value,
      jti: jti.value,
      exp: exp.value,
      iat: iat.value,
      scope
    },
    resource: resource.value,
    assertionScopes
  });
}
__name(validateIdJagClaims, "validateIdJagClaims");
function parseEmaScopeParam(scope, assertionScopes) {
  let requested;
  if (scope === void 0) requested = [...assertionScopes];
  else if (typeof scope === "string") {
    const tokens = scope.split(" ").filter(Boolean);
    for (const token of tokens) if (!isValidOAuthScopeToken(token)) return err({ reason: "invalid_scope_param" });
    requested = tokens;
  } else if (Array.isArray(scope) && scope.every((value) => typeof value === "string")) {
    requested = [];
    for (const part of scope) {
      const tokens = part.split(" ").filter(Boolean);
      for (const token of tokens) if (!isValidOAuthScopeToken(token)) return err({ reason: "invalid_scope_param" });
      requested.push(...tokens);
    }
  } else return err({ reason: "invalid_scope_param" });
  if (assertionScopes.length > 0) {
    const allowed = new Set(assertionScopes);
    requested = requested.filter((token) => allowed.has(token));
  }
  return ok(requested);
}
__name(parseEmaScopeParam, "parseEmaScopeParam");
function validateEmaMapperResult(result) {
  if (result === null) return err({ reason: "mapper_denied" });
  if (typeof result !== "object") return err({ reason: "invalid_mapped_user" });
  const r = result;
  if (typeof r.userId !== "string" || r.userId.length === 0 || r.userId.includes(":")) return err({ reason: "invalid_mapped_user" });
  if (!Array.isArray(r.scope) || !r.scope.every((s) => typeof s === "string" && isValidOAuthScopeToken(s))) return err({ reason: "invalid_mapped_scope" });
  if (!("props" in r) || r.props === void 0) return err({ reason: "invalid_mapped_props" });
  if (r.accessTokenTTL !== void 0) {
    if (typeof r.accessTokenTTL !== "number" || !Number.isFinite(r.accessTokenTTL) || r.accessTokenTTL <= 0) return err({ reason: "invalid_mapped_ttl" });
  }
  return ok({
    userId: r.userId,
    scope: r.scope,
    props: r.props,
    metadata: r.metadata,
    accessTokenTTL: r.accessTokenTTL
  });
}
__name(validateEmaMapperResult, "validateEmaMapperResult");
function computeEmaAccessTokenTTL(input) {
  const { configuredDefaultSeconds, assertionExp, mapperTtl, now, minTtlSeconds } = input;
  if (assertionExp - now <= 0) return err({ reason: "assertion_expired_after_processing" });
  const ttl = mapperTtl ?? configuredDefaultSeconds;
  if (ttl < minTtlSeconds) return err({ reason: "invalid_mapped_ttl" });
  return ok(ttl);
}
__name(computeEmaAccessTokenTTL, "computeEmaAccessTokenTTL");
function readRequiredString(claims, claimName) {
  const value = claims[claimName];
  if (typeof value !== "string" || value.length === 0) return err({
    reason: "invalid_claim",
    claim: claimName
  });
  return ok(value);
}
__name(readRequiredString, "readRequiredString");
function readAudienceClaim(claims) {
  const aud = claims.aud;
  if (typeof aud === "string" && aud.length > 0) return ok(aud);
  if (Array.isArray(aud) && aud.length === 1 && typeof aud[0] === "string" && aud[0].length > 0) return ok(aud);
  return err({
    reason: "invalid_claim",
    claim: "aud"
  });
}
__name(readAudienceClaim, "readAudienceClaim");
function readNumericDateClaim(claims, claimName) {
  const value = claims[claimName];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return err({
    reason: "invalid_claim",
    claim: claimName
  });
  return ok(value);
}
__name(readNumericDateClaim, "readNumericDateClaim");
var PROTECTED_RESOURCE_WELL_KNOWN_PREFIX = "/.well-known/oauth-protected-resource";
var NO_CACHE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache"
};
var BASIC_AUTH_CHALLENGE = 'Basic realm="OAuth"';
if (!(typeof Cloudflare !== "undefined" && Cloudflare.compatibilityFlags?.global_fetch_strictly_public === true)) console.warn(`CIMD (Client ID Metadata Document) is disabled: add '"compatibility_flags": ["global_fetch_strictly_public"]' to your wrangler.jsonc to enable. See: https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public`);
var HandlerType = /* @__PURE__ */ (function(HandlerType$1) {
  HandlerType$1[HandlerType$1["EXPORTED_HANDLER"] = 0] = "EXPORTED_HANDLER";
  HandlerType$1[HandlerType$1["WORKER_ENTRYPOINT"] = 1] = "WORKER_ENTRYPOINT";
  return HandlerType$1;
})(HandlerType || {});
var GrantType = /* @__PURE__ */ (function(GrantType$1) {
  GrantType$1["AUTHORIZATION_CODE"] = "authorization_code";
  GrantType$1["REFRESH_TOKEN"] = "refresh_token";
  GrantType$1["TOKEN_EXCHANGE"] = "urn:ietf:params:oauth:grant-type:token-exchange";
  GrantType$1["JWT_BEARER"] = "urn:ietf:params:oauth:grant-type:jwt-bearer";
  return GrantType$1;
})({});
function toPublicClientInfo(client) {
  const { authMethodExplicit: _explicit, ...publicClient } = client;
  return publicClient;
}
__name(toPublicClientInfo, "toPublicClientInfo");
function isClientAuthMethodAllowed(client, presentedMethod, isClientMetadataDocument) {
  if (presentedMethod === client.tokenEndpointAuthMethod) return true;
  const isSecretMethod = /* @__PURE__ */ __name((method) => method === "client_secret_basic" || method === "client_secret_post", "isSecretMethod");
  return !isClientMetadataDocument && client.authMethodExplicit === void 0 && isSecretMethod(client.tokenEndpointAuthMethod) && isSecretMethod(presentedMethod);
}
__name(isClientAuthMethodAllowed, "isClientAuthMethodAllowed");
var OAuthProvider = class {
  static {
    __name(this, "OAuthProvider");
  }
  #impl;
  /**
  * Creates a new OAuth provider instance
  * @param options - Configuration options for the provider
  */
  constructor(options) {
    this.#impl = new OAuthProviderImpl(options);
  }
  /**
  * Main fetch handler for the Worker
  * Routes requests to the appropriate handler based on the URL
  * @param request - The HTTP request
  * @param env - Cloudflare Worker environment variables
  * @param ctx - Cloudflare Worker execution context
  * @returns A Promise resolving to an HTTP Response
  */
  fetch(request, env, ctx) {
    return this.#impl.fetch(request, env, ctx);
  }
  /**
  * Purges expired and orphaned data from the KV namespace.
  * Can be called directly from a scheduled handler without needing a request context.
  *
  * @param env - Cloudflare Worker environment variables (must include OAUTH_KV binding)
  * @param options - Optional configuration for batch size and which purge types to enable
  * @returns Statistics about what was checked and purged
  */
  purgeExpiredData(env, options) {
    return this.#impl.createOAuthHelpers(env).purgeExpiredData(options);
  }
};
var OAuthProviderImpl = class {
  static {
    __name(this, "OAuthProviderImpl");
  }
  /**
  * Creates a new OAuth provider instance
  * @param options - Configuration options for the provider
  */
  constructor(options) {
    this.typedApiHandlers = [];
    const hasSingleHandlerConfig = !!(options.apiRoute && options.apiHandler);
    const hasMultiHandlerConfig = !!options.apiHandlers;
    if (hasSingleHandlerConfig && hasMultiHandlerConfig) throw new TypeError("Cannot use both apiRoute/apiHandler and apiHandlers. Use either apiRoute + apiHandler OR apiHandlers, not both.");
    if (!hasSingleHandlerConfig && !hasMultiHandlerConfig) throw new TypeError("Must provide either apiRoute + apiHandler OR apiHandlers. No API route configuration provided.");
    this.typedDefaultHandler = this.validateHandler(options.defaultHandler, "defaultHandler");
    if (hasSingleHandlerConfig) {
      const apiHandler = this.validateHandler(options.apiHandler, "apiHandler");
      if (Array.isArray(options.apiRoute)) options.apiRoute.forEach((route, index) => {
        this.validateEndpoint(route, `apiRoute[${index}]`);
        this.typedApiHandlers.push([route, apiHandler]);
      });
      else {
        this.validateEndpoint(options.apiRoute, "apiRoute");
        this.typedApiHandlers.push([options.apiRoute, apiHandler]);
      }
    } else for (const [route, handler] of Object.entries(options.apiHandlers)) {
      this.validateEndpoint(route, `apiHandlers key: ${route}`);
      this.typedApiHandlers.push([route, this.validateHandler(handler, `apiHandlers[${route}]`)]);
    }
    this.validateEndpoint(options.authorizeEndpoint, "authorizeEndpoint");
    this.validateEndpoint(options.tokenEndpoint, "tokenEndpoint");
    if (options.clientRegistrationEndpoint) this.validateEndpoint(options.clientRegistrationEndpoint, "clientRegistrationEndpoint");
    this.options = {
      accessTokenTTL: DEFAULT_ACCESS_TOKEN_TTL,
      refreshTokenTTL: DEFAULT_REFRESH_TOKEN_TTL,
      clientRegistrationTTL: DEFAULT_CLIENT_REGISTRATION_TTL,
      onError: /* @__PURE__ */ __name(({ status, code, description }) => console.warn(`OAuth error response: ${status} ${code} - ${description}`), "onError"),
      ...options
    };
    if (!Number.isInteger(this.options.accessTokenTTL) || this.options.accessTokenTTL < KV_MIN_EXPIRATION_TTL_SECONDS) throw new TypeError(`accessTokenTTL must be an integer of at least ${KV_MIN_EXPIRATION_TTL_SECONDS} seconds (Cloudflare KV's minimum expiration window).`);
    this.serverCapabilities = buildOAuthServerCapabilities({
      allowImplicitFlow: !!this.options.allowImplicitFlow,
      allowPlainPKCE: this.options.allowPlainPKCE === true,
      allowTokenExchangeGrant: !!this.options.allowTokenExchangeGrant,
      enterpriseManagedAuthorization: !!this.options.enterpriseManagedAuthorization
    });
    validateAuthorizationServerScopes(this.options.scopesSupported);
    this.validateResourceMetadataOptions(this.options.resourceMetadata);
    this.validateEmaOptions(this.options.enterpriseManagedAuthorization);
    if (this.options.enterpriseManagedAuthorization) {
      this.jwksProvider = createDefaultJwksProvider({ cacheTtlSeconds: this.options.enterpriseManagedAuthorization.jwksCacheTtlSeconds });
      this.jtiStore = createKvJtiStore();
    }
  }
  /**
  * Validates that an endpoint is either an absolute path or a full URL
  * @param endpoint - The endpoint to validate
  * @param name - The name of the endpoint property for error messages
  * @throws TypeError if the endpoint is invalid
  */
  validateEndpoint(endpoint, name) {
    if (this.isPath(endpoint)) {
      if (!endpoint.startsWith("/")) throw new TypeError(`${name} path must be an absolute path starting with /`);
    } else try {
      new URL(endpoint);
    } catch (e) {
      throw new TypeError(`${name} must be either an absolute path starting with / or a valid URL`);
    }
  }
  /**
  * Validates that a handler is either an ExportedHandler or a class extending WorkerEntrypoint
  * @param handler - The handler to validate
  * @param name - The name of the handler property for error messages
  * @returns The type of the handler (EXPORTED_HANDLER or WORKER_ENTRYPOINT)
  * @throws TypeError if the handler is invalid
  */
  validateHandler(handler, name) {
    if (typeof handler === "object" && handler !== null && typeof handler.fetch === "function") return {
      type: HandlerType.EXPORTED_HANDLER,
      handler
    };
    if (typeof handler === "function" && handler.prototype instanceof WorkerEntrypoint) return {
      type: HandlerType.WORKER_ENTRYPOINT,
      handler
    };
    throw new TypeError(`${name} must be either an ExportedHandler object with a fetch method or a class extending WorkerEntrypoint`);
  }
  /** Validate configured RFC 9728 protected resource metadata. */
  validateResourceMetadataOptions(options) {
    if (!options) return;
    if (options.resource !== void 0 && !validateResourceUri(options.resource)) throw new TypeError("resourceMetadata.resource must be an absolute HTTP(S) URI without a fragment");
    if (options.authorization_servers !== void 0) {
      if (options.authorization_servers.length === 0) throw new TypeError("resourceMetadata.authorization_servers must contain at least one issuer");
      for (const issuer of options.authorization_servers) {
        let parsed;
        try {
          parsed = new URL(issuer);
        } catch {
          throw new TypeError("resourceMetadata.authorization_servers must contain valid HTTPS issuer URLs");
        }
        if (parsed.protocol !== "https:" || parsed.search || parsed.hash) throw new TypeError("resourceMetadata.authorization_servers must contain valid HTTPS issuer URLs");
      }
    }
    if (options.scopes_supported?.some((scope) => !isValidOAuthScopeToken(scope))) throw new TypeError("resourceMetadata.scopes_supported must contain valid OAuth scope tokens");
    if (options.bearer_methods_supported?.some((method) => method !== "header")) throw new TypeError("resourceMetadata.bearer_methods_supported only supports 'header'");
  }
  /**
  * Validates MCP Enterprise-Managed Authorization configuration at construction time.
  *
  * Presence of `enterpriseManagedAuthorization` on options enables the feature —
  * there is no separate `enabled` flag (which would silently disable EMA when
  * forgotten). Configuration is checked structurally; runtime concerns
  * (JWKS reachability etc.) are checked when assertions arrive.
  */
  validateEmaOptions(options) {
    if (!options) return;
    if (typeof options.trustedIssuers !== "function") throw new TypeError("enterpriseManagedAuthorization.trustedIssuers must be a resolver function: (input) => EmaTrustedIssuer | null");
    if (typeof options.mapClaims !== "function") throw new TypeError("enterpriseManagedAuthorization.mapClaims must be a function");
    if (!this.options.resourceMetadata?.resource) throw new TypeError("enterpriseManagedAuthorization requires resourceMetadata.resource to be configured");
    if (options.jwksCacheTtlSeconds !== void 0 && options.jwksCacheTtlSeconds <= 0) throw new TypeError("enterpriseManagedAuthorization.jwksCacheTtlSeconds must be greater than 0");
    if (options.clockSkewSeconds !== void 0 && options.clockSkewSeconds < 0) throw new TypeError("enterpriseManagedAuthorization.clockSkewSeconds must be non-negative");
    if (options.maxAssertionLifetimeSeconds !== void 0 && options.maxAssertionLifetimeSeconds <= 0) throw new TypeError("enterpriseManagedAuthorization.maxAssertionLifetimeSeconds must be greater than 0");
  }
  /**
  * Main fetch handler for the Worker
  * Routes requests to the appropriate handler based on the URL
  * @param request - The HTTP request
  * @param env - Cloudflare Worker environment variables
  * @param ctx - Cloudflare Worker execution context
  * @returns A Promise resolving to an HTTP Response
  */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (this.isApiRequest(url) || url.pathname === "/.well-known/oauth-authorization-server" || this.isProtectedResourceMetadataRequest(url) || this.isTokenEndpoint(url) || this.options.clientRegistrationEndpoint && this.isClientRegistrationEndpoint(url)) return this.addCorsHeaders(new Response(null, {
        status: 204,
        headers: { "Content-Length": "0" }
      }), request);
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      const response = await this.handleMetadataDiscovery(url);
      return this.addCorsHeaders(response, request);
    }
    if (this.isProtectedResourceMetadataRequest(url)) {
      const response = this.handleProtectedResourceMetadata(url);
      return this.addCorsHeaders(response, request);
    }
    if (this.isTokenEndpoint(url)) {
      const parsed = await this.parseTokenEndpointRequest(request, env);
      if (parsed instanceof Response) return this.addCorsHeaders(parsed, request);
      let response;
      if (parsed.isRevocationRequest) response = await this.handleRevocationRequest(parsed.body, parsed.clientInfo, env);
      else response = await this.handleTokenRequest(parsed.body, parsed.clientInfo, env, url, request);
      return this.addCorsHeaders(response, request);
    }
    if (this.options.clientRegistrationEndpoint && this.isClientRegistrationEndpoint(url)) {
      const response = await this.handleClientRegistration(request, env);
      return this.addCorsHeaders(response, request);
    }
    if (this.isApiRequest(url)) {
      const response = await this.handleApiRequest(request, env, ctx);
      return this.addCorsHeaders(response, request);
    }
    if (!env.OAUTH_PROVIDER) env.OAUTH_PROVIDER = this.createOAuthHelpers(env);
    if (this.typedDefaultHandler.type === HandlerType.EXPORTED_HANDLER) return this.typedDefaultHandler.handler.fetch(request, env, ctx);
    return new this.typedDefaultHandler.handler(ctx, env).fetch(request);
  }
  /**
  * Decodes a token and returns token data with decrypted props
  * @param token - The granted token
  * @param env - Cloudflare Worker environment variables
  * @returns Promise resolving to token data with decrypted props, or null if token is invalid
  */
  async unwrapToken(token, env) {
    const parts = token.split(":");
    if (!(parts.length === 3)) return null;
    const [userId, grantId] = parts;
    const id = await generateTokenId(token);
    const tokenData = await env.OAUTH_KV.get(`token:${userId}:${grantId}:${id}`, { type: "json" });
    if (!tokenData) return null;
    const now = Math.floor(Date.now() / 1e3);
    if (tokenData.expiresAt < now) return null;
    const decryptedProps = await decryptProps(await unwrapKeyWithToken(token, tokenData.wrappedEncryptionKey), tokenData.grant.encryptedProps);
    const { grant } = tokenData;
    return {
      id: tokenData.id,
      grantId: tokenData.grantId,
      userId: tokenData.userId,
      createdAt: tokenData.createdAt,
      expiresAt: tokenData.expiresAt,
      audience: tokenData.audience,
      scope: tokenData.scope || grant.scope,
      grant: {
        clientId: grant.clientId,
        scope: grant.scope,
        props: decryptedProps
      }
    };
  }
  /**
  * Determines if an endpoint configuration is a path or a full URL
  * @param endpoint - The endpoint configuration
  * @returns True if the endpoint is a path (starts with /), false if it's a full URL
  */
  isPath(endpoint) {
    return endpoint.startsWith("/");
  }
  /**
  * Matches a URL against an endpoint pattern that can be a full URL or just a path
  * @param url - The URL to check
  * @param endpoint - The endpoint pattern (full URL or path)
  * @returns True if the URL matches the endpoint pattern
  */
  matchEndpoint(url, endpoint) {
    if (this.isPath(endpoint)) return url.pathname === endpoint;
    else {
      const endpointUrl = new URL(endpoint);
      return url.hostname === endpointUrl.hostname && url.pathname === endpointUrl.pathname;
    }
  }
  /**
  * Checks if a URL matches the configured token endpoint
  * @param url - The URL to check
  * @returns True if the URL matches the token endpoint
  */
  isTokenEndpoint(url) {
    return this.matchEndpoint(url, this.options.tokenEndpoint);
  }
  /**
  * Checks if a URL matches the configured client registration endpoint
  * @param url - The URL to check
  * @returns True if the URL matches the client registration endpoint
  */
  isClientRegistrationEndpoint(url) {
    if (!this.options.clientRegistrationEndpoint) return false;
    return this.matchEndpoint(url, this.options.clientRegistrationEndpoint);
  }
  /**
  * Checks if a URL is a request for OAuth Protected Resource Metadata (RFC 9728).
  * Matches both the root well-known path and path-suffixed variants per RFC 9728 §3.1.
  */
  isProtectedResourceMetadataRequest(url) {
    return url.pathname === PROTECTED_RESOURCE_WELL_KNOWN_PREFIX || url.pathname.startsWith(PROTECTED_RESOURCE_WELL_KNOWN_PREFIX + "/");
  }
  /**
  * Derives the resource identifier from a protected resource metadata well-known URL.
  * Per RFC 9728 §3.1, the well-known URI is inserted after the authority and before the path,
  * so the resource identifier is reconstructed by removing the well-known prefix.
  *
  * Examples:
  *   /.well-known/oauth-protected-resource       → origin (e.g. https://example.com)
  *   /.well-known/oauth-protected-resource/mcp   → origin + /mcp (e.g. https://example.com/mcp)
  */
  deriveResourceIdentifier(requestUrl) {
    const suffix = requestUrl.pathname.slice(37);
    if (!suffix || suffix === "/") return requestUrl.origin;
    return `${requestUrl.origin}${suffix}`;
  }
  createInvalidClientResponse(description, basicAuthenticationAttempted, internal, request) {
    return this.createErrorResponse("invalid_client", {
      description,
      statusCode: 401,
      ...basicAuthenticationAttempted ? { headers: { "WWW-Authenticate": BASIC_AUTH_CHALLENGE } } : {}
    }, internal, request);
  }
  /**
  * Parses and validates a token endpoint request (used for both token exchange and revocation)
  * @param request - The HTTP request to parse
  * @returns Promise with parsed body and client info, or error response
  */
  async parseTokenEndpointRequest(request, env) {
    if (request.method !== "POST") return this.createErrorResponse("invalid_request", {
      description: "Method not allowed",
      statusCode: 405
    });
    const contentType = request.headers.get("Content-Type") || "";
    let body = {};
    if (contentType.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return this.createErrorResponse("invalid_request", {
      description: "Content-Type must be application/x-www-form-urlencoded",
      statusCode: 400
    });
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return this.createErrorResponse("invalid_request", {
        description: "Request body must be valid application/x-www-form-urlencoded data",
        statusCode: 400
      });
    }
    const processedKeys = /* @__PURE__ */ new Set();
    for (const [key, value] of formData.entries()) {
      if (processedKeys.has(key)) continue;
      processedKeys.add(key);
      const allValues = formData.getAll(key);
      if (key !== "resource" && allValues.length > 1) return this.createErrorResponse("invalid_request", {
        description: `Request parameter "${key}" must not be repeated`,
        statusCode: 400
      });
      body[key] = allValues.length > 1 ? allValues : value;
    }
    const basicAuthorization = parseBasicAuthorizationHeader(request.headers.get("Authorization"));
    const basicAuthenticationAttempted = basicAuthorization.kind !== "not-basic";
    let clientId = "";
    let clientSecret = "";
    if (basicAuthenticationAttempted) {
      if (formData.has("client_id") || formData.has("client_secret")) return this.createErrorResponse("invalid_request", {
        description: "Client must not use multiple authentication methods",
        statusCode: 400
      });
      if (basicAuthorization.kind === "malformed") return this.createInvalidClientResponse("Client authentication failed: invalid Basic credentials", basicAuthenticationAttempted);
      clientId = basicAuthorization.clientId;
      clientSecret = basicAuthorization.clientSecret;
    } else {
      clientId = body.client_id;
      clientSecret = body.client_secret || "";
    }
    if (!clientId) return this.createInvalidClientResponse("Client ID is required", basicAuthenticationAttempted);
    let clientInfo;
    try {
      clientInfo = await this.getClient(env, clientId);
    } catch (error) {
      if (error instanceof CimdFetchError) return this.createInvalidClientResponse("Client not found", basicAuthenticationAttempted, {
        category: "client-id-metadata-document",
        reason: error.reason,
        detail: {
          metadataUrl: error.metadataUrl,
          message: error.detail
        }
      }, request);
      throw error;
    }
    if (!clientInfo) return this.createInvalidClientResponse("Client not found", basicAuthenticationAttempted);
    const presentedAuthMethod = basicAuthenticationAttempted ? "client_secret_basic" : formData.has("client_secret") ? "client_secret_post" : "none";
    const registeredAuthMethod = clientInfo.tokenEndpointAuthMethod;
    if (!isClientAuthMethodAllowed(clientInfo, presentedAuthMethod, !!this.options.clientIdMetadataDocumentEnabled && this.isClientMetadataUrl(clientInfo.clientId))) return this.createInvalidClientResponse("Client authentication failed", basicAuthenticationAttempted, {
      category: "client-authentication",
      reason: "token_endpoint_auth_method_mismatch",
      detail: {
        clientId: clientInfo.clientId,
        registeredMethod: registeredAuthMethod,
        presentedMethod: presentedAuthMethod
      }
    });
    if (presentedAuthMethod !== "none") {
      if (!clientSecret) return this.createInvalidClientResponse("Client authentication failed: missing client_secret", basicAuthenticationAttempted);
      if (!clientInfo.clientSecret) return this.createInvalidClientResponse("Client authentication failed: client has no registered secret", basicAuthenticationAttempted);
      if (await hashSecret(clientSecret) !== clientInfo.clientSecret) return this.createInvalidClientResponse("Client authentication failed: invalid client_secret", basicAuthenticationAttempted);
    }
    const isRevocationRequest = !body.grant_type && !!body.token;
    return {
      body,
      clientInfo,
      isRevocationRequest
    };
  }
  /**
  * Checks if a URL matches a specific API route
  * @param url - The URL to check
  * @param route - The API route to check against
  * @returns True if the URL matches the API route
  */
  matchApiRoute(url, route) {
    if (this.isPath(route)) {
      if (route === "/") return url.pathname === "/";
      return url.pathname.startsWith(route);
    } else {
      const apiUrl = new URL(route);
      return url.hostname === apiUrl.hostname && url.pathname.startsWith(apiUrl.pathname);
    }
  }
  /**
  * Checks if a URL is an API request based on the configured API route(s)
  * @param url - The URL to check
  * @returns True if the URL matches any of the API routes
  */
  isApiRequest(url) {
    for (const [route, _] of this.typedApiHandlers) if (this.matchApiRoute(url, route)) return true;
    return false;
  }
  /**
  * Finds the appropriate API handler for a URL
  * @param url - The URL to find a handler for
  * @returns The TypedHandler for the URL, or undefined if no handler matches
  */
  findApiHandlerForUrl(url) {
    for (const [route, handler] of this.typedApiHandlers) if (this.matchApiRoute(url, route)) return handler;
  }
  /**
  * Gets the full URL for an endpoint, using the provided request URL's
  * origin for endpoints specified as just paths
  * @param endpoint - The endpoint configuration (path or full URL)
  * @param requestUrl - The URL of the incoming request
  * @returns The full URL for the endpoint
  */
  getFullEndpointUrl(endpoint, requestUrl) {
    if (this.isPath(endpoint)) return `${requestUrl.origin}${endpoint}`;
    else return endpoint;
  }
  /**
  * Gets the authorization server issuer using the same derivation as RFC 8414 metadata.
  */
  getAuthorizationServerIssuer(requestUrl) {
    const tokenEndpoint = this.getFullEndpointUrl(this.options.tokenEndpoint, requestUrl);
    return new URL(tokenEndpoint).origin;
  }
  /**
  * Adds CORS headers to a response
  * @param response - The response to add CORS headers to
  * @param request - The original request
  * @returns A new Response with CORS headers added
  */
  addCorsHeaders(response, request) {
    const origin = request.headers.get("Origin");
    if (!origin) return response;
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Access-Control-Allow-Origin", origin);
    newResponse.headers.set("Access-Control-Allow-Methods", "*");
    newResponse.headers.set("Access-Control-Allow-Headers", "Authorization, *");
    const exposedHeaders = (newResponse.headers.get("Access-Control-Expose-Headers") ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    for (const requiredHeader of ["WWW-Authenticate", "Retry-After"]) if (!exposedHeaders.some((name) => name.toLowerCase() === requiredHeader.toLowerCase())) exposedHeaders.push(requiredHeader);
    newResponse.headers.set("Access-Control-Expose-Headers", exposedHeaders.join(", "));
    newResponse.headers.set("Access-Control-Max-Age", "86400");
    return newResponse;
  }
  /**
  * Handles the OAuth metadata discovery endpoint
  * Implements RFC 8414 for OAuth Server Metadata
  * @param requestUrl - The URL of the incoming request
  * @returns Response with OAuth server metadata
  */
  async handleMetadataDiscovery(requestUrl) {
    const tokenEndpoint = this.getFullEndpointUrl(this.options.tokenEndpoint, requestUrl);
    const authorizeEndpoint = this.getFullEndpointUrl(this.options.authorizeEndpoint, requestUrl);
    let registrationEndpoint = void 0;
    if (this.options.clientRegistrationEndpoint) registrationEndpoint = this.getFullEndpointUrl(this.options.clientRegistrationEndpoint, requestUrl);
    const responseTypesSupported = this.serverCapabilities.responseTypes;
    const grantTypesSupported = this.serverCapabilities.grantTypes;
    const authorizationGrantProfilesSupported = this.options.enterpriseManagedAuthorization ? [EMA_ID_JAG_GRANT_PROFILE] : [];
    const metadata = {
      issuer: new URL(tokenEndpoint).origin,
      authorization_endpoint: authorizeEndpoint,
      token_endpoint: tokenEndpoint,
      registration_endpoint: registrationEndpoint,
      scopes_supported: this.options.scopesSupported,
      response_types_supported: responseTypesSupported,
      response_modes_supported: this.options.allowImplicitFlow ? ["query", "fragment"] : ["query"],
      grant_types_supported: grantTypesSupported,
      ...authorizationGrantProfilesSupported.length > 0 ? { authorization_grant_profiles_supported: authorizationGrantProfilesSupported } : {},
      token_endpoint_auth_methods_supported: this.serverCapabilities.tokenEndpointAuthMethods,
      revocation_endpoint: tokenEndpoint,
      code_challenge_methods_supported: this.serverCapabilities.codeChallengeMethods,
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: !!this.options.clientIdMetadataDocumentEnabled && this.hasGlobalFetchStrictlyPublic()
    };
    return new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json" } });
  }
  /** Scopes that are baseline requirements of the protected resource itself. */
  getProtectedResourceScopes() {
    return this.normalizeProtectedResourceScopes(this.options.resourceMetadata?.scopes_supported ?? []);
  }
  /** Deduplicate resource-facing scopes and remove authorization-server-only capabilities. */
  normalizeProtectedResourceScopes(scopes) {
    return [...new Set(scopes)].filter((scope) => scope !== "offline_access");
  }
  /**
  * Handles the OAuth Protected Resource Metadata endpoint
  * Implements RFC 9728 for OAuth Protected Resource Metadata
  * @param requestUrl - The URL of the incoming request
  * @returns Response with protected resource metadata
  */
  handleProtectedResourceMetadata(requestUrl) {
    const rm = this.options.resourceMetadata;
    const tokenEndpointUrl = this.getFullEndpointUrl(this.options.tokenEndpoint, requestUrl);
    const authServerOrigin = new URL(tokenEndpointUrl).origin;
    const resourceScopes = this.getProtectedResourceScopes();
    const metadata = {
      resource: rm?.resource ?? this.deriveResourceIdentifier(requestUrl),
      authorization_servers: rm?.authorization_servers ?? [authServerOrigin],
      ...resourceScopes.length > 0 ? { scopes_supported: resourceScopes } : {},
      bearer_methods_supported: rm?.bearer_methods_supported ?? ["header"]
    };
    if (rm?.resource_name) metadata.resource_name = rm.resource_name;
    return new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json" } });
  }
  /**
  * Handles client authentication and token issuance via the token endpoint
  * Supports authorization_code and refresh_token grant types
  * @param body - The parsed request body
  * @param clientInfo - The authenticated client information
  * @param env - Cloudflare Worker environment variables
  * @returns Response with token data or error
  */
  async handleTokenRequest(body, clientInfo, env, requestUrl, request) {
    try {
      const grantType = body.grant_type;
      if (grantType === GrantType.AUTHORIZATION_CODE) return await this.handleAuthorizationCodeGrant(body, clientInfo, env);
      else if (grantType === GrantType.REFRESH_TOKEN) return await this.handleRefreshTokenGrant(body, clientInfo, env);
      else if (grantType === GrantType.TOKEN_EXCHANGE && this.options.allowTokenExchangeGrant) return await this.handleTokenExchangeGrant(body, clientInfo, env);
      else if (grantType === GrantType.JWT_BEARER) return await this.handleJwtBearerGrant(body, clientInfo, env, requestUrl, request);
      else return this.createErrorResponse("unsupported_grant_type", { description: "Grant type not supported" });
    } catch (error) {
      const response = this.createOAuthErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }
  /**
  * Build a structured OAuth token-endpoint response from an OAuth error.
  *
  * The supported form is throwing this package's exported `OAuthError` from
  * token issuance or `tokenExchangeCallback`. Anything else is re-thrown so
  * unexpected failures still surface as 500s.
  */
  createOAuthErrorResponse(error) {
    if (!(error instanceof OAuthError)) return void 0;
    return this.createErrorResponse(error.code, error.options);
  }
  /**
  * Build a structured protected-resource response from an external-token error.
  *
  * Only this package's exported `ExternalTokenError` is converted. Standard
  * bearer failures receive an RFC 6750 / RFC 9728 challenge unless the caller
  * supplied one. Other errors retain the pre-existing behavior and are re-thrown.
  */
  createExternalTokenErrorResponse(error, resourceMetadataUrl) {
    if (!(error instanceof ExternalTokenError)) return void 0;
    const headers = error.headers ?? {};
    const hasChallenge = Object.keys(headers).some((name) => name.toLowerCase() === "www-authenticate");
    const isBearerError = error.code === "invalid_token" && error.statusCode === 401 || error.code === "insufficient_scope" && error.statusCode === 403;
    let challengeHeaders;
    if (isBearerError && !hasChallenge) {
      const requiredScopes = [...new Set(error.requiredScopes ?? [])];
      if (requiredScopes.some((scope) => !isValidOAuthScopeToken(scope))) throw new TypeError("ExternalTokenError requiredScopes must contain valid OAuth scope tokens");
      challengeHeaders = {
        ...headers,
        "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl, error.code, void 0, requiredScopes)
      };
    }
    return this.createErrorResponse(error.code, {
      description: error.description,
      statusCode: error.statusCode,
      headers: challengeHeaders ?? headers
    });
  }
  /**
  * Handles the authorization code grant type
  * Exchanges an authorization code for access and refresh tokens
  * @param body - The parsed request body
  * @param clientInfo - The authenticated client information
  * @param env - Cloudflare Worker environment variables
  * @returns Response with token data or error
  */
  async handleAuthorizationCodeGrant(body, clientInfo, env) {
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const codeVerifier = body.code_verifier;
    if (!code) return this.createErrorResponse("invalid_request", { description: "Authorization code is required" });
    const codeParts = code.split(":");
    if (codeParts.length !== 3) return this.createErrorResponse("invalid_grant", { description: "Invalid authorization code format" });
    const [userId, grantId, _] = codeParts;
    const grantKey = `grant:${userId}:${grantId}`;
    const grantData = await env.OAUTH_KV.get(grantKey, { type: "json" });
    if (!grantData) return this.createErrorResponse("invalid_grant", { description: "Grant not found or authorization code expired" });
    const codeHash = await hashSecret(code);
    if (!grantData.authCodeId || codeHash !== grantData.authCodeId) return this.createErrorResponse("invalid_grant", { description: "Invalid authorization code" });
    if (grantData.clientId !== clientInfo.clientId) return this.createErrorResponse("invalid_grant", { description: "Client ID mismatch" });
    if (!grantData.authCodeWrappedKey) {
      try {
        await this.createOAuthHelpers(env).revokeGrant(grantId, userId);
      } catch {
      }
      return this.createErrorResponse("invalid_grant", { description: "Authorization code already used" });
    }
    let codeChallengeMethod;
    try {
      codeChallengeMethod = grantData.codeChallenge ? validatePkceCodeChallengeMethod(this.serverCapabilities, grantData.codeChallengeMethod) : normalizePkceCodeChallengeMethod(grantData.codeChallengeMethod);
    } catch (error) {
      return this.createErrorResponse("invalid_grant", { description: error instanceof Error ? error.message : "Invalid PKCE code_challenge_method" });
    }
    const isPkceEnabled = !!grantData.codeChallenge;
    if (!redirectUri && !isPkceEnabled) return this.createErrorResponse("invalid_request", { description: "redirect_uri is required when not using PKCE" });
    if (redirectUri && !isValidRedirectUri(redirectUri, clientInfo.redirectUris)) return this.createErrorResponse("invalid_grant", { description: "Invalid redirect URI" });
    if (!isPkceEnabled && codeVerifier) return this.createErrorResponse("invalid_request", { description: "code_verifier provided for a flow that did not use PKCE" });
    if (isPkceEnabled) {
      if (!codeVerifier) return this.createErrorResponse("invalid_request", { description: "code_verifier is required for PKCE" });
      let calculatedChallenge;
      if (codeChallengeMethod === "S256") {
        const data = new TextEncoder().encode(codeVerifier);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        calculatedChallenge = base64UrlEncode(String.fromCharCode(...hashArray));
      } else calculatedChallenge = codeVerifier;
      if (calculatedChallenge !== grantData.codeChallenge) return this.createErrorResponse("invalid_grant", { description: "Invalid PKCE code_verifier" });
    }
    const audience = this.resolveTokenResource(body.resource, grantData.resource);
    let accessTokenTTL = this.options.accessTokenTTL;
    let refreshTokenTTL = this.options.refreshTokenTTL;
    const encryptionKey = await unwrapKeyWithToken(code, grantData.authCodeWrappedKey);
    let grantEncryptionKey = encryptionKey;
    let accessTokenEncryptionKey = encryptionKey;
    let encryptedAccessTokenProps = grantData.encryptedProps;
    let tokenScopes = this.downscope(body.scope, grantData.scope);
    if (this.options.tokenExchangeCallback) {
      const decryptedProps = await decryptProps(encryptionKey, grantData.encryptedProps);
      let grantProps = decryptedProps;
      let accessTokenProps = decryptedProps;
      const callbackOptions = {
        grantType: GrantType.AUTHORIZATION_CODE,
        clientId: clientInfo.clientId,
        userId,
        grantId,
        scope: grantData.scope,
        requestedScope: tokenScopes,
        props: decryptedProps
      };
      const callbackResult = await Promise.resolve(this.options.tokenExchangeCallback(callbackOptions));
      if (callbackResult) {
        if (callbackResult.newProps) {
          grantProps = callbackResult.newProps;
          if (!callbackResult.accessTokenProps) accessTokenProps = callbackResult.newProps;
        }
        if (callbackResult.accessTokenProps) accessTokenProps = callbackResult.accessTokenProps;
        if (callbackResult.accessTokenTTL !== void 0) accessTokenTTL = callbackResult.accessTokenTTL;
        if ("refreshTokenTTL" in callbackResult) refreshTokenTTL = callbackResult.refreshTokenTTL;
        if (callbackResult.accessTokenScope) tokenScopes = this.downscope(callbackResult.accessTokenScope, grantData.scope);
      }
      const grantResult = await encryptProps(grantProps);
      grantData.encryptedProps = grantResult.encryptedData;
      grantEncryptionKey = grantResult.key;
      if (accessTokenProps !== grantProps) {
        const tokenResult = await encryptProps(accessTokenProps);
        encryptedAccessTokenProps = tokenResult.encryptedData;
        accessTokenEncryptionKey = tokenResult.key;
      } else {
        encryptedAccessTokenProps = grantData.encryptedProps;
        accessTokenEncryptionKey = grantEncryptionKey;
      }
    }
    const now = Math.floor(Date.now() / 1e3);
    const useRefreshToken = refreshTokenTTL !== 0;
    delete grantData.codeChallenge;
    delete grantData.codeChallengeMethod;
    delete grantData.authCodeWrappedKey;
    let refreshToken;
    if (useRefreshToken) {
      refreshToken = `${userId}:${grantId}:${generateRandomString(TOKEN_LENGTH)}`;
      const refreshTokenId = await generateTokenId(refreshToken);
      const refreshTokenWrappedKey = await wrapKeyWithToken(refreshToken, grantEncryptionKey);
      const expiresAt = refreshTokenTTL !== void 0 ? now + refreshTokenTTL : void 0;
      grantData.refreshTokenId = refreshTokenId;
      grantData.refreshTokenWrappedKey = refreshTokenWrappedKey;
      grantData.previousRefreshTokenId = void 0;
      grantData.previousRefreshTokenWrappedKey = void 0;
      grantData.expiresAt = expiresAt;
    }
    await this.saveGrantWithTTL(env, grantKey, grantData, now);
    const tokenResponse = {
      access_token: await this.createAccessToken({
        userId,
        grantId,
        clientId: grantData.clientId,
        scope: tokenScopes,
        encryptedProps: encryptedAccessTokenProps,
        encryptionKey: accessTokenEncryptionKey,
        expiresIn: accessTokenTTL,
        audience,
        env
      }),
      token_type: "bearer",
      expires_in: accessTokenTTL,
      scope: tokenScopes.join(" ")
    };
    if (refreshToken) tokenResponse.refresh_token = refreshToken;
    if (audience) tokenResponse.resource = audience;
    return new Response(JSON.stringify(tokenResponse), { headers: {
      "Content-Type": "application/json",
      ...NO_CACHE_HEADERS
    } });
  }
  /**
  * Handles the refresh token grant type
  * Issues a new access token using a refresh token
  * @param body - The parsed request body
  * @param clientInfo - The authenticated client information
  * @param env - Cloudflare Worker environment variables
  * @returns Response with token data or error
  */
  async handleRefreshTokenGrant(body, clientInfo, env) {
    const refreshToken = body.refresh_token;
    if (!refreshToken) return this.createErrorResponse("invalid_request", { description: "Refresh token is required" });
    const tokenParts = refreshToken.split(":");
    if (tokenParts.length !== 3) return this.createErrorResponse("invalid_grant", { description: "Invalid token format" });
    const [userId, grantId, _] = tokenParts;
    const providedTokenHash = await generateTokenId(refreshToken);
    const grantKey = `grant:${userId}:${grantId}`;
    const grantData = await env.OAUTH_KV.get(grantKey, { type: "json" });
    if (!grantData) return this.createErrorResponse("invalid_grant", { description: "Grant not found" });
    const isCurrentToken = grantData.refreshTokenId === providedTokenHash;
    const isPreviousToken = grantData.previousRefreshTokenId === providedTokenHash;
    if (!isCurrentToken && !isPreviousToken) return this.createErrorResponse("invalid_grant", { description: "Invalid refresh token" });
    if (grantData.clientId !== clientInfo.clientId) return this.createErrorResponse("invalid_grant", { description: "Client ID mismatch" });
    if (grantData.expiresAt !== void 0) {
      const now$1 = Math.floor(Date.now() / 1e3);
      if (grantData.expiresAt - now$1 < KV_MIN_EXPIRATION_TTL_SECONDS) return this.createErrorResponse("invalid_grant", { description: "Refresh token has expired" });
    }
    const audience = this.resolveTokenResource(body.resource, grantData.resource);
    const newAccessToken = `${userId}:${grantId}:${generateRandomString(TOKEN_LENGTH)}`;
    const accessTokenId = await generateTokenId(newAccessToken);
    let accessTokenTTL = this.options.accessTokenTTL;
    let wrappedKeyToUse;
    if (isCurrentToken) wrappedKeyToUse = grantData.refreshTokenWrappedKey;
    else wrappedKeyToUse = grantData.previousRefreshTokenWrappedKey;
    const encryptionKey = await unwrapKeyWithToken(refreshToken, wrappedKeyToUse);
    let grantEncryptionKey = encryptionKey;
    let accessTokenEncryptionKey = encryptionKey;
    let encryptedAccessTokenProps = grantData.encryptedProps;
    let tokenScopes = this.downscope(body.scope, grantData.scope);
    let grantPropsChanged = false;
    if (this.options.tokenExchangeCallback) {
      const decryptedProps = await decryptProps(encryptionKey, grantData.encryptedProps);
      let grantProps = decryptedProps;
      let accessTokenProps = decryptedProps;
      const callbackOptions = {
        grantType: GrantType.REFRESH_TOKEN,
        clientId: clientInfo.clientId,
        userId,
        grantId,
        scope: grantData.scope,
        requestedScope: tokenScopes,
        props: decryptedProps
      };
      const callbackResult = await Promise.resolve(this.options.tokenExchangeCallback(callbackOptions));
      if (callbackResult) {
        if (callbackResult.newProps) {
          grantProps = callbackResult.newProps;
          grantPropsChanged = true;
          if (!callbackResult.accessTokenProps) accessTokenProps = callbackResult.newProps;
        }
        if (callbackResult.accessTokenProps) accessTokenProps = callbackResult.accessTokenProps;
        if (callbackResult.accessTokenTTL !== void 0) accessTokenTTL = callbackResult.accessTokenTTL;
        if ("refreshTokenTTL" in callbackResult) return this.createErrorResponse("invalid_request", { description: "refreshTokenTTL cannot be changed during refresh token exchange" });
        if (callbackResult.accessTokenScope) tokenScopes = this.downscope(callbackResult.accessTokenScope, grantData.scope);
      }
      if (grantPropsChanged) {
        const grantResult = await encryptProps(grantProps);
        grantData.encryptedProps = grantResult.encryptedData;
        if (grantResult.key !== encryptionKey) {
          grantEncryptionKey = grantResult.key;
          wrappedKeyToUse = await wrapKeyWithToken(refreshToken, grantEncryptionKey);
        } else grantEncryptionKey = grantResult.key;
      }
      if (accessTokenProps !== grantProps) {
        const tokenResult = await encryptProps(accessTokenProps);
        encryptedAccessTokenProps = tokenResult.encryptedData;
        accessTokenEncryptionKey = tokenResult.key;
      } else {
        encryptedAccessTokenProps = grantData.encryptedProps;
        accessTokenEncryptionKey = grantEncryptionKey;
      }
    }
    const now = Math.floor(Date.now() / 1e3);
    if (grantData.expiresAt !== void 0 && grantData.expiresAt - now < KV_MIN_EXPIRATION_TTL_SECONDS) return this.createErrorResponse("invalid_grant", { description: "Refresh token has expired" });
    if (grantData.expiresAt !== void 0) {
      const remainingRefreshTokenLifetime = grantData.expiresAt - now;
      if (remainingRefreshTokenLifetime > 0) accessTokenTTL = Math.min(accessTokenTTL, remainingRefreshTokenLifetime);
    }
    if (accessTokenTTL < KV_MIN_EXPIRATION_TTL_SECONDS) return this.createErrorResponse("invalid_request", { description: "Requested token lifetime must be at least 60 seconds" });
    const accessTokenExpiresAt = now + accessTokenTTL;
    const accessTokenWrappedKey = await wrapKeyWithToken(newAccessToken, accessTokenEncryptionKey);
    const newRefreshToken = `${userId}:${grantId}:${generateRandomString(TOKEN_LENGTH)}`;
    const newRefreshTokenId = await generateTokenId(newRefreshToken);
    const newRefreshTokenWrappedKey = await wrapKeyWithToken(newRefreshToken, grantEncryptionKey);
    grantData.previousRefreshTokenId = providedTokenHash;
    grantData.previousRefreshTokenWrappedKey = wrappedKeyToUse;
    grantData.refreshTokenId = newRefreshTokenId;
    grantData.refreshTokenWrappedKey = newRefreshTokenWrappedKey;
    await this.saveGrantWithTTL(env, grantKey, grantData, now);
    const accessTokenData = {
      id: accessTokenId,
      grantId,
      userId,
      createdAt: now,
      expiresAt: accessTokenExpiresAt,
      audience,
      scope: tokenScopes,
      wrappedEncryptionKey: accessTokenWrappedKey,
      grant: {
        clientId: grantData.clientId,
        scope: grantData.scope,
        encryptedProps: encryptedAccessTokenProps
      }
    };
    try {
      await env.OAUTH_KV.put(`token:${userId}:${grantId}:${accessTokenId}`, JSON.stringify(accessTokenData), { expirationTtl: accessTokenTTL });
    } catch (error) {
      this.throwRetryableTokenStorageErrorIfKvRateLimited(error);
      throw error;
    }
    const tokenResponse = {
      access_token: newAccessToken,
      token_type: "bearer",
      expires_in: accessTokenTTL,
      refresh_token: newRefreshToken,
      scope: tokenScopes.join(" ")
    };
    if (audience) tokenResponse.resource = audience;
    return new Response(JSON.stringify(tokenResponse), { headers: {
      "Content-Type": "application/json",
      ...NO_CACHE_HEADERS
    } });
  }
  /**
  * Core token exchange logic (RFC 8693)
  * Performs the actual token exchange operation
  * This method is not private because `OAuthHelpers` needs to call it. Note that since
  * `OAuthProviderImpl` is not exposed outside this module, this is still effectively
  * module-private.
  * @param subjectToken - The subject token to exchange
  * @param requestedScopes - Optional requested scopes, limited to the subject token's scopes
  * @param requestedResource - Optional resource/audience (must be subset of original if original had resource)
  * @param expiresIn - Optional TTL override in seconds
  * @param clientInfo - The client making the exchange request
  * @param env - Cloudflare Worker environment variables
  * @returns Promise resolving to token response
  * @throws OAuthError with OAuth error code and description
  */
  async exchangeToken(subjectToken, requestedScopes, requestedResource, expiresIn, clientInfo, env) {
    const tokenSummary = await this.unwrapToken(subjectToken, env);
    if (!tokenSummary) throw new OAuthError("invalid_grant", { description: "Invalid or expired subject token" });
    const grantKey = `grant:${tokenSummary.userId}:${tokenSummary.grantId}`;
    const grantData = await env.OAUTH_KV.get(grantKey, { type: "json" });
    if (!grantData) throw new OAuthError("invalid_grant", { description: "Grant not found" });
    let tokenScopes = this.downscope(requestedScopes, tokenSummary.scope);
    const configuredResource = this.options.resourceMetadata?.resource;
    if (configuredResource && !isExactResource(tokenSummary.audience, configuredResource)) throw new OAuthError("invalid_target", { description: "Subject token is not bound to the configured resource" });
    const newAudience = requestedResource === void 0 ? tokenSummary.audience : this.resolveTokenResource(requestedResource, grantData.resource);
    const now = Math.floor(Date.now() / 1e3);
    const subjectTokenRemainingLifetime = tokenSummary.expiresAt - now;
    if (subjectTokenRemainingLifetime < KV_MIN_EXPIRATION_TTL_SECONDS) throw new OAuthError("invalid_grant", { description: "Subject token is too close to expiry to exchange" });
    let accessTokenTTL = this.options.accessTokenTTL ?? DEFAULT_ACCESS_TOKEN_TTL;
    if (expiresIn !== void 0) {
      if (expiresIn <= 0) throw new OAuthError("invalid_request", { description: "Invalid expires_in parameter" });
      accessTokenTTL = Math.min(expiresIn, subjectTokenRemainingLifetime);
    } else accessTokenTTL = Math.min(accessTokenTTL, subjectTokenRemainingLifetime);
    const subjectTokenData = await env.OAUTH_KV.get(`token:${tokenSummary.userId}:${tokenSummary.grantId}:${tokenSummary.id}`, { type: "json" });
    if (!subjectTokenData) throw new OAuthError("invalid_grant", { description: "Subject token data not found" });
    const encryptionKey = await unwrapKeyWithToken(subjectToken, subjectTokenData.wrappedEncryptionKey);
    let accessTokenEncryptionKey = encryptionKey;
    let encryptedAccessTokenProps = subjectTokenData.grant.encryptedProps;
    if (this.options.tokenExchangeCallback) {
      const decryptedProps = await decryptProps(encryptionKey, subjectTokenData.grant.encryptedProps);
      const callbackOptions = {
        grantType: GrantType.TOKEN_EXCHANGE,
        clientId: clientInfo.clientId,
        userId: tokenSummary.userId,
        grantId: tokenSummary.grantId,
        scope: tokenSummary.grant.scope,
        requestedScope: tokenScopes,
        props: decryptedProps
      };
      const callbackResult = await Promise.resolve(this.options.tokenExchangeCallback(callbackOptions));
      if (callbackResult) {
        let accessTokenProps = decryptedProps;
        if (callbackResult.newProps) {
          if (!callbackResult.accessTokenProps) accessTokenProps = callbackResult.newProps;
        }
        if (callbackResult.accessTokenProps) accessTokenProps = callbackResult.accessTokenProps;
        if (callbackResult.accessTokenTTL !== void 0) accessTokenTTL = Math.min(callbackResult.accessTokenTTL, subjectTokenRemainingLifetime);
        if (accessTokenProps !== decryptedProps) {
          const tokenResult = await encryptProps(accessTokenProps);
          encryptedAccessTokenProps = tokenResult.encryptedData;
          accessTokenEncryptionKey = tokenResult.key;
        }
        if (callbackResult.accessTokenScope) tokenScopes = this.downscope(callbackResult.accessTokenScope, tokenSummary.scope);
      }
    }
    if (accessTokenTTL < KV_MIN_EXPIRATION_TTL_SECONDS) throw new OAuthError("invalid_request", { description: "Requested token lifetime must be at least 60 seconds" });
    const tokenResponse = {
      access_token: await this.createAccessToken({
        userId: tokenSummary.userId,
        grantId: tokenSummary.grantId,
        clientId: tokenSummary.grant.clientId,
        scope: tokenScopes,
        encryptedProps: encryptedAccessTokenProps,
        encryptionKey: accessTokenEncryptionKey,
        expiresIn: accessTokenTTL,
        audience: newAudience,
        env
      }),
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
      token_type: "bearer",
      expires_in: accessTokenTTL,
      scope: tokenScopes.join(" ")
    };
    if (newAudience) tokenResponse.resource = newAudience;
    return tokenResponse;
  }
  /**
  * Handles OAuth 2.0 token exchange requests (RFC 8693)
  * Exchanges an existing access token for a new one with modified characteristics
  * @param body - The parsed request body
  * @param clientInfo - The authenticated client information
  * @param env - Cloudflare Worker environment variables
  * @returns Response with new token data or error
  */
  async handleTokenExchangeGrant(body, clientInfo, env) {
    const subjectToken = body.subject_token;
    const subjectTokenType = body.subject_token_type;
    const requestedTokenType = body.requested_token_type || "urn:ietf:params:oauth:token-type:access_token";
    const requestedScope = body.scope;
    const requestedResource = body.resource;
    if (!subjectToken) return this.createErrorResponse("invalid_request", { description: "subject_token is required" });
    if (!subjectTokenType) return this.createErrorResponse("invalid_request", { description: "subject_token_type is required" });
    if (subjectTokenType !== "urn:ietf:params:oauth:token-type:access_token") return this.createErrorResponse("invalid_request", { description: "Only access_token subject_token_type is supported" });
    if (requestedTokenType !== "urn:ietf:params:oauth:token-type:access_token") return this.createErrorResponse("invalid_request", { description: "Only access_token requested_token_type is supported" });
    let requestedScopes;
    if (requestedScope) if (typeof requestedScope === "string") requestedScopes = requestedScope.split(" ").filter(Boolean);
    else if (Array.isArray(requestedScope)) requestedScopes = requestedScope;
    else return this.createErrorResponse("invalid_request", { description: "Invalid scope parameter format" });
    let expiresIn;
    if (body.expires_in !== void 0) {
      const requestedTTL = parseInt(body.expires_in, 10);
      if (isNaN(requestedTTL) || requestedTTL <= 0) return this.createErrorResponse("invalid_request", { description: "Invalid expires_in parameter" });
      expiresIn = requestedTTL;
    }
    try {
      const tokenResponse = await this.exchangeToken(subjectToken, requestedScopes, requestedResource, expiresIn, clientInfo, env);
      return new Response(JSON.stringify(tokenResponse), { headers: {
        "Content-Type": "application/json",
        ...NO_CACHE_HEADERS
      } });
    } catch (error) {
      const response = this.createOAuthErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }
  /**
  * Handles the MCP Enterprise-Managed Authorization JWT-bearer grant.
  *
  * Acts as a thin shell around `runEmaPipeline`: gate non-EMA traffic, run
  * the pipeline, translate the typed `EmaValidationError` Result back to a
  * standard OAuth wire response. All validation logic lives in pure
  * functions in `src/ema/`.
  */
  async handleJwtBearerGrant(body, clientInfo, env, requestUrl, request) {
    const enterpriseOptions = this.options.enterpriseManagedAuthorization;
    if (!enterpriseOptions) return this.createErrorResponse("unsupported_grant_type", { description: "Grant type not supported" });
    if (clientInfo.tokenEndpointAuthMethod === "none" && !enterpriseOptions.allowPublicClients) return this.createErrorResponse("invalid_client", {
      description: "Enterprise-managed authorization requires client authentication",
      statusCode: 401
    });
    const result = await this.runEmaPipeline({
      body,
      clientInfo,
      env,
      requestUrl,
      request,
      enterpriseOptions
    });
    if (!result.ok) {
      const wire = emaErrorToWire(result.error);
      return this.createErrorResponse(wire.code, { description: wire.message }, {
        category: "enterprise-managed-authorization",
        reason: result.error.reason,
        detail: result.error
      });
    }
    return new Response(JSON.stringify(result.value), { headers: {
      "Content-Type": "application/json",
      ...NO_CACHE_HEADERS
    } });
  }
  /**
  * Runs the full EMA token-request pipeline as a chain of pure validators
  * and adapter calls. Each step short-circuits on the first failure.
  *
  * Sequence:
  *   parse → validate header → trust issuer → fetch JWKS → select key →
  *   verify signature → validate claims → record jti → parse scope →
  *   run mapper → validate mapper result → compute TTL → mint token.
  */
  async runEmaPipeline(args) {
    const { body, clientInfo, env, requestUrl, request, enterpriseOptions } = args;
    const { jwksProvider, jtiStore } = this;
    const configuredResource = this.options.resourceMetadata?.resource;
    if (!jwksProvider || !jtiStore || !configuredResource) throw new Error("EMA pipeline invoked without configured adapters");
    const now = Math.floor(Date.now() / 1e3);
    const parsed = parseIdJag(body.assertion, EMA_MAX_JWT_BYTES);
    if (!parsed.ok) return parsed;
    const header = validateIdJagHeader(parsed.value.header, EMA_ID_JAG_JWT_TYPE, EMA_SUPPORTED_JWT_ALGORITHMS);
    if (!header.ok) return header;
    const alg = header.value.alg;
    const trustedIssuer = await resolveTrustedIssuer({
      iss: parsed.value.rawClaims.iss,
      alg,
      resolver: enterpriseOptions.trustedIssuers,
      env,
      request,
      clientInfo
    });
    if (!trustedIssuer.ok) return trustedIssuer;
    const verified = await this.verifyAssertionSignature({
      parsed: parsed.value,
      header: header.value,
      trustedIssuer: trustedIssuer.value,
      jwksProvider,
      now
    });
    if (!verified.ok) return verified;
    const claims = validateIdJagClaims({
      rawClaims: parsed.value.rawClaims,
      trustedIssuer: trustedIssuer.value,
      expectedAudience: trustedIssuer.value.audience ?? this.getAuthorizationServerIssuer(requestUrl),
      clientId: clientInfo.clientId,
      configuredResource,
      matchOriginOnly: !!this.options.resourceMatchOriginOnly,
      now,
      clockSkewSeconds: enterpriseOptions.clockSkewSeconds ?? EMA_DEFAULT_CLOCK_SKEW_SECONDS,
      maxAssertionLifetimeSeconds: enterpriseOptions.maxAssertionLifetimeSeconds ?? EMA_DEFAULT_MAX_ASSERTION_LIFETIME_SECONDS
    });
    if (!claims.ok) return claims;
    const markNow = Math.floor(Date.now() / 1e3);
    const replay = await jtiStore.markUsed({
      issuer: claims.value.claims.iss,
      jti: claims.value.claims.jti,
      exp: claims.value.claims.exp,
      now: markNow,
      env
    });
    if (!replay.ok) return replay;
    const requestedScope = parseEmaScopeParam(body.scope, claims.value.assertionScopes);
    if (!requestedScope.ok) return requestedScope;
    let mapperOutput;
    try {
      mapperOutput = await enterpriseOptions.mapClaims({
        claims: claims.value.claims,
        clientInfo,
        resource: claims.value.resource,
        requestedScope: requestedScope.value,
        request: args.request,
        env
      });
    } catch {
      return err({ reason: "mapper_threw" });
    }
    const mapped = validateEmaMapperResult(mapperOutput);
    if (!mapped.ok) return mapped;
    const issueNow = Math.floor(Date.now() / 1e3);
    const ttl = computeEmaAccessTokenTTL({
      configuredDefaultSeconds: this.options.accessTokenTTL ?? DEFAULT_ACCESS_TOKEN_TTL,
      assertionExp: claims.value.claims.exp,
      mapperTtl: mapped.value.accessTokenTTL,
      now: issueNow,
      minTtlSeconds: KV_MIN_EXPIRATION_TTL_SECONDS
    });
    if (!ttl.ok) return ttl;
    return ok(await this.issueEmaAccessToken({
      clientId: clientInfo.clientId,
      userId: mapped.value.userId,
      mapperScope: mapped.value.scope,
      mapperProps: mapped.value.props,
      mapperMetadata: mapped.value.metadata,
      assertionScopes: claims.value.assertionScopes,
      resource: claims.value.resource,
      accessTokenTTLSeconds: ttl.value,
      env,
      now: issueNow
    }));
  }
  /**
  * Verifies the ID-JAG signature against the trusted issuer's JWKS,
  * force-refreshing once on a `kid` miss to accommodate IdP key rotation.
  * Uses the in-memory cached JWKS fetcher with anti-DoS cool-down.
  */
  async verifyAssertionSignature(args) {
    const alg = args.header.alg;
    const { jwksProvider } = args;
    const initialJwks = await jwksProvider.fetch(args.trustedIssuer, {
      forceRefresh: false,
      now: args.now
    });
    if (!initialJwks.ok) return initialJwks;
    let jwk = selectJwk(initialJwks.value, alg, args.header.kid);
    if (!jwk.ok && args.header.kid) {
      const refreshed = await jwksProvider.fetch(args.trustedIssuer, {
        forceRefresh: true,
        now: args.now
      });
      if (!refreshed.ok) return refreshed;
      jwk = selectJwk(refreshed.value, alg, args.header.kid);
    }
    if (!jwk.ok) return jwk;
    if (!await verifyIdJagSignature({
      alg,
      jwk: jwk.value,
      signingInput: args.parsed.signingInput,
      signature: args.parsed.signature
    })) return err({ reason: "signature_failed" });
    return ok(void 0);
  }
  /**
  * Mints the access token for an authorized EMA request.
  *
  * Uses the same grant + access-token machinery as the authorization-code
  * grant: encrypt the props, persist the grant under `grant:userId:grantId`,
  * and create an opaque access token bound to the resource as audience.
  */
  async issueEmaAccessToken(args) {
    const tokenScopes = args.assertionScopes.length > 0 ? this.downscope(args.mapperScope, args.assertionScopes) : args.mapperScope;
    const grantId = generateRandomString(16);
    const { encryptedData, key: encryptionKey } = await encryptProps(args.mapperProps);
    const grant = {
      id: grantId,
      clientId: args.clientId,
      userId: args.userId,
      scope: tokenScopes,
      metadata: args.mapperMetadata ?? null,
      encryptedProps: encryptedData,
      createdAt: args.now,
      expiresAt: args.now + args.accessTokenTTLSeconds,
      resource: args.resource
    };
    await this.saveGrantWithTTL(args.env, `grant:${args.userId}:${grantId}`, grant, args.now);
    return {
      access_token: await this.createAccessToken({
        userId: args.userId,
        grantId,
        clientId: args.clientId,
        scope: tokenScopes,
        encryptedProps: encryptedData,
        encryptionKey,
        expiresIn: args.accessTokenTTLSeconds,
        audience: args.resource,
        env: args.env
      }),
      token_type: "bearer",
      expires_in: args.accessTokenTTLSeconds,
      scope: tokenScopes.join(" "),
      resource: args.resource
    };
  }
  /**
  * Handles OAuth 2.0 token revocation requests (RFC 7009)
  * @param body - The parsed request body containing revocation parameters
  * @param env - Cloudflare Worker environment variables
  * @returns Response confirming revocation or error
  */
  async handleRevocationRequest(body, clientInfo, env) {
    return this.revokeToken(body, clientInfo, env);
  }
  /**
  * - Access tokens: Revokes only the specific token
  * - Refresh tokens: Revokes the entire grant (access + refresh tokens)
  * Per RFC 7009 §2.1, the server MUST verify the token was issued to the client making the request.
  * @param body - The parsed request body containing token parameter
  * @param clientInfo - The authenticated client information
  * @param env - Cloudflare Worker environment variables
  * @returns Response confirming revocation or error
  */
  async revokeToken(body, clientInfo, env) {
    const token = body.token;
    const tokenTypeHint = body.token_type_hint;
    if (!token) return this.createErrorResponse("invalid_request", { description: "Token parameter is required" });
    const tokenParts = token.split(":");
    if (tokenParts.length !== 3) return new Response("", { status: 200 });
    const [userId, grantId, _] = tokenParts;
    const tokenId = await generateTokenId(token);
    if (tokenTypeHint === "refresh_token") {
      if (await this.revokeRefreshIfOwned(tokenId, userId, grantId, clientInfo, env)) return new Response("", { status: 200 });
      if (await this.revokeAccessIfOwned(tokenId, userId, grantId, clientInfo, env)) return new Response("", { status: 200 });
    } else {
      if (await this.revokeAccessIfOwned(tokenId, userId, grantId, clientInfo, env)) return new Response("", { status: 200 });
      if (await this.revokeRefreshIfOwned(tokenId, userId, grantId, clientInfo, env)) return new Response("", { status: 200 });
    }
    return new Response("", { status: 200 });
  }
  /** Revoke an access token if it exists and belongs to the requesting client. */
  async revokeAccessIfOwned(tokenId, userId, grantId, clientInfo, env) {
    const tokenData = await env.OAUTH_KV.get(`token:${userId}:${grantId}:${tokenId}`, { type: "json" });
    if (!tokenData) return false;
    const tokenClientId = tokenData.grant?.clientId;
    if (tokenClientId !== void 0) {
      if (tokenClientId !== clientInfo.clientId) return false;
    } else if ((await env.OAUTH_KV.get(`grant:${userId}:${grantId}`, { type: "json" }))?.clientId !== clientInfo.clientId) return false;
    await this.revokeSpecificAccessToken(tokenId, userId, grantId, env);
    return true;
  }
  /** Revoke a refresh token (and its grant) if it exists and belongs to the requesting client. */
  async revokeRefreshIfOwned(tokenId, userId, grantId, clientInfo, env) {
    const grantData = await env.OAUTH_KV.get(`grant:${userId}:${grantId}`, { type: "json" });
    if (!grantData) return false;
    if (!(grantData.refreshTokenId === tokenId || grantData.previousRefreshTokenId === tokenId)) return false;
    if (grantData.clientId !== clientInfo.clientId) return false;
    await this.createOAuthHelpers(env).revokeGrant(grantId, userId);
    return true;
  }
  /**
  * Revokes a specific access token without affecting the refresh token
  * @param tokenId - The hashed token ID
  * @param userId - The user ID extracted from the token
  * @param grantId - The grant ID extracted from the token
  * @param env - Cloudflare Worker environment variables
  */
  async revokeSpecificAccessToken(tokenId, userId, grantId, env) {
    const tokenKey = `token:${userId}:${grantId}:${tokenId}`;
    await env.OAUTH_KV.delete(tokenKey);
  }
  /**
  * Handles the dynamic client registration endpoint (RFC 7591)
  * @param request - The HTTP request
  * @param env - Cloudflare Worker environment variables
  * @returns Response with client registration data or error
  */
  async handleClientRegistration(request, env) {
    if (!this.options.clientRegistrationEndpoint) return this.createErrorResponse("not_implemented", {
      description: "Client registration is not enabled",
      statusCode: 501
    });
    if (request.method !== "POST") return this.createErrorResponse("invalid_request", {
      description: "Method not allowed",
      statusCode: 405
    });
    if (parseInt(request.headers.get("Content-Length") || "0", 10) > 1048576) return this.createErrorResponse("invalid_request", {
      description: "Request payload too large, must be under 1 MiB",
      statusCode: 413
    });
    const callbackRequest = request.clone();
    let parsedJson;
    try {
      const text = await request.text();
      if (text.length > 1048576) return this.createErrorResponse("invalid_request", {
        description: "Request payload too large, must be under 1 MiB",
        statusCode: 413
      });
      parsedJson = JSON.parse(text);
    } catch {
      return this.createErrorResponse("invalid_request", {
        description: "Invalid JSON payload",
        statusCode: 400
      });
    }
    let clientMetadata;
    let metadata;
    try {
      clientMetadata = requireJsonObject(parsedJson);
      metadata = resolveDynamicClientRegistrationMetadata(clientMetadata, this.serverCapabilities);
    } catch (error) {
      return this.createErrorResponse("invalid_client_metadata", { description: error instanceof Error ? error.message : "Invalid client metadata" });
    }
    const authMethod = metadata.tokenEndpointAuthMethod;
    const isPublicClient = authMethod === "none";
    if (isPublicClient && this.options.disallowPublicClientRegistration) return this.createErrorResponse("invalid_client_metadata", { description: "Public client registration is not allowed" });
    const clientId = generateRandomString(16);
    let clientSecret;
    let hashedSecret;
    if (!isPublicClient) {
      clientSecret = generateRandomString(32);
      hashedSecret = await hashSecret(clientSecret);
    }
    const clientInfo = {
      clientId,
      redirectUris: metadata.redirectUris,
      clientName: metadata.clientName,
      logoUri: metadata.logoUri,
      clientUri: metadata.clientUri,
      policyUri: metadata.policyUri,
      tosUri: metadata.tosUri,
      jwksUri: metadata.jwksUri,
      i18n: metadata.i18n,
      contacts: metadata.contacts,
      grantTypes: metadata.grantTypes,
      responseTypes: metadata.responseTypes,
      registrationDate: Math.floor(Date.now() / 1e3),
      tokenEndpointAuthMethod: authMethod,
      ...metadata.authMethodExplicit ? { authMethodExplicit: true } : {},
      ...!isPublicClient && hashedSecret ? { clientSecret: hashedSecret } : {}
    };
    if (this.options.clientRegistrationCallback) {
      let callbackResult;
      try {
        callbackResult = await Promise.resolve(this.options.clientRegistrationCallback({
          clientMetadata,
          request: callbackRequest
        }));
      } catch (error) {
        return this.createErrorResponse("server_error", {
          description: error instanceof Error ? error.message : "Client registration callback failed",
          statusCode: 500
        });
      }
      if (callbackResult !== void 0) return this.createErrorResponse(callbackResult.code || "invalid_client_metadata", {
        description: callbackResult.description || "Client registration denied",
        statusCode: callbackResult.status ?? 400
      });
    }
    const clientKvOptions = {};
    if (this.options.clientRegistrationTTL !== void 0) clientKvOptions.expirationTtl = this.options.clientRegistrationTTL;
    await env.OAUTH_KV.put(`client:${clientInfo.clientId}`, JSON.stringify(clientInfo), clientKvOptions);
    const response = {
      client_id: clientInfo.clientId,
      redirect_uris: clientInfo.redirectUris,
      client_name: clientInfo.clientName,
      logo_uri: clientInfo.logoUri,
      client_uri: clientInfo.clientUri,
      policy_uri: clientInfo.policyUri,
      tos_uri: clientInfo.tosUri,
      jwks_uri: clientInfo.jwksUri,
      contacts: clientInfo.contacts,
      grant_types: clientInfo.grantTypes,
      response_types: clientInfo.responseTypes,
      token_endpoint_auth_method: clientInfo.tokenEndpointAuthMethod,
      client_id_issued_at: clientInfo.registrationDate
    };
    if (clientInfo.i18n) {
      for (const [key, value] of Object.entries(clientInfo.i18n)) if (!(key in response)) response[key] = value;
    }
    if (clientSecret) {
      response.client_secret = clientSecret;
      response.client_secret_expires_at = this.options.clientRegistrationTTL && clientInfo.registrationDate ? clientInfo.registrationDate + this.options.clientRegistrationTTL : 0;
      response.client_secret_issued_at = clientInfo.registrationDate;
    }
    return new Response(JSON.stringify(response), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        ...NO_CACHE_HEADERS
      }
    });
  }
  /**
  * Handles API requests by validating the access token and calling the API handler
  * @param request - The HTTP request
  * @param env - Cloudflare Worker environment variables
  * @param ctx - Cloudflare Worker execution context
  * @returns Response from the API handler or error
  */
  async handleApiRequest(request, env, ctx) {
    const url = new URL(request.url);
    const resourceMetadataUrl = `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return new Response(null, {
      status: 401,
      headers: {
        ...NO_CACHE_HEADERS,
        "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl)
      }
    });
    const accessToken = authHeader.substring(7);
    const parts = accessToken.split(":");
    const isPossiblyInternalFormat = parts.length === 3;
    let tokenData = null;
    let userId = "";
    let grantId = "";
    if (isPossiblyInternalFormat) {
      [userId, grantId] = parts;
      const id = await generateTokenId(accessToken);
      tokenData = await env.OAUTH_KV.get(`token:${userId}:${grantId}:${id}`, { type: "json" });
    }
    if (!tokenData && !this.options.resolveExternalToken) return this.createErrorResponse("invalid_token", {
      description: "Invalid access token",
      statusCode: 401,
      headers: { "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl, "invalid_token") }
    });
    if (tokenData) {
      const configuredResource = this.options.resourceMetadata?.resource;
      if (configuredResource && !isExactResource(tokenData.audience, configuredResource)) return this.createErrorResponse("invalid_token", {
        description: "Access token is not bound to the configured resource",
        statusCode: 401,
        headers: { "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl, "invalid_token") }
      });
      const now = Math.floor(Date.now() / 1e3);
      if (tokenData.expiresAt < now) return this.createErrorResponse("invalid_token", {
        description: "Access token expired",
        statusCode: 401,
        headers: { "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl, "invalid_token") }
      });
      if (tokenData.audience) {
        const requestUrl = new URL(request.url);
        const resourceServer = `${requestUrl.protocol}//${requestUrl.host}${requestUrl.pathname}${requestUrl.search}`;
        if (!(Array.isArray(tokenData.audience) ? tokenData.audience : [tokenData.audience]).some((aud) => audienceMatches(resourceServer, aud))) return this.createErrorResponse("invalid_token", {
          description: "Token audience does not match resource server",
          statusCode: 401,
          headers: { "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl, "invalid_token", "Invalid audience") }
        });
      }
      ctx.props = await decryptProps(await unwrapKeyWithToken(accessToken, tokenData.wrappedEncryptionKey), tokenData.grant.encryptedProps);
    } else if (this.options.resolveExternalToken) {
      let ext;
      try {
        ext = await this.options.resolveExternalToken({
          token: accessToken,
          request,
          env
        });
      } catch (error) {
        const response = this.createExternalTokenErrorResponse(error, resourceMetadataUrl);
        if (response) return response;
        throw error;
      }
      if (!ext) return this.createErrorResponse("invalid_token", {
        description: "Invalid access token",
        statusCode: 401,
        headers: { "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl, "invalid_token") }
      });
      const configuredResource = this.options.resourceMetadata?.resource;
      if (configuredResource && !isExactResource(ext.audience, configuredResource)) return this.createErrorResponse("invalid_token", {
        description: "External access token is not bound to the configured resource",
        statusCode: 401,
        headers: { "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl, "invalid_token") }
      });
      if (ext.audience) {
        const requestUrl = new URL(request.url);
        const resourceServer = `${requestUrl.protocol}//${requestUrl.host}${requestUrl.pathname}${requestUrl.search}`;
        if (!(Array.isArray(ext.audience) ? ext.audience : [ext.audience]).some((aud) => audienceMatches(resourceServer, aud))) return this.createErrorResponse("invalid_token", {
          description: "Token audience does not match resource server",
          statusCode: 401,
          headers: { "WWW-Authenticate": this.buildWwwAuthenticateHeader(resourceMetadataUrl, "invalid_token", "Invalid audience") }
        });
      }
      ctx.props = ext.props;
    }
    if (!env.OAUTH_PROVIDER) env.OAUTH_PROVIDER = this.createOAuthHelpers(env);
    const apiHandler = this.findApiHandlerForUrl(url);
    if (!apiHandler) return this.createErrorResponse("invalid_request", {
      description: "No handler found for API route",
      statusCode: 404
    });
    if (apiHandler.type === HandlerType.EXPORTED_HANDLER) return apiHandler.handler.fetch(request, env, ctx);
    else return new apiHandler.handler(ctx, env).fetch(request);
  }
  /**
  * Creates the helper methods object for OAuth operations
  * This is passed to the handler functions to allow them to interact with the OAuth system
  * @param env - Cloudflare Worker environment variables
  * @returns An instance of OAuthHelpers
  */
  createOAuthHelpers(env) {
    return new OAuthHelpersImpl(env, this);
  }
  /**
  * Saves a grant to KV with appropriate TTL based on expiration
  * @param env - The environment bindings
  * @param grantKey - The KV key for the grant
  * @param grantData - The grant data to save
  * @param now - Current timestamp in seconds
  */
  async saveGrantWithTTL(env, grantKey, grantData, now) {
    const minExpiration = now + KV_MIN_EXPIRATION_TTL_SECONDS + KV_EXPIRATION_CLAMP_MARGIN_SECONDS;
    const kvOptions = grantData.expiresAt !== void 0 ? { expiration: Math.max(grantData.expiresAt, minExpiration) } : {};
    try {
      await env.OAUTH_KV.put(grantKey, JSON.stringify(grantData), kvOptions);
    } catch (error) {
      this.throwRetryableTokenStorageErrorIfKvRateLimited(error);
      throw error;
    }
  }
  throwRetryableTokenStorageErrorIfKvRateLimited(error) {
    if (!this.isKvRateLimitError(error)) return;
    throw new OAuthError("temporarily_unavailable", {
      description: "Token issuance is temporarily unavailable; retry shortly",
      statusCode: 429,
      headers: { "Retry-After": "30" }
    });
  }
  isKvRateLimitError(error) {
    if (!(error instanceof Error)) return false;
    return /KV .*failed: 429 Too Many Requests/i.test(error.message) || /429 Too Many Requests/i.test(error.message);
  }
  /**
  * Fetches client information from KV storage or via CIMD (Client ID Metadata Document)
  * This method is not private because `OAuthHelpers` needs to call it. Note that since
  * `OAuthProviderImpl` is not exposed outside this module, this is still effectively
  * module-private.
  *
  * Supports CIMD: If clientId is an HTTPS URL with a non-root path, the metadata
  * document will be fetched from that URL instead of looking up in KV storage.
  *
  * @param env - Cloudflare Worker environment variables
  * @param clientId - The client ID to look up (can be a regular ID or an HTTPS URL for CIMD)
  * @returns The client information, or null if the client does not exist. Null means
  * definitive absence; failures to determine the answer throw instead (KV errors
  * propagate, and a CIMD metadata fetch failure throws `CimdFetchError`), so an
  * upstream outage is distinguishable from an unregistered client.
  */
  async getClient(env, clientId) {
    if (this.isClientMetadataUrl(clientId)) {
      if (!this.options.clientIdMetadataDocumentEnabled) {
        const clientKey$1 = `client:${clientId}`;
        return env.OAUTH_KV.get(clientKey$1, { type: "json" });
      }
      if (!this.hasGlobalFetchStrictlyPublic()) throw new Error(`CIMD is enabled but 'global_fetch_strictly_public' compatibility flag is not set.`);
      try {
        return await fetchClientIdMetadataDocument(clientId, this.serverCapabilities);
      } catch (error) {
        console.warn(`CIMD fetch failed for ${clientId}:`, error instanceof Error ? error.message : error);
        throw new CimdFetchError(clientId, error);
      }
    }
    const clientKey = `client:${clientId}`;
    return env.OAUTH_KV.get(clientKey, { type: "json" });
  }
  /**
  * Resolves an access-token audience from a token request and its authorization grant.
  * A configured canonical resource is inherited when omitted but cannot be overridden.
  * Without configuration, RFC 8707 downscoping is allowed, omission inherits a
  * bound grant, and a legacy unbound grant retains the v0.8.2 behavior.
  */
  resolveTokenResource(requestedResource, grantedResource) {
    const resourceWasProvided = requestedResource !== void 0;
    const requestedAudience = parseResourceParameter(requestedResource);
    if (resourceWasProvided && !requestedAudience) throw new OAuthError("invalid_target", { description: "The resource parameter must be a valid absolute URI without a fragment" });
    const grantResourceWasStored = grantedResource !== void 0;
    const grantedAudience = parseResourceParameter(grantedResource);
    if (grantResourceWasStored && !grantedAudience) throw new OAuthError("invalid_target", { description: "The authorization grant contains an invalid resource" });
    const configuredResource = this.options.resourceMetadata?.resource;
    if (configuredResource) {
      if (resourceWasProvided && !isExactResource(requestedResource, configuredResource)) throw new OAuthError("invalid_target", { description: `The resource parameter must exactly match ${configuredResource}` });
      if (isExactResource(grantedResource, configuredResource)) return configuredResource;
      if (!grantResourceWasStored) return configuredResource;
      throw new OAuthError("invalid_target", { description: "The authorization grant is not bound to the configured resource" });
    }
    const originOnly = !!this.options.resourceMatchOriginOnly;
    if (resourceWasProvided && grantResourceWasStored) {
      const requestedResources = Array.isArray(requestedResource) ? requestedResource : [requestedResource];
      const grantedResources = Array.isArray(grantedResource) ? grantedResource : [grantedResource];
      for (const requested of requestedResources) if (!grantedResources.some((granted) => resourceMatches(requested, granted, originOnly))) throw new OAuthError("invalid_target", { description: "Requested resource was not included in the authorization request" });
    }
    return requestedAudience ?? grantedAudience;
  }
  /**
  * Creates and stores an access token
  * @param params - Options for creating the access token
  * @returns The access token string
  */
  async createAccessToken(params) {
    const { userId, grantId, clientId, scope, encryptedProps, encryptionKey, expiresIn, audience, env } = params;
    if (expiresIn < KV_MIN_EXPIRATION_TTL_SECONDS) throw new OAuthError("invalid_request", { description: "Requested token lifetime must be at least 60 seconds" });
    const accessToken = `${userId}:${grantId}:${generateRandomString(TOKEN_LENGTH)}`;
    const now = Math.floor(Date.now() / 1e3);
    const accessTokenId = await generateTokenId(accessToken);
    const accessTokenData = {
      id: accessTokenId,
      grantId,
      userId,
      createdAt: now,
      expiresAt: now + expiresIn,
      audience,
      scope,
      wrappedEncryptionKey: await wrapKeyWithToken(accessToken, encryptionKey),
      grant: {
        clientId,
        scope,
        encryptedProps
      }
    };
    try {
      await env.OAUTH_KV.put(`token:${userId}:${grantId}:${accessTokenId}`, JSON.stringify(accessTokenData), { expirationTtl: expiresIn });
    } catch (error) {
      this.throwRetryableTokenStorageErrorIfKvRateLimited(error);
      throw error;
    }
    return accessToken;
  }
  /**
  * Restricts requested scopes to the scopes available for the current flow.
  * If no scope is requested, all available scopes are returned.
  * @param requestedScope - The scope parameter from the request (string or array)
  * @param allowedScopes - The maximum scopes available for the current flow
  * @returns The requested scopes that are included in the allowed scopes
  */
  downscope(requestedScope, allowedScopes) {
    if (!requestedScope) return allowedScopes;
    return (typeof requestedScope === "string" ? requestedScope.split(" ").filter(Boolean) : requestedScope).filter((scope) => allowedScopes.includes(scope));
  }
  /**
  * Checks if the global_fetch_strictly_public compatibility flag is enabled.
  * This flag is required for CIMD to prevent SSRF attacks.
  * See: https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public
  */
  hasGlobalFetchStrictlyPublic() {
    return !!(typeof Cloudflare !== "undefined" && Cloudflare.compatibilityFlags ? Cloudflare.compatibilityFlags : null)?.global_fetch_strictly_public;
  }
  /**
  * Checks if a client_id is a CIMD URL (HTTPS with non-root path).
  * Not private because OAuthHelpersImpl needs access for purgeExpiredData.
  */
  isClientMetadataUrl(clientId) {
    return isClientIdMetadataDocumentUrl(clientId);
  }
  /**
  * Builds a WWW-Authenticate header value with resource_metadata per RFC 9728 §5.1
  */
  buildWwwAuthenticateHeader(resourceMetadataUrl, error, errorDescription, requiredScopes = []) {
    let header = `Bearer realm="OAuth", resource_metadata="${resourceMetadataUrl}"`;
    if (error) header += `, error="${error}"`;
    const challengeScopes = requiredScopes.length > 0 ? this.normalizeProtectedResourceScopes(requiredScopes) : this.getProtectedResourceScopes();
    if (challengeScopes.length > 0) header += `, scope="${challengeScopes.join(" ")}"`;
    if (errorDescription) header += `, error_description="${errorDescription}"`;
    return header;
  }
  /**
  * Helper function to create OAuth error responses.
  *
  * `internal` (optional) carries a tagged, server-side-only reason. It is
  * forwarded to the deployer's `onError` hook but never placed on the wire,
  * so the public response stays RFC-compliant and free of information leak
  * while the deployer can still observe which check failed.
  */
  createErrorResponse(code, options, internal, request) {
    const { description } = options;
    const responseStatus = options.statusCode ?? 400;
    const responseHeaders = {
      ...NO_CACHE_HEADERS,
      ...options.headers ?? {}
    };
    const customErrorResponse = this.options.onError?.({
      code,
      description,
      status: responseStatus,
      headers: responseHeaders,
      ...internal ? { internal } : {},
      ...request ? { request } : {}
    });
    if (customErrorResponse) return customErrorResponse;
    const body = JSON.stringify({
      error: code,
      error_description: description
    });
    return new Response(body, {
      status: responseStatus,
      headers: {
        "Content-Type": "application/json",
        ...responseHeaders
      }
    });
  }
};
var OAuthError = class extends Error {
  static {
    __name(this, "OAuthError");
  }
  constructor(code, options) {
    super(options.description);
    this.name = "OAuthError";
    this.code = code;
    this.options = {
      ...options,
      statusCode: options.statusCode ?? 400
    };
    this.description = this.options.description;
    this.statusCode = this.options.statusCode;
    this.headers = this.options.headers;
  }
};
var ExternalTokenError = class extends Error {
  static {
    __name(this, "ExternalTokenError");
  }
  /**
  * Creates an intentional external-token validation error.
  * @param code - Standard OAuth error code to return
  * @param options - Public response details
  */
  constructor(code, options) {
    super(options.description);
    this.name = "ExternalTokenError";
    this.code = code;
    this.description = options.description;
    this.statusCode = options.statusCode;
    this.headers = options.headers;
    this.requiredScopes = options.requiredScopes;
  }
};
var CimdFetchError = class extends Error {
  static {
    __name(this, "CimdFetchError");
  }
  /**
  * Creates an error for a failed CIMD fetch or validation.
  * @param metadataUrl - The CIMD URL that could not be resolved
  * @param cause - The underlying fetch or validation failure
  */
  constructor(metadataUrl, cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`CIMD fetch failed for ${metadataUrl}: ${detail}`);
    this.reason = "metadata_resolution_failed";
    this.name = "CimdFetchError";
    this.metadataUrl = metadataUrl;
    this.detail = detail;
  }
};
var DEFAULT_ACCESS_TOKEN_TTL = 3600;
var DEFAULT_REFRESH_TOKEN_TTL = 720 * 60 * 60;
var DEFAULT_CLIENT_REGISTRATION_TTL = 2160 * 60 * 60;
var KV_MIN_EXPIRATION_TTL_SECONDS = 60;
var KV_EXPIRATION_CLAMP_MARGIN_SECONDS = 5;
var DEFAULT_PURGE_BATCH_SIZE = 50;
var MAX_KV_LIST_LIMIT = 1e3;
var DEFAULT_REVOKE_EXISTING_GRANTS_BATCH_SIZE = 50;
function getRevokeExistingGrantsBatchSize(batchSize) {
  if (batchSize === void 0) return DEFAULT_REVOKE_EXISTING_GRANTS_BATCH_SIZE;
  if (!Number.isFinite(batchSize) || !Number.isInteger(batchSize) || batchSize < 1) throw new Error("revokeExistingGrantsBatchSize must be a positive integer.");
  return Math.min(batchSize, MAX_KV_LIST_LIMIT);
}
__name(getRevokeExistingGrantsBatchSize, "getRevokeExistingGrantsBatchSize");
var TOKEN_LENGTH = 32;
function validateResourceUri(uri) {
  if (!uri || typeof uri !== "string") return false;
  try {
    const parsed = new URL(uri);
    if (!parsed.protocol) return false;
    if (parsed.hash) return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return true;
  } catch {
    return false;
  }
}
__name(validateResourceUri, "validateResourceUri");
function audienceMatches(resourceServerUrl, audienceValue) {
  try {
    const resource = new URL(resourceServerUrl);
    const audience = new URL(audienceValue);
    if (resource.origin !== audience.origin) return false;
    if (audience.search && resource.search !== audience.search) return false;
    if (audience.pathname === "/" || audience.pathname === "") return true;
    return resource.pathname === audience.pathname || resource.pathname.startsWith(audience.pathname + "/");
  } catch {
    return false;
  }
}
__name(audienceMatches, "audienceMatches");
function parseResourceParameter(value) {
  if (!value) return;
  const uris = Array.isArray(value) ? value : [value];
  if (uris.length === 0) return;
  for (const uri of uris) if (typeof uri !== "string" || !validateResourceUri(uri)) return;
  return value;
}
__name(parseResourceParameter, "parseResourceParameter");
function isExactResource(value, configuredResource) {
  return value === configuredResource || Array.isArray(value) && value.length === 1 && value[0] === configuredResource;
}
__name(isExactResource, "isExactResource");
function resourceMatches(requested, granted, originOnly) {
  if (!originOnly) return requested === granted;
  try {
    return new URL(requested).origin === new URL(granted).origin;
  } catch {
    return requested === granted;
  }
}
__name(resourceMatches, "resourceMatches");
async function hashSecret(secret) {
  return generateTokenId(secret);
}
__name(hashSecret, "hashSecret");
function parseBasicAuthorizationHeader(header) {
  if (!header) return { kind: "not-basic" };
  const schemeEnd = header.search(/[ \t]/);
  if ((schemeEnd === -1 ? header : header.slice(0, schemeEnd)).toLowerCase() !== "basic") return { kind: "not-basic" };
  if (schemeEnd === -1) return { kind: "malformed" };
  const encodedCredentials = header.slice(schemeEnd).trim();
  if (!encodedCredentials || /[ \t]/.test(encodedCredentials)) return { kind: "malformed" };
  try {
    const credentials = atob(encodedCredentials);
    const separatorIndex = credentials.indexOf(":");
    if (separatorIndex === -1) return { kind: "malformed" };
    return {
      kind: "credentials",
      clientId: decodeFormUrlEncodedComponent(credentials.slice(0, separatorIndex)),
      clientSecret: decodeFormUrlEncodedComponent(credentials.slice(separatorIndex + 1))
    };
  } catch {
    return { kind: "malformed" };
  }
}
__name(parseBasicAuthorizationHeader, "parseBasicAuthorizationHeader");
function decodeFormUrlEncodedComponent(value) {
  return decodeURIComponent(value.replace(/\+/g, " "));
}
__name(decodeFormUrlEncodedComponent, "decodeFormUrlEncodedComponent");
function generateRandomString(length) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  for (let i = 0; i < length; i++) result += characters.charAt(values[i] % 64);
  return result;
}
__name(generateRandomString, "generateRandomString");
async function generateTokenId(token) {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateTokenId, "generateTokenId");
function isLoopbackUri(uri) {
  try {
    const host = new URL(uri).hostname;
    if (host.match(/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) return true;
    if (host === "::1" || host === "[::1]") return true;
    if (host.toLowerCase() === "localhost") return true;
    return false;
  } catch {
    return false;
  }
}
__name(isLoopbackUri, "isLoopbackUri");
function isValidRedirectUri(requestUri, registeredUris) {
  return registeredUris.some((registered) => {
    if (isLoopbackUri(requestUri) && isLoopbackUri(registered)) try {
      const reqUrl = new URL(requestUri);
      const regUrl = new URL(registered);
      return reqUrl.protocol === regUrl.protocol && reqUrl.hostname === regUrl.hostname && reqUrl.pathname === regUrl.pathname && reqUrl.search === regUrl.search;
    } catch {
      return false;
    }
    return requestUri === registered;
  });
}
__name(isValidRedirectUri, "isValidRedirectUri");
function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
__name(base64UrlEncode, "base64UrlEncode");
function base64UrlToBytes(base64Url) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, "=");
  const binaryString = atob(padded);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}
__name(base64UrlToBytes, "base64UrlToBytes");
function parseJwtJsonPart(encoded) {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(encoded));
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("JWT part must be an object");
    return parsed;
  } catch {
    throw new Error("Malformed JWT part");
  }
}
__name(parseJwtJsonPart, "parseJwtJsonPart");
function getJwtCryptoAlgorithms(alg) {
  if (alg === "RS256") {
    const algorithm = {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    };
    return {
      importAlgorithm: algorithm,
      verifyAlgorithm: algorithm
    };
  }
  if (alg === "ES256") return {
    importAlgorithm: {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    verifyAlgorithm: {
      name: "ECDSA",
      hash: "SHA-256"
    }
  };
  throw new Error(`Unsupported JWT alg: ${alg}`);
}
__name(getJwtCryptoAlgorithms, "getJwtCryptoAlgorithms");
function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
__name(arrayBufferToBase64, "arrayBufferToBase64");
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}
__name(base64ToArrayBuffer, "base64ToArrayBuffer");
async function encryptProps(data) {
  const key = await crypto.subtle.generateKey({
    name: "AES-GCM",
    length: 256
  }, true, ["encrypt", "decrypt"]);
  const iv = new Uint8Array(12);
  const jsonData = JSON.stringify(data);
  const encodedData = new TextEncoder().encode(jsonData);
  return {
    encryptedData: arrayBufferToBase64(await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv
    }, key, encodedData)),
    key
  };
}
__name(encryptProps, "encryptProps");
async function decryptProps(key, encryptedData) {
  const encryptedBuffer = base64ToArrayBuffer(encryptedData);
  const iv = new Uint8Array(12);
  const decryptedBuffer = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv
  }, key, encryptedBuffer);
  const jsonData = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(jsonData);
}
__name(decryptProps, "decryptProps");
var WRAPPING_KEY_HMAC_KEY = new Uint8Array([
  34,
  126,
  38,
  134,
  141,
  241,
  225,
  109,
  128,
  112,
  234,
  23,
  151,
  91,
  71,
  166,
  130,
  24,
  250,
  135,
  40,
  174,
  222,
  133,
  181,
  29,
  74,
  217,
  150,
  202,
  202,
  67
]);
async function deriveKeyFromToken(tokenStr) {
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey("raw", WRAPPING_KEY_HMAC_KEY, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  const hmacResult = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(tokenStr));
  return await crypto.subtle.importKey("raw", hmacResult, { name: "AES-KW" }, false, ["wrapKey", "unwrapKey"]);
}
__name(deriveKeyFromToken, "deriveKeyFromToken");
async function wrapKeyWithToken(tokenStr, keyToWrap) {
  const wrappingKey = await deriveKeyFromToken(tokenStr);
  return arrayBufferToBase64(await crypto.subtle.wrapKey("raw", keyToWrap, wrappingKey, { name: "AES-KW" }));
}
__name(wrapKeyWithToken, "wrapKeyWithToken");
async function unwrapKeyWithToken(tokenStr, wrappedKeyBase64) {
  const wrappingKey = await deriveKeyFromToken(tokenStr);
  const wrappedKeyBuffer = base64ToArrayBuffer(wrappedKeyBase64);
  return await crypto.subtle.unwrapKey("raw", wrappedKeyBuffer, wrappingKey, { name: "AES-KW" }, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}
__name(unwrapKeyWithToken, "unwrapKeyWithToken");
var OAuthHelpersImpl = class {
  static {
    __name(this, "OAuthHelpersImpl");
  }
  /**
  * Creates a new OAuthHelpers instance
  * @param env - Cloudflare Worker environment variables
  * @param provider - Reference to the parent provider instance
  */
  constructor(env, provider) {
    this.env = env;
    this.provider = provider;
  }
  /**
  * Parses an OAuth authorization request from the HTTP request
  * @param request - The HTTP request containing OAuth parameters
  * @returns The parsed authorization request parameters
  * @throws AuthorizationError for expected authorization-request validation failures
  * @throws CimdFetchError when the client ID is a CIMD URL whose document cannot be resolved
  */
  async parseAuthRequest(request) {
    const url = new URL(request.url);
    const responseType = url.searchParams.get("response_type") || "";
    const clientId = url.searchParams.get("client_id") || "";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const scope = (url.searchParams.get("scope") || "").split(" ").filter(Boolean);
    const state = url.searchParams.get("state") || "";
    const codeChallenge = url.searchParams.get("code_challenge") || void 0;
    const codeChallengeMethod = url.searchParams.get("code_challenge_method") || void 0;
    const issuer = this.provider.getAuthorizationServerIssuer(url);
    const resourceParams = url.searchParams.getAll("resource");
    const resourceParam = resourceParams.length > 0 ? resourceParams.length === 1 ? resourceParams[0] : resourceParams : void 0;
    if (!clientId) throw new AuthorizationError("invalid_request", { description: "client_id is required" });
    const clientInfo = await this.lookupClient(clientId);
    if (!clientInfo) throw new AuthorizationError("invalid_request", { description: "Invalid client_id" });
    try {
      validateRedirectUriScheme(redirectUri);
    } catch {
      throw new AuthorizationError("invalid_request", { description: "Invalid redirect URI" });
    }
    if (!redirectUri || !isValidRedirectUri(redirectUri, clientInfo.redirectUris)) throw new AuthorizationError("invalid_request", { description: "Invalid redirect URI" });
    const withRedirect = /* @__PURE__ */ __name((error) => {
      throw withAuthorizationRedirect(error, redirectUri, state || void 0, issuer);
    }, "withRedirect");
    const resourceWasProvided = resourceParam !== void 0;
    let resource = parseResourceParameter(resourceParam);
    if (resourceWasProvided && !resource) withRedirect(new AuthorizationError("invalid_target", { description: "The resource parameter must be a valid absolute URI without a fragment" }));
    const configuredResource = this.provider.options.resourceMetadata?.resource;
    if (configuredResource) {
      if (resourceWasProvided && !isExactResource(resource, configuredResource)) withRedirect(new AuthorizationError("invalid_target", { description: `The resource parameter must exactly match ${configuredResource}` }));
      resource = configuredResource;
    }
    try {
      validateAuthorizationResponseType(this.provider.serverCapabilities, responseType, clientInfo.responseTypes);
      validateAuthorizationPkce(this.provider.serverCapabilities, {
        responseType,
        codeChallenge,
        codeChallengeMethod
      }, clientInfo);
    } catch (error) {
      if (error instanceof AuthorizationError) withRedirect(error);
      throw error;
    }
    return {
      responseType,
      clientId,
      redirectUri,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod,
      resource,
      issuer
    };
  }
  /**
  * Looks up a client by its client ID
  * @param clientId - The client ID to look up
  * @returns A Promise resolving to the client info, or null if the client does not
  * exist. Null means definitive absence; failures to determine the answer throw
  * instead (KV errors propagate, and a CIMD metadata fetch failure throws
  * `CimdFetchError`), so an upstream outage cannot masquerade as an unregistered
  * client.
  * @throws CimdFetchError when the client ID is a CIMD URL and fetching or
  * validating the metadata document fails.
  */
  async lookupClient(clientId) {
    const client = await this.provider.getClient(this.env, clientId);
    return client ? toPublicClientInfo(client) : null;
  }
  /**
  * Completes an authorization request by creating a grant and either:
  * - For authorization code flow: generating an authorization code
  * - For implicit flow: generating an access token directly
  * @param options - Options specifying the grant details
  * @returns A Promise resolving to an object containing the redirect URL
  * @throws Error when the request's response type is not permitted
  * @throws CimdFetchError when the client ID is a CIMD URL whose document cannot be resolved
  */
  async completeAuthorization(options) {
    const { clientId, redirectUri } = options.request;
    if (!clientId || !redirectUri) throw new Error("Client ID and Redirect URI are required in the authorization request.");
    const clientInfo = await this.lookupClient(clientId);
    if (!clientInfo || !isValidRedirectUri(redirectUri, clientInfo.redirectUris)) throw new Error("Invalid redirect URI. The redirect URI provided does not match any registered URI for this client.");
    validateAuthorizationResponseType(this.provider.serverCapabilities, options.request.responseType, clientInfo.responseTypes);
    const configuredResource = this.provider.options.resourceMetadata?.resource;
    const resourceWasProvided = options.request.resource !== void 0;
    const parsedResource = parseResourceParameter(options.request.resource);
    if (resourceWasProvided && !parsedResource) throw new AuthorizationError("invalid_target", { description: "The resource parameter must be a valid absolute URI without a fragment" });
    if (configuredResource && resourceWasProvided && !isExactResource(parsedResource, configuredResource)) throw new AuthorizationError("invalid_target", { description: `The resource parameter must exactly match ${configuredResource}` });
    const effectiveResource = configuredResource ?? parsedResource;
    validateAuthorizationPkce(this.provider.serverCapabilities, options.request, clientInfo);
    let grantsToRevoke = [];
    if (options.revokeExistingGrants !== false) {
      const isCimdClient = this.provider.isClientMetadataUrl(clientId);
      const batchSize = getRevokeExistingGrantsBatchSize(options.revokeExistingGrantsBatchSize);
      let cursor;
      do {
        const page = await this.listUserGrants(options.userId, {
          cursor,
          limit: batchSize
        });
        for (const grant of page.items) if (grant.clientId === clientId && (!isCimdClient || grant.redirectUri === options.request.redirectUri)) grantsToRevoke.push(grant.id);
        cursor = page.cursor;
      } while (cursor);
    }
    const grantId = generateRandomString(16);
    const { encryptedData, key: encryptionKey } = await encryptProps(options.props);
    const now = Math.floor(Date.now() / 1e3);
    if (options.request.responseType === "token") {
      const accessTokenSecret = generateRandomString(TOKEN_LENGTH);
      const accessToken = `${options.userId}:${grantId}:${accessTokenSecret}`;
      const accessTokenId = await generateTokenId(accessToken);
      const accessTokenTTL = this.provider.options.accessTokenTTL || DEFAULT_ACCESS_TOKEN_TTL;
      const accessTokenExpiresAt = now + accessTokenTTL;
      const accessTokenWrappedKey = await wrapKeyWithToken(accessToken, encryptionKey);
      const audience = parseResourceParameter(effectiveResource);
      if (effectiveResource && !audience) throw new Error("The resource parameter must be a valid absolute URI without a fragment");
      const grant = {
        id: grantId,
        clientId: options.request.clientId,
        userId: options.userId,
        scope: options.scope,
        metadata: options.metadata,
        encryptedProps: encryptedData,
        createdAt: now,
        resource: effectiveResource,
        redirectUri: options.request.redirectUri
      };
      const grantKey = `grant:${options.userId}:${grantId}`;
      await this.env.OAUTH_KV.put(grantKey, JSON.stringify(grant));
      const accessTokenData = {
        id: accessTokenId,
        grantId,
        userId: options.userId,
        createdAt: now,
        expiresAt: accessTokenExpiresAt,
        audience,
        scope: options.scope,
        wrappedEncryptionKey: accessTokenWrappedKey,
        grant: {
          clientId: options.request.clientId,
          scope: options.scope,
          encryptedProps: encryptedData
        }
      };
      await this.env.OAUTH_KV.put(`token:${options.userId}:${grantId}:${accessTokenId}`, JSON.stringify(accessTokenData), { expirationTtl: accessTokenTTL });
      const redirectUrl = new URL(options.request.redirectUri);
      const fragment = new URLSearchParams();
      fragment.set("access_token", accessToken);
      fragment.set("token_type", "bearer");
      fragment.set("expires_in", accessTokenTTL.toString());
      fragment.set("scope", options.scope.join(" "));
      if (options.request.state) fragment.set("state", options.request.state);
      if (options.request.issuer) fragment.set("iss", options.request.issuer);
      redirectUrl.hash = fragment.toString();
      try {
        await Promise.allSettled(grantsToRevoke.map((oldGrantId) => this.revokeGrant(oldGrantId, options.userId)));
      } catch {
      }
      return { redirectTo: redirectUrl.toString() };
    } else {
      const authCodeSecret = generateRandomString(32);
      const authCode = `${options.userId}:${grantId}:${authCodeSecret}`;
      const authCodeId = await hashSecret(authCode);
      const authCodeWrappedKey = await wrapKeyWithToken(authCode, encryptionKey);
      const grant = {
        id: grantId,
        clientId: options.request.clientId,
        userId: options.userId,
        scope: options.scope,
        metadata: options.metadata,
        encryptedProps: encryptedData,
        createdAt: now,
        authCodeId,
        authCodeWrappedKey,
        codeChallenge: options.request.codeChallenge,
        codeChallengeMethod: options.request.codeChallengeMethod,
        resource: effectiveResource,
        redirectUri: options.request.redirectUri
      };
      const grantKey = `grant:${options.userId}:${grantId}`;
      await this.env.OAUTH_KV.put(grantKey, JSON.stringify(grant), { expirationTtl: 600 });
      const redirectUrl = new URL(options.request.redirectUri);
      redirectUrl.searchParams.set("code", authCode);
      if (options.request.state) redirectUrl.searchParams.set("state", options.request.state);
      if (options.request.issuer) redirectUrl.searchParams.set("iss", options.request.issuer);
      try {
        await Promise.allSettled(grantsToRevoke.map((oldGrantId) => this.revokeGrant(oldGrantId, options.userId)));
      } catch {
      }
      return { redirectTo: redirectUrl.toString() };
    }
  }
  /**
  * Creates a new OAuth client
  * @param clientInfo - Partial client information to create the client with
  * @returns A Promise resolving to the created client info
  */
  async createClient(clientInfo) {
    const clientId = generateRandomString(16);
    const authMethodWasExplicit = clientInfo.tokenEndpointAuthMethod !== void 0;
    const tokenEndpointAuthMethod = clientInfo.tokenEndpointAuthMethod || "client_secret_basic";
    const isPublicClient = tokenEndpointAuthMethod === "none";
    const newClient = {
      clientId,
      redirectUris: clientInfo.redirectUris || [],
      clientName: clientInfo.clientName,
      logoUri: clientInfo.logoUri,
      clientUri: clientInfo.clientUri,
      policyUri: clientInfo.policyUri,
      tosUri: clientInfo.tosUri,
      jwksUri: clientInfo.jwksUri,
      i18n: clientInfo.i18n,
      contacts: clientInfo.contacts,
      grantTypes: clientInfo.grantTypes || [
        GrantType.AUTHORIZATION_CODE,
        GrantType.REFRESH_TOKEN,
        ...this.provider.options.allowTokenExchangeGrant ? [GrantType.TOKEN_EXCHANGE] : []
      ],
      responseTypes: clientInfo.responseTypes || ["code"],
      registrationDate: Math.floor(Date.now() / 1e3),
      tokenEndpointAuthMethod,
      ...authMethodWasExplicit ? { authMethodExplicit: true } : {}
    };
    for (const uri of newClient.redirectUris) validateRedirectUriScheme(uri);
    let clientSecret;
    if (!isPublicClient) {
      clientSecret = generateRandomString(32);
      newClient.clientSecret = await hashSecret(clientSecret);
    }
    await this.env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(newClient));
    const clientResponse = toPublicClientInfo(newClient);
    if (!isPublicClient && clientSecret) clientResponse.clientSecret = clientSecret;
    return clientResponse;
  }
  /**
  * Lists all registered OAuth clients with pagination support
  * @param options - Optional pagination parameters (limit and cursor)
  * @returns A Promise resolving to the list result with items and optional cursor
  */
  async listClients(options) {
    const listOptions = { prefix: "client:" };
    if (options?.limit !== void 0) listOptions.limit = options.limit;
    if (options?.cursor !== void 0) listOptions.cursor = options.cursor;
    const response = await this.env.OAUTH_KV.list(listOptions);
    const clients = [];
    const promises = response.keys.map(async (key) => {
      const clientId = key.name.substring(7);
      const client = await this.provider.getClient(this.env, clientId);
      if (client) clients.push(toPublicClientInfo(client));
    });
    await Promise.all(promises);
    return {
      items: clients,
      cursor: response.list_complete ? void 0 : response.cursor
    };
  }
  /**
  * Updates an existing OAuth client
  * @param clientId - The ID of the client to update
  * @param updates - Partial client information with fields to update
  * @returns A Promise resolving to the updated client info, or null if not found
  */
  async updateClient(clientId, updates) {
    const client = await this.provider.getClient(this.env, clientId);
    if (!client) return null;
    const authMethodWasExplicit = updates.tokenEndpointAuthMethod !== void 0;
    const authMethod = updates.tokenEndpointAuthMethod || client.tokenEndpointAuthMethod || "client_secret_basic";
    const isPublicClient = authMethod === "none";
    let secretToStore = client.clientSecret;
    let originalSecret = void 0;
    if (isPublicClient) secretToStore = void 0;
    else if (updates.clientSecret) {
      originalSecret = updates.clientSecret;
      secretToStore = await hashSecret(updates.clientSecret);
    }
    const updatedClient = {
      ...client,
      ...updates,
      clientId: client.clientId,
      tokenEndpointAuthMethod: authMethod,
      authMethodExplicit: authMethodWasExplicit ? true : client.authMethodExplicit
    };
    if (!isPublicClient && secretToStore) updatedClient.clientSecret = secretToStore;
    else delete updatedClient.clientSecret;
    const clientKvOptions = {};
    if (this.provider.options.clientRegistrationTTL !== void 0) clientKvOptions.expirationTtl = this.provider.options.clientRegistrationTTL;
    await this.env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(updatedClient), clientKvOptions);
    const response = toPublicClientInfo(updatedClient);
    if (!isPublicClient && originalSecret) response.clientSecret = originalSecret;
    return response;
  }
  /**
  * Deletes an OAuth client and revokes all associated grants across all users.
  * @param clientId - The ID of the client to delete
  * @returns A Promise resolving when the deletion is confirmed.
  */
  async deleteClient(clientId) {
    let cursor;
    let allProcessed = false;
    while (!allProcessed) {
      const listOptions = { prefix: "grant:" };
      if (cursor) listOptions.cursor = cursor;
      const result = await this.env.OAUTH_KV.list(listOptions);
      for (const key of result.keys) {
        const grantData = await this.env.OAUTH_KV.get(key.name, { type: "json" });
        if (grantData && grantData.clientId === clientId) await this.revokeGrant(grantData.id, grantData.userId);
      }
      if (result.list_complete) allProcessed = true;
      else cursor = result.cursor;
    }
    await this.env.OAUTH_KV.delete(`client:${clientId}`);
  }
  /**
  * Lists all authorization grants for a specific user with pagination support
  * Returns a summary of each grant without sensitive information
  * @param userId - The ID of the user whose grants to list
  * @param options - Optional pagination parameters (limit and cursor)
  * @returns A Promise resolving to the list result with grant summaries and optional cursor
  */
  async listUserGrants(userId, options) {
    const listOptions = { prefix: `grant:${userId}:` };
    if (options?.limit !== void 0) listOptions.limit = options.limit;
    if (options?.cursor !== void 0) listOptions.cursor = options.cursor;
    const response = await this.env.OAUTH_KV.list(listOptions);
    const grantSummaries = [];
    const promises = response.keys.map(async (key) => {
      const grantData = await this.env.OAUTH_KV.get(key.name, { type: "json" });
      if (grantData) {
        const summary = {
          id: grantData.id,
          clientId: grantData.clientId,
          userId: grantData.userId,
          scope: grantData.scope,
          metadata: grantData.metadata,
          createdAt: grantData.createdAt,
          expiresAt: grantData.expiresAt,
          redirectUri: grantData.redirectUri
        };
        grantSummaries.push(summary);
      }
    });
    await Promise.all(promises);
    return {
      items: grantSummaries,
      cursor: response.list_complete ? void 0 : response.cursor
    };
  }
  /**
  * Revokes an authorization grant and all its associated access tokens
  * @param grantId - The ID of the grant to revoke
  * @param userId - The ID of the user who owns the grant
  * @returns A Promise resolving when the revocation is confirmed.
  */
  async revokeGrant(grantId, userId) {
    const grantKey = `grant:${userId}:${grantId}`;
    const tokenPrefix = `token:${userId}:${grantId}:`;
    let cursor;
    let allTokensDeleted = false;
    while (!allTokensDeleted) {
      const listOptions = { prefix: tokenPrefix };
      if (cursor) listOptions.cursor = cursor;
      const result = await this.env.OAUTH_KV.list(listOptions);
      if (result.keys.length > 0) await Promise.all(result.keys.map((key) => {
        return this.env.OAUTH_KV.delete(key.name);
      }));
      if (result.list_complete) allTokensDeleted = true;
      else cursor = result.cursor;
    }
    await this.env.OAUTH_KV.delete(grantKey);
  }
  /**
  * Decodes a token and returns token data with decrypted props
  * @param token - The token
  * @returns Promise resolving to token data with decrypted props, or null if token is invalid
  */
  async unwrapToken(token) {
    return await this.provider.unwrapToken(token, this.env);
  }
  /**
  * Exchanges an existing access token for a new one with modified characteristics
  * Implements OAuth 2.0 Token Exchange (RFC 8693)
  * @param options - Options for token exchange including subject token and optional modifications
  * @returns Promise resolving to token response with new access token
  * @throws CimdFetchError when the grant's client ID is a CIMD URL whose document cannot be resolved
  */
  async exchangeToken(options) {
    const tokenSummary = await this.unwrapToken(options.subjectToken);
    if (!tokenSummary) throw new Error("Invalid or expired subject token");
    const clientInfo = await this.lookupClient(tokenSummary.grant.clientId);
    if (!clientInfo) throw new Error("Client not found");
    return await this.provider.exchangeToken(options.subjectToken, options.scope, options.aud, options.expiresIn, clientInfo, this.env);
  }
  async purgeExpiredData(options) {
    const batchSize = options?.batchSize ?? DEFAULT_PURGE_BATCH_SIZE;
    const purgeOrphanedGrants = options?.purgeOrphanedGrants !== false;
    const purgeExpiredGrants = options?.purgeExpiredGrants !== false;
    const purgeOrphanedTokens = options?.purgeOrphanedTokens !== false;
    const now = Math.floor(Date.now() / 1e3);
    const result = {
      grantsChecked: 0,
      grantsPurged: 0,
      tokensChecked: 0,
      tokensPurged: 0,
      done: false
    };
    if (purgeOrphanedGrants || purgeExpiredGrants) {
      const knownGoodClients = /* @__PURE__ */ new Set();
      const knownMissingClients = /* @__PURE__ */ new Set();
      let grantCursor;
      let grantsDone = false;
      while (!grantsDone && result.grantsChecked < batchSize) {
        const listOptions = {
          prefix: "grant:",
          limit: Math.min(1e3, batchSize - result.grantsChecked)
        };
        if (grantCursor) listOptions.cursor = grantCursor;
        const page = await this.env.OAUTH_KV.list(listOptions);
        for (const key of page.keys) {
          if (result.grantsChecked >= batchSize) break;
          result.grantsChecked++;
          const grantData = await this.env.OAUTH_KV.get(key.name, { type: "json" });
          if (!grantData) continue;
          let shouldPurge = false;
          if (purgeExpiredGrants && grantData.expiresAt !== void 0 && now >= grantData.expiresAt) shouldPurge = true;
          if (!shouldPurge && purgeOrphanedGrants && !this.provider.isClientMetadataUrl(grantData.clientId)) {
            if (knownMissingClients.has(grantData.clientId)) shouldPurge = true;
            else if (!knownGoodClients.has(grantData.clientId)) if (await this.env.OAUTH_KV.get(`client:${grantData.clientId}`, { type: "json" })) knownGoodClients.add(grantData.clientId);
            else {
              knownMissingClients.add(grantData.clientId);
              shouldPurge = true;
            }
          }
          if (shouldPurge) {
            await this.revokeGrant(grantData.id, grantData.userId);
            result.grantsPurged++;
          }
        }
        if (page.list_complete) grantsDone = true;
        else grantCursor = page.cursor;
      }
      if (!grantsDone) return result;
    }
    if (purgeOrphanedTokens) {
      const knownGoodGrants = /* @__PURE__ */ new Set();
      const knownMissingGrants = /* @__PURE__ */ new Set();
      let tokenCursor;
      let tokensDone = false;
      while (!tokensDone && result.tokensChecked < batchSize) {
        const listOptions = {
          prefix: "token:",
          limit: Math.min(1e3, batchSize - result.tokensChecked)
        };
        if (tokenCursor) listOptions.cursor = tokenCursor;
        const page = await this.env.OAUTH_KV.list(listOptions);
        for (const key of page.keys) {
          if (result.tokensChecked >= batchSize) break;
          result.tokensChecked++;
          const tokenData = await this.env.OAUTH_KV.get(key.name, { type: "json" });
          if (!tokenData) continue;
          const grantKey = `grant:${tokenData.userId}:${tokenData.grantId}`;
          if (knownMissingGrants.has(grantKey)) {
            await this.env.OAUTH_KV.delete(key.name);
            result.tokensPurged++;
          } else if (!knownGoodGrants.has(grantKey)) if (await this.env.OAUTH_KV.get(grantKey)) knownGoodGrants.add(grantKey);
          else {
            knownMissingGrants.add(grantKey);
            await this.env.OAUTH_KV.delete(key.name);
            result.tokensPurged++;
          }
        }
        if (page.list_complete) tokensDone = true;
        else tokenCursor = page.cursor;
      }
      if (!tokensDone) return result;
    }
    result.done = true;
    return result;
  }
};

// src/mcp.ts
import { WorkerEntrypoint as WorkerEntrypoint2 } from "cloudflare:workers";
var ALLOWED_METHODS = /* @__PURE__ */ new Set(["POST", "GET", "DELETE"]);
var McpGateway = class extends WorkerEntrypoint2 {
  static {
    __name(this, "McpGateway");
  }
  async fetch(request) {
    if (!ALLOWED_METHODS.has(request.method)) {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }
    const origin = new URL(request.url);
    const upstream = `${this.env.ORIGIN_URL.replace(/\/$/, "")}/mcp`;
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${this.env.ORIGIN_BEARER_TOKEN}`);
    headers.set("x-gateway-user", this.ctx.props?.userId ?? "unknown");
    headers.delete("host");
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstream, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "DELETE" ? void 0 : request.body,
        // @ts-expect-error -- Workers-specific duplex streaming for request bodies
        duplex: "half"
      });
    } catch (err2) {
      return Response.json(
        {
          error: "origin_unreachable",
          hint: "is the herdr chatgpt-bridge serve action running and the tunnel up?",
          detail: String(err2)
        },
        { status: 502 }
      );
    }
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("set-cookie");
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders
    });
  }
};

// src/index.ts
var SCOPES = ["herdr:read", "herdr:write"];
var CONSENT_TTL_SECONDS = 300;
var CONSENT_PREFIX = "consent:";
var providerCache = /* @__PURE__ */ new Map();
function getProvider(gatewayUrl) {
  let provider = providerCache.get(gatewayUrl);
  if (!provider) {
    provider = new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler: McpGateway,
      // Provider stores handlers behind an env-erased type; ours is Env-typed.
      defaultHandler,
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
        resource_name: "Herdr MCP gateway"
      },
      clientIdMetadataDocumentEnabled: true
    });
    providerCache.set(gatewayUrl, provider);
  }
  return provider;
}
__name(getProvider, "getProvider");
var src_default = {
  /** Single source of truth for the canonical URL: GATEWAY_URL var in wrangler.jsonc / .dev.vars. */
  fetch(request, env, ctx) {
    return getProvider(env.GATEWAY_URL.replace(/\/$/, "")).fetch(request, env, ctx);
  }
};
function asAuthError(e) {
  return e instanceof Error ? e : null;
}
__name(asAuthError, "asAuthError");
async function secretsMatch(a, b) {
  const [da, db] = await Promise.all(
    [a, b].map((v) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))
  );
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
__name(secretsMatch, "secretsMatch");
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}
__name(escapeHtml, "escapeHtml");
function consentPage(clientName, scope, consentId) {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Herdr gateway \u2014 authorize</title>
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
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
__name(consentPage, "consentPage");
var defaultHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, service: "herdr-chatgpt-gateway" });
    }
    if (url.pathname !== "/authorize" && url.pathname !== "/authorize/consent") {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/authorize/consent") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      const form = await request.formData();
      const consentId2 = String(form.get("consent_id") ?? "");
      const passcode = String(form.get("passcode") ?? "");
      const raw = consentId2 ? await env.OAUTH_KV.get(CONSENT_PREFIX + consentId2) : null;
      if (!raw) {
        return new Response("Consent request expired \u2014 start over at the client.", {
          status: 400
        });
      }
      if (!await secretsMatch(passcode, env.CONSENT_PASSCODE)) {
        await new Promise((r) => setTimeout(r, 500));
        return new Response("Invalid passcode.", { status: 403 });
      }
      await env.OAUTH_KV.delete(CONSENT_PREFIX + consentId2);
      const stored = JSON.parse(raw);
      const granted = stored.request.scope.filter(
        (s) => SCOPES.includes(s)
      );
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: stored.request,
        userId: "joep",
        metadata: { clientName: stored.clientName },
        scope: granted,
        props: { userId: "joep", displayName: "Joep", scopes: granted }
      });
      return Response.redirect(redirectTo, 302);
    }
    let oauthRequest;
    try {
      oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch (error) {
      const authError = asAuthError(error);
      if (!authError) throw error;
      if (!authError.redirectUri) {
        return new Response(authError.description ?? "Invalid authorization request", {
          status: 400
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
        clientName: client.clientName ?? "client"
      }),
      { expirationTtl: CONSENT_TTL_SECONDS }
    );
    return consentPage(
      client.clientName ?? "client",
      oauthRequest.scope.join(" "),
      consentId
    );
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-yXK8KT/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-yXK8KT/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
