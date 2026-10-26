# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

For anything bigger than a small fix, open an issue first so we can agree on the approach.
[docs/PLAN.md](docs/PLAN.md) describes where the project is going, and
[docs/architecture.md](docs/architecture.md) how the code fits together.

## Set up

Requirements: Node 24 (22 or newer works) and pnpm 12 (`npm install -g pnpm@12`; the exact version is pinned in `package.json`).

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
- **Keep the docs true.** A change people will notice (a setting, a screen, an API endpoint)
  updates the guide in `docs/` that describes it in the same pull request. New settings belong
  in `docs/configuration.md`, and routes API tokens can read in `docs/api.md`.
- Keep pull requests focused. Screenshots help for anything visual, in light and dark mode.

## Releasing

Versions follow [semantic versioning](https://semver.org/): a fix is 1.0.1, a new feature is
1.1.0, and anything that breaks existing setups or data is 2.0.0. Add notes for each change
under **Unreleased** in `CHANGELOG.md` as you go.

Releases are automated. To make one:

1. Run `pnpm release patch` (or `minor`, `major`, or an exact version such as `1.2.0-rc.1`).
   It sets the version in every `package.json` and moves the **Unreleased** notes under a
   `## 1.1.0 — <date>` heading.
2. Open a pull request with that change and merge it.

The **Release** workflow sees a version on `main` with no release yet, and:

- tags the merge commit `v1.1.0` and creates the GitHub release, with that version's
  changelog section as its notes;
- publishes `ghcr.io/rbibby53/circuit-breaker-tracker:1.1.0`, plus `1.1`, `1` and `latest`.
  A pre-release such as `1.2.0-rc.1` gets only its own tag and is marked as a pre-release.

If a release fails part way (say the image push), fix the cause and run **Release** from the
Actions tab: it finishes what is missing. Every merge to `main` also publishes `edge`, which
shows `<version>-dev.<commit>` in the footer.

## Licence

By contributing you agree that your work is released under the project's
[GPL-3.0 licence](LICENSE).
