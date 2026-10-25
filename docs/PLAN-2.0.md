# Circuit Breaker Tracker 2.0: live meters over BACnet/IP and BACnet/SC

Status: proposal (October 2026). Answers #40 ("integrate meters to feed data to the system").

Today a meter is a record: make, model, CT and PT ratios, and a protocol and address typed in
as text. 2.0 makes meters **live**: the app talks BACnet/IP and BACnet Secure Connect
(BACnet/SC), finds meters on the building network, reads their values on a schedule, keeps
the history, and uses measured load wherever the app now uses only calculated load.

## Goals

- **Read meters over BACnet/IP and BACnet/SC**, from the container, on the networks campuses
  actually have: one subnet, several subnets joined by BBMDs, and SC hubs.
- **Find and map points without a spreadsheet:** discover devices, browse their objects, and
  map points to a meter's quantities (kW, kWh, amps and volts per phase…). Map one meter model
  once and apply it to every identical meter.
- **Keep history** at a resolution that supports real decisions: a year of 15-minute demand,
  which is what NEC 220.87 asks for when sizing new load on an existing service.
- **Use the data:** measured demand next to calculated demand in the capacity check, live load
  on the power flow map and in shutdown impact, measured phase balance, and alerts.
- **Never disturb the building system.** The app only reads. It is polite on the wire and
  easy for a controls contractor to approve.

## Not in 2.0

- **Writing to BACnet** (commanding points, overrides). The app never sends WriteProperty,
  DeviceCommunicationControl or ReinitializeDevice. This is a design rule, not a gap.
- **Being a BACnet server** for other systems, beyond answering Who-Is so the app shows up in
  BMS tools as the read-only client it is.
- **BACnet MS/TP directly.** It needs RS-485 hardware; reach MS/TP meters through the BACnet
  router most sites already have.
- **Acting as an SC hub.** The app is an SC node that connects to the site's hub. (Direct
  connections, node to node, can come later.)
- **Modbus.** It fits the same pipeline and is the obvious 2.1 (see Suggestions).

## Where the work is hard

