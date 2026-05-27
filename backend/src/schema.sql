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
--  USERS  -  individual logins. role 'editor' (ECG) may write; 'viewer'
--  (Client, Egis, SPD) may only read.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT        NOT NULL,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'viewer'
                              CHECK (role IN ('editor', 'viewer')),
    organisation  TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

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

-- ===========================================================================
--  VIEWS  -  all derived values. The application reads these, never the
--  base tables directly, so the engagement rules live in one place.
-- ===========================================================================

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
        SELECT 1 FROM communications r WHERE r.in_response_to = c.id
    )              AS reply_received,
    (
        c.direction = 'Outbound'
        AND c.reply_needed = TRUE
        AND NOT EXISTS (SELECT 1 FROM communications r WHERE r.in_response_to = c.id)
        AND (CURRENT_DATE - c.comm_date) > 7
    )              AS is_overdue,
    (SELECT count(*) FROM documents d
       WHERE d.parent_type = 'communication' AND d.parent_id = c.id) AS document_count
FROM communications c
JOIN sub_divisions sd ON sd.id = c.sub_division_id
JOIN authorities  a  ON a.id  = sd.authority_id;

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
JOIN authorities a ON a.id = sd.authority_id
LEFT JOIN (
    SELECT
        vc.sub_division_id,
        count(*) FILTER (WHERE vc.direction = 'Outbound') AS outbound_count,
        count(*) FILTER (WHERE vc.direction = 'Inbound')  AS inbound_count,
        count(*) FILTER (WHERE vc.is_overdue)             AS overdue_count,
        max(vc.comm_date)                                 AS last_activity
    FROM v_communication vc
    GROUP BY vc.sub_division_id
) s ON s.sub_division_id = sd.id;

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
) x ON x.authority_id = a.id;
