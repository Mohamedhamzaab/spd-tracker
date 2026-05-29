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
const NAVY = 'FF1F4E79';
const NAVY_DARK = 'FF173A5A';
const NAVY_SOFT = 'FFEEF3F8';
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

// --- data fetchers (live rows only) -----------------------------------------
async function fetchAuthorities() {
  return (await query('SELECT * FROM v_authority ORDER BY code')).rows;
}
async function fetchSubDivisions() {
  return (await query('SELECT * FROM v_sub_division ORDER BY authority_code, seq_no')).rows;
}
async function fetchCommunications() {
  return (await query('SELECT * FROM v_communication ORDER BY comm_date DESC, id DESC')).rows;
}
async function fetchMeetings() {
  return (await query(
    `SELECT m.*, a.code AS authority_code, a.name AS authority_name,
            sd.sub_reference AS primary_sub_reference,
            sd.name AS primary_sub_name
     FROM meetings m
     JOIN authorities a ON a.id = m.authority_id AND a.deleted_at IS NULL
     LEFT JOIN sub_divisions sd ON sd.id = m.primary_sub_id
     WHERE m.deleted_at IS NULL
     ORDER BY m.meeting_date DESC, m.id DESC`
  )).rows;
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
  applyAutoFilter(sheet, 'P', rows.length + 1);
  return sheet;
}

