// ---------------------------------------------------------------------------
//  Dashboard. Live read-only overview: KPIs, engagement ladder, authorities
//  by category, meetings summary, and a date-window period view.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import {
  Loading, ErrorBanner, Section, Kpi, BarChart, pct,
} from '../components/ui.jsx';
import { useLive } from '../lib/liveStream.js';

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Any of these upstream changes can move a dashboard figure, so we refetch
// when one fires — the board stays live without a manual reload.
const DASH_LIVE_EVENTS = [
  'data.authority.created', 'data.authority.updated', 'data.authority.deleted',
  'data.authority.restored', 'data.authority.purged',
  'data.subdivision.created', 'data.subdivision.updated', 'data.subdivision.deleted',
  'data.subdivision.restored', 'data.subdivision.purged',
  'data.communication.created', 'data.communication.updated', 'data.communication.deleted',
  'data.communication.restored', 'data.communication.purged',
  'data.meeting.created', 'data.meeting.updated', 'data.meeting.deleted',
  'data.meeting.restored', 'data.meeting.purged',
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [period, setPeriod] = useState(null);

  const loadTotals = useCallback(() => {
    api.dashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { loadTotals(); }, [loadTotals]);

  // Refetch the headline figures + charts whenever underlying data changes.
  useLive(DASH_LIVE_EVENTS, loadTotals);

  const loadPeriod = useCallback(() => {
    api.period(from, to).then(setPeriod).catch(() => setPeriod(null));
  }, [from, to]);

  useEffect(() => { loadPeriod(); }, [loadPeriod]);

  // The period view counts the same records, so keep it live too.
  useLive(DASH_LIVE_EVENTS, loadPeriod);

  if (error) {
    return (
      <>
        <div className="topbar">
          <div className="page-title">Dashboard</div>
        </div>
        <div className="page">
          <ErrorBanner message={error} />
        </div>
      </>
    );
  }
  if (!data) return <Loading label="Loading dashboard" />;

  const t = data.totals;
  const ladderColor = (r) => {
    const map = {
      Identified: 's',
      Contacted: 'n',
      'Response Received': 'a',
      'Outcome Secured': 'g',
    };
    return map[r.label] || '';
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Safari Park Project</div>
          <div className="page-title">Dashboard</div>
        </div>
      </div>
      <div className="page stack-lg">
        {/* KPIs */}
        <Section title="Engagement Overview">
          <div className="kpi-grid">
            <Kpi label="Total Authorities" value={t.total_authorities} />
            <Kpi label="Total Sub-Divisions" value={t.total_sub_divisions} />
            <Kpi label="Sub-Divisions Engaged" value={t.sub_divisions_engaged} />
            <Kpi label="Percent Engaged" value={pct(t.percent_engaged)} />
            <Kpi label="Outcome Secured" value={t.outcome_secured} tone="g" />
          </div>
          <div className="kpi-grid" style={{ marginTop: 14 }}>
            <Kpi label="Percent Outcome Secured" value={pct(t.percent_outcome_secured)} />
            <Kpi label="Communications Logged" value={t.communications_logged} />
            <Kpi
              label="Awaiting Reply"
              value={t.awaiting_reply}
              tone={t.awaiting_reply ? 'warn' : undefined}
            />
            <Kpi
              label="Overdue Communications"
              value={t.overdue_communications}
              tone={t.overdue_communications ? 'alert' : undefined}
            />
            <Kpi label="Meetings Logged" value={t.meetings_logged} />
          </div>
        </Section>

        {/* Ladder + category */}
        <div className="row">
          <div className="card card-pad" style={{ flex: 1, minWidth: 320 }}>
            <Section title="Engagement Ladder" note="Sub-divisions by status">
              <BarChart
                rows={data.ladder.map((l) => ({ label: l.status, value: l.count }))}
                colorFor={ladderColor}
              />
            </Section>
          </div>
          <div className="card card-pad" style={{ flex: 1, minWidth: 320 }}>
            <Section title="Authorities by Category">
              <BarChart
                rows={data.byCategory.map((c) => ({ label: c.category, value: c.count }))}
                colorFor={() => 'n'}
              />
            </Section>
          </div>
        </div>

        {/* Meetings */}
        <div className="row">
          <div className="card card-pad" style={{ flex: 1, minWidth: 320 }}>
            <Section title="Meetings by Purpose">
              <BarChart
                rows={data.meetingsByPurpose.map((m) => ({
                  label: m.purpose,
                  value: m.count,
                }))}
                colorFor={() => ''}
              />
            </Section>
          </div>
          <div className="card card-pad" style={{ flex: 1, minWidth: 320 }}>
            <Section title="Meetings by Mode">
              <BarChart
                rows={data.meetingsByMode.map((m) => ({ label: m.mode, value: m.count }))}
                colorFor={() => ''}
              />
            </Section>
          </div>
        </div>

        {/* Period view */}
        <div className="card card-pad">
          <Section
            title="Period View"
            note="Activity within a date window"
            action={
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="filter-select"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <input
                  className="filter-select"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            }
          >
            {period ? (
              <div className="kpi-grid">
                <Kpi label="Communications" value={period.communications} />
                <Kpi label="Outbound" value={period.outbound} />
                <Kpi label="Inbound" value={period.inbound} />
                <Kpi label="Meetings" value={period.meetings} />
                <Kpi
                  label="Sub-Divisions Identified"
                  value={period.sub_divisions_identified}
                />
              </div>
            ) : (
              <div className="section-note">Adjust the dates to view a window.</div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
