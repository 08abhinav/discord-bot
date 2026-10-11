// The Discord OAuth2 calls behind /link. We ask for two scopes: `identify`
// (who is this) and `connections` (which accounts they've connected to their
// Discord profile). Discord has already verified a connected GitHub account,
// so reading it tells us the member's GitHub login without a GitHub login flow.
import type { Config, Env } from "./config";
import { hexToBytes } from "./verify";

const API = "https://discord.com/api/v10";
const STATE_TTL_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();

/** Linking is on when the config says so and the client secret is in place. */
export const linkingEnabled = (env: Env): boolean => env.LINKING === "on" && Boolean(env.DISCORD_CLIENT_SECRET);

/** Must be listed under OAuth2 > Redirects in the Discord developer portal. */
export const redirectUri = (cfg: Config): string => `${cfg.publicUrl}/link/callback`;

const stateKey = (secret: string, usages: ("sign" | "verify")[]) =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The `state` value for a member's link: their Discord id and an expiry,
 * signed. It ties the link to the person who asked for it, so a link passed
 * to someone else doesn't work, and it stops working after 15 minutes.
 */
export async function signState(secret: string, userId: string, now: Date): Promise<string> {
  const payload = `${userId}.${now.getTime() + STATE_TTL_MS}`;
  const signature = await crypto.subtle.sign("HMAC", await stateKey(secret, ["sign"]), encoder.encode(`link-state:${payload}`));
  return `${payload}.${toHex(signature)}`;
}

/** The Discord id a state was signed for, or null when it's forged, damaged or expired. */
export async function readState(secret: string, state: string, now: Date): Promise<string | null> {
  const [userId, expires, signatureHex, ...rest] = state.split(".");
  if (!userId || !expires || !signatureHex || rest.length > 0) return null;
  const signature = hexToBytes(signatureHex);
  if (!signature) return null;
  // subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await stateKey(secret, ["verify"]),
    signature,
    encoder.encode(`link-state:${userId}.${expires}`)
  );
  if (!valid || !/^\d+$/.test(expires) || Number(expires) < now.getTime()) return null;
  return userId;
}

export function authorizeUrl(env: Env, cfg: Config, state: string): string {
  const query = new URLSearchParams({
    client_id: env.DISCORD_APPLICATION_ID,
    response_type: "code",
    redirect_uri: redirectUri(cfg),
    scope: "identify connections",
    state,
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

export interface DiscordIdentity {
  id: string;
  name: string;
  /** Their verified GitHub connection, if they have one. */
  github: { id: string; login: string } | null;
}

interface Connection {
  id: string;
  name: string;
  type: string;
  verified?: boolean;
  revoked?: boolean;
}

// What GitHub allows in a username. Checked because the login ends up in search queries and URLs.
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

/**
 * Trades the code from the callback for a token, reads who the member is and
 * which GitHub account they've connected, then revokes the token. Nothing from
 * Discord is kept beyond what's returned here.
 */
export async function exchangeCode(env: Env, cfg: Config, code: string): Promise<DiscordIdentity> {
  const basic = `Basic ${btoa(`${env.DISCORD_APPLICATION_ID}:${env.DISCORD_CLIENT_SECRET ?? ""}`)}`;
  const form = (fields: Record<string, string>) => ({
    method: "POST",
    headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

  const tokenRes = await fetch(`${API}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: redirectUri(cfg) }));
  if (!tokenRes.ok) throw new Error(`Discord ${tokenRes.status} exchanging the code`);
  const { access_token: token } = (await tokenRes.json()) as { access_token: string };

  try {
    const bearer = { headers: { Authorization: `Bearer ${token}` } };
    const [userRes, connectionsRes] = await Promise.all([
      fetch(`${API}/users/@me`, bearer),
      fetch(`${API}/users/@me/connections`, bearer),
    ]);
    if (!userRes.ok || !connectionsRes.ok) {
      throw new Error(`Discord ${userRes.status}/${connectionsRes.status} reading the profile`);
    }
    const user = (await userRes.json()) as { id: string; username: string; global_name?: string | null };
    const connections = (await connectionsRes.json()) as Connection[];
    const github = connections.find((c) => c.type === "github" && c.verified && !c.revoked && GITHUB_LOGIN.test(c.name));
    return {
      id: user.id,
      name: user.global_name || user.username,
      github: github ? { id: github.id, login: github.name } : null,
    };
  } finally {
    // We only needed the token for those two reads.
    await fetch(`${API}/oauth2/token/revoke`, form({ token, token_type_hint: "access_token" })).catch(() => undefined);
  }
}
