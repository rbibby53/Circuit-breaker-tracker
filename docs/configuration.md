# Configuration

Docker only needs a port and a volume. Everything else is set by an admin on the **Settings**
page, and applies straight away without a restart.

- [Docker variables](#docker-variables)
- [Settings](#settings)
- [Pinning settings with environment variables](#pinning-settings-with-environment-variables)
- [Logs](#logs)
- [Backups](#backups)

## Docker variables

These are read only from the container's environment:

| Variable                           | Default | Purpose                                                                                            |
| ---------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                             | `2757`  | Port to listen on.                                                                                 |
| `DATA_DIR`                         | `/data` | Where `breakers.db` and the `backups` folder live. Mount a volume here.                            |
| `TZ`                               | `UTC`   | Time zone for the log and for when daily backups run, e.g. `America/Chicago`.                      |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | (none)  | Create the first admin at startup instead of using the setup screen. Ignored once any user exists. |

## Settings

Every setting below is on the **Settings** page, grouped the same way. Each can also be
[pinned](#pinning-settings-with-environment-variables) with the variable shown.

### General

| Setting                | Variable     | Default                   | What it does                                                                                                                                 |
| ---------------------- | ------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| App name               | `APP_NAME`   | `Circuit Breaker Tracker` | Shown in the header, browser tabs and sign-in pages.                                                                                         |
| Public address         | `PUBLIC_URL` | (blank)                   | The address people use, e.g. `https://breakers.example.com`. Used in invite and reset links and QR codes, and required for single sign-on.   |
| Show Gravatar pictures | `GRAVATAR`   | on                        | People with a picture on gravatar.com show it instead of initials. Browsers fetch it from Gravatar, which learns a hash of each email shown. |

While the public address is blank, links and QR codes use whatever address each browser used,
and the log says so at start-up.

### Sign-in

| Setting                   | Variable            | Default | What it does                                                                                                                 |
| ------------------------- | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Allow password sign-in    | `ALLOW_LOCAL_LOGIN` | on      | Off makes everyone except admins use single sign-on. Admins always keep their password, so you cannot lock yourself out.     |
| Stay signed in for (days) | `SESSION_DAYS`      | `30`    | 1–365. How long a sign-in lasts. Applies to new sign-ins.                                                                    |
| Allow API tokens          | `ALLOW_API_TOKENS`  | on      | Lets people make read-only [API tokens](api.md). Off stops every token working until it is turned back on; none are deleted. |

### Single sign-on

See [Sign-in](sign-in.md) for setting up Microsoft Entra ID, Authentik and Keycloak.

| Setting                     | Variable               | Default                | What it does                                                                                     |
| --------------------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| Issuer URL                  | `OIDC_ISSUER`          | (blank)                | The provider's issuer.                                                                           |
| Client ID                   | `OIDC_CLIENT_ID`       | (blank)                | From the provider.                                                                               |
| Client secret               | `OIDC_CLIENT_SECRET`   | (blank)                | From the provider. Stored in the database and never shown again.                                 |
| Button text                 | `OIDC_LABEL`           | (blank)                | Text on the sign-in button. Blank picks one from the issuer, e.g. "Sign in with Authentik".      |
| Scopes                      | `OIDC_SCOPES`          | `openid profile email` | Add `groups` for providers that need it, such as Authelia or Keycloak.                           |
| Groups claim                | `OIDC_GROUPS_CLAIM`    | `groups`               | The claim listing someone's groups. Dots for a nested claim, e.g. `realm_access.roles`.          |
| Admin groups                | `OIDC_ADMIN_GROUPS`    | (blank)                | Comma-separated. Members are admins, and stop being admins when they leave.                      |
| Only allow these groups     | `OIDC_ALLOWED_GROUPS`  | (blank)                | Comma-separated. Single sign-on is refused for anyone in none of them.                           |
| Create accounts from groups | `OIDC_CREATE_ACCOUNTS` | on                     | Makes an account on first sign-in when someone's groups give them access, with no invite needed. |

Single sign-on is on once the issuer, client ID, client secret **and** the public address
are all filled in.

**Group access** (a group → a role on a location) is on the same page. It is stored in the
database and has no environment variable.

### Invite and reset links

| Setting                           | Variable      | Default | What it does                                     |
| --------------------------------- | ------------- | ------- | ------------------------------------------------ |
| Invite links last (days)          | `INVITE_DAYS` | `7`     | 1–90. How long a new invite link works.          |
| Password reset links last (hours) | `RESET_HOURS` | `48`    | 1–720. How long a new password reset link works. |

### New panel defaults

Pre-filled when someone adds a panel. People can change them for each panel.

| Setting             | Variable               | Default                 |
| ------------------- | ---------------------- | ----------------------- |
| Spaces              | `DEFAULT_PANEL_SPACES` | `24` (2–84)             |
| Main breaker (amps) | `DEFAULT_MAIN_AMPS`    | `200` (1–4000)          |
| Voltage             | `DEFAULT_VOLTAGE`      | `120/240 V split-phase` |

### Printing and QR codes

| Setting                          | Variable        | Default  | What it does                                                                                             |
| -------------------------------- | --------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Paper size                       | `PAPER_SIZE`    | `letter` | `letter` or `a4`. The size PDFs start with; people can pick the other when they print.                   |
| Print a QR code on each panel    | `PRINT_QR`      | on       | Scanning it opens the panel. Needs the public address.                                                   |
| Allow public panel pages         | `PUBLIC_PANELS` | on       | Lets managers share a panel from its QR code without sign-in. Off makes every QR code ask for a sign-in. |
| Note at the bottom of every page | `PRINT_NOTE`    | (blank)  | For example who to call before working on a panel.                                                       |

### Network and security

| Setting                    | Variable        | Default | What it does                                                                                                 |
| -------------------------- | --------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| Behind a reverse proxy     | `TRUST_PROXY`   | off     | Turn on behind Nginx Proxy Manager, SWAG, Caddy or Traefik, so the app sees real client addresses and HTTPS. |
| HTTPS-only sign-in cookies | `COOKIE_SECURE` | `auto`  | `auto` follows the public address (on when it starts with `https://`), or `always` / `never`.                |

### Logging

| Setting    | Variable     | Default | What it does                                                                    |
| ---------- | ------------ | ------- | ------------------------------------------------------------------------------- |
| Log level  | `LOG_LEVEL`  | `info`  | `error`, `warn`, `info` or `debug`. See [Logs](#logs).                          |
| Log format | `LOG_FORMAT` | `text`  | `text` for log viewers such as Unraid's, `json` for Loki, Graylog and the like. |

### Automatic backups

| Setting                  | Variable      | Default | What it does                                                                                         |
| ------------------------ | ------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| Daily backups to keep    | `BACKUP_KEEP` | `14`    | 0–365. `0` turns automatic backups off.                                                              |
| Time of day (hour, 0–23) | `BACKUP_HOUR` | `3`     | In the container's time zone (`TZ`). Missed while the server was off? It runs as soon as it is back. |

## Pinning settings with environment variables

Any setting can be set with its variable. It then wins over the Settings page and shows there
as locked, which suits infrastructure-as-code setups and lets you keep secrets such as
`OIDC_CLIENT_SECRET` out of the database.

```yaml
services:
  breakers:
    image: ghcr.io/rbibby53/circuit-breaker-tracker:latest
    environment:
      PUBLIC_URL: https://breakers.example.com
      TRUST_PROXY: 'true'
      OIDC_ISSUER: https://auth.example.com/application/o/breakers/
      OIDC_CLIENT_ID: breakers
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
      OIDC_ADMIN_GROUPS: Breaker admins
```

- On/off settings take `true`, `false`, `1`, `0`, `yes`, `no`, `on` or `off`.
- Numbers must be whole and within the range shown above.
- An empty variable counts as not set.
- **A value that is not valid stops the app at start-up**, with a message in the log naming
  the variable and what it must be. Better than starting with a setting you did not mean.

To unpin a setting, remove the variable and recreate the container. The value saved on the
Settings page (or the default) applies again.

## Logs

The container log (Unraid's log viewer, `docker logs`) has one readable line per event, in the
container's time zone (`TZ`):

```
2026-10-11 14:05:09 INFO  Circuit Breaker Tracker 1.1.0 starting · Node v24.21.0 · times in this log are America/Chicago
2026-10-11 14:05:09 INFO  Database /data/breakers.db (1.2 MB, schema 10): 4 people, 31 locations, 6 panels, 212 breakers
2026-10-11 14:05:09 INFO  Sign-in: passwords, Authentik via auth.example.com (admin groups, 2 group access rules) · sessions last 30 days
2026-10-11 14:06:41 INFO  Signed in: ryan (password and two-step code) from 192.168.1.20
2026-10-11 14:07:02 INFO  ryan: Edited panel Main panel: Changed 14 label · Personal › Home › Basement › Utility room
2026-10-11 14:09:15 WARN  POST /api/auth/login → 403 in 98 ms · 192.168.1.31 · Sign-in refused for "sam": wrong password
```

- **Info** (the default) shows the start-up summary, sign-ins and sign-outs, every change (the
  same entries as the Activity page), clean-ups, and any problems with the reason.
- **Debug** adds a line for every request, with who made it: `ryan`, `ryan as sam` while
  viewing as someone, or `ryan's token SysON export` for an [API token](api.md). Health checks
  and static files are never logged.
- Link tokens, API tokens and query strings are never written to the log.
- Set **Log format** to JSON for a log collector.

Both take effect without a restart. **Settings → Logging → Show recent log** lists the last
500 lines, so you can check what happened without opening the container console.

## Backups

Everything is in `/data/breakers.db`.

- **Automatic backups:** a copy is saved every day in `/data/backups`, at 03:00 in the
  container's time zone. The newest 14 are kept. Change both under **Settings → Automatic
  backups**. Each one is logged.
- **Saved backups** are listed under **Settings → Backup**, where you can download one,
  restore from it, or save one now.
- **Download a copy** at any time, even while people are using the app.
- Any file-level backup of the data folder (Unraid appdata backup, restic, Borg…) picks up
  the backups folder as well. The files in `backups` are complete copies; the live
  `breakers.db` may be mid-write, with recent changes still in `breakers.db-wal`.

### Restoring

1. **Settings → Backup**: pick a saved backup, or upload a backup file.
2. The app shows what is in it (people, locations, panels, breakers) before anything changes.
3. Confirm. The current data is saved as `breakers-before-restore-<date>.db` in the data
   folder, then the backup is swapped in without a restart.

Backups from older versions are upgraded on the way in. Everyone is signed out and signs in
with an account from the backup.

To restore by hand instead:

1. Stop the container.
2. Delete `breakers.db-wal` and `breakers.db-shm` from the data folder if they are there. The
   database runs in SQLite's WAL mode, and leftover files from the old database would be
   applied to the new one.
3. Replace `breakers.db` with the backup file, owned by `1000:1000`.
4. Start the container.
