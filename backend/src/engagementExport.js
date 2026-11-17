// ---------------------------------------------------------------------------
//  Export the register back out as the weekly Stakeholder Engagement Matrix.
//
//  The same seven tabs as the file the team submits - Stakeholder Matrix,
//  Engagement Assessment, Combined View, ACTION REGISTER, Quadrant Summary,
//  Legend & Methodology, Meeting Brief - with the workbook's own numbering
//  (v_engagement_numbering) so 7.1 here is 7.1 in last week's file.
//
//  Flat values, not live formulas: the app is the master, so the export is a
//  snapshot of it rather than a spreadsheet that recalculates itself. That is
//  also what stops the tabs drifting apart the way the original did (its
//  Meeting Brief had lost its references and went out empty).
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
const EXTERNAL_FILL = ['FFFBF1DC', 'FF8A5A00'];

const LADDER = ['Unaware', 'Resistant', 'Neutral', 'Supportive', 'Leading'];
const LIVE = ['Pending', 'Open/Ongoing', 'Closed'];

function paint(cell, [bg, fg], { bold = false, font = 'Arial', size = 9 } = {}) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cell.font = { name: font, size, bold, color: { argb: fg } };
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

const day = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : '');
// A real date cell (sorts and filters in Excel), shown the way the workbook does.
const asDate = (d) => {
  const s = day(d);
  if (!s) return null;
  const [y, m, dd] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
};
const DATE_FMT = 'dd-mmm-yy';
const dmy = (d) => {
  const s = day(d);
  if (!s) return '';
  const [y, m, dd] = s.split('-');
  return `${dd}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]}-${y.slice(2)}`;
};

// --- data -------------------------------------------------------------------
// One ordered pass over the register, in the matrix's own order: each listed
// stakeholder line, and each line's live actions beneath it.
async function fetchRegister() {
  const matrix = await query(
    `SELECT * FROM v_engagement_matrix
      WHERE in_matrix
      ORDER BY matrix_order, sub_division_id`
  );
  const actions = await query(
    `SELECT a.*,
            (SELECT string_agg(o.name, ' / ' ORDER BY o.name)
               FROM engagement_action_orgs ao
               JOIN engagement_orgs o ON o.id = ao.org_id
              WHERE ao.action_id = a.id) AS action_by
       FROM v_engagement_action a
      WHERE a.status = ANY($1::text[])
      ORDER BY a.authority_no, a.line_order, a.action_no`,
    [LIVE]
  );
  // The latest timeline note per action becomes the workbook's Remarks
  // column; the closing entry's date is the register's "Actioned date".
  const notes = await query(
    `SELECT DISTINCT ON (action_id) action_id, note, entry_date
       FROM engagement_action_progress
      WHERE deleted_at IS NULL
      ORDER BY action_id, entry_date DESC, id DESC`
  );
  const noteBy = Object.fromEntries(notes.rows.map((n) => [n.action_id, n.note]));
  const closed = await query(
    `SELECT action_id, max(entry_date) AS closed_on
       FROM engagement_action_progress
      WHERE deleted_at IS NULL AND kind = 'closure'
      GROUP BY action_id`
  );
  const closedOn = Object.fromEntries(closed.rows.map((c) => [c.action_id, c.closed_on]));

  // The document reference as the workbook showed it: the linked record's own
  // reference, or the external reference when it is not in the system.
  const srcRefs = {};
  for (const [kind, table, codeCol, refCol] of [
    ['meeting', 'meetings', 'meeting_code', 'mom_reference'],
    ['communication', 'communications', 'comm_code', 'submission_reference'],
    ['qdrs', 'qdrs_records', 'qdrs_code', 'reference'],
  ]) {
    const { rows } = await query(`SELECT id, ${codeCol} AS code, ${refCol} AS ref FROM ${table}`);
    for (const r of rows) srcRefs[`${kind}:${r.id}`] = r.ref || r.code;
  }
  const docRef = (a) =>
    a.source_type === 'external'
      ? a.source_ref_external
      : srcRefs[`${a.source_type}:${a.source_id}`] || '';

  return { matrix: matrix.rows, actions: actions.rows, noteBy, closedOn, docRef };
}

// The stakeholders as the matrix lists them: an authority with several
// departments gets a header row and numbered departments under it; one with a
// single department is listed under the authority's own name.
function grouped(matrix) {
  const out = [];
  let last = null;
  for (const m of matrix) {
    const multi = String(m.matrix_no).includes('.');
    if (m.authority_id !== last) {
      last = m.authority_id;
      if (multi) out.push({ header: true, no: String(m.matrix_authority_no), name: m.authority_name });
    }
    out.push({ header: false, no: m.matrix_no, name: multi ? m.sub_division_name : m.authority_name, m });
  }
  return out;
}

