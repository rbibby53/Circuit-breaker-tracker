# Security

Circuit Breaker Tracker holds account details and a map of where things are in a building, so
security reports are taken seriously.

## Reporting a problem

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/rbibby53/Circuit-breaker-tracker/security/advisories/new),
not in a public issue. Include what you found, how to reproduce it and the version (shown at the
bottom of every page). You should get a reply within a week.

## Supported versions

| Version | Supported                                                     |
| ------- | ------------------------------------------------------------- |
| 1.x     | Yes. Fixes ship as a new 1.x release (`latest` and `1` tags). |
| 0.x     | No. Upgrade to 1.x; it updates your data automatically.       |

Please update to the latest release before reporting.

## Running it safely

- Put it behind HTTPS (a reverse proxy) if it is reachable from outside your network, and set
  **Settings → General → Public address** to the `https://` address.
- Under **Settings → Network and security**, only trust proxy headers from your proxy's address.
- Backups from **Settings → Backup** contain password hashes and account details. Store them
  privately.
