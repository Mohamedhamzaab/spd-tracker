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
      desc: 'One workbook with a summary cover sheet plus Authorities, Sub-Divisions, Communications, and Meetings tabs. The headline deliverable.',
      path: '/exports/engagement-register.xlsx',
      filename: 'engagement-register.xlsx',
      primary: true,
    },
    {
      key: 'register-pdf',
      title: 'Engagement Register — PDF',
      desc: 'Multi-page landscape PDF with KPI tiles and the same four sections. Easier to email or print.',
      path: '/exports/engagement-register.pdf',
      filename: 'engagement-register.pdf',
      primary: true,
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
      desc: 'Full communication log with computed status (Overdue / Awaiting / Replied / Logged).',
      path: '/exports/communications.xlsx',
      filename: 'communications.xlsx',
    },
    {
      key: 'meetings-xlsx',
      title: 'Meetings only — Excel',
      desc: 'Meeting register with primary sub-division and MoM links.',
      path: '/exports/meetings.xlsx',
      filename: 'meetings.xlsx',
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

        <Section title="Engagement register" />
        <div className="report-grid">
          {cards.filter((c) => c.primary).map((c) => (
            <ReportCard
              key={c.key}
              card={c}
              busy={busyKey === c.key}
              onGo={() => go(c.key, c.path, c.filename)}
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
              onGo={() => go(c.key, c.path, c.filename)}
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
