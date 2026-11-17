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
-- The 30-second step of the last sign-in code used, so it can't be used twice.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step        BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled          BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by           INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at           TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN     NOT NULL DEFAULT FALSE;
-- Exempt an account from the mandatory TOTP second factor (for internal SPD
-- staff who sign in with username + password only). Super-admin controlled.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_exempt           BOOLEAN     NOT NULL DEFAULT FALSE;

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

-- Additional contacts for a sub-division, beyond the primary contact held on
-- the sub_divisions row itself. One row per extra business card (name, role,
-- email, phone). Fully owned by the parent: the edit form replaces this set,
-- and a hard delete of the sub-division cascades these away.
CREATE TABLE IF NOT EXISTS sub_division_contacts (
    id              SERIAL PRIMARY KEY,
    sub_division_id INTEGER NOT NULL REFERENCES sub_divisions(id) ON DELETE CASCADE,
    name            TEXT,
    designation     TEXT,
    email           TEXT,
    phone           TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sdc_sub ON sub_division_contacts(sub_division_id);

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

-- Who carried the correspondence or held the meeting. The Client (SPD) and its
-- PMC (EGIS) deal with authorities directly and pass the letters to us for the
-- record; those count as engagement but are not ours to chase, so the 7-day
-- overdue rule applies to ECG only. Direction is read from the originator's side.
ALTER TABLE communications ADD COLUMN IF NOT EXISTS originator TEXT NOT NULL DEFAULT 'ECG';
ALTER TABLE meetings       ADD COLUMN IF NOT EXISTS originator TEXT NOT NULL DEFAULT 'ECG';
ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_originator_check;
ALTER TABLE communications ADD CONSTRAINT communications_originator_check
  CHECK (originator IN ('ECG', 'SPD', 'EGIS'));
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_originator_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_originator_check
  CHECK (originator IN ('ECG', 'SPD', 'EGIS'));

-- The latest action on a letter, in a line: "met them on 3 Nov, waiting for
-- their comments". Shown in the log and the Excel export.
ALTER TABLE communications ADD COLUMN IF NOT EXISTS latest_update TEXT;

-- Sub-divisions: split contact into a dedicated email + phone. The legacy
-- free-text contact_details column is kept for historical values.
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- Trusted devices — a browser that passed MFA can be remembered so the second
-- factor is skipped for ~30 days. The browser holds a random secret in an
-- httpOnly cookie; only its SHA-256 hash is stored here, bound to one user.
-- Opt-in, revocable, and wiped when that user's password changes.
CREATE TABLE IF NOT EXISTS trusted_devices (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT    NOT NULL UNIQUE,
    label        TEXT,
    ip           TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);

-- ---------------------------------------------------------------------------
--  QDRS records — the Qatar Design Review System (Ashghal / PWA) log. One row
--  per "data received" event: when data/responses arrived via QDRS, from which
--  sub-authority (sub-division), plus the uploaded documents. qdrs_code
--  (Q-0001) is server-assigned once and never changes, exactly like comms.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qdrs_records (
    id              SERIAL PRIMARY KEY,
    qdrs_code       TEXT    NOT NULL UNIQUE,
    sub_division_id INTEGER NOT NULL REFERENCES sub_divisions(id) ON DELETE CASCADE,
    qdrs_date       DATE    NOT NULL,
    reference       TEXT,
    category        TEXT,
    summary         TEXT,
    logged_by       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE qdrs_records ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ;
ALTER TABLE qdrs_records ADD COLUMN IF NOT EXISTS deleted_by        INTEGER;
ALTER TABLE qdrs_records ADD COLUMN IF NOT EXISTS deletion_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_qdrs_subdiv ON qdrs_records(sub_division_id);
CREATE INDEX IF NOT EXISTS idx_qdrs_live   ON qdrs_records(id) WHERE deleted_at IS NULL;
ALTER TABLE qdrs_records ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple',  coalesce(qdrs_code, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(category, '')),  'B') ||
      setweight(to_tsvector('simple',  coalesce(reference, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(summary, '')),   'C')
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_qdrs_search ON qdrs_records USING GIN (search_tsv);

-- Documents may now attach to a QDRS record too (was: communication / meeting).
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_parent_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_parent_type_check
  CHECK (parent_type IN ('communication', 'meeting', 'qdrs'));

-- Folder uploads: the relative directory a file came from (e.g. "Drawings/Civil"),
-- NULL for a loose file. Lets the UI rebuild a virtual folder tree per record.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_path TEXT;

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

-- ---------------------------------------------------------------------------
--  STAKEHOLDER ENGAGEMENT  -  the matrix, the assessment and the action
--  register that replace the hand-maintained "Stakeholder Engagement Matrix"
--  workbook. Three ideas hold it together:
--
--   1. Ratings live on the SUB-DIVISION, never the authority. KAHRAMAA has no
--      rating of its own; Water and Electricity are rated separately and do
--      differ. An authority with one sub-division simply shows that one.
--   2. An action's STATUS IS NOT STORED. It is derived from the progress
--      rows: none = Pending, some = Open/Ongoing, a closure row = Closed.
--      Nobody can claim progress without registering the evidence for it.
--   3. Every source points at a REGISTERED record (meeting / communication /
--      QDRS). 'external' is allowed but must carry a reference, and the UI
--      flags it, so an unevidenced claim is visible rather than silent.
-- ---------------------------------------------------------------------------

-- Stakeholder ratings, held on the engaging unit. Plain TEXT validated against
-- the reference lists in routes/lists.js, matching how discipline / noc_status
-- already work.
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS influence              TEXT; -- 'H' | 'L'
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS involvement            TEXT; -- 'H' | 'L'
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS engagement_current     TEXT; -- Unaware..Leading
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS engagement_desired     TEXT; -- Unaware..Leading
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS communication_priority TEXT; -- 'A'..'D'
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS gap_remarks            TEXT;
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS gap_action_by          TEXT;

-- The "Action By" vocabulary. A managed list so ECG / SPD / EGIS stay one
-- spelling each; optionally tied to an authority so PWA means one thing.
CREATE TABLE IF NOT EXISTS engagement_orgs (
    id           SERIAL PRIMARY KEY,
    name         TEXT    NOT NULL UNIQUE,
    authority_id INTEGER REFERENCES authorities(id) ON DELETE SET NULL,
    is_internal  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per action. No status column by design (see note 2 above). The
-- action's place under its stakeholder (action_no, added below) is stored, so
-- 4.2.3 stays 4.2.3 when an earlier action is deleted or a back-dated one added.
CREATE TABLE IF NOT EXISTS engagement_actions (
    id                      SERIAL PRIMARY KEY,
    sub_division_id         INTEGER NOT NULL REFERENCES sub_divisions(id) ON DELETE CASCADE,
    description             TEXT    NOT NULL,
    source_type             TEXT    NOT NULL,
    source_id               INTEGER,
    source_ref_external     TEXT,
    recorded_date           DATE,
    notes                   TEXT,
    due_milestone           TEXT,
    due_date                DATE,
    -- Deliberate exits from the register. Each is refused without its reason.
    resolution              TEXT,
    cancel_reason           TEXT,
    superseded_by_id        INTEGER REFERENCES engagement_actions(id) ON DELETE SET NULL,
    superseded_ref_external TEXT,
    created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    deleted_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deletion_group_id       UUID
);

-- The evidence rules live here as explicit DROP/ADD rather than inline in the
-- CREATE above, because CREATE TABLE IF NOT EXISTS silently skips a table that
-- already exists — a rule tightened later would never reach production. Same
-- pattern already used for documents_parent_type_check.
--
-- Names follow Postgres's own <table>_<column>_check convention, so if a check
-- is ever written inline again the DROP still finds it. Any name used by an
-- earlier revision is dropped here too, so an environment that ran one of
-- those converges instead of carrying a stale rule alongside the current one.
ALTER TABLE engagement_actions
  DROP CONSTRAINT IF EXISTS engagement_actions_resolution_reason_check;
ALTER TABLE engagement_actions
  DROP CONSTRAINT IF EXISTS engagement_actions_source_type_check;
ALTER TABLE engagement_actions
  ADD  CONSTRAINT engagement_actions_source_type_check
  CHECK (source_type IN ('meeting', 'communication', 'qdrs', 'external'));

-- A system source must name the record; an external one must carry a reference.
ALTER TABLE engagement_actions
  DROP CONSTRAINT IF EXISTS engagement_actions_source_check;
ALTER TABLE engagement_actions
  ADD  CONSTRAINT engagement_actions_source_check CHECK (
      (source_type = 'external'
         AND source_ref_external IS NOT NULL AND btrim(source_ref_external) <> '')
   OR (source_type <> 'external' AND source_id IS NOT NULL)
  );

-- Cancelled states why; superseded names what replaced it.
ALTER TABLE engagement_actions
  DROP CONSTRAINT IF EXISTS engagement_actions_resolution_check;
ALTER TABLE engagement_actions
  ADD  CONSTRAINT engagement_actions_resolution_check CHECK (
      resolution IS NULL
   OR (resolution = 'cancelled'
         AND cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')
   OR (resolution = 'superseded'
         AND (superseded_by_id IS NOT NULL
           OR (superseded_ref_external IS NOT NULL
                 AND btrim(superseded_ref_external) <> '')))
  );
CREATE INDEX IF NOT EXISTS idx_eng_action_sub  ON engagement_actions(sub_division_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_eng_action_live ON engagement_actions(id)
    WHERE deleted_at IS NULL;

-- Who owns an action. Many-to-many so "ECG / WA / Zoo Solutions" is three
-- tags rather than one unsearchable string.
CREATE TABLE IF NOT EXISTS engagement_action_orgs (
    action_id  INTEGER NOT NULL REFERENCES engagement_actions(id) ON DELETE CASCADE,
    org_id     INTEGER NOT NULL REFERENCES engagement_orgs(id)    ON DELETE CASCADE,
    PRIMARY KEY (action_id, org_id)
);

-- An action raised under one stakeholder but relevant to others.
CREATE TABLE IF NOT EXISTS engagement_action_links (
    action_id       INTEGER NOT NULL REFERENCES engagement_actions(id) ON DELETE CASCADE,
    sub_division_id INTEGER NOT NULL REFERENCES sub_divisions(id)      ON DELETE CASCADE,
    PRIMARY KEY (action_id, sub_division_id)
);

-- The timeline. Progress, closure, cancellation and supersession are all
-- entries here, so one action's whole history reads in a single sequence.
CREATE TABLE IF NOT EXISTS engagement_action_progress (
    id                  SERIAL PRIMARY KEY,
    action_id           INTEGER NOT NULL REFERENCES engagement_actions(id) ON DELETE CASCADE,
    kind                TEXT    NOT NULL DEFAULT 'progress',
    entry_date          DATE    NOT NULL,
    note                TEXT    NOT NULL,
    source_type         TEXT,
    source_id           INTEGER,
    source_ref_external TEXT,
    created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A handful of register entries carry no date and no reference of their own.
-- The workbook import (Aug 2026) kept those as they were, so the column
-- is nullable here; the API still requires a date on anything created in the
-- app. (Both statements are no-ops once already applied.)
ALTER TABLE engagement_actions ALTER COLUMN recorded_date DROP NOT NULL;
ALTER TABLE engagement_actions ADD COLUMN IF NOT EXISTS notes TEXT;

-- Legacy names from earlier revisions of this file.
ALTER TABLE engagement_action_progress
  DROP CONSTRAINT IF EXISTS engagement_progress_kind_check;
ALTER TABLE engagement_action_progress
  DROP CONSTRAINT IF EXISTS engagement_progress_source_check;
ALTER TABLE engagement_action_progress
  DROP CONSTRAINT IF EXISTS engagement_progress_closure_check;

ALTER TABLE engagement_action_progress
  DROP CONSTRAINT IF EXISTS engagement_action_progress_kind_check;
ALTER TABLE engagement_action_progress
  ADD  CONSTRAINT engagement_action_progress_kind_check
  CHECK (kind IN ('progress', 'closure', 'cancellation', 'supersession'));

ALTER TABLE engagement_action_progress
  DROP CONSTRAINT IF EXISTS engagement_action_progress_source_type_check;
ALTER TABLE engagement_action_progress
  ADD  CONSTRAINT engagement_action_progress_source_type_check
  CHECK (source_type IS NULL
      OR source_type IN ('meeting', 'communication', 'qdrs', 'external'));

-- Same evidence rule as the action itself, applied per entry.
ALTER TABLE engagement_action_progress
  DROP CONSTRAINT IF EXISTS engagement_action_progress_source_check;
ALTER TABLE engagement_action_progress
  ADD  CONSTRAINT engagement_action_progress_source_check CHECK (
      source_type IS NULL
   OR (source_type = 'external'
         AND source_ref_external IS NOT NULL AND btrim(source_ref_external) <> '')
   OR (source_type <> 'external' AND source_id IS NOT NULL)
  );

-- Closure must cite a source. Progress may stand as a plain note.
ALTER TABLE engagement_action_progress
  DROP CONSTRAINT IF EXISTS engagement_action_progress_closure_check;
ALTER TABLE engagement_action_progress
  ADD  CONSTRAINT engagement_action_progress_closure_check CHECK (
      kind <> 'closure' OR source_type IS NOT NULL
  );
-- Removing a timeline entry has to be reversible: people delete the wrong
-- thing, and an evidence trail you cannot get back is worse than a cluttered
-- one. Soft-deleted here, same as everything else in the register.
ALTER TABLE engagement_action_progress ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE engagement_action_progress ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

CREATE INDEX IF NOT EXISTS idx_eng_progress_action
    ON engagement_action_progress(action_id, entry_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_eng_progress_live
    ON engagement_action_progress(action_id) WHERE deleted_at IS NULL;

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

-- Communication with computed reply_received, overdue and reply_status.
-- reply_received means "answered": for an Outbound letter the authority
-- replied; for an Inbound letter we replied.
CREATE OR REPLACE VIEW v_communication AS
SELECT
    c.*,
    sd.sub_reference,
    sd.name        AS sub_division_name,
    a.id           AS authority_id,
    a.code         AS authority_code,
    a.name         AS authority_name,
    ans.answered   AS reply_received,
    (
        c.direction = 'Outbound'
        AND c.originator = 'ECG'
        AND c.reply_needed = TRUE
        AND NOT ans.answered
        AND (CURRENT_DATE - c.comm_date) > 7
    )              AS is_overdue,
    -- One status for every screen and export. Outbound: are we waiting on the
    -- authority? Inbound: does the authority wait on us?
    CASE
      WHEN c.direction = 'Outbound' AND c.originator = 'ECG' AND c.reply_needed
           AND NOT ans.answered AND (CURRENT_DATE - c.comm_date) > 7 THEN 'Overdue'
      WHEN c.direction = 'Outbound' AND ans.answered                 THEN 'Reply received'
      WHEN c.direction = 'Outbound' AND c.reply_needed               THEN 'Awaiting reply'
      WHEN c.direction = 'Inbound'  AND ans.answered                 THEN 'We replied'
      WHEN c.direction = 'Inbound'  AND c.reply_needed               THEN 'Our reply due'
      ELSE 'No reply needed'
    END            AS reply_status,
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
CROSS JOIN LATERAL (
    SELECT EXISTS (
        SELECT 1 FROM communications r
        WHERE r.in_response_to = c.id AND r.deleted_at IS NULL
    ) AS answered
) ans
LEFT JOIN communications parent
       ON parent.id = c.in_response_to AND parent.deleted_at IS NULL
LEFT JOIN communications relparent
       ON relparent.id = c.related_to AND relparent.deleted_at IS NULL
WHERE c.deleted_at IS NULL;

-- QDRS record enriched with its sub-division + authority and document count.
DROP VIEW IF EXISTS v_qdrs CASCADE;
CREATE OR REPLACE VIEW v_qdrs AS
SELECT
    q.*,
    sd.sub_reference,
    sd.name        AS sub_division_name,
    a.id           AS authority_id,
    a.code         AS authority_code,
    a.name         AS authority_name,
    (SELECT count(*) FROM documents d
       WHERE d.parent_type = 'qdrs'
         AND d.parent_id = q.id
         AND d.deleted_at IS NULL) AS document_count
FROM qdrs_records q
JOIN sub_divisions sd ON sd.id = q.sub_division_id AND sd.deleted_at IS NULL
JOIN authorities  a  ON a.id  = sd.authority_id   AND a.deleted_at  IS NULL
WHERE q.deleted_at IS NULL;

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
    -- "Last activity" spans communications, meetings AND QDRS data received.
    GREATEST(s.last_activity, mt.last_meeting, qd.last_qdrs) AS last_activity,
    CASE
        -- Not contacted only when there has been NO communication, NO meeting
        -- and NO QDRS data received from them.
        WHEN COALESCE(s.outbound_count,0) + COALESCE(s.inbound_count,0) = 0
             AND COALESCE(mt.meeting_count,0) = 0
             AND COALESCE(qd.qdrs_count,0) = 0
            THEN 'Identified'
        -- A meeting, QDRS submission, or an outbound with no reply yet, all
        -- count as at least Contacted.
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
-- Meetings engage the sub-division they name as primary; that counts as contact.
LEFT JOIN (
    SELECT primary_sub_id AS sub_division_id,
           count(*)         AS meeting_count,
           max(meeting_date) AS last_meeting
    FROM meetings
    WHERE deleted_at IS NULL AND primary_sub_id IS NOT NULL
    GROUP BY primary_sub_id
) mt ON mt.sub_division_id = sd.id
-- Receiving QDRS data from a sub-division also means we've engaged with them.
LEFT JOIN (
    SELECT sub_division_id,
           count(*)        AS qdrs_count,
           max(qdrs_date)  AS last_qdrs
    FROM qdrs_records
    WHERE deleted_at IS NULL
    GROUP BY sub_division_id
) qd ON qd.sub_division_id = sd.id
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

-- v_engagement_action selects engagement_actions.*, so any column added to
-- that table widens the view — which CREATE OR REPLACE VIEW refuses. Drop the
-- pair first (cheap: they are pure derivations), same as v_communication above.
DROP VIEW IF EXISTS v_engagement_action CASCADE;
DROP VIEW IF EXISTS v_engagement_matrix CASCADE;
DROP VIEW IF EXISTS v_engagement_numbering CASCADE;

-- The weekly matrix numbers stakeholders its own way (MoECC is 7, not its
-- alphabetical place), and the register has to read the same as the file the
-- team submits. An authority keeps the number it has in that file; a
-- department keeps its place within the authority. Both are optional: anything
-- without one is numbered after them, alphabetically.
ALTER TABLE authorities   ADD COLUMN IF NOT EXISTS matrix_no  INTEGER;
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS matrix_seq INTEGER;
-- The matrix's own "Remarks" column: where things stand with this stakeholder,
-- in a sentence (the talking point the Meeting Brief reads out).
ALTER TABLE sub_divisions ADD COLUMN IF NOT EXISTS remarks    TEXT;

-- An action's place under its stakeholder (the 3 in 4.2.3). Given once when the
-- action is raised and never changed: the weekly file, emails and minutes quote
-- it. Trashed actions keep theirs, so a restore brings the same number back.
ALTER TABLE engagement_actions ADD COLUMN IF NOT EXISTS action_no INTEGER;
-- One-time fill from the numbering the register showed until now (live actions
-- by date raised, then trashed ones after them), so every code already in a
-- submitted file stays right. A no-op once any action has a stored number.
WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY sub_division_id
                              ORDER BY (deleted_at IS NOT NULL), recorded_date NULLS LAST, id) AS n
      FROM engagement_actions
)
UPDATE engagement_actions ea
   SET action_no = ranked.n
  FROM ranked
 WHERE ea.id = ranked.id
   AND NOT EXISTS (SELECT 1 FROM engagement_actions WHERE action_no IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS engagement_actions_sub_no_key
    ON engagement_actions (sub_division_id, action_no);

-- ---------------------------------------------------------------------------
--  Numbering, as the weekly matrix shows it.
--
--  A department is "in the matrix" once it has a rating, a position or an
--  action; empty placeholders created for correspondence stay out, so they
--  neither show in the file nor push an authority into sub-numbering.
--    authority with one listed department   7      actions 7.1, 7.2
--    authority with several                 4.1    actions 4.1.1, 4.1.2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_engagement_numbering AS
WITH line AS (
    SELECT sd.id, sd.authority_id, sd.seq_no, sd.matrix_seq,
           (sd.influence IS NOT NULL OR sd.involvement IS NOT NULL
            OR sd.engagement_current IS NOT NULL OR sd.engagement_desired IS NOT NULL
            OR EXISTS (SELECT 1 FROM engagement_actions ea
                        WHERE ea.sub_division_id = sd.id AND ea.deleted_at IS NULL)
           ) AS in_matrix
    FROM sub_divisions sd
    JOIN authorities a ON a.id = sd.authority_id AND a.deleted_at IS NULL
    WHERE sd.deleted_at IS NULL
),
auth AS (
    SELECT a.id, a.name, a.matrix_no,
           count(*) FILTER (WHERE l.in_matrix) AS lines
    FROM authorities a
    JOIN line l ON l.authority_id = a.id
    WHERE a.deleted_at IS NULL
    GROUP BY a.id
),
auth_no AS (
    SELECT id, lines,
           CASE
             WHEN matrix_no IS NOT NULL THEN matrix_no::bigint
             WHEN lines = 0 THEN NULL
             ELSE (SELECT COALESCE(max(matrix_no), 0) FROM authorities WHERE deleted_at IS NULL)
                  + row_number() OVER (PARTITION BY (matrix_no IS NULL AND lines > 0)
                                       ORDER BY name, id)
           END AS n
    FROM auth
),
ranked AS (
    SELECT l.id, l.authority_id, l.in_matrix,
           row_number() OVER (PARTITION BY l.authority_id, l.in_matrix
                              ORDER BY l.matrix_seq NULLS LAST, l.seq_no, l.id) AS r
    FROM line l
)
SELECT
    rk.id AS sub_division_id,
    rk.in_matrix,
    an.n  AS authority_no,
    CASE WHEN NOT rk.in_matrix OR an.n IS NULL THEN NULL
         WHEN an.lines > 1 THEN an.n || '.' || rk.r
         ELSE an.n::text
    END AS line_no,
    -- Sorts the register the way the file reads; unlisted departments last.
    an.n * 1000 + CASE WHEN rk.in_matrix THEN rk.r ELSE 500 + rk.r END AS line_order
FROM ranked rk
JOIN auth_no an ON an.id = rk.authority_id;

-- ---------------------------------------------------------------------------
--  Stakeholder matrix: the power/interest classification and the engagement
--  ladder, reproducing the workbook's own formulas so the export matches it
--  cell for cell. Ratings are read from the sub-division; the authority row
--  in the register is only a grouping header.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_engagement_matrix AS
WITH ladder(step, name) AS (
    VALUES (1,'Unaware'), (2,'Resistant'), (3,'Neutral'), (4,'Supportive'), (5,'Leading')
),
-- Numbered once per query. The numbering view has window functions, so the
-- planner cannot fold it in, and joined directly it is re-run for every row.
num AS MATERIALIZED (SELECT * FROM v_engagement_numbering)
SELECT
    sd.id                 AS sub_division_id,
    sd.authority_id,
    sd.sub_reference,
    sd.name               AS sub_division_name,
    sd.seq_no,
    a.code                AS authority_code,
    a.name                AS authority_name,
    sd.influence,
    sd.involvement,
    sd.engagement_current,
    sd.engagement_desired,
    sd.communication_priority,
    sd.gap_remarks,
    sd.gap_action_by,
    sd.noc_status,
    -- Power x Interest quadrant, exactly as the workbook computes it.
    CASE
        WHEN sd.influence = 'H' AND sd.involvement = 'H' THEN 'Manage Closely'
        WHEN sd.influence = 'H' AND sd.involvement = 'L' THEN 'Keep Satisfied'
        WHEN sd.influence = 'L' AND sd.involvement = 'H' THEN 'Keep Informed'
        WHEN sd.influence = 'L' AND sd.involvement = 'L' THEN 'Monitor'
        ELSE NULL
    END AS action_priority,
    (sd.influence = 'H' AND sd.involvement = 'H') AS is_critical,
    -- Gap between where the stakeholder is and where we need them to be.
    CASE
        WHEN sd.engagement_current IS NULL OR sd.engagement_desired IS NULL THEN NULL
        WHEN sd.engagement_current = sd.engagement_desired THEN '✓ Aligned'
        ELSE 'Gap: ' || sd.engagement_current || ' → ' || sd.engagement_desired
    END AS gap_status,
    cur.step  AS current_step,
    des.step  AS desired_step,
    -- Positive when the stakeholder sits below where they need to be.
    CASE WHEN cur.step IS NULL OR des.step IS NULL THEN NULL
         ELSE des.step - cur.step END AS gap_size,
    sd.remarks,
    num.in_matrix,
    num.authority_no      AS matrix_authority_no,
    num.line_no           AS matrix_no,
    num.line_order        AS matrix_order
FROM sub_divisions sd
JOIN authorities a ON a.id = sd.authority_id AND a.deleted_at IS NULL
LEFT JOIN ladder cur ON cur.name = sd.engagement_current
LEFT JOIN ladder des ON des.name = sd.engagement_desired
LEFT JOIN num ON num.sub_division_id = sd.id
WHERE sd.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
--  The action register. Two derivations carry the whole feature:
--
--  action_code  the workbook's hierarchical number, computed rather than
--               stored: the department's matrix number (v_engagement_numbering)
--               plus the action's place under it - 4.1.1 under KAHRAMAA Water,
--               7.1 under MoECC, which is exactly what the workbook does.
--  status       Pending until someone registers progress, Open/Ongoing once
--               they have, Closed on a closure entry — with Cancelled and
--               Superseded as the two deliberate exits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_engagement_action AS
WITH tally AS (
    SELECT action_id,
           count(*) FILTER (WHERE kind = 'progress') AS progress_count,
           count(*) FILTER (WHERE kind = 'closure')  AS closure_count,
           max(entry_date)                            AS last_entry_date,
           count(*) FILTER (WHERE source_type = 'external') AS external_count,
           count(*)                                   AS entry_count
    FROM engagement_action_progress
    WHERE deleted_at IS NULL
    GROUP BY action_id
),
-- Numbered once per query (see v_engagement_matrix for why).
num AS MATERIALIZED (SELECT * FROM v_engagement_numbering)
SELECT
    ea.*,
    sd.sub_reference,
    sd.name        AS sub_division_name,
    sd.authority_id,
    a.code         AS authority_code,
    a.name         AS authority_name,
    -- The department's quadrant and gap, by the same formulas as
    -- v_engagement_matrix. Read straight off the row: joining that view here
    -- would re-run its numbering for every action.
    CASE
        WHEN sd.influence = 'H' AND sd.involvement = 'H' THEN 'Manage Closely'
        WHEN sd.influence = 'H' AND sd.involvement = 'L' THEN 'Keep Satisfied'
        WHEN sd.influence = 'L' AND sd.involvement = 'H' THEN 'Keep Informed'
        WHEN sd.influence = 'L' AND sd.involvement = 'L' THEN 'Monitor'
        ELSE NULL
    END AS action_priority,
    (sd.influence = 'H' AND sd.involvement = 'H') AS is_critical,
    CASE
        WHEN sd.engagement_current IS NULL OR sd.engagement_desired IS NULL THEN NULL
        WHEN sd.engagement_current = sd.engagement_desired THEN '✓ Aligned'
        ELSE 'Gap: ' || sd.engagement_current || ' → ' || sd.engagement_desired
    END AS gap_status,
    -- The department's number in the weekly matrix, then the action's stored
    -- place under it (see v_engagement_numbering): 7.1 for MoECC, 4.2.1 for
    -- KAHRAMAA Electricity.
    num.line_no || '.' || ea.action_no AS action_code,
    num.authority_no AS authority_no,
    COALESCE(t.progress_count, 0) AS progress_count,
    COALESCE(t.entry_count, 0)    AS entry_count,
    t.last_entry_date,
    -- Status is earned, never typed.
    CASE
        WHEN ea.resolution = 'cancelled'      THEN 'Cancelled'
        WHEN ea.resolution = 'superseded'     THEN 'Superseded'
        WHEN COALESCE(t.closure_count, 0) > 0 THEN 'Closed'
        WHEN COALESCE(t.progress_count, 0) > 0 THEN 'Open/Ongoing'
        ELSE 'Pending'
    END AS status,
    -- Flags the register surfaces: work claimed without a system record, and
    -- anything past its date while still open.
    (ea.source_type = 'external' OR COALESCE(t.external_count, 0) > 0)
        AS has_external_evidence,
    (ea.due_date IS NOT NULL
       AND ea.due_date < CURRENT_DATE
       AND ea.resolution IS NULL
       AND COALESCE(t.closure_count, 0) = 0) AS is_overdue,
    num.line_no,
    num.line_order
FROM engagement_actions ea
JOIN sub_divisions sd  ON sd.id = ea.sub_division_id AND sd.deleted_at IS NULL
JOIN authorities   a   ON a.id  = sd.authority_id    AND a.deleted_at IS NULL
JOIN num                ON num.sub_division_id = sd.id
LEFT JOIN tally     t  ON t.action_id = ea.id
WHERE ea.deleted_at IS NULL;