// The same reading of a stakeholder the Weekly picture gives, so the brief
// and the page always agree.
const step = (s) => LADDER.indexOf(s);
function laneOf(m) {
  const cs = step(m.engagement_current);
  const ds = step(m.engagement_desired);
  if (cs < 0 || ds < 0) return 'none';
  if (ds > cs && cs === 0) return 'unengaged';
  if (ds > cs && m.is_critical) return 'discuss';
  if (ds > cs) return 'moving';
  return 'ok';
}

// --- sheets -----------------------------------------------------------------
function buildStakeholderMatrix(book, matrix) {
  const s = book.addWorksheet('Stakeholder Matrix', { views: [{ state: 'frozen', ySplit: 2 }] });
  titleRow(s, 'STAKEHOLDER ENGAGEMENT MATRIX — SAFARI PARK DOHA', 9);
  s.getRow(2).values = ['No.', 'Stakeholder', '', '', '', 'Influence\n(Power)\nH/L',
    'Involvement\n(Interest)\nH/L', 'Action Priority', 'Critical stakeholders'];
  headerBand(s, 2, [7, 48, 18.8, 21.5, 19, 10, 11, 14, 11]);
  s.mergeCells('B2:E2');

  const banner = s.addRow(['Government Authorities, Utility & Service Providers']);
  s.mergeCells(`A${banner.number}:I${banner.number}`);
  body(banner.getCell(1), { font: { bold: true, color: { argb: NAVY } } });

  for (const g of grouped(matrix)) {
    if (g.header) {
      const r = s.addRow([g.no, g.name]);
      r.eachCell((c) => body(c, { font: { bold: true } }));
      s.mergeCells(`B${r.number}:E${r.number}`);
      continue;
    }
    const m = g.m;
    const r = s.addRow([g.no, g.name, '', '', '',
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
  titleRow(s, 'STAKEHOLDER ENGAGEMENT ASSESSMENT MATRIX', 13);
  s.getCell('A2').value =
    'Current and Desired are kept in the Authority Engagement Tracker; this sheet is a snapshot of it.';
  body(s.getCell('A2'), { font: { italic: true, color: { argb: 'FF808080' } } });
  s.getRow(4).values = ['ID', 'Stakeholder', 'Current Status', 'Desired',
    ...LADDER, 'Gap Status', 'Action by', 'GAP Remarks', 'Remarks'];
  headerBand(s, 4, [7, 39.5, 13, 13, 9, 9, 9, 10, 9, 24, 14, 32, 46]);

  for (const g of grouped(matrix)) {
    if (g.header) {
      const r = s.addRow([g.no, g.name]);
      r.eachCell((c) => body(c, { font: { bold: true } }));
      continue;
    }
    const m = g.m;
    // The C / D / "D C" markers sit under whichever ladder step they fall on.
    const marks = LADDER.map((st) => {
      const isC = m.engagement_current === st;
      const isD = m.engagement_desired === st;
      return isC && isD ? 'D C' : isC ? 'C' : isD ? 'D' : '';
    });
    const r = s.addRow([g.no, g.name, m.engagement_current || '',
      m.engagement_desired || '', ...marks, m.gap_status || '',
      m.gap_action_by || '', m.gap_remarks || '', m.remarks || '']);
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
  s.addRow([]);
  const k = s.addRow(['KEY: C = Current   |   D = Desired   |   D C = Current already meets Desired (aligned)']);
  s.mergeCells(`A${k.number}:M${k.number}`);
  body(k.getCell(1), { font: { italic: true, color: { argb: 'FF808080' } } });
  return s;
}

function buildCombinedView(book, { matrix, actions, noteBy, docRef }) {
  const s = book.addWorksheet('Combined View', { views: [{ state: 'frozen', ySplit: 3 }] });
  titleRow(s, 'COMBINED VIEW — ENGAGEMENT ASSESSMENT × STAKEHOLDER MATRIX', 16);
  s.getRow(3).values = ['No.', 'Document Reference', 'Stakeholder', 'Recorded Date',
    'Action By', 'Action Status', 'Action Date', 'Stakeholder Current\nStatus',
    'Stakeholder Desired\nStatus', 'Gap Status', 'Remarks', 'Influence\n(Power)\nH/L',
    'Involvement\n(Interest)\nH/L', 'Action Priority', 'Critical\nStatus', 'NOC Status'];
  headerBand(s, 3, [7.5, 19.8, 53.5, 10.8, 20.3, 14, 14.5, 12, 12.2, 11.5, 46.8,
    10, 13, 11.5, 12, 18]);

  for (const g of grouped(matrix)) {
    if (g.header) {
      const r = s.addRow([g.no, '', g.name]);
      r.eachCell((c) => body(c, { font: { bold: true } }));
      continue;
    }
    const m = g.m;
    const r = s.addRow([g.no, '', g.name, '', '', '', '',
      m.engagement_current || '', m.engagement_desired || '', m.gap_status || '',
      [m.remarks, m.gap_remarks].filter(Boolean).join('\n'),
      m.influence || '', m.involvement || '', m.action_priority || '',
      m.is_critical ? 'CRITICAL' : '-', m.noc_status || '']);
    r.eachCell((c) => body(c));
    r.getCell(3).font = { name: 'Arial', size: 9, bold: true };
    if (m.gap_status) paint(r.getCell(10), m.gap_status.startsWith('✓') ? ALIGNED_FILL : GAP_FILL, { bold: true });
    if (PRIORITY_FILL[m.action_priority]) paint(r.getCell(14), PRIORITY_FILL[m.action_priority], { bold: true });
    if (m.is_critical) paint(r.getCell(15), CRITICAL_FILL, { bold: true });

    for (const a of actions.filter((x) => x.sub_division_id === m.sub_division_id)) {
      const ar = s.addRow([
        a.action_code, docRef(a) || '—', a.description, asDate(a.recorded_date) || '—',
        a.action_by || '—', a.status,
        a.due_milestone || day(a.due_date) || '—',
        '—', '—', '—', noteBy[a.id] || a.notes || '', '—', '—', '—', '—', '',
      ]);
      ar.eachCell((c) => body(c));
      ar.getCell(4).numFmt = DATE_FMT;
      // Flag anything whose evidence still sits outside the system.
      if (a.has_external_evidence) paint(ar.getCell(2), EXTERNAL_FILL);
    }
  }
  s.autoFilter = { from: 'A3', to: `P${s.rowCount}` };
  return s;
}

// The register of what was agreed in meetings, one lettered section per
// stakeholder, in the layout of the workbook's own ACTION REGISTER tab.
function buildActionRegister(book, { matrix, actions, noteBy, closedOn, docRef }) {
  const s = book.addWorksheet('ACTION REGISTER', { views: [{ state: 'frozen', ySplit: 6 }] });
  const BLUE = 'FF0070C0';
  [7.8, 42.5, 15.5, 55.5, 14, 12, 15.5, 55.5].forEach((w, i) => { s.getColumn(i + 1).width = w; });

  s.mergeCells('A1:H1');
  s.getCell('A1').value = 'SAFARI PARK PROJECT\nCONTRACT# : 6';
  s.getCell('A1').font = { name: 'Aptos', size: 20, bold: true, color: { argb: NAVY } };
  s.getCell('A1').alignment = { vertical: 'top', wrapText: true };
  s.getRow(1).height = 58;
  s.mergeCells('A3:H3');
  s.getCell('A3').value = 'STAKEHOLDER MEETINGS ACTION REGISTER';
  s.getCell('A3').font = { name: 'Aptos', size: 24, bold: true };
  s.getRow(3).height = 32;

  const head = ['Ser. No.', 'DOCUMENT REFERENCE', 'RECORD / DATE', 'DESCRIPTION',
    'ACTION BY', 'STATUS', 'ACTIONED DATE', 'REMARKS'];
  head.forEach((h, i) => {
    s.mergeCells(5, i + 1, 6, i + 1);
    const c = s.getCell(5, i + 1);
    c.value = h;
    paint(c, [BLUE, WHITE], { bold: true, font: 'Aptos', size: 12 });
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  s.getRow(5).height = 24;

  // Meeting actions: raised in a meeting on the register, or citing a MOM.
  const fromMeeting = (a) => a.source_type === 'meeting'
    || (a.source_type === 'external' && /\bMOM\b|-MOM-/i.test(a.source_ref_external || ''));

  let section = 0;
  const letter = (n) => {
    let t = '';
    for (let x = n; x >= 0; x = Math.floor(x / 26) - 1) t = String.fromCharCode(65 + (x % 26)) + t;
    return t;
  };
  for (const m of matrix) {
    const list = actions.filter((a) => a.sub_division_id === m.sub_division_id && fromMeeting(a));
    if (!list.length) continue;
    const multi = String(m.matrix_no).includes('.');
    const sec = s.addRow([letter(section++), (multi ? m.sub_division_name : m.authority_name).toUpperCase()]);
    s.mergeCells(`B${sec.number}:H${sec.number}`);
    sec.getCell(1).font = { name: 'Aptos', size: 13, bold: true };
    sec.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    sec.getCell(2).font = { name: 'Aptos', size: 13, bold: true };
    sec.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    sec.getCell(1).fill = sec.getCell(2).fill;
    sec.height = 24;

    for (const a of list) {
      const done = a.status === 'Closed';
      const r = s.addRow([
        a.action_code, docRef(a) || '', asDate(a.recorded_date), a.description,
        a.action_by || '', done ? 'CLOSED' : 'OPEN', done ? asDate(closedOn[a.id]) : null,
        noteBy[a.id] || a.notes || '',
      ]);
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.font = { name: 'Aptos', size: 11, bold: col === 5 };
        c.alignment = {
          vertical: 'top', wrapText: true,
          horizontal: [1, 3, 5, 6, 7].includes(col) ? 'center' : 'left',
        };
        c.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } };
      });
      r.getCell(3).numFmt = DATE_FMT;
      r.getCell(7).numFmt = DATE_FMT;
      paint(r.getCell(6), done ? ['FFE2EFDA', 'FF375623'] : ['FFFFF2CC', 'FF7F6000'],
        { bold: true, font: 'Aptos', size: 11 });
      r.getCell(6).alignment = { horizontal: 'center', vertical: 'top' };
    }
  }
  if (!section) {
    const r = s.addRow(['', 'No meeting actions on the register.']);
    r.getCell(2).font = { name: 'Aptos', size: 11, italic: true };
  }
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
  s.getColumn(2).width = 60;
  s.getColumn(3).width = 34;
  const add = (a, b, c, bold) => {
    const r = s.addRow([a, b, c]);
    r.eachCell((x) => body(x, bold ? { font: { bold: true } } : {}));
    return r;
  };
  add('Basis', 'Approved Stakeholder Management Plan, Doc. No. SPP-ECG-00_GN-00-SMP-SKH-GE-00001', '');
  add('', '', '');
  add('SCORING', '', '', true);
  add('', 'Influence (Power) and Involvement (Interest) are each rated H or L per stakeholder. '
    + 'An authority with several departments carries no rating of its own; each department is rated.', '');
  add('', '', '');
  add('ACTION PRIORITY', '', '', true);
  add('Priority', 'Power / Interest', 'Engagement Frequency', true);
  add('Manage Closely', 'High Power / High Interest — CRITICAL', 'Weekly / Key milestones');
  add('Keep Satisfied', 'High Power / Low Interest', 'Bi-weekly / Monthly');
  add('Keep Informed', 'Low Power / High Interest', 'Bi-weekly / Monthly');
  add('Monitor', 'Low Power / Low Interest', 'Monthly / As required');
  add('', '', '');
  add('NUMBERING', '', '', true);
  add('', 'Authorities keep their number in this matrix; an authority with several departments '
    + 'numbers them 4.1, 4.2, and each action takes the next level (4.2.1). Actions under a '
    + 'stakeholder are numbered in the order they were raised.', '');
  add('', '', '');
  add('ACTION STATUS', '', '', true);
  add('Pending', 'Nothing has been registered against the action yet.', '');
  add('Open/Ongoing', 'Progress has been registered.', '');
  add('Closed', 'Closed, citing the letter, meeting, QDRS record or reference that closed it.', '');
  add('', '', '');
  add('', 'Status is read from the registered timeline, never entered by hand, '
    + 'so an action cannot be reported as progressing without a record of it.', '');
  add('', '', '');
  add('Generated', `${day(new Date())} from the Authority Engagement Tracker`, '');
  return s;
}

// The page the weekly meeting is run from: each stakeholder in the tier that
// says what to do about it, with the line to say about them.
function buildMeetingBrief(book, { matrix, actions }) {
  const s = book.addWorksheet('Meeting Brief');
  [4, 36, 22, 16, 26, 70].forEach((w, i) => { s.getColumn(i + 1).width = w; });
  const F = (size, bold, color) => ({ name: 'Calibri', size, bold, color: { argb: color } });

  s.getCell('B1').value = 'STAKEHOLDER UPDATE — MEETING BRIEF';
  s.getCell('B1').font = F(16, true, NAVY);
  s.getRow(1).height = 22;
  s.getCell('B2').value = `Safari Park Doha (SPD) Stage 2   |   Generated from the Authority Engagement Tracker   |   ${dmy(new Date())}`;
  s.getCell('B2').font = F(9, false, 'FF6B7A8F');

  const open = actions.filter((a) => a.status !== 'Closed');
  const talkingPoint = (m) => {
    const mine = open.filter((a) => a.sub_division_id === m.sub_division_id);
    const late = mine.filter((a) => a.is_overdue).length;
    return [
      m.remarks,
      m.gap_remarks && `In the way: ${m.gap_remarks}${m.gap_action_by ? ` (${m.gap_action_by})` : ''}`,
      mine.length && `${mine.length} open action${mine.length > 1 ? 's' : ''}${late ? `, ${late} overdue` : ''}`,
    ].filter(Boolean).join(' | ');
  };
  // A department's own name already says whose it is ("KAHRAMAA Electricity").
  const name = (m) => (String(m.matrix_no).includes('.') ? m.sub_division_name : m.authority_name);

  const tier = (title, fill, rows, cols, cells, empty) => {
    s.addRow([]);
    const h = s.addRow(['', title]);
    s.mergeCells(`B${h.number}:F${h.number}`);
    paint(h.getCell(2), [fill, WHITE], { bold: true, font: 'Calibri', size: 11 });
    h.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
    h.height = 20;
    const c = s.addRow(['', ...cols]);
    for (let i = 2; i <= 6; i += 1) {
      paint(c.getCell(i), ['FFF2F4F7', NAVY], { bold: true, font: 'Calibri', size: 9 });
      c.getCell(i).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    }
    c.height = 24;
    if (!rows.length) {
      const r = s.addRow(['', empty]);
      s.mergeCells(`B${r.number}:F${r.number}`);
      r.getCell(2).font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7A8F' } };
      return;
    }
    for (const x of rows) {
      const r = s.addRow(['', ...cells(x)]);
      for (let i = 2; i <= 6; i += 1) {
        r.getCell(i).font = { name: 'Calibri', size: 9 };
        r.getCell(i).alignment = { vertical: 'top', wrapText: true };
        r.getCell(i).border = { bottom: { style: 'hair', color: { argb: 'FFD0D5DD' } } };
      }
    }
  };

  const COLS = ['No.', 'Stakeholder', 'Status (Current → Desired)', 'Action Priority', 'Talking Point (Remark + latest status)'];
  const row = (m) => [
    m.matrix_no, name(m),
    `${m.engagement_current || '—'} → ${m.engagement_desired || '—'}`,
    `${m.action_priority || 'Not rated'}${m.is_critical ? ' (CRITICAL)' : ''}`,
    talkingPoint(m),
  ];
  const of = (lane) => matrix.filter((m) => laneOf(m) === lane);

  tier('CRITICAL  /  NEEDS DISCUSSION', NAVY, of('discuss'), COLS, row, 'No critical stakeholder is short of where the project needs them.');
  tier('NOT YET ENGAGED', 'FF6B7A8F', of('unengaged'), COLS, row, 'Every stakeholder we need has been reached.');
  tier('MOVING  /  NOT THERE YET', 'FF8E7CC3', of('moving'), COLS, row, 'Nothing in between.');
  tier('ON TRACK  /  ALIGNED', 'FF4A6FA5', of('ok'), COLS, row, 'None yet.');

  const ownerless = open.filter((a) => !a.action_by);
  const byLine = new Map(matrix.map((m) => [m.sub_division_id, m]));
  tier('OPEN ITEMS  -  NO OWNER ASSIGNED', 'FFB08D57', ownerless,
    ['No.', 'Stakeholder', 'Task Ownership', 'Action Priority', 'Note'],
    (a) => {
      const m = byLine.get(a.sub_division_id);
      return [a.action_code, m ? name(m) : a.sub_division_name, 'Not assigned',
        m?.action_priority || '—',
        `${a.description} — no owner on the register; assign before the next stakeholder review.`];
    },
    'Every open action has an owner.');

  s.addRow([]);
  const foot = s.addRow(['', 'HOW THE TIERS ARE SET: the same reading as the Weekly picture in the tracker. '
    + 'Needs discussion = a critical (Manage Closely) stakeholder short of the position the project needs; '
    + 'Not yet engaged = still Unaware; Moving = engaged but short of the needed position; '
    + 'On track = already at or past it. Stakeholders with no position recorded are left out.']);
  s.mergeCells(`B${foot.number}:F${foot.number}`);
  foot.getCell(2).font = { name: 'Calibri', size: 7.5, color: { argb: 'FF6B7A8F' } };
  foot.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  foot.height = 34;
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
  buildActionRegister(book, data);
  buildQuadrantSummary(book, data.matrix);
  buildLegend(book);
  buildMeetingBrief(book, data);
  return book;
}

module.exports = { buildEngagementWorkbook, fetchRegister, PRIORITY_FILL, LADDER };
