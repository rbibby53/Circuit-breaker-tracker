# Circuit Breaker Tracker: plan

A self-hosted web app, shipped as a single Docker container, for drawing your electrical
panels, labelling every breaker, sharing them with the right people and printing a
panel directory as a PDF.

UI mockups: https://claude.ai/artifact/2uQ3SfWmCnL1UuWPbkVchY

## Goals

- Recreate a breaker panel digitally: 1-, 2- and 3-pole breakers, tandems, spares and empty spaces.
- Label what every breaker does and which rooms it serves, including rooms on different floors.
- Flag circuits as **critical** and mark **backup power** (UPS or generator).
- Organise everything as **Company → Site → Building → Floor → Room**, with panels placed in rooms.
- Multiple users with **roles scoped to any level** of that tree, running behind a reverse proxy.
- Export print-ready PDFs (Letter by default, A4 optional).
- US panels first (residential load centers and commercial 3-phase panelboards). The data model leaves room for DIN-rail layouts later.

## Stack

TypeScript end to end, so the panel layout and validation rules live in one place and run in
both the browser and the server.

| Part       | Choice                                                      | Why                                                                              |
| ---------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Frontend   | React + Vite, TanStack Router and Query, dnd-kit            | Mature, fast, good drag-and-drop for moving breakers                             |
| Backend    | Fastify on Node 22                                          | Small, fast, schema-validated routes                                             |
| Database   | SQLite (better-sqlite3) with plain SQL migrations           | One file on a volume, easy backups; the tree queries are hand-written SQL anyway |
| Validation | Zod schemas shared by client and server                     | One definition of what a valid panel is                                          |
| PDF        | PDFKit driven by the shared layout engine                   | Vector output that matches the screen, no headless Chrome (image stays ~150 MB)  |
| Auth       | Local accounts (argon2id), DB-backed sessions; OIDC later   | Works out of the box; SSO can be added without a rewrite                         |
| Tests      | Vitest (core + API), Playwright (one end-to-end smoke test) |                                                                                  |

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

## Users, locations and scoped roles

### The location tree

Everything lives in one tree of locations:

```
Company → Site → Building → Floor → Room
```

Panels are placed in a room. Examples:

```
Personal (company)
  Home (site)               ← single-building sites hide the Building level in the UI
  Apartment (site)
  Parents' house (site)
KSU (company)
  [Campus] (site)
    [Building A] (building)
      Basement → Electrical room
      Floor 1, Floor 2
    [Building B] (building)
```

### Grants

Access is a list of **grants**. Each grant gives one person one role on one location.

- A grant covers that location **and everything inside it**, and nothing outside it.
- A person can hold several grants. At any location, the strongest role from that location
  or any location above it wins.
- Grants only ever add access. There are no "deny" rules, so who sees what stays easy to reason about.
- Everyone can see the names of the locations above their grant, so the breadcrumb makes
  sense. They can't see sibling locations or what's inside them.
- Every request is checked on the server: breaker → panel → room → … → company.

**Read-only visibility beyond a grant.** Some things outside a person's scope are shown
read-only, so they can find the right breaker:

- **Feed chain:** anyone who can see a panel can also see everything upstream of it, all the
  way to the service: each feeding panel's name and location, and the feeder breaker's
  number, label and amps. They don't see the rest of those upstream panels.
- **Breakers serving my location:** anyone who can see a room, floor or building can see the
  breakers that serve it (label, number, panel name and location), even when the panel sits
  outside their scope.

| Role        | Can                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| **Viewer**  | See panels, search, print PDFs                                                                                  |
| **Editor**  | Viewer + edit breakers, labels and flags; add, rename or remove locations and panels inside their scope         |
| **Manager** | Editor + invite people and manage grants, **only inside their own scope** and **only up to their invite limit** |
| **Admin**   | A user-level flag, not a grant. Everything, everywhere: all companies, all users, backups and restore           |

**Invite limit.** Every Manager grant carries a limit: _Viewers only_, _Viewers and editors_,
or _Up to managers_. A Manager can only:

- grant access at locations inside their own Manager scope;
- hand out roles up to their invite limit;
- give new Manager grants an invite limit no higher than their own;
- see and edit grants, people and activity inside their scope, but not their own grant.

How the examples map:

