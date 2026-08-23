// ---------------------------------------------------------------------------
//  EngagementGuide — the register read as a technical guide.
//
//  Structure, after Randall Parrish's Sonos User Guide: a dark nested rail
//  holding the hierarchy against a light canvas carrying one thing at a time
//  in large, quiet type. The rail is already the shape of this data —
//  authority holds actions, an action holds the progress logged against it —
//  and master-detail beats an accordion at ~95 rows because the rail stays
//  put while you read, so you never lose your place.
//
//  Selecting an authority shows its overview: how its work is composed and
//  where its stakeholders sit against where the project needs them.
//  Selecting an action shows that action and its timeline.
//
//  Motion is deliberately narrow. One travelling marker follows the
//  selection like a drop of water finding its level, and the canvas rises as
//  it crossfades. Everything else is still. All of it is transform/opacity
//  only, and all of it stops under prefers-reduced-motion.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { api } from '../lib/api.js';
import { Loading, Empty, Pill, fmtDate } from './ui.jsx';
import { CompositionBar, EngagementTrack, STATUS_COLOR, splitItemRef, shortSource } from './EngagementViz.jsx';

const STATUS_TONE = {
  Pending: 'amber', 'Open/Ongoing': 'navy', Closed: 'green',
  Cancelled: 'grey', Superseded: 'grey',
};

// One spring, used everywhere the marker or the canvas moves, so the whole
// screen shares a rhythm instead of each piece easing its own way.
const DROP = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };

// Split an authority's actions by the department that owns them. The
// hierarchy is already in the code (5.1.x is Water, 5.2.x is Electricity) but
// nobody should have to decode a number to find that out.
function byDept(actions) {
  const m = new Map();
  for (const a of actions) {
    if (!m.has(a.sub_reference)) {
      m.set(a.sub_reference, { name: a.sub_division_name, items: [] });
    }
    m.get(a.sub_reference).items.push(a);
  }
  const multi = m.size > 1;
  return [...m.entries()].map(([ref, d]) => [ref, { ...d, multi }]);
}

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

const RAIL_MIN = 220;
const RAIL_MAX = 620;
const RAIL_DEFAULT = 336;

