// ---------------------------------------------------------------------------
//  Where everyone stands — the whole register on one board.
//
//  Across: stance, Unaware to Leading. Down: how much power and interest each
//  stakeholder has. Every name sits where it stands today; switch to "Where we
//  need them" and the ones that have to move slide across. The distance they
//  travel is the work.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { BANDS, LADDER, LADDER_HINT, plural } from './model.js';

export default function Standings({ model, onOpenLine, selectedId }) {
  const reduce = useReducedMotion();
  const [target, setTarget] = useState(false);
  const rated = model.lines.filter((l) => l.assessed && l.priority);
  const unplaced = model.lines.filter((l) => !(l.assessed && l.priority));
  const moving = rated.filter((l) => l.behind);
  const colOf = (l) => (target ? l.ds : l.cs);
  const colCount = (i) => rated.filter((l) => colOf(l) === i).length;
  let moved = 0;

  const chip = (l) => {
    const goes = target && l.behind;
    const delay = goes && !reduce ? 0.04 + (moved++ % 14) * 0.035 : 0;
    return (
      <motion.button
        type="button"
        key={l.id}
        layoutId={'stand-' + l.id}
        layout="position"
        transition={{ layout: { duration: reduce ? 0 : 0.75, delay, ease: [0.65, 0, 0.25, 1] } }}
        className={'sd-chip' + (!l.assessed ? '' : l.behind ? ' is-behind' : ' is-there')
          + (goes ? ' is-moved' : '') + (selectedId === l.id ? ' is-sel' : '')}
        title={`${l.no ? l.no + ' ' : ''}${l.name} (${l.authority})${l.assessed ? `: now ${l.current}, needed ${l.desired}` : ''}`}
        onClick={() => onOpenLine(l)}
      >
        <span className="sd-dot" aria-hidden="true" />
        <span className="sd-name">{l.short}</span>
      </motion.button>
    );
  };

  return (
    <div className="sd">
      <div className="sd-head">
        <div>
          <h2 className="sd-title">{target ? 'Where the project needs them' : 'Where every stakeholder stands today'}</h2>
          <p className="sd-hint">
            {target
              ? `${plural(moving.length, 'stakeholder has', 'stakeholders have')} to move right to get here. The highlighted names are the ones that move.`
              : 'Each name sits at its stance today, grouped by how much power and interest it has. Switch to see where the project needs them.'}
          </p>
        </div>
        <div className="sd-when" role="group" aria-label="Show stakeholders">
          <button type="button" aria-pressed={!target} onClick={() => setTarget(false)}>Today</button>
          <button type="button" aria-pressed={target} onClick={() => setTarget(true)}>Where we need them</button>
        </div>
      </div>

      <LayoutGroup>
        <div className="sd-wrap">
          <div className={'sd-board' + (target ? ' is-target' : '')}>
            <div className="sd-corner" />
            {LADDER.map((s, i) => (
              <div key={s} className="sd-colh">
                <b>{s}</b><span>{LADDER_HINT[i]}</span>
                {colCount(i) > 0 && <em>{colCount(i)}</em>}
              </div>
            ))}
            {BANDS.map((b) => (
              <Band key={b.key} band={b} lines={rated.filter((l) => l.priority === b.key)} colOf={colOf} chip={chip} />
            ))}
          </div>
        </div>

        <div className="sd-foot">
          <span className="eg-legend">
            <span><i className="lg-behind" />Needs to move ({moving.length})</span>
            <span><i className="lg-there" />Already there ({rated.length - moving.length})</span>
          </span>
          <span className="sd-foot-note">Click a name for its position and actions.</span>
        </div>

        {unplaced.length > 0 && (
          <div className="sd-tray">
            <h3>Not assessed yet <span>{unplaced.length}</span></h3>
            <p>No stance or no power and interest rating recorded. Open one to set it.</p>
            <div className="sd-cell sd-cell-tray">{unplaced.map(chip)}</div>
          </div>
        )}
      </LayoutGroup>
    </div>
  );
}

function Band({ band, lines, colOf, chip }) {
  return (
    <>
      <div className={'sd-rowh' + (band.key === 'Manage Closely' ? ' is-crit' : '')}>
        <b>{band.label}</b><span>{band.hint}</span>
      </div>
      {LADDER.map((s, i) => (
        <div key={s} className="sd-cell">
          {lines.filter((l) => colOf(l) === i).map(chip)}
        </div>
      ))}
    </>
  );
}
