-- ===========================================================================
--  Safari Park Project  -  Authority Engagement Tracker
--  Database schema (PostgreSQL)
--
--  Three-level model:  AUTHORITY  ->  SUB-DIVISION  ->  COMMUNICATION
--  Meetings and uploaded documents attach to the levels above.
--  Derived values (engagement status, overdue flags, counts) are computed
--  by the views at the foot of this file, never stored.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  USERS  -  individual logins. Three roles:
--    super_admin  manages accounts (invite, change role, disable, force MFA)
--    admin        ECG editors — may write
--    reviewer     read-only (Client, Egis, Safari Park Doha)
--  password_hash is nullable: invited users hold a one-time invite token in
--  auth_tokens until they set their own password via /accept-invite.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT        NOT NULL,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT,
    role          TEXT        NOT NULL DEFAULT 'reviewer',
    organisation  TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- Idempotent migration of the users table from the original (editor, viewer)
-- shape. Safe to re-run: rename UPDATEs match nothing the second time, and
-- the new CHECK is only added if it isn't already present.
DO $migrate_users$
BEGIN
    -- Allow nullable password_hash for invite-pending accounts.
    BEGIN
        EXECUTE 'ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL';
    EXCEPTION WHEN OTHERS THEN
        -- already nullable
        NULL;
    END;

    -- Drop the old CHECK on (editor, viewer) if it survives from v1.
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check';

    -- Backfill old role values.
    EXECUTE $upd$UPDATE users SET role = 'admin'    WHERE role = 'editor'$upd$;
    EXECUTE $upd$UPDATE users SET role = 'reviewer' WHERE role = 'viewer'$upd$;

    -- Reattach CHECK with the new role vocabulary.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname  = 'users_role_check'
          AND  conrelid = 'users'::regclass
    ) THEN
        EXECUTE 'ALTER TABLE users ADD CONSTRAINT users_role_check
                 CHECK (role IN (''super_admin'', ''admin'', ''reviewer''))';
    END IF;
END
$migrate_users$;

-- Additive security / account-lifecycle columns. Each guarded with
-- IF NOT EXISTS so reruns are safe.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version        INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count   INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes     JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled          BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by           INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at           TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN     NOT NULL DEFAULT FALSE;

DO $fk_invited_by$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname  = 'users_invited_by_fkey'
          AND  conrelid = 'users'::regclass
    ) THEN
        EXECUTE 'ALTER TABLE users ADD CONSTRAINT users_invited_by_fkey
                 FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL';
    END IF;
END
$fk_invited_by$;

-- ---------------------------------------------------------------------------
--  AUTH_TOKENS  -  single-use tokens for account invitations and password
--  resets. Only the SHA-256 hash is stored; the plaintext is emailed once
--  and never written to the database.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL CHECK (kind IN ('invite', 'reset')),
    token_hash  TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);

-- ---------------------------------------------------------------------------
--  AUDIT_EVENTS  -  unified audit trail for auth events and data CRUD.
--  actor_id is nullable because failed-login attempts and forgot-password
--  requests have no signed-in actor; payload is a JSONB free-form blob so
--  individual event types can carry their own shape.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    event_type  TEXT        NOT NULL,
    target_type TEXT,
    target_id   INTEGER,
    payload     JSONB,
    ip          TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor      ON audit_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target     ON audit_events(target_type, target_id, created_at DESC);

