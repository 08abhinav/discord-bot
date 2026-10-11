import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  escapeMarkdown,
  leaderboardMessage,
  mergedPrMessage,
  ordinal,
  releaseMessage,
  starterIssueMessage,
  starterIssuesReply,
  truncate,
} from "../src/messages";
import { makeEnv } from "./helpers";

const cfg = getConfig(makeEnv());

describe("helpers", () => {
  it("truncates with an ellipsis and never exceeds the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
    const out = truncate("a".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("escapes markdown so titles render literally", () => {
    expect(escapeMarkdown("fix *bold* [x](y) `code`")).toBe("fix \\*bold\\* \\[x\\]\\(y\\) \\`code\\`");
  });

  it("builds ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th",
    ]);
  });
});

describe("releaseMessage", () => {
  const release = { name: "v0.6.2", tag_name: "v0.6.2", body: "Fixes", html_url: "https://github.com/codercops/toolbelt/releases/tag/v0.6.2" };

  it("prefixes the repo name when the release name doesn't have it", () => {
    expect(releaseMessage("toolbelt", release).embeds?.[0]).toMatchObject({ title: "toolbelt v0.6.2", url: release.html_url, description: "Fixes" });
  });

  it("keeps names that already mention the repo, like scoped packages", () => {
    const msg = releaseMessage("chatcops", { ...release, name: "@chatcops/widget@0.4.1" });
    expect(msg.embeds?.[0]?.title).toBe("@chatcops/widget@0.4.1");
  });

  it("falls back to the tag and a placeholder body, and trims long notes", () => {
    const msg = releaseMessage("ogcops", { ...release, name: null, body: null });
    expect(msg.embeds?.[0]).toMatchObject({ title: "ogcops v0.6.2", description: "No release notes." });
    const long = releaseMessage("ogcops", { ...release, body: "x".repeat(6000) });
    expect(long.embeds?.[0]?.description?.length).toBeLessThanOrEqual(3500);
  });
});

describe("starterIssueMessage", () => {
  const issue = { repo: "toolbelt", number: 124, title: "Quote YAML strings", url: "https://github.com/codercops/toolbelt/issues/124", labels: ["bug", "good first issue"] };

  it("describes each state", () => {
    expect(starterIssueMessage(issue, { kind: "open" }).embeds?.[0]?.description).toContain("Comment on the issue to claim it");
    expect(starterIssueMessage(issue, { kind: "claimed", by: "ada_l" }).embeds?.[0]?.description).toContain("Claimed by ada\\_l.");
    expect(starterIssueMessage(issue, { kind: "done" }).embeds?.[0]?.description).toContain("Done.");
  });

  it("puts the repo and number in the title and links to the issue", () => {
    expect(starterIssueMessage(issue, { kind: "open" }).embeds?.[0]).toMatchObject({
      title: "toolbelt #124: Quote YAML strings",
      url: issue.url,
    });
  });
});

describe("mergedPrMessage", () => {
  const pr = { repo: "chatcops", number: 103, title: "fix(widget): hide the *open* launcher", url: "https://github.com/codercops/chatcops/pull/103", login: "Pratham2511" };

  it("names the author and links the PR with an escaped title", () => {
    const text = mergedPrMessage(pr).embeds?.[0]?.description ?? "";
    expect(text).toContain("**Pratham2511** got a PR merged in **chatcops**");
    expect(text).toContain("[fix\\(widget\\): hide the \\*open\\* launcher](https://github.com/codercops/chatcops/pull/103)");
    expect(text).not.toContain("That's their");
  });

  it("adds the running count when it's known", () => {
    const text = mergedPrMessage(pr, { count: 3, label: "Hacktoberfest 2026" }).embeds?.[0]?.description ?? "";
    expect(text).toContain("That's their 3rd merged PR on the Hacktoberfest 2026 leaderboard.");
  });
});

describe("leaderboardMessage", () => {
  const row = (login: string, count: number, qualifies = false, winner = false) => ({ login, count, reachedAt: "2026-10-05T00:00:00Z", qualifies, winner });
  const board = { generatedAt: "2026-10-12T04:30:00.000Z", rows: [row("ada", 6, true, true), row("bob", 2), row("cy", 1)] };

  it("lists people in order and marks who is in the running", () => {
    const embed = leaderboardMessage(board, cfg).embeds?.[0];
    expect(embed?.title).toBe("Hacktoberfest 2026 leaderboard");
    expect(embed?.description).toBe("1. **ada** · 6 merged PRs · in the top 5\n2. **bob** · 2 merged PRs\n3. **cy** · 1 merged PR");
    expect(embed?.footer?.text).toContain("at least 5 merged PRs labeled hacktoberfest-accepted");
    expect(embed?.footer?.text).toContain("a CODERCOPS T-shirt and stickers");
    // The footer says who the reward comes from, so nobody takes it for Hacktoberfest swag.
    expect(embed?.footer?.text?.endsWith("This swag comes from CODERCOPS, separate from Hacktoberfest.")).toBe(true);
  });

  it("leaves the footer note out when none is configured", () => {
    const plain = getConfig(makeEnv({ LEADERBOARD_NOTE: undefined }));
    expect(leaderboardMessage(board, plain).embeds?.[0]?.footer?.text?.endsWith("Ties go to whoever got there first.")).toBe(true);
  });

  it("announces winners in the final results", () => {
    const embed = leaderboardMessage(board, cfg, { final: true }).embeds?.[0];
    expect(embed?.title).toBe("Hacktoberfest 2026 leaderboard: final results");
    expect(embed?.description).toContain("1. **ada** · 6 merged PRs · winner");
    expect(embed?.description).toContain("Congratulations to **ada**. We'll reach out on GitHub to send you a CODERCOPS T-shirt and stickers.");
  });

  it("handles a final result with no qualifiers and an empty board", () => {
    const none = leaderboardMessage({ ...board, rows: [row("bob", 2)] }, cfg, { final: true }).embeds?.[0];
    expect(none?.description).toContain("Nobody reached 5 merged PRs");
    const empty = leaderboardMessage({ ...board, rows: [] }, cfg).embeds?.[0];
    expect(empty?.description).toContain("No merged PRs counted yet");
  });
});

describe("starterIssuesReply", () => {
  const issue = (n: number) => ({ repo: "toolbelt", number: n, title: `Issue ${n}`, url: `https://github.com/codercops/toolbelt/issues/${n}`, labels: ["good first issue"] });

  it("shows one embed per repo with a link to the full filtered list", () => {
    const reply = starterIssuesReply(cfg, [{ repo: "toolbelt", issues: [issue(2), issue(1)] }, { repo: "ogcops", issues: [] }]);
    expect(reply.embeds).toHaveLength(2);
    expect(reply.embeds?.[0]?.title).toBe("toolbelt: 2 open starter issues");
    expect(reply.embeds?.[0]?.description).toContain("[#2](https://github.com/codercops/toolbelt/issues/2) Issue 2");
    expect(decodeURIComponent(reply.embeds?.[0]?.url ?? "")).toContain('no:assignee label:"good first issue","help wanted"');
    expect(reply.embeds?.[1]?.description).toContain("Nothing unassigned right now");
  });

  it("caps long lists and says how many more there are", () => {
    const issues = Array.from({ length: 30 }, (_, i) => issue(30 - i));
    const embed = starterIssuesReply(cfg, [{ repo: "toolbelt", issues }]).embeds?.[0];
    expect(embed?.title).toBe("toolbelt: 30 open starter issues");
    expect(embed?.description).toContain("and 18 more");
  });
});
