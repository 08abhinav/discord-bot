// Slash command handlers. The command names and options are registered with
// Discord by scripts/register-commands.mjs; keep the two in sync.
import type { Config, Env } from "./config";
import type { MessagePayload } from "./discord";
import { GithubError, listStarterIssues } from "./github";
import { getLeaderboard } from "./leaderboard";
import { leaderboardMessage, starterIssuesReply } from "./messages";

export interface CommandData {
  name: string;
  options?: { name: string; value?: string | number | boolean }[];
}

export async function runCommand(data: CommandData, env: Env, cfg: Config): Promise<MessagePayload> {
  try {
    switch (data.name) {
      case "issues": {
        const picked = data.options?.find((o) => o.name === "repo")?.value;
        const repos = typeof picked === "string" && cfg.repos.includes(picked) ? [picked] : cfg.repos;
        const issuesByRepo = await Promise.all(
          repos.map(async (repo) => ({ repo, issues: await listStarterIssues(env, cfg, repo) }))
        );
        return starterIssuesReply(cfg, issuesByRepo);
      }
      case "leaderboard":
        return leaderboardMessage(await getLeaderboard(env, cfg), cfg);
      default:
        return { content: "I don't know that command." };
    }
  } catch (err) {
    if (err instanceof GithubError && (err.status === 403 || err.status === 429)) {
      return { content: "GitHub is rate limiting me right now. Try again in a minute." };
    }
    console.error("command failed", data.name, err);
    return { content: "Something went wrong on my side. Try again in a bit." };
  }
}
