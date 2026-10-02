-- =========================================================
-- TracePoint — Phase 1 schema
-- Kiosks, components, component_events (append-only), users,
-- audit_logs. Faults/alerts come in Phase 2.
-- =========================================================

-- Needed for pg_trgm ILIKE search index (see components indexes below)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------
-- users
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    role          TEXT NOT NULL CHECK (role IN ('Field Technician', 'Maintenance Supervisor', 'IT/Systems Administrator')),
    status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Disabled')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- ---------------------------------------------------------
-- kiosks
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS kiosks (
    id           SERIAL PRIMARY KEY,
    kiosk_code   TEXT NOT NULL UNIQUE,      -- e.g. KSK-018, the human-facing ID
    location     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'In Maintenance', 'Decommissioned')),
    installed_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kiosks_location_trgm ON kiosks USING GIN (location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kiosks_code_trgm ON kiosks USING GIN (kiosk_code gin_trgm_ops);

-- ---------------------------------------------------------
-- components
-- current kiosk_id is a derived convenience column — the source
-- of truth for "current location" is really the latest
-- component_events row, kept in sync in the same transaction.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS components (
    id                  SERIAL PRIMARY KEY,
    serial              TEXT NOT NULL UNIQUE,     -- FR-1.1, FR-1.3 (no duplicate registration)
    type                TEXT NOT NULL,            -- e.g. Motor, Control Board, Wiring Harness
    manufacturer        TEXT,
    model               TEXT,
    kiosk_id            INTEGER REFERENCES kiosks(id),  -- NULL = in storage
    status              TEXT NOT NULL DEFAULT 'In Storage'
                          CHECK (status IN ('Installed', 'In Storage', 'Missing', 'Decommissioned')),
    warranty_start      DATE,
    warranty_expires_on DATE,
    expected_life_months INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_components_serial_trgm ON components USING GIN (serial gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_components_type_trgm ON components USING GIN (type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_components_kiosk_id ON components (kiosk_id);

-- ---------------------------------------------------------
-- component_events — append-only history (NFR-3)
-- Every movement, install, removal, fault-flag, decommission,
-- maintenance action. Never UPDATEd or DELETEd by the app.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS component_events (
    id             SERIAL PRIMARY KEY,
    component_id   INTEGER NOT NULL REFERENCES components(id),
    event_type     TEXT NOT NULL CHECK (event_type IN (
                       'Installed', 'Moved', 'Removed to Storage',
                       'Decommissioned', 'Maintenance Performed',
                       'Fault Reported', 'Marked Missing'
                   )),
    from_kiosk_id  INTEGER REFERENCES kiosks(id),
    to_kiosk_id    INTEGER REFERENCES kiosks(id),
    reason         TEXT,
    notes          TEXT,
    performed_by   INTEGER NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_component_events_component_id ON component_events (component_id);
CREATE INDEX IF NOT EXISTS idx_component_events_created_at ON component_events (created_at DESC);

-- Enforce immutability at the database level (NFR-3): the app's
-- normal DB role should not have UPDATE/DELETE on this table.
-- (Run separately as a superuser once the app role exists, e.g.:)
-- REVOKE UPDATE, DELETE ON component_events FROM tracepoint_app;

-- ---------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id           SERIAL PRIMARY KEY,
    action       TEXT NOT NULL,
    description  TEXT,
    performed_by INTEGER NOT NULL REFERENCES users(id),
    role         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);

-- ---------------------------------------------------------
-- faults — FR-4.1: a fault is logged against EITHER a
-- component OR a kiosk, never both, never neither.
-- FR-4.2/FR-4.3: querying by component_id or kiosk_id gives
-- each view its own history, independent of the other.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS faults (
    id            SERIAL PRIMARY KEY,
    component_id  INTEGER REFERENCES components(id),
    kiosk_id      INTEGER REFERENCES kiosks(id),
    severity      TEXT NOT NULL CHECK (severity IN ('Low', 'Medium', 'High')),
    description   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Resolved')),
    reported_by   INTEGER NOT NULL REFERENCES users(id),
    resolution    TEXT,
    resolved_by   INTEGER REFERENCES users(id),
    resolved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fault_has_exactly_one_target CHECK (
        (component_id IS NOT NULL AND kiosk_id IS NULL) OR
        (component_id IS NULL AND kiosk_id IS NOT NULL)
    )
);

ALTER TABLE faults ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE faults ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id);
ALTER TABLE faults ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_faults_component_id ON faults (component_id);
CREATE INDEX IF NOT EXISTS idx_faults_kiosk_id ON faults (kiosk_id);
CREATE INDEX IF NOT EXISTS idx_faults_status ON faults (status);

