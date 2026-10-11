// Which Discord member is which GitHub user. A member creates the link with
// /link and removes it with /unlink. This is everything we store about them.
import type { Env } from "./config";

export interface AccountLink {
  discordId: string;
  githubLogin: string;
  /** GitHub's numeric user id, which survives a rename. */
  githubId: string;
  linkedAt: string;
}

const byDiscord = (discordId: string) => `link:discord:${discordId}`;
const byGithub = (login: string) => `link:github:${login.toLowerCase()}`;

export function getLink(env: Env, discordId: string): Promise<AccountLink | null> {
  return env.STATE.get<AccountLink>(byDiscord(discordId), "json");
}

export function getLinkByGithub(env: Env, login: string): Promise<AccountLink | null> {
  return env.STATE.get<AccountLink>(byGithub(login), "json");
}

/** Saves a link. A member has one GitHub account and a GitHub account belongs to one member, so older links on either side go. */
export async function saveLink(env: Env, link: AccountLink): Promise<void> {
  const [previous, other] = await Promise.all([getLink(env, link.discordId), getLinkByGithub(env, link.githubLogin)]);
  if (previous && previous.githubLogin.toLowerCase() !== link.githubLogin.toLowerCase()) {
    await env.STATE.delete(byGithub(previous.githubLogin));
  }
  if (other && other.discordId !== link.discordId) {
    await env.STATE.delete(byDiscord(other.discordId));
  }
  const value = JSON.stringify(link);
  await Promise.all([env.STATE.put(byDiscord(link.discordId), value), env.STATE.put(byGithub(link.githubLogin), value)]);
}

/** Deletes a member's link and returns what it was, or null when there was none. */
export async function removeLink(env: Env, discordId: string): Promise<AccountLink | null> {
  const link = await getLink(env, discordId);
  if (!link) return null;
  await Promise.all([env.STATE.delete(byDiscord(discordId)), env.STATE.delete(byGithub(link.githubLogin))]);
  return link;
}

/** Lowercased GitHub login to Discord id, for the logins that are linked. */
export async function linkedMembers(env: Env, logins: string[]): Promise<Map<string, string>> {
  const links = await Promise.all(logins.map((login) => getLinkByGithub(env, login)));
  const map = new Map<string, string>();
  for (const link of links) {
    if (link) map.set(link.githubLogin.toLowerCase(), link.discordId);
  }
  return map;
}
