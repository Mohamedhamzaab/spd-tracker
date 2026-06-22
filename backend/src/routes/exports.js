// ---------------------------------------------------------------------------
//  Exports — Excel and PDF.
//
//  Excel (via exceljs)
//    /api/exports/authorities.xlsx          full authority register
//    /api/exports/sub-divisions.xlsx        full sub-division register
//    /api/exports/communications.xlsx       full communication log
//    /api/exports/meetings.xlsx             full meeting register
//    /api/exports/engagement-register.xlsx  one workbook with all four sheets
//    /api/exports/authority/:id.xlsx        drill-down for one authority
//
//  PDF (via pdfkit)
//    /api/exports/engagement-register.pdf   executive-style report
//    /api/exports/authority/:id.pdf         single-authority report
//
//  Every export writes a data.export.<kind> audit event.
//  Any authenticated user can export — reviewers already see this data.
// ---------------------------------------------------------------------------
const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { query } = require('../db');
const { wrap, httpError } = require('../helpers');
const { logAudit } = require('../audit');

const router = express.Router();

// --- shared styling ----------------------------------------------------------
const NAVY = 'FF4F46E5';
const NAVY_DARK = 'FF3730A3';
const NAVY_SOFT = 'FFEEF2FF';
const RED = 'FFB42318';
const AMBER = 'FF8A6100';
const GREEN = 'FF1D7A4D';
const WHITE = 'FFFFFFFF';

function setHeaderStyle(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: WHITE }, size: 11 };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function applyAutoFilter(sheet, lastColLetter, lastRow) {
  sheet.autoFilter = { from: 'A1', to: lastColLetter + lastRow };
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function setDownloadHeaders(res, contentType, filename) {
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );
  // Don't let intermediaries cache exports — the underlying data moves.
  res.setHeader('Cache-Control', 'no-store');
}

// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD time-frame on an export.
function dateRange(req) {
  const ok = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
  return { from: ok(req.query.from), to: ok(req.query.to) };
}
function windowLabel(from, to) {
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Up to ${to}`;
  return 'All dates';
}

// --- data fetchers (live rows only) -----------------------------------------
async function fetchAuthorities() {
  return (await query('SELECT * FROM v_authority ORDER BY code')).rows;
}
async function fetchSubDivisions() {
  return (await query('SELECT * FROM v_sub_division ORDER BY authority_code, seq_no')).rows;
}
async function fetchCommunications(from, to) {
  const params = [];
  const where = [];
  if (from) { params.push(from); where.push(`comm_date >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`comm_date <= $${params.length}::date`); }
  const sql = 'SELECT * FROM v_communication'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY comm_code';
  return (await query(sql, params)).rows;
}
async function fetchMeetings(from, to) {
  const params = [];
  const where = ['m.deleted_at IS NULL'];
  if (from) { params.push(from); where.push(`m.meeting_date >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`m.meeting_date <= $${params.length}::date`); }
  return (await query(
    `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
            sd.sub_reference AS primary_sub_reference,
            sd.name AS primary_sub_name
     FROM meetings m
     JOIN authorities a ON a.id = m.authority_id AND a.deleted_at IS NULL
     LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id
     WHERE ${where.join(' AND ')}
     ORDER BY m.meeting_code`,
    params
  )).rows;
}
// QDRS = data-received log per sub-authority. Optional date window + authority.
async function fetchQdrs(from, to, authorityId) {
  const params = [];
  const where = [];
  if (authorityId) { params.push(authorityId); where.push(`authority_id = $${params.length}`); }
  if (from) { params.push(from); where.push(`qdrs_date >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`qdrs_date <= $${params.length}::date`); }
  const sql = 'SELECT * FROM v_qdrs'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY qdrs_code';
  return (await query(sql, params)).rows;
}

// --- sheet builders ---------------------------------------------------------
function buildAuthoritiesSheet(book, rows) {
  const sheet = book.addWorksheet('Authorities', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Code',                key: 'code',                width: 10 },
    { header: 'Authority',           key: 'name',                width: 42 },
    { header: 'Category',            key: 'category',            width: 28 },
    { header: 'Influence',           key: 'influence_level',     width: 16 },
    { header: 'Decision Authority',  key: 'decision_authority',  width: 22 },
    { header: 'Engagement Strategy', key: 'engagement_strategy', width: 22 },
    { header: 'Sub-Divisions',       key: 'sub_division_count',  width: 14 },
    { header: 'Engaged',             key: 'sub_divisions_engaged', width: 12 },
    { header: 'Outcome Secured',     key: 'outcome_secured_count', width: 16 },
    { header: 'Notes',               key: 'notes',               width: 60 },
  ];
  rows.forEach((r) => sheet.addRow(r));
  setHeaderStyle(sheet);
  applyAutoFilter(sheet, 'J', rows.length + 1);
  return sheet;
}