| Risk                     | Why                                                                                                                                                                                                                | What we do                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BACnet/SC in Node.js** | No JavaScript BACnet/SC stack exists. `@bacnet-js/client` (3.3.2, MIT, maintained) handles BACnet services well, but its BACnet/IP framing (BVLL) is hard-wired in the client. Only the UDP socket can be swapped. | Write our own SC data link: a WebSocket over TLS 1.3 with client certificates (`ws`, which passes TLS options through), BVLC-SC framing, VMAC addressing, heartbeats and hub failover. Plug it in under the client's NPDU/APDU code: first through a small shim transport, then upstream a proper data-link seam to `bacnet-js/client`. Spike first (phase 0). |
| **Docker networking**    | BACnet/IP discovery uses UDP broadcasts on port 47808, and a default Docker bridge network drops them.                                                                                                             | Support three set-ups, each documented and tested: host networking; a container with its own LAN address (macvlan, or Unraid's `br0`); or bridge networking with **foreign device registration** at the site's BBMD, which needs only unicast.                                                                                                                 |
| **History size**         | 200 meters × 6 points read every minute is 1.7 million rows a day.                                                                                                                                                 | Keep raw samples for a short window only, roll them up into 15-minute and daily intervals, and keep readings in their **own database file**. The main database stays small, and backups and restores stay fast.                                                                                                                                                |
| **Fragile BMS networks** | Older controllers fall over under bursts of requests.                                                                                                                                                              | Rate limits per device and per network, one request at a time per device by default, back-off when a device goes quiet, and ranged Who-Is by default. COV subscriptions are opt-in.                                                                                                                                                                            |
| **Certificates**         | BACnet/SC will not work without correctly issued certificates, and sites run their own CA.                                                                                                                         | Generate the key in the app, download a certificate signing request, upload the signed certificate. Warn well before expiry. Give clear errors that name which certificate, and why.                                                                                                                                                                           |

## How it fits together

```
                          ┌──────────────────────── container ─────────────────────────┐
BMS / BBMD ◄─ UDP 47808 ─ │ B/IP data link ─┐                                          │
                          │                 ├─ BACnet client ─► poller ─► readings.db  │
SC hub ◄─ wss, TLS 1.3 ── │ SC data link ───┘   (read-only)      │   (history)         │
                          │                                      ▼                     │
                          │ breakers.db: connections, devices, points, mappings,       │
                          │              alerts                                        │
                          │       │                                                    │
                          │       ▼                                                    │
                          │ web app and API: live values, charts, capacity,            │
                          │                  power flow, alerts                        │
                          └────────────────────────────────────────────────────────────┘
```

- **One BACnet service in the server process**, started when at least one connection is
  turned on. It runs no extra process, and stops cleanly with the server. BACnet I/O is
  asynchronous UDP and WebSocket, so it does not hold up web requests. Readings are written in
  batches, one transaction per poll cycle.
- **Data links** are interchangeable under one client: BACnet/IP (UDP, with optional foreign
  device registration) and BACnet/SC (WebSocket to the primary or failover hub). A site can
  have several of each.
- **The app is a small BACnet device:** a Device object with a configurable instance number,
  so it answers Who-Is and shows in BMS tools with its name and model. It needs an ASHRAE
  vendor ID, which is free to request (see Decisions).

## Features

### 1. Connections (admins, under Settings → BACnet)

- **BACnet/IP connection:**
  - the local interface and UDP port (47808 by default; another port works for unicast-only
    set-ups);
  - the app's device instance;
  - optionally a BBMD to register with as a foreign device, with its time-to-live and
    automatic re-registration.
- **BACnet/SC connection:**
  - primary and failover hub URIs (`wss://…`);
  - the app's operational certificate and key, and the site CA that peers must chain to (never
    the system's public CAs);
  - a VMAC and device UUID, generated once and kept. The VMAC is changed automatically if
    another node already uses it.
- **Status for each connection:** connected, hub in use (primary or failover), last error,
  devices seen, requests per minute, and certificate expiry.
- **Test connection** runs a ranged Who-Is or connects to the hub, and reports exactly what
  happened.
- Every change goes in the audit log. Like the OIDC client secret, connection settings can be
  pinned with environment variables for infrastructure-as-code set-ups.

### 2. Certificates for BACnet/SC

- **Recommended flow:** the app generates a key pair and a certificate signing request with
  the device UUID in it. The admin has the site's CA sign it, then uploads the certificate.
  The private key never leaves the container.
- **Also allowed:** upload a key and certificate (PEM or PKCS#12) issued elsewhere.
- **Key storage:** the private key is a file in `/data/bacnet/` with owner-only permissions. It
  is not stored in the database, so it never ends up in a downloaded backup. After a restore
  on new hardware, the app asks for a new key and certificate.
- **Expiry and rotation:** warnings at 30 and 7 days before expiry, on the Settings page and
  in the log. Rotation works the same way as the first set-up, without dropping the connection
  until the new certificate is in place.
- **TLS:** 1.3 only, with the cipher suites Annex AB allows. Both ends are checked against the
  configured CA.

### 3. Discovery and browsing (admins, and editors where a connection is shared with them)

- **Devices list:** find devices with a ranged Who-Is (a full Who-Is only when asked). Each
  shows its instance, name, vendor, model, network and address, and when it was last seen. A
  device can be pinned so it is never forgotten, or hidden.
- **Objects:** browse a device's objects. The object list is read item by item on large
  devices. Each object shows its name, type, units, current value and status flags. Filters
  pick out what looks like metering: kW, kWh, A, V, PF, Hz.
- **Metering points only:** reading is limited to analog inputs and values, accumulators,
  multistate inputs and the Device object.

### 4. Mapping points to meters (editors at the meter's location)

- A meter gets a **BACnet source:** a device on a connection. Its **points** map BACnet
  objects to quantities:
  - demand: kW, kVA, kvar;
  - energy: kWh delivered and received;
  - A and V per phase;
  - power factor and frequency.
    Each point also has an optional scale and offset, and its own poll interval.
- **Units are checked:** the object's BACnet units must suit the quantity (W or kW for
  demand, for example), or the mapping says why it doesn't. Units are converted (W to kW).
- **Templates:** save one meter's mapping as a template for that make and model, matched by
  object names or instance numbers. Apply it to every identical meter on a campus in one step,
  with a review screen like spreadsheet import.
- **Suggested matches:** the device's vendor, model and object names suggest a template, and
  suggest which existing meter record a device is. For example, a meter whose serial number
  matches the device's.
- The meter's CT and PT ratios and multiplier stay as nameplate facts. They are only applied
  to a point when it is marked as reporting raw, unscaled values.

### 5. Polling

- **Batched reads:** ReadPropertyMultiple, with one request covering every point on a device.
  It falls back to ReadProperty for devices that do not support it, which the app learns from
  the device's list of supported services.
- **Intervals:** 1 minute by default, adjustable from 15 seconds to 15 minutes per point. Each
  device's polls are spread out so they don't all land on the same second.
- **COV (opt-in per device):** SubscribeCOV with a fixed lifetime. Subscriptions are renewed
  before they lapse and cancelled when the app stops. Polling stays on as a safety net.
- **Politeness:**
  - at most one outstanding request per device, and N per network;
  - a cap on requests per second for each connection;
  - exponential back-off for unreachable devices;
  - a device that has gone quiet is marked offline instead of being retried constantly.
- **Read-only guard:** the client may only send an allowlist of services (Who-Is, I-Am,
  ReadProperty, ReadPropertyMultiple, SubscribeCOV and its cancellation, ReadRange). Anything
  else throws, and a unit test keeps it that way.
- **Quality:** each reading keeps the object's status flags (fault, overridden, out of
  service). Readings with fault or out-of-service flags are stored but left out of demand
  rollups.

