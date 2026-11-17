// ---------------------------------------------------------------------------
//  Work board — the stakeholder manager's view of the actions.
//
//  Three columns: Pending, Ongoing, Closed. Status is never typed: dragging a
//  card on opens the same form as "Register progress" or "Close action", and
//  the card only moves once something is logged (closing needs a letter,
//  meeting or reference behind it). Filters narrow the board; cards glide to
//  their new places rather than jumping.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { fmtDate } from '../ui.jsx';
import EngagementRemoved from '../EngagementRemoved.jsx';
import { cut, shortName } from './model.js';
import { WorkBar, Owners } from './bits.jsx';

const COLS = [
  { status: 'Pending', title: 'Pending', hint: 'Nothing logged yet', tone: 'p', step: 12 },
  { status: 'Open/Ongoing', title: 'Ongoing', hint: 'Progress logged', tone: 'o', step: 12 },
  { status: 'Closed', title: 'Closed', hint: 'Backed by a letter, meeting or reference', tone: 'c', step: 8 },
];

export default function WorkBoard({ model, isEditor, onOpenAction, onMove, onChanged }) {
  const reduce = useReducedMotion();
  const [auth, setAuth] = useState(null);
  const [org, setOrg] = useState(null);
  const [flag, setFlag] = useState(null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(() => Object.fromEntries(COLS.map((c) => [c.status, c.step])));
  const [over, setOver] = useState(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const authorities = useMemo(() => {
    const m = new Map();
    for (const a of model.live) {
      if (!m.has(a.authority_name)) m.set(a.authority_name, { name: a.authority_name, count: { p: 0, o: 0, c: 0 } });
      m.get(a.authority_name).count[a.status === 'Closed' ? 'c' : a.status === 'Pending' ? 'p' : 'o'] += 1;
    }
    return [...m.values()].sort((x, y) => (y.count.p + y.count.o) - (x.count.p + x.count.o) || x.name.localeCompare(y.name));
  }, [model.live]);
  const orgs = useMemo(() => {
    const m = new Map();
    for (const a of model.live) for (const o of a.orgs || []) m.set(o.id, o.name);
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [model.live]);

  const query = q.trim().toLowerCase();
  const shown = model.live.filter((a) =>
    (!auth || a.authority_name === auth)
    && (!org || (a.orgs || []).some((o) => o.id === org))
    && (!flag || (flag === 'overdue' ? a.is_overdue : flag === 'external' ? a.has_external_evidence : !(a.orgs || []).length))
    && (!query || `${a.action_code} ${a.description} ${a.sub_division_name} ${a.authority_name}`.toLowerCase().includes(query)));

  function drop(e, status) {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const a = model.live.find((x) => x.id === id);
    if (a && a.status !== status) onMove(a, status);
  }

  return (
    <div className="wk">
      <div className="wk-auths">
        {authorities.map((x) => (
          <button
            type="button"
            key={x.name}
            className="wk-auth"
            aria-pressed={auth === x.name}
            onClick={() => setAuth(auth === x.name ? null : x.name)}
          >
            <span className="wk-auth-name">{x.name.replace(/^Ministry of /, '')}</span>
            <span className="wk-auth-n">{x.count.p + x.count.o ? `${x.count.p + x.count.o} open` : 'all closed'}</span>
            <WorkBar count={x.count} />
          </button>
        ))}
      </div>

      <div className="eg-tools">
        <input className="search" placeholder="Search actions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search actions" />
        <span className="eg-tools-label">Who acts</span>
        {orgs.map(([id, name]) => (
          <button type="button" key={id} className={'chip ' + (org === id ? 'chip-on' : '')}
            aria-pressed={org === id} onClick={() => setOrg(org === id ? null : id)}>{name}</button>
        ))}
        <span className="eg-tools-label">Show</span>
        {[['overdue', 'Overdue'], ['external', 'No system link'], ['ownerless', 'No owner']].map(([k, label]) => (
          <button type="button" key={k} className={'chip ' + (flag === k ? 'chip-on' : '')}
            aria-pressed={flag === k} onClick={() => setFlag(flag === k ? null : k)}>{label}</button>
        ))}
      </div>
      {isEditor && <p className="wk-tip">Drag a card to Ongoing to log progress, or to Closed to close it with its evidence. Click a card for the full record.</p>}

      <div className="wk-cols">
        {COLS.map((c) => {
          const list = shown.filter((a) => a.status === c.status);
          return (
            <section
              key={c.status}
              className={'wk-col' + (over === c.status ? ' is-over' : '')}
              onDragOver={isEditor ? (e) => { e.preventDefault(); setOver(c.status); } : undefined}
              onDragLeave={isEditor ? () => setOver(null) : undefined}
              onDrop={isEditor ? (e) => drop(e, c.status) : undefined}
            >
              <header className="wk-col-head">
                <span className={'wk-col-dot wk-' + c.tone} aria-hidden="true" />
                <b>{c.title}</b>
                <span className="wk-col-hint">{c.hint}</span>
                <span className="wk-col-n">{list.length}</span>
              </header>
              <div className="wk-cards">
                <AnimatePresence initial={false} mode="popLayout">
                  {list.slice(0, limit[c.status]).map((a) => (
                    <motion.div
                      key={a.id}
                      layout={reduce ? false : 'position'}
                      initial={reduce ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? undefined : { opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      <Card action={a} draggable={isEditor} onOpen={() => onOpenAction(a.id)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
                {list.length > limit[c.status] && (
                  <button type="button" className="btn-link wk-more"
                    onClick={() => setLimit((m) => ({ ...m, [c.status]: m[c.status] + 20 }))}>
                    Show {Math.min(20, list.length - limit[c.status])} more of {list.length - limit[c.status]}
                  </button>
                )}
                {!list.length && <p className="wk-empty">Nothing here{shown.length < model.live.length ? ' with these filters' : ''}.</p>}
              </div>
            </section>
          );
        })}
      </div>

      <div className="wk-removed">
        <button type="button" className="btn-link" aria-expanded={showRemoved} onClick={() => setShowRemoved(!showRemoved)}>
          {showRemoved ? 'Hide removed and cancelled actions' : `Removed and cancelled actions${model.resolved.length ? ` (${model.resolved.length} cancelled or superseded)` : ''}`}
        </button>
        {showRemoved && <EngagementRemoved isEditor={isEditor} onChanged={onChanged} />}
      </div>
    </div>
  );
}

function Card({ action: a, draggable, onOpen }) {
  const [dragging, setDragging] = useState(false);
  return (
    <article
      className={'wk-card' + (dragging ? ' is-dragging' : '') + (draggable ? ' is-draggable' : '')}
      draggable={draggable}
      tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(a.id)); e.dataTransfer.effectAllowed = 'move'; setDragging(true); }}
      onDragEnd={() => setDragging(false)}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`${a.action_code}: ${cut(a.description, 80)}`}
    >
      <div className="wk-card-top">
        <span>{a.action_code} {shortName(a.sub_division_name)}</span>
        {a.is_overdue ? <span className="eg-warn">Overdue</span>
          : a.has_external_evidence && a.status !== 'Closed' ? <span title="Its evidence sits outside the system">No system link</span> : null}
      </div>
      <p className="wk-card-text">{cut(a.description, 180)}</p>
      <div className="wk-card-meta">
        <span><Owners orgs={a.orgs} /></span>
        <span className="wk-card-date">
          {a.latest_entry ? `Updated ${fmtDate(a.latest_entry.date)}`
            : a.due_milestone || (a.recorded_date ? `Raised ${fmtDate(a.recorded_date)}` : '')}
        </span>
      </div>
    </article>
  );
}
