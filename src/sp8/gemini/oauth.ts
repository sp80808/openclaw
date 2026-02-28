import crypto from "node:crypto";
import { readSecureJson, writeSecureJson } from "../secure-store.js";

const GEMINI_TOKEN_SERVICE = "sp8claw.gemini";
const GEMINI_TOKEN_ACCOUNT = "oauth";

export type GeminiOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  scope?: string;
};

export function createGeminiPkceAuthSession(params: {
  clientId: string;
  redirectUri: string;
  scope?: string;
}): {
  authorizationUrl: string;
  codeVerifier: string;
} {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const scope = encodeURIComponent(params.scope ?? "openid email profile");
  const redirectUri = encodeURIComponent(params.redirectUri);
  const clientId = encodeURIComponent(params.clientId);
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    "&response_type=code" +
    `&scope=${scope}` +
    "&access_type=offline" +
    "&prompt=consent" +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    "&code_challenge_method=S256";

  return { authorizationUrl: authUrl, codeVerifier };
}

export async function exchangeGeminiOAuthCode(params: {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<GeminiOAuthTokens> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.codeVerifier,
  });
  if (params.clientSecret?.trim()) {
    body.set("client_secret", params.clientSecret.trim());
  }

  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Gemini OAuth token exchange failed: HTTP ${res.status}`);
  }
  const payload = (await res.json()) as Record<string, unknown>;
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) {
    throw new Error("Gemini OAuth token exchange failed: access token missing");
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : undefined;
  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresAtMs: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
  };
}

export async function storeGeminiOAuthTokens(tokens: GeminiOAuthTokens): Promise<void> {
  await writeSecureJson(GEMINI_TOKEN_SERVICE, GEMINI_TOKEN_ACCOUNT, tokens);
}

export async function loadGeminiOAuthTokens(): Promise<GeminiOAuthTokens | null> {
  return await readSecureJson<GeminiOAuthTokens>(GEMINI_TOKEN_SERVICE, GEMINI_TOKEN_ACCOUNT);
}
