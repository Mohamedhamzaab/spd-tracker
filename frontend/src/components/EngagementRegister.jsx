// ---------------------------------------------------------------------------
//  EngagementRegister — the register as a nested accordion rather than a flat
//  table, which is how the work actually reads:
//
//    Authority (GORD)            collapsed, showing what is outstanding
//      └ Action (4.2)            collapsed by default
//          └ its progress        the entries logged against that very issue
//
//  So an authority asks for something, progress gets registered against it,
//  and you read that progress underneath the issue itself.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Loading, Empty, ErrorBanner, Pill, fmtDate } from './ui.jsx';

const STATUS_TONE = {
  Pending: 'amber',
  'Open/Ongoing': 'navy',
  Closed: 'green',
  Cancelled: 'grey',
  Superseded: 'grey',
};

function SourceTag({ e }) {
  const label = e.source_type === 'external'
    ? e.source_ref_external
    : e.meeting_code || e.comm_code || e.qdrs_code;
  if (!label) return null;
  return (
    <span className={'src-tag' + (e.source_type === 'external' ? ' src-tag-ext' : '')}>
      {label}
    </span>
  );
}

/* ---- one action, expanding to reveal its own progress ------------------- */
function ActionRow({ action, isEditor, onOpen, onAddProgress }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  // Only fetch the timeline when it is actually opened.
  useEffect(() => {
    if (!open || detail) return;
    setLoading(true);
    api.engAction(action.id)
      .then(setDetail)
      .catch(() => setDetail({ timeline: [] }))
      .finally(() => setLoading(false));
  }, [open]);

  const entries = detail?.timeline || [];

  return (
    <div className="acc-item-wrap">
      <button
        className="acc-item"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="acc-caret" aria-hidden="true">▶</span>
        <span className="acc-code">{action.action_code}</span>
        <span className="acc-desc">
          {action.description}
          <span className="acc-meta">
            {action.orgs?.map((o) => <Pill key={o.id} tone="grey">{o.name}</Pill>)}
            {action.due_milestone && <Pill tone="grey">{action.due_milestone}</Pill>}
            {action.is_overdue && <Pill tone="red">Overdue</Pill>}
            {action.has_external_evidence && (
              <span className="ext-flag" title="Evidence sits outside the system">
                no system link
              </span>
            )}
          </span>
        </span>
        <span className="acc-right">
          {action.entry_count > 0 && (
            <span className="acc-count">{action.entry_count} logged</span>
          )}
          <Pill tone={STATUS_TONE[action.status] || 'grey'}>{action.status}</Pill>
        </span>
      </button>

      {open && (
        <div className="acc-panel">
          {loading ? (
            <div className="acc-panel-empty">Loading what has been logged…</div>
          ) : entries.length === 0 ? (
            <div className="acc-panel-empty">
              Nothing registered against this yet — which is why it reads as Pending.
            </div>
          ) : (
            <div className="acc-tl">
              {entries.map((e) => (
                <div key={e.id} className="acc-tl-entry">
                  <div className="acc-tl-head">
                    <Pill tone={e.kind === 'closure' ? 'green' : 'navy'}>
                      {e.kind === 'closure' ? 'Closed' : 'Progress'}
                    </Pill>
                    <span className="cell-sub">{fmtDate(e.entry_date)}</span>
                    <SourceTag e={e} />
                    {e.created_by_name && <span className="cell-sub">· {e.created_by_name}</span>}
                  </div>
                  <div className="acc-tl-note">{e.note}</div>
                </div>
              ))}
            </div>
          )}

          <div className="acc-actions">
            {isEditor && !action.resolution && action.status !== 'Closed' && (
              <button className="btn btn-sm btn-primary" onClick={() => onAddProgress(action.id)}>
                Register progress
              </button>
            )}
            <button className="btn btn-sm" onClick={() => onOpen(action.id)}>
              Open full record
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- one authority, holding its stakeholders and their actions ---------- */
function AuthorityGroup({ group, isEditor, onOpen, onAddProgress, forceOpen }) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;

  const pending = group.actions.filter((a) => a.status === 'Pending').length;
  const ongoing = group.actions.filter((a) => a.status === 'Open/Ongoing').length;
  const critical = group.actions.filter((a) => a.is_critical
    && ['Pending', 'Open/Ongoing'].includes(a.status)).length;

  // Show the sub-division heading only where the authority has more than one,
  // so a single-department authority does not get a pointless extra level.
  const bySub = useMemo(() => {
    const m = new Map();
    for (const a of group.actions) {
      if (!m.has(a.sub_reference)) m.set(a.sub_reference, { name: a.sub_division_name, items: [] });
      m.get(a.sub_reference).items.push(a);
    }
    return [...m.entries()];
  }, [group.actions]);

  return (
    <div className="acc-group">
      <button
        className="acc-auth"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="acc-caret" aria-hidden="true">▶</span>
        <span className="acc-auth-code">{group.code}</span>
        <span className="acc-auth-name">{group.name}</span>
        <span className="acc-counts">
          {pending > 0 && <span className="acc-count acc-count-pending">{pending} pending</span>}
          {ongoing > 0 && <span className="acc-count acc-count-ongoing">{ongoing} ongoing</span>}
          {critical > 0 && <span className="acc-count acc-count-critical">{critical} critical</span>}
          <span className="acc-count">{group.actions.length} total</span>
        </span>
      </button>

      {isOpen && (
        <div className="acc-body">
          {bySub.map(([ref, sub]) => (
            <div key={ref}>
              {bySub.length > 1 && (
                <div className="acc-sub-label">{sub.name} · {ref}</div>
              )}
              {sub.items.map((a) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  isEditor={isEditor}
                  onOpen={onOpen}
                  onAddProgress={onAddProgress}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EngagementRegister({ rows, isEditor, onOpen, onAddProgress, searching }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) {
      if (!m.has(r.authority_code)) {
        m.set(r.authority_code, { code: r.authority_code, name: r.authority_name, actions: [] });
      }
      m.get(r.authority_code).actions.push(r);
    }
    return [...m.values()];
  }, [rows]);

  if (!rows) return <Loading label="Loading the register" />;
  if (!rows.length) return <Empty title="Nothing matches these filters" />;

  return (
    <div>
      {groups.map((g) => (
        <AuthorityGroup
          key={g.code}
          group={g}
          isEditor={isEditor}
          onOpen={onOpen}
          onAddProgress={onAddProgress}
          /* A search has already narrowed things down — opening the matching
             groups saves a click on every one of them. */
          forceOpen={searching}
        />
      ))}
    </div>
  );
}
