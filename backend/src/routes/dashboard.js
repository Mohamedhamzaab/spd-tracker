// ---------------------------------------------------------------------------
//  Dashboard  -  read-only aggregates for the landing page.
// ---------------------------------------------------------------------------
const express = require('express');
const { query } = require('../db');
const { wrap } = require('../helpers');
const { LISTS } = require('./lists');

const router = express.Router();

// The engagement ladder is a fixed, ordered funnel over the computed
// engagement_status values (not a user-editable dropdown).
const LADDER = ['Identified', 'Contacted', 'Response Received', 'Outcome Secured'];

// Category / purpose / mode buckets are taken straight from the canonical
// reference lists the entry forms use — so adding a new option there makes it
// appear on the dashboard automatically, with no second list to keep in sync.
const CATEGORIES = LISTS.authority_category;
const MEETING_PURPOSES = LISTS.meeting_purpose;
const MEETING_MODES = LISTS.meeting_mode;

// Return the canonical order, then append any values actually present in the
// data that aren't in the canonical list (sorted) — so an unexpected or
// legacy value is still charted instead of being silently dropped.
function withExtras(canonical, dataKeys) {
  const seen = new Set(canonical);
  const extras = dataKeys.filter((k) => k && !seen.has(k)).sort();
  return [...canonical, ...extras];
}

