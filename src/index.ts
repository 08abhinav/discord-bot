import { listCheckins, localDate, rankStreaks } from "./checkin";
import { runCommand, type CommandData, type CommandUser } from "./commands";
import { getConfig, type Env } from "./config";
import { editInteractionReply, sendMessage } from "./discord";
import { getLeaderboard } from "./leaderboard";
import { GithubError } from "./github";
import { leaderboardMessage, streaksMessage } from "./messages";
import { leaderboardJson, leaderboardPage } from "./page";
import { verifyDiscordRequest, verifyGithubSignature } from "./verify";
import { handleGithubEvent } from "./webhook";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// Discord interaction and response types we use.
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 64;

/** The cron that posts the final results. Must match wrangler.jsonc. */
export const FINAL_RESULTS_CRON = "30 4 1 11 *";

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

interface Interaction {
  type: number;
  token: string;
  data?: CommandData;
  /** Present when the command is run in a server. */
  member?: { nick?: string | null; user: DiscordUser };
}

// Commands that act on a person only work inside the server, so DMs give null.
function commandUser(interaction: Interaction): CommandUser | null {
  const member = interaction.member;
  if (!member) return null;
  return { id: member.user.id, name: member.nick || member.user.global_name || member.user.username };
}

async function handleInteraction(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.text();
  const valid = await verifyDiscordRequest(
    env.DISCORD_PUBLIC_KEY,
    request.headers.get("X-Signature-Ed25519"),
    request.headers.get("X-Signature-Timestamp"),
    body
  );
  if (!valid) return new Response("invalid request signature", { status: 401 });

  const interaction = JSON.parse(body) as Interaction;
  if (interaction.type === PING) return json({ type: PONG });

  if (interaction.type === APPLICATION_COMMAND && interaction.data) {
    const data = interaction.data;
    // Discord wants an answer within 3 seconds. Acknowledge now, then fill in
    // the reply once GitHub has answered.
    ctx.waitUntil(
      (async () => {
        const reply = await runCommand(data, commandUser(interaction), env, getConfig(env));
        await editInteractionReply(env, interaction.token, reply);
      })().catch((err) => console.error("interaction reply failed", err))
    );
    return json({ type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } });
  }

  return json({ error: "unsupported interaction" }, 400);
}

async function handleGithubWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const valid = await verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET, request.headers.get("X-Hub-Signature-256"), body);
  if (!valid) return new Response("invalid signature", { status: 401 });

  const event = request.headers.get("X-GitHub-Event") ?? "";
  try {
    const result = await handleGithubEvent(event, JSON.parse(body), env, getConfig(env));
    return json({ ok: true, result });
  } catch (err) {
    // A 5xx makes the delivery show as failed in GitHub, where it can be redelivered.
    console.error("webhook failed", event, err);
    return json({ ok: false }, 500);
  }
}

// The public leaderboard, as a page for people and as JSON for anything else.
async function handleLeaderboardPage(request: Request, env: Env, asJson: boolean): Promise<Response> {
  const cfg = getConfig(env);
  // Browsers and the edge may reuse the response for five minutes.
  const cache = "public, max-age=300";
  try {
    const board = await getLeaderboard(env, cfg);
    if (asJson) {
      return new Response(JSON.stringify(leaderboardJson(board, cfg)), {
        headers: { "Content-Type": "application/json", "Cache-Control": cache, "Access-Control-Allow-Origin": "*" },
      });
    }
    const self = new URL("/leaderboard", request.url).href;
    const html = leaderboardPage(board, cfg, { issues: env.ISSUES_URL, discord: env.DISCORD_INVITE, self });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": cache,
        // Nothing on the page runs scripts or loads anything but GitHub avatars.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https://github.com https://avatars.githubusercontent.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    });
  } catch (err) {
    const limited = err instanceof GithubError && (err.status === 403 || err.status === 429);
    console.error("leaderboard page failed", err);
    return new Response(limited ? "GitHub is rate limiting us. Try again in a minute." : "The leaderboard is unavailable right now.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" },
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/interactions") return handleInteraction(request, env, ctx);
    if (request.method === "POST" && pathname === "/github") return handleGithubWebhook(request, env);
    if (request.method === "GET" && (pathname === "/leaderboard" || pathname === "/leaderboard.json")) {
      return handleLeaderboardPage(request, env, pathname.endsWith(".json"));
    }
    if (request.method === "GET" && pathname === "/") {
      return json({ name: "codercops-discord-bot", source: "https://github.com/codercops/discord-bot" });
    }
    return new Response("not found", { status: 404 });
  },

  // Weekly: the event leaderboard while the event runs, plus the learning streaks.
  // Once, right after the event: the final results.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const cfg = getConfig(env);
    const now = new Date(controller.scheduledTime);
    const final = controller.cron === FINAL_RESULTS_CRON;
    const { start, end } = cfg.leaderboard;
    const weekAfterEnd = new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000);
    // The final cron repeats every year, so only honor it right after the event.
    const due = final ? now > end && now <= weekAfterEnd : now >= start && now <= end;

    if (due) {
      const board = await getLeaderboard(env, cfg, { fresh: true });
      await sendMessage(env, env.CHANNEL_LEADERBOARD, leaderboardMessage(board, cfg, { final }));
    }

    // The weekly cron also posts the learning streaks, as long as someone
    // checked in during the past week.
    if (!final) {
      const today = localDate(now, cfg.checkinUtcOffsetMinutes);
      const weekAgo = localDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), cfg.checkinUtcOffsetMinutes);
      const ranked = rankStreaks(await listCheckins(env), today);
      if (ranked.some((r) => r.lastDate >= weekAgo)) {
        await sendMessage(env, env.CHANNEL_LEADERBOARD, streaksMessage(cfg, ranked));
      }
    }
  },
} satisfies ExportedHandler<Env>;
