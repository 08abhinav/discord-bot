import type { Config, Env, Program } from "./config";
import type { MergedPr } from "./leaderboard";

export class GithubError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function gh<T>(env: Env, path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub rejects requests without a User-Agent.
    "User-Agent": "codercops-discord-bot",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    throw new GithubError(res.status, `GitHub ${res.status} for ${path.split("?")[0]}`);
  }
  return (await res.json()) as T;
}

export interface StarterIssue {
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
}

interface ApiIssue {
  number: number;
  title: string;
  html_url: string;
  pull_request?: unknown;
  assignees?: { login: string }[];
  labels: (string | { name?: string })[];
}

const labelNames = (labels: ApiIssue["labels"]): string[] =>
  labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean);

/** Open, unassigned issues in one repo that carry any of the starter labels. Newest first. */
export async function listStarterIssues(env: Env, cfg: Config, repo: string): Promise<StarterIssue[]> {
  const seen = new Map<number, StarterIssue>();
  // The issues API ANDs labels together, so ask once per label and merge.
  for (const label of cfg.starterLabels) {
    const query = new URLSearchParams({ state: "open", assignee: "none", labels: label, per_page: "100" });
    const issues = await gh<ApiIssue[]>(env, `/repos/${cfg.org}/${repo}/issues?${query}`);
    for (const issue of issues) {
      if (issue.pull_request) continue;
      const names = labelNames(issue.labels);
      if (names.some((n) => n.toLowerCase() === "blocked")) continue;
      seen.set(issue.number, { repo, number: issue.number, title: issue.title, url: issue.html_url, labels: names });
    }
  }
  return [...seen.values()].sort((a, b) => b.number - a.number);
}

interface SearchResult {
  total_count: number;
  items: { html_url: string; user: { login: string } | null; pull_request?: { merged_at: string | null } }[];
}

/** Every merged PR that counts for a program: labeled, in its repos, merged inside its window. */
export async function searchMergedPrs(env: Env, cfg: Config, program: Program): Promise<MergedPr[]> {
  const { label, start, end } = program;
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const q = [
    "is:pr",
    "is:merged",
    `label:"${label}"`,
    `merged:${iso(start)}..${iso(end)}`,
    ...program.repos.map((r) => `repo:${cfg.org}/${r}`),
  ].join(" ");

  const prs: MergedPr[] = [];
  // The search API returns at most 1000 results (10 pages of 100).
  for (let page = 1; page <= 10; page++) {
    const query = new URLSearchParams({ q, per_page: "100", page: String(page), sort: "created", order: "asc" });
    const result = await gh<SearchResult>(env, `/search/issues?${query}`);
    for (const item of result.items) {
      const mergedAt = item.pull_request?.merged_at;
      if (item.user && mergedAt) prs.push({ login: item.user.login, mergedAt, url: item.html_url });
    }
    if (result.items.length < 100) break;
  }
  return prs;
}

/**
 * How many merged PRs a person has in our repos, at any time. `exceptUrl`
 * leaves one PR out, for the moment right after a merge when GitHub's search
 * index may or may not have it yet.
 */
export async function countMergedPrs(env: Env, cfg: Config, login: string, exceptUrl?: string): Promise<number> {
  const q = ["is:pr", "is:merged", `author:${login}`, ...cfg.repos.map((r) => `repo:${cfg.org}/${r}`)].join(" ");
  const query = new URLSearchParams({ q, per_page: "100" });
  const result = await gh<SearchResult>(env, `/search/issues?${query}`);
  const listed = exceptUrl !== undefined && result.items.some((item) => item.html_url === exceptUrl);
  return result.total_count - (listed ? 1 : 0);
}
