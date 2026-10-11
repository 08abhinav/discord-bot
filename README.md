# CODERCOPS Discord bot

The bot behind the open source channels on the [CODERCOPS Discord server](https://discord.gg/mpGdJyjaRQ). It watches our public repos ([chatcops](https://github.com/codercops/chatcops), [ogcops](https://github.com/codercops/ogcops), [toolbelt](https://github.com/codercops/toolbelt)) and keeps contributors in the loop:

- **Releases** go to `#releases` with their notes.
- **Starter issues** (`good first issue` and `help wanted`) go to `#starter-issues`. Each issue gets one message, and the bot edits it when the issue is claimed, freed up or closed, so the channel always shows what's really available.
- **Merged PRs** get a shoutout in `#merged-prs`.
- **`/issues`** lists the open starter issues nobody has claimed yet. **`/leaderboard`** shows who has the most merged PRs in the current event.
- A **weekly leaderboard** is posted while an event such as Hacktoberfest is running, and the final results once it ends.

It runs on Cloudflare Workers. There is no server to keep alive and no Discord gateway connection: Discord and GitHub both call the Worker over HTTPS.

## How it works

| Path | Called by | What happens |
| --- | --- | --- |
| `POST /interactions` | Discord, when someone runs a slash command | The Ed25519 signature is checked, the command is acknowledged right away, and the reply is filled in once GitHub has answered. |
| `POST /github` | GitHub webhooks (`release`, `issues`, `pull_request`) | The HMAC signature is checked, then the event becomes a new or edited Discord message. |
| cron | Cloudflare, Mondays 04:30 UTC and Nov 1 | Posts the leaderboard. |

A small KV namespace remembers which Discord message belongs to which issue and caches the leaderboard for a few minutes.

The code is split so the logic is easy to test:

- `src/verify.ts` checks request signatures.
- `src/webhook.ts` decides what each GitHub event means.
- `src/messages.ts` builds every Discord message. It has no I/O.
- `src/leaderboard.ts` ranks contributors.
- `src/github.ts` and `src/discord.ts` are thin API clients.

## Leaderboard rules

A pull request counts when it was merged inside the event window (UTC), in one of the repos above, and carries the event label (`hacktoberfest-accepted` for Hacktoberfest 2026). Maintainers listed in `EXCLUDED_USERS` don't appear.

People are ranked by how many PRs they got merged. A tie goes to whoever reached that count first. Only contributors with at least `LEADERBOARD_MIN_PRS` merged PRs can be among the `LEADERBOARD_TOP_N` winners, so there can be fewer winners than that.

Everything is in the `vars` block of `wrangler.jsonc`.

## Development

You need Node 24 (see `.nvmrc`).

```bash
npm install
npm run typecheck
npm test
```

The tests don't need Discord, GitHub or Cloudflare. They replace `fetch` and KV with small fakes from `test/helpers.ts`.

To try the Worker locally, put your own secrets in `.dev.vars` (it's gitignored) and run `npm run dev`:

```
DISCORD_BOT_TOKEN=...
GITHUB_WEBHOOK_SECRET=...
```

## Running your own copy

1. Create a Discord application with a bot user and add it to your server with the `bot` and `applications.commands` scopes. It needs View Channels, Send Messages, Embed Links and Read Message History in the channels it posts to.
2. Create a KV namespace with `npx wrangler kv namespace create STATE` and put its id in `wrangler.jsonc`.
3. Fill in the `vars` in `wrangler.jsonc`: your application id and public key, the channel ids, your org and repos.
4. Set the secrets:
   ```bash
   npx wrangler secret put DISCORD_BOT_TOKEN
   npx wrangler secret put GITHUB_WEBHOOK_SECRET
   npx wrangler secret put GITHUB_TOKEN   # optional, raises GitHub's rate limit
   ```
5. `npm run deploy`, then set the Worker's `/interactions` URL as the Interactions Endpoint URL of your Discord application.
6. Register the slash commands: `DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run register`.
7. Add a webhook to each repo that points at the Worker's `/github` URL, with content type `application/json`, your webhook secret, and the `Releases`, `Issues` and `Pull requests` events.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT, see [LICENSE](./LICENSE).

Built by [CODERCOPS](https://www.codercops.com), the chat-first hiring platform for developers.
