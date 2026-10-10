# Circuit Breaker Tracker: plan

A self-hosted web app, shipped as a single Docker container, for drawing your electrical
panels, labelling every breaker, sharing them with the right people and printing a
panel directory as a PDF.

UI mockups: https://claude.ai/artifact/2uQ3SfWmCnL1UuWPbkVchY

## Goals

- Recreate a breaker panel digitally: 1-, 2- and 3-pole breakers, tandems, spares and empty spaces.
- Label what every breaker does and which rooms it serves, including rooms on different floors.
- Flag circuits as **critical** and mark **backup power** (UPS or generator).
- Organise everything as **Site → Floor → Room → Panel**.
- Multiple users with **per-site roles**, running behind a reverse proxy.
- Export print-ready PDFs (Letter by default, A4 optional).
- US panels first (residential load centers and commercial 3-phase panelboards). The data model leaves room for DIN-rail layouts later.

## Stack

TypeScript end to end, so the panel layout and validation rules live in one place and run in
both the browser and the server.

| Part | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite, TanStack Router and Query, dnd-kit | Mature, fast, good drag-and-drop for moving breakers |
| Backend | Fastify on Node 22 | Small, fast, schema-validated routes |
| Database | SQLite (better-sqlite3) with Drizzle ORM and migrations | One file on a volume, easy backups; Drizzle can move to Postgres later if needed |
| Validation | Zod schemas shared by client and server | One definition of what a valid panel is |
| PDF | PDFKit driven by the shared layout engine | Vector output that matches the screen, no headless Chrome (image stays ~150 MB) |
| Auth | Local accounts (argon2id), DB-backed sessions; OIDC later | Works out of the box; SSO can be added without a rewrite |
| Tests | Vitest (core + API), Playwright (one end-to-end smoke test) | |

### Repo layout

```
apps/
  server/      Fastify API, auth, PDF rendering, serves the built web app
  web/         React UI
packages/
  core/        Types, Zod schemas, panel layout engine, validation rules
docs/
Dockerfile
docker-compose.yml
```

## Users, sites and roles

Every request is checked on the server against the site the data belongs to
(breaker → panel → site). People only see sites they are members of.

| Role | Scope | Can |
| --- | --- | --- |
| **Viewer** | One site | See panels, search, print PDFs |
| **Editor** | One site | Viewer + edit breakers, labels and flags; add or remove floors, rooms and panels |
| **Manager** | One site | Editor + invite people, change roles, rename or delete the site |
| **Admin** | Whole install | Everything on every site, manage all users, backups and restore |

How the examples map:

- **KSU building:** you are Admin; your supervisor is Manager (or Editor); coworkers are Viewers.
- **Apartment:** you and your roommates are Editors.
- **Parents' house:** your parents are Viewers on that site only. They never see other sites.
- **You:** Admin on everything.

### Sign-in

- **First run:** a setup screen creates the first Admin. Alternatively, `ADMIN_USERNAME` and
  `ADMIN_PASSWORD` env vars seed it.
- **Accounts:** username or email plus password, hashed with argon2id. Login attempts are rate limited.
- **Sessions:** stored in the database. The cookie is `HttpOnly`, `SameSite=Lax` and `Secure`
  behind HTTPS. Mutating requests also need a custom header, as CSRF protection.
- **Invites:** a Manager or Admin creates a one-time link for a site and role. The link
  expires after 7 days and needs no email server.
- **Later:** OIDC single sign-on (Authentik, Authelia, Keycloak, Entra ID, etc.) and an
  optional trusted-header mode for forward-auth proxies.

### Change history

- Every change is written to an audit log: who, when, and the record before and after.
- Each panel has a **History** view. Admins get a site-wide **Activity log**.
- Panels carry a `version`. If two people edit the same panel at once, the second save gets
  a conflict prompt instead of silently overwriting.

## Data model

```
users           id, username, email, display_name, password_hash, is_admin, disabled, created_at, last_seen_at
sessions        id, user_id, expires_at, created_at, user_agent
invites         token_hash, site_id, role, created_by, expires_at, used_by, used_at
sites           id, name, address, notes
site_members    site_id, user_id, role (viewer | editor | manager)
floors          id, site_id, name, sort_order          -- "Exterior" is just a floor
rooms           id, floor_id, name, sort_order
panels          id, site_id, room_id?, name, layout, spaces, voltage_system, phases,
                main_amps, main_type (main breaker | main lugs), manufacturer, model,
                fed_from_breaker_id?, numbering, notes, version, created_at, updated_at
breakers        id, panel_id, position, slot (full | A | B), poles (1-3), amps,
                protection (standard | gfci | afci | dual), label, notes,
                is_spare, critical, backup (none | ups | generator)
breaker_serves  breaker_id, target_type (room | floor | site), target_id, note
audit_log       id, user_id, site_id, entity, entity_id, action, before, after, at
```

Notes:

