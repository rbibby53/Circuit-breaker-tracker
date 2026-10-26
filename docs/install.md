# Install and upgrade

Circuit Breaker Tracker is one Docker container with its data in one SQLite file. It needs a
port and a folder (or volume) for `/data`. Nothing else: no database server, no email server.

- [Docker Compose](#docker-compose)
- [Docker run](#docker-run)
- [Unraid](#unraid)
- [First start](#first-start)
- [Image tags](#image-tags)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Upgrading](#upgrading)
- [Building the image yourself](#building-the-image-yourself)

## Docker Compose

```yaml
# docker-compose.yml
services:
  breakers:
    image: ghcr.io/rbibby53/circuit-breaker-tracker:latest
    restart: unless-stopped
    ports:
      - '2757:2757'
    environment:
      TZ: America/New_York # times in the log, and when daily backups run
    volumes:
      - breakers-data:/data
volumes:
  breakers-data:
```

```sh
docker compose up -d
```

Then open `http://<server>:2757`.

The app listens on port **2757** by default. It spells "BRKR" on a phone keypad, and little
else uses it.

### A folder instead of a named volume

The container runs as user `1000:1000`, not root. A folder you mount must belong to that
user, or the app cannot write its database:

```sh
mkdir -p /srv/breakers && sudo chown -R 1000:1000 /srv/breakers
```

```yaml
volumes:
  - /srv/breakers:/data
```

Named volumes (as in the first example) need nothing extra.

## Docker run

```sh
docker run -d --name breakers --restart unless-stopped \
  -p 2757:2757 -e TZ=America/New_York -v breakers-data:/data \
  ghcr.io/rbibby53/circuit-breaker-tracker:latest
```

To use the host's network instead of port mapping, set the port with `PORT`:

```sh
docker run -d --name breakers --network host -e PORT=2757 -v breakers-data:/data \
  ghcr.io/rbibby53/circuit-breaker-tracker:latest
```

With `--network host`, `-p` mappings are ignored and `PORT` decides where it listens.

## Unraid

A template is in [`unraid/circuit-breaker-tracker.xml`](../unraid/circuit-breaker-tracker.xml).
It uses host networking on port 2757.

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

Your usual appdata backup picks up the folder, and the app keeps its own daily backups inside
it too (see [Backups](configuration.md#backups)).

## First start

The first visit shows a setup screen to create the first admin account. To skip it, for
example in an automated deployment, set both of these. They are ignored once any account
exists, so they are safe to leave in place:

| Variable         | Purpose                                |
| ---------------- | -------------------------------------- |
| `ADMIN_USERNAME` | The first admin's username             |
| `ADMIN_PASSWORD` | Their password: at least 10 characters |

Then, as that admin:

1. **Settings → General → Public address**: the address people use, e.g.
   `https://breakers.example.com`. Invite links, reset links, QR codes and single sign-on all
   use it.
2. **Settings → Network and security**: turn on **Behind a reverse proxy** if there is one.
3. **Settings → Single sign-on**, if you use one. See [Sign-in](sign-in.md).
4. Add your first company and site on the home page, and invite people. See
   [Access and roles](access.md).

Every setting is explained in [Configuration](configuration.md).

## Image tags

Images are published to `ghcr.io/rbibby53/circuit-breaker-tracker` for `linux/amd64` and
`linux/arm64`, so they also run on a Raspberry Pi with a 64-bit OS and on Apple silicon.

| Tag      | What it is                                                         |
| -------- | ------------------------------------------------------------------ |
| `latest` | The newest release. Use this unless you have a reason not to.      |
| `1`      | The newest 1.x release: updates, but never a breaking 2.0.         |
| `1.4`    | The newest 1.4.x release: fixes only.                              |
| `1.4.0`  | Exactly that release.                                              |
| `edge`   | The development build from `main`, between releases. May be rough. |

Pre-releases such as `2.0.0-rc.1` get only their own tag, never `latest`. What changed in each
release is in the [changelog](../CHANGELOG.md).

## Behind a reverse proxy

Point the proxy at port 2757, then:

1. Turn on **Settings → Network and security → Behind a reverse proxy** (or set
   `TRUST_PROXY=true`). Without it, every address in the log is the proxy's, and the log says
   so once.
2. Set **Settings → General → Public address** to the proxy's `https://` address.

With an `https://` public address, sign-in cookies are HTTPS-only automatically (**HTTPS-only
sign-in cookies** → Automatic).

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

Nginx Proxy Manager, SWAG and Traefik need nothing special: a plain HTTP upstream on port 2757.

**HTTPS matters for phones.** Field mode's **Save for offline** only works on HTTPS (or on
`localhost`), because browsers allow offline storage only there.

## Upgrading

Pull the new image and recreate the container:

```sh
docker compose pull && docker compose up -d
```

On Unraid: **Check for updates**, then **Apply update**.

Keep the same `/data` volume. On start, the app updates its database in place, and the log
says which schema it is on. Browsers pick up the new version on their own, including tabs left
open.

A daily backup is already in `/data/backups`. To be extra safe, take one from **Settings →
Backup** first. The changelog's **Upgrading** notes say when a release changes the database.

**Going back to an older version is not supported** once the database has been updated.
Restore the backup taken before the upgrade instead (see
[Backups](configuration.md#backups)).

## Building the image yourself

```sh
docker build -t circuit-breaker-tracker .
```

Or set `build: .` in place of `image:` in the compose file. Building needs only Docker; the
Dockerfile installs everything else.
