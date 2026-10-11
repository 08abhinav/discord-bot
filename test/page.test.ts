import { beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import worker from "../src/index";
import { escapeHtml, leaderboardJson, leaderboardPage, standing } from "../src/page";
import { makeEnv, mockFetch } from "./helpers";

const cfg = getConfig(makeEnv());
const row = (login: string, count: number, qualifies = false, winner = false) => ({ login, count, reachedAt: "2026-10-05T00:00:00Z", qualifies, winner });
const board = { generatedAt: "2026-10-12T04:30:00.000Z", rows: [row("ada", 6, true, true), row("bob", 5, true, false), row("cy", 2), row("dee", 4)] };
const links = { issues: "https://github.com/search?q=x&type=issues", discord: "https://discord.gg/example", self: "https://bot.example/leaderboard" };

describe("standing", () => {
  it("says where each person is for the reward", () => {
    expect(standing(board.rows[0]!, cfg)).toEqual({ text: "In the top 5", kind: "top" });
    expect(standing(board.rows[1]!, cfg)).toEqual({ text: "Qualifies", kind: "qualifies" });
    expect(standing(board.rows[2]!, cfg)).toEqual({ text: "3 more to qualify", kind: "progress" });
    expect(standing(board.rows[3]!, cfg)).toEqual({ text: "1 more to qualify", kind: "progress" });
  });
});

describe("leaderboardPage", () => {
  const html = leaderboardPage(board, cfg, links);

  it("lists people in order with their counts and links to their profiles", () => {
    expect(html).toContain("<h1>Hacktoberfest 2026 leaderboard</h1>");
    expect(html.indexOf(">ada<")).toBeLessThan(html.indexOf(">bob<"));
    expect(html).toContain('<a href="https://github.com/ada">ada</a>');
    expect(html).toContain("6 merged PRs");
    expect(html).toContain('<span class="chip top">In the top 5</span>');
    expect(html).toContain('<span class="chip progress">3 more to qualify</span>');
  });

  it("states the rules, the window and who the reward comes from", () => {
    expect(html).toContain("Merged pull requests in chatcops, ogcops and toolbelt, Oct 1 to Oct 31 (UTC).");
    expect(html).toContain("at least 5 merged PRs get a CODERCOPS T-shirt and stickers");
    expect(html).toContain("Only PRs for issues that were assigned to you count.");
    expect(html).toContain("This swag comes from CODERCOPS, separate from Hacktoberfest.");
  });

  it("links to issues, Discord and the platform, with escaped URLs", () => {
    expect(html).toContain('href="https://github.com/search?q=x&amp;type=issues"');
    expect(html).toContain('href="https://discord.gg/example"');
    expect(html).toContain('href="https://www.codercops.com"');
  });

  it("escapes anything that isn't ours", () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
    const evil = leaderboardPage({ ...board, rows: [row('"><script>alert(1)</script>', 1)] }, cfg, links);
    expect(evil).not.toContain("<script>");
    expect(evil).toContain("&lt;script&gt;");
  });

  it("has an empty state", () => {
    expect(leaderboardPage({ ...board, rows: [] }, cfg, links)).toContain("No merged pull requests counted yet");
  });
});

describe("leaderboardJson", () => {
  it("returns ranks, counts and the rules", () => {
    const json = leaderboardJson(board, cfg);
    expect(json.title).toBe("Hacktoberfest 2026 leaderboard");
    expect(json.rows[0]).toEqual({ rank: 1, login: "ada", mergedPrs: 6, qualifies: true, inTop: true });
    expect(json.rules).toMatchObject({ minPrs: 5, topN: 5, label: "hacktoberfest-accepted", start: "2026-10-01T00:00:00.000Z" });
  });
});

describe("GET /leaderboard", () => {
  let env = makeEnv();
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const search = () => ({
    total_count: 2,
    items: [
      { html_url: "https://github.com/codercops/toolbelt/pull/1", user: { login: "ada" }, pull_request: { merged_at: "2026-10-02T00:00:00Z" } },
      { html_url: "https://github.com/codercops/toolbelt/pull/2", user: { login: "anurag629" }, pull_request: { merged_at: "2026-10-03T00:00:00Z" } },
    ],
  });
  beforeEach(() => {
    env = makeEnv();
  });

  it("serves the page with a strict content security policy and caches the ranking", async () => {
    const fetched = mockFetch(search);
    const res = await worker.fetch(new Request("https://bot.example/leaderboard"), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain(">ada<");
    expect(html).not.toContain("anurag629");
    expect(html).toContain('content="https://bot.example/leaderboard"');

    await worker.fetch(new Request("https://bot.example/leaderboard"), env, ctx);
    expect(fetched.calls.filter((c) => c.url.includes("api.github.com"))).toHaveLength(1);
  });

  it("serves JSON with CORS", async () => {
    mockFetch(search);
    const res = await worker.fetch(new Request("https://bot.example/leaderboard.json"), env, ctx);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(((await res.json()) as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("answers 503 when GitHub is rate limiting", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    const res = await worker.fetch(new Request("https://bot.example/leaderboard"), env, ctx);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
