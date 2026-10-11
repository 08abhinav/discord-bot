// Roles a linked member earns with merged pull requests.
import type { Config, Env } from "./config";
import { addMemberRole, getGuildMember, removeMemberRole } from "./discord";

/** Maintainers (EXCLUDED_USERS) can link their account, but the contributor roles aren't for them. */
export const isMaintainer = (cfg: Config, githubLogin: string): boolean => cfg.excludedUsers.has(githubLogin.toLowerCase());

/**
 * Gives the member every tier role their merged PR count has earned and
 * returns the names of the ones they didn't have yet. Does nothing for
 * maintainers and for people who aren't in the server.
 */
export async function grantEarnedRoles(
  env: Env,
  cfg: Config,
  member: { discordId: string; githubLogin: string },
  mergedPrs: number
): Promise<string[]> {
  const { discordId } = member;
  const earned = cfg.roleTiers.filter((tier) => mergedPrs >= tier.minPrs);
  if (!cfg.guildId || earned.length === 0 || isMaintainer(cfg, member.githubLogin)) return [];
  const current = await getGuildMember(env, cfg.guildId, discordId);
  if (!current) return [];

  const granted: string[] = [];
  for (const tier of earned) {
    if (current.roles.includes(tier.role)) continue;
    await addMemberRole(env, cfg.guildId, discordId, tier.role, `${mergedPrs} merged pull requests`);
    granted.push(tier.name);
  }
  return granted;
}

/** Takes the tier roles back, when a member unlinks their GitHub account. */
export async function removeTierRoles(env: Env, cfg: Config, discordId: string): Promise<void> {
  if (!cfg.guildId || cfg.roleTiers.length === 0) return;
  const member = await getGuildMember(env, cfg.guildId, discordId);
  if (!member) return;
  for (const tier of cfg.roleTiers) {
    if (member.roles.includes(tier.role)) {
      await removeMemberRole(env, cfg.guildId, discordId, tier.role, "GitHub account unlinked");
    }
  }
}