function buildMeetingsSheet(book, rows) {
  const sheet = book.addWorksheet('Meetings', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Code',                key: 'meeting_code',          width: 10 },
    { header: 'Date',                key: 'meeting_date',          width: 12 },
    { header: 'Authority',           key: 'authority_code',        width: 12 },
    { header: 'Authority Name',      key: 'authority_name',        width: 30 },
    { header: 'Primary Sub Ref',     key: 'primary_sub_reference', width: 14 },
    { header: 'Primary Sub',         key: 'primary_sub_name',      width: 30 },
    { header: 'Purpose',             key: 'purpose',               width: 22 },
    { header: 'Mode',                key: 'mode',                  width: 14 },
    { header: 'Location',            key: 'location',              width: 24 },
    { header: 'MoM Reference',       key: 'mom_reference',         width: 22 },
    { header: 'MoM Link',            key: 'mom_link',              width: 30 },
    { header: 'Other Sub-Divisions', key: 'other_sub_divisions',   width: 30 },
  ];
  rows.forEach((r) => sheet.addRow(r));
  setHeaderStyle(sheet);
  applyAutoFilter(sheet, 'L', rows.length + 1);
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
    const rows = await fetchCommunications();
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    buildCommunicationsSheet(book, rows);
    await logAudit({
      actor_id: req.user.id, event: 'data.export.communications',
      payload: { format: 'xlsx', rows: rows.length }, req,
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
    const rows = await fetchMeetings();
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    buildMeetingsSheet(book, rows);
    await logAudit({
      actor_id: req.user.id, event: 'data.export.meetings',
      payload: { format: 'xlsx', rows: rows.length }, req,
    });
    setDownloadHeaders(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${dl('meetings')}.xlsx`);
    await book.xlsx.write(res);
    res.end();
  })
);

router.get(
  '/engagement-register.xlsx',
  wrap(async (req, res) => {
    const [authorities, subs, comms, meetings] = await Promise.all([
      fetchAuthorities(), fetchSubDivisions(), fetchCommunications(), fetchMeetings(),
    ]);
    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    book.title = 'Safari Park Project — Authority Engagement Register';

    buildCoverSheet(book, {
      title: 'Engagement Register',
      subtitle: 'ECG · Design Consultancy · Contract No. 6',
      kpis: [
        { label: 'Authorities',     value: authorities.length },
        { label: 'Sub-Divisions',   value: subs.length },
        { label: 'Communications',  value: comms.length },
        { label: 'Overdue items',   value: comms.filter((c) => c.is_overdue).length },
      ],
    });
    buildAuthoritiesSheet(book, authorities);
    buildSubDivisionsSheet(book, subs);
    buildCommunicationsSheet(book, comms);
    buildMeetingsSheet(book, meetings);

    await logAudit({
      actor_id: req.user.id, event: 'data.export.engagement_register',
      payload: {
        format: 'xlsx',
        rows: {
          authorities: authorities.length, sub_divisions: subs.length,
          communications: comms.length, meetings: meetings.length,
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

    const book = new ExcelJS.Workbook();
    book.creator = 'SPD Tracker';
    book.title = `${auth.code} — ${auth.name}`;

    buildCoverSheet(book, {
      title: auth.name,
      subtitle: auth.code + ' · ' + (auth.category || ''),
      kpis: [
        { label: 'Sub-Divisions',  value: subs.length },
        { label: 'Engaged',        value: auth.sub_divisions_engaged },
        { label: 'Communications', value: comms.length },
        { label: 'Overdue items',  value: comms.filter((c) => c.is_overdue).length },
      ],
    });
    buildSubDivisionsSheet(book, subs);
    buildCommunicationsSheet(book, comms);
    if (meetings.length) buildMeetingsSheet(book, meetings);

    await logAudit({
      actor_id: req.user.id, event: 'data.export.authority',
      target_type: 'authority', target_id: id,
      payload: { format: 'xlsx', authority_code: auth.code,
        rows: { sub_divisions: subs.length, communications: comms.length, meetings: meetings.length } },
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
  doc.rect(0, 0, doc.page.width, 70).fill('#1F4E79');
  doc.fillColor('white');
  doc.font('Helvetica-Bold').fontSize(10)
    .text('SAFARI PARK PROJECT', 40, 18, { characterSpacing: 1.4 });
  doc.font('Helvetica-Bold').fontSize(18).text(title, 40, 32);
  if (subtitle) {
    doc.font('Helvetica').fontSize(10).fillColor('#EEF3F8').text(subtitle, 40, 56);
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
  doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(13).text(title);
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
    doc.rect(x, y, tileW, 56).fill('#EEF3F8');
    doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(9)
      .text(kpi.label.toUpperCase(), x + 12, y + 8, { characterSpacing: 0.6 });
    doc.fillColor('#173A5A').font('Helvetica-Bold').fontSize(22)
      .text(String(kpi.value), x + 12, y + 22);
  });
  doc.y = y + 64;
  doc.fillColor('black');
}

// Minimal table renderer: a horizontal row per record, columns in fixed widths.
function pdfTable(doc, columns, rows, opts = {}) {
  const left = 40;
  const right = doc.page.width - 40;
  const totalUnits = columns.reduce((s, c) => s + (c.units || 1), 0);
  const unit = (right - left) / totalUnits;

  const cellH = opts.cellH || 18;

  function drawRow(rowVals, isHeader) {
    if (isHeader) doc.font('Helvetica-Bold').fontSize(9);
    else doc.font('Helvetica').fontSize(9);

    if (doc.y + cellH > doc.page.height - 50) {
      doc.addPage();
      pdfHeader(doc, { title: opts.title || 'Report', subtitle: opts.subtitle });
    }

    let x = left;
    if (isHeader) {
      doc.rect(left, doc.y - 2, right - left, cellH).fill('#1F4E79');
      doc.fillColor('white');
    } else {
      doc.fillColor('black');
    }
    columns.forEach((c, i) => {
      const w = unit * (c.units || 1);
      const raw = rowVals[i] == null ? '' : String(rowVals[i]);
      doc.text(raw, x + 4, doc.y, { width: w - 8, ellipsis: true, height: cellH - 4, lineBreak: false });
      x += w;
    });
    doc.y += cellH;
    doc.fillColor('black');
  }

  drawRow(columns.map((c) => c.label), true);
  rows.forEach((r, i) => {
    if (i % 2 === 1) {
      doc.rect(left, doc.y - 2, right - left, cellH).fill('#F7F9FC');
    }
    drawRow(columns.map((c) => c.get(r)), false);
  });
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
    const [authorities, subs, comms, meetings] = await Promise.all([
      fetchAuthorities(), fetchSubDivisions(), fetchCommunications(), fetchMeetings(),
    ]);

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    setDownloadHeaders(res, 'application/pdf', `${dl('engagement-register')}.pdf`);
    doc.pipe(res);

    pdfHeader(doc, {
      title: 'Engagement Register',
      subtitle: 'ECG · Design Consultancy · Contract No. 6',
    });
    pdfKpiTiles(doc, [
      { label: 'Authorities',    value: authorities.length },
      { label: 'Sub-Divisions',  value: subs.length },
      { label: 'Communications', value: comms.length },
      { label: 'Overdue',        value: comms.filter((c) => c.is_overdue).length },
      { label: 'Meetings',       value: meetings.length },
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
        { label: 'Ref',     get: (r) => r.sub_reference,         units: 1 },
        { label: 'Sub-Division', get: (r) => r.name,             units: 5 },
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
          { label: 'Date',     get: (r) => fmtDateSafe(r.meeting_date), units: 1.5 },
          { label: 'Authority',get: (r) => r.authority_code + ' — ' + (r.authority_name || ''), units: 4 },
          { label: 'Primary Sub', get: (r) => r.primary_sub_reference || '', units: 1.5 },
          { label: 'Purpose',  get: (r) => r.purpose || '',     units: 3 },
          { label: 'Mode',     get: (r) => r.mode || '',        units: 1.5 },
          { label: 'Location', get: (r) => r.location || '',    units: 2 },
        ],
        meetings,
        { title: 'Engagement Register', subtitle: 'Meetings' }
      );
    }

    await logAudit({
      actor_id: req.user.id, event: 'data.export.engagement_register',
      payload: {
        format: 'pdf',
        rows: { authorities: authorities.length, sub_divisions: subs.length,
                communications: comms.length, meetings: meetings.length },
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

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    setDownloadHeaders(res, 'application/pdf', `${dl('authority-' + auth.code)}.pdf`);
    doc.pipe(res);

    pdfHeader(doc, { title: auth.name, subtitle: auth.code + ' · ' + (auth.category || '') });
    pdfKpiTiles(doc, [
      { label: 'Sub-Divisions',  value: subs.length },
      { label: 'Engaged',        value: auth.sub_divisions_engaged },
      { label: 'Communications', value: comms.length },
      { label: 'Overdue',        value: comms.filter((c) => c.is_overdue).length },
      { label: 'Meetings',       value: meetings.length },
    ]);

    pdfSection(doc, 'Sub-Divisions');
    if (!subs.length) {
      doc.fillColor('#6E6E73').text('No sub-divisions yet.');
    } else {
      pdfTable(doc,
        [
          { label: 'Ref',     get: (r) => r.sub_reference,    units: 1 },
          { label: 'Sub-Division', get: (r) => r.name,        units: 5 },
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
          { label: 'Date',     get: (r) => fmtDateSafe(r.meeting_date), units: 1.5 },
          { label: 'Primary Sub', get: (r) => r.primary_sub_reference || '', units: 1.5 },
          { label: 'Purpose',  get: (r) => r.purpose || '',       units: 3 },
          { label: 'Mode',     get: (r) => r.mode || '',          units: 1.5 },
          { label: 'Location', get: (r) => r.location || '',      units: 2 },
          { label: 'MoM Ref',  get: (r) => r.mom_reference || '', units: 2 },
        ],
        meetings,
        { title: auth.name, subtitle: 'Meetings' }
      );
    }

    await logAudit({
      actor_id: req.user.id, event: 'data.export.authority',
      target_type: 'authority', target_id: id,
      payload: { format: 'pdf', authority_code: auth.code,
        rows: { sub_divisions: subs.length, communications: comms.length, meetings: meetings.length } },
      req,
    });
    doc.end();
  })
);

module.exports = router;
