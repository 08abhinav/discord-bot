// Registers the slash commands with Discord. Run after changing
// src/commands.ts: `npm run register`.
//
// Needs DISCORD_BOT_TOKEN in the environment and the guild (server) id as
// DISCORD_GUILD_ID. Guild commands show up immediately; global ones can take
// an hour, so this registers per guild.
import { readFileSync } from 'node:fs';

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !guildId) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID first.');
  process.exit(1);
}

// wrangler.jsonc allows comments, so strip them before parsing.
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const { DISCORD_APPLICATION_ID: appId, REPOS } = config.vars;
const repos = REPOS.split(',').map((r) => r.trim());

const commands = [
  {
    name: 'issues',
    description: 'List open starter issues nobody has claimed yet',
    options: [
      {
        type: 3,
        name: 'repo',
        description: 'Only show one repo',
        required: false,
        choices: repos.map((r) => ({ name: r, value: r })),
      },
    ],
  },
  { name: 'leaderboard', description: 'Show who has the most merged PRs this event' },
];

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
});
if (!res.ok) {
  console.error(`Discord ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`Registered ${(await res.json()).length} commands in guild ${guildId}.`);
