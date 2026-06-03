// ---------------------------------------------------------------------------
//  DashboardView — presentational dashboard driven by a `model` prop. Native
//  Slate & Indigo CSS, no Tailwind / shadcn / third-party. Adapts the
//  reference look: clean text KPI cards (no icons, no trend deltas), a monthly
//  communication-volume area chart (sent = red, received = dark maroon), an
//  authorities-by-category donut, a team list, attention list, funnel and a
//  recent-communications table — all with seamless hover tooltips.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, fmtDate } from './ui.jsx';

const RED = '#dc2626';        // sent / outbound
const MAROON = '#7f1d1d';     // received / inbound
const CAT_PALETTE = ['#4f46e5', '#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6', '#64748b', '#ec4899', '#22c55e'];
const MODE_COLORS = { 'In Person': '#4f46e5', Online: '#0ea5e9', Hybrid: '#14b8a6' };

// Smooth a polyline into a flowy cubic-bezier path (Catmull-Rom → bezier).
function smoothPath(points, tension = 0.2) {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/* ---- KPI cards (no icon, no delta) -------------------------------------- */
function KpiCard({ label, value, foot }) {
  return (
    <div className="kcard">
      <div className="kcard-label">{label}</div>
      <div className="kcard-value">{value}</div>
      {foot && <div className="kcard-foot">{foot}</div>}
    </div>
  );
}

/* ---- monthly volume area chart with hover ------------------------------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthShort = (ym) => MONTHS[Number(String(ym).slice(5, 7)) - 1] || ym;

function VolumeChart({ data }) {
  const [hi, setHi] = useState(null);
  const W = 760, H = 250, padL = 34, padR = 14, padT = 14, padB = 30;
  const iW = W - padL - padR, iH = H - padT - padB;
  const maxV = Math.max(1, ...data.map((d) => Math.max(d.outbound, d.inbound)));
  const n = data.length;
  const x = (i) => padL + (n <= 1 ? iW / 2 : (i / (n - 1)) * iW);
  const y = (v) => padT + iH - (v / maxV) * iH;
  const pts = (k) => data.map((d, i) => [x(i), y(d[k])]);
  const line = (k) => smoothPath(pts(k));
  const area = (k) => `${smoothPath(pts(k))} L${x(n - 1).toFixed(1)},${padT + iH} L${x(0).toFixed(1)},${padT + iH} Z`;
  const ticks = [0, Math.round(maxV / 2), maxV];

  return (
    <div className="vchart">
      <svg viewBox={`0 0 ${W} ${H}`} className="vchart-svg" preserveAspectRatio="none"
        onMouseLeave={() => setHi(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 3} textAnchor="end" className="vchart-tick">{t}</text>
          </g>
        ))}
        <path d={area('inbound')} fill={MAROON} fillOpacity="0.14" />
        <path d={area('outbound')} fill={RED} fillOpacity="0.12" />
        <path d={line('inbound')} fill="none" stroke={MAROON} strokeWidth="2" />
        <path d={line('outbound')} fill="none" stroke={RED} strokeWidth="2" />
        {hi != null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={padT} y2={padT + iH} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hi)} cy={y(data[hi].inbound)} r="3.5" fill={MAROON} stroke="#fff" strokeWidth="1.5" />
            <circle cx={x(hi)} cy={y(data[hi].outbound)} r="3.5" fill={RED} stroke="#fff" strokeWidth="1.5" />
          </g>
        )}
        {data.map((d, i) => (
          <text key={d.month} x={x(i)} y={H - 10} textAnchor="middle" className="vchart-x">{monthShort(d.month)}</text>
        ))}
        {/* hover bands */}
        {data.map((d, i) => (
          <rect key={'b' + i} x={x(i) - iW / n / 2} y={padT} width={iW / n} height={iH}
            fill="transparent" onMouseEnter={() => setHi(i)} />
        ))}
      </svg>
      {hi != null && (
        <div className="chart-tip" style={{ left: (x(hi) / W) * 100 + '%' }}>
          <div className="chart-tip-title">{monthShort(data[hi].month)} {String(data[hi].month).slice(0, 4)}</div>
          <div className="chart-tip-row"><span className="dot" style={{ background: RED }} />Sent<b>{data[hi].outbound}</b></div>
          <div className="chart-tip-row"><span className="dot" style={{ background: MAROON }} />Received<b>{data[hi].inbound}</b></div>
        </div>
      )}
      <div className="chart-legend">
        <span><i className="dot" style={{ background: RED }} /> Sent</span>
        <span><i className="dot" style={{ background: MAROON }} /> Received</span>
      </div>
    </div>
  );
}

