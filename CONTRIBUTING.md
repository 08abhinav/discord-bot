# Contributing

Thanks for wanting to help with the bot.

## Before you start

- Check the open issues. If you want to work on one, comment on it and wait until it's assigned to you. One issue at a time, please.
- For something that isn't an issue yet, open one first so we can agree on it.

## Making a change

```bash
git checkout -b fix/my-change
npm install
npm run typecheck && npm test
```

- Keep logic out of the request handlers. Message text lives in `src/messages.ts` and has no I/O, which is why it's easy to test. New behavior needs a test in `test/`.
- The bot never pings people and never posts anything that isn't public on GitHub already. Please keep it that way.
- Never commit tokens or secrets. Local secrets go in `.dev.vars`, which is gitignored.
- Use conventional commit titles (`feat:`, `fix:`, `docs:`, `chore:`), and open the pull request against `main` with `Closes #<issue number>`.

CI runs the typecheck and the tests on every pull request.
