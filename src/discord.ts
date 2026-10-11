import type { Env } from "./config";

const API = "https://discord.com/api/v10";

export interface Embed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
  timestamp?: string;
}

export interface MessagePayload {
  content?: string;
  embeds?: Embed[];
  /** 64 = ephemeral (only the person who ran the command sees it). */
  flags?: number;
  allowed_mentions?: { parse: string[] };
}

// The bot never pings anyone: usernames in messages are GitHub logins, not Discord users.
const NO_MENTIONS = { parse: [] as string[] };

async function botRequest<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://github.com/codercops/discord-bot, 0.1.0)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Discord ${res.status} for ${method} ${path}`);
  }
  return (await res.json()) as T;
}

/** Posts a message and returns its id. */
export async function sendMessage(env: Env, channelId: string, payload: MessagePayload): Promise<string> {
  const message = await botRequest<{ id: string }>(env, "POST", `/channels/${channelId}/messages`, {
    ...payload,
    allowed_mentions: NO_MENTIONS,
  });
  return message.id;
}

export async function editMessage(
  env: Env,
  channelId: string,
  messageId: string,
  payload: MessagePayload
): Promise<void> {
  await botRequest(env, "PATCH", `/channels/${channelId}/messages/${messageId}`, {
    ...payload,
    allowed_mentions: NO_MENTIONS,
  });
}

/** Fills in a deferred interaction response. Uses the interaction token, not the bot token. */
export async function editInteractionReply(env: Env, interactionToken: string, payload: MessagePayload): Promise<void> {
  const res = await fetch(`${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, allowed_mentions: NO_MENTIONS }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status} editing interaction reply`);
}