-- ---------------------------------------------------------------------------
--  AUTHORITIES  -  parent register. "code" (KM, PWA) is the natural key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS authorities (
    id                  SERIAL PRIMARY KEY,
    code                TEXT        NOT NULL UNIQUE,
    name                TEXT        NOT NULL,
    category            TEXT        NOT NULL,
    influence_level     TEXT,
    decision_authority  TEXT,
    engagement_strategy TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
--  SUB-DIVISIONS  -  each belongs to one authority. sub_reference (KM-S01)
--  is generated from the authority code and a per-authority sequence number.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_divisions (
    id                      SERIAL PRIMARY KEY,
    authority_id            INTEGER NOT NULL REFERENCES authorities(id) ON DELETE CASCADE,
    seq_no                  INTEGER NOT NULL,
    sub_reference           TEXT    NOT NULL UNIQUE,
    name                    TEXT    NOT NULL,
    discipline              TEXT,
    primary_objective       TEXT,
    target_stage            TEXT,
    date_identified         DATE,
    primary_contact         TEXT,
    designation             TEXT,
    contact_details         TEXT,
    data_collection_status  TEXT    NOT NULL DEFAULT 'Not Started',
    consultation_status     TEXT    NOT NULL DEFAULT 'Not Started',
    noc_status              TEXT    NOT NULL DEFAULT 'Not Started',
    outcome_secured         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (authority_id, seq_no)
);

-- ---------------------------------------------------------------------------
--  COMMUNICATIONS  -  one row per event. comm_code (C-0001) is generated.
--  An Inbound row may reference the Outbound row it replies to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communications (
    id                   SERIAL PRIMARY KEY,
    comm_code            TEXT    NOT NULL UNIQUE,
    sub_division_id      INTEGER NOT NULL REFERENCES sub_divisions(id) ON DELETE CASCADE,
    comm_date            DATE    NOT NULL,
    direction            TEXT    NOT NULL CHECK (direction IN ('Outbound', 'Inbound')),
    purpose              TEXT,
    mode                 TEXT,
    submission_reference TEXT,
    in_response_to       INTEGER REFERENCES communications(id) ON DELETE SET NULL,
    summary              TEXT,
    reply_needed         BOOLEAN NOT NULL DEFAULT FALSE,
    acc_link             TEXT,
    logged_by            TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
--  MEETINGS  -  attendees, outcomes and actions live in the MoM; this table
--  records the meeting and points to the MoM only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
    id                   SERIAL PRIMARY KEY,
    meeting_code         TEXT    NOT NULL UNIQUE,
    authority_id         INTEGER NOT NULL REFERENCES authorities(id) ON DELETE CASCADE,
    primary_sub_id       INTEGER REFERENCES sub_divisions(id) ON DELETE SET NULL,
    other_sub_divisions  TEXT,
    meeting_date         DATE    NOT NULL,
    purpose              TEXT,
    mode                 TEXT,
    location             TEXT,
    mom_reference        TEXT,
    mom_link             TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
--  DOCUMENTS  -  files uploaded into the platform. Each attaches to exactly
--  one parent row (a communication or a meeting).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id             SERIAL PRIMARY KEY,
    parent_type    TEXT    NOT NULL CHECK (parent_type IN ('communication', 'meeting')),
    parent_id      INTEGER NOT NULL,
    original_name  TEXT    NOT NULL,
    stored_name    TEXT    NOT NULL,
    mime_type      TEXT,
    size_bytes     BIGINT,
    uploaded_by    TEXT,
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subdiv_authority   ON sub_divisions(authority_id);
CREATE INDEX IF NOT EXISTS idx_comm_subdiv        ON communications(sub_division_id);
CREATE INDEX IF NOT EXISTS idx_comm_response      ON communications(in_response_to);
CREATE INDEX IF NOT EXISTS idx_meeting_authority  ON meetings(authority_id);
CREATE INDEX IF NOT EXISTS idx_doc_parent         ON documents(parent_type, parent_id);

-- ---------------------------------------------------------------------------
--  SOFT-DELETE  -  every data table gets deleted_at + deleted_by +
--  deletion_group_id. NULL deleted_at means the row is live; a non-NULL value
--  means it sits in Trash. deletion_group_id ties cascaded deletes together,
--  so the restore-from-trash operation atomically brings back every row that
--  was removed in the same click.
-- ---------------------------------------------------------------------------
ALTER TABLE authorities    ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;
ALTER TABLE authorities    ADD COLUMN IF NOT EXISTS deleted_by         INTEGER;
ALTER TABLE authorities    ADD COLUMN IF NOT EXISTS deletion_group_id  UUID;

ALTER TABLE sub_divisions  ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;
ALTER TABLE sub_divisions  ADD COLUMN IF NOT EXISTS deleted_by         INTEGER;
ALTER TABLE sub_divisions  ADD COLUMN IF NOT EXISTS deletion_group_id  UUID;

ALTER TABLE communications ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS deleted_by         INTEGER;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS deletion_group_id  UUID;

ALTER TABLE meetings       ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;
ALTER TABLE meetings       ADD COLUMN IF NOT EXISTS deleted_by         INTEGER;
ALTER TABLE meetings       ADD COLUMN IF NOT EXISTS deletion_group_id  UUID;

ALTER TABLE documents      ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;
ALTER TABLE documents      ADD COLUMN IF NOT EXISTS deleted_by         INTEGER;
ALTER TABLE documents      ADD COLUMN IF NOT EXISTS deletion_group_id  UUID;
-- Storage backend per document: 'disk' or 's3'. Defaults to 'disk' for
-- back-compat — anything pre-3d migration lives on local disk.
ALTER TABLE documents      ADD COLUMN IF NOT EXISTS storage_backend    TEXT NOT NULL DEFAULT 'disk';

-- ---------------------------------------------------------------------------
--  FULL-TEXT SEARCH  -  generated tsvector columns over the text-heavy
--  fields. Generated columns (Postgres 12+) update themselves on every
--  insert / update so we don't need triggers.
-- ---------------------------------------------------------------------------
ALTER TABLE communications ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple',  coalesce(comm_code, '')),            'A') ||
      setweight(to_tsvector('english', coalesce(purpose, '')),              'B') ||
      setweight(to_tsvector('english', coalesce(mode, '')),                 'B') ||
      setweight(to_tsvector('simple',  coalesce(submission_reference, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(summary, '')),              'C')
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_comm_search ON communications USING GIN (search_tsv);

-- ---------------------------------------------------------------------------
--  SAVED VIEWS  -  per-user named filter presets, one row per saved set.
--  `params` is the same shape the list-page filter bar sends to the API.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_views (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target      TEXT        NOT NULL CHECK (target IN
                  ('communications', 'sub_divisions', 'meetings')),
    name        TEXT        NOT NULL,
    params      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, target, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id, target);

-- ---------------------------------------------------------------------------
--  COMMENTS  -  free-text discussion threaded against a record. Soft-
--  deletable. Author can edit their own (sets edited_at); author or
--  super-admin can delete.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
    id              SERIAL PRIMARY KEY,
    parent_type     TEXT        NOT NULL CHECK (parent_type IN
                      ('communication', 'sub_division', 'meeting', 'authority')),
    parent_id       INTEGER     NOT NULL,
    author_id       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    body            TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    deleted_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    deletion_group_id UUID
);

CREATE INDEX IF NOT EXISTS idx_comments_parent
    ON comments(parent_type, parent_id, created_at)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_author
    ON comments(author_id)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
--  TASKS  -  actionable follow-up items. Polymorphic to any record but
--  most naturally hangs off a sub_division (engagement thread) or a
--  communication (the specific event needing follow-up).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id              SERIAL PRIMARY KEY,
    parent_type     TEXT        NOT NULL CHECK (parent_type IN
                      ('communication', 'sub_division', 'meeting', 'authority')),
    parent_id       INTEGER     NOT NULL,
    title           TEXT        NOT NULL,
    description     TEXT,
    status          TEXT        NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'done')),
    assignee_id     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    due_date        DATE,
    created_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    completed_by    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    deleted_at      TIMESTAMPTZ,
    deleted_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    deletion_group_id UUID
);

