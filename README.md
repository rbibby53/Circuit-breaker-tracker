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
  only up to their limit (_Viewers only_, _Viewers and editors_, or _Up to managers_).
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
      - '2757:2757'
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

Open the app and create the first admin account on the setup screen, then go to **Settings**
to set the public address, reverse proxy, Microsoft sign-in and the rest. To build the image
yourself, use `docker build -t circuit-breaker-tracker .` or set `build: .` in the compose
file.

### Unraid

A template is in [`unraid/circuit-breaker-tracker.xml`](unraid/circuit-breaker-tracker.xml). It uses host networking
on port 2757.

1. In the Unraid terminal, create the data folder and give it to the container's user (uid 1000):
   ```sh
   mkdir -p /mnt/user/appdata/circuit-breaker-tracker && chown -R 1000:1000 /mnt/user/appdata/circuit-breaker-tracker
   ```
2. Save the template where Unraid looks for your own templates:
   ```sh
   curl -fsSL -o /boot/config/plugins/dockerMan/templates-user/my-circuit-breaker-tracker.xml \
     https://raw.githubusercontent.com/rbibby53/Circuit-breaker-tracker/main/unraid/circuit-breaker-tracker.xml
   ```
3. **Docker** tab → **Add Container** → pick **circuit-breaker-tracker** under Template → **Apply**.
4. Open `http://<server-ip>:2757`, create the first admin, then finish setup under **Settings**.

### Configuration

Docker only needs a port and a volume. Everything else is set by an admin on the **Settings**
page and applies without a restart.

| Docker variable                    | Default | Purpose                                                                                            |
| ---------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                             | `2757`  | Port to listen on.                                                                                 |
| `DATA_DIR`                         | `/data` | Where `breakers.db` lives. Mount a volume here.                                                    |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | (none)  | Create the first admin at startup instead of using the setup screen. Ignored once any user exists. |

Any setting can also be pinned with an environment variable. It then wins over the Settings page
and shows there as locked. This suits infrastructure-as-code setups:

| Setting                    | Variable                                                       |
| -------------------------- | -------------------------------------------------------------- |
| App name                   | `APP_NAME`                                                     |
| Public address             | `PUBLIC_URL`                                                   |
| Allow password sign-in     | `ALLOW_LOCAL_LOGIN`                                            |
| Stay signed in for (days)  | `SESSION_DAYS`                                                 |
| Microsoft / OIDC           | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`          |
| SSO button text            | `OIDC_LABEL`                                                   |
| Invite / reset link expiry | `INVITE_DAYS`, `RESET_HOURS`                                   |
| New panel defaults         | `DEFAULT_PANEL_SPACES`, `DEFAULT_MAIN_AMPS`, `DEFAULT_VOLTAGE` |
| Behind a reverse proxy     | `TRUST_PROXY`                                                  |
| HTTPS-only cookies         | `COOKIE_SECURE` (`auto`, `always`, `never`)                    |
| Log level                  | `LOG_LEVEL`                                                    |

### Behind a reverse proxy

Point the proxy at port 2757, then turn on **Settings → Network and security → Behind a reverse
proxy** and set the public address to the proxy's https:// address.

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
   - **Redirect URI:** platform _Web_. The exact value is shown on the Settings page, e.g.
     `https://breakers.example.com/api/auth/oidc/callback`.
2. Under **Certificates & secrets**, create a client secret.
3. In the app, open **Settings → Microsoft / single sign-on** and fill in:
   - **Issuer URL:** `https://login.microsoftonline.com/<directory-tenant-id>/v2.0`
   - **Client ID:** the application (client) ID
   - **Client secret:** the secret value
4. Save, then press **Test connection**.

Signing in with Microsoft does not give access to anything by itself:

- A new person still needs an invite link. They can accept it with Microsoft instead of a
  password.
- Existing local users can link their Microsoft account from **Account**.
- Accounts are matched by the provider's subject ID, never by email.

Local passwords keep working alongside SSO. To make everyone except admins use Microsoft,
turn off **Settings → Sign-in → Allow password sign-in**. Admins always keep their password, so
you cannot lock yourself out.

### Backups

Everything is in `/data/breakers.db`. An admin can download a consistent copy at any time from
**Settings → Backup**, even while people are using the app. To restore, stop the container and
replace `breakers.db` in the data folder with the backup file.

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