### 6. History (`/data/readings.db`)

- **Raw samples** are kept for 7 days by default.
- **Rollups:**
  - 15-minute intervals with minimum, maximum and average (and the energy delta for kWh), kept
    for 25 months by default, so a full year is always available for NEC 220.87;
  - daily rollups, kept until deleted.
- **Rollups are computed as readings arrive**, and recomputed for a time window if late
  readings fill a gap. A counter that resets or rolls over is detected, and is never counted
  as a negative or huge energy delta.
- **Storage:** retention is configurable. The database runs in WAL mode, and old data is
  cleared with the hourly housekeeping job the app already has.
- **Backups:** the daily backup copies `breakers.db` as today. `readings.db` is backed up on
  its own schedule (weekly by default) because it is larger and less critical.
- **Restores:** a restore takes either file, or both. A 2.0 backup is a zip holding both
  files plus a manifest, and 1.x `.db` backups still restore.

### 7. Using the data

- **Meter page:**
  - live values with their age and quality;
  - charts for 24 hours, 7 days, 30 days and a year: demand (kW) and energy (kWh) per
    interval, with the 15-minute peak marked;
  - CSV export of any range.
- **Capacity check:**
  - the measured peak (15-minute) shows beside calculated demand for every metered panel,
    transformer and service;
  - an **NEC 220.87 view:** a year's highest 15-minute demand × 125% against the rating,
    which shows the spare capacity for new load. It is shown only when a full year of data
    exists. The note says to confirm with the authority having jurisdiction (AHJ).
- **Phase balance:** measured amps per phase beside the breaker-based estimate.
- **Power flow map and shutdown impact:** live kW on metered feeders, and "about N kW is
  lost if this is opened".
- **Alerts:**
  - load above 80% of a rating (the threshold the app already uses);
  - a meter offline for longer than N minutes;
  - readings stuck at one value, or out of range;
  - certificates about to expire.
    Alerts show in the app, with a filtered list. Email or webhook notices are under
    Suggestions.
- **Field mode:** when someone verifies a meter, the BACnet value at that moment is saved with
  the check. A meter whose display disagrees with what BACnet reports can be flagged.