CREATE INDEX IF NOT EXISTS idx_tasks_parent
    ON tasks(parent_type, parent_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_open
    ON tasks(assignee_id, due_date)
    WHERE deleted_at IS NULL AND status = 'open';
CREATE INDEX IF NOT EXISTS idx_tasks_overdue
    ON tasks(due_date)
    WHERE deleted_at IS NULL AND status = 'open' AND due_date IS NOT NULL;

-- Stamped when a "due tomorrow" reminder email has been sent, so the daily
-- reminder job never emails the same task twice. Reset to NULL when the due
-- date changes or the task is reopened, so a fresh reminder can fire.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Communications: an optional "related to" link — a different letter / thread
-- this one relates to. Distinct from in_response_to, which is a direct reply.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS related_to INTEGER REFERENCES communications(id) ON DELETE SET NULL;

-- Meetings: optional time-of-day, and a MoM (Minutes of Meeting) status that
-- drives a red/amber/green indicator. Defaults to 'pending' so a freshly
-- logged meeting flags that its minutes are still outstanding.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_time TIME;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS mom_status TEXT NOT NULL DEFAULT 'pending';
-- Attendees recorded as free text — company names only, e.g. "ECG, Egis, KM".
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS attendees TEXT;

-- Sub-divisions: split contact into a dedicated email + phone. The legacy
-- free-text contact_details column is kept for historical values.
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- Rename the old "NOC" purpose to "NOC / Approval" on existing rows so they
-- match the updated dropdown. Idempotent (the second run matches nothing).
UPDATE communications SET purpose = 'NOC / Approval' WHERE purpose = 'NOC';
UPDATE meetings       SET purpose = 'NOC / Approval' WHERE purpose = 'NOC';

ALTER TABLE meetings       ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple',  coalesce(meeting_code, '')),       'A') ||
      setweight(to_tsvector('english', coalesce(purpose, '')),            'B') ||
      setweight(to_tsvector('english', coalesce(location, '')),           'B') ||
      setweight(to_tsvector('simple',  coalesce(mom_reference, '')),      'B') ||
      setweight(to_tsvector('english', coalesce(other_sub_divisions, '')),'C')
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_meeting_search ON meetings USING GIN (search_tsv);

-- deleted_by foreign keys (ON DELETE SET NULL so audit survives staff turnover).
DO $deleted_by_fks$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['authorities','sub_divisions','communications','meetings','documents'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = t || '_deleted_by_fkey'
              AND conrelid = t::regclass
        ) THEN
            EXECUTE format(
              'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL',
              t, t || '_deleted_by_fkey'
            );
        END IF;
    END LOOP;
END
$deleted_by_fks$;

-- Partial indexes — most queries filter deleted_at IS NULL, and the Trash
-- page filters deleted_at IS NOT NULL. Both benefit from a tight index.
CREATE INDEX IF NOT EXISTS idx_auth_live      ON authorities    (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subdiv_live    ON sub_divisions  (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comm_live      ON communications (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_live   ON meetings       (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_live       ON documents      (id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_trash     ON authorities    (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subdiv_trash   ON sub_divisions  (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_trash     ON communications (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_trash  ON meetings       (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_trash      ON documents      (deleted_at) WHERE deleted_at IS NOT NULL;

-- ===========================================================================
--  VIEWS  -  all derived values. The application reads these, never the
--  base tables directly, so the engagement rules live in one place.
-- ===========================================================================

-- All views below filter `deleted_at IS NULL` on every joined base table so
-- soft-deleted rows are invisible to the application. The Trash page queries
-- the base tables directly with `deleted_at IS NOT NULL`.

-- CREATE OR REPLACE VIEW can't handle a column-list change when soft-delete
-- columns get added to the base tables (the `.*` expansion grows). Drop the
-- chain once with CASCADE so the recreate below runs cleanly. The DROP is
-- idempotent and cheap: views are pure derivations.
DROP VIEW IF EXISTS v_communication CASCADE;

-- Communication with computed reply_received and overdue flags.
CREATE OR REPLACE VIEW v_communication AS
SELECT
    c.*,
    sd.sub_reference,
    sd.name        AS sub_division_name,
    a.id           AS authority_id,
    a.code         AS authority_code,
    a.name         AS authority_name,
    EXISTS (
        SELECT 1 FROM communications r
        WHERE r.in_response_to = c.id AND r.deleted_at IS NULL
    )              AS reply_received,
    (
        c.direction = 'Outbound'
        AND c.reply_needed = TRUE
        AND NOT EXISTS (
            SELECT 1 FROM communications r
            WHERE r.in_response_to = c.id AND r.deleted_at IS NULL
        )
        AND (CURRENT_DATE - c.comm_date) > 7
    )              AS is_overdue,
    (SELECT count(*) FROM documents d
       WHERE d.parent_type = 'communication'
         AND d.parent_id = c.id
         AND d.deleted_at IS NULL) AS document_count,
    -- The code of the communication THIS row replies to (for inbound replies).
    parent.comm_code AS in_response_to_code,
    -- The code of the reply that answered THIS row (for outbound that got a
    -- reply). Earliest live reply wins if there is more than one.
    (SELECT r.comm_code FROM communications r
       WHERE r.in_response_to = c.id AND r.deleted_at IS NULL
       ORDER BY r.comm_date, r.id LIMIT 1) AS reply_code,
    -- The code of a related (non-reply) communication this row points to.
    relparent.comm_code AS related_to_code
FROM communications c
JOIN sub_divisions sd ON sd.id = c.sub_division_id AND sd.deleted_at IS NULL
JOIN authorities  a  ON a.id  = sd.authority_id   AND a.deleted_at  IS NULL
LEFT JOIN communications parent
       ON parent.id = c.in_response_to AND parent.deleted_at IS NULL
LEFT JOIN communications relparent
       ON relparent.id = c.related_to AND relparent.deleted_at IS NULL
WHERE c.deleted_at IS NULL;

-- Sub-division with rolled-up counts, engagement-ladder status, last activity.
CREATE OR REPLACE VIEW v_sub_division AS
SELECT
    sd.*,
    a.code AS authority_code,
    a.name AS authority_name,
    a.category AS authority_category,
    COALESCE(s.outbound_count, 0)  AS outbound_count,
    COALESCE(s.inbound_count, 0)   AS inbound_count,
    COALESCE(s.overdue_count, 0)   AS overdue_count,
    s.last_activity,
    CASE
        WHEN COALESCE(s.outbound_count,0) + COALESCE(s.inbound_count,0) = 0
            THEN 'Identified'
        WHEN COALESCE(s.inbound_count,0) = 0
            THEN 'Contacted'
        WHEN sd.outcome_secured = TRUE
            THEN 'Outcome Secured'
        ELSE 'Response Received'
    END AS engagement_status
FROM sub_divisions sd
JOIN authorities a ON a.id = sd.authority_id AND a.deleted_at IS NULL
LEFT JOIN (
    SELECT
        vc.sub_division_id,
        count(*) FILTER (WHERE vc.direction = 'Outbound') AS outbound_count,
        count(*) FILTER (WHERE vc.direction = 'Inbound')  AS inbound_count,
        count(*) FILTER (WHERE vc.is_overdue)             AS overdue_count,
        max(vc.comm_date)                                 AS last_activity
    FROM v_communication vc
    GROUP BY vc.sub_division_id
) s ON s.sub_division_id = sd.id
WHERE sd.deleted_at IS NULL;

-- Authority with sub-division counts.
CREATE OR REPLACE VIEW v_authority AS
SELECT
    a.*,
    COALESCE(x.sub_count, 0)      AS sub_division_count,
    COALESCE(x.engaged_count, 0)  AS sub_divisions_engaged,
    COALESCE(x.outcome_count, 0)  AS outcome_secured_count
FROM authorities a
LEFT JOIN (
    SELECT
        authority_id,
        count(*)                                                AS sub_count,
        count(*) FILTER (WHERE engagement_status <> 'Identified') AS engaged_count,
        count(*) FILTER (WHERE engagement_status = 'Outcome Secured') AS outcome_count
    FROM v_sub_division
    GROUP BY authority_id
) x ON x.authority_id = a.id
WHERE a.deleted_at IS NULL;