| Who            | Grant                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| You            | Admin                                                                                                                            |
| KSU supervisor | Manager on **KSU** (company), invite limit _Viewers and editors_. They can add coworkers anywhere in KSU and never see Personal. |
| Coworkers      | Viewer or Editor on the KSU campus, one building, or one floor                                                                   |
| A contractor   | Viewer on a single room, e.g. one electrical room                                                                                |
| Roommates      | Editor on **Personal › Apartment**                                                                                               |
| Parents        | Viewer on **Personal › Parents' house**                                                                                          |

### View as user

Admins can **View as** any user, from the Users & access screen or a user's profile:

- The app re-renders with exactly that user's permissions: the same tree, panels, search
  results and PDFs.
- A banner names the user and has an **Exit view** button.
- The view is **read-only**. Edits are disabled in the UI and the server rejects every write
  while viewing as someone else.
- The session stores `acting_as_user_id`. Start and stop are written to the audit log.
- Later: Managers could get the same preview, limited to people and locations inside their
  own scope.

### Sign-in

- **First run:** a setup screen creates the first Admin. Alternatively, `ADMIN_USERNAME` and
  `ADMIN_PASSWORD` env vars seed it.
- **Two ways to sign in, both on at once:**
  - **Microsoft Entra ID (OIDC)** for KSU and other work accounts. Set `OIDC_ISSUER`,
    `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and an optional button label. The login page
    shows "Sign in with Microsoft". Uses the authorization-code flow with PKCE, and any
    standard OIDC provider works the same way.
  - **Local accounts** for family, roommates and anyone else: username or email plus
    password, hashed with argon2id. Login attempts are rate limited.
- **One user, many logins:** a user can have a password, an Entra identity, or both. Entra
  identities are matched by the token's `oid`/`sub`, never by email alone. An Admin can link
  or unlink identities.
- **Access still comes from grants:** signing in with Entra does not give access to
  anything by itself; the person still needs a grant or an invite. Later, an Entra group
  could map automatically to a grant.
- **Password resets:** no email server is needed. An Admin, or a Manager for people inside
  their scope, creates a one-time reset link.
- **Sessions:** stored in the database. The cookie is `HttpOnly`, `SameSite=Lax` and `Secure`
  behind HTTPS. Mutating requests also need a custom header, as CSRF protection.
- **Invites:** a Manager or Admin creates a one-time link for a location, role and invite
  limit. The link expires after 7 days and needs no email server. The person accepting it
  either creates a local password or signs in with Microsoft. Inviting someone who already
  has an account just adds a grant.
- **Later:** TOTP two-factor for local accounts, and an optional trusted-header mode for
  forward-auth proxies.

### Change history

- Every change is written to an audit log: who, when, and the record before and after.
- Each panel has a **History** view. Managers and Admins get an **Activity log** filtered to
  their scope.
- Panels carry a `version`. If two people edit the same panel at once, the second save gets
  a conflict prompt instead of silently overwriting.

## Data model

```
users           id, username, email, display_name, password_hash?, is_admin, disabled, created_at, last_seen_at
user_identities user_id, provider (e.g. entra), issuer, subject, email, linked_at
sessions        id, user_id, acting_as_user_id?, expires_at, created_at, user_agent
reset_tokens    token_hash, user_id, created_by, expires_at, used_at
locations       id, parent_id?, kind (company | site | building | floor | room), name,
                sort_order, path (materialised ancestor ids, e.g. "/1/4/9/"), details (JSON:
                address, notes), is_default_building
grants          id, user_id, location_id, role (viewer | editor | manager),
                invite_limit (viewer | editor | manager, managers only), created_by, created_at
                -- unique (user_id, location_id)
invites         token_hash, location_id, role, invite_limit, created_by, expires_at, used_by, used_at
panels          id, location_id (a room), name, layout, spaces, voltage_system, phases,
                main_amps, main_type (main breaker | main lugs), manufacturer, model,
                fed_from_breaker_id?, numbering, notes, version, created_at, updated_at
breakers        id, panel_id, position, slot (full | A | B), poles (1-3), amps,
                protection (standard | gfci | afci | dual), label, notes,
                is_spare, critical, backup (none | ups | generator)
