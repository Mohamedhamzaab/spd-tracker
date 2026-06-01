// ---------------------------------------------------------------------------
//  Dashboard — live engagement overview. Fetches /api/dashboard (+ the period
//  window) and feeds the shared <DashboardView>. Re-fetches on data events so
//  every panel reflects the real database in near real time.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Loading, ErrorBanner, pct } from '../components/ui.jsx';
import DashboardView from '../components/DashboardView.jsx';
import { useLive } from '../lib/liveStream.js';

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const DASH_LIVE_EVENTS = [
  'data.authority.created', 'data.authority.updated', 'data.authority.deleted',
  'data.authority.restored', 'data.authority.purged',
  'data.subdivision.created', 'data.subdivision.updated', 'data.subdivision.deleted',
  'data.subdivision.restored', 'data.subdivision.purged',
  'data.communication.created', 'data.communication.updated', 'data.communication.deleted',
  'data.communication.restored', 'data.communication.purged',
  'data.meeting.created', 'data.meeting.updated', 'data.meeting.deleted',
  'data.meeting.restored', 'data.meeting.purged',
  'data.task.created', 'data.task.updated', 'data.task.completed', 'data.task.deleted',
];

const ATTENTION_DEFS = [
  { key: 'overdue_communications', label: 'Overdue communications', tone: 'red' },
  { key: 'awaiting_reply', label: 'Awaiting a reply', tone: 'amber' },
  { key: 'mom_pending', label: 'MoM pending', tone: 'red' },
  { key: 'mom_draft', label: 'MoM in draft', tone: 'amber' },
  { key: 'overdue_tasks', label: 'Overdue tasks', tone: 'red' },
  { key: 'open_tasks', label: 'Open tasks', tone: 'indigo' },
  { key: 'not_contacted', label: 'Not yet contacted', tone: 'slate' },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [period, setPeriod] = useState(null);

  const loadData = useCallback(() => {
    api.dashboard().then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { loadData(); }, [loadData]);
  useLive(DASH_LIVE_EVENTS, loadData);

  const loadPeriod = useCallback(() => {
    api.period(from, to).then(setPeriod).catch(() => setPeriod(null));
  }, [from, to]);
  useEffect(() => { loadPeriod(); }, [loadPeriod]);
  useLive(DASH_LIVE_EVENTS, loadPeriod);

  const model = useMemo(() => {
    if (!data) return null;
    const t = data.totals || {};
    const att = data.attention || {};
    const cats = (data.byCategory || []).filter((c) => c.count > 0).length;
    return {
      kpis: [
        { label: 'Total Authorities', value: String(t.total_authorities ?? 0),
          foot: `across ${cats} categor${cats === 1 ? 'y' : 'ies'}` },
        { label: 'Total Sub-Divisions', value: String(t.total_sub_divisions ?? 0),
          foot: `${t.sub_divisions_engaged ?? 0} engaged · ${pct(t.percent_engaged || 0)}` },
        { label: 'Communications Logged', value: String(t.communications_logged ?? 0),
          foot: `${t.outbound ?? 0} sent · ${t.inbound ?? 0} received` },
        { label: 'Meetings Logged', value: String(t.meetings_logged ?? 0),
          foot: `${(data.mom && data.mom.final) || 0} with final MoM` },
      ],
      volume: (data.monthly || []).map((m) => ({ month: m.month, outbound: m.outbound, inbound: m.inbound })),
      byCategory: (data.byCategory || []).map((c) => ({ label: c.category, count: c.count })),
      attention: ATTENTION_DEFS.map((d) => ({ label: d.label, tone: d.tone, count: att[d.key] || 0 })),
      ladder: (data.ladder || []).map((l) => ({ status: l.status, count: l.count })),
      team: data.team || [],
      recent: data.recent || [],
      meetingsMonthly: data.meetingsMonthly || [],
      period: {
        from, to,
        communications: period ? period.communications : 0,
        outbound: period ? period.outbound : 0,
        inbound: period ? period.inbound : 0,
        meetings: period ? period.meetings : 0,
        subIdentified: period ? period.sub_divisions_identified : 0,
      },
      onRange: (f, tt) => { setFrom(f); setTo(tt); },
    };
  }, [data, period, from, to]);

  if (error) {
    return (
      <>
        <div className="topbar"><div className="page-title">Dashboard</div></div>
        <div className="page"><ErrorBanner message={error} /></div>
      </>
    );
  }
  if (!model) return <Loading label="Loading dashboard" />;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Safari Park Project · Authority Engagement</div>
          <div className="page-title">Engagement Dashboard</div>
        </div>
        <div className="dash-date">{today}</div>
      </div>
      <div className="page">
        <DashboardView model={model} />
      </div>
    </>
  );
}
