// The public leaderboard page. Pure functions that build HTML and JSON from
// the same ranking the Discord posts use.
import type { Config } from "./config";
import type { Leaderboard, LeaderboardRow } from "./leaderboard";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** What a row's status chip says: where the person stands for the reward. */
export function standing(row: LeaderboardRow, cfg: Config): { text: string; kind: "top" | "qualifies" | "progress" } {
  const { minPrs, topN } = cfg.leaderboard;
  if (row.winner) return { text: `In the top ${topN}`, kind: "top" };
  if (row.qualifies) return { text: "Qualifies", kind: "qualifies" };
  const missing = minPrs - row.count;
  return { text: `${missing} more to qualify`, kind: "progress" };
}

export function leaderboardJson(board: Leaderboard, cfg: Config) {
  const { title, label, start, end, minPrs, topN, reward, note } = cfg.leaderboard;
  return {
    title: `${title} leaderboard`,
    generatedAt: board.generatedAt,
    rules: { label, start: start.toISOString(), end: end.toISOString(), minPrs, topN, reward, note },
    rows: board.rows.map((row, i) => ({
      rank: i + 1,
      login: row.login,
      mergedPrs: row.count,
      qualifies: row.qualifies,
      inTop: row.winner,
    })),
  };
}

const STYLE = `
:root{--bg:#0a0b0f;--raise:#12141a;--line:#1e222b;--fg:#e6e9ef;--muted:#8a93a8;--cyan:#00e5c7;--violet:#9e7bff;--gold:#d4a72c}
@media (prefers-color-scheme:light){:root{--bg:#f7f8fa;--raise:#fff;--line:#e3e6ec;--fg:#14161c;--muted:#5d6678;--cyan:#008c78;--violet:#6b46e5;--gold:#946c00}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 16px 64px}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}
.eyebrow{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--cyan);margin:0 0 14px}
h1{font:700 clamp(28px,6vw,40px)/1.15 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 0 12px}
.lede{color:var(--muted);margin:0 0 32px}
.board{list-style:none;margin:0 0 32px;padding:0;border:1px solid var(--line);border-radius:12px;background:var(--raise);overflow:hidden}
.board li{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--line)}
.board li:first-child{border-top:0}
.rank{width:28px;font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.board img{width:36px;height:36px;border-radius:50%;background:var(--line)}
.who{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who a{color:var(--fg)}
.count{font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.chip{font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.chip.top{color:var(--gold);border-color:var(--gold)}
.chip.qualifies{color:var(--cyan);border-color:var(--cyan)}
.empty{padding:28px 16px;color:var(--muted);text-align:center}
.rules{border:1px solid var(--line);border-radius:12px;padding:20px;background:var(--raise);margin:0 0 24px}
.rules h2{font:600 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
.rules p{margin:0 0 10px}.rules p:last-child{margin:0}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 36px}
.cta a{padding:10px 16px;border-radius:8px;border:1px solid var(--line);background:var(--raise);color:var(--fg);font-weight:600}
.cta a.primary{background:var(--cyan);border-color:var(--cyan);color:#06120f}
footer{color:var(--muted);font-size:13px}
@media (max-width:520px){.chip{display:none}}
`;

export interface PageLinks {
  /** Where to find an issue to work on. */
  issues: string;
  discord: string;
  /** The page's own public URL, for share previews. */
  self: string;
}

export function leaderboardPage(board: Leaderboard, cfg: Config, links: PageLinks): string {
  const { title, label, start, end, minPrs, topN, reward, note } = cfg.leaderboard;
  const heading = `${title} leaderboard`;
  const repos = cfg.repos.join(", ").replace(/, ([^,]*)$/, " and $1");
  const description = `Merged pull requests in ${repos}, ${day(start)} to ${day(end)} (UTC). The top ${topN} with at least ${minPrs} get ${reward}.`;
  const ogImage = `https://og.codercops.com/api/og?${new URLSearchParams({
    template: "github-readme-hero",
    title: heading,
    description: `Top contributors to ${repos}`,
  })}`;

  const rows = board.rows
    .map((row, i) => {
      const login = escapeHtml(row.login);
      const chip = standing(row, cfg);
      return `<li><span class="rank">${i + 1}</span><img src="https://github.com/${encodeURIComponent(row.login)}.png?size=72" alt="" width="36" height="36" loading="lazy"><span class="who"><a href="https://github.com/${encodeURIComponent(row.login)}">${login}</a></span><span class="count">${row.count} merged ${row.count === 1 ? "PR" : "PRs"}</span><span class="chip ${chip.kind}">${escapeHtml(chip.text)}</span></li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(heading)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:url" content="${escapeHtml(links.self)}">
<meta name="twitter:card" content="summary_large_image">
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="eyebrow">CODERCOPS open source</p>
<h1>${escapeHtml(heading)}</h1>
<p class="lede">Merged pull requests in ${escapeHtml(repos)}, ${day(start)} to ${day(end)} (UTC).</p>
${board.rows.length ? `<ol class="board">\n${rows}\n</ol>` : `<div class="board"><p class="empty">No merged pull requests counted yet. Pick an issue and be the first.</p></div>`}
<section class="rules">
<h2>How it works</h2>
<p>A pull request counts when it's merged into one of the repos above during the window and carries the <code>${escapeHtml(label)}</code> label. Only PRs for issues that were assigned to you count.</p>
<p>The top ${topN} contributors with at least ${minPrs} merged PRs get ${escapeHtml(reward)}. Ties go to whoever got there first.</p>
${note ? `<p>${escapeHtml(note)}</p>` : ""}
</section>
<div class="cta">
<a class="primary" href="${escapeHtml(links.issues)}">Find an issue</a>
<a href="${escapeHtml(links.discord)}">Join the Discord</a>
<a href="https://www.codercops.com">Hire developers or get hired</a>
</div>
<footer>Updated <time datetime="${escapeHtml(board.generatedAt)}">${escapeHtml(board.generatedAt.slice(0, 16).replace("T", " "))} UTC</time>. Refreshes every few minutes. <a href="/leaderboard.json">JSON</a></footer>
</main>
</body>
</html>`;
}
