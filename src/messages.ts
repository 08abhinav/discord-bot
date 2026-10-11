// Pure functions that turn GitHub data into Discord messages. No I/O here, so
// everything in this file is easy to unit test.
import type { CheckinRecord, CheckinResult } from "./checkin";
import type { Config, Roadmap } from "./config";
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

// ---- learning check-ins ----

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The first message of a learner's log thread. The mention shows their name but doesn't ping. */
export function checkinThreadIntro(userId: string, roadmap: Roadmap): MessagePayload {
  return {
    content: `<@${userId}>'s log for **${roadmap.name}** (${roadmap.days} days).\nRoadmap: <${roadmap.url}>\n\nEvery \`/checkin\` lands here. Reply with notes, code, screenshots or questions.`,
  };
}

export function checkinPost(input: {
  userId: string;
  roadmap: Roadmap;
  record: CheckinRecord;
  note?: string;
  finished: boolean;
}): MessagePayload {
  const { record, roadmap } = input;
  const headline = input.finished
    ? `**Day ${record.day} of ${roadmap.days}. Finished!**`
    : `**Day ${record.day} of ${roadmap.days}** · ${plural(record.streak, "day")} streak`;
  const note = input.note?.trim();
  // Quote the note line by line so it can't break out of the block quote.
  const quoted = note ? "\n" + truncate(note, 500).split("\n").map((line) => `> ${line}`).join("\n") : "";
  return { content: `${headline} · <@${input.userId}>${quoted}` };
}

/** What the learner sees after running /checkin. Only they can see it. */
export function checkinReply(result: CheckinResult, roadmap: Roadmap, threadId?: string): MessagePayload {
  const thread = threadId ? ` Your log: <#${threadId}>` : "";
  if (result.ok) {
    const { record } = result;
    if (result.finished) {
      return { content: `Day ${record.day} of ${roadmap.days}. You finished **${roadmap.name}**. That took real work, well done.${thread}` };
    }
    const best = record.streak === record.bestStreak && record.streak > 1 ? " That's your best streak so far." : "";
    return {
      content: `Checked in: day ${record.day} of ${roadmap.days} on **${roadmap.name}**. Streak: ${plural(record.streak, "day")}.${best}${thread}`,
    };
  }
  switch (result.reason) {
    case "already-today":
      return { content: `You already checked in today (day ${result.record?.day}). Come back tomorrow, and add anything else in your log thread.${thread}` };
    case "already-finished":
      return { content: `You've already finished **${roadmap.name}**. Pick another roadmap, or help someone who's still on it.${thread}` };
    case "day-out-of-range":
      return { content: `**${roadmap.name}** has days 1 to ${roadmap.days}. Pick a day in that range.` };
    case "day-not-ahead":
      return { content: `Your last check-in was day ${result.record?.day}, so the next one has to be a later day. Leave \`day\` empty to continue from there.` };
  }
}

export function streaksMessage(
  cfg: Config,
  ranked: (CheckinRecord & { live: number })[],
  opts: { limit?: number } = {}
): MessagePayload {
  const embeds: Embed[] = [];
  for (const roadmap of cfg.roadmaps) {
    const rows = ranked.filter((r) => r.roadmap === roadmap.id);
    if (rows.length === 0) continue;
    const lines = rows.slice(0, opts.limit ?? 10).map((r, i) => {
      const progress = r.day >= roadmap.days ? "finished" : `day ${r.day} of ${roadmap.days}`;
      const streak = r.live > 0 ? `${plural(r.live, "day")} streak` : "streak ended";
      return `${i + 1}. **${escapeMarkdown(r.name)}** · ${streak} · ${progress}`;
    });
    embeds.push({ title: roadmap.name, url: roadmap.url, description: lines.join("\n"), color: COLOR.gold });
  }
  if (embeds.length === 0) {
    return { content: "Nobody has checked in yet. Run `/checkin` to start your streak." };
  }
  return { content: "Learning streaks. Check in every day with `/checkin` to keep yours alive.", embeds };
}