// GET /api/dashboard  -  every figure the dashboard shows, in one response.
router.get(
  '/',
  wrap(async (req, res) => {
    // Every base-table count filters deleted_at IS NULL so trashed rows do
    // not over-count against the view-based figures on the same screen.
    const totals = await query(`
      SELECT
        (SELECT count(*) FROM authorities WHERE deleted_at IS NULL)          AS total_authorities,
        (SELECT count(*) FROM sub_divisions WHERE deleted_at IS NULL)        AS total_sub_divisions,
        (SELECT count(*) FROM v_sub_division
           WHERE engagement_status <> 'Identified')                         AS sub_divisions_engaged,
        (SELECT count(*) FROM v_sub_division
           WHERE engagement_status = 'Outcome Secured')                     AS outcome_secured,
        (SELECT count(*) FROM communications WHERE deleted_at IS NULL)       AS communications_logged,
        (SELECT count(*) FROM v_communication
           WHERE direction = 'Outbound' AND reply_needed = TRUE
             AND reply_received = FALSE)                                    AS awaiting_reply,
        (SELECT count(*) FROM v_communication WHERE is_overdue)             AS overdue_communications,
        (SELECT count(*) FROM communications
           WHERE deleted_at IS NULL AND direction = 'Outbound')             AS outbound_count,
        (SELECT count(*) FROM communications
           WHERE deleted_at IS NULL AND direction = 'Inbound')              AS inbound_count,
        (SELECT count(*) FROM meetings WHERE deleted_at IS NULL)            AS meetings_logged
    `);
    const t = totals.rows[0];
    const num = (v) => Number(v) || 0;
    const totalSub = num(t.total_sub_divisions);

    const ladderRows = await query(`
      SELECT engagement_status AS status, count(*) AS count
        FROM v_sub_division GROUP BY engagement_status
    `);
    const ladderMap = Object.fromEntries(
      ladderRows.rows.map((r) => [r.status, num(r.count)])
    );
    const ladder = withExtras(LADDER, Object.keys(ladderMap)).map((status) => ({
      status,
      count: ladderMap[status] || 0,
      share: totalSub ? (ladderMap[status] || 0) / totalSub : 0,
    }));

    const catRows = await query(`
      SELECT category, count(*) AS count FROM authorities
        WHERE deleted_at IS NULL GROUP BY category
    `);
    const catMap = Object.fromEntries(
      catRows.rows.map((r) => [r.category, num(r.count)])
    );
    const byCategory = withExtras(CATEGORIES, Object.keys(catMap)).map((category) => ({
      category,
      count: catMap[category] || 0,
    }));

    const mPurposeRows = await query(`
      SELECT purpose, count(*) AS count FROM meetings
        WHERE deleted_at IS NULL GROUP BY purpose
    `);
    const mPurposeMap = Object.fromEntries(
      mPurposeRows.rows.map((r) => [r.purpose, num(r.count)])
    );
    const meetingsByPurpose = withExtras(MEETING_PURPOSES, Object.keys(mPurposeMap)).map((purpose) => ({
      purpose,
      count: mPurposeMap[purpose] || 0,
    }));

    const mModeRows = await query(`
      SELECT mode, count(*) AS count FROM meetings
        WHERE deleted_at IS NULL GROUP BY mode
    `);
    const mModeMap = Object.fromEntries(
      mModeRows.rows.map((r) => [r.mode, num(r.count)])
    );
    const meetingsByMode = withExtras(MEETING_MODES, Object.keys(mModeMap)).map((mode) => ({
      mode,
      count: mModeMap[mode] || 0,
    }));

    // Action counts the PMCM cares about ("Attention Required").
    const attRows = await query(`
      SELECT
        (SELECT count(*) FROM v_sub_division
           WHERE engagement_status = 'Identified')                          AS not_contacted,
        (SELECT count(*) FROM meetings
           WHERE deleted_at IS NULL AND mom_status = 'pending')             AS mom_pending,
        (SELECT count(*) FROM meetings
           WHERE deleted_at IS NULL AND mom_status = 'draft')               AS mom_draft,
        (SELECT count(*) FROM meetings
           WHERE deleted_at IS NULL AND mom_status = 'final')               AS mom_final,
        (SELECT count(*) FROM tasks
           WHERE deleted_at IS NULL AND status = 'open')                    AS open_tasks,
        (SELECT count(*) FROM tasks
           WHERE deleted_at IS NULL AND status = 'open'
             AND due_date IS NOT NULL AND due_date < CURRENT_DATE)          AS overdue_tasks
    `);
    const att = attRows.rows[0];

    // 12-month activity series (communications by direction + meetings).
    const monthlyRows = await query(`
      WITH months AS (
        SELECT to_char(d, 'YYYY-MM') AS ym, d::date AS m
          FROM generate_series(
                 date_trunc('month', CURRENT_DATE) - interval '11 months',
                 date_trunc('month', CURRENT_DATE),
                 interval '1 month') d
      )
      SELECT mo.ym,
        (SELECT count(*) FROM communications c
           WHERE c.deleted_at IS NULL AND c.direction = 'Outbound'
             AND date_trunc('month', c.comm_date) = mo.m)  AS outbound,
        (SELECT count(*) FROM communications c
           WHERE c.deleted_at IS NULL AND c.direction = 'Inbound'
             AND date_trunc('month', c.comm_date) = mo.m)  AS inbound,
        (SELECT count(*) FROM meetings mt
           WHERE mt.deleted_at IS NULL
             AND date_trunc('month', mt.meeting_date) = mo.m) AS meetings
        FROM months mo
       ORDER BY mo.ym
    `);

    // Meetings per month split by mode (for the stacked "by mode" chart).
    const meetingModeRows = await query(`
      WITH months AS (
        SELECT to_char(d, 'YYYY-MM') AS ym, d::date AS m
          FROM generate_series(
                 date_trunc('month', CURRENT_DATE) - interval '11 months',
                 date_trunc('month', CURRENT_DATE),
                 interval '1 month') d
      )
      SELECT mo.ym,
        (SELECT count(*) FROM meetings mt WHERE mt.deleted_at IS NULL
           AND mt.mode = 'In Person' AND date_trunc('month', mt.meeting_date) = mo.m) AS in_person,
        (SELECT count(*) FROM meetings mt WHERE mt.deleted_at IS NULL
           AND mt.mode = 'Online' AND date_trunc('month', mt.meeting_date) = mo.m)    AS online,
        (SELECT count(*) FROM meetings mt WHERE mt.deleted_at IS NULL
           AND mt.mode = 'Hybrid' AND date_trunc('month', mt.meeting_date) = mo.m)    AS hybrid
        FROM months mo
       ORDER BY mo.ym
    `);

    // Latest communications for the "recent" panel (status derived like the list).
    const recentRows = await query(`
      SELECT id, comm_code, to_char(comm_date, 'YYYY-MM-DD') AS comm_date,
             sub_division_name, authority_code, direction,
             is_overdue, reply_received, reply_needed
        FROM v_communication
       ORDER BY comm_date DESC, id DESC
       LIMIT 2
    `);
    const recent = recentRows.rows.map((r) => {
      let status = 'Logged';
      if (r.is_overdue) status = 'Overdue';
      else if (r.direction === 'Outbound' && r.reply_received) status = 'Replied';
      else if (r.direction === 'Outbound' && r.reply_needed) status = 'Awaiting';
      return {
        id: r.id,
        code: r.comm_code,
        date: r.comm_date,
        subdivision: r.sub_division_name,
        authorityCode: r.authority_code,
        direction: r.direction,
        status,
      };
    });

    // Latest meetings for the "recent" panel (newest first).
    const recentMeetingRows = await query(`
      SELECT m.id, m.meeting_code, to_char(m.meeting_date, 'YYYY-MM-DD') AS meeting_date,
             m.mode, m.mom_status,
             a.code AS authority_code, a.name AS authority_name,
             sd.name AS sub_name
        FROM meetings m
        JOIN authorities a ON a.id = m.authority_id AND a.deleted_at IS NULL
        LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id
       WHERE m.deleted_at IS NULL
       ORDER BY m.meeting_date DESC, m.id DESC
       LIMIT 2
    `);
    const recentMeetings = recentMeetingRows.rows.map((r) => ({
      id: r.id,
      code: r.meeting_code,
      date: r.meeting_date,
      subdivision: r.sub_name || r.authority_name,
      authorityCode: r.authority_code,
      mode: r.mode || '',
      momStatus: r.mom_status || 'pending',
    }));

    // Open tasks per active member (Team & Assignments panel).
    const teamRows = await query(`
      SELECT u.name, u.organisation, u.role,
             COALESCE((SELECT count(*) FROM tasks t
                        WHERE t.assignee_id = u.id AND t.deleted_at IS NULL
                          AND t.status = 'open'), 0)::int AS open_tasks
        FROM users u
       WHERE u.is_disabled = FALSE
       ORDER BY open_tasks DESC, u.name
       LIMIT 6
    `);
    const ROLE_LABEL = { super_admin: 'Super-admin', admin: 'Admin', reviewer: 'Reviewer' };
    const team = teamRows.rows.map((u) => ({
      name: u.name,
      org: [u.organisation, ROLE_LABEL[u.role] || u.role].filter(Boolean).join(' · '),
      openTasks: u.open_tasks,
    }));

    res.json({
      totals: {
        total_authorities: num(t.total_authorities),
        total_sub_divisions: totalSub,
        sub_divisions_engaged: num(t.sub_divisions_engaged),
        percent_engaged: totalSub ? num(t.sub_divisions_engaged) / totalSub : 0,
        outcome_secured: num(t.outcome_secured),
        percent_outcome_secured: totalSub ? num(t.outcome_secured) / totalSub : 0,
        communications_logged: num(t.communications_logged),
        outbound: num(t.outbound_count),
        inbound: num(t.inbound_count),
        awaiting_reply: num(t.awaiting_reply),
        overdue_communications: num(t.overdue_communications),
        meetings_logged: num(t.meetings_logged),
      },
      attention: {
        overdue_communications: num(t.overdue_communications),
        awaiting_reply: num(t.awaiting_reply),
        not_contacted: num(att.not_contacted),
        mom_pending: num(att.mom_pending),
        mom_draft: num(att.mom_draft),
        open_tasks: num(att.open_tasks),
        overdue_tasks: num(att.overdue_tasks),
      },
      mom: {
        pending: num(att.mom_pending),
        draft: num(att.mom_draft),
        final: num(att.mom_final),
      },
      monthly: monthlyRows.rows.map((r) => ({
        month: r.ym,
        outbound: num(r.outbound),
        inbound: num(r.inbound),
        meetings: num(r.meetings),
      })),
      meetingsMonthly: meetingModeRows.rows.map((r) => ({
        month: r.ym,
        inPerson: num(r.in_person),
        online: num(r.online),
        hybrid: num(r.hybrid),
      })),
      recent,
      recentMeetings,
      team,
      ladder,
      byCategory,
      meetingsByPurpose,
      meetingsByMode,
    });
  })
);

