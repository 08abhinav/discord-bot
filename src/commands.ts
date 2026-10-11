// Slash command handlers. The command names and options are registered with
// Discord by scripts/register-commands.mjs; keep the two in sync.
import { listCheckins, localDate, rankStreaks, recordCheckin } from "./checkin";
import type { Config, Env } from "./config";
import type { MessagePayload } from "./discord";
import { GithubError, listStarterIssues } from "./github";
import { getLeaderboard } from "./leaderboard";
import { checkinReply, leaderboardMessage, starterIssuesReply, streaksMessage } from "./messages";

export interface CommandData {
  name: string;
  options?: { name: string; value?: string | number | boolean }[];
}

/** Who ran the command. */
export interface CommandUser {
  id: string;
  name: string;
}

export async function runCommand(
  data: CommandData,
  user: CommandUser | null,
  env: Env,
  cfg: Config,
  now: Date = new Date()
): Promise<MessagePayload> {
  const option = (name: string) => data.options?.find((o) => o.name === name)?.value;
  try {
    switch (data.name) {
      case "checkin": {
        if (!user) return { content: "Run this inside the server, not in a DM." };
        const day = option("day");
        const note = option("note");
        const outcome = await recordCheckin(env, cfg, {
          userId: user.id,
          name: user.name,
          roadmapId: String(option("roadmap") ?? ""),
          day: typeof day === "number" ? day : undefined,
          note: typeof note === "string" ? note : undefined,
          now,
        });
        if (!outcome) return { content: "I don't know that roadmap. Pick one from the list." };
        return checkinReply(outcome.result, outcome.roadmap, outcome.threadId);
      }
      case "streaks": {
        const today = localDate(now, cfg.checkinUtcOffsetMinutes);
        return streaksMessage(cfg, rankStreaks(await listCheckins(env), today));
      }
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