export default function EngagementGuide({ rows, matrix, isEditor, onOpen, onAddProgress, onChanged }) {
  const reduce = useReducedMotion();

  // The rail's width is a matter of screen and taste, so it is draggable and
  // remembered. Kept in a ref during the drag and written to state on release,
  // so dragging never re-renders the whole register.
  const shell = useRef(null);
  const [railW, setRailW] = useState(() => {
    const saved = Number(localStorage.getItem('spd_guide_rail'));
    return saved >= RAIL_MIN && saved <= RAIL_MAX ? saved : RAIL_DEFAULT;
  });
  const [dragging, setDragging] = useState(false);
  const [guideH, setGuideH] = useState(null);
  const canvasRef = useRef(null);

  // Fill the space left below whatever sits above, so the rail and the canvas
  // each scroll inside their own pane instead of the whole page scrolling.
  // Measured rather than hard-coded, because the header above changes height
  // with the filters and the window.
  useEffect(() => {
    const el = shell.current;
    if (!el) return undefined;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setGuideH(Math.max(380, Math.round(window.innerHeight - top - 24)));
    };
    fit();
    window.addEventListener('resize', fit);
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => { window.removeEventListener('resize', fit); ro.disconnect(); };
  }, []);

  const applyWidth = (px) => {
    const w = Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(px)));
    if (shell.current) shell.current.style.setProperty('--rail-w', w + 'px');
    return w;
  };

  function onGrab(e) {
    e.preventDefault();
    const box = shell.current.getBoundingClientRect();
    setDragging(true);
    // Capture keeps the drag alive if the pointer outruns the handle; it is
    // not essential, so a browser that refuses must not break the drag.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
    let latest = railW;
    const move = (ev) => { latest = applyWidth(ev.clientX - box.left); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      setRailW(latest);
      localStorage.setItem('spd_guide_rail', String(latest));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Arrow keys move it too, so it is not a mouse-only control.
  function onKey(e) {
    const step = e.shiftKey ? 40 : 12;
    let next = null;
    if (e.key === 'ArrowLeft') next = railW - step;
    else if (e.key === 'ArrowRight') next = railW + step;
    else if (e.key === 'Home') next = RAIL_DEFAULT;
    if (next === null) return;
    e.preventDefault();
    const w = applyWidth(next);
    setRailW(w);
    localStorage.setItem('spd_guide_rail', String(w));
  }

  function resetWidth() {
    const w = applyWidth(RAIL_DEFAULT);
    setRailW(w);
    localStorage.setItem('spd_guide_rail', String(w));
  }
  const [openAuth, setOpenAuth] = useState(() => new Set());
  const [sel, setSel] = useState(null);          // {kind:'authority'|'action', key}
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) {
      if (!m.has(r.authority_code)) {
        m.set(r.authority_code, {
          code: r.authority_code, name: r.authority_name, actions: [],
        });
      }
      m.get(r.authority_code).actions.push(r);
    }
    return [...m.values()];
  }, [rows]);

  // Land on the first authority's overview rather than an empty canvas.
  useEffect(() => {
    if (!groups.length || sel) return;
    setOpenAuth(new Set([groups[0].code]));
    setSel({ kind: 'authority', key: groups[0].code });
  }, [groups]);

  // Picking something in the rail should show it from its beginning, not from
  // wherever the last one was scrolled to.
  useEffect(() => {
    if (canvasRef.current) canvasRef.current.scrollTop = 0;
  }, [sel?.kind, sel?.key]);

  useEffect(() => {
    if (sel?.kind !== 'action') { setDetail(null); return; }
    setLoading(true);
    api.engAction(sel.key)
      .then(setDetail).catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [sel?.key, sel?.kind]);

  const toggle = (code) => setOpenAuth((s) => {
    const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n;
  });

  if (!rows) return <Loading label="Loading the register" />;
  if (!rows.length) return <Empty title="Nothing matches these filters" />;

  const group = sel?.kind === 'authority'
    ? groups.find((g) => g.code === sel.key)
    : groups.find((g) => g.actions.some((a) => a.id === sel?.key));

  return (
    <div
      className={'guide' + (dragging ? ' is-dragging' : '')}
      ref={shell}
      style={{
        '--rail-w': railW + 'px',
        ...(guideH ? { '--guide-h': guideH + 'px' } : null),
      }}
    >
      {/* ---------- rail ---------- */}
      <nav className="guide-rail" aria-label="Register">
        <div className="guide-rail-head">
          <span className="guide-rail-title">Register</span>
          <span className="guide-rail-count">{rows.length}</span>
        </div>

        <div className="guide-rail-scroll">
          {groups.map((g, gi) => {
            const isOpen = openAuth.has(g.code);
            const isSel = sel?.kind === 'authority' && sel.key === g.code;
            const open = g.actions.filter(
              (a) => ['Pending', 'Open/Ongoing'].includes(a.status)).length;
            return (
              <motion.div
                key={g.code}
                className="guide-sec"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(gi * 0.035, 0.5), duration: 0.32 }}
              >
                <div className={'guide-sec-row' + (isSel ? ' is-sel' : '')}>
                  {isSel && !reduce && (
                    <motion.span layoutId="drop" className="guide-drop" transition={DROP} />
                  )}
                  {isSel && reduce && <span className="guide-drop" />}
                  <button
                    className="guide-sec-head"
                    onClick={() => { setSel({ kind: 'authority', key: g.code }); if (!isOpen) toggle(g.code); }}
                  >
                    <span className="guide-sec-name">{g.name}</span>
                    {open > 0 && <span className="guide-sec-n">{open}</span>}
                  </button>
                  <button
                    className="guide-sec-toggle"
                    aria-expanded={isOpen}
                    aria-label={(isOpen ? 'Collapse ' : 'Expand ') + g.name}
                    onClick={() => toggle(g.code)}
                  >
                    <motion.span
                      className="guide-chev"
                      animate={{ rotate: isOpen ? 90 : 0 }}
                      transition={reduce ? { duration: 0 } : DROP}
                      aria-hidden="true"
                    >›</motion.span>
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      className="guide-sec-body"
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {byDept(g.actions).map(([ref, dept]) => (
                        <div key={ref}>
                          {/* Which department owns these. Only shown where the
                              authority has more than one, so a single-department
                              authority gains no pointless heading. */}
                          {dept.multi && (
                            <div className="guide-dept">{dept.name}</div>
                          )}
                          {dept.items.map((a) => {
                            const on = sel?.kind === 'action' && sel.key === a.id;
                            return (
                              <div key={a.id} className={'guide-link-row' + (on ? ' is-sel' : '')}>
                                {on && !reduce && (
                                  <motion.span layoutId="drop" className="guide-drop" transition={DROP} />
                                )}
                                {on && reduce && <span className="guide-drop" />}
                                <button
                                  className={'guide-link' + (on ? ' guide-link-on' : '')}
                                  onClick={() => setSel({ kind: 'action', key: a.id })}
                                >
                                  <span className="guide-link-code">{a.action_code}</span>
                                  <span className="guide-link-text">{splitItemRef(a.description).text}</span>
                                  <span className="guide-dot"
                                        style={{ background: STATUS_COLOR[a.status] }}
                                        aria-hidden="true" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </nav>

      {/* drag to set how much room the register gets */}
      <div
        className="guide-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the register panel"
        aria-valuenow={railW}
        aria-valuemin={RAIL_MIN}
        aria-valuemax={RAIL_MAX}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onGrab}
        onKeyDown={onKey}
        onDoubleClick={resetWidth}
      >
        <span className="guide-resizer-grip" aria-hidden="true" />
      </div>

      {/* ---------- canvas ---------- */}
      <div className="guide-canvas" ref={canvasRef}>
        <AnimatePresence mode="wait">
          <motion.div
            key={sel?.kind + ':' + sel?.key}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {sel?.kind === 'authority' && group && (
              <AuthorityView
                group={group}
                matrix={matrix}
                isEditor={isEditor}
                onOpen={onOpen}
                onAddProgress={onAddProgress}
                onChanged={onChanged}
              />
            )}
            {sel?.kind === 'action' && (
              loading && !detail
                ? <Loading label="Loading" />
                : detail && (
                  <ActionView
                    detail={detail}
                    isEditor={isEditor}
                    onOpen={onOpen}
                    onAddProgress={onAddProgress}
                  />
                )
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---- the authority overview --------------------------------------------
   One block per department, each carrying its own story: where they sit,
   how their work is composed, and what is outstanding. Splitting position
   and actions into separate sections made you hold two lists in your head
   and named every department twice.
   ------------------------------------------------------------------------ */
function AuthorityView({ group, matrix, isEditor, onOpen, onAddProgress, onChanged }) {
  const overdue = group.actions.filter((a) => a.is_overdue).length;
  const unref = group.actions.filter((a) => a.has_external_evidence).length;

  // Union of the departments that have a position and those that have work,
  // so neither an unassessed department nor an unrated one disappears.
  const subs = (matrix || []).filter((m) => m.authority_code === group.code);
  const seen = new Set(subs.map((m) => m.sub_division_id));
  const orphans = [];
  for (const a of group.actions) {
    if (!seen.has(a.sub_division_id)) {
      seen.add(a.sub_division_id);
      orphans.push({
        sub_division_id: a.sub_division_id,
        sub_division_name: a.sub_division_name,
        sub_reference: a.sub_reference,
      });
    }
  }
  const depts = [...subs, ...orphans];
  const multi = depts.length > 1;

  return (
    <>
      <div className="guide-crumb">Authority</div>
      <h1 className="guide-display">{group.name}</h1>

      <div className="guide-block">
        <h2 className="guide-h2">How the work stands</h2>
        <CompositionBar actions={group.actions} label="All actions" />
        <div className="guide-callouts">
          {overdue > 0 && <span className="guide-callout is-warn">{overdue} overdue</span>}
          {unref > 0 && <span className="guide-callout">{unref} with no system link</span>}
          {overdue === 0 && unref === 0 && <span className="guide-callout is-ok">Nothing flagged</span>}
        </div>
      </div>

      {depts.map((m) => {
        const items = group.actions.filter((a) => a.sub_division_id === m.sub_division_id);
        const assessed = m.engagement_current || m.engagement_desired;
        return (
          <section key={m.sub_division_id} className="guide-dept-section">
            <header className="guide-dept-bar">
              <h2 className="guide-dept-title">{m.sub_division_name}</h2>
              <span className="guide-dept-ref">{m.sub_reference}</span>
              {m.action_priority && <Pill tone="grey">{m.action_priority}</Pill>}
              {m.is_critical && <Pill tone="red">Critical</Pill>}
              <span className="guide-dept-count">
                {items.length ? `${items.length} action${items.length > 1 ? 's' : ''}` : 'no actions'}
              </span>
            </header>

            {assessed ? (
              <EngagementTrack current={m.engagement_current} desired={m.engagement_desired} />
            ) : (
              <p className="guide-empty-note guide-unassessed">
                Not assessed yet — set their position on the Stakeholder Matrix tab.
              </p>
            )}

            {items.length > 0 && (
              <>
                <div className="guide-list">
                  {items.map((a) => (
                    <button key={a.id} className="guide-list-row" onClick={() => onPick(a.id)}>
                      <span className="guide-list-code">{a.action_code}</span>
                      <span className="guide-list-text">
                        {(() => {
                          // The action's own number opens the row; the source's
                          // numbering sits underneath, so two numbers never
                          // compete for the same position.
                          const { item, text } = splitItemRef(a.description);
                          const src = shortSource(a);
                          return (
                            <>
                              {text}
                              {(item || src) && (
                                <span className="guide-list-src">
                                  {item && src ? `${item} of ${src}`
                                    : item ? item
                                    : `From ${src}`}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </span>
                      <span className="guide-list-status">
                        <Pill tone={STATUS_TONE[a.status] || 'grey'}>{a.status}</Pill>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

/* ---- one action --------------------------------------------------------- */
function ActionView({ detail, isEditor, onOpen, onAddProgress }) {
  const reduce = useReducedMotion();
  const entries = detail.timeline || [];
  return (
    <>
      <div className="guide-crumb">
        {detail.authority_name} <span aria-hidden="true">›</span> {detail.sub_division_name}
      </div>
      <h1 className="guide-display guide-display-num">{detail.action_code}</h1>
      {(() => {
        const { item, text } = splitItemRef(detail.description);
        return (
          <>
            {item && (
              <div className="guide-item-source">
                {item} of {shortSource(detail) || 'the source document'}
              </div>
            )}
            <p className="guide-lede">{text}</p>
          </>
        );
      })()}

      <div className="guide-facts">
        <Fact label="Status" value={<Pill tone={STATUS_TONE[detail.status] || 'grey'}>{detail.status}</Pill>} />
        <Fact label="Action by" value={detail.orgs?.length
          ? detail.orgs.map((o) => <Pill key={o.id} tone="grey">{o.name}</Pill>) : '—'} />
        <Fact label="Raised" value={detail.recorded_date ? fmtDate(detail.recorded_date) : '—'} />
        <Fact label="Due" value={detail.due_date ? fmtDate(detail.due_date) : detail.due_milestone || '—'} />
        <Fact label="Priority" value={detail.action_priority || '—'} />
        <Fact label="Raised in" value={
          detail.source_type === 'external'
            ? <span className="src-tag src-tag-ext">{detail.source_ref_external}</span>
            : <span className="src-tag">{detail.source_type}</span>} />
      </div>

      <div className="guide-rule" />
      <h2 className="guide-h2">Progress</h2>
      {entries.length === 0 ? (
        <p className="guide-empty-note">
          Nothing registered against this yet — which is why it reads as Pending.
        </p>
      ) : (
        <div className="guide-tl">
          {entries.map((e, i) => (
            <motion.div
              key={e.id}
              className={'guide-tl-entry' + (e.kind === 'closure' ? ' is-closure' : '')}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.3 }}
            >
              <div className="guide-tl-when">{fmtDate(e.entry_date)}</div>
              <div className="guide-tl-body">
                <div className="guide-tl-head">
                  <Pill tone={e.kind === 'closure' ? 'green' : 'navy'}>
                    {e.kind === 'closure' ? 'Closed' : 'Progress'}
                  </Pill>
                  <SourceTag e={e} />
                  {e.created_by_name && <span className="cell-sub">· {e.created_by_name}</span>}
                </div>
                <div className="guide-tl-note">{e.note}</div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="guide-actions">
        {isEditor && !detail.resolution && detail.status !== 'Closed' && (
          <button className="btn btn-primary" onClick={() => onAddProgress(detail.id)}>
            Register progress
          </button>
        )}
        <button className="btn" onClick={() => onOpen(detail.id)}>Open full record</button>
      </div>
    </>
  );
}

function Fact({ label, value }) {
  return (
    <div className="guide-fact">
      <div className="guide-fact-l">{label}</div>
      <div className="guide-fact-v">{value}</div>
    </div>
  );
}
