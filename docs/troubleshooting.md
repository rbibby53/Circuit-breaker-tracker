# Troubleshooting

Start with the log: `docker logs breakers`, Unraid's log viewer, or **Settings → Logging →
Show recent log**. Problems are logged with the reason. Set **Log level** to `debug` for a line
per request while you look into something.

- [Starting up](#starting-up)
- [Reverse proxy and addresses](#reverse-proxy-and-addresses)
- [Single sign-on](#single-sign-on)
- [Access](#access)
- [Phones and field mode](#phones-and-field-mode)
- [Printing](#printing)
- [Scripts and API tokens](#scripts-and-api-tokens)
- [Upgrades and backups](#upgrades-and-backups)

## Starting up

**The container stops straight after starting.** Look at the last lines of the log:

- A message naming an environment variable, e.g. `SESSION_DAYS must be between 1 and 365`:
  a [pinned setting](configuration.md#pinning-settings-with-environment-variables) has a value
  that is not valid. Fix or remove it.
- A permission error on `/data`: the data folder must belong to `1000:1000`, the user the app
  runs as. `chown -R 1000:1000 <folder>`. See [Install](install.md#a-folder-instead-of-a-named-volume).

**Port 2757 is already in use.** Map another host port (`-p 8080:2757`), or with host
networking set `PORT`.

**A setting is greyed out with a lock on the Settings page.** It is pinned by an environment
variable, which wins over the page. Change or remove the variable and recreate the container.

## Reverse proxy and addresses

**Every address in the log is the same one (the proxy's).** Turn on **Settings → Network and
security → Behind a reverse proxy**. The log warns about this once when it sees forwarded
requests without it.

**Invite links, reset links or QR codes point at the wrong address** (an internal IP, `http://`
instead of `https://`). Set **Settings → General → Public address** to the address people use.
Until it is set, links use whatever address the browser that made them used.

**Signing in on `http://` does nothing: you land back on the sign-in page.** When the public
address starts with `https://`, sign-in cookies are HTTPS-only, and browsers drop them on a
plain `http://` address such as `http://192.168.1.10:2757`. Use the `https://` address. To test
on the local address anyway, set **HTTPS-only sign-in cookies** to _Never_ for the time being.

## Single sign-on

**There is no single sign-on button.** All four of these must be filled in: Issuer URL, Client
ID, Client secret, and **Settings → General → Public address**. **Test connection** checks that
the provider can be reached at that issuer, and shows the error if not.

**The provider says the redirect URI does not match.** The redirect URI registered with the
provider must be exactly the one shown on **Settings → Single sign-on**: same scheme, host, port
and path (`/api/auth/oidc/callback`). It is built from the public address, so fix that first if
it is wrong.

**Authentik: the issuer is not found.** Keep the slash at the end:
`https://auth.example.com/application/o/<slug>/`.

**"No account is linked to that sign-in yet."** Signing in with single sign-on does not make an
account by itself. Send them an invite link, have an existing user link the account from **Your
account**, or add a **Group access** rule or admin group for one of their groups. See
[Single sign-on](sign-in.md#single-sign-on).

**"Your … account is not in a group that may use this app."** **Only allow these groups** is set
and they are in none of them.

**Groups are not picked up.**

- Groups are read at sign-in. Have the person sign out and back in, or use **People → Manage →
  Sign out everywhere**.
- Keycloak and Authelia need `groups` added to **Scopes**, and Keycloak needs a Group
  Membership mapper. See [Keycloak](sign-in.md#keycloak).
- Microsoft Entra sends group **object IDs**, not names. Use the IDs.
- Check **Groups claim** matches the claim your provider sends (`groups` for most;
  `realm_access.roles` for Keycloak roles).

**A client secret expired** (Entra secrets do). Single sign-on stops working until you create a
new secret and paste it into **Settings → Single sign-on**. Admins can still sign in with their
password meanwhile.

**The only admin forgot their password.** Another admin can send them a reset link from
**People**. If there is no other admin but single sign-on is set up with **Admin groups**, add
yourself to an admin group in the provider and sign in with single sign-on. Keep a second
admin account so this never comes up.

## Access

**Someone cannot see a panel they should.** Open **Access** on the panel's room: it shows
every grant that applies there and where it comes from. Admins can also use **View as** on
**People** to see the app exactly as that person does.

**A manager cannot invite someone as an Editor.** Their **invite limit** is _Viewers only_. An
admin, or a manager above them with a higher limit, can raise it on **Access**.

**"Someone else changed this panel since you opened it."** Two people edited the same panel at once, and the second
save was refused rather than overwrite the first. Reload the panel and make the change again.

## Phones and field mode

**Save for offline is missing or does nothing.** Browsers only allow offline storage on HTTPS
(or `localhost`). Put the app behind a reverse proxy with a certificate.

**Checks made offline have not shown up.** They wait on the phone and are sent when it is back
online with the app open. Open the app again once there is signal.

**Scanning a QR sticker asks for a sign-in.** Either the panel has no public page (a manager
can turn it on), or public pages are off for everyone under **Settings → Printing and QR codes**.

## Printing

**Labels or strips don't line up with the breakers.** Print at **100% / actual size**, not "fit
to page", and check the paper size matches the label sheet (Letter or A4).

**The QR code on a sheet opens the wrong address.** Set the public address, then print again.

## Scripts and API tokens

See [Errors](api.md#errors) in the API guide. In short:

| You get                                | Because                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `401` "API tokens are turned off here" | An admin has turned off **Allow API tokens**.                                                                                                                      |
| `401` "wrong, expired or revoked"      | Check the whole token was copied, including `cbt_`, and that it has not expired.                                                                                   |
| `403` "can only read"                  | Tokens only allow `GET`.                                                                                                                                           |
| `403` "not accounts or settings"       | That path is never open to tokens.                                                                                                                                 |
| `404` for something that exists        | The token's owner cannot see it.                                                                                                                                   |
| A sign-in page instead of JSON         | A proxy in front (e.g. an SSO forward-auth) is intercepting the request. Exempt `/api/` for requests with `Authorization: Bearer cbt_…`, or call the app directly. |

## Upgrades and backups

**I upgraded and want to go back.** Running an older version on a database the new one has
updated is not supported. Instead, run the older image and restore by hand (see
[Restoring](configuration.md#restoring)) the backup from before the upgrade: the newest file in
`/data/backups` dated before it, or the one you downloaded.

**Automatic backups are not happening.** Check **Settings → Automatic backups → Daily backups
to keep** is not `0`. Each backup is logged at `info`. Times follow the container's `TZ`.

## Still stuck?

[Open an issue](https://github.com/rbibby53/Circuit-breaker-tracker/issues/new/choose) with the
version (bottom of every page), what you did, and the relevant log lines. Report security
problems privately as described in [SECURITY.md](../SECURITY.md).
