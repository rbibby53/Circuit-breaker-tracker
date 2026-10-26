# Sign-in

People sign in with a **password**, with **single sign-on** (Microsoft Entra ID, Authentik,
Keycloak or any OpenID Connect provider), or both. Signing in never gives access to anything
by itself: access comes from grants on locations (see [Access and roles](access.md)).

- [Passwords and links](#passwords-and-links)
- [Two-step sign-in](#two-step-sign-in)
- [Where you're signed in](#where-youre-signed-in)
- [Single sign-on](#single-sign-on)
  - [Microsoft Entra ID](#microsoft-entra-id)
  - [Authentik](#authentik)
  - [Keycloak](#keycloak)
  - [Other providers](#other-providers)
- [Groups](#groups)
- [Single sign-on only](#single-sign-on-only)

## Passwords and links

There is no email server to set up. Invite and reset links are one-time links that you copy
and send yourself, by email, Teams, a text, whatever suits.

- **Invite someone** from **Access** on a location, or from **People**. Choose their role, copy
  the link, and send it. They choose a username and password, or sign in with single sign-on
  instead, and get the access you chose. Invite links last 7 days by default.
- **Reset a password** with **Reset link** beside the person on **People**. It makes a link to
  send them, valid for 48 hours by default. A manager can only do this for someone whose access is all inside what
  the manager looks after, so a manager cannot take over an account that reaches further.
- Passwords are at least 10 characters.

Link lifetimes are under **Settings → Invite and reset links**.

## Two-step sign-in

Password accounts can add a code from an authenticator app (Microsoft Authenticator, Google
Authenticator, 1Password, Bitwarden, and the like):

1. **Your account → Two-step sign-in → Set up two-step sign-in**.
2. Scan the QR code with the app, enter the code it shows, and press **Turn on**.
3. Save the **recovery codes** somewhere safe. Each works once, in place of an app code, if
   the phone is lost. **Make new recovery codes** replaces them all.

**Lost the phone and the recovery codes?** Whoever can send that person a reset link (an admin,
or their manager) can turn it off for them with **Turn off 2-step** beside them on **People**. They
then sign in with just their password and set it up again.

Single sign-on accounts use the provider's own two-step settings instead.

## Where you're signed in

**Your account** lists each browser signed in, with its address and when it was last used.
Sign out any of them, or all the others at once.

Managers and admins can sign someone out everywhere from **People → Manage → Sign out
everywhere**, for a lost laptop or someone leaving.

Sign-ins last 30 days by default (**Settings → Sign-in → Stay signed in for**).

## Single sign-on

Before you start, set **Settings → General → Public address**. Single sign-on stays off until
it is set, because the provider needs an address to send people back to.

The setup is the same for every provider:

1. Register the app with the provider. The **redirect URI** to give it is shown on
   **Settings → Single sign-on**, and is your public address followed by
   `/api/auth/oidc/callback`, e.g. `https://breakers.example.com/api/auth/oidc/callback`.
2. Fill in **Issuer URL**, **Client ID** and **Client secret** under **Settings → Single
   sign-on**.
3. Save, then press **Test connection**.

Accounts are matched by the provider's subject ID, never by email, so someone changing their
email address keeps their account, and two providers cannot claim the same person by email.

Someone gets in with single sign-on when any of these apply:

- They accept an **invite link** with single sign-on instead of a password.
- An existing local user links their single sign-on account from **Your account**.
- Their **[groups](#groups)** give them access. Their account is made the first time they sign
  in, unless **Create accounts from groups** is off.

### Microsoft Entra ID

1. In the Entra admin center, go to **App registrations** and choose **New registration**.
   - **Supported account types:** accounts in this organizational directory only.
   - **Redirect URI:** platform _Web_, the value shown on the Settings page.
2. Under **Certificates & secrets**, create a client secret. Note its expiry: single sign-on
   stops working when it expires.
3. In the app, open **Settings → Single sign-on** and fill in:
   - **Issuer URL:** `https://login.microsoftonline.com/<directory-tenant-id>/v2.0`
   - **Client ID:** the application (client) ID
   - **Client secret:** the secret _value_ (not its ID)
4. Save, then press **Test connection**.

To use Entra security groups, add a **groups claim** under **Token configuration** (Security
groups, ID token). Entra sends group **object IDs**, not names, so use those IDs as group names
in this app.

### Authentik

1. In Authentik, open **Applications → Providers** and create an **OAuth2/OpenID Provider**:
   - **Client type:** Confidential.
   - **Redirect URIs:** _Strict_, the value shown on the Settings page.
   - Keep the default scopes (`openid`, `email`, `profile`). Authentik's `profile` scope
     includes a `groups` claim with the names of the user's groups.
2. Create an **Application** that uses this provider, e.g. with the slug `breakers`. Bind
   groups or users to it under **Policy / Group / User Bindings** to decide who may use it.
3. In the app, open **Settings → Single sign-on** and fill in:
   - **Issuer URL:** the provider's _OpenID Configuration Issuer_, e.g.
     `https://auth.example.com/application/o/breakers/` (keep the slash at the end).
   - **Client ID** and **Client secret:** from the provider.
4. Save, then press **Test connection**. The sign-in button reads **Sign in with Authentik**.

### Keycloak

1. In your realm, **Clients → Create client**, type _OpenID Connect_.
   - Turn on **Client authentication** (a confidential client).
   - **Valid redirect URIs:** the value shown on the Settings page.
2. Copy the secret from the client's **Credentials** tab.
3. For groups, add a mapper under the client's dedicated scope: **Add mapper → By
   configuration → Group Membership**, token claim name `groups`, with **Full group path**
   on or off as you prefer (see [nested groups](#nested-groups)).
4. In the app, fill in:
   - **Issuer URL:** `https://keycloak.example.com/realms/<realm>`
   - **Client ID** and **Client secret**
   - **Scopes:** add `groups` if your mapper is on its own client scope.
5. Save, then press **Test connection**.

To use realm roles instead of groups, set **Groups claim** to `realm_access.roles`.

### Other providers

Any OpenID Connect provider with discovery (`/.well-known/openid-configuration`) works:
Authelia, Zitadel, Okta, Google Workspace and others. For **Authelia**, add `groups` to
**Scopes**.

## Groups

Groups come from the token's `groups` claim. Change **Groups claim** for another one, e.g.
`realm_access.roles` for Keycloak roles. Group names are matched ignoring case. Under
**Settings → Single sign-on**:

- **Group access** gives everyone in a group a role on a location, just like a grant: for
  example _Electricians_ → Editor on _KSU › Main campus_. It shows on **People** and **Access**
  as "from the Electricians group", and is changed here or in the provider, not per person.
  Access given by hand stays as it is, beside it.
- **Admin groups** make their members admins, and take it away when they leave. Admins made by
  hand are never changed, and the last admin is never removed.
- **Only allow these groups** refuses single sign-on for anyone outside them.

People's groups are read each time they sign in with single sign-on, so a change in the
provider applies at their next sign-in. To apply it sooner, use **People → Manage → Sign out
everywhere**. Someone who also has a password keeps the groups from their last single sign-on
while they use the password. Changes to group access in the app apply straight away.

### Nested groups

Someone in a group inside another group (_Electricians_ inside _Facilities_) gets the access of
both, as long as the provider says so:

- **Keycloak** sends full paths such as `/Facilities/Electricians` (the group mapper's _Full
  group path_ setting). The app counts that as membership of `/Facilities` too, so group
  access, admin groups and allowed groups can name either the full path or just the group's
  name (`Facilities`, `Electricians`). Use the full path when two branches have groups with
  the same name.
- **Authentik** sends only the groups someone is directly in. To include the groups above
  them, add a scope mapping under _Customization → Property Mappings_ (scope name
  `all_groups`) with
  `return {"all_groups": [g.name for g in request.user.all_groups()]}`, add it to the
  provider's scopes, then set **Scopes** to include `all_groups` and **Groups claim** to
  `all_groups` here.
- **Microsoft Entra ID** already includes groups someone is in through other groups.

## Single sign-on only

Local passwords keep working alongside single sign-on. To make everyone except admins use
single sign-on, turn off **Settings → Sign-in → Allow password sign-in**. Admins always keep
their password, so you cannot lock yourself out if the provider is down.

Scripts don't need a password either way: [API tokens](api.md) work for single sign-on
accounts too.
