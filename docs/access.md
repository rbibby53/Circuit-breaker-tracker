# Access and roles

Access is given **on a location**, and covers everything inside it. Someone who is an Editor
on _Science Hall_ can edit every floor, room and panel in Science Hall, and sees nothing in
any other building.

- [Locations](#locations)
- [Roles](#roles)
- [Giving access](#giving-access)
- [What people outside your access see](#what-people-outside-your-access-see)
- [Public panel pages](#public-panel-pages)
- [Checking someone's access](#checking-someones-access)

## Locations

Everything sits in a tree:

```
Company → Site → Building → Floor → Room
```

For example _KSU › Main campus › Science Hall › Floor 1 › Room 1001_. Panels live in rooms.

For a home, add floors straight to the site; the building level stays hidden.

## Roles

| Role        | Can                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Viewer**  | See the location and everything inside it: panels, breakers, power path, equipment, meters. Print, export, and report a problem.                                                                            |
| **Editor**  | Everything a viewer can, plus: add, rename and delete locations inside it; add and edit panels, breakers, devices, equipment and meters; do field checks; resolve reports; import.                          |
| **Manager** | Everything an editor can, plus: invite people and give access, up to their **invite limit**; rename the location itself; see its **Activity**; send reset links and sign people out; share panels publicly. |
| **Admin**   | Everything, everywhere, plus **Settings**, companies, and **View as**. Admin is a flag on the account, not a grant on a location.                                                                           |

If someone has several grants, the strongest one that covers a location applies there. An
Editor on a site who is also a Viewer on one of its buildings is an Editor in that building.

### Manager invite limits

Each manager grant has an invite limit, the strongest role that manager can hand out:

- **Viewers only**
- **Viewers and editors**
- **Up to managers** (and the managers they make can have the same limit or lower)

A manager can only give access inside their own scope, and cannot change their own access.
This lets you hand a building to a facilities lead without them being able to hand it on
further than you intended.

## Giving access

**To someone new:** open **Access**, pick the location, and under **Invite someone new**
choose the role and press **Create invite link**. Copy the link and send it to them. They set
a password, or sign in with single sign-on.

**To someone who already has an account:** open **People**, press **Manage** beside them, and
use **Give access somewhere**. The same panel shows everywhere they have access, lets you
change a role or remove access, and sets their name and email.

**To a whole group** from single sign-on, e.g. everyone in _Electricians_: an admin sets
**Group access** under **Settings → Single sign-on**. See [Groups](sign-in.md#groups).

## What people outside your access see

- **The path above your access** is shown by name only, so _KSU › Main campus › Science Hall_
  makes sense to someone who only has Science Hall. They cannot open _Main campus_ or see
  anything else in it.
- **What feeds a panel** is always shown, all the way up to the service, even when the
  upstream panels are outside their access. Panels they cannot open are shown as locked boxes
  on the power flow map. Someone working on a panel needs to know where its power comes from.
- **What a panel feeds**, in places they cannot see, is counted, not named. The same goes for shutdown impact: what loses power out of sight is a number.
- **Search** only finds what they can see.

Everything is checked by the server on every request, not only hidden in the page. That also
applies to [API tokens](api.md), PDFs and CSV exports.

## Public panel pages

A manager can let anyone who scans a panel's QR door sticker see it without signing in. It is a
read-only, phone-friendly list with a search box, a **Report a problem** button and a **Sign in
to edit** button.

- The link is unguessable, can be replaced at any time (the old one stops working), and can be
  turned off.
- An admin can switch public pages off everywhere under **Settings → Printing and QR codes →
  Allow public panel pages**. Every QR code then asks for a sign-in instead.

Use it for panels where the person standing in front of the panel should be able to read it:
a tenant, a contractor, the night shift.

## Checking someone's access

- **People** lists everyone you can manage, with their access. Search by name, email or
  location.
- **Access** on a location shows who can see it and why (a grant there, a grant above it, or a
  group), who has access to places inside it, and the admins.
- **View as** (admins) shows the app exactly as someone else sees it, read-only. A banner shows
  you are viewing as someone; leave it from there.
- **Activity** shows every change, by whom, with links to where it happened. Managers see the
  changes inside their scope.
