// ---------------------------------------------------------------------------
//  Reports — formal deliverables. Cards for the full Engagement Register
//  (Excel + PDF), per-list workbooks, and a per-authority drill-down picker.
//  Every download routes through the API so it is authenticated and audited.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Section, Loading, ErrorBanner, useToast } from '../components/ui.jsx';

export default function Reports() {
  const toast = useToast();
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [authorities, setAuthorities] = useState(null);
  const [authorityId, setAuthorityId] = useState('');
  // Optional reporting window — applied to the date-aware exports.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Append ?from=&to= to date-aware exports (register, communications, meetings).
  function withRange(path, dated) {
    if (!dated) return path;
    const qs = [];
    if (from) qs.push('from=' + from);
    if (to) qs.push('to=' + to);
    return qs.length ? `${path}?${qs.join('&')}` : path;
  }

  useEffect(() => {
    api.authorities().then((rows) => {
      setAuthorities(rows);
      if (rows.length && !authorityId) setAuthorityId(String(rows[0].id));
    }).catch(() => setAuthorities([]));
  }, []);

  async function go(key, path, filename) {
    setError('');
    setBusyKey(key);
    try {
      await api.downloadExport(path, filename);
      toast('Export downloaded.');
    } catch (e) {
      setError(e.message || 'Export failed.');
    } finally {
      setBusyKey(null);
    }
  }

  if (!authorities) return <Loading label="Loading reports" />;

  const cards = [
    {
      key: 'register-xlsx',
      title: 'Engagement Register — Excel',
      desc: 'One workbook with a summary cover sheet plus Authorities, Sub-Divisions, Communications, Meetings, and QDRS tabs. The headline deliverable.',
      path: '/exports/engagement-register.xlsx',
      filename: 'engagement-register.xlsx',
      primary: true,
      dated: true,
    },
    {
      key: 'register-pdf',
      title: 'Engagement Register — PDF',
      desc: 'Multi-page landscape PDF with KPI tiles and the same five sections (incl. QDRS). Easier to email or print.',
      path: '/exports/engagement-register.pdf',
      filename: 'engagement-register.pdf',
      primary: true,
      dated: true,
    },
    {
      key: 'authorities-xlsx',
      title: 'Authorities only — Excel',
      desc: 'Just the authority register with rolled-up counts.',
      path: '/exports/authorities.xlsx',
      filename: 'authorities.xlsx',
    },
    {
      key: 'subs-xlsx',
      title: 'Sub-Divisions only — Excel',
      desc: 'Per-sub-division engagement status and overdue counts. Overdue cells highlighted.',
      path: '/exports/sub-divisions.xlsx',
      filename: 'sub-divisions.xlsx',
    },
    {
      key: 'comms-xlsx',
      title: 'Communications only — Excel',
      desc: 'Full communication log with computed status (Overdue / Awaiting / Replied / Logged), plus the related-to link.',
      path: '/exports/communications.xlsx',
      filename: 'communications.xlsx',
      dated: true,
    },
    {
      key: 'meetings-xlsx',
      title: 'Meetings only — Excel',
      desc: 'Meeting register with time, attendees, primary sub-division, and MoM status (Pending / Draft / Final).',
      path: '/exports/meetings.xlsx',
      filename: 'meetings.xlsx',
      dated: true,
    },
    {
      key: 'qdrs-xlsx',
      title: 'QDRS only — Excel',
      desc: 'QDRS data-received log per sub-authority, with category, reference, document count, and status (Data received / Pending data).',
      path: '/exports/qdrs.xlsx',
      filename: 'qdrs.xlsx',
      dated: true,
    },
  ];

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Reports</div>
        </div>
      </div>

      <div className="page stack-lg">
        <ErrorBanner message={error} />

        <Section
          title="Time frame"
          note="Optional — limits the register and the communications / meetings logs to a date window"
        />
        <div className="card card-pad">
          <div className="report-range">
            <div className="field">
              <label className="field-label">From</label>
              <input
                type="date"
                className="input"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">To</label>
              <input
                type="date"
                className="input"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            {(from || to) && (
              <button
                className="btn btn-ghost"
                onClick={() => { setFrom(''); setTo(''); }}
              >
                Clear
              </button>
            )}
          </div>
          <div className="report-range-note">
            {from || to
              ? `Window: ${from || '…'} → ${to || '…'}. Authorities and Sub-Division registers always cover all records.`
              : 'No window set — exports cover all dates.'}
          </div>
        </div>

        <Section title="Engagement register" />
        <div className="report-grid">
          {cards.filter((c) => c.primary).map((c) => (
            <ReportCard
              key={c.key}
              card={c}
              busy={busyKey === c.key}
              onGo={() => go(c.key, withRange(c.path, c.dated), c.filename)}
            />
          ))}
        </div>

        <Section title="Per-list exports" />
        <div className="report-grid">
          {cards.filter((c) => !c.primary).map((c) => (
            <ReportCard
              key={c.key}
              card={c}
              busy={busyKey === c.key}
              onGo={() => go(c.key, withRange(c.path, c.dated), c.filename)}
            />
          ))}
        </div>

        <Section
          title="Per-authority drill-down"
          note="Single-authority report for stakeholder reviews"
        />
        <div className="card card-pad">
          <div className="field">
            <label className="field-label">Choose an authority</label>
            <select
              className="input"
              value={authorityId}
              onChange={(e) => setAuthorityId(e.target.value)}
            >
              {authorities.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <div className="report-actions">
            <button
              className="btn btn-primary"
              disabled={!authorityId || busyKey === 'authority-xlsx'}
              onClick={() => {
                const a = authorities.find((x) => String(x.id) === String(authorityId));
                go('authority-xlsx', `/exports/authority/${authorityId}.xlsx`,
                  `authority-${a?.code || authorityId}.xlsx`);
              }}
            >
              {busyKey === 'authority-xlsx' ? 'Exporting…' : 'Excel (.xlsx)'}
            </button>
            <button
              className="btn"
              disabled={!authorityId || busyKey === 'authority-pdf'}
              onClick={() => {
                const a = authorities.find((x) => String(x.id) === String(authorityId));
                go('authority-pdf', `/exports/authority/${authorityId}.pdf`,
                  `authority-${a?.code || authorityId}.pdf`);
              }}
            >
              {busyKey === 'authority-pdf' ? 'Exporting…' : 'PDF (.pdf)'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ReportCard({ card, busy, onGo }) {
  return (
    <div className="report-card">
      <div className="report-card-title">{card.title}</div>
      <div className="report-card-desc">{card.desc}</div>
      <button
        className={'btn ' + (card.primary ? 'btn-primary' : '')}
        onClick={onGo}
        disabled={busy}
      >
        {busy ? 'Exporting…' : 'Download'}
      </button>
    </div>
  );
}
