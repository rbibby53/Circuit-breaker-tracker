# Changelog

Notable changes to Circuit Breaker Tracker. Versions follow [semantic versioning](https://semver.org/).

## Unreleased

## 1.4.0 — 2026-10-26

### Added

- **API tokens for scripts** (under **Account → API tokens**): a read-only token lets a script
  fetch the panel CSV or JSON you see in the browser, which also works for single sign-on
  accounts. A token sees only what its owner can see, cannot change anything or reach
  accounts and settings, and can expire. Each shows when it was last used, and admins see
  and revoke everyone's under **Settings → Sign-in**, where **Allow API tokens** turns them
  off. See "Scripts and API tokens" in the README for a Python example.

### Changed

- The Docker image applies Debian's latest security updates when it is built and no longer
  ships `npm` or `corepack`, which the server never uses and which carried most of the
  image's known vulnerabilities.

### Upgrading

- One database update runs on start: it adds a table for API tokens.

## 1.3.2 — 2026-10-25

### Changed

- The Docker image now runs on Debian 13 (trixie) instead of Debian 12 (bookworm), still on
  Node.js 24 LTS. Your data volume and settings carry over unchanged.
- Dependencies updated to their latest releases, which also clears known advisories in
  libraries the server uses (`fast-uri`, `ip-address`).

## 1.3.1 — 2026-10-13

### Added

- **Switching cubes** for campuses that run their own grid: a new kind under **+ Add a
  transformer, switching cube or disconnect**, with its voltage (kV is understood, e.g.
  12.47 kV) and rating. Feed a building's transformer or main switchboard from it and say which
  **way** (position) it comes off. Building pages show a **Campus feed** card with the cube and
  way they tie back to, cube pages list the **Buildings fed**, and the power path and map label
  the way.
- **Meters:** a register of your own meters (**+ Add a meter** on a location, panel, breaker,
  cube or transformer, and **Meters** from the Equipment page). Each has a meter number, make,
  model, serial, CT and PT ratios, multiplier and communication (Modbus, BACnet, pulse) with its
  address, and measures a breaker (a meter fed from a breaker), a panel's main, or a device.
  Search finds meters by name, number or serial.
- **Meter field checks:** verify a meter (or mark it wrong) from its page or in field mode,
  which now lists the panel's meters above its circuits. Checks record who and when.
- **Who verified what** (from **Field verification** on a site or building): every circuit and
  meter check with who did it and when, newest first, with a count per person, filtered by
  place, person and result.

### Upgrading

- One database update runs on start: the device table is rebuilt once (same rows) so new kinds
  need no rebuild, and tables and columns are added for meters and feed ways.

## 1.3.0 — 2026-10-13

The biggest release yet, from a list gathered from several people documenting large campuses:
transformers and switchboards, connected load and capacity, an equipment register, field work
on a phone (offline too), shutdown impact and spreadsheet import. Upgrading is automatic: the
database is updated when the new image starts. Your daily backups are in `/data/backups`, or
download one under Settings → Backup first.

### Added

- **Transformers, disconnects, UPSs and the utility service** as items of their own, under
  **Transformers and disconnects** on a site or building page:
  - transformers with kVA and primary and secondary voltage; fused or non-fused disconnects
    with amps and fuse size; UPSs with kVA and runtime; the utility service with its meter;
  - each is fed from a breaker or from another of them, and panels can be fed from them;
  - the power path, power flow map, PDFs, CSV, public page and search show the step, e.g.
    HA 480 V → T-LDP1 (75 kVA · 480 V → 120/208 V) → LP-1A.
- **Switchboards and motor control centers.** New layouts that list units numbered 1, 2A,
  2B… (up to 200), each with frame, trip, poles, feeder wire and conduit; MCC buckets add the
  starter size, motor HP and control type. They print as a unit list.
- **Panels with sections.** Up to 6 sections in one panel (**Panel settings → Sections**),
  each numbered from 1 and optionally fed through lugs, for double-tub panels and more than
  84 spaces. Circuits read "S2 · 1 + 3 + 5", and each section prints as its own table.
- **Panel nameplate:** AIC/SCCR, bus rating separate from the main, mounting, enclosure, and
  feeder wire and conduit.
- **Transfer switch duty** (emergency, legally required or optional standby; NEC
  700/701/702), transition type and priority. **Generators** record fuel tank size and
  runtime, and list the switches they serve.
- **Connected load.** Each breaker records its load in VA and an optional demand factor;
  when labels or notes already say "1200 VA" or "1.5 kVA", the panel offers to **Fill them
  in**. Each panel shows load per phase in VA and amps, the imbalance, and connected and
  demand totals.
- **Capacity check.** Demand below each panel, through sub-panels and transformers, against
  the main or bus, the feeder breaker and the nearest transformer or UPS. 80% and over is
  flagged.
- **Voltage warnings** for a feed at another voltage with no transformer between, transformer
  voltages that don't match, 3-pole breakers on single-phase panels, and equipment rated for
  another voltage.
- **Equipment register** (**Equipment** in the menu): AHU-1, EF-2, RTU-3… with type, HP,
  voltage, room and the breaker or disconnect feeding it. Searching a tag shows what feeds it.
- **Room links from labels.** Building and site pages suggest which room a breaker serves
  when its label names a room number, to accept in bulk.
- **Field verification.** Mark circuits verified or wrong, recording who and when; filter the
  panel by check; see progress by site, building and panel.
- **Select several** breakers to set amps, poles, tags or the field check at once, or move a
  range of them.
- **Shutdown impact.** **What loses power?** on a breaker, panel, transformer or disconnect
  lists everything downstream: panels, equipment, relays, rooms and critical circuits. Panels on
  their own transfer switch and loads on a UPS show as staying up. Copy it as text.
- **Import from a spreadsheet** (**Import from a spreadsheet** on a location, or in Panel
  settings): paste cells or choose a CSV, match the columns, and review each panel's new,
  changed and removed circuits and any problems by row before saving. Understands "1,3,5",
  "20/1", kVA, tandems, sections and switchboard units, and matches rooms by name or number.
  Blank cells leave existing values alone. This app's own CSV export reads straight back in.
- **Field mode** (**Field mode** on a panel or location): big type, one circuit per row, with
  **Matches** and **Doesn't match** buttons, for walking a panel with a phone.
  - **Save for offline** keeps a building's panels on the phone so field mode opens without
    signal; checks and reports made offline are sent when the connection returns.
- **Discrepancy reports** from field mode or, without signing in, from a panel's public page.
  Open reports show on the panel, on the new **Reports** page and as a count in the menu, and
  editors resolve them with a note.
- **QR door stickers:** a 2-inch square per panel (Avery 22806 on Letter, 51 mm on A4), for
  one panel or every panel in a place.
- **Nested single sign-on groups.** Groups sent as paths (Keycloak's `/Facilities/Electricians`)
  count for the groups above them. The README shows how to send nested groups from Authentik.

### Changed

- QR codes on printouts open field mode when the panel has no public page (they opened the
  editor). Codes already printed keep working.
- The app installs a small service worker for offline use. Signing out clears what it kept.

### Upgrading

- Six database updates run on start (new tables for devices, equipment and reports, and new
  panel and breaker columns). Panels keep their layout and numbering.

## 1.2.0 — 2026-10-12

A map of how power flows through a site or building, and transfer switches as their own items.
Upgrading is automatic. Transfer switch names typed in 1.1 become transfer switches.

### Added

- **Power flow map.** **Power** in the menu, or **Power flow** on a site, building, panel or
  generator, draws where power comes from and where it goes:
  - the utility service, each panel and the sub-panels it feeds (labelled with the feeding
    circuit and its amps), transfer switches with their normal and generator sources,
    generators, and the relay panels switching circuits in each panel;
  - hover, tap or tab to anything to light up its whole path, from the source down to the last
    relay panel, and click to open it;
  - pan, zoom and fit, animated flow (off when your system asks for reduced motion), dark mode,
    and a **List** view for phones and screen readers;
  - badges for panels on backup power and for critical circuits;
  - panels upstream that you cannot see are shown as locked boxes, so the path still makes
    sense without showing what is in them.
- **Transfer switches.** Add automatic (ATS) or manual (MTS) transfer switches on a
  generator's page, with their rating and where they are. Put a panel on one under **Panel
  settings → Backup power**; that list also offers a generator directly. Generator pages list
  each switch and the panels on it, and a panel's history records changes.
- **Power path on panels.** The panel header shows a strip from the utility through each panel
  feeding it, with the circuit it is on, then the generator backing it up and a link to the
  map centred on the panel.

### Changed

- Generator cards show a generator icon. The Backup power hint is read as a description by
  screen readers, not as part of the field's name.

### Upgrading

- Transfer switch names typed under Panel settings in 1.1 become transfer switches (one per
  name and generator, in the first panel's room), and those panels are put on them.

## 1.1.0 — 2026-10-12

Standby generators, lighting relay panels such as nLight, and Authentik sign-in with access from
single sign-on groups. Upgrading is automatic: the database is updated when the new image
starts. Your daily backups are in `/data/backups`, or download one under Settings → Backup first.

### Added

- **Standby generators.** Add a generator to a site or building (Add a generator on its page)
  with its size in kW, fuel, voltage, make, model and notes.
  - Tie a panel to it under **Panel settings → Standby generator**, with the transfer switch
    (e.g. ATS-1). Panels fed from that panel are on the generator too, "through" it.
  - Panels show "On generator GEN-1 (250 kW diesel) through ATS-1", and so do printed panel
    sheets and CSV exports (a new Generator column).
  - Each generator's page lists every panel it backs up, directly or through another panel.
  - Generators appear on their building's page and in search. Changes are in Activity.
- **Lighting relay panels** (nLight and other lighting control systems). Choose **Lighting
  relay panel** when adding a panel.
  - Relays are numbered 1 up in one column, 1- or 2-pole, with a rating, flags, rooms and tags
    like breakers.
  - Each relay records **Fed by circuit** (the breaker, in any breaker panel, whose circuit it
    switches) and its **Control** (nLight zone, channel, schedule, occupancy…).
  - The feeding breaker shows "Switched by RP-1 relay 5". Search finds relays by their control,
    e.g. "zone 3". PDFs and CSV exports (new Fed by, Control and Switched by columns) include it.
  - The panel records its control system (nLight by default) instead of a main breaker.
- **Authentik sign-in, and access from single sign-on groups.**
  - Authentik works as a single sign-on provider. Paste the provider's issuer (the slash at the
    end is kept), and the button reads **Sign in with Authentik**. Keycloak, Authelia and other
    OIDC providers work too, and plain-http issuers on the local network are allowed.
  - **Group access** under Settings → Single sign-on gives everyone in a group a role on a
    location, like a grant. People and Access show it as "from the … group".
  - **Admin groups** make members admins and take it away when they leave; admins made by hand
    are never changed.
  - **Only allow these groups** refuses single sign-on for anyone outside them.
  - People whose groups give them access get an account on their first sign-in, without an
    invite (**Create accounts from groups**, on by default).
  - New settings for the **Groups claim** (nested claims such as `realm_access.roles` work) and
    the **Scopes** to ask for. Groups are read from the ID token, or the user info if needed.
  - People → Manage shows each person's groups as of their last sign-in.

### Changed

- Single sign-on is no longer worded as Microsoft-only. The button text, when not set, comes
  from the issuer: "Sign in with Microsoft", "Sign in with Authentik" or "Single sign-on".
- Updated zod (request validation) to version 4. A few error messages for invalid input are
  worded differently, e.g. "name: Too small: expected string to have >=1 characters".

## 1.0.0 — 2026-10-11

The first stable release. Everything planned for 1.0 is in: scoped access for families and
teams, Microsoft sign-in, residential and 3-phase panels, printing, and the tools to run it
yourself (logs, backups, restore). Upgrading from 0.x is automatic: start the new image on
the same `/data` folder. The database is updated on start, and a daily backup is taken.

**Image tags change with this release:** `latest` is now the newest release (it used to follow
every change on `main`), `1` follows every 1.x release, and `edge` is the development build
from `main`.

### Added

- **Printable breaker labels**, in the panel's Print & export dialog:
  - a **sticker sheet** with one label per circuit (number, label, rating and markers) on
    Avery 5167 (US Letter, 80 per sheet) or Avery L7651 (A4, 65 per sheet). You can skip
    labels already used on a sheet;
  - **label strips** to cut out and stick beside each column of breakers, with a box per space
    at 1" or ¾" spacing so each label lines up with its breaker. Multi-pole breakers span their
    spaces, tandems are split in half, and long columns continue on another strip.
- **Surge protectors in breaker spaces**, such as a Square D SurgeBreaker or Eaton CHSPT2ULTRA.
  - Switch any breaker to **Surge protector** in the breaker details. It keeps its spaces and
    poles.
  - **Built-in breakers (A)** records a combination unit's breaker rating, or 0 for one that
    only protects.
  - In the panel they get an **SPD** badge and a violet edge, and the summary says where they
    are. Surge-only units are not counted as circuits.
  - PDFs mark them **SPD**, CSV exports gain a **Type** column, and history shows the change.
- **Panel summary** under each panel: circuits, spares and free spaces. **Show leg balance**
  (or phase balance on 3-phase panels) adds up breaker ratings on each leg or phase, with a
  note when one carries much more than another. These are ratings, not measured current.
- **Automatic daily backups** to `/data/backups`, at a set hour (03:00 by default) and keeping
  the newest 14. Both are settings (`BACKUP_HOUR`, `BACKUP_KEEP`), and `0` turns them off. A
  backup missed while the server was off runs when it is back. Settings lists the saved
  backups, where you can download one, restore from it (with the usual check first), delete
  it, or **Back up now**.
- **Where you're signed in**, on Your account: each browser, its address, how it signed in
  and when it was last used, with **Sign out** for each one or **Sign out everywhere else**.
  Admins, and managers who look after someone, can **Sign out everywhere** for them from
  People → Manage.
- **Recent log in Settings → Logging:** the last 500 log lines, filtered by level, so the
  container console is not needed.
- **PDFs say who printed them:** "Printed Oct 11, 2026 by Ryan" in every page footer and on the
  book cover, and the name is also stored as the PDF's author.
- **Readable container logs.** One line per event in the container's time zone instead of
  JSON, so the Unraid log viewer is useful:
  - a start-up summary: version, database size and counts, public address, sign-in methods, settings locked by environment variables, and warnings such as half-configured Microsoft sign-in;
  - sign-ins and sign-outs, with how and from where;
  - refused sign-ins and wrong two-step codes, with the reason;
  - every change, as on the Activity page;
  - refused changes, with the message the person saw;
  - errors with their stack.

  The health check is no longer logged every 30 seconds, and per-request lines are now at
  Debug. Link tokens and query strings are never logged. A new **Log format** setting
  (`LOG_FORMAT=json`) keeps JSON for log collectors. A warning appears when requests come
  through a reverse proxy but "Behind a reverse proxy" is off.

- **Set someone's name and email from People.** People → **Manage** now has a Profile section
  with their picture, display name and email (used for their Gravatar). Admins can edit anyone;
  managers can edit the people they could send a reset link to.
- **Microsoft sign-in fills in the email.** Entra ID often sends the address only as the
  sign-in name (`preferred_username`), so that is used when the email claim is missing. Accounts
  without an email get one on their next Microsoft sign-in or when they link Microsoft. An email
  someone already set is never replaced, and one used by another account is never taken.
- **Manage access from the People page.** Each person has a **Manage access** dialog listing
  everywhere they have access, where you can change a role or invite limit, remove access, or
  grant a new location. People can be found by name, username, email or location, and invites
  can be sent from the People page too.
- **Profile pictures from Gravatar.** Add an email under Your account → Profile and your
  Gravatar picture shows in the header, People and Access lists. Initials are shown when there
  is no picture or it cannot load. Admins can turn it off with the new Gravatar setting
  (`GRAVATAR`).
- **Breaker tags** for what a breaker powers, such as Lights, Outlets or Servers. You add them in
  the breaker details, with suggestions from the tags already in use. Header search finds
  breakers by tag, and a "Highlight" bar on each panel dims every breaker without the chosen tag.
  Tags are kept in history, copied with a panel, and included in CSV exports and on public pages.

- **Two-step sign-in** for password accounts with any authenticator app. It comes with ten
  one-time recovery codes. Password reset links still ask for a code, and managers or admins
  can turn it off for someone who lost their phone.
- **Restore from a backup** in Settings → Backup. You see what is in the file first, the
  current data is saved alongside, and older backups are upgraded. No restart is needed.
- **Duplicate a panel** into any room you can edit. Room tags are kept within the same site.
- **Public panel pages from the QR code.** Under Panel settings, a manager can let anyone with
  the QR code see the panel without signing in. It is a read-only, phone-friendly list with a
  breaker search and a "Sign in to edit" button. Printed QR codes point at it while it is on.
  "Make a new link" retires old printouts, and admins can turn public pages off for everyone in
  Settings.
- **Foldable location tree.** Buildings and floors start folded and remember how you left them;
  the way to the selected location always opens. A filter box finds a location by name, and
  there are Expand all / Collapse all buttons.
- **CSV export** of a panel, or of everything under a location, from the Print & export dialog.
  Spreadsheet formulas in labels are neutralised.

- **Commercial 3-phase panelboards.** Pick _Commercial panelboard_ when adding a panel, or switch
  an existing one under Panel settings.
  - Rows are labelled A, B, C on the bus.
  - Breakers can be 1-, 2- or 3-pole. The breaker details show which phases a breaker is on
    and its voltage, e.g. "Phase B C A · 208 V".
  - Spaces come in multiples of 6 so the phases balance, and tandems are refused.
  - New panels start at 42 spaces and 120/208 V. Common voltages are suggested as you type.
  - Printed sheets and door cards get a phase column.

- **Print to PDF.** A Print button on every panel and location offers:
  - a **panel sheet** laid out like the panel;
  - a **door card** to cut out and keep inside the panel door;
  - a **room index** listing the breakers that serve each room, by floor;
  - a **panel book** with a cover, contents, every panel inside a location and its room index.

  Markers print as text, so black-and-white printers are fine. Each sheet has a QR code that
  opens the panel. PDFs come in US Letter or A4 and only include what the reader can see.

- **Printing settings:** default paper size, QR codes on or off, and a note printed at the
  bottom of every page, such as who to call.

- **Settings page for admins.** App name, public address, password sign-in, session length,
  Microsoft / OIDC sign-in (with a connection test and the redirect URI to register), invite and
  reset link lifetimes, defaults for new panels, reverse proxy trust, secure cookies and log level
  are all set in the app and apply without a restart.
- **Download backup** from Settings: a consistent copy of the database, safe to take while the app
  is in use.
- Turning off password sign-in hides the password form from everyone except admins.
- Issue and pull request templates, Dependabot, a release workflow, contributing and security
  guides.

### Changed

- **Phones:**
  - The location tree folds into a "Locations" button at the top of Sites and Access, so the
    page comes first. It folds again after you pick a location.
  - All top menu items fit on screen.
  - Wide tables scroll inside their box instead of making the whole page wider.
  - Panel labels wrap to two lines instead of being cut to "Counter o…". Markers such as
    CRIT sit on their own line under the label.
- **Activity:** grouped by day, with a filter box. Places link to the panel or location, and
  **Show older changes** loads more instead of stopping at 200.
- **Settings:** links at the top jump to each section.
- **Panel page:**
  - Critical and backup-power counts are in the summary line above the panel. The repeated
    stats line under the panel is gone.
  - Spares read "Nothing connected" instead of "Spare" twice.
- **Add a panel:** the unavailable "Single column" option is no longer shown.
- **Faster first load:** the first download is about 350 KB instead of 500 KB. Pages other
  than Sites and sign-in load when opened, and the browser no longer downloads the server's
  validation library.
- The footer shows real version numbers: `1.2.3` for releases and `1.2.3-dev.<commit>` for
  images built from `main`, instead of `vlatest`.
- Development uses pnpm 12.
- The Docker image runs on Node 24, the long-term-support release.
- Docker only needs `PORT` and the `/data` volume. Environment variables still work and now pin
  the matching setting, which shows as locked on the Settings page.
- The Unraid template is down to the port, the data path and the optional first admin.
- Opening a search result for a breaker on the panel you are already viewing selects it.
- Breaker labels have more room on phones.

### Fixed

- After an upgrade, a browser tab opened on the old version reloads itself when it opens a page
  whose code changed, instead of showing an error. The app's page is never cached without
  checking for a newer one, and a missing file is reported as missing.
- Updated `@fastify/static` to 10.1.6, which fixes path-traversal and route-guard bypass
  advisories (GHSA-8pvw-jcv7-9cmj and others). This app does not protect any static files
  behind those guards, but there is no reason to ship them.
- Blank environment variables (as Unraid sends for empty fields) are treated as unset instead of
  stopping the container. Invalid values stop it with a message naming the variable.

## 0.3.0

### Added

- Dark mode (follows the system, or pick one under Account).
- Search from the header (press <kbd>/</kbd>) across locations, panels and breakers.
- Confirmation dialogs, a 404 page and the app version in the footer.
- Unraid template, ESLint and Prettier, Docker image published to GHCR.
- Security headers, an hourly purge of expired sessions and links.

### Changed

- Menus only show what your role can use.
- Panel editor layout works on phones.
- Default port is 2757.

## 0.2.0

- Panel editor for residential load centers: 1-pole, 2-pole and tandem breakers, drag to move,
  autosave with undo and redo, edit conflicts detected.
- Breakers can serve rooms on any floor, a floor, a building or a whole site.
- Critical and backup power (UPS or generator) tags.
- Sub-panels show their feed chain to anyone who can see them.
- Room and floor pages list every breaker serving them.

## 0.1.0

- Locations: Company → Site → Building → Floor → Room.
- Viewer, editor and manager roles granted on any location, with manager invite limits.
- Local accounts and Microsoft Entra ID (OIDC) sign-in.
- Invite and password reset links, view as user, activity log.
- Single Docker container with SQLite.
