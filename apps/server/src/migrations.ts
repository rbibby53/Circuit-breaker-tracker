// Append-only. Never edit a migration that has shipped; add a new one instead.
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
];
