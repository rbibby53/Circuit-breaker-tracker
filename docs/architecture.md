# Architecture

How the code fits together, for anyone changing it. Setting up, checks and pull requests are in
[CONTRIBUTING.md](../CONTRIBUTING.md).

- [The pieces](#the-pieces)
- [A request, start to finish](#a-request-start-to-finish)
- [Access rules](#access-rules)
- [Database and migrations](#database-and-migrations)
- [Settings](#settings)
- [Panels and saving](#panels-and-saving)
- [PDFs and CSV](#pdfs-and-csv)
- [Offline field mode](#offline-field-mode)
- [API tokens](#api-tokens)
- [Tests](#tests)
- [Build and release](#build-and-release)

## The pieces

A pnpm workspace with three packages:

```
packages/core   Shared types, zod schemas, access rules, panel maths. No I/O. Used by both.
apps/server     Fastify API, SQLite (better-sqlite3), sessions, OIDC, PDFs. Serves the built web app.
apps/web        React 19 + React Router + TanStack Query, built with Vite.
```

In production it is one Node process (`node server.mjs`) serving the API under `/api/` and the
web app's static files for everything else, with its data in `$DATA_DIR/breakers.db`.

`packages/core` is the contract between the two: request bodies are validated with its zod
schemas (`schemas.ts`), responses are typed with its interfaces (`api.ts`), and both sides use
the same access rules and panel calculations, so the UI and the server cannot disagree about
what a 3-pole breaker in space 41 means.

| Where                                      | What                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `packages/core/src/access.ts`              | Who can see and do what. [Access rules](#access-rules).                     |
| `packages/core/src/settings.ts`            | Every setting: label, type, default, range, environment variable.           |
| `packages/core/src/panel.ts`               | Layouts, spaces, poles, phases, circuit numbering.                          |
| `packages/core/src/load.ts`, `topology.ts` | Load per phase and demand; the power flow graph.                            |
| `packages/core/src/importer.ts`            | Spreadsheet import: column matching and the change preview.                 |
| `apps/server/src/app.ts`                   | Fastify setup, security headers, the auth hook, route registration.         |
| `apps/server/src/routes/`                  | One file per area: panels, locations, access, auth, admin, devices, meters… |
| `apps/server/src/migrations.ts`            | The database schema, as an append-only list.                                |
| `apps/server/src/pdf/`                     | Panel sheets, door cards, labels, books (pdfkit).                           |
| `apps/web/src/pages/`                      | One component per screen.                                                   |
| `apps/web/src/panel/`                      | The panel editor: grid, inspector, bulk edit, settings.                     |
| `apps/web/src/lib/outbox.ts`               | Offline queue for field checks and reports.                                 |

## A request, start to finish

Every `/api/` request passes one `onRequest` hook in `app.ts`, which decides who is asking:

1. **`Authorization: Bearer cbt_…`** → an [API token](#api-tokens). Read-only, allowlisted
   paths only. No cookie is looked at.
2. **Otherwise, the `cbt_session` cookie** → a browser session (`sessions.ts`). Writes must
   carry the `x-cbt-csrf: 1` header, which browsers cannot add to cross-site requests, so a
   forged form post is refused before it reaches a route.
3. **While an admin is viewing as someone**, writes are refused except leaving that mode and
   signing out.

The route then calls `requireAuth(req)` and builds an `Actor`, loads the location tree and grants
(`AccessData` in `repo.ts`), and checks the action with a function from `access.ts`. Something
the actor cannot see at all is `404`, the same as something that does not exist, so IDs cannot
be probed. `403` is for things they can see but not change.

Errors are thrown as `HttpError` (`errors.ts`) and come back as `{ error, message }`. Messages
are written for people, because the UI shows them as they are.

Every response gets a strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, and
`Cache-Control: no-store` on the API.

## Access rules

All of it is in `packages/core/src/access.ts`, as pure functions over a location's `path` and
the actor's grants:

- `effectiveRole`: the strongest grant on the location or anywhere above it. Admins are `admin`.
- `visibleLocations`: `full` inside a grant, `breadcrumb` for the ancestors (names only).
- `canCreateChild`, `canRenameLocation`, `canDeleteLocation`, `canGrant`, `canManageGrant`,
  `canResetUser`: one function per decision, each returning `{ ok }` or a reason to show.

Two rules for changing them:

1. **The server re-checks every request.** The UI hides what you cannot do, but that is only
   for convenience. A route that forgets the check is a bug even if no button reaches it.
2. **Every change gets a test** in `access.test.ts`.

Upstream panels are deliberately visible to anyone who can see a panel (`feedChain`), and
downstream ones outside your access are counted, not named (`hiddenFeeds`).

## Database and migrations

SQLite in WAL mode, through better-sqlite3 (synchronous, which keeps the code simple and is fast
for this size of data).

`migrations.ts` is an **append-only** list of SQL strings. `schema_version` records how many
have run; on start, the rest run in order, each in a transaction. To change the schema, add a new
entry at the end. **Never edit one that has shipped**: existing databases have already run it.

A migration that rebuilds a table other tables point at starts with the `FOREIGN_KEYS_OFF`
marker. It then runs with foreign keys off and is checked for broken links before it commits.

Restores go through the same migrations, which is how a backup from an older version is
upgraded on the way in.

Note any migration under **Upgrading** in the changelog.

## Settings

A setting is one entry in `SETTING_DEFS` (`packages/core/src/settings.ts`). That entry is all it
takes: the Settings page draws it, the server validates it, its environment variable pins it,
and `SettingsStore` (`apps/server/src/settings.ts`) tells listeners when it changes, so nothing
needs a restart. Read it with `config.settings.get('key')`.

Precedence: environment variable → value saved in the database → default.

## Panels and saving

The editor sends the **whole panel** (`PUT /api/panels/:id`) with the `version` it loaded. If
the stored version is newer, the save is refused with `409`, so two people editing at once never
overwrite each other silently. The server diffs before and after, records the change in the
panel's history and the audit log, and bumps `version` only if something changed. New breakers
carry a `clientKey`, and the response maps them to their new IDs.

## PDFs and CSV

PDFs are drawn with pdfkit on the server (`apps/server/src/pdf/`), from the same `PanelDetail`
the editor shows, so they follow the same access rules. Label sizes are in `labels.ts`.

CSV (`csv.ts`) writes a byte-order mark for Excel, quotes as needed, and prefixes cells that a
spreadsheet would run as a formula. `BREAKER_COLUMNS` is also what the importer recognises, so
an export reads straight back in.

## Offline field mode

**Save for offline** stores a building's panels in the browser (`lib/offline.ts`). Field checks
and reports made without a connection go into an outbox (`lib/outbox.ts`) and are sent when the
browser reports it is online again. Browsers only allow this storage on secure origins, hence
HTTPS.

## API tokens

`apps/server/src/apiTokens.ts`. A token is `cbt_` plus a random string; only its hash is
stored. `loadTokenAuth` turns it into the owner's `AuthState` with `readOnly: true`.

What a token may read is an **allowlist** (`READABLE`), minus access lists and invites
(`UNREADABLE`), minus odd paths (`..`, encoded slashes). A new route is out of reach of tokens
until it is added there on purpose. When you add a read-only route that scripts would want, add
it to `READABLE`, add a case to `apiTokens.test.ts`, and list it in [docs/api.md](api.md).

## Tests

```sh
pnpm test                          # everything
pnpm --filter @cbt/core test       # access rules, panel maths, importer
pnpm --filter @cbt/server test     # the API
```

- **Core** tests are plain unit tests next to the code (`*.test.ts`).
- **Server** tests are in `apps/server/test/`. They build the real app on an in-memory database
  (`helpers.ts`) and call it with `app.inject()`, so they cover routing, the auth hook and access
  checks together.
- CI also builds the Docker image and checks that it starts.

## Build and release

- `apps/server/build.mjs` bundles the server with esbuild into `dist/server.mjs`. better-sqlite3,
  argon2 and pdfkit stay out of the bundle and are installed on their own in the image.
- The `Dockerfile` builds both apps, then copies them onto `node:24-trixie-slim`, running as the
  `node` user (`1000:1000`).
- Releases are automated from a version bump merged to `main`. See
  [Releasing](../CONTRIBUTING.md#releasing).
