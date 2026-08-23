// ---------------------------------------------------------------------------
//  Small data pieces for the guide: a composition bar and an engagement track.
//
//  Both follow the same rule — colour never carries the meaning on its own.
//  Every segment is labelled, every value is written out, and the bars degrade
//  to plain text rather than to an empty frame when there is nothing to show.
// ---------------------------------------------------------------------------
import { motion, useReducedMotion } from 'framer-motion';

// Most descriptions open with the item number from the minutes they came out
// of — "Item# 04:", "Item 2.10:", "Item# 3.:". That is the authority's own
// numbering and it is worth keeping, but sitting inside the sentence it reads
// as a second, competing reference next to our 11.1.1. Split it out so each
// number is clearly whose.
const ITEM_RE = /^\s*item\s*#?\s*([0-9]+(?:\.[0-9]+)*)\.?\s*:?\s*/i;

export function splitItemRef(description) {
  const d = String(description || '');
  const m = d.match(ITEM_RE);
  if (!m) return { item: null, text: d };
  const rest = d.slice(m[0].length).trim();
  // If stripping the prefix leaves nothing, the number *was* the description.
  if (!rest) return { item: null, text: d };
  return { item: `Item ${m[1]}`, text: rest };
}

// Document references run long — "SPP-ECG-00_GN-00-MOM-MNG-MMUP-00001
// (English Translated)". The project prefix is the same on every one of them
// and carries no information here, so drop it and keep the part that
// identifies the document.
export function shortSource(action) {
  if (!action) return null;
  const raw = action.source_ref_external
    || (action.source_type && action.source_type !== 'external' ? action.source_type : null);
  if (!raw) return null;
  return String(raw)
    .replace(/^SPP-ECG-[0-9]+_?[A-Z]{0,2}-[0-9]+-/i, '')
    .replace(/\s*\(English Translated\)\s*/i, '')
    .trim();
}

export const STATUS_COLOR = {
  Pending: 'var(--v-pending)',
  'Open/Ongoing': 'var(--v-ongoing)',
  Closed: 'var(--v-closed)',
  Cancelled: 'var(--v-idle)',
  Superseded: 'var(--v-idle)',
};

const ORDER = ['Pending', 'Open/Ongoing', 'Closed', 'Cancelled', 'Superseded'];

/* ---- the guiding bar: how a set of actions is composed ------------------ */
export function CompositionBar({ actions, compact = false, label }) {
  const reduce = useReducedMotion();
  const total = actions.length;
  const counts = ORDER
    .map((s) => ({ status: s, n: actions.filter((a) => a.status === s).length }))
    .filter((c) => c.n > 0);

  if (!total) {
    return <div className="viz-empty">No actions on this stakeholder yet.</div>;
  }

  return (
    <div className={'viz-bar-wrap' + (compact ? ' is-compact' : '')}>
      {label && (
        <div className="viz-bar-head">
          <span className="viz-bar-label">{label}</span>
          <span className="viz-bar-total">{total}</span>
        </div>
      )}
      <div
        className="viz-bar"
        role="img"
        aria-label={counts.map((c) => `${c.n} ${c.status}`).join(', ')}
      >
        {counts.map((c, i) => (
          <motion.span
            key={c.status}
            className="viz-seg"
            /* width lays the segment out; scaleX animates it, so growing the
               bar never triggers a reflow */
            style={{ background: STATUS_COLOR[c.status], width: `${(c.n / total) * 100}%` }}
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.45, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
            title={`${c.n} ${c.status}`}
          />
        ))}
      </div>
      {!compact && (
        <div className="viz-legend">
          {counts.map((c) => (
            <span key={c.status} className="viz-key">
              <i style={{ background: STATUS_COLOR[c.status] }} />
              {c.status} <b>{c.n}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- the engagement track: where a stakeholder is against where we need
        them. A five-step ladder, so the gap is a distance you can see. ----- */
const LADDER = ['Unaware', 'Resistant', 'Neutral', 'Supportive', 'Leading'];

export function EngagementTrack({ current, desired }) {
  const reduce = useReducedMotion();
  const ci = LADDER.indexOf(current);
  const di = LADDER.indexOf(desired);
  if (ci < 0 && di < 0) {
    return <div className="viz-empty">This stakeholder has not been assessed yet.</div>;
  }
  const aligned = ci === di && ci >= 0;

  return (
    <div className="viz-track" role="img"
         aria-label={aligned
           ? `Aligned at ${current}`
           : `Currently ${current || 'unassessed'}, needs to reach ${desired || 'unassessed'}`}>
      <div className="viz-track-rail">
        {ci >= 0 && di > ci && (
          <motion.div
            className="viz-track-gap"
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{
              left: `${(ci / 4) * 100}%`,
              width: `${((di - ci) / 4) * 100}%`,
            }}
          />
        )}
        {LADDER.map((step, i) => {
          const isC = i === ci;
          const isD = i === di;
          return (
            <div key={step} className="viz-step" style={{ left: `${(i / 4) * 100}%` }}>
              <span className={'viz-node'
                + (isC ? ' is-current' : '')
                + (isD ? ' is-desired' : '')
                + (aligned && isC ? ' is-aligned' : '')} />
              <span className={'viz-step-label' + (isC || isD ? ' is-on' : '')}>{step}</span>
              {isC && <span className="viz-flag viz-flag-c">Now</span>}
              {isD && !aligned && <span className="viz-flag viz-flag-d">Needed</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
