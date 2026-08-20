// ---------------------------------------------------------------------------
//  Export the register back out in the workbook's own shape.
//
//  Flat values, not live formulas: the app is the master now, so the export is
//  a snapshot of it rather than a spreadsheet that recalculates itself. That is
//  also what stops the three tabs drifting apart the way the original did.
//
//  The layout, column widths, navy header band and status colours are lifted
//  from the source workbook so a reader cannot tell the difference.
// ---------------------------------------------------------------------------
const { query } = require('./db');

const NAVY = 'FF1F3864';
const WHITE = 'FFFFFFFF';

// Straight from the workbook's conditional formatting.
const PRIORITY_FILL = {
  'Manage Closely': ['FFB23A3A', WHITE],
  'Keep Satisfied': ['FF4F8A8B', WHITE],
  'Keep Informed': ['FFC9A227', 'FF000000'],
  Monitor: ['FF7C9885', WHITE],
};
const CRITICAL_FILL = ['FF8B1A1A', WHITE];
const LADDER_FILL = {
  C: ['FFD9E2F3', 'FF4472C4'],
  D: ['FFF2DCDC', 'FFB23A3A'],
  'D C': ['FFD9D2E9', 'FF4B2E83'],
};
const ALIGNED_FILL = ['FFE2EFDA', 'FF548235'];
const GAP_FILL = ['FFFFF2CC', 'FFBF8F00'];

const LADDER = ['Unaware', 'Resistant', 'Neutral', 'Supportive', 'Leading'];

function paint(cell, [bg, fg], { bold = false } = {}) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cell.font = { name: 'Arial', size: 9, bold, color: { argb: fg } };
}

function headerBand(sheet, row, widths) {
  const r = sheet.getRow(row);
  r.height = 38;
  r.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: WHITE } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: NAVY } } };
  });
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

function titleRow(sheet, text, span) {
  sheet.mergeCells(1, 1, 1, span);
  const c = sheet.getCell(1, 1);
  c.value = text;
  c.font = { name: 'Arial', size: 11, bold: true, color: { argb: NAVY } };
  sheet.getRow(1).height = 22;
}

const body = (cell, opts = {}) => {
  cell.font = { name: 'Arial', size: 9, ...(opts.font || {}) };
  cell.alignment = { vertical: 'top', wrapText: true, ...(opts.alignment || {}) };
};

// --- data -------------------------------------------------------------------
// One ordered pass over the register: authority header, its stakeholders, and
// each stakeholder's actions beneath — the hierarchy the workbook shows.
async function fetchRegister() {
  const matrix = await query(
    `SELECT * FROM v_engagement_matrix ORDER BY authority_name, seq_no`
  );
  const actions = await query(
    `SELECT a.*, string_agg(o.name, ' / ' ORDER BY o.name) AS action_by
       FROM v_engagement_action a
       LEFT JOIN engagement_action_orgs ao ON ao.action_id = a.id
       LEFT JOIN engagement_orgs o ON o.id = ao.org_id
      GROUP BY a.id, a.sub_division_id, a.description, a.source_type, a.source_id,
               a.source_ref_external, a.recorded_date, a.notes, a.due_milestone,
               a.due_date, a.resolution, a.cancel_reason, a.superseded_by_id,
               a.superseded_ref_external, a.created_by, a.created_at, a.updated_at,
               a.deleted_at, a.deleted_by, a.deletion_group_id, a.sub_reference,
               a.sub_division_name, a.authority_id, a.authority_code, a.authority_name,
               a.action_priority, a.is_critical, a.gap_status, a.action_code,
               a.authority_no, a.action_no, a.progress_count, a.entry_count,
               a.last_entry_date, a.status, a.has_external_evidence, a.is_overdue
      ORDER BY a.authority_no, a.sub_reference, a.action_no`
  );
  // The latest timeline note per action becomes the workbook's Remarks column.
  const notes = await query(
    `SELECT DISTINCT ON (action_id) action_id, note, entry_date
       FROM engagement_action_progress
      ORDER BY action_id, entry_date DESC, id DESC`
  );
  const noteBy = Object.fromEntries(notes.rows.map((n) => [n.action_id, n.note]));

  // The document reference as the workbook showed it: the linked record's own
  // code, or the external reference when it is not in the system.
  const srcRefs = {};
  for (const t of [
    ['meeting', 'meetings', 'meeting_code', 'mom_reference'],
    ['communication', 'communications', 'comm_code', 'submission_reference'],
    ['qdrs', 'qdrs_records', 'qdrs_code', 'reference'],
  ]) {
    const [kind, table, codeCol, refCol] = t;
    const { rows } = await query(`SELECT id, ${codeCol} AS code, ${refCol} AS ref FROM ${table}`);
    for (const r of rows) srcRefs[`${kind}:${r.id}`] = r.ref || r.code;
  }
  const docRef = (a) =>
    a.source_type === 'external'
      ? a.source_ref_external
      : srcRefs[`${a.source_type}:${a.source_id}`] || '';

  return { matrix: matrix.rows, actions: actions.rows, noteBy, docRef };
}

