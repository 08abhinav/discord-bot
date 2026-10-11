// Request authentication. Both endpoints are public URLs, so every request is
// checked before anything else happens: Discord signs interactions with
// Ed25519, GitHub signs webhooks with HMAC-SHA256.

const encoder = new TextEncoder();

export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Verifies the X-Signature-Ed25519 / X-Signature-Timestamp headers of a Discord interaction. */
export async function verifyDiscordRequest(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  body: string
): Promise<boolean> {
  if (!signatureHex || !timestamp) return false;
  const publicKey = hexToBytes(publicKeyHex);
  const signature = hexToBytes(signatureHex);
  if (!publicKey || !signature || signature.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, encoder.encode(timestamp + body));
  } catch {
    return false;
  }
}

/** Verifies the X-Hub-Signature-256 header of a GitHub webhook ("sha256=<hex>"). */
export async function verifyGithubSignature(secret: string, header: string | null, body: string): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const signature = hexToBytes(header.slice("sha256=".length));
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "verify",
  ]);
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(body));
}