function buildSubDivisionsSheet(book, rows) {
  const sheet = book.addWorksheet('Sub-Divisions', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Reference',       key: 'sub_reference',          width: 12 },
    { header: 'Sub-Division',    key: 'name',                   width: 42 },
    { header: 'Authority Code',  key: 'authority_code',         width: 12 },
    { header: 'Authority',       key: 'authority_name',         width: 30 },
    { header: 'Discipline',      key: 'discipline',             width: 18 },
    { header: 'Status',          key: 'engagement_status',      width: 18 },
    { header: 'NOC Status',      key: 'noc_status',             width: 16 },
    { header: 'Outbound',        key: 'outbound_count',         width: 10 },
    { header: 'Inbound',         key: 'inbound_count',          width: 10 },
    { header: 'Overdue',         key: 'overdue_count',          width: 10 },
    { header: 'Outcome Secured', key: 'outcome_secured',        width: 14 },
    { header: 'Last Activity',   key: 'last_activity',          width: 16 },
    { header: 'Primary Contact', key: 'primary_contact',        width: 22 },
    { header: 'Email',           key: 'contact_email',          width: 26 },
    { header: 'Phone',           key: 'contact_phone',          width: 18 },
  ];
  rows.forEach((r) => sheet.addRow({
    ...r,
    outcome_secured: r.outcome_secured ? 'Yes' : 'No',
  }));
  setHeaderStyle(sheet);
  // Tint the overdue column red when > 0.
  const overdueCol = sheet.getColumn('overdue_count');
  overdueCol.eachCell({ includeEmpty: false }, (cell, rowIdx) => {
    if (rowIdx === 1) return;
    if (typeof cell.value === 'number' && cell.value > 0) {
      cell.font = { bold: true, color: { argb: RED } };
    }
  });
  applyAutoFilter(sheet, 'M', rows.length + 1);
  return sheet;
}

function commStatus(c) {
  if (c.is_overdue) return 'Overdue';
  if (c.direction === 'Outbound' && c.reply_received) return 'Replied';
  if (c.direction === 'Outbound' && c.reply_needed) return 'Awaiting reply';
  return 'Logged';
}

function momLabel(s) {
  return { pending: 'Pending', draft: 'Draft', final: 'Final' }[s] || (s || '');
}

function buildCommunicationsSheet(book, rows) {
  const sheet = book.addWorksheet('Communications', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Code',             key: 'comm_code',            width: 10 },
    { header: 'Date',             key: 'comm_date',            width: 12 },
    { header: 'Direction',        key: 'direction',            width: 11 },
    { header: 'Authority',        key: 'authority_code',       width: 12 },
    { header: 'Sub-Division Ref', key: 'sub_reference',        width: 13 },
    { header: 'Sub-Division',     key: 'sub_division_name',    width: 36 },
    { header: 'Purpose',          key: 'purpose',              width: 22 },
    { header: 'Mode',             key: 'mode',                 width: 14 },
    { header: 'Submission Ref',   key: 'submission_reference', width: 28 },
    { header: 'In Response To',   key: 'in_response_to_code',  width: 14 },
    { header: 'Replied By',       key: 'reply_code',           width: 12 },
    { header: 'Related To',       key: 'related_to_code',      width: 12 },
    { header: 'Summary',          key: 'summary',              width: 60 },
    { header: 'Reply Needed',     key: 'reply_needed_str',     width: 12 },
    { header: 'Reply Received',   key: 'reply_received_str',   width: 14 },
    { header: 'Status',           key: 'status',               width: 16 },
    { header: 'ACC Link',         key: 'acc_link',             width: 28 },
    { header: 'Documents',        key: 'document_count',       width: 10 },
  ];
  rows.forEach((r) => sheet.addRow({
    ...r,
    reply_needed_str: r.reply_needed ? 'Yes' : 'No',
    reply_received_str: r.reply_received ? 'Yes' : 'No',
    status: commStatus(r),
  }));
  setHeaderStyle(sheet);
  const statusCol = sheet.getColumn('status');
  statusCol.eachCell({ includeEmpty: false }, (cell, rowIdx) => {
    if (rowIdx === 1) return;
    if (cell.value === 'Overdue') cell.font = { bold: true, color: { argb: RED } };
    else if (cell.value === 'Replied') cell.font = { color: { argb: GREEN } };
    else if (cell.value === 'Awaiting reply') cell.font = { color: { argb: AMBER } };
  });
  applyAutoFilter(sheet, 'R', rows.length + 1);
  return sheet;
}

