// ---------------------------------------------------------------------------
//  Dashboard  -  read-only aggregates for the landing page.
// ---------------------------------------------------------------------------
const express = require('express');
const { query } = require('../db');
const { wrap } = require('../helpers');

const router = express.Router();

const LADDER = ['Identified', 'Contacted', 'Response Received', 'Outcome Secured'];
const CATEGORIES = [
  'Government Ministry',
  'Statutory or Regulatory Authority',
  'Utility Provider',
  'Service Provider',
  'Certification Body',
  'Adjacent Operator',
];
const MEETING_PURPOSES = ['Data Collection', 'Consultation', 'NOC'];
const MEETING_MODES = ['In Person', 'Online', 'Hybrid'];

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
    const ladder = LADDER.map((status) => ({
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
    const byCategory = CATEGORIES.map((category) => ({
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
    const meetingsByPurpose = MEETING_PURPOSES.map((purpose) => ({
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
    const meetingsByMode = MEETING_MODES.map((mode) => ({
      mode,
      count: mModeMap[mode] || 0,
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
        awaiting_reply: num(t.awaiting_reply),
        overdue_communications: num(t.overdue_communications),
        meetings_logged: num(t.meetings_logged),
      },
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