- **API:** tokens can read live values and history, for example a year of 15-minute demand as
  CSV or JSON, so a SysON model or a spreadsheet can use it (#46).

## Data model (main database)

```
bacnet_connections  id, kind ('ip' | 'sc'), name, enabled, settings JSON (port, BBMD,
                    hub URIs, VMAC, UUID…), cert_expires_at, status, last_error, …
bacnet_devices      id, connection_id, instance, network, address, name, vendor, model,
                    services_supported, pinned, hidden, last_seen_at, online
meter_sources       meter_id → device_id (one BACnet device per meter; a device may feed
                    several meter records, e.g. a multi-circuit meter)
meter_points        id, meter_id, quantity, object_type, object_instance, property,
                    array_index, units, scale, offset, interval_s, cov, raw_values,
                    last_value, last_at, last_status, last_error
point_templates     id, name, vendor, model, points JSON
alerts              id, kind, subject (meter/panel/device/connection), opened_at,
                    closed_at, detail
```

`readings.db`: `samples(point_id, at, value, flags)` and `intervals_15m` and `intervals_day`
`(point_id, start, min, max, avg, delta, count)`, all `WITHOUT ROWID` with `(point_id, at)`
primary keys, so each point's history is stored together and is quick to read.

## Breaking changes (why this is 2.0)

BACnet itself is additive: a site that never turns it on works as before. Four things change
for existing set-ups:

1. **The meter address model.** The free-text `address` is replaced by a structured source
   and points. The update copies each old address into a **legacy address** note on the
   meter, so nothing is lost; where it is readable (for example `device 12345`), it pre-fills
   the BACnet device to confirm. `GET /api/meters` changes shape. That breaks scripts written
   against 1.4 tokens, so the upgrade notes say so.
2. **The backup format.** Backups become a zip holding both databases. 1.x backups still
   restore into 2.0, but 2.0 backups cannot go back to 1.x.
3. **A published, versioned API.** 2.0 publishes an OpenAPI description of the endpoints
   tokens can read and commits to them. From then on, changing those endpoints means a major
   version.
4. **Runtime:** Node.js 26 LTS (it becomes LTS around now), with Debian 13 as in 1.3.2. This is
   invisible to most people, but anyone who builds the image themselves should know.

## Phases and releases

Sizes are rough: S is days, M is one to two weeks, L is several weeks, for one developer.

| Phase                 | Release                         | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Size |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 0. Spikes             | none                            | (a) `@bacnet-js/client` against a simulated meter (`@bacnet-js/device`) and a real one: ReadPropertyMultiple, segmentation, foreign device registration. (b) The SC data link against the open-source bacnet-stack SC hub and the BACnet International reference stack: connect, heartbeat, failover. (c) The Docker networking matrix: host, macvlan or `br0`, and bridge with a BBMD. (d) Storage benchmark: 200 meters × 6 points for a simulated year. | M    |
| 1. History foundation | **1.5.0** (minor, non-breaking) | `readings.db`, rollups, retention, meter charts. **An import API** so any system can send readings now, with tokens that may write readings and nothing else. Alerts for stale readings and capacity. Proves storage and charts before any BACnet code ships.                                                                                                                                                                                              | L    |
| 2. BACnet/IP          | **2.0.0-alpha.1**               | Connections, Device object, discovery, browsing, point mapping, polling, live values. The meter model migration. Docker and Unraid documentation.                                                                                                                                                                                                                                                                                                          | L    |
| 3. BACnet/SC          | **2.0.0-alpha.2**               | SC data link, key and CSR flow, certificate upload, hub failover, certificate alerts.                                                                                                                                                                                                                                                                                                                                                                      | L    |
| 4. Using the data     | **2.0.0-beta.1**                | Templates, COV, measured demand in the capacity check, NEC 220.87 view, phase balance, live power flow and shutdown impact, field-mode capture, history API, OpenAPI document.                                                                                                                                                                                                                                                                             | L    |
| 5. Hardening          | **2.0.0-rc.1** → **2.0.0**      | Interop lab with real meters and a vendor SC hub; soak test; a PICS document (DS-RP-A, DS-RPM-A, DS-COV-A, DM-DDB-A/B); upgrade test on real 1.x backups; Node 26; documentation.                                                                                                                                                                                                                                                                          | M    |

Pre-releases are published with `pnpm release 2.0.0-alpha.1` (and so on). They only ever get
their own image tag, never `latest`, so early testers opt in while everyone else stays on
1.x. 1.x gets security and dependency fixes until 2.0 has been out for three months.

## Testing

- **Unit tests:**
  - BVLC-SC encoding and decoding, against frames captured from the reference hub;
  - units and scaling;
  - rollups, including late data, counter resets and rollover;
  - retention;
  - the read-only guard;
  - template matching.
- **In-process integration tests:** `@bacnet-js/device` simulates meters inside the test run,
  with no Docker and no network. This covers discovery, ReadPropertyMultiple, a meter going
  offline and back, COV, and value changes feeding charts and alerts.
- **SC integration tests:** a CI job runs the open-source bacnet-stack SC hub (built with
  libwebsockets) in a service container. A test CA and certificates are generated for each run
  with `openssl`. Tests cover connecting, failover to the second hub, an expired certificate,
  the wrong CA, and a VMAC collision.
- **Docker smoke test:** CI already starts the image. It also gets a simulated meter, so it
  checks that the image can discover a device and read a point over the bridge network with
  foreign device registration.
- **Interop lab before the release candidate:** two or three common meters, read through a real
  BMS BBMD and a vendor SC hub, checked with YABE as an independent BACnet tool.

## Deployment notes (documentation to write)

- **Which network set-up to choose:**
  - host networking: simplest, one subnet;
  - Unraid `br0` or macvlan: the container gets its own LAN address, so discovery works;
  - bridge networking with a BBMD: publish `47808/udp`. It works across subnets without
    broadcasts.
- **SC needs only outbound HTTPS-style traffic** to the hub, which suits locked-down sites.
- **Recommend SC wherever the site has it:** BACnet/IP has no authentication. Put a container
  running B/IP on the controls network, or reach it through the BMS's BBMD.
- **A one-page "what this app does on your BACnet network"** for controls contractors:
  read-only services, request rates, the device instance it uses, and how to block it.

## Decisions needed

1. **Scale:** how many meters, and how many points each, at your largest site? This sets the
   default retention and whether readings could need a time-series database later. The
   current design targets around 500 meters.
2. **What SC infrastructure you have:** which BMS vendor provides the hub, and who runs the CA
   (your PKI team, or the controls contractor)? That decides whether the CSR flow or
   certificate upload is the main path.
3. **COV:** will controls teams allow subscriptions, or should 2.0 poll only?
4. **An ASHRAE vendor ID** for the app's Device object. It is free and takes a few weeks.
   Until it arrives, use a configurable value.
5. **Who can map points:** editors at the meter's location (proposed), or only admins.
6. **Ship 1.5 first?** The plan releases history and the import API before any BACnet code.
   This de-risks 2.0, and sites with a BMS historian can feed data in straight away.

## Suggestions beyond BACnet

In rough order of value for effort:

1. **Release 1.4.0 now:** API tokens are merged but not yet released. Ship a test build to
   the #46 author first.
2. **Modbus TCP (2.1):** many sub-meters only speak Modbus, and the meter record already has
   the protocol. It reuses connections, points, templates, polling and history, with Modbus
   register maps as templates.
3. **Notices by email and webhook:** discrepancy reports (already on the ideas list), alerts
   and certificate expiry. Webhooks also give Teams, Slack and ntfy for free.
4. **Front-end tests:** the web app has none (`vitest run --passWithNoTests`). Add component
   tests for the panel editor's layout rules and one Playwright smoke test in CI (the 1.0 plan
   called for one). This matters before 2.0 adds a lot of UI.
