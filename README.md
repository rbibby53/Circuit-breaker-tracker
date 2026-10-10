# Circuit Breaker Tracker

A self-hosted web app for recreating your electrical panels, labelling what every breaker
does, sharing them with the right people, and printing panel directories as PDFs. It runs
as a single Docker container with its data in one SQLite file.

> **Status:** milestone 1 of 5 is done: accounts, single sign-on, the location tree, scoped
> access, invites, view-as and the activity log. The panel editor and PDF export come next.
> See [docs/PLAN.md](docs/PLAN.md) for the whole plan.

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

## Run it

```yaml
# docker-compose.yml
services:
  breakers:
    image: ghcr.io/rbibby53/circuit-breaker-tracker:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
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

Open the app and create the first admin account on the setup screen. To build the image
yourself, use `docker build -t circuit-breaker-tracker .` or set `build: .` in the compose
file.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_URL` | (none) | The address people use, e.g. `https://breakers.example.com`. Used for invite and reset links. Required for SSO. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so client IPs and HTTPS are detected. |
| `COOKIE_SECURE` | `true` if `PUBLIC_URL` is https | Send the session cookie over HTTPS only. |
| `PORT` | `8080` | Port to listen on. |
| `DATA_DIR` | `/data` | Where `breakers.db` lives. Mount a volume here. |
| `SESSION_DAYS` | `30` | How long a sign-in lasts. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | (none) | Create the first admin at startup instead of using the setup screen. Ignored once any user exists. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | (none) | Turn on single sign-on (see below). |
| `OIDC_LABEL` | `Sign in with Microsoft` | Text on the SSO button. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

### Behind a reverse proxy

Point the proxy at port 8080 and set `TRUST_PROXY=true`.

Caddy:

```
breakers.example.com {
  reverse_proxy breakers:8080
}
```

Nginx:

```nginx
location / {
  proxy_pass http://breakers:8080;
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
pnpm dev        # API on :8080 (data in apps/server/data), web on :5173 with a proxy to the API
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
