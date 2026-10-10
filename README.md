# Circuit Breaker Tracker

A self-hosted web app for recreating your electrical panels, labelling what every breaker
does, sharing them with the right people, and printing panel directories as PDFs. It runs
as a single Docker container with its data in one SQLite file.

> **Status:** milestones 1 and 2 of 5 are done: accounts, single sign-on, scoped access and the
> panel editor for residential load centers. Commercial 3-phase panels and PDF export come
> next. See [docs/PLAN.md](docs/PLAN.md) for the whole plan.

## What works today

- **Locations:** Company → Site → Building → Floor → Room. For homes, add floors straight
  to the site and the building level stays hidden.
- **Scoped access:** give someone **Viewer**, **Editor** or **Manager** on any location. A
  grant covers everything inside that location, and nothing outside it.
- **Manager invite limits:** a manager can only invite people inside their own scope, and
  only up to their limit (*Viewers only*, *Viewers and editors*, or *Up to managers*).
- **Two ways to sign in:** Microsoft Entra ID (or any OIDC provider), and local accounts
  with passwords for family, roommates and anyone without a work account.
- **Invite and reset links:** one-time links you copy and send yourself, so no email server
  is needed.
- **View as user:** admins can see the app exactly as someone else sees it, read-only.
- **Activity log:** every change is recorded. Managers see the changes inside their scope.
- **Panel editor** for residential load centers (120/240 V split-phase):
  - Odd spaces on the left, even on the right. Click an empty space to add a breaker, drag
    to move it, and pick 1-pole, 2-pole or tandem (21A / 21B).
  - Set amps, protection (standard, GFCI, AFCI, dual function), a **critical** flag,
    **backup power** (UPS or generator) and spare.
  - Tag what each breaker **serves**: rooms on any floor, a whole floor or building, or
    the whole site.
  - Changes save automatically, with undo and redo (Ctrl+Z / Ctrl+Shift+Z). If two people
    edit at once, the second save is refused instead of silently overwriting.
  - **History** shows every change in plain words.
- **Sub-panels:** set which breaker feeds a panel. Anyone who can see a panel also sees
  what feeds it, all the way up to the service, even when the upstream panels are outside
  their access.
- **Breakers serving a room:** each room and floor page lists every breaker that serves it,
  from any panel, including whole-floor and whole-site tags.

## Run it

```yaml
# docker-compose.yml
services:
  breakers:
    image: ghcr.io/rbibby53/circuit-breaker-tracker:latest
    restart: unless-stopped
    ports:
      - "2757:2757"
    environment:
      PUBLIC_URL: "https://breakers.example.com"
      TRUST_PROXY: "true"
    volumes:
      - breakers-data:/data
volumes:
  breakers-data:
```

```sh
docker compose up -d
```

The app listens on port **2757** by default (it spells "BRKR" on a phone keypad, and little
else uses it). To run with the host's network instead of port mapping, and pick any free port:

```sh
docker run -d --name breakers --network host -e PORT=2757 -v breakers-data:/data \
  ghcr.io/rbibby53/circuit-breaker-tracker:latest
```

With `--network host`, `-p` mappings are ignored and `PORT` decides where it listens.

Open the app and create the first admin account on the setup screen. To build the image
yourself, use `docker build -t circuit-breaker-tracker .` or set `build: .` in the compose
file.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_URL` | (none) | The address people use, e.g. `https://breakers.example.com`. Used for invite and reset links. Required for SSO. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so client IPs and HTTPS are detected. |
| `COOKIE_SECURE` | `true` if `PUBLIC_URL` is https | Send the session cookie over HTTPS only. |
| `PORT` | `2757` | Port to listen on. |
| `DATA_DIR` | `/data` | Where `breakers.db` lives. Mount a volume here. |
| `SESSION_DAYS` | `30` | How long a sign-in lasts. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | (none) | Create the first admin at startup instead of using the setup screen. Ignored once any user exists. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | (none) | Turn on single sign-on (see below). |
| `OIDC_LABEL` | `Sign in with Microsoft` | Text on the SSO button. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

### Behind a reverse proxy

Point the proxy at port 2757 and set `TRUST_PROXY=true`.

Caddy:

```
breakers.example.com {
  reverse_proxy breakers:2757
}
```

Nginx:

```nginx
location / {
  proxy_pass http://breakers:2757;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Microsoft Entra ID sign-in

1. In the Entra admin center, go to **App registrations** and choose **New registration**.
   - **Supported account types:** accounts in this organizational directory only.
   - **Redirect URI:** platform *Web*, value `https://breakers.example.com/api/auth/oidc/callback`.
2. Under **Certificates & secrets**, create a client secret.
3. Set the environment variables, then restart:
   ```
   OIDC_ISSUER=https://login.microsoftonline.com/<directory-tenant-id>/v2.0
   OIDC_CLIENT_ID=<application-client-id>
   OIDC_CLIENT_SECRET=<client-secret-value>
   ```

Signing in with Microsoft does not give access to anything by itself:

- A new person still needs an invite link. They can accept it with Microsoft instead of a
  password.
- Existing local users can link their Microsoft account from **Account**.
- Accounts are matched by the provider's subject ID, never by email.

Local passwords keep working alongside SSO.

### Backups

Everything is in `/data/breakers.db`. To take a consistent copy while the app is running:

```sh
docker compose exec breakers node -e "new (require('better-sqlite3'))('/data/breakers.db').backup('/data/backup.db').then(() => console.log('ok'))"
```

Then copy `backup.db` out of the volume.

## Develop

Requirements: Node 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev        # API on :2757 (data in apps/server/data), web on :5173 with a proxy to the API
pnpm test       # unit tests (core access rules) and API tests (server)
pnpm typecheck
pnpm build
```

Layout:

```
packages/core   Shared types, validation schemas and access rules (used by server and web)
apps/server     Fastify API, SQLite, sessions, SSO; serves the built web app
apps/web        React UI
docs/PLAN.md    The plan and milestones
```

The access rules live in `packages/core/src/access.ts` and are covered by
`access.test.ts`. The server re-checks every request against them.

## License

GPL-3.0. See [LICENSE](LICENSE).
