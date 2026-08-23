// ---------------------------------------------------------------------------
//  Stakeholder Engagement — criticality, alignment and what is outstanding.
//
//  Three sub-tabs over one dataset:
//    Stakeholder Matrix    influence x involvement, and who is critical
//    Engagement Assessment where each stakeholder sits against where we need
//                          them, and the gap between
//    Critical Items        the action register, opening on what needs attention
//
//  Status is never chosen here. It follows the timeline: an action is Pending
//  until someone registers what they did, so the register cannot be talked up.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { Loading, ErrorBanner, Empty, Pill, useToast, fmtDate } from '../components/ui.jsx';
import ActionDetail from '../components/ActionDetail.jsx';
import ActionForm from '../components/ActionForm.jsx';
import EngagementGuide from '../components/EngagementGuide.jsx';
import EngagementRemoved from '../components/EngagementRemoved.jsx';

// Critical Items leads: it is what the section is for, so it is what you land
// on. The two reference views sit behind it.
const TABS = [
  { key: 'items', label: 'Critical Items' },
  { key: 'matrix', label: 'Stakeholder Matrix' },
  { key: 'assessment', label: 'Engagement Assessment' },
  { key: 'removed', label: 'Removed' },
];

const LADDER = ['Unaware', 'Resistant', 'Neutral', 'Supportive', 'Leading'];

const STATUS_TONE = {
  Pending: 'amber',
  'Open/Ongoing': 'navy',
  Closed: 'green',
  Cancelled: 'grey',
  Superseded: 'grey',
};
const PRIORITY_TONE = {
  'Manage Closely': 'red',
  'Keep Satisfied': 'amber',
  'Keep Informed': 'navy',
  Monitor: 'grey',
};

export function StatusPill({ status }) {
  return <Pill tone={STATUS_TONE[status] || 'grey'}>{status}</Pill>;
}

export default function Engagement() {
  const { isEditor } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).get('tab') || 'items');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  function loadSummary() {
    api.engSummary().then(setSummary).catch((e) => setError(e.message));
  }
  useEffect(loadSummary, []);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Stakeholder Engagement</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            title="The matrix, assessment and register in the original workbook layout"
            onClick={() => api.downloadExport(
              '/exports/stakeholder-engagement.xlsx', 'stakeholder-engagement-matrix.xlsx')}
          >
            Export Excel
          </button>
          <button
            className="btn"
            onClick={() => api.downloadExport(
              '/exports/stakeholder-engagement.pdf', 'stakeholder-engagement-matrix.pdf')}
          >
            Export PDF
          </button>
        </div>
      </div>

      <div className="page stack-lg">
        <ErrorBanner message={error} />
        <SummaryStrip summary={summary} onJump={setTab} />

        <div className="subtabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={'subtab' + (tab === t.key ? ' subtab-on' : '')}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'matrix' && (
          <MatrixTab isEditor={isEditor} toast={toast} onChanged={loadSummary} mode="power" />
        )}
        {tab === 'assessment' && (
          <MatrixTab isEditor={isEditor} toast={toast} onChanged={loadSummary} mode="ladder" />
        )}
        {tab === 'items' && (
          <ItemsTab isEditor={isEditor} toast={toast} onChanged={loadSummary} />
        )}
        {tab === 'removed' && (
          <EngagementRemoved isEditor={isEditor} onChanged={loadSummary} />
        )}
      </div>
    </>
  );
}

/* ---- summary strip ------------------------------------------------------ */
function SummaryStrip({ summary, onJump }) {
  if (!summary) return <div className="eng-strip eng-strip-loading" />;
  const a = summary.actions;
  const m = summary.matrix;
  const cells = [
    { label: 'Pending', value: a.pending, tone: 'amber', hint: 'Nothing registered against these yet' },
    { label: 'Ongoing', value: a.ongoing, tone: 'navy', hint: 'Progress registered' },
    { label: 'Closed', value: a.closed, tone: 'green', hint: 'Closed with evidence' },
    { label: 'Critical open', value: a.critical_open, tone: 'red', hint: 'Open items on critical stakeholders' },
    { label: 'Overdue', value: a.overdue, tone: a.overdue > 0 ? 'red' : 'grey', hint: 'Past their date and still open' },
    { label: 'No system link', value: a.unreferenced, tone: 'amber', hint: 'Open items whose evidence sits outside the system' },
    { label: 'Stakeholders w/ gap', value: m.with_gap, tone: 'amber', hint: 'Not yet where we need them' },
  ];
  return (
    <div className="eng-strip">
      {cells.map((c) => (
        <button
          key={c.label}
          className="eng-cell"
          title={c.hint}
          onClick={() => onJump(c.label.startsWith('Stakeholders') ? 'assessment' : 'items')}
        >
          <div className={'eng-cell-value tone-' + c.tone}>{c.value}</div>
          <div className="eng-cell-label">{c.label}</div>
        </button>
      ))}
    </div>
  );
}

