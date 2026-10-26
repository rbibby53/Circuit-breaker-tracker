# API for scripts

Scripts can read panels, breakers, locations and equipment over HTTP with a personal **API
token**. They get the same data the web app shows: the CSV from **Print & export**, the PDFs,
and JSON for panels, search, shutdown impact and the rest.

Tokens are **read-only**. They cannot change anything, and they cannot see accounts, people,
access lists or settings.

- [Get a token](#get-a-token)
- [Make a request](#make-a-request)
- [What a token can read](#what-a-token-can-read)
- [Endpoints](#endpoints)
- [Errors](#errors)
- [Examples](#examples)
- [For admins](#for-admins)

## Get a token

1. Open **Your account** (your name, top right) → **API tokens**.
2. Give it a name that says what uses it, e.g. "SysON export" or "Nightly CSV to SharePoint".
3. Choose when it expires: **30**, **90** or **365** days, or never.
4. Copy the token. **It is shown once.** Only a hash is stored, so if you lose it, revoke it
   and make another.

Tokens start with `cbt_`, so secret scanners (GitHub's included) can spot one that leaked
into code. Each person can have up to 25.

## Make a request

Send the token in an `Authorization` header:

```sh
curl -H "Authorization: Bearer $CBT_TOKEN" https://breakers.example.com/api/panels
```

- Use the same address people use in the browser. Behind a reverse proxy, that is the proxy.
- No cookies and no CSRF header are needed.
- Only `GET` requests are allowed. Anything else returns `403 read_only`.
- Responses are JSON unless the endpoint is a CSV or PDF download.
- Times are ISO 8601 in UTC, e.g. `2026-10-26T11:07:54.731Z`.

**IDs come from the web app's addresses.** A panel at `/panels/12` is panel `12`. A location
at `/?loc=3` is location `3`. Equipment, meters, generators and devices work the same way
(`/equipment/7`, `/meters/4`, `/generators/2`, `/devices/9`). You can also get IDs from
[`/api/locations`](#locations), [`/api/panels`](#panels) or [`/api/search`](#search-tags-and-shutdown-impact).

## What a token can read

A token acts as you, read-only:

- **Your access, nothing more.** It sees exactly what you see. If you are an Editor on one
  building, the token sees that building and nothing else.
- **Access from single sign-on groups** is as of your last sign-in. If your groups change in
  the identity provider, the token picks it up the next time you sign in to the web app.
- **It stops working** when it expires, when you or an admin revoke it, when your account is
  disabled or deleted, or when an admin turns API tokens off.
- **Admin tokens are still read-only**, and still cannot reach accounts, people, access lists,
  invites or settings.

The server allows a fixed list of paths and refuses everything else. A page added in a future
version stays out of reach until it is deliberately added to the list.

## Endpoints

All paths are relative to your app's address, e.g. `https://breakers.example.com`.

The JSON shapes are defined as TypeScript types in
[`packages/core/src/api.ts`](../packages/core/src/api.ts). The type named in each table below
is the one to look up. There is no separate API version: the API changes with the app, and
changes that could affect a script are listed in the [changelog](../CHANGELOG.md).

### Who am I

| Path           | Returns                   |
| -------------- | ------------------------- |
| `/api/auth/me` | `MeResponse`: whose token |

### Locations

| Path                              | Returns                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `/api/locations`                  | `LocationDto[]`: every location you can see, flat, with `parentId`       |
| `/api/locations/<id>/csv`         | CSV of every breaker in every panel under the location                   |
| `/api/locations/<id>/pdf`         | PDF: panel book, room index or QR stickers ([options](#pdf-options))     |
| `/api/locations/<id>/served-by`   | `ServedByItem[]`: breakers that serve this room, floor, building or site |
| `/api/locations/<id>/topology`    | `Topology`: the power flow map's nodes and links                         |
| `/api/locations/<id>/progress`    | `ProgressReport`: field verification progress by building and panel      |
| `/api/locations/<id>/campus-feed` | `CampusFeed`: the switching cube and way a building ties back to         |
| `/api/locations/<id>/room-links`  | `RoomLinkSuggestion[]`: rooms that breaker labels seem to name           |

`kind` is one of `company`, `site`, `building`, `floor`, `room`. Locations with
`access: "breadcrumb"` are the places above your access. They are listed by name only, so
paths make sense, and `role` is `null` on them.

### Panels

| Path                               | Returns                                                               |
| ---------------------------------- | --------------------------------------------------------------------- |
| `/api/panels`                      | `PanelSummary[]`: every panel you can see                             |
| `/api/panels/<id>`                 | `PanelDetail`: the panel with its breakers, feed chain and load       |
| `/api/panels/<id>/csv`             | CSV of the panel's breakers                                           |
| `/api/panels/<id>/pdf`             | PDF: sheet, door card, labels, strips or QR ([options](#pdf-options)) |
| `/api/panels/<id>/history`         | `PanelHistoryItem[]`: every change to the panel                       |
| `/api/panels/<id>/reports`         | `ReportDto[]`: problems reported on the panel                         |
| `/api/panels/<id>/feed-candidates` | `FeedCandidate[]`: breakers that could feed it                        |

`layout` is one of `residential`, `commercial`, `switchboard`, `mcc`, `relay`. Each breaker
in `breakers` has its `position`, `poles`, `amps`, `label`, `serves`, `tags`, what it
`feeds`, and its field check.

### Power equipment

| Path                      | Returns                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `/api/power-devices`      | `PowerDeviceSummary[]`: transformers, disconnects, UPSs, services, switching cubes |
| `/api/power-devices/<id>` | `PowerDeviceDetail`                                                                |
| `/api/generators`         | `GeneratorSummary[]`                                                               |
| `/api/generators/<id>`    | `GeneratorDetail`: with its transfer switches and the panels it backs              |
| `/api/transfer-switches`  | `TransferSwitchDto[]`                                                              |
| `/api/feed-options`       | `FeedOptions`: what could feed a panel or device (`?panel=` or `?device=`)         |

### Equipment and meters

| Path                  | Returns                                             |
| --------------------- | --------------------------------------------------- |
| `/api/equipment`      | `EquipmentDto[]`: AHU-1, EF-2… with what feeds them |
| `/api/equipment/<id>` | `EquipmentDto`                                      |
| `/api/meters`         | `MeterDto[]`                                        |
| `/api/meters/<id>`    | `MeterDto`                                          |

### Search, tags and shutdown impact

| Path                       | Returns                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `/api/search?q=<text>`     | `SearchResponse`: locations, panels, breakers, equipment, meters and devices |
| `/api/tags`                | `TagCount[]`: every breaker tag in use, with how many breakers carry it      |
| `/api/impact?breaker=<id>` | `ImpactReport`: everything that loses power if the breaker is opened         |
| `/api/impact?panel=<id>`   | the same, for a panel's main                                                 |
| `/api/impact?device=<id>`  | the same, for a transformer, disconnect or other device                      |

`/api/impact` needs exactly one of `breaker`, `panel` or `device`, or it returns `400`.
`hidden` counts what loses power in places you cannot see.

### Field checks, reports and activity

| Path                 | Query                                                                                           | Returns                                           |
| -------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `/api/verifications` | `loc=<location id>`, `by=<name>`, `status=verified\|wrong`, `limit` (default 500, at most 2000) | `VerificationLog`: who checked what, newest first |
| `/api/reports`       | `status=all` to include resolved ones                                                           | `ReportDto[]`: open reports                       |
| `/api/activity`      | `locationId`, `limit` (default 100, at most 500), `before=<id>`                                 | `ActivityItem[]`, newest first                    |

`/api/activity` is for managers and admins, as on the Activity page. Anyone else gets `403`.
To page through it, pass the `id` of the last item you got as `before`.

### PDF options

Both PDF endpoints take `paper=letter|a4` (the default comes from Settings) and `download=1`
to get an attachment instead of an inline file.

| Endpoint                  | `style`                                             | Other options                                                                                  |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/api/panels/<id>/pdf`    | `sheet` (default), `door`, `labels`, `strips`, `qr` | `skip=<n>` blank labels to leave on a part-used sheet; `pitch=1\|0.75` strip spacing in inches |
| `/api/locations/<id>/pdf` | `book` (default), `index`, `qr`                     | `skip=<n>`                                                                                     |

### CSV columns

Both CSV endpoints return the same columns as **Print & export**, one row per breaker, and
the app's own spreadsheet import reads them back in:

`Location`, `Panel`, `Circuit`, `Phase`, `Poles`, `Type`, `Amps`, `Load (VA)`, `Demand %`,
`Label`, `Protection`, `Critical`, `Backup power`, `Spare`, `Serves`, `Feeds`, `Fed by`,
`Control`, `Switched by`, `Generator`, `Tags`, `Notes`, `Frame (A)`, `Wire`, `Conduit`,
`Starter`, `HP`

- The file is UTF-8 **with a byte-order mark**, so Excel shows characters such as `›` in
  location paths correctly. In Python, read it with `encoding="utf-8-sig"`; in pandas,
  `pd.read_csv(..., encoding="utf-8-sig")`.
- Lines end with CRLF.
- Yes/no columns (`Critical`, `Spare`) say `Yes` or `No`.
- Text that a spreadsheet would run as a formula (starting with `=`, `+`, `-` or `@`) has a
  `'` in front, so a label like `-SPARE-` reads `'-SPARE-`.

## Errors

Errors are JSON with a short code and a sentence you can show to a person:

```json
{ "error": "forbidden", "message": "API tokens can read places, panels and equipment, not accounts or settings." }
```

| Status | `error`        | Meaning                                                                                            |
| ------ | -------------- | -------------------------------------------------------------------------------------------------- |
| `400`  | `bad_request`  | A query parameter is missing or wrong, e.g. `/api/impact` with none                                |
| `401`  | `unauthorized` | The token is wrong, expired or revoked, or API tokens are turned off                               |
| `403`  | `read_only`    | Anything but `GET`                                                                                 |
| `403`  | `forbidden`    | A path tokens cannot read (accounts, people, access, settings), or activity without manager access |
| `404`  | `not_found`    | It does not exist, **or you cannot see it**. The two look the same on purpose                      |
| `500`  | `server`       | A bug. The container log has the detail                                                            |

A `404` for something you know exists means the token's owner has no access to it. Check by
signing in to the web app as that person, or ask an admin to use **View as**.

## Examples

### Python: save a panel's CSV and read its breakers

Standard library only, so it runs anywhere Python does:

```python
import json
import os
import urllib.request

BASE = "https://breakers.example.com"
TOKEN = os.environ["CBT_TOKEN"]  # keep it out of your code
PANEL = 12  # the number in the panel's address: /panels/12


def get(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req) as res:
        return res.read()


open("panel.csv", "wb").write(get(f"/api/panels/{PANEL}/csv"))  # the same file as Print & export
panel = json.loads(get(f"/api/panels/{PANEL}"))  # or the panel and its breakers as JSON
print(panel["name"], len(panel["breakers"]), "breakers")
```

### Python: every critical circuit in a building

```python
import csv
import io

rows = csv.DictReader(io.StringIO(get("/api/locations/3/csv").decode("utf-8-sig")))
for r in rows:
    if r["Critical"] == "Yes":
        print(r["Panel"], r["Circuit"], r["Label"])
```

### PowerShell: a building's panel book as a PDF

```powershell
$headers = @{ Authorization = "Bearer $env:CBT_TOKEN" }
Invoke-WebRequest -Uri "https://breakers.example.com/api/locations/3/pdf?style=book&paper=letter" `
  -Headers $headers -OutFile "Science Hall panel book.pdf"
```

### curl and jq: what loses power if breaker 481 is opened

```sh
curl -s -H "Authorization: Bearer $CBT_TOKEN" \
  "https://breakers.example.com/api/impact?breaker=481" |
  jq -r '.title, "Panels: \(.panels | map(.name) | join(", "))", "Critical: \(.critical | length)"'
```

### Keeping a token safe

- Read it from an environment variable or a secret store, never from the script itself.
- Make one token per script, named after it, so you can revoke one without breaking the others.
- Pick an expiry. A token that lives for 90 days and is renewed is safer than one that never
  expires.
- **Last used** on **Your account → API tokens** shows when and from which address each token
  was last used. A token you don't recognise, or one used from an address you don't expect,
  should be revoked.

## For admins

- **Settings → Sign-in → Allow API tokens** turns every token off at once, and back on.
  Turning it off does not delete them. Pin it with `ALLOW_API_TOKENS=false`.
- **Settings → Sign-in** also lists everyone's tokens, with when and where each was last used,
  and can revoke any of them.
- Making and revoking a token is recorded in the Activity log.
- Requests made with a token are logged like any other, with the token's name, at the
  `debug` log level.
