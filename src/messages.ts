// Pure functions that turn GitHub data into Discord messages. No I/O here, so
// everything in this file is easy to unit test.
import type { Config } from "./config";
import type { Embed, MessagePayload } from "./discord";
import type { StarterIssue } from "./github";
import type { Leaderboard } from "./leaderboard";

const COLOR = { open: 0x2ea043, claimed: 0x8b949e, done: 0x8957e5, release: 0x1f6feb, merged: 0x8957e5, gold: 0xd4a72c };

// Discord's limits: embed title 256, embed description 4096.
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// Markdown characters in a title would otherwise change how the line renders.
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>\[\]()])/g, "\\$1");
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function releaseMessage(repo: string, release: { name: string | null; tag_name: string; body: string | null; html_url: string }): MessagePayload {
  const name = release.name?.trim() || release.tag_name;
  const title = name.toLowerCase().includes(repo.toLowerCase()) ? name : `${repo} ${name}`;
  return {
    embeds: [
      {
        title: truncate(title, 256),
        url: release.html_url,
        description: truncate(release.body?.trim() || "No release notes.", 3500),
        color: COLOR.release,
      },
    ],
  };
}

export type StarterState = { kind: "open" } | { kind: "claimed"; by: string } | { kind: "done" };

export function starterIssueMessage(issue: StarterIssue, state: StarterState): MessagePayload {
  const labels = issue.labels.join(", ");
  const status =
    state.kind === "open"
      ? "Open. Comment on the issue to claim it (one issue at a time)."
      : state.kind === "claimed"
        ? `Claimed by ${escapeMarkdown(state.by)}.`
        : "Done.";
  return {
    embeds: [
      {
        title: truncate(`${issue.repo} #${issue.number}: ${issue.title}`, 256),
        url: issue.url,
        description: `${labels}\n${status}`,
        color: COLOR[state.kind],
      },
    ],
  };
}

export function mergedPrMessage(
  pr: { repo: string; number: number; title: string; url: string; login: string },
  /** How many counted PRs the author has in the leaderboard window, when known. */
  countInWindow?: { count: number; label: string }
): MessagePayload {
  let description = `**${escapeMarkdown(pr.login)}** got a PR merged in **${pr.repo}**: [${escapeMarkdown(truncate(pr.title, 200))}](${pr.url})`;
  if (countInWindow && countInWindow.count > 0) {
    description += `\nThat's their ${ordinal(countInWindow.count)} merged PR for ${countInWindow.label}.`;
  }
  return { embeds: [{ description, color: COLOR.merged }] };
}

export function leaderboardMessage(board: Leaderboard, cfg: Config, opts: { final?: boolean; limit?: number } = {}): MessagePayload {
  const { title, minPrs, topN, reward, label } = cfg.leaderboard;
  const shown = board.rows.slice(0, opts.limit ?? 10);
  const lines = shown.map((row, i) => {
    const prs = `${row.count} merged ${row.count === 1 ? "PR" : "PRs"}`;
    const note = row.winner ? (opts.final ? " · winner" : " · in the top " + topN) : row.qualifies ? " · qualifies" : "";
    return `${i + 1}. **${escapeMarkdown(row.login)}** · ${prs}${note}`;
  });
  const winners = board.rows.filter((r) => r.winner);

  let description: string;
  if (lines.length === 0) {
    description = "No merged PRs counted yet. Pick a starter issue and be the first.";
  } else {
    description = lines.join("\n");
    if (opts.final) {
      description +=
        winners.length > 0
          ? `\n\nCongratulations to ${winners.map((w) => `**${escapeMarkdown(w.login)}**`).join(", ")}. We'll reach out on GitHub about your ${reward}.`
          : `\n\nNobody reached ${minPrs} merged PRs this time. Thank you to everyone who contributed.`;
    }
  }

  const embed: Embed = {
    title: opts.final ? `${title} leaderboard: final results` : `${title} leaderboard`,
    description: truncate(description, 4000),
    color: COLOR.gold,
    footer: {
      text: `Top ${topN} with at least ${minPrs} merged PRs labeled ${label} get ${reward}. Ties go to whoever got there first.`,
    },
    timestamp: board.generatedAt,
  };
  return { embeds: [embed] };
}

export function starterIssuesReply(cfg: Config, issuesByRepo: { repo: string; issues: StarterIssue[] }[]): MessagePayload {
  const perRepo = Math.max(3, Math.floor(12 / Math.max(1, issuesByRepo.length)));
  const embeds: Embed[] = issuesByRepo.map(({ repo, issues }) => {
    // A comma between quoted labels means "any of these" in GitHub search.
    const labelFilter = cfg.starterLabels.map((l) => `"${l}"`).join(",");
    const listUrl = `https://github.com/${cfg.org}/${repo}/issues?q=${encodeURIComponent(`is:issue is:open no:assignee label:${labelFilter}`)}`;
    const lines = issues
      .slice(0, perRepo)
      .map((i) => `[#${i.number}](${i.url}) ${escapeMarkdown(truncate(i.title, 90))}`);
    const more = issues.length > perRepo ? `\n[and ${issues.length - perRepo} more](${listUrl})` : "";
    return {
      title: `${repo}: ${issues.length} open starter ${issues.length === 1 ? "issue" : "issues"}`,
      url: listUrl,
      description: lines.length ? lines.join("\n") + more : "Nothing unassigned right now. Check back soon.",
      color: COLOR.open,
    };
  });
  return {
    content: "Comment on an issue on GitHub to claim it. One issue at a time, please.",
    embeds,
  };
}
