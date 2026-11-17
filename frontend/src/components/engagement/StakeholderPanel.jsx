// One stakeholder, in a panel that slides in from the right: where it stands,
// what is in the way, its actions - and, for editors, its position to set.
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { api } from '../../lib/api.js';
import { ErrorBanner, fmtDate, useEscapeToClose } from '../ui.jsx';
import { LADDER, cut, plural } from './model.js';
import { StanceTrack, StatusTag, Owners } from './bits.jsx';

export default function StakeholderPanel({ line: l, isEditor, onClose, onOpenAction, onRaise, onSaved }) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(() => formFrom(l));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setV(formFrom(l)); setError(''); }, [l.id, l.raw]);
  useEscapeToClose(onClose);

  const dirty = JSON.stringify(v) !== JSON.stringify(formFrom(l));
  async function save() {
    setSaving(true); setError('');
    try {
      await api.engSetRating(l.id, {
        engagement_current: v.current || null, engagement_desired: v.desired || null,
        influence: v.power || null, involvement: v.interest || null,
        gap_action_by: v.gapBy.trim() || null, gap_remarks: v.gapNote.trim() || null,
        remarks: v.remarks.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <motion.div className="sp-scrim" onClick={onClose}
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="sp"
        role="dialog"
        aria-label={l.name}
        initial={reduce ? false : { x: '100%' }}
        animate={{ x: 0 }}
        exit={reduce ? undefined : { x: '100%' }}
        transition={{ duration: 0.38, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <header className="sp-head">
          <div>
            <h2>{l.no && <span className="sp-no">{l.no}</span>}{l.short}</h2>
            <p>{l.authority}, {l.ref}{l.critical ? ', critical' : ''}</p>
          </div>
          <button type="button" className="sp-x" onClick={onClose} aria-label="Close" autoFocus>✕</button>
        </header>

        <div className="sp-body">
          <ErrorBanner message={error} />
          {l.assessed && <StanceTrack line={l} size="lg" />}
          <dl className="sp-facts">
            <div><dt>Now</dt><dd>{l.current || 'Not assessed'}</dd></div>
            <div><dt>Needed</dt><dd>{l.desired || 'Not set'}</dd></div>
            <div><dt>Priority</dt><dd>{l.priority || 'Not rated'}</dd></div>
            <div><dt>Actions</dt><dd>{l.actions.length ? `${l.count.c} closed, ${l.count.o} ongoing, ${l.count.p} pending` : 'None yet'}</dd></div>
          </dl>
          {!isEditor && l.remarks && <div className="wp-remarks"><b>Where things stand:</b> {l.remarks}</div>}
          {!isEditor && l.gapNote && <div className="wp-why"><b>What's in the way:</b> {l.gapNote}{l.gapBy && <span className="own">{l.gapBy}</span>}</div>}

          {isEditor && (
            <section className="sp-edit">
              <h3>Position</h3>
              <div className="sp-grid">
                <label>Now<select className="select" value={v.current} onChange={set('current')}>
                  <option value="">Not assessed</option>{LADDER.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label>Needed<select className="select" value={v.desired} onChange={set('desired')}>
                  <option value="">Not set</option>{LADDER.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label>Power<select className="select" value={v.power} onChange={set('power')}>
                  <option value="">Not rated</option><option value="H">High</option><option value="L">Low</option></select></label>
                <label>Interest<select className="select" value={v.interest} onChange={set('interest')}>
                  <option value="">Not rated</option><option value="H">High</option><option value="L">Low</option></select></label>
              </div>
              <label>Where things stand<textarea className="input" rows={3} value={v.remarks} onChange={set('remarks')} placeholder="e.g. Meeting held 25 Jun; animal and plant lists to be shared" /></label>
              <label>What's in the way<textarea className="input" rows={2} value={v.gapNote} onChange={set('gapNote')} placeholder="Why they are not where we need them yet" /></label>
              <label>Who acts on it<input className="input" value={v.gapBy} onChange={set('gapBy')} placeholder="ECG, SPD…" /></label>
              <div className="sp-save">
                <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save position'}
                </button>
                {dirty && !saving && <button type="button" className="btn-link" onClick={() => setV(formFrom(l))}>Undo changes</button>}
              </div>
            </section>
          )}

          <section className="sp-acts">
            <div className="sp-acts-head">
              <h3>{l.actions.length ? plural(l.actions.length, 'action', 'actions') : 'No actions'}</h3>
              {isEditor && <button type="button" className="btn btn-sm" onClick={() => onRaise(l.id)}>Raise action</button>}
            </div>
            {l.actions.map((a) => (
              <button type="button" key={a.id} className="wp-act" onClick={() => onOpenAction(a.id)}>
                <span className="wp-act-code">{a.action_code}</span>
                <span className="wp-act-main">
                  <span className="wp-act-text">{cut(a.description, 160)}</span>
                  <span className="wp-act-meta">
                    <Owners orgs={a.orgs} />
                    {a.latest_entry && <span>Latest, {fmtDate(a.latest_entry.date)}</span>}
                  </span>
                </span>
                <StatusTag status={a.status} />
              </button>
            ))}
          </section>
        </div>
      </motion.aside>
    </>
  );
}

function formFrom(l) {
  return {
    current: l.current || '', desired: l.desired || '',
    power: l.power || '', interest: l.interest || '',
    gapNote: l.gapNote || '', gapBy: l.gapBy || '', remarks: l.remarks || '',
  };
}