function buildMeetingsSheet(book, rows) {
  const sheet = book.addWorksheet('Meetings', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Code',                key: 'meeting_code',          width: 10 },
    { header: 'Date',                key: 'meeting_date',          width: 12 },
    { header: 'Time',                key: 'meeting_time_str',      width: 8 },
    { header: 'Authority',           key: 'authority_code',        width: 12 },
    { header: 'Authority Name',      key: 'authority_name',        width: 30 },
    { header: 'Primary Sub Ref',     key: 'primary_sub_reference', width: 14 },
    { header: 'Primary Sub',         key: 'primary_sub_name',      width: 30 },
    { header: 'Attendees',           key: 'attendees',             width: 28 },
    { header: 'Purpose',             key: 'purpose',               width: 22 },
    { header: 'Mode',                key: 'mode',                  width: 14 },
    { header: 'Location',            key: 'location',              width: 24 },
    { header: 'MoM Status',          key: 'mom_status_str',        width: 14 },
    { header: 'MoM Reference',       key: 'mom_reference',         width: 22 },
    { header: 'MoM Link',            key: 'mom_link',              width: 30 },
    { header: 'Other Sub-Divisions', key: 'other_sub_divisions',   width: 30 },
  ];
  const MOM_LABEL = { pending: 'Pending', draft: 'Draft received', final: 'Final received' };
  rows.forEach((r) => sheet.addRow({
    ...r,
    meeting_time_str: r.meeting_time ? String(r.meeting_time).slice(0, 5) : '',
    mom_status_str: MOM_LABEL[r.mom_status] || r.mom_status || '',
  }));
  setHeaderStyle(sheet);
  // Tint the MoM-status cell: pending red, draft amber, final green.
  sheet.getColumn('mom_status_str').eachCell({ includeEmpty: false }, (cell, rowIdx) => {
    if (rowIdx === 1) return;
    if (cell.value === 'Pending') cell.font = { bold: true, color: { argb: RED } };
    else if (cell.value === 'Draft received') cell.font = { color: { argb: AMBER } };
    else if (cell.value === 'Final received') cell.font = { color: { argb: GREEN } };
  });
  applyAutoFilter(sheet, 'O', rows.length + 1);
  return sheet;
}

// QDRS records have no portal-style status field, so we derive a received
// status from whether the data files actually arrived (documents attached).
function qdrsStatus(r) {
  return Number(r.document_count) > 0 ? 'Data received' : 'Pending data';
}

function buildQdrsSheet(book, rows) {
  const sheet = book.addWorksheet('QDRS', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Code',              key: 'qdrs_code',         width: 10 },
    { header: 'Date',              key: 'qdrs_date',         width: 12 },
    { header: 'Authority Code',    key: 'authority_code',    width: 14 },
    { header: 'Authority',         key: 'authority_name',    width: 30 },
    { header: 'Sub-Authority Ref', key: 'sub_reference',     width: 16 },
    { header: 'Sub-Authority',     key: 'sub_division_name', width: 32 },
    { header: 'Category',          key: 'category',          width: 20 },
    { header: 'Reference',         key: 'reference',         width: 24 },
    { header: 'Status',            key: 'status',            width: 16 },
    { header: 'Documents',         key: 'document_count',    width: 10 },
    { header: 'Summary',           key: 'summary',           width: 60 },
  ];
  rows.forEach((r) => sheet.addRow({ ...r, status: qdrsStatus(r) }));
  setHeaderStyle(sheet);
  // Status: received green, pending amber.
  sheet.getColumn('status').eachCell({ includeEmpty: false }, (cell, rowIdx) => {
    if (rowIdx === 1) return;
    if (cell.value === 'Data received') cell.font = { color: { argb: GREEN } };
    else if (cell.value === 'Pending data') cell.font = { bold: true, color: { argb: AMBER } };
  });
  applyAutoFilter(sheet, 'K', rows.length + 1);
  return sheet;
}

function buildCoverSheet(book, { title, subtitle, kpis }) {
  const cover = book.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  cover.columns = [{ width: 4 }, { width: 24 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 8 }];

  cover.getCell('B2').value = 'Safari Park Project';
  cover.getCell('B2').font = { bold: true, size: 11, color: { argb: NAVY } };
  cover.getCell('B3').value = title;
  cover.getCell('B3').font = { bold: true, size: 22, color: { argb: NAVY_DARK } };
  if (subtitle) {
    cover.getCell('B4').value = subtitle;
    cover.getCell('B4').font = { color: { argb: 'FF6E6E73' }, size: 11 };
  }
  cover.getCell('B5').value = 'Generated ' + new Date().toLocaleString();
  cover.getCell('B5').font = { color: { argb: 'FF6E6E73' }, size: 10 };

  // KPI tiles starting at row 8.
  const cols = ['C', 'D', 'E', 'F'];
  kpis.forEach((kpi, i) => {
    const col = cols[i % 4];
    const labelCell = cover.getCell(col + '7');
    const valueCell = cover.getCell(col + '8');
    labelCell.value = kpi.label;
    labelCell.font = { bold: true, size: 10, color: { argb: NAVY } };
    valueCell.value = kpi.value;
    valueCell.font = { bold: true, size: 22, color: { argb: NAVY_DARK } };
  });
  cover.getRow(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_SOFT } };
  cover.getRow(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_SOFT } };
  cover.getRow(7).height = 18;
  cover.getRow(8).height = 32;
}

