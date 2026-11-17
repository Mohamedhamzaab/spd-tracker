// ---------------------------------------------------------------------------
//  Weekly picture — the page the Client reads.
//
//  One sentence says how things stand; below it every stakeholder sits in the
//  group that tells you what to do about them, each with a track showing where
//  they are against where the project needs them. A row opens in place to show
//  what is in the way and the actions behind it.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { fmtDate } from '../ui.jsx';
import { LANES, cut, plural } from './model.js';
import { StanceTrack, WorkBar, StatusTag, Owners, Legend } from './bits.jsx';

export default function WeeklyPicture({ model, isEditor, onOpenAction, onOpenLine, onRaise }) {
  const [critical, setCritical] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  // The dots walk to their places once, when you arrive - not on every filter.
  const firstPaint = useRef(true);
  useEffect(() => { firstPaint.current = false; }, []);

  const { lines, totals, ownerless, overdue, live } = model;
  const n = (k) => lines.filter((l) => l.lane === k).length;
  const query = q.trim().toLowerCase();
  const visible = useMemo(() => lines.filter((l) =>
    (!critical || l.critical)
    && (!query || `${l.name} ${l.authority} ${l.ref}`.toLowerCase().includes(query))), [lines, critical, query]);

  const toggle = (id) => setOpen((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });

  const parts = [];
  if (n('discuss')) parts.push(<><b>{plural(n('discuss'), 'critical stakeholder', 'critical stakeholders')}</b> {n('discuss') === 1 ? 'needs' : 'need'} discussion</>);
  if (n('unengaged')) parts.push(<><b>{n('unengaged')}</b> {n('unengaged') === 1 ? 'is' : 'are'} not engaged yet</>);
  let order = 0;

  return (
    <div className="wp">
      <p className="wp-sentence">
        {parts.length === 2 && <>{parts[0]} and {parts[1]}. </>}
        {parts.length === 1 && <>{parts[0]}. </>}
        {n('ok') > 0 && <>{plural(n('ok'), 'stakeholder is', 'stakeholders are')} already where we need them.</>}
      </p>
      <p className="wp-sub">
        {totals.c} of {live.length} actions closed, {totals.o} ongoing, {totals.p} pending
        {overdue > 0 && <>, <span className="eg-warn">{overdue} overdue</span></>}
        {ownerless > 0 && <>, {ownerless} open with no owner</>}.
      </p>

      <div className="eg-tools">
        <input className="search" placeholder="Find a stakeholder" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Find a stakeholder" />
        <button type="button" className={'chip ' + (critical ? 'chip-on' : '')}
          aria-pressed={critical} onClick={() => setCritical(!critical)}>Critical only</button>
        <Legend />
      </div>

      {LANES.map((lane) => {
        const rows = visible.filter((l) => l.lane === lane.key);
        if (!rows.length) return null;
        return (
          <section key={lane.key} className={'wp-lane wp-lane-' + lane.key}>
            <h2 className="wp-lane-title">{lane.title} <span>{rows.length}</span></h2>
            <p className="wp-lane-hint">{lane.hint}</p>
            <div className="wp-rows">
              {rows.map((l) => (
                <Row
                  key={l.id}
                  line={l}
                  open={open.has(l.id)}
                  onToggle={() => toggle(l.id)}
                  travel={firstPaint.current}
                  delay={Math.min((order++) * 0.03, 0.7)}
                  isEditor={isEditor}
                  onOpenAction={onOpenAction}
                  onOpenLine={onOpenLine}
                  onRaise={onRaise}
                />
              ))}
            </div>
          </section>
        );
      })}
      {!visible.length && <p className="wp-sub">Nothing matches.</p>}
    </div>
  );
}

function Row({ line: l, open, onToggle, travel, delay, isEditor, onOpenAction, onOpenLine, onRaise }) {
  const reduce = useReducedMotion();
  const [showClosed, setShowClosed] = useState(false);
  const openActs = l.actions.filter((a) => a.status !== 'Closed');
  const closedActs = l.actions.filter((a) => a.status === 'Closed');
  const list = showClosed ? l.actions : openActs;
  return (
    <div className={'wp-row' + (open ? ' is-open' : '')}>
      <button type="button" className="wp-row-head" aria-expanded={open} onClick={onToggle}>
        <span className="wp-name">
          <b>{l.no && <span className="wp-no">{l.no}</span>}{l.short}</b>
          <span>{l.authority}{l.critical ? ', critical' : ''}</span>
        </span>
        <StanceTrack line={l} travel={travel} delay={delay} />
        <span className="wp-work">
          {l.actions.length ? (
            <>
              <WorkBar count={l.count} />
              <span>{l.count.c} of {l.actions.length} closed{l.overdue && <span className="eg-warn">, overdue</span>}</span>
            </>
          ) : <span>No actions</span>}
        </span>
        <span className="wp-chev" aria-hidden="true">›</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="wp-body"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="wp-inner">
              {l.remarks && <div className="wp-remarks"><b>Where things stand:</b> {l.remarks}</div>}
              {l.gapNote && (
                <div className="wp-why">
                  <b>What's in the way:</b> {l.gapNote}
                  {l.gapBy && <span className="own">{l.gapBy}</span>}
                </div>
              )}
              {list.map((a) => (
                <button type="button" key={a.id} className="wp-act" onClick={() => onOpenAction(a.id)}>
                  <span className="wp-act-code">{a.action_code}</span>
                  <span className="wp-act-main">
                    <span className="wp-act-text">{cut(a.description, 220)}</span>
                    <span className="wp-act-meta">
                      <Owners orgs={a.orgs} />
                      {a.latest_entry
                        ? <span>Latest, {fmtDate(a.latest_entry.date)}: {cut(a.latest_entry.note, 150)}</span>
                        : a.notes ? <span>{cut(a.notes, 150)}</span> : null}
                    </span>
                  </span>
                  <StatusTag status={a.status} />
                </button>
              ))}
              {!list.length && <p className="wp-sub">{l.actions.length ? 'Every action here is closed.' : 'No actions logged.'}</p>}
              <div className="wp-foot">
                {closedActs.length > 0 && (
                  <button type="button" className="btn-link" onClick={() => setShowClosed(!showClosed)}>
                    {showClosed ? 'Hide closed actions' : `Show ${plural(closedActs.length, 'closed action', 'closed actions')}`}
                  </button>
                )}
                <span className="wp-foot-gap" />
                <button type="button" className="btn btn-sm" onClick={() => onOpenLine(l)}>
                  {isEditor ? 'Position and details' : 'Details'}
                </button>
                {isEditor && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onRaise(l.id)}>Raise action</button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
