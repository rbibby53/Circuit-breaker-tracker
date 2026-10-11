# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

For anything bigger than a small fix, open an issue first so we can agree on the approach.
[docs/PLAN.md](docs/PLAN.md) describes where the project is going.

## Set up

Requirements: Node 22 and pnpm 12 (`npm install -g pnpm@12`; the exact version is pinned in `package.json`).

```sh
pnpm install
pnpm dev     # API on :2757, web on :5173 with a proxy to the API
```

The first visit to <http://localhost:5173> asks you to create the admin account. Data goes to
`apps/server/data/`, which is ignored by git; delete it to start over.

## Before you open a pull request

```sh
pnpm check   # format check, lint, typecheck and tests: the same checks CI runs
pnpm build
```

`pnpm format` fixes formatting. CI also builds the Docker image and checks that it starts.

## Guidelines

- **Access rules live in `packages/core/src/access.ts`.** Any change to who can see or do what
  goes there, with a test in `access.test.ts`, and the server must re-check it on every request.
  Never rely on the UI hiding something.
- **Database changes are new migrations.** Append to the list in
  `apps/server/src/migrations.ts`; never edit one that has shipped.
- **New settings** go in `packages/core/src/settings.ts`. They appear on the Settings page
  automatically and can be pinned with their environment variable.
- **Plain words in the UI.** Say what happened and what to do next. Avoid jargon where a
  homeowner would read it.
- Keep pull requests focused. Screenshots help for anything visual, in light and dark mode.

## Releasing

1. Set the new version in the root `package.json` and move the **Unreleased** notes in
   `CHANGELOG.md` under it.
2. Merge that to `main`, then tag it: `git tag v0.4.0 && git push origin v0.4.0`.
3. The tag publishes `ghcr.io/rbibby53/circuit-breaker-tracker:0.4.0` (plus `0.4` and `latest`
   from `main`) and creates the GitHub release. The app shows that version in its footer and
   under **Settings → About**. Images built from `main` between releases show
   `0.4.0-dev.<commit>`.

## Licence

By contributing you agree that your work is released under the project's
[GPL-3.0 licence](LICENSE).