// --- route handlers ---------------------------------------------------------
function dl(filename) {
  return filename + '_' + stamp();
}

router.get(
  '/authorities.xlsx',
  wrap(async (req, res) => {
    const rows = await fetchAuthorities();
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    buildAuthoritiesSheet(book, rows);
    await logAudit({
      actor_id: req.user.id, event: 'data.export.authorities',
      payload: { format: 'xlsx', rows: rows.length }, req,
    });
    setDownloadHeaders(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${dl('authorities')}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/sub-divisions.xlsx',
  wrap(async (req, res) => {
    const rows = await fetchSubDivisions();
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    buildSubDivisionsSheet(book, rows);
    await logAudit({
      actor_id: req.user.id, event: 'data.export.sub_divisions',
      payload: { format: 'xlsx', rows: rows.length }, req,
    });
    setDownloadHeaders(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${dl('sub-divisions')}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/communications.xlsx',
  wrap(async (req, res) => {
    const { from, to } = dateRange(req);
    const rows = await fetchCommunications(from, to);
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    buildCommunicationsSheet(book, rows);
    await logAudit({
      actor_id: req.user.id, event: 'data.export.communications',
      payload: { format: 'xlsx', rows: rows.length, from, to }, req,
    });
    setDownloadHeaders(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${dl('communications')}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/meetings.xlsx',
  wrap(async (req, res) => {
    const { from, to } = dateRange(req);
    const rows = await fetchMeetings(from, to);
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    buildMeetingsSheet(book, rows);
    await logAudit({
      actor_id: req.user.id, event: 'data.export.meetings',
      payload: { format: 'xlsx', rows: rows.length, from, to }, req,
    });
    setDownloadHeaders(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${dl('meetings')}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/qdrs.xlsx',
  wrap(async (req, res) => {
    const { from, to } = dateRange(req);
    const rows = await fetchQdrs(from, to);
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    buildQdrsSheet(book, rows);
    await logAudit({
      actor_id: req.user.id, event: 'data.export.qdrs',
      payload: { format: 'xlsx', rows: rows.length, from, to }, req,
    });
    setDownloadHeaders(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${dl('qdrs')}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/engagement-register.xlsx',
  wrap(async (req, res) => {
    const { from, to } = dateRange(req);
    const [authorities, subs, comms, meetings, qdrs] = await Promise.all([
      fetchAuthorities(), fetchSubDivisions(), fetchCommunications(from, to),
      fetchMeetings(from, to), fetchQdrs(from, to),
    ]);
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    book.title = 'Safari Park Project — Authority Engagement Register';

    buildCoverSheet(book, {
      title: 'Engagement Register',
      subtitle: `ECG · Design Consultancy · Contract No. 6   ·   Period: ${windowLabel(from, to)}`,
      kpis: [
        { label: 'Authorities',     value: authorities.length },
        { label: 'Sub-Divisions',   value: subs.length },
        { label: 'Communications',  value: comms.length },
        { label: 'QDRS received',   value: qdrs.filter((r) => Number(r.document_count) > 0).length },
      ],
    });
    buildAuthoritiesSheet(book, authorities);
    buildSubDivisionsSheet(book, subs);
    buildCommunicationsSheet(book, comms);
    buildMeetingsSheet(book, meetings);
    buildQdrsSheet(book, qdrs);

    await logAudit({
      actor_id: req.user.id, event: 'data.export.engagement_register',
      payload: {
        format: 'xlsx', from, to,
        rows: {
          authorities: authorities.length, sub_divisions: subs.length,
          communications: comms.length, meetings: meetings.length, qdrs: qdrs.length,
        },
      }, req,
    });
    setDownloadHeaders(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${dl('engagement-register')}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/authority/:id.xlsx',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const auth = (await query('SELECT * FROM v_authority WHERE id = $1', [id])).rows[0];
    if (!auth) throw httpError(404, 'Authority not found.');
    const subs = (await query(
      'SELECT * FROM v_sub_division WHERE authority_id = $1 ORDER BY seq_no', [id]
    )).rows;
    const comms = (await query(
      'SELECT * FROM v_communication WHERE authority_id = $1 ORDER BY comm_date DESC, id DESC', [id]
    )).rows;
    const meetings = (await query(
      `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
              sd.sub_reference AS primary_sub_reference, sd.name AS primary_sub_name
       FROM meetings m
       JOIN authorities a ON a.id = m.authority_id AND a.deleted_at IS NULL
       LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id
       WHERE m.authority_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.meeting_date DESC, m.id DESC`, [id]
    )).rows;

    const qdrs = await fetchQdrs(null, null, id);

    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    book.title = `${auth.code} — ${auth.name}`;

    buildCoverSheet(book, {
      title: auth.name,
      subtitle: auth.code + ' · ' + (auth.category || ''),
      kpis: [
        { label: 'Sub-Divisions',  value: subs.length },
        { label: 'Communications', value: comms.length },
        { label: 'Meetings',       value: meetings.length },
        { label: 'QDRS records',   value: qdrs.length },
      ],
    });
    buildSubDivisionsSheet(book, subs);
    buildCommunicationsSheet(book, comms);
    if (meetings.length) buildMeetingsSheet(book, meetings);
    if (qdrs.length) buildQdrsSheet(book, qdrs);

    await logAudit({
      actor_id: req.user.id, event: 'data.export.authority',
      target_type: 'authority', target_id: id,
      payload: { format: 'xlsx', authority_code: auth.code,
        rows: { sub_divisions: subs.length, communications: comms.length, meetings: meetings.length, qdrs: qdrs.length } },
      req,
    });
    setDownloadHeaders(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${dl('authority-' + auth.code)}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  })
);

// --- PDF helpers ------------------------------------------------------------
function pdfHeader(doc, { title, subtitle }) {
  // Navy stripe
  doc.rect(0, 0, doc.page.width, 70).fill('#4F46E5');
  doc.fillColor('white');
  doc.font('Helvetica-Bold').fontSize(10)
    .text('SAFARI PARK PROJECT', 40, 18, { characterSpacing: 1.4 });
  doc.font('Helvetica-Bold').fontSize(18).text(title, 40, 32);
  if (subtitle) {
    doc.font('Helvetica').fontSize(10).fillColor('#EEF2FF').text(subtitle, 40, 56);
  }
  doc.fillColor('black');
  doc.font('Helvetica').fontSize(9).text(
    'Generated ' + new Date().toLocaleString(),
    doc.page.width - 220, 28, { width: 180, align: 'right' }
  );
  doc.moveDown(2);
  doc.y = 90;
}

function pdfSection(doc, title) {
  doc.moveDown(0.6);
  doc.fillColor('#4F46E5').font('Helvetica-Bold').fontSize(13).text(title);
  doc.strokeColor('#D6D6DA').lineWidth(0.5)
    .moveTo(40, doc.y + 4).lineTo(doc.page.width - 40, doc.y + 4).stroke();
  doc.moveDown(0.6);
  doc.fillColor('black').font('Helvetica').fontSize(10);
}

function pdfKpiTiles(doc, kpis) {
  const tileW = (doc.page.width - 80 - (kpis.length - 1) * 10) / kpis.length;
  const y = doc.y;
  kpis.forEach((kpi, i) => {
    const x = 40 + i * (tileW + 10);
    doc.rect(x, y, tileW, 56).fill('#EEF2FF');
    doc.fillColor('#4F46E5').font('Helvetica-Bold').fontSize(9)
      .text(kpi.label.toUpperCase(), x + 12, y + 8, { characterSpacing: 0.6 });
    doc.fillColor('#3730A3').font('Helvetica-Bold').fontSize(22)
      .text(String(kpi.value), x + 12, y + 22);
  });
  doc.y = y + 64;
  doc.fillColor('black');
}

// Aligned table renderer. The key fix vs. the old version: every cell in a row
// is drawn at ONE captured baseline `y` (computed once per row) instead of the
// live `doc.y`, which pdfkit advances after each text() call — that drift was
// what made the old PDF look staircased. Columns get fixed x positions; the
// header repeats on each page break.
function pdfTable(doc, columns, rows, opts = {}) {
  const left = 40;
  const right = doc.page.width - 40;
  const totalUnits = columns.reduce((s, c) => s + (c.units || 1), 0);
  const unit = (right - left) / totalUnits;
  const cellH = opts.cellH || 17;
  const bottom = doc.page.height - 40;
  const FS = 8.5;

  const colX = (i) => {
    let x = left;
    for (let k = 0; k < i; k++) x += unit * (columns[k].units || 1);
    return x;
  };
  const colW = (i) => unit * (columns[i].units || 1);

  // Pre-clip to the column width so a cell can NEVER wrap to a second line.
  // pdfkit breaks on hyphens even with lineBreak:false, so we measure and trim
  // ourselves, appending an ellipsis. The active font/size must be set first.
  const fit = (s, w) => {
    if (doc.widthOfString(s) <= w) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (doc.widthOfString(s.slice(0, mid) + '…') <= w) lo = mid; else hi = mid - 1;
    }
    return (lo > 0 ? s.slice(0, lo) : '') + '…';
  };

  function drawHeader() {
    const y = doc.y;
    doc.rect(left, y, right - left, cellH).fill('#4F46E5');
    doc.font('Helvetica-Bold').fontSize(FS).fillColor('white');
    columns.forEach((c, i) => {
      doc.text(fit(c.label, colW(i) - 8), colX(i) + 4, y + 4.5,
        { width: colW(i) - 8, lineBreak: false });
    });
    doc.fillColor('black');
    doc.y = y + cellH;
  }

  // If the preceding section title pushed the cursor near/below the page
  // bottom, start a fresh page before drawing the header. Otherwise each header
  // cell's text() call, positioned past the page bottom, spills onto its own
  // page — producing a run of near-blank pages in the export.
  if (doc.y + cellH * 2 > bottom) {
    doc.addPage();
    pdfHeader(doc, { title: opts.title || 'Report', subtitle: opts.subtitle });
  }
  drawHeader();
  rows.forEach((r, idx) => {
    if (doc.y + cellH > bottom) {
      doc.addPage();
      pdfHeader(doc, { title: opts.title || 'Report', subtitle: opts.subtitle });
      drawHeader();
    }
    const y = doc.y;                       // capture ONE baseline for the whole row
    if (idx % 2 === 1) {
      doc.rect(left, y, right - left, cellH).fill('#F4F6FB');
    }
    doc.font('Helvetica').fontSize(FS).fillColor('#1A1A1A');
    columns.forEach((c, i) => {
      const raw = c.get(r);
      // Collapse newlines / tabs / whitespace runs to a single space so a cell
      // can never render multi-line. A free-text field with line breaks (e.g. a
      // pasted summary) otherwise makes pdfkit auto-add pages mid-cell, which
      // desynced the table's own pagination and left blank pages in the export.
      const s = raw == null ? '' : String(raw).replace(/\s+/g, ' ').trim();
      doc.text(fit(s, colW(i) - 8), colX(i) + 4, y + 4.5,
        { width: colW(i) - 8, lineBreak: false });
    });
    doc.fillColor('black');
    doc.y = y + cellH;                     // advance exactly one row, once
  });
  // thin closing rule under the table
  doc.strokeColor('#E2E8F0').lineWidth(0.5)
    .moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.moveDown(0.6);
}

function fmtDateSafe(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

// --- engagement register PDF -----------------------------------------------
router.get(
  '/engagement-register.pdf',
  wrap(async (req, res) => {
    const { from, to } = dateRange(req);
    const [authorities, subs, comms, meetings, qdrs] = await Promise.all([
      fetchAuthorities(), fetchSubDivisions(), fetchCommunications(from, to),
      fetchMeetings(from, to), fetchQdrs(from, to),
    ]);

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    setDownloadHeaders(res, 'application/pdf', `${dl('engagement-register')}.pdf`);
    doc.pipe(res);

    pdfHeader(doc, {
      title: 'Engagement Register',
      subtitle: `ECG · Design Consultancy · Contract No. 6   ·   Period: ${windowLabel(from, to)}`,
    });
    pdfKpiTiles(doc, [
      { label: 'Authorities',    value: authorities.length },
      { label: 'Sub-Divisions',  value: subs.length },
      { label: 'Communications', value: comms.length },
      { label: 'Meetings',       value: meetings.length },
      { label: 'QDRS',           value: qdrs.length },
    ]);

    pdfSection(doc, 'Authorities');
    pdfTable(doc,
      [
        { label: 'Code',     get: (r) => r.code,               units: 1 },
        { label: 'Authority',get: (r) => r.name,               units: 5 },
        { label: 'Category', get: (r) => r.category || '',     units: 3 },
        { label: 'Subs',     get: (r) => r.sub_division_count, units: 1 },
        { label: 'Engaged',  get: (r) => r.sub_divisions_engaged, units: 1 },
        { label: 'Outcomes', get: (r) => r.outcome_secured_count, units: 1 },
      ],
      authorities,
      { title: 'Engagement Register', subtitle: 'Authorities' }
    );

    pdfSection(doc, 'Sub-Divisions');
    pdfTable(doc,
      [
        { label: 'Ref',     get: (r) => r.sub_reference,         units: 1.6 },
        { label: 'Sub-Division', get: (r) => r.name,             units: 4.4 },
        { label: 'Authority', get: (r) => r.authority_code,      units: 1 },
        { label: 'Status',  get: (r) => r.engagement_status,     units: 2 },
        { label: 'NOC',     get: (r) => r.noc_status,            units: 2 },
        { label: 'Out',     get: (r) => r.outbound_count,        units: 1 },
        { label: 'In',      get: (r) => r.inbound_count,         units: 1 },
        { label: 'Overdue', get: (r) => r.overdue_count,         units: 1 },
      ],
      subs,
      { title: 'Engagement Register', subtitle: 'Sub-Divisions' }
    );

    doc.addPage();
    pdfHeader(doc, { title: 'Communications Log', subtitle: 'ECG · Design Consultancy · Contract No. 6' });
    pdfTable(doc,
      [
        { label: 'Code',  get: (r) => r.comm_code,         units: 1 },
        { label: 'Date',  get: (r) => fmtDateSafe(r.comm_date), units: 1.5 },
        { label: 'Dir',   get: (r) => r.direction,         units: 1 },
        { label: 'Auth',  get: (r) => r.authority_code,    units: 1 },
        { label: 'Sub',   get: (r) => r.sub_reference,     units: 1.5 },
        { label: 'Purpose', get: (r) => r.purpose || '',   units: 2.5 },
        { label: 'Summary', get: (r) => r.summary || '',   units: 6 },
        { label: 'Status', get: (r) => commStatus(r),      units: 1.5 },
      ],
      comms,
      { title: 'Engagement Register', subtitle: 'Communications' }
    );

    if (meetings.length) {
      doc.addPage();
      pdfHeader(doc, { title: 'Meetings Register', subtitle: 'ECG · Design Consultancy · Contract No. 6' });
      pdfTable(doc,
        [
          { label: 'Code',     get: (r) => r.meeting_code,       units: 1 },
          { label: 'Date',     get: (r) => fmtDateSafe(r.meeting_date), units: 1.6 },
          { label: 'Authority',get: (r) => r.authority_code + ' — ' + (r.authority_name || ''), units: 4 },
          { label: 'Attendees', get: (r) => r.attendees || '',  units: 2.4 },
          { label: 'Purpose',  get: (r) => r.purpose || '',     units: 2.4 },
          { label: 'Mode',     get: (r) => r.mode || '',        units: 1.5 },
          { label: 'MoM',      get: (r) => momLabel(r.mom_status), units: 1.6 },
        ],
        meetings,
        { title: 'Engagement Register', subtitle: 'Meetings' }
      );
    }

    if (qdrs.length) {
      doc.addPage();
      pdfHeader(doc, { title: 'QDRS — Data Received', subtitle: 'ECG · Design Consultancy · Contract No. 6' });
      pdfTable(doc,
        [
          { label: 'Code',     get: (r) => r.qdrs_code,          units: 1 },
          { label: 'Date',     get: (r) => fmtDateSafe(r.qdrs_date), units: 1.5 },
          { label: 'Auth',     get: (r) => r.authority_code,     units: 1 },
          { label: 'Sub',      get: (r) => r.sub_reference,      units: 1.5 },
          { label: 'Category', get: (r) => r.category || '',     units: 2.5 },
          { label: 'Reference', get: (r) => r.reference || '',   units: 2.5 },
          { label: 'Status',   get: (r) => qdrsStatus(r),        units: 1.6 },
          { label: 'Docs',     get: (r) => r.document_count,     units: 0.8 },
        ],
        qdrs,
        { title: 'Engagement Register', subtitle: 'QDRS' }
      );
    }

    await logAudit({
      actor_id: req.user.id, event: 'data.export.engagement_register',
      payload: {
        format: 'pdf',
        rows: { authorities: authorities.length, sub_divisions: subs.length,
                communications: comms.length, meetings: meetings.length, qdrs: qdrs.length },
      },
      req,
    });
    doc.end();
  })
);

// --- per-authority PDF ------------------------------------------------------
router.get(
  '/authority/:id.pdf',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw httpError(400, 'Invalid id.');
    const auth = (await query('SELECT * FROM v_authority WHERE id = $1', [id])).rows[0];
    if (!auth) throw httpError(404, 'Authority not found.');

    const subs = (await query(
      'SELECT * FROM v_sub_division WHERE authority_id = $1 ORDER BY seq_no', [id]
    )).rows;
    const comms = (await query(
      'SELECT * FROM v_communication WHERE authority_id = $1 ORDER BY comm_date DESC, id DESC', [id]
    )).rows;
    const meetings = (await query(
      `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
              sd.sub_reference AS primary_sub_reference, sd.name AS primary_sub_name
       FROM meetings m
       JOIN authorities a ON a.id = m.authority_id AND a.deleted_at IS NULL
       LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id
       WHERE m.authority_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.meeting_date DESC, m.id DESC`, [id]
    )).rows;
    const qdrs = await fetchQdrs(null, null, id);

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    setDownloadHeaders(res, 'application/pdf', `${dl('authority-' + auth.code)}.pdf`);
    doc.pipe(res);

    pdfHeader(doc, { title: auth.name, subtitle: auth.code + ' · ' + (auth.category || '') });
    pdfKpiTiles(doc, [
      { label: 'Sub-Divisions',  value: subs.length },
      { label: 'Communications', value: comms.length },
      { label: 'Overdue',        value: comms.filter((c) => c.is_overdue).length },
      { label: 'Meetings',       value: meetings.length },
      { label: 'QDRS',           value: qdrs.length },
    ]);

    pdfSection(doc, 'Sub-Divisions');
    if (!subs.length) {
      doc.fillColor('#6E6E73').text('No sub-divisions yet.');
    } else {
      pdfTable(doc,
        [
          { label: 'Ref',     get: (r) => r.sub_reference,    units: 1.6 },
          { label: 'Sub-Division', get: (r) => r.name,        units: 4.4 },
          { label: 'Status',  get: (r) => r.engagement_status, units: 2 },
          { label: 'NOC',     get: (r) => r.noc_status,       units: 2 },
          { label: 'Out',     get: (r) => r.outbound_count,   units: 1 },
          { label: 'In',      get: (r) => r.inbound_count,    units: 1 },
          { label: 'Overdue', get: (r) => r.overdue_count,    units: 1 },
        ],
        subs,
        { title: auth.name, subtitle: 'Sub-Divisions' }
      );
    }

    doc.addPage();
    pdfHeader(doc, { title: auth.name + ' — Communications', subtitle: auth.code });
    if (!comms.length) {
      doc.fillColor('#6E6E73').text('No communications logged yet.');
    } else {
      pdfTable(doc,
        [
          { label: 'Code',  get: (r) => r.comm_code,         units: 1 },
          { label: 'Date',  get: (r) => fmtDateSafe(r.comm_date), units: 1.5 },
          { label: 'Dir',   get: (r) => r.direction,         units: 1 },
          { label: 'Sub',   get: (r) => r.sub_reference,     units: 1.5 },
          { label: 'Purpose', get: (r) => r.purpose || '',   units: 2.5 },
          { label: 'Summary', get: (r) => r.summary || '',   units: 6 },
          { label: 'Status', get: (r) => commStatus(r),      units: 1.5 },
        ],
        comms,
        { title: auth.name, subtitle: 'Communications' }
      );
    }

    if (meetings.length) {
      doc.addPage();
      pdfHeader(doc, { title: auth.name + ' — Meetings', subtitle: auth.code });
      pdfTable(doc,
        [
          { label: 'Code',     get: (r) => r.meeting_code,        units: 1 },
          { label: 'Date',     get: (r) => fmtDateSafe(r.meeting_date), units: 1.6 },
          { label: 'Primary Sub', get: (r) => r.primary_sub_reference || '', units: 1.5 },
          { label: 'Attendees', get: (r) => r.attendees || '',    units: 2.5 },
          { label: 'Purpose',  get: (r) => r.purpose || '',       units: 2.5 },
          { label: 'Mode',     get: (r) => r.mode || '',          units: 1.5 },
          { label: 'MoM',      get: (r) => momLabel(r.mom_status), units: 1.4 },
        ],
        meetings,
        { title: auth.name, subtitle: 'Meetings' }
      );
    }

    if (qdrs.length) {
      doc.addPage();
      pdfHeader(doc, { title: auth.name + ' — QDRS', subtitle: auth.code + ' · Data received' });
      pdfTable(doc,
        [
          { label: 'Code',     get: (r) => r.qdrs_code,          units: 1 },
          { label: 'Date',     get: (r) => fmtDateSafe(r.qdrs_date), units: 1.5 },
          { label: 'Sub',      get: (r) => r.sub_reference,      units: 1.5 },
          { label: 'Category', get: (r) => r.category || '',     units: 2.5 },
          { label: 'Reference', get: (r) => r.reference || '',   units: 2.5 },
          { label: 'Status',   get: (r) => qdrsStatus(r),        units: 1.6 },
          { label: 'Docs',     get: (r) => r.document_count,     units: 0.8 },
        ],
        qdrs,
        { title: auth.name, subtitle: 'QDRS' }
      );
    }

    await logAudit({
      actor_id: req.user.id, event: 'data.export.authority',
      target_type: 'authority', target_id: id,
      payload: { format: 'pdf', authority_code: auth.code,
        rows: { sub_divisions: subs.length, communications: comms.length, meetings: meetings.length, qdrs: qdrs.length } },
      req,
    });
    doc.end();
  })
);

module.exports = router;