- **Serving several rooms:** `breaker_serves` is many-to-many. A breaker can serve rooms on
  any floor of its site, a whole floor, or the whole site (for example, smoke alarms). Each
  link can carry a short note such as "lights" or "bath fan".
- **Tandem breakers:** one space holds two circuits, numbered `21A` and `21B`
  (`slot` = A or B). Quad breakers come later.
- **Sub-panels:** `fed_from_breaker_id` links a sub-panel to the breaker that feeds it, so
  "what does this sub-panel hang off?" can be answered.
- **Space vs spare:** an empty position has no row. A spare is a breaker row with
  `is_spare = true`.

## Panel layouts

| Layout | Use | Rules |
| --- | --- | --- |
| Residential load center | Homes, apartments | 120/240 V split-phase, 2 columns, odd numbers left and even right, 1- and 2-pole, tandems |
| Commercial panelboard | KSU and other commercial buildings | 120/208 V or 277/480 V 3-phase, A/B/C phase per row, 1-, 2- and 3-pole, 30–84 circuits |
| Single column | Small sub-panels, disconnects | Sequential numbering |
| DIN rail (later) | Non-US units | Modules on rails |

The shared `core` package turns a panel and its breakers into positioned boxes. The editor,
the thumbnails and the PDF all draw from that one layout. The validation rules live in
`core` too:

- No two breakers overlap.
- A multi-pole breaker stays in one column.
- 3-pole breakers only go on 3-phase panels, and must land on phases A, B and C.
- Tandems only go in spaces the panel allows.
- Positions must be within the panel's number of spaces.

## API sketch

```
POST   /api/auth/login | /logout          GET /api/auth/me
GET    /api/sites                         (only sites you belong to)
POST   /api/sites   PATCH/DELETE /api/sites/:id
GET    /api/sites/:id/tree                (floors, rooms, panels for the sidebar)
CRUD   /api/sites/:id/floors, /api/floors/:id/rooms
CRUD   /api/sites/:id/members, POST /api/sites/:id/invites, POST /api/invites/:token/accept
GET    /api/panels/:id                    (panel + breakers + serves)
PUT    /api/panels/:id                    (whole-panel save, If-Match: version)
GET    /api/panels/:id/history
GET    /api/panels/:id/pdf?paper=letter|a4&style=sheet|door
GET    /api/sites/:id/pdf                 (every panel in the site, one PDF)
GET    /api/search?q=                     (breakers, rooms, panels across your sites)
GET    /api/admin/backup  POST /api/admin/restore   (JSON, Admin only)
```

## PDF outputs

1. **Panel sheet:** a schedule laid out like the box (odd numbers left, even right).
   Multi-pole breakers are merged into one entry; tandems show A and B. It includes protection
   type, CRIT/UPS/GEN markers as text (grayscale-safe), notes, a key, the last-updated date,
   and a QR code to the panel page. The QR code needs `PUBLIC_URL`.
2. **Door card:** a narrow strip that fits inside the panel door.
3. **Room index:** rooms grouped by floor, with the breakers that feed each one.
4. **Site book:** every panel in a site in one PDF.

## Docker

- A multi-stage `Dockerfile` (build on `node:22`, run on `node:22-slim`). It runs as a
  non-root user, listens on port `8080` and has a `HEALTHCHECK` on `/healthz`.
- A volume at `/data` holds `breakers.db` and the generated session secret.
- An example `docker-compose.yml`, plus notes for Caddy, Nginx and Traefik.
- **Environment:**
  - `PORT`
  - `DATA_DIR`
  - `PUBLIC_URL`
  - `TRUST_PROXY=true`, to honour `X-Forwarded-*`
  - `SESSION_SECRET` (optional, auto-generated otherwise)
  - `ADMIN_USERNAME` / `ADMIN_PASSWORD` (optional bootstrap)
- **Optional:** a GitHub Action that publishes the image to GHCR.

## Milestones

1. **Foundation**
   - pnpm workspace, Docker image and compose file, database and migrations.
   - Auth: first-run admin, login, sessions.
   - Roles and site membership, invites.
   - Site, floor and room management. Sites screen and Users & access screen.
   - Audit log plumbing.
2. **Panel editor (residential)**
   - Layout engine.
   - Add, edit, move and resize breakers: 1- and 2-pole, tandem, spare.
   - Flags. A "serves" picker that spans floors.
   - Validation, autosave and undo, conflict detection, panel history.
3. **Commercial 3-phase**
   - Phase labels, 3-pole breakers, 277/480 V, 42/84 circuits.
   - Sub-panel feed links.
4. **PDF export:** panel sheet, door card, room index, site book, QR code.
5. **Quality of life**
   - Search.
   - Admin backup and restore.
   - Duplicate a panel.
   - CSV export.
   - OIDC sign-in.

Later: DIN-rail layout, quad breakers, load calculations, custom tags, photo attachments.