/* ---- donut with hover --------------------------------------------------- */
function polar(cx, cy, rad, ang) { return [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]; }
function donutArc(cx, cy, R, r, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, R, a0), [x1, y1] = polar(cx, cy, R, a1);
  const [x2, y2] = polar(cx, cy, r, a1), [x3, y3] = polar(cx, cy, r, a0);
  return `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`;
}
function Donut({ data }) {
  const [hi, setHi] = useState(null);
  const items = data.filter((d) => d.count > 0);
  const total = items.reduce((s, d) => s + d.count, 0) || 1;
  const cx = 92, cy = 92, R = 78, r = 50;
  let a = -Math.PI / 2;
  const segs = items.map((d, i) => {
    const a0 = a, a1 = a + (d.count / total) * 2 * Math.PI;
    a = a1;
    return { ...d, i, a0, a1, color: CAT_PALETTE[i % CAT_PALETTE.length], pctv: (d.count / total) * 100 };
  });
  const center = hi != null ? segs[hi] : null;
  return (
    <div className="donut-wrap">
      <div className="donut-svg-wrap" onMouseLeave={() => setHi(null)}>
        <svg viewBox="0 0 184 184" width="160" height="160">
          {segs.map((s) => (
            <path key={s.i} d={donutArc(cx, cy, R, r, s.a0, s.a1)} fill={s.color}
              opacity={hi == null || hi === s.i ? 1 : 0.35}
              onMouseEnter={() => setHi(s.i)} style={{ transition: 'opacity .12s' }} />
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" className="donut-center-num">
            {center ? center.count : total}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="donut-center-lbl">
            {center ? Math.round(center.pctv) + '%' : 'total'}
          </text>
        </svg>
      </div>
      <div className="donut-legend">
        {segs.map((s) => (
          <div className={'donut-leg' + (hi === s.i ? ' on' : '')} key={s.i}
            onMouseEnter={() => setHi(s.i)} onMouseLeave={() => setHi(null)}>
            <span className="dot" style={{ background: s.color }} />
            <span className="donut-leg-lbl">{s.label}</span>
            <span className="donut-leg-val">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- attention list ----------------------------------------------------- */
function AttnRow({ label, count, tone, to }) {
  const active = count > 0;
  const inner = (
    <>
      <span className={'attn-dot tone-' + (active ? tone : 'none')} />
      <span className="attn-label">{label}</span>
      <span className={'attn-count' + (active ? ' tone-' + tone : ' tone-zero')}>{count}</span>
    </>
  );
  return to
    ? <Link to={to} className="attn-row" title={`View ${label.toLowerCase()}`}>{inner}</Link>
    : <div className="attn-row attn-row-static">{inner}</div>;
}

/* ---- engagement funnel -------------------------------------------------- */
const LADDER_TONE = { Identified: 's', Contacted: 'n', 'Response Received': 'a', 'Outcome Secured': 'g' };
function Funnel({ rows }) {
  const peak = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="funnel">
      {rows.map((r) => (
        <div className="funnel-row" key={r.status} title={`${r.status}: ${r.count}`}>
          <div className="funnel-label">{r.status}</div>
          <div className="funnel-track">
            <div className={'funnel-fill bar-' + (LADDER_TONE[r.status] || 'n')}
              style={{ width: Math.max(3, (r.count / peak) * 100) + '%' }} />
          </div>
          <div className="funnel-value">{r.count}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- team list (avatar + role + open tasks) ----------------------------- */
function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
const AV_GRAD = [
  'linear-gradient(135deg,#4f46e5,#0ea5e9)',
  'linear-gradient(135deg,#7c3aed,#ec4899)',
  'linear-gradient(135deg,#0d9488,#22c55e)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#2563eb,#06b6d4)',
];
function TeamList({ rows }) {
  return (
    <div className="team-list">
      {rows.map((m, i) => (
        <div className="team-row" key={m.name} title={`${m.openTasks} open task${m.openTasks === 1 ? '' : 's'}`}>
          <span className="team-av" style={{ background: AV_GRAD[i % AV_GRAD.length] }}>{initials(m.name)}</span>
          <div className="team-body">
            <div className="team-name">{m.name}</div>
            <div className="team-sub">{m.org}</div>
          </div>
          <div className="team-count">
            <span className="team-count-num">{m.openTasks}</span>
            <span className="team-count-lbl">open</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- recent activity: stacked communications + meetings briefs ---------- */
function StatusPill({ status }) {
  const map = { Overdue: 'red', Awaiting: 'amber', Replied: 'green', Logged: 'grey' };
  return <Pill tone={map[status] || 'grey'}>{status}</Pill>;
}
const MOM_VIEW = {
  pending: { label: 'MoM pending', tone: 'red' },
  draft: { label: 'MoM draft', tone: 'amber' },
  final: { label: 'MoM final', tone: 'green' },
};
function BriefRow({ to, code, title, meta, pills }) {
  return (
    <Link to={to} className="brief-row" title="Open to review">
      <span className="brief-code mono">{code}</span>
      <div className="brief-main">
        <div className="brief-title">{title}</div>
        <div className="brief-meta">{meta}</div>
      </div>
      <div className="brief-pills">{pills}</div>
    </Link>
  );
}
function RecentActivity({ comms, meetings }) {
  return (
    <div className="recent-activity">
      <div className="recent-group">
        <div className="recent-group-head">Communications</div>
        {comms.length === 0
          ? <div className="recent-empty">No communications yet.</div>
          : comms.map((c) => (
            <BriefRow
              key={c.id || c.code}
              to={`/app/communications?open=${c.id}`}
              code={c.code}
              title={c.subdivision}
              meta={`${c.authorityCode} · ${fmtDate(c.date)}`}
              pills={<>
                <Pill tone={c.direction === 'Inbound' ? 'navy' : 'grey'}>{c.direction}</Pill>
                <StatusPill status={c.status} />
              </>}
            />
          ))}
      </div>
      <div className="recent-group">
        <div className="recent-group-head">Meetings</div>
        {meetings.length === 0
          ? <div className="recent-empty">No meetings yet.</div>
          : meetings.map((mt) => {
            const mom = MOM_VIEW[mt.momStatus] || MOM_VIEW.pending;
            return (
              <BriefRow
                key={mt.id || mt.code}
                to={`/app/meetings?open=${mt.id}`}
                code={mt.code}
                title={mt.subdivision}
                meta={`${mt.authorityCode} · ${fmtDate(mt.date)}`}
                pills={<>
                  {mt.mode ? <Pill tone="grey">{mt.mode}</Pill> : null}
                  <Pill tone={mom.tone}>{mom.label}</Pill>
                </>}
              />
            );
          })}
      </div>
    </div>
  );
}

/* ---- meetings by mode (monthly stacked bars) ---------------------------- */
function StackedBars({ data }) {
  const [hi, setHi] = useState(null);
  const modes = [
    { key: 'inPerson', label: 'In Person', color: MODE_COLORS['In Person'] },
    { key: 'online', label: 'Online', color: MODE_COLORS.Online },
    { key: 'hybrid', label: 'Hybrid', color: MODE_COLORS.Hybrid },
  ];
  const tot = (d) => d.inPerson + d.online + d.hybrid;
  const peak = Math.max(1, ...data.map(tot));
  return (
    <div className="sbar">
      <div className="sbar-plot" onMouseLeave={() => setHi(null)}>
        {data.map((d, i) => (
          <div className="sbar-col" key={d.month} onMouseEnter={() => setHi(i)}>
            <div className="sbar-stack">
              {tot(d) === 0
                ? <div className="sbar-seg sbar-empty" />
                : modes.map((mo) => d[mo.key] > 0 && (
                  <div key={mo.key} className="sbar-seg"
                    style={{ height: (d[mo.key] / peak) * 100 + '%', background: mo.color }} />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="sbar-axis">{data.map((d) => <div className="mchart-x" key={d.month}>{monthShort(d.month)}</div>)}</div>
      <div className="chart-legend">
        {modes.map((mo) => <span key={mo.key}><i className="dot" style={{ background: mo.color }} /> {mo.label}</span>)}
      </div>
      {hi != null && (
        <div className="chart-tip" style={{ left: ((hi + 0.5) / data.length) * 100 + '%' }}>
          <div className="chart-tip-title">{monthShort(data[hi].month)}</div>
          {modes.map((mo) => (
            <div className="chart-tip-row" key={mo.key}><span className="dot" style={{ background: mo.color }} />{mo.label}<b>{data[hi][mo.key]}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- meeting frequency (flowy monthly line) ----------------------------- */
function FreqLine({ data }) {
  const [hi, setHi] = useState(null);
  const W = 380, H = 210, padL = 26, padR = 12, padT = 16, padB = 26;
  const iW = W - padL - padR, iH = H - padT - padB;
  const maxV = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const x = (i) => padL + (n <= 1 ? iW / 2 : (i / (n - 1)) * iW);
  const y = (v) => padT + iH - (v / maxV) * iH;
  const pts = data.map((d, i) => [x(i), y(d.count)]);
  const line = smoothPath(pts);
  const COL = '#4f46e5';
  return (
    <div className="vchart">
      <svg viewBox={`0 0 ${W} ${H}`} className="vchart-svg" style={{ height: 210 }} preserveAspectRatio="none" onMouseLeave={() => setHi(null)}>
        <path d={`${line} L${x(n - 1).toFixed(1)},${padT + iH} L${x(0).toFixed(1)},${padT + iH} Z`} fill={COL} fillOpacity="0.10" />
        <path d={line} fill="none" stroke={COL} strokeWidth="2" />
        {hi != null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={padT} y2={padT + iH} stroke="var(--line-strong)" strokeDasharray="3 3" />
            <circle cx={x(hi)} cy={y(data[hi].count)} r="3.5" fill={COL} stroke="#fff" strokeWidth="1.5" />
          </g>
        )}
        {data.map((d, i) => <text key={d.month} x={x(i)} y={H - 8} textAnchor="middle" className="vchart-x">{monthShort(d.month)}</text>)}
        {data.map((d, i) => <rect key={'b' + i} x={x(i) - iW / n / 2} y={padT} width={iW / n} height={iH} fill="transparent" onMouseEnter={() => setHi(i)} />)}
      </svg>
      {hi != null && (
        <div className="chart-tip" style={{ left: (x(hi) / W) * 100 + '%' }}>
          <div className="chart-tip-title">{monthShort(data[hi].month)}</div>
          <div className="chart-tip-row"><span className="dot" style={{ background: COL }} />Meetings<b>{data[hi].count}</b></div>
        </div>
      )}
    </div>
  );
}

/* ---- period view (date-window snapshot) --------------------------------- */
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function PeriodView({ period, onRange }) {
  const [from, setFrom] = useState(period.from || isoDaysAgo(7));
  const [to, setTo] = useState(period.to || isoDaysAgo(0));
  const setF = (v) => { setFrom(v); onRange && onRange(v, to); };
  const setT = (v) => { setTo(v); onRange && onRange(from, v); };
  const tiles = [
    { label: 'Communications', value: period.communications },
    { label: 'Outbound', value: period.outbound },
    { label: 'Inbound', value: period.inbound },
    { label: 'Meetings', value: period.meetings },
    { label: 'Sub-Divisions Identified', value: period.subIdentified },
  ];
  return (
    <div className="card card-pad">
      <div className="dash-card-head">
        <div className="section-title">Period View</div>
        <div className="section-note">Activity within a date window</div>
        <div className="period-controls">
          <input type="date" className="filter-select" value={from} onChange={(e) => setF(e.target.value)} />
          <span className="period-arrow">→</span>
          <input type="date" className="filter-select" value={to} onChange={(e) => setT(e.target.value)} />
        </div>
      </div>
      <div className="kpi-row">
        {tiles.map((t) => (
          <div className="kcard" key={t.label}>
            <div className="kcard-label">{t.label}</div>
            <div className="kcard-value">{t.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, sub, children, grow }) {
  return (
    <div className={'card card-pad ' + (grow ? 'dash-grow' : 'dash-side')}>
      <div className="dash-card-head">
        <div className="section-title">{title}</div>
        {sub && <div className="section-note">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export default function DashboardView({ model: m }) {
  return (
    <div className="dash2 stack-lg">
      <div className="kpi-row">
        {m.kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      <div className="dash-split">
        <Panel title="Communication Volume" sub="Sent vs received · last 12 months" grow>
          <VolumeChart data={m.volume} />
        </Panel>
        <Panel title="Authorities by Category" sub="Share of engaged bodies">
          <Donut data={m.byCategory} />
        </Panel>
      </div>

      <div className="dash-split">
        <Panel title="Meetings by Mode" sub="In person · online · hybrid" grow>
          <StackedBars data={m.meetingsMonthly} />
        </Panel>
        <Panel title="Meeting Frequency" sub="Per month">
          <FreqLine data={m.meetingsMonthly.map((d) => ({ month: d.month, count: d.inPerson + d.online + d.hybrid }))} />
        </Panel>
      </div>

      <div className="dash-split">
        <Panel title="Engagement Funnel" sub="Sub-divisions by status" grow>
          <Funnel rows={m.ladder} />
        </Panel>
        <Panel title="Attention Required" sub="Open items">
          <div className="attn-list">{m.attention.map((a) => <AttnRow key={a.label} {...a} />)}</div>
        </Panel>
      </div>

      <div className="dash-split">
        <Panel title="Recent Activity" sub="Latest comms & meetings" grow>
          <RecentActivity comms={m.recent} meetings={m.recentMeetings} />
        </Panel>
        <Panel title="Team & Assignments" sub="Open tasks per member">
          <TeamList rows={m.team} />
        </Panel>
      </div>

      {m.period && <PeriodView period={m.period} onRange={m.onRange} />}
    </div>
  );
}