// --- sheets -----------------------------------------------------------------
function buildStakeholderMatrix(book, matrix) {
  const s = book.addWorksheet('Stakeholder Matrix', { views: [{ state: 'frozen', ySplit: 2 }] });
  titleRow(s, 'STAKEHOLDER ENGAGEMENT MATRIX — SAFARI PARK DOHA', 9);
  s.getRow(2).values = ['No.', 'Stakeholder', '', '', '', 'Influence\n(Power)\nH/L',
    'Involvement\n(Interest)\nH/L', 'Action Priority', 'Critical stakeholders'];
  headerBand(s, 2, [5, 48, 18.8, 21.5, 19, 10, 11, 14, 11]);
  s.mergeCells('B2:E2');

  let authNo = 0, lastAuth = null, subNo = 0;
  for (const m of matrix) {
    if (m.authority_name !== lastAuth) {
      authNo += 1; subNo = 0; lastAuth = m.authority_name;
      const same = matrix.filter((x) => x.authority_name === m.authority_name);
      if (same.length > 1) {
        const r = s.addRow([String(authNo), m.authority_name]);
        r.eachCell((c) => body(c, { font: { bold: true } }));
        s.mergeCells(`B${r.number}:E${r.number}`);
      }
    }
    subNo += 1;
    const same = matrix.filter((x) => x.authority_name === m.authority_name);
    const id = same.length > 1 ? `${authNo}.${subNo}` : String(authNo);
    const r = s.addRow([id, m.sub_division_name, '', '', '',
      m.influence || '', m.involvement || '', m.action_priority || '',
      m.is_critical ? 'CRITICAL' : '-']);
    r.eachCell((c) => body(c));
    s.mergeCells(`B${r.number}:E${r.number}`);
    r.getCell(6).alignment = { horizontal: 'center' };
    r.getCell(7).alignment = { horizontal: 'center' };
    if (PRIORITY_FILL[m.action_priority]) paint(r.getCell(8), PRIORITY_FILL[m.action_priority], { bold: true });
    if (m.is_critical) paint(r.getCell(9), CRITICAL_FILL, { bold: true });
  }
  return s;
}