5. **Supply chain:**
   - an SBOM and build provenance for the published image;
   - signing with cosign;
   - a Trivy image scan in CI.
     This is cheap in GitHub Actions, and buyers in OT and facilities increasingly ask for it.
6. **Metrics:** a Prometheus `/metrics` endpoint for the app and the BACnet service (requests,
   errors, devices online, poll lag), so sites with Grafana can watch it.
7. **Off-site backups:** copy backups to S3-compatible storage or an SMB share, optionally
   encrypted. This matters more once there is a year of readings that can't be collected again.
8. **TypeScript 7** as soon as `typescript-eslint` supports it (it stops at 6.0 today), for
   much faster type checks.
9. **Energy reports:** energy per building, panel or tenant per month from the daily rollups,
   for cost allocation and sub-metering. This is a natural follow-on once history exists.

## References

- ANSI/ASHRAE 135-2024, Annex J (BACnet/IP) and Annex AB (BACnet/SC). Exact wire details are
  confirmed against the standard during phase 0: the WebSocket subprotocol names, BVLC-SC
  message codes, and the cipher suites allowed.
- [`@bacnet-js/client`](https://github.com/bacnet-js/client) and
  [`@bacnet-js/device`](https://github.com/bacnet-js/device): the TypeScript BACnet stack and
  device simulator.
- [BACnet/SC Reference Stack](https://sourceforge.net/projects/bacnet-sc-reference-stack/):
  BACnet International's Java implementation, with a test bench.
- [Chipkin: What BACnet Secure Connect is](https://docs.chipkin.com/protocols/bacnet/secure-connect/):
  roles, VMACs, certificates and hubs, in plain terms.
- NEC 2023, 220.87: determining existing loads from a year of maximum demand data.
