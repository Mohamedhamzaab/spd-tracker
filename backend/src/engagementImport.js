// ---------------------------------------------------------------------------
//  One-time import of the Stakeholder Engagement Matrix workbook.
//
//  Runs only when the action register is empty, so it seeds a fresh
//  deployment once and never touches the data again — from then on the app is
//  the master and the workbook is only an export.
//
//  Two things it deliberately does NOT do:
//
//   * It never invents a source. Each action's document reference is matched
//     against the registered meetings, communications and QDRS records; only
//     a real match is linked. Everything else is recorded as external
//     evidence carrying the workbook's own reference, which the register then
//     flags so the team can attach the real record later.
//   * It never fabricates progress. The workbook's status is preserved:
//     Closed becomes a closure entry, Open/Ongoing a progress entry, and a
//     Pending item gets no entry at all — its remark is kept as a standing
//     note instead, so an untouched action still reads as untouched.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'engagement_seed_data.json');
const NO_REFERENCE = '(no reference in the source register)';

// Loose match: case, spacing and surrounding punctuation vary between the
// workbook and the register.
const norm = (s) => String(s || '').toLowerCase().replace(/[\s_]+/g, ' ').replace(/[.,;:()]/g, '').trim();

async function buildSourceIndex(client) {
  const index = new Map();
  const add = (key, type, id) => {
    const k = norm(key);
    if (k && !index.has(k)) index.set(k, { type, id });
  };
  const meetings = await client.query(
    `SELECT id, meeting_code, mom_reference FROM meetings WHERE deleted_at IS NULL`
  );
  for (const m of meetings.rows) {
    add(m.mom_reference, 'meeting', m.id);
    add(m.meeting_code, 'meeting', m.id);
  }
  const comms = await client.query(
    `SELECT id, comm_code, submission_reference FROM communications WHERE deleted_at IS NULL`
  );
  for (const c of comms.rows) {
    add(c.submission_reference, 'communication', c.id);
    add(c.comm_code, 'communication', c.id);
  }
  const qdrs = await client.query(
    `SELECT id, qdrs_code, reference FROM qdrs_records WHERE deleted_at IS NULL`
  );
  for (const q of qdrs.rows) {
    add(q.reference, 'qdrs', q.id);
    add(q.qdrs_code, 'qdrs', q.id);
  }
  return index;
}

// A workbook reference may name the document inside a longer string
// ("MOM- SPP-ECG-...-00001 (Rev. 02)"), so fall back to containment.
function resolveSource(index, docRef) {
  if (!docRef) return null;
  const k = norm(docRef);
  if (index.has(k)) return index.get(k);
  for (const [key, val] of index) {
    if (key.length >= 12 && (k.includes(key) || key.includes(k))) return val;
  }
  return null;
}

async function importEngagementWorkbook(client) {
  if (!fs.existsSync(DATA_FILE)) return { skipped: 'no seed file' };

  const already = await client.query('SELECT 1 FROM engagement_actions LIMIT 1');
  if (already.rows[0]) return { skipped: 'register already populated' };

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const report = {
    ratings: 0, actions: 0, progress: 0, closures: 0,
    linked: 0, external: 0, unmatchedRefs: [], missingStakeholders: [],
  };

  // --- organisations ------------------------------------------------------
  const orgId = new Map();
  for (const o of data.orgs || []) {
    const { rows } = await client.query(
      `INSERT INTO engagement_orgs (name, is_internal)
       VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET is_internal = EXCLUDED.is_internal
       RETURNING id`,
      [o.name, !!o.is_internal]
    );
    orgId.set(o.name, rows[0].id);
  }

  // --- stakeholder ratings -------------------------------------------------
  for (const s of data.stakeholders || []) {
    const { rowCount } = await client.query(
      `UPDATE sub_divisions SET
         influence              = COALESCE($2, influence),
         involvement            = COALESCE($3, involvement),
         engagement_current     = COALESCE($4, engagement_current),
         engagement_desired     = COALESCE($5, engagement_desired),
         communication_priority = COALESCE($6, communication_priority),
         gap_remarks            = COALESCE($7, gap_remarks),
         gap_action_by          = COALESCE($8, gap_action_by),
         updated_at             = now()
       WHERE sub_reference = $1 AND deleted_at IS NULL`,
      [s.sub_ref, s.influence || null, s.involvement || null,
       s.engagement_current || null, s.engagement_desired || null,
       s.communication_priority || null, s.gap_remarks || null, s.gap_action_by || null]
    );
    if (rowCount) report.ratings += 1;
    else report.missingStakeholders.push(s.sub_ref);
  }

  // --- actions -------------------------------------------------------------
  const index = await buildSourceIndex(client);
  const subId = new Map();
  const subs = await client.query(
    'SELECT id, sub_reference FROM sub_divisions WHERE deleted_at IS NULL'
  );
  for (const s of subs.rows) subId.set(s.sub_reference, s.id);

  for (const a of data.actions || []) {
    const sid = subId.get(a.sub_ref);
    if (!sid) {
      report.missingStakeholders.push(`${a.sub_ref} (action r${a.row})`);
      continue;
    }

    const match = resolveSource(index, a.doc_ref);
    let sourceType, sourceId = null, sourceRef = null;
    if (match) {
      sourceType = match.type;
      sourceId = match.id;
      report.linked += 1;
    } else {
      sourceType = 'external';
      sourceRef = a.doc_ref || NO_REFERENCE;
      report.external += 1;
      if (a.doc_ref) report.unmatchedRefs.push(a.doc_ref);
    }

    // A Pending item has, by definition, no progress — so its remark is kept
    // as a standing note rather than becoming a timeline entry.
    const pending = a.wb_status === 'Pending';
    const { rows } = await client.query(
      `INSERT INTO engagement_actions
         (sub_division_id, description, source_type, source_id, source_ref_external,
          recorded_date, notes, due_milestone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [sid, a.description, sourceType, sourceId, sourceRef,
       a.recorded_date || null, pending ? a.remarks || null : null, a.milestone || null]
    );
    const actionId = rows[0].id;
    report.actions += 1;

    for (const name of a.action_by || []) {
      const oid = orgId.get(name);
      if (oid) {
        await client.query(
          `INSERT INTO engagement_action_orgs (action_id, org_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [actionId, oid]
        );
      }
    }

    if (!pending) {
      const closing = a.wb_status === 'Closed';
      await client.query(
        `INSERT INTO engagement_action_progress
           (action_id, kind, entry_date, note, source_type, source_id, source_ref_external)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          actionId,
          closing ? 'closure' : 'progress',
          a.recorded_date || new Date().toISOString().slice(0, 10),
          a.remarks || (closing
            ? 'Closed in the source register.'
            : 'Progress recorded in the source register.'),
          sourceType, sourceId, sourceRef,
        ]
      );
      report.progress += 1;
      if (closing) report.closures += 1;
    }
  }

  return report;
}

module.exports = { importEngagementWorkbook };
