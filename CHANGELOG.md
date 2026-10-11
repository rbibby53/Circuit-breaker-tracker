# Changelog

Notable changes to Circuit Breaker Tracker. Versions follow [semantic versioning](https://semver.org/).

## Unreleased

### Added

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