function buildEngagementAssessment(book, matrix) {
  const s = book.addWorksheet('Engagement Assessment', { views: [{ state: 'frozen', ySplit: 4 }] });
  titleRow(s, 'STAKEHOLDER ENGAGEMENT ASSESSMENT MATRIX', 12);
  s.getCell('A2').value =
    'Current and Desired are maintained in the platform; this sheet is a snapshot.';
  body(s.getCell('A2'), { font: { italic: true, color: { argb: 'FF808080' } } });
  s.getRow(4).values = ['ID', 'Stakeholder', 'Current Status', 'Desired',
    ...LADDER, 'Gap Status', 'Action by', 'GAP Remarks', 'Remarks'];
  headerBand(s, 4, [6, 39.5, 13, 19, 9, 9, 9, 10, 9, 24, 18, 32, 46]);

  let authNo = 0, lastAuth = null, subNo = 0;
  for (const m of matrix) {
    if (m.authority_name !== lastAuth) {
      authNo += 1; subNo = 0; lastAuth = m.authority_name;
      const same = matrix.filter((x) => x.authority_name === m.authority_name);
      if (same.length > 1) {
        const r = s.addRow([String(authNo), m.authority_name]);
        r.eachCell((c) => body(c, { font: { bold: true } }));
      }
    }
    subNo += 1;
    const same = matrix.filter((x) => x.authority_name === m.authority_name);
    const id = same.length > 1 ? `${authNo}.${subNo}` : String(authNo);

    // The C / D / "D C" markers sit under whichever ladder step they fall on.
    const marks = LADDER.map((step) => {
      const isC = m.engagement_current === step;
      const isD = m.engagement_desired === step;
      return isC && isD ? 'D C' : isC ? 'C' : isD ? 'D' : '';
    });
    const r = s.addRow([id, m.sub_division_name, m.engagement_current || '',
      m.engagement_desired || '', ...marks, m.gap_status || '',
      m.gap_action_by || '', m.gap_remarks || '', '']);
    r.eachCell((c) => body(c));
    marks.forEach((mk, i) => {
      if (LADDER_FILL[mk]) {
        const c = r.getCell(5 + i);
        paint(c, LADDER_FILL[mk], { bold: true });
        c.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });
    if (m.gap_status) {
      paint(r.getCell(10), m.gap_status.startsWith('✓') ? ALIGNED_FILL : GAP_FILL, { bold: true });
      r.getCell(10).alignment = { vertical: 'top', wrapText: true };
    }
  }
  return s;
}

function buildCombinedView(book, { matrix, actions, noteBy, docRef }) {
  const s = book.addWorksheet('Combined View', { views: [{ state: 'frozen', ySplit: 3 }] });
  titleRow(s, 'COMBINED VIEW — ENGAGEMENT ASSESSMENT × STAKEHOLDER MATRIX × ACTION REGISTER', 17);
  s.getRow(3).values = ['No.', 'Document Reference', 'Stakeholder', 'Recorded Date',
    'Action By', 'Action Status', 'Action Date', 'Stakeholder Current\nStatus',
    'Stakeholder Desired\nStatus', 'Gap Status', 'Remarks', 'Influence\n(Power)\nH/L',
    'Involvement\n(Interest)\nH/L', 'Action Priority', 'Critical\nStatus', 'NOC Status',
    'Communication Priority\n(by Authority)'];
  headerBand(s, 3, [5.8, 19.8, 53.5, 10.8, 20.3, 16.2, 14.5, 12, 12.2, 11.5, 46.8,
    10, 13, 11.5, 12, 18, 16.3]);

  const byAuth = new Map();
  for (const m of matrix) {
    if (!byAuth.has(m.authority_name)) byAuth.set(m.authority_name, []);
    byAuth.get(m.authority_name).push(m);
  }

  let authNo = 0;
  for (const [authName, subs] of byAuth) {
    authNo += 1;
    const multi = subs.length > 1;
    if (multi) {
      const r = s.addRow([String(authNo), '', authName]);
      r.eachCell((c) => body(c, { font: { bold: true } }));
    }
    subs.forEach((m, si) => {
      const subId = multi ? `${authNo}.${si + 1}` : String(authNo);
      const r = s.addRow([subId, '', m.sub_division_name, '', '', '', '',
        m.engagement_current || '', m.engagement_desired || '', m.gap_status || '', '',
        m.influence || '', m.involvement || '', m.action_priority || '',
        m.is_critical ? 'CRITICAL' : '-', m.noc_status || '', m.communication_priority || '']);
      r.eachCell((c) => body(c));
      r.getCell(3).font = { name: 'Arial', size: 9, bold: true };
      if (m.gap_status) paint(r.getCell(10), m.gap_status.startsWith('✓') ? ALIGNED_FILL : GAP_FILL, { bold: true });
      if (PRIORITY_FILL[m.action_priority]) paint(r.getCell(14), PRIORITY_FILL[m.action_priority], { bold: true });
      if (m.is_critical) paint(r.getCell(15), CRITICAL_FILL, { bold: true });

      for (const a of actions.filter((x) => x.sub_division_id === m.sub_division_id)) {
        const ar = s.addRow([
          a.action_code, docRef(a) || '—', a.description,
          a.recorded_date ? String(a.recorded_date).slice(0, 10) : '—',
          a.action_by || '—', a.status, a.due_milestone || (a.due_date ? String(a.due_date).slice(0, 10) : '—'),
          '—', '—', '—', noteBy[a.id] || a.notes || '', '—', '—', '—', '—', '', '',
        ]);
        ar.eachCell((c) => body(c));
        // Flag anything whose evidence still sits outside the system.
        if (a.has_external_evidence) {
          paint(ar.getCell(2), ['FFFBF1DC', 'FF8A5A00']);
        }
      }
    });
  }
  s.autoFilter = { from: 'A3', to: `Q${s.rowCount}` };
  return s;
}

function buildQuadrantSummary(book, matrix) {
  const s = book.addWorksheet('Quadrant Summary');
  titleRow(s, 'ACTION PRIORITY SUMMARY', 4);
  s.getRow(3).values = ['Priority', 'Definition', 'Count', '% of Total'];
  headerBand(s, 3, [22, 52, 10, 12]);
  const defs = [
    ['Manage Closely', 'High Influence + High Involvement — CRITICAL'],
    ['Keep Satisfied', 'High Influence + Low/Medium Involvement'],
    ['Keep Informed', 'Low/Medium Influence + High Involvement'],
    ['Monitor', 'Low/Medium Influence + Low/Medium Involvement'],
  ];
  const rated = matrix.filter((m) => m.action_priority);
  for (const [k, d] of defs) {
    const n = rated.filter((m) => m.action_priority === k).length;
    const r = s.addRow([k, d, n, rated.length ? n / rated.length : 0]);
    r.eachCell((c) => body(c));
    r.getCell(4).numFmt = '0.0%';
    paint(r.getCell(1), PRIORITY_FILL[k], { bold: true });
  }
  const t = s.addRow(['TOTAL', '', rated.length, rated.length ? 1 : 0]);
  t.eachCell((c) => body(c, { font: { bold: true } }));
  t.getCell(4).numFmt = '0.0%';
  return s;
}

function buildLegend(book) {
  const s = book.addWorksheet('Legend & Methodology');
  titleRow(s, 'STAKEHOLDER ENGAGEMENT MATRIX — METHODOLOGY', 4);
  s.getColumn(1).width = 26;
  s.getColumn(2).width = 46;
  s.getColumn(3).width = 34;
  const add = (a, b, c, bold) => {
    const r = s.addRow([a, b, c]);
    r.eachCell((x) => body(x, bold ? { font: { bold: true } } : {}));
    return r;
  };
  add('Basis', 'Approved Stakeholder Management Plan, Doc. No. SPP-ECG-00_GN-00-PLN-MNG-00001', '');
  add('', '', '');
  add('SCORING', '', '', true);
  add('', 'Influence (Power) and Involvement (Interest) are each rated H or L per sub-authority. '
    + 'An authority carries no rating of its own — its departments are rated separately.', '');
  add('', '', '');
  add('ACTION PRIORITY', '', '', true);
  add('Priority', 'Power / Interest', 'Engagement Frequency', true);
  add('Manage Closely', 'High Power / High Interest — CRITICAL', 'Weekly / Key milestones');
  add('Keep Satisfied', 'High Power / Low Interest', 'Bi-weekly / Monthly');
  add('Keep Informed', 'Low Power / High Interest', 'Bi-weekly / Monthly');
  add('Monitor', 'Low Power / Low Interest', 'Monthly / As required');
  add('', '', '');
  add('ACTION STATUS', '', '', true);
  add('Pending', 'Nothing has been registered against the action yet.', '');
  add('Open/Ongoing', 'Progress has been registered, citing where it happened.', '');
  add('Closed', 'Closed, citing the record that closed it.', '');
  add('Cancelled', 'Cancelled, with a stated reason.', '');
  add('Superseded', 'Replaced by another item, which is named.', '');
  add('', '', '');
  add('', 'Status is derived from the registered timeline, never entered by hand, '
    + 'so an action cannot be reported as progressing without evidence.', '');
  add('', '', '');
  add('Generated', new Date().toISOString().slice(0, 10) + ' from the Authority Engagement Tracker', '');
  return s;
}

async function buildEngagementWorkbook(ExcelJS) {
  const data = await fetchRegister();
  const book = new ExcelJS.Workbook();
  book.creator = 'Safari Park Authority Engagement Tracker';
  book.created = new Date();
  buildStakeholderMatrix(book, data.matrix);
  buildEngagementAssessment(book, data.matrix);
  buildCombinedView(book, data);
  buildQuadrantSummary(book, data.matrix);
  buildLegend(book);
  return book;
}

module.exports = { buildEngagementWorkbook, fetchRegister, PRIORITY_FILL, LADDER };
