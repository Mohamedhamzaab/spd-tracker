// Small pieces every engagement tab draws with.
import { motion, useReducedMotion } from 'framer-motion';
import { LADDER, STATUS_LABEL } from './model.js';

const pos = (i) => 6 + (i / 4) * 88; // % across the track, Unaware → Leading

// Where a stakeholder stands (filled dot), where we need them (ring), and the
// distance between (dashed). With `travel`, the dot sets off from Unaware and
// walks to where they are - the page's one orchestrated moment.
export function StanceTrack({ line, travel = false, delay = 0, size = 'md' }) {
  const reduce = useReducedMotion();
  if (!line.assessed) return <span className="st-none">No position recorded</span>;
  const from = travel && !reduce ? 0 : line.cs;
  const t = { duration: 0.9, delay, ease: [0.2, 0.8, 0.2, 1] };
  const shown = new Set([line.cs, line.ds]);
  return (
    <div
      className={'st-track st-' + size + (line.behind ? '' : ' is-there')}
      role="img"
      aria-label={`Now ${line.current}, needed ${line.desired}`}
    >
      <span className="st-rail" />
      {LADDER.map((s, i) => <span key={s} className="st-stop" style={{ left: pos(i) + '%' }} />)}
      {line.behind && (
        <motion.span
          className="st-gap"
          initial={{ left: pos(from) + '%', width: pos(line.ds) - pos(from) + '%' }}
          animate={{ left: pos(line.cs) + '%', width: pos(line.ds) - pos(line.cs) + '%' }}
          transition={t}
        />
      )}
      <span className="st-need" style={{ left: pos(line.ds) + '%' }} title={'Needed: ' + line.desired} />
      <motion.span
        className="st-now"
        initial={{ left: pos(from) + '%' }}
        animate={{ left: pos(line.cs) + '%' }}
        transition={t}
        title={'Now: ' + line.current}
      />
      {LADDER.map((s, i) => shown.has(i) && (
        <span key={'l' + s} className="st-label" style={{ left: pos(i) + '%' }}>{s}</span>
      ))}
    </div>
  );
}

// How a stakeholder's (or an authority's) work is made up: closed, ongoing,
// pending - in that order, so "done" always reads from the left.
export function WorkBar({ count }) {
  const total = count.c + count.o + count.p;
  if (!total) return null;
  return (
    <span className="wb-bar" role="img" aria-label={`${count.c} closed, ${count.o} ongoing, ${count.p} pending`}>
      {count.c > 0 && <i className="wb-c" style={{ flex: count.c }} />}
      {count.o > 0 && <i className="wb-o" style={{ flex: count.o }} />}
      {count.p > 0 && <i className="wb-p" style={{ flex: count.p }} />}
    </span>
  );
}

export function StatusTag({ status }) {
  return <span className={'stag stag-' + (status === 'Open/Ongoing' ? 'o' : status === 'Closed' ? 'c' : 'p')}>{STATUS_LABEL[status] || status}</span>;
}

export function Owners({ orgs }) {
  if (!orgs || !orgs.length) return <span className="own own-none">No owner</span>;
  return orgs.map((o) => <span key={o.id} className="own">{o.name}</span>);
}

export function Legend({ stance = true, work = true }) {
  return (
    <span className="eg-legend">
      {stance && <span><i className="lg-now" />Where they are</span>}
      {stance && <span><i className="lg-need" />Where we need them</span>}
      {work && <span><i className="lg-c" />Closed</span>}
      {work && <span><i className="lg-o" />Ongoing</span>}
      {work && <span><i className="lg-p" />Pending</span>}
    </span>
  );
}
