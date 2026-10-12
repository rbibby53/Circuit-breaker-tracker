// Append-only. Never edit a migration that has shipped; add a new one instead.
/**
 * Starts a migration that rebuilds a table other tables point at. It runs with foreign keys off
 * (dropping the old table would otherwise cascade), and is checked for broken links before it
 * commits.
 */
export const FOREIGN_KEYS_OFF = '-- foreign keys off';

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    email         TEXT COLLATE NOCASE,
    password_hash TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT
  );
  CREATE UNIQUE INDEX users_email ON users (email) WHERE email IS NOT NULL;

  CREATE TABLE user_identities (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider  TEXT NOT NULL,
    issuer    TEXT NOT NULL,
    subject   TEXT NOT NULL,
    email     TEXT,
    linked_at TEXT NOT NULL,
    UNIQUE (issuer, subject)
  );

  CREATE TABLE sessions (
    id                TEXT PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    acting_as_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL,
    expires_at        TEXT NOT NULL,
    user_agent        TEXT
  );
  CREATE INDEX sessions_user ON sessions (user_id);

  CREATE TABLE locations (
    id                  INTEGER PRIMARY KEY,
    parent_id           INTEGER REFERENCES locations (id) ON DELETE RESTRICT,
    kind                TEXT NOT NULL CHECK (kind IN ('company', 'site', 'building', 'floor', 'room')),
    name                TEXT NOT NULL,
    notes               TEXT NOT NULL DEFAULT '',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    path                TEXT NOT NULL DEFAULT '',
    is_default_building INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );
  CREATE INDEX locations_parent ON locations (parent_id);
  CREATE INDEX locations_path ON locations (path);

  CREATE TABLE grants (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    location_id  INTEGER NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'manager')),
    invite_limit TEXT CHECK (invite_limit IS NULL OR invite_limit IN ('viewer', 'editor', 'manager')),
    created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL,
    UNIQUE (user_id, location_id)
  );
  CREATE INDEX grants_location ON grants (location_id);

  CREATE TABLE invites (
    id           INTEGER PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    location_id  INTEGER NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'manager')),
    invite_limit TEXT CHECK (invite_limit IS NULL OR invite_limit IN ('viewer', 'editor', 'manager')),
    note         TEXT,
    created_by   INTEGER REFERENCES users (id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    used_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
    used_at      TEXT
  );

  CREATE TABLE reset_tokens (
    id         INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );

  CREATE TABLE oidc_states (
    state         TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    nonce         TEXT NOT NULL,
    invite_token  TEXT,
    link_user_id  INTEGER REFERENCES users (id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL
  );

  -- No foreign keys: history must survive deleted users and locations.
  CREATE TABLE audit_log (
    id                INTEGER PRIMARY KEY,
    at                TEXT NOT NULL,
    user_id           INTEGER,
    user_name         TEXT,
    acting_as_user_id INTEGER,
    acting_as_name    TEXT,
    location_id       INTEGER,
    location_path     TEXT,
    location_label    TEXT,
    action            TEXT NOT NULL,
    entity            TEXT NOT NULL,
    entity_id         INTEGER,
    summary           TEXT NOT NULL,
    before            TEXT,
    after             TEXT
  );
  CREATE INDEX audit_at ON audit_log (at);
  CREATE INDEX audit_location_path ON audit_log (location_path);
  `,
  `
  CREATE TABLE panels (
    id                  INTEGER PRIMARY KEY,
    location_id         INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    name                TEXT NOT NULL,
    layout              TEXT NOT NULL CHECK (layout IN ('residential', 'commercial', 'single')),
    spaces              INTEGER NOT NULL,
    main_amps           INTEGER,
    main_type           TEXT NOT NULL DEFAULT 'breaker' CHECK (main_type IN ('breaker', 'lugs')),
    voltage             TEXT NOT NULL DEFAULT '',
    manufacturer        TEXT NOT NULL DEFAULT '',
    model               TEXT NOT NULL DEFAULT '',
    notes               TEXT NOT NULL DEFAULT '',
    fed_from_breaker_id INTEGER REFERENCES breakers (id) ON DELETE SET NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );
  CREATE INDEX panels_location ON panels (location_id);
  CREATE INDEX panels_fed_from ON panels (fed_from_breaker_id);

  CREATE TABLE breakers (
    id         INTEGER PRIMARY KEY,
    panel_id   INTEGER NOT NULL REFERENCES panels (id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    slot       TEXT NOT NULL DEFAULT 'full' CHECK (slot IN ('full', 'A', 'B')),
    poles      INTEGER NOT NULL CHECK (poles BETWEEN 1 AND 3),
    amps       INTEGER NOT NULL,
    protection TEXT NOT NULL DEFAULT 'standard' CHECK (protection IN ('standard', 'gfci', 'afci', 'dual')),
    label      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    is_spare   INTEGER NOT NULL DEFAULT 0,
    critical   INTEGER NOT NULL DEFAULT 0,
    backup     TEXT NOT NULL DEFAULT 'none' CHECK (backup IN ('none', 'ups', 'generator'))
  );
  CREATE INDEX breakers_panel ON breakers (panel_id);

  CREATE TABLE breaker_serves (
    breaker_id  INTEGER NOT NULL REFERENCES breakers (id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
    note        TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (breaker_id, location_id)
  );
  CREATE INDEX breaker_serves_location ON breaker_serves (location_id);
  `,
  `
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL
  );
  `,
  `
  ALTER TABLE users ADD COLUMN totp_secret TEXT;
  ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;
  ALTER TABLE users ADD COLUMN totp_last_step INTEGER;

  CREATE TABLE totp_recovery_codes (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at   TEXT
  );
  CREATE INDEX totp_recovery_user ON totp_recovery_codes (user_id);

  -- A password that was right, waiting for the second step. Short-lived.
  CREATE TABLE login_challenges (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
  );
  `,
  `
  -- Set when a panel has a public page (opened from its QR code without signing in).
  ALTER TABLE panels ADD COLUMN public_token TEXT;
  CREATE UNIQUE INDEX panels_public_token ON panels (public_token) WHERE public_token IS NOT NULL;
  `,
  `
  -- Free-form labels for what a breaker powers (Lights, Outlets, Servers…), for search.
  CREATE TABLE breaker_tags (
    breaker_id INTEGER NOT NULL REFERENCES breakers (id) ON DELETE CASCADE,
    tag        TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (breaker_id, tag)
  );
  CREATE INDEX breaker_tags_tag ON breaker_tags (tag);
  `,
  `
  -- For "Where you're signed in": when each session was last used, from where, and how it began.
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
  ALTER TABLE sessions ADD COLUMN ip TEXT;
  ALTER TABLE sessions ADD COLUMN method TEXT;
  `,
  `
  -- Surge protectors install in breaker spaces. amps is 0 when one has no breakers of its own.
  ALTER TABLE breakers ADD COLUMN device TEXT NOT NULL DEFAULT 'breaker' CHECK (device IN ('breaker', 'surge'));
  `,
  `
  -- Single sign-on groups. A person's groups as of their last SSO sign-in (JSON array), and
  -- whether their admin flag came from an admin group (so it can be taken away again).
  ALTER TABLE users ADD COLUMN sso_groups TEXT;
  ALTER TABLE users ADD COLUMN sso_groups_at TEXT;
  ALTER TABLE users ADD COLUMN admin_from_sso INTEGER NOT NULL DEFAULT 0;

  -- Access for everyone in a group, worked out when access is checked, beside their own grants.
  CREATE TABLE sso_group_grants (
    id           INTEGER PRIMARY KEY,
    group_name   TEXT NOT NULL COLLATE NOCASE,
    location_id  INTEGER NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'manager')),
    invite_limit TEXT CHECK (invite_limit IS NULL OR invite_limit IN ('viewer', 'editor', 'manager')),
    created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL,
    UNIQUE (group_name, location_id)
  );
  `,
  `
  ${FOREIGN_KEYS_OFF}
  -- Standby generators, where they are, and (below) the panels they back up.
  CREATE TABLE generators (
    id           INTEGER PRIMARY KEY,
    location_id  INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    name         TEXT NOT NULL,
    kw           INTEGER,
    fuel         TEXT NOT NULL DEFAULT 'diesel'
                 CHECK (fuel IN ('diesel', 'natural-gas', 'propane', 'bi-fuel', 'gasoline', 'other')),
    voltage      TEXT NOT NULL DEFAULT '',
    manufacturer TEXT NOT NULL DEFAULT '',
    model        TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX generators_location ON generators (location_id);

  -- Panels gain the relay layout (lighting control relay panels such as nLight), the generator
  -- backing them and its transfer switch, and a relay panel's control system. SQLite cannot
  -- change a CHECK constraint, so the table is rebuilt with the same rows.
  CREATE TABLE panels_new (
    id                  INTEGER PRIMARY KEY,
    location_id         INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    name                TEXT NOT NULL,
    layout              TEXT NOT NULL CHECK (layout IN ('residential', 'commercial', 'single', 'relay')),
    spaces              INTEGER NOT NULL,
    main_amps           INTEGER,
    main_type           TEXT NOT NULL DEFAULT 'breaker' CHECK (main_type IN ('breaker', 'lugs')),
    voltage             TEXT NOT NULL DEFAULT '',
    manufacturer        TEXT NOT NULL DEFAULT '',
    model               TEXT NOT NULL DEFAULT '',
    notes               TEXT NOT NULL DEFAULT '',
    fed_from_breaker_id INTEGER REFERENCES breakers (id) ON DELETE SET NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    public_token        TEXT,
    generator_id        INTEGER REFERENCES generators (id) ON DELETE SET NULL,
    transfer_switch     TEXT NOT NULL DEFAULT '',
    control_system      TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO panels_new (id, location_id, name, layout, spaces, main_amps, main_type, voltage, manufacturer, model,
                          notes, fed_from_breaker_id, version, created_at, updated_at, public_token)
    SELECT id, location_id, name, layout, spaces, main_amps, main_type, voltage, manufacturer, model,
           notes, fed_from_breaker_id, version, created_at, updated_at, public_token
    FROM panels;
  DROP TABLE panels;
  ALTER TABLE panels_new RENAME TO panels;
  CREATE INDEX panels_location ON panels (location_id);
  CREATE INDEX panels_fed_from ON panels (fed_from_breaker_id);
  CREATE UNIQUE INDEX panels_public_token ON panels (public_token) WHERE public_token IS NOT NULL;
  CREATE INDEX panels_generator ON panels (generator_id);

  -- Relays: the breaker whose circuit a relay switches, and what controls it (an nLight zone…).
  ALTER TABLE breakers ADD COLUMN source_breaker_id INTEGER REFERENCES breakers (id) ON DELETE SET NULL;
  ALTER TABLE breakers ADD COLUMN control TEXT NOT NULL DEFAULT '';
  CREATE INDEX breakers_source ON breakers (source_breaker_id);
  `,
  `
  -- Transfer switches (ATS) between a panel's normal feed and a generator. A panel on one is
  -- still fed from its "fed from" breaker on the normal side; the switch brings in the generator.
  CREATE TABLE transfer_switches (
    id           INTEGER PRIMARY KEY,
    location_id  INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'automatic' CHECK (kind IN ('automatic', 'manual')),
    amps         INTEGER,
    generator_id INTEGER REFERENCES generators (id) ON DELETE SET NULL,
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX transfer_switches_location ON transfer_switches (location_id);
  CREATE INDEX transfer_switches_generator ON transfer_switches (generator_id);
  ALTER TABLE panels ADD COLUMN ats_id INTEGER REFERENCES transfer_switches (id) ON DELETE SET NULL;
  CREATE INDEX panels_ats ON panels (ats_id);

  -- 1.1 kept a transfer switch as a name on the panel. Make each named one a real transfer
  -- switch (in the room of the first panel using it) and move those panels onto it.
  INSERT INTO transfer_switches (location_id, name, generator_id, created_at, updated_at)
    SELECT (SELECT p2.location_id FROM panels p2
             WHERE p2.generator_id = p.generator_id AND p2.transfer_switch = p.transfer_switch ORDER BY p2.id LIMIT 1),
           p.transfer_switch, p.generator_id, MIN(p.created_at), MIN(p.created_at)
      FROM panels p
     WHERE p.generator_id IS NOT NULL AND p.transfer_switch != ''
     GROUP BY p.generator_id, p.transfer_switch;
  UPDATE panels
     SET ats_id = (SELECT t.id FROM transfer_switches t
                    WHERE t.generator_id = panels.generator_id AND t.name = panels.transfer_switch),
         generator_id = NULL,
         transfer_switch = ''
   WHERE generator_id IS NOT NULL AND transfer_switch != '';
  `,
  `
  -- Power devices between a breaker and what it feeds: transformers (the 480 V to 208 V step),
  -- disconnects, UPSs, and the utility service and meter at the top. Each is fed from a breaker
  -- or from another device; panels can be fed from one too.
  CREATE TABLE power_devices (
    id                  INTEGER PRIMARY KEY,
    location_id         INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    kind                TEXT NOT NULL CHECK (kind IN ('transformer', 'disconnect', 'ups', 'service')),
    name                TEXT NOT NULL,
    kva                 REAL,
    voltage             TEXT NOT NULL DEFAULT '',
    secondary_voltage   TEXT NOT NULL DEFAULT '',
    amps                INTEGER,
    fused               INTEGER NOT NULL DEFAULT 0,
    fuse_amps           INTEGER,
    runtime_minutes     INTEGER,
    meter               TEXT NOT NULL DEFAULT '',
    utility             TEXT NOT NULL DEFAULT '',
    manufacturer        TEXT NOT NULL DEFAULT '',
    model               TEXT NOT NULL DEFAULT '',
    notes               TEXT NOT NULL DEFAULT '',
    fed_from_breaker_id INTEGER REFERENCES breakers (id) ON DELETE SET NULL,
    fed_from_device_id  INTEGER REFERENCES power_devices (id) ON DELETE SET NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );
  CREATE INDEX power_devices_location ON power_devices (location_id);
  CREATE INDEX power_devices_fed_breaker ON power_devices (fed_from_breaker_id);
  CREATE INDEX power_devices_fed_device ON power_devices (fed_from_device_id);
  ALTER TABLE panels ADD COLUMN fed_from_device_id INTEGER REFERENCES power_devices (id) ON DELETE SET NULL;
  CREATE INDEX panels_fed_device ON panels (fed_from_device_id);

  -- Nameplate details from panel schedules.
  ALTER TABLE panels ADD COLUMN aic_ka INTEGER;
  ALTER TABLE panels ADD COLUMN bus_amps INTEGER;
  ALTER TABLE panels ADD COLUMN mounting TEXT NOT NULL DEFAULT '';
  ALTER TABLE panels ADD COLUMN enclosure TEXT NOT NULL DEFAULT '';
  ALTER TABLE panels ADD COLUMN feeder_wire TEXT NOT NULL DEFAULT '';
  ALTER TABLE panels ADD COLUMN feeder_conduit TEXT NOT NULL DEFAULT '';

  -- Transfer switch duty (NEC 700 emergency, 701 legally required, 702 optional standby),
  -- transition, and the order loads come back on.
  ALTER TABLE transfer_switches ADD COLUMN duty TEXT NOT NULL DEFAULT ''
    CHECK (duty IN ('', 'emergency', 'legally-required', 'optional'));
  ALTER TABLE transfer_switches ADD COLUMN transition TEXT NOT NULL DEFAULT ''
    CHECK (transition IN ('', 'open', 'closed', 'delayed'));
  ALTER TABLE transfer_switches ADD COLUMN priority INTEGER;

  -- Generator fuel tank and runtime at load.
  ALTER TABLE generators ADD COLUMN tank_gallons INTEGER;
  ALTER TABLE generators ADD COLUMN runtime_hours REAL;
  `,
];
