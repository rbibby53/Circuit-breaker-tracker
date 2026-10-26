# User guide

How to get a building's panels into the app, keep them right, and get them back out on paper,
on a phone and in spreadsheets.

- [Set up your locations](#set-up-your-locations)
- [Add a panel](#add-a-panel)
- [Fill in the breakers](#fill-in-the-breakers)
- [Connect the power path](#connect-the-power-path)
- [Equipment and meters](#equipment-and-meters)
- [Generators and transfer switches](#generators-and-transfer-switches)
- [Find things](#find-things)
- [What loses power?](#what-loses-power)
- [Load and capacity](#load-and-capacity)
- [Print](#print)
- [Field verification](#field-verification)
- [Reports](#reports)
- [Import and export](#import-and-export)

## Set up your locations

Locations are a tree: **Company → Site → Building → Floor → Room**. Panels live in rooms.

1. On the home page, an admin adds the company (**Add a company**), then a site.
2. Open the site and add buildings, then floors, then rooms, with the **Add a …** field on each
   location's page.

For a home, add floors straight to the site; the building level stays hidden.

Name rooms the way they are labelled on the doors ("Room 3002", "Elec 1A"). Breaker labels often
name rooms, and the app uses that to suggest links (see [Room links](#room-links-from-labels)).

## Add a panel

Open the room the panel is in and press **+ Add a panel**. Choose its layout:

| Layout                               | For                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Residential load center**          | Split-phase 120/240 V panels. 1- and 2-pole breakers and tandems (21A / 21B).                                        |
| **Commercial panelboard**            | Three-phase 120/208 V or 277/480 V. Phases A, B, C on the bus; 1-, 2- and 3-pole breakers; spaces in multiples of 6. |
| **Switchboard / distribution board** | Units numbered 1, 2A, 2B…, up to 200, each with frame, trip, poles, feeder wire and conduit.                         |
| **Motor control center (MCC)**       | Buckets with starter size, motor HP and control type (FVNR, VFD…).                                                   |
| **Lighting relay panel**             | A numbered column of relays (e.g. Acuity nLight), each switching a breaker's circuit.                                |

Then, under **Panel settings**:

- **Nameplate:** manufacturer, model, AIC/SCCR, bus rating separate from the main, mounting,
  enclosure, feeder wire and conduit.
- **Sections:** **+ Add a section** for double-tub panels and anything past 84 spaces. Each
  section is numbered from 1 and can be fed through lugs. Circuits then read "S2 · 1 + 3 + 5".
- **Fed from:** the breaker, transformer or disconnect feeding this panel. See
  [Connect the power path](#connect-the-power-path).
- **Backup power:** the transfer switch the panel is on.
- **Duplicate panel** copies it into another room, e.g. for identical apartments.

## Fill in the breakers

Odd spaces are on the left and even on the right, as on the panel.

- **Click an empty space** to add a breaker. Drag a breaker to move it.
- Set **poles**, **amps**, **protection** (standard, GFCI, AFCI, dual function), **critical**,
  **backup power** (UPS or generator) and **spare**.
- **Label** it as it reads on the panel directory. Add **notes** for anything else.
- **Serves:** tag the rooms it serves, or a whole floor, building or site.
- **Tags:** what it powers (Lights, Outlets, HVAC, Servers…). Tags already in use are suggested.
  The tag bar above the panel highlights every breaker with a tag.
- **Load:** its connected load in VA or kVA, with a demand factor. A label that already says
  "1200 VA" fills this in.
- **Surge protectors** that sit in breaker spaces are a device type of their own, marked SPD.

**Select several** to set amps, poles, tags or the field check on many breakers at once, or to
move a range up or down.

Changes save as you go. **Ctrl+Z** undoes and **Ctrl+Shift+Z** redoes. If two people edit the
same panel at once, the second save is refused rather than silently overwriting the first:
reload and make the change again.

**History** on the panel lists every change in plain words, with who made it.

## Connect the power path

Each panel can say what feeds it, which builds the power path from the utility down.

- A **sub-panel** is fed from a breaker in another panel: set **Fed from** in its panel settings.
- **Transformers, disconnects, UPSs and the utility service** are items of their own:
  **+ Add a transformer, switching cube or disconnect** on a site or building, under
  **Transformers and disconnects**. Each is fed from a breaker or from another device, and
  panels can be fed from them.
- **Switching cubes** are for campuses that run their own medium-voltage grid. A building's
  transformer or main switchboard is fed from a cube through a numbered **way**. Building pages
  show a **Campus feed** card, and cube pages list the buildings they feed.

Once connected:

- Every panel shows a **power path** strip, e.g.
  _HA 480 V → T-LDP1 (75 kVA · 480 V → 120/208 V) → LP-1A_, with the circuit at each
  step and the generator backing it.
- **Power** in the menu (or **Power flow** on a site, building, panel or generator) draws the
  whole thing as a map. Hover or tap anything to light up its path, click to open it, and pan
  and zoom. On a phone, or with a screen reader, switch to the list view.
- **Voltage warnings** flag a panel fed at another voltage with no transformer between, a
  transformer whose voltages don't match either side, 3-pole breakers on a single-phase panel,
  and equipment rated for another voltage.

## Equipment and meters

**Equipment** (in the menu) is the register of what your panels power: AHU-1, EF-2, RTU-3 and
the rest, with type, HP, voltage and room. Add it with **+ Add equipment** on a location, and
set the breaker or disconnect that feeds it. Breakers then list the equipment on them, and
searching "AHU-2" shows what feeds it.

**Meters** are your own meters on switchgear, panels and circuits: meter number, make, model,
serial, CT and PT ratios, multiplier, and protocol (Modbus TCP/RTU, BACnet IP/MS-TP, pulse)
with its address. Add one with **+ Add a meter** on a panel, or **+ Add a meter on this
circuit** on a breaker. A meter measures a breaker's circuit, a panel at its main, or a cube or
transformer.

## Generators and transfer switches

Add a standby generator with **+ Add a generator** on a site or building: size (kW), fuel,
voltage, make and model, fuel tank and runtime. On its page, **+ Add a transfer switch** for
each ATS or MTS, with rating, duty (emergency, legally required or optional standby; NEC
700/701/702), transition and priority.

Put a panel on a transfer switch under **Panel settings → Backup power**. Its normal side is the
panel's **Fed from**, its emergency side the generator. Panels fed from a generator-backed panel
are on the generator too, and panels, PDFs and CSV exports say which generator backs them.

## Find things

Press <kbd>/</kbd> anywhere to search. It finds rooms, panels, breakers (by label, tag or the
room they serve), equipment, meters (by name, number or serial), generators and devices, all
within your access.

Each **room** and **floor** page lists every breaker that serves it, from any panel, including
whole-floor and whole-site tags.

### Room links from labels

A building's page suggests which rooms a breaker serves when its label names a room number
("RECEPT ROOM 3002" → Room 3002). Accept them in bulk.

## What loses power?

**What loses power?** on any breaker, panel, transformer or disconnect lists everything
downstream: panels, equipment, relays, rooms and critical circuits. Panels on a transfer switch
and loads on a UPS are shown as staying up. Use it for lockout/tagout and outage notices, and
**Copy as text** to paste it into an email.

## Load and capacity

With loads filled in, each panel shows:

- the load on each phase (or leg) in VA and amps, and how far out of balance it is;
- connected and demand totals;
- a **capacity check**: demand added up below the panel, through sub-panels and transformers,
  against its main or bus, its feeder breaker and the nearest transformer or UPS. Anything at
  80% or more is flagged.

## Print

**Print & export** on any panel or location. PDFs come on US Letter or A4, show who printed
them and when on every page, and only ever include what the person printing may see.

| Print                | What it is                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| **Panel sheet**      | A full page laid out like the panel, with what each breaker serves, its markers and the notes.   |
| **Door card**        | A 4-inch-wide card to cut out and keep inside the panel door.                                    |
| **Breaker labels**   | A sticker sheet, one label per circuit: Avery 5167 (Letter) or L7651 (A4).                       |
| **Label strips**     | Strips to stick beside each column of breakers, at 1" or ¾" spacing.                             |
| **QR door stickers** | 2-inch squares for the outside of each panel door (Avery 22806), for one panel or a building.    |
| **Room index**       | Every room by floor, with the breakers that serve it.                                            |
| **Panel book**       | A cover and contents, a sheet for every panel in a site, building or floor, then the room index. |

- **Print labels and strips at 100%**, not "fit to page", or they will not line up.
- On a part-used label sheet, set how many labels to skip.
- Markers print as text (CRIT, UPS, GEN, GFCI, AFCI, DF, SPD), so sheets read fine in black and
  white.
- Each sheet has a QR code that opens the panel on a phone. Set the public address under
  Settings first, so it points somewhere a phone can reach.

## Field verification

Walk a panel and check the directory against reality.

1. On a panel, open **Field mode**. It shows one circuit per row in big type, with the panel's
   meters above.
2. Press **Matches** or **Doesn't match** for each. **Doesn't match** sends a report to whoever
   looks after the panel.
3. Filter for circuits not yet checked.

Field checks need Editor access. Each check records who and when.

**Save for offline** keeps a building's panels on the phone, so field mode opens in an
electrical room with no signal. Checks and reports wait on the phone and are sent when it is
back online. Offline needs the app on HTTPS (or `localhost`).

The **Field verification** card on a site, building or floor shows how far checking has got,
by building and panel ("Science Hall: 62% verified"). **Who verified what**, from that card, lists every check, newest first, with a count per
person, filtered by place, person and result.

## Reports

Anyone who can see a panel can report that something doesn't match, from field mode, and so can
anyone who scans a panel's public page (see [Public panel pages](access.md#public-panel-pages)).
Editors see open reports on the panel and under **Reports** in the menu, and **Resolve** them
with a note.

## Import and export

**Export:** **Print & export** gives a CSV of a panel, or of every panel under a location, for
Excel, Numbers or Google Sheets. Scripts can fetch the same file with an
[API token](api.md).

**Import:** **Import from a spreadsheet** on a location. Paste cells, or choose a CSV, and match
its columns. The app's own export reads straight back in. Before anything is saved, it shows
every panel and circuit that would be added or changed, with row-numbered problems. Each
panel's history records the import.

A good way to start a large site: export one panel, fill in the rest of the building in the
same columns in a spreadsheet, and import it.
