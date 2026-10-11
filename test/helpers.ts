import type { Env } from "../src/config";

/** A minimal in-memory stand-in for a KV namespace. */
export class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: "json"): Promise<unknown> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(opts: { prefix?: string } = {}) {
    const keys = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).map((name) => ({ name }));
    return { keys, list_complete: true, cursor: "" };
  }
}

export const ROADMAPS = [
  { id: "ai-engineer-100", name: "100 Days of AI Engineer", days: 100, url: "https://example.com/ai", forum: "forum-ai", tag: "tag-ai" },
  { id: "gen-ai-21", name: "Gen AI Engineer in 3 Weeks", days: 21, url: "https://example.com/genai", forum: "forum-logs", tag: "tag-genai" },
];

export function makeEnv(overrides: Partial<Env> = {}): Env & { STATE: FakeKV & KVNamespace } {
  return {
    STATE: new FakeKV() as unknown as FakeKV & KVNamespace,
    DISCORD_BOT_TOKEN: "test-bot-token",
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
    DISCORD_APPLICATION_ID: "111",
    DISCORD_PUBLIC_KEY: "",
    CHANNEL_RELEASES: "chan-releases",
    CHANNEL_STARTER_ISSUES: "chan-issues",
    CHANNEL_MERGED_PRS: "chan-merged",
    CHANNEL_LEADERBOARD: "chan-leaderboard",
    GITHUB_ORG: "codercops",
    REPOS: "chatcops,ogcops,toolbelt",
    STARTER_LABELS: "good first issue,help wanted",
    EXCLUDED_USERS: "anurag629",
    LEADERBOARD_TITLE: "Hacktoberfest 2026",
    LEADERBOARD_LABEL: "hacktoberfest-accepted",
    LEADERBOARD_START: "2026-10-01T00:00:00Z",
    LEADERBOARD_END: "2026-10-31T23:59:59Z",
    LEADERBOARD_MIN_PRS: "5",
    LEADERBOARD_TOP_N: "5",
    LEADERBOARD_REWARD: "a CODERCOPS T-shirt and stickers",
    ROADMAPS,
    CHECKIN_UTC_OFFSET_MINUTES: "330",
    ...overrides,
  } as Env & { STATE: FakeKV & KVNamespace };
}

export interface RecordedCall {
  url: string;
  method: string;
  body: any;
}

/**
 * Replaces global fetch. Discord calls are recorded and answered with a fake
 * message id; GitHub calls are answered by `github(url)`.
 */
export function mockFetch(
  github: (url: URL) => unknown = () => ({ total_count: 0, items: [] }),
  /** Return a Response to override the default Discord answer for a call. */
  discord: (call: RecordedCall) => Response | undefined = () => undefined
) {
  const calls: RecordedCall[] = [];
  let nextId = 1;
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: url.href, method, body });
    if (url.hostname === "api.github.com") {
      return new Response(JSON.stringify(github(url)), { status: 200 });
    }
    const override = discord({ url: url.href, method, body });
    if (override) return override;
    return new Response(JSON.stringify({ id: `msg-${nextId++}` }), { status: 200 });
  };
  globalThis.fetch = impl as typeof fetch;
  return {
    calls,
    discord: () => calls.filter((c) => c.url.startsWith("https://discord.com/")),
    clear: () => void calls.splice(0),
  };
}