/* ---- matrix + assessment ------------------------------------------------ */
// Both tabs are the same rows seen through different columns, so they share a
// component: "power" shows influence/involvement, "ladder" shows the gap.
function MatrixTab({ isEditor, toast, onChanged, mode }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);

  function load() {
    api.engMatrix().then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function setField(row, field, value) {
    setSaving(row.sub_division_id + field);
    setError('');
    try {
      await api.engSetRating(row.sub_division_id, { [field]: value || null });
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return <Loading label="Loading stakeholders" />;

  const grouped = [];
  let lastAuthority = null;
  for (const r of data.rows) {
    if (r.authority_name !== lastAuthority) {
      grouped.push({ header: r.authority_name, code: r.authority_code });
      lastAuthority = r.authority_name;
    }
    grouped.push({ row: r });
  }

  return (
    <div className="stack-lg">
      <ErrorBanner message={error} />

      {mode === 'power' && (
        <div className="quadrant-grid">
          {['Manage Closely', 'Keep Satisfied', 'Keep Informed', 'Monitor'].map((k) => (
            <div key={k} className="quadrant-card">
              <div className="quadrant-n">{data.quadrant[k] || 0}</div>
              <div className="quadrant-k">{k}</div>
              <div className="quadrant-d">
                {k === 'Manage Closely' && 'High influence + high involvement — critical'}
                {k === 'Keep Satisfied' && 'High influence, lower involvement'}
                {k === 'Keep Informed' && 'Lower influence, high involvement'}
                {k === 'Monitor' && 'Lower influence and involvement'}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            {mode === 'power' ? (
              <tr>
                <th>Stakeholder</th><th>Influence</th><th>Involvement</th>
                <th>Priority</th><th>Critical</th>
              </tr>
            ) : (
              <tr>
                <th>Stakeholder</th><th>Current</th><th>Desired</th>
                <th>Gap</th><th>Owner</th><th>Remarks</th>
              </tr>
            )}
          </thead>
          <tbody>
            {grouped.map((g, i) =>
              g.header ? (
                <tr key={'h' + i} className="group-row">
                  <td colSpan={mode === 'power' ? 5 : 6}>
                    <span className="mono">{g.code}</span> &nbsp;{g.header}
                  </td>
                </tr>
              ) : mode === 'power' ? (
                <tr key={g.row.sub_division_id}>
                  <td>
                    <div className="cell-strong">{g.row.sub_division_name}</div>
                    <div className="cell-sub mono">{g.row.sub_reference}</div>
                  </td>
                  <td><HL row={g.row} field="influence" isEditor={isEditor} saving={saving} onSet={setField} /></td>
                  <td><HL row={g.row} field="involvement" isEditor={isEditor} saving={saving} onSet={setField} /></td>
                  <td>
                    {g.row.action_priority
                      ? <Pill tone={PRIORITY_TONE[g.row.action_priority]}>{g.row.action_priority}</Pill>
                      : <span className="cell-sub">Not rated</span>}
                  </td>
                  <td>{g.row.is_critical ? <Pill tone="red">CRITICAL</Pill> : <span className="cell-sub">—</span>}</td>
                </tr>
              ) : (
                <tr key={g.row.sub_division_id}>
                  <td>
                    <div className="cell-strong">{g.row.sub_division_name}</div>
                    <div className="cell-sub mono">{g.row.sub_reference}</div>
                  </td>
                  <td><Ladder row={g.row} field="engagement_current" isEditor={isEditor} saving={saving} onSet={setField} /></td>
                  <td><Ladder row={g.row} field="engagement_desired" isEditor={isEditor} saving={saving} onSet={setField} /></td>
                  <td>
                    {g.row.gap_status
                      ? <Pill tone={g.row.gap_status.startsWith('✓') ? 'green' : 'amber'}>{g.row.gap_status}</Pill>
                      : <span className="cell-sub">—</span>}
                  </td>
                  <td>{g.row.gap_action_by || <span className="cell-sub">—</span>}</td>
                  <td className="cell-wrap">{g.row.gap_remarks || <span className="cell-sub">—</span>}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HL({ row, field, isEditor, saving, onSet }) {
  const val = row[field] || '';
  if (!isEditor) return val ? <Pill tone={val === 'H' ? 'red' : 'grey'}>{val}</Pill> : <span className="cell-sub">—</span>;
  return (
    <select
      className="select select-inline"
      value={val}
      disabled={saving === row.sub_division_id + field}
      onChange={(e) => onSet(row, field, e.target.value)}
    >
      <option value="">—</option>
      <option value="H">H</option>
      <option value="L">L</option>
    </select>
  );
}

function Ladder({ row, field, isEditor, saving, onSet }) {
  const val = row[field] || '';
  if (!isEditor) return val ? <span>{val}</span> : <span className="cell-sub">—</span>;
  return (
    <select
      className="select select-inline"
      value={val}
      disabled={saving === row.sub_division_id + field}
      onChange={(e) => onSet(row, field, e.target.value)}
    >
      <option value="">—</option>
      {LADDER.map((l) => <option key={l} value={l}>{l}</option>)}
    </select>
  );
}

/* ---- the action register ------------------------------------------------ */
function ItemsTab({ isEditor, toast, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [progressFor, setProgressFor] = useState(null);
  // the guide shows engagement position per stakeholder, so it needs the matrix
  const [matrixRows, setMatrixRows] = useState([]);
  useEffect(() => { api.engMatrix().then((d) => setMatrixRows(d.rows)).catch(() => {}); }, []);
  // Opens on what needs attention; every other item is one filter away.
  const [filters, setFilters] = useState({
    status: 'Pending,Open/Ongoing', critical: false, overdue: false,
    unreferenced: false, q: '',
  });

  const params = useMemo(() => {
    const p = {};
    if (filters.status) p.status = filters.status;
    if (filters.critical) p.critical = 'true';
    if (filters.overdue) p.overdue = 'true';
    if (filters.unreferenced) p.unreferenced = 'true';
    if (filters.q.trim()) p.q = filters.q.trim();
    return p;
  }, [filters]);

  function load() {
    api.engActions(params).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(() => { setError(''); load(); }, [params]);

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="stack-lg">
      <ErrorBanner message={error} />

      <div className="filter-bar">
        <input
          className="search"
          placeholder="Search the register"
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
        />
        <select className="filter-select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="Pending,Open/Ongoing">Open items</option>
          <option value="Pending">Pending only</option>
          <option value="Open/Ongoing">Ongoing only</option>
          <option value="Closed">Closed</option>
          <option value="Cancelled,Superseded">Cancelled / superseded</option>
          <option value="">Everything</option>
        </select>
        {[
          ['critical', 'Critical only'],
          ['overdue', 'Overdue'],
          ['unreferenced', 'No system link'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={'chip ' + (filters[k] ? 'chip-on' : '')}
            onClick={() => set(k, !filters[k])}
          >
            {label}
          </button>
        ))}
        <span className="section-note" style={{ marginLeft: 'auto' }}>
          {rows ? rows.length : '…'} {rows && rows.length === 1 ? 'item' : 'items'}
        </span>
        {isEditor && (
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            + Raise action
          </button>
        )}
      </div>

      <EngagementGuide
        rows={rows}
        matrix={matrixRows}
        isEditor={isEditor}
        onOpen={setOpenId}
        onAddProgress={setProgressFor}
        onChanged={() => { load(); onChanged(); }}
      />

      {progressFor && (
        <ActionDetail
          id={progressFor}
          openProgress
          isEditor={isEditor}
          onClose={() => setProgressFor(null)}
          onChanged={() => { load(); onChanged(); }}
        />
      )}
      {openId && (
        <ActionDetail
          id={openId}
          isEditor={isEditor}
          onClose={() => setOpenId(null)}
          onChanged={() => { load(); onChanged(); }}
        />
      )}
      {adding && (
        <ActionForm
          onClose={() => setAdding(false)}
          onSaved={(code) => {
            setAdding(false);
            toast('Action raised: ' + code);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
