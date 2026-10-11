import { describe, expect, it } from "vitest";
import { hexToBytes, verifyDiscordRequest, verifyGithubSignature } from "../src/verify";

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function discordKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = toHex((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const sign = async (timestamp: string, body: string) =>
    toHex(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(timestamp + body)));
  return { publicKey, sign };
}

async function githubSignature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

describe("hexToBytes", () => {
  it("decodes hex", () => {
    expect(hexToBytes("00ff10")).toEqual(new Uint8Array([0, 255, 16]));
  });
  it("rejects odd lengths and non-hex characters", () => {
    expect(hexToBytes("abc")).toBeNull();
    expect(hexToBytes("zz")).toBeNull();
  });
});

describe("verifyDiscordRequest", () => {
  it("accepts a correctly signed request", async () => {
    const { publicKey, sign } = await discordKeys();
    const body = '{"type":1}';
    expect(await verifyDiscordRequest(publicKey, await sign("1700000000", body), "1700000000", body)).toBe(true);
  });

  it("rejects a tampered body, a wrong timestamp and missing headers", async () => {
    const { publicKey, sign } = await discordKeys();
    const signature = await sign("1700000000", '{"type":1}');
    expect(await verifyDiscordRequest(publicKey, signature, "1700000000", '{"type":2}')).toBe(false);
    expect(await verifyDiscordRequest(publicKey, signature, "1700000001", '{"type":1}')).toBe(false);
    expect(await verifyDiscordRequest(publicKey, null, "1700000000", '{"type":1}')).toBe(false);
    expect(await verifyDiscordRequest(publicKey, signature, null, '{"type":1}')).toBe(false);
  });

  it("rejects a signature made with another key and malformed hex", async () => {
    const a = await discordKeys();
    const b = await discordKeys();
    const body = '{"type":1}';
    expect(await verifyDiscordRequest(a.publicKey, await b.sign("1", body), "1", body)).toBe(false);
    expect(await verifyDiscordRequest(a.publicKey, "not-hex", "1", body)).toBe(false);
    expect(await verifyDiscordRequest("not-hex", await a.sign("1", body), "1", body)).toBe(false);
  });
});

describe("verifyGithubSignature", () => {
  it("accepts the right HMAC", async () => {
    const body = '{"zen":"Keep it logically awesome."}';
    expect(await verifyGithubSignature("s3cret", await githubSignature("s3cret", body), body)).toBe(true);
  });

  it("rejects a wrong secret, a changed body, and missing or malformed headers", async () => {
    const body = '{"a":1}';
    const good = await githubSignature("s3cret", body);
    expect(await verifyGithubSignature("other", good, body)).toBe(false);
    expect(await verifyGithubSignature("s3cret", good, '{"a":2}')).toBe(false);
    expect(await verifyGithubSignature("s3cret", null, body)).toBe(false);
    expect(await verifyGithubSignature("s3cret", good.replace("sha256=", "sha1="), body)).toBe(false);
    expect(await verifyGithubSignature("s3cret", "sha256=xyz", body)).toBe(false);
  });

  it("rejects everything when no secret is configured", async () => {
    expect(await verifyGithubSignature("", "sha256=00", "{}")).toBe(false);
  });
});