breaker_serves  breaker_id, location_id (room | floor | building | site), note
audit_log       id, user_id, location_id, entity, entity_id, action, before, after, at
```

Notes:

- **One locations table.** Using one table instead of five keeps grants, invites, the "serves"
  links and the audit log pointing at a single `location_id`. The parent → child kinds are
  enforced (company → site → building → floor → room). The materialised `path` makes
  "everything inside X" and "everything above X" one indexed query each.
- **Hidden building level.** Adding a floor straight to a site (as you would for a home)
  creates one default building behind the scenes. The UI hides it until a second building
  is added. Sites built from buildings (a campus) never get a stray default building.
- **Serving several locations:** `breaker_serves` is many-to-many. A breaker can serve rooms
  on any floor or building of its site, a whole floor, a whole building or the whole site
  (for example, smoke alarms). Each link can carry a short note such as "lights" or "bath fan".
- **Tandem breakers:** one space holds two circuits, numbered `21A` and `21B`
  (`slot` = A or B). Quad breakers come later.
- **Sub-panels:** `fed_from_breaker_id` links a sub-panel to the breaker that feeds it. That
  works across buildings, e.g. a campus feeder.
- **Space vs spare:** an empty position has no row. A spare is a breaker row with
  `is_spare = true`.

## Panel layouts

| Layout                  | Use                                | Rules                                                                                     |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Residential load center | Homes, apartments                  | 120/240 V split-phase, 2 columns, odd numbers left and even right, 1- and 2-pole, tandems |
| Commercial panelboard   | KSU and other commercial buildings | 120/208 V or 277/480 V 3-phase, A/B/C phase per row, 1-, 2- and 3-pole, 30–84 circuits    |
| Single column           | Small sub-panels, disconnects      | Sequential numbering                                                                      |
| DIN rail (later)        | Non-US units                       | Modules on rails                                                                          |

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
GET    /api/auth/oidc/start | /callback
POST   /api/admin/view-as/:userId   DELETE /api/admin/view-as
GET    /api/locations                     (the tree, pruned to what you can see)
POST   /api/locations   PATCH/DELETE /api/locations/:id
GET    /api/locations/:id/grants          (direct + inherited, plus grants further inside)
POST   /api/locations/:id/grants   PATCH/DELETE /api/grants/:id
POST   /api/locations/:id/invites  POST /api/invites/:token/accept
GET    /api/users                         (Admin: everyone; Manager: people in their scope)
GET    /api/panels/:id                    (panel + breakers + serves)
PUT    /api/panels/:id                    (whole-panel save, If-Match: version)
GET    /api/panels/:id/history
GET    /api/panels/:id/pdf?paper=letter|a4&style=sheet|door
GET    /api/locations/:id/pdf             (every panel under a site, building or floor)
GET    /api/search?q=                     (breakers, locations, panels you can see)
GET    /api/activity?location=        (audit log within your scope)
GET    /api/admin/backup  POST /api/admin/restore   (JSON, Admin only)
```

## PDF outputs

1. **Panel sheet:** a schedule laid out like the box (odd numbers left, even right).
   Multi-pole breakers are merged into one entry; tandems show A and B. It includes protection
   type, CRIT/UPS/GEN markers as text (grayscale-safe), notes, a key, the last-updated date,
   and a QR code to the panel page. The QR code needs `PUBLIC_URL`.
2. **Door card:** a narrow strip that fits inside the panel door.
3. **Room index:** rooms grouped by floor, with the breakers that feed each one.
4. **Book:** every panel under a site, building or floor in one PDF.

## Docker

- A multi-stage `Dockerfile` (build on `node:22`, run on `node:22-slim`). It runs as a
  non-root user, listens on port `2757` and has a `HEALTHCHECK` on `/healthz`.
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
   - Auth: first-run admin, local login, sessions, Entra ID / OIDC sign-in, reset links.
   - Location tree (company → room), scoped grants with invite limits, invites.
   - Permission checks with tests for every scope rule.
   - View as user (read-only).
   - Sites screen and Users & access screen.
   - Audit log plumbing.
2. **Panel editor (residential)**
   - Layout engine.
   - Add, edit, move and resize breakers: 1- and 2-pole, tandem, spare.
   - Flags. A "serves" picker that spans floors.
   - Validation, autosave and undo, conflict detection, panel history.
   - Read-only feed-chain and "serves my location" visibility, with tests.
3. **Commercial 3-phase**
   - Phase labels, 3-pole breakers, 277/480 V, 42/84 circuits.
   - Sub-panel feed links.
4. **PDF export:** panel sheet, door card, room index, site book, QR code.
5. **Quality of life**
   - Search.
   - Admin backup and restore.
   - Duplicate a panel.
   - CSV export.
   - TOTP two-factor for local accounts.

Later: DIN-rail layout, quad breakers, load calculations, custom tags, photo attachments.