// GET /api/dashboard/period?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get(
  '/period',
  wrap(async (req, res) => {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const { rows } = await query(
      `
      SELECT
        (SELECT count(*) FROM communications
           WHERE deleted_at IS NULL
             AND ($1::date IS NULL OR comm_date >= $1)
             AND ($2::date IS NULL OR comm_date <= $2))            AS communications,
        (SELECT count(*) FROM communications
           WHERE deleted_at IS NULL AND direction = 'Outbound'
             AND ($1::date IS NULL OR comm_date >= $1)
             AND ($2::date IS NULL OR comm_date <= $2))            AS outbound,
        (SELECT count(*) FROM communications
           WHERE deleted_at IS NULL AND direction = 'Inbound'
             AND ($1::date IS NULL OR comm_date >= $1)
             AND ($2::date IS NULL OR comm_date <= $2))            AS inbound,
        (SELECT count(*) FROM meetings
           WHERE deleted_at IS NULL
             AND ($1::date IS NULL OR meeting_date >= $1)
             AND ($2::date IS NULL OR meeting_date <= $2))         AS meetings,
        (SELECT count(*) FROM sub_divisions
           WHERE deleted_at IS NULL
             AND ($1::date IS NULL OR date_identified >= $1)
             AND ($2::date IS NULL OR date_identified <= $2))      AS sub_divisions_identified
      `,
      [from, to]
    );
    const r = rows[0];
    res.json({
      from,
      to,
      communications: Number(r.communications) || 0,
      outbound: Number(r.outbound) || 0,
      inbound: Number(r.inbound) || 0,
      meetings: Number(r.meetings) || 0,
      sub_divisions_identified: Number(r.sub_divisions_identified) || 0,
    });
  })
);

module.exports = router;
