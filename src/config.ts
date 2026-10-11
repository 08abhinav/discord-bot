export interface Roadmap {
  /** Stable id, used in storage keys and as the slash command choice value. */
  id: string;
  name: string;
  /** How many days the roadmap has. */
  days: number;
  url: string;
  /** The forum channel that holds each learner's log thread. */
  forum: string;
  /** Forum tag to put on new log threads, if the forum has one for this roadmap. */
  tag?: string;
}

/**
 * A contributor program: a window of time in which merged, labeled PRs are
 * counted and the top contributors get a reward. Every program has its own
 * leaderboard page at /leaderboard/{id}, so past ones stay online.
 */
export interface Program {
  /** Stable id, used in the page URL, in storage keys and as the slash command choice value. */
  id: string;
  title: string;
  /** Repos whose PRs count. */
  repos: string[];
  /** A merged PR counts only when it carries this label. */
  label: string;
  start: Date;
  end: Date;
  minPrs: number;
  topN: number;
  reward: string;
  /** Optional extra line shown with the rules, e.g. who the reward comes from. */
  note: string;
}

/** A program as it is written in wrangler.jsonc. */
export interface ProgramInput {
  id: string;
  title: string;
  /** Only "merged-prs" exists today. Programs of another kind are skipped until someone builds them. */
  kind?: string;
  /** Leave out to count every repo in REPOS. */
  repos?: string[];
  label: string;
  start: string;
  end: string;
  minPrs: number;
  topN: number;
  reward: string;
  note?: string;
}

export interface Env {
  STATE: KVNamespace;

  // Secrets (wrangler secret put ...)
  DISCORD_BOT_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
  /** Optional. Without it GitHub's unauthenticated rate limit applies. */
  GITHUB_TOKEN?: string;

  // Vars (wrangler.jsonc)
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  CHANNEL_RELEASES: string;
  CHANNEL_STARTER_ISSUES: string;
  CHANNEL_MERGED_PRS: string;
  CHANNEL_LEADERBOARD: string;
  GITHUB_ORG: string;
  REPOS: string;
  STARTER_LABELS: string;
  EXCLUDED_USERS: string;
  /** JSON in wrangler.jsonc, so it arrives as an array. A string is accepted too. */
  PROGRAMS: ProgramInput[] | string;
  /** Optional line added to a program's final results post. */
  FINAL_RESULTS_NOTE?: string;
  /** Where this Worker is reachable, without a trailing slash. Used for links in Discord messages. */
  PUBLIC_URL: string;
  /** Invite link shown on the public leaderboard page. */
  DISCORD_INVITE: string;
  /** Where the public page sends people to find an issue. */
  ISSUES_URL: string;
  /** JSON in wrangler.jsonc, so it arrives as an array. A string is accepted too. */
  ROADMAPS: Roadmap[] | string;
  /** Offset of the community's time zone from UTC, in minutes. Decides when a check-in day ends. */
  CHECKIN_UTC_OFFSET_MINUTES: string;
}

export interface Config {
  org: string;
  repos: string[];
  starterLabels: string[];
  /** Lowercased GitHub logins that never get a shoutout or a leaderboard row. */
  excludedUsers: Set<string>;
  /** Oldest first. */
  programs: Program[];
  finalResultsNote: string;
  publicUrl: string;
  roadmaps: Roadmap[];
  checkinUtcOffsetMinutes: number;
}

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const array = <T>(value: T[] | string | undefined): T[] =>
  typeof value === "string" ? (JSON.parse(value) as T[]) : (value ?? []);

export function getConfig(env: Env): Config {
  const repos = list(env.REPOS);
  const programs = array(env.PROGRAMS)
    .filter((p) => (p.kind ?? "merged-prs") === "merged-prs")
    .map(
      (p): Program => ({
        id: p.id,
        title: p.title,
        repos: p.repos ?? repos,
        label: p.label,
        start: new Date(p.start),
        end: new Date(p.end),
        minPrs: p.minPrs,
        topN: p.topN,
        reward: p.reward,
        note: (p.note ?? "").trim(),
      })
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return {
    org: env.GITHUB_ORG,
    repos,
    starterLabels: list(env.STARTER_LABELS).map((l) => l.toLowerCase()),
    excludedUsers: new Set(list(env.EXCLUDED_USERS).map((u) => u.toLowerCase())),
    programs,
    finalResultsNote: (env.FINAL_RESULTS_NOTE ?? "").trim(),
    publicUrl: (env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
    roadmaps: array(env.ROADMAPS),
    checkinUtcOffsetMinutes: Number(env.CHECKIN_UTC_OFFSET_MINUTES ?? 0),
  };
}
