import { beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { handleGithubEvent, isStarterIssue, starterState } from "../src/webhook";
import { makeEnv, mockFetch } from "./helpers";

const repository = { name: "toolbelt", owner: { login: "codercops" } };
let env = makeEnv();
let cfg = getConfig(env);

beforeEach(() => {
  env = makeEnv();
  cfg = getConfig(env);
});

const issueEvent = (action: string, over: Record<string, unknown> = {}, label?: string) => ({
  action,
  repository,
  ...(label ? { label: { name: label } } : {}),
  issue: {
    number: 124,
    title: "Quote YAML strings",
    html_url: "https://github.com/codercops/toolbelt/issues/124",
    state: "open",
    labels: [{ name: "bug" }, { name: "good first issue" }],
    assignees: [],
    ...over,
  },
});

describe("isStarterIssue / starterState", () => {
  it("needs a starter label and no blocked label", () => {
    expect(isStarterIssue(["bug", "Good First Issue"], cfg)).toBe(true);
    expect(isStarterIssue(["help wanted"], cfg)).toBe(true);
    expect(isStarterIssue(["bug"], cfg)).toBe(false);
    expect(isStarterIssue(["good first issue", "blocked"], cfg)).toBe(false);
  });

  it("maps issue state to open, claimed or done", () => {
    const base = issueEvent("labeled").issue;
    expect(starterState(base as never)).toEqual({ kind: "open" });
    expect(starterState({ ...base, assignees: [{ login: "ada" }] } as never)).toEqual({ kind: "claimed", by: "ada" });
    expect(starterState({ ...base, state: "closed" } as never)).toEqual({ kind: "done" });
  });
});

describe("starter issue feed", () => {
  it("posts once when a starter label is added, then edits that message as the issue changes", async () => {
    const fetched = mockFetch();

    expect(await handleGithubEvent("issues", issueEvent("labeled", {}, "good first issue"), env, cfg)).toBe("posted starter issue");
    expect(fetched.discord()).toHaveLength(1);
    expect(fetched.discord()[0]).toMatchObject({ method: "POST", url: "https://discord.com/api/v10/channels/chan-issues/messages" });
    expect(fetched.discord()[0]?.body.allowed_mentions).toEqual({ parse: [] });

    const claimed = issueEvent("assigned", { assignees: [{ login: "ada" }] });
    expect(await handleGithubEvent("issues", claimed, env, cfg)).toBe("updated starter issue (claimed)");
    const edit = fetched.discord()[1];
    expect(edit).toMatchObject({ method: "PATCH", url: "https://discord.com/api/v10/channels/chan-issues/messages/msg-1" });
    expect(edit?.body.embeds[0].description).toContain("Claimed by ada.");

    expect(await handleGithubEvent("issues", issueEvent("unassigned"), env, cfg)).toBe("updated starter issue (open)");
    expect(await handleGithubEvent("issues", issueEvent("closed", { state: "closed" }), env, cfg)).toBe("updated starter issue (done)");
    expect(fetched.discord().filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("does not post on opened (labeled follows), for other labels, or for issues that aren't free", async () => {
    const fetched = mockFetch();
    expect(await handleGithubEvent("issues", issueEvent("opened"), env, cfg)).toBe("ignored issue");
    expect(await handleGithubEvent("issues", issueEvent("labeled", {}, "bug"), env, cfg)).toBe("ignored issue");
    expect(await handleGithubEvent("issues", issueEvent("labeled", { assignees: [{ login: "ada" }] }, "good first issue"), env, cfg)).toBe("ignored issue");
    expect(await handleGithubEvent("issues", issueEvent("labeled", { labels: [{ name: "good first issue" }, { name: "blocked" }] }, "good first issue"), env, cfg)).toBe("ignored issue");
    expect(await handleGithubEvent("issues", issueEvent("labeled", { pull_request: {} }, "good first issue"), env, cfg)).toBe("ignored issue");
    expect(fetched.discord()).toHaveLength(0);
  });

  it("announces an older starter issue when it becomes free again", async () => {
    const fetched = mockFetch();
    expect(await handleGithubEvent("issues", issueEvent("unassigned"), env, cfg)).toBe("posted starter issue");
    expect(fetched.discord()).toHaveLength(1);
  });

  it("ignores repos outside the configured list", async () => {
    const fetched = mockFetch();
    const other = { ...issueEvent("labeled", {}, "good first issue"), repository: { name: "secret-repo", owner: { login: "codercops" } } };
    expect(await handleGithubEvent("issues", other, env, cfg)).toBe("ignored issue");
    const fork = { ...issueEvent("labeled", {}, "good first issue"), repository: { name: "toolbelt", owner: { login: "someone" } } };
    expect(await handleGithubEvent("issues", fork, env, cfg)).toBe("ignored issue");
    expect(fetched.discord()).toHaveLength(0);
  });
});

describe("releases", () => {
  const release = { name: "v0.6.2", tag_name: "v0.6.2", body: "Fixes", html_url: "https://github.com/codercops/toolbelt/releases/tag/v0.6.2", draft: false, prerelease: false };

  it("posts published releases to the releases channel", async () => {
    const fetched = mockFetch();
    expect(await handleGithubEvent("release", { action: "published", repository, release }, env, cfg)).toBe("posted release");
    expect(fetched.discord()[0]?.url).toBe("https://discord.com/api/v10/channels/chan-releases/messages");
    expect(fetched.discord()[0]?.body.embeds[0].title).toBe("toolbelt v0.6.2");
  });

  it("ignores drafts, prereleases and other actions", async () => {
    const fetched = mockFetch();
    await handleGithubEvent("release", { action: "created", repository, release }, env, cfg);
    await handleGithubEvent("release", { action: "published", repository, release: { ...release, draft: true } }, env, cfg);
    await handleGithubEvent("release", { action: "published", repository, release: { ...release, prerelease: true } }, env, cfg);
    expect(fetched.discord()).toHaveLength(0);
  });
});

describe("merged pull requests", () => {
  const prEvent = (over: Record<string, unknown> = {}, user = { login: "ada", type: "User" }) => ({
    action: "closed",
    repository,
    pull_request: {
      number: 139,
      title: "fix(url-encoder): show an error",
      html_url: "https://github.com/codercops/toolbelt/pull/139",
      merged: true,
      merged_at: "2026-10-11T16:20:00Z",
      user,
      labels: [{ name: "hacktoberfest-accepted" }],
      ...over,
    },
  });

  it("posts a shoutout with the author's running count, counting this PR even if search lags", async () => {
    // Search already knows two earlier PRs by ada and one by bob, but not #139 yet.
    const fetched = mockFetch(() => ({
      total_count: 3,
      items: [
        { html_url: "https://github.com/codercops/toolbelt/pull/1", user: { login: "ada" }, pull_request: { merged_at: "2026-10-02T00:00:00Z" } },
        { html_url: "https://github.com/codercops/chatcops/pull/2", user: { login: "Ada" }, pull_request: { merged_at: "2026-10-03T00:00:00Z" } },
        { html_url: "https://github.com/codercops/ogcops/pull/3", user: { login: "bob" }, pull_request: { merged_at: "2026-10-04T00:00:00Z" } },
      ],
    }));
    expect(await handleGithubEvent("pull_request", prEvent(), env, cfg)).toBe("posted merged pull request");
    const post = fetched.discord()[0];
    expect(post?.url).toBe("https://discord.com/api/v10/channels/chan-merged/messages");
    expect(post?.body.embeds[0].description).toContain("That's their 3rd merged PR for Hacktoberfest 2026.");
  });

  it("doesn't double count when search already includes this PR", async () => {
    const fetched = mockFetch(() => ({
      total_count: 1,
      items: [{ html_url: "https://github.com/codercops/toolbelt/pull/139", user: { login: "ada" }, pull_request: { merged_at: "2026-10-11T16:20:00Z" } }],
    }));
    await handleGithubEvent("pull_request", prEvent(), env, cfg);
    expect(fetched.discord()[0]?.body.embeds[0].description).toContain("That's their 1st merged PR");
  });

  it("searches only our repos, the event label and the event window", async () => {
    const fetched = mockFetch();
    await handleGithubEvent("pull_request", prEvent(), env, cfg);
    const search = fetched.calls.find((c) => c.url.includes("/search/issues"));
    const q = new URL(search!.url).searchParams.get("q");
    expect(q).toBe(
      'is:pr is:merged label:"hacktoberfest-accepted" merged:2026-10-01T00:00:00Z..2026-10-31T23:59:59Z repo:codercops/chatcops repo:codercops/ogcops repo:codercops/toolbelt'
    );
  });

  it("still posts, without a count, for PRs that don't count toward the leaderboard", async () => {
    const fetched = mockFetch();
    await handleGithubEvent("pull_request", prEvent({ labels: [] }), env, cfg);
    await handleGithubEvent("pull_request", prEvent({ merged_at: "2026-11-02T00:00:00Z" }), env, cfg);
    expect(fetched.calls.some((c) => c.url.includes("api.github.com"))).toBe(false);
    expect(fetched.discord()).toHaveLength(2);
    expect(fetched.discord()[0]?.body.embeds[0].description).not.toContain("That's their");
  });

  it("skips bots, maintainers, unmerged PRs and other actions", async () => {
    const fetched = mockFetch();
    await handleGithubEvent("pull_request", prEvent({}, { login: "dependabot[bot]", type: "Bot" }), env, cfg);
    await handleGithubEvent("pull_request", prEvent({}, { login: "Anurag629", type: "User" }), env, cfg);
    await handleGithubEvent("pull_request", prEvent({ merged: false }), env, cfg);
    await handleGithubEvent("pull_request", { ...prEvent(), action: "opened" }, env, cfg);
    expect(fetched.discord()).toHaveLength(0);
  });
});

describe("other events", () => {
  it("answers ping and ignores events it doesn't handle", async () => {
    mockFetch();
    expect(await handleGithubEvent("ping", { zen: "hi" }, env, cfg)).toBe("pong");
    expect(await handleGithubEvent("star", {}, env, cfg)).toBe("ignored event star");
  });
});
