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
  LEADERBOARD_TITLE: string;
  LEADERBOARD_LABEL: string;
  LEADERBOARD_START: string;
  LEADERBOARD_END: string;
  LEADERBOARD_MIN_PRS: string;
  LEADERBOARD_TOP_N: string;
  LEADERBOARD_REWARD: string;
}

export interface Config {
  org: string;
  repos: string[];
  starterLabels: string[];
  /** Lowercased GitHub logins that never get a shoutout or a leaderboard row. */
  excludedUsers: Set<string>;
  leaderboard: {
    title: string;
    label: string;
    start: Date;
    end: Date;
    minPrs: number;
    topN: number;
    reward: string;
  };
}

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function getConfig(env: Env): Config {
  return {
    org: env.GITHUB_ORG,
    repos: list(env.REPOS),
    starterLabels: list(env.STARTER_LABELS).map((l) => l.toLowerCase()),
    excludedUsers: new Set(list(env.EXCLUDED_USERS).map((u) => u.toLowerCase())),
    leaderboard: {
      title: env.LEADERBOARD_TITLE,
      label: env.LEADERBOARD_LABEL,
      start: new Date(env.LEADERBOARD_START),
      end: new Date(env.LEADERBOARD_END),
      minPrs: Number(env.LEADERBOARD_MIN_PRS),
      topN: Number(env.LEADERBOARD_TOP_N),
      reward: env.LEADERBOARD_REWARD,
    },
  };
}
