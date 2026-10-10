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
];
