// ---------------------------------------------------------------------------
//  ActionForm — raise an action, or edit one.
//
//  An action always belongs to a stakeholder already in the register, and
//  always names where it came from, so both are required before it will save.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal, ErrorBanner } from './ui.jsx';
import SourcePicker from './SourcePicker.jsx';

export default function ActionForm({ existing, defaults, onClose, onSaved }) {
  const editing = !!existing;
  const [subs, setSubs] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [v, setV] = useState(() => ({
    sub_division_id: String(existing?.sub_division_id || defaults?.sub_division_id || ''),
    description: existing?.description || '',
    recorded_date: (existing?.recorded_date || new Date().toISOString().slice(0, 10)).slice(0, 10),
    due_milestone: existing?.due_milestone || '',
    due_date: (existing?.due_date || '').slice(0, 10),
    notes: existing?.notes || '',
    org_ids: (existing?.orgs || []).map((o) => o.id),
    source_type: existing?.source_type || '',
    source_id: existing?.source_id || null,
    source_ref_external: existing?.source_ref_external || '',
  }));
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));

  useEffect(() => {
    api.subDivisions().then(setSubs).catch(() => {});
    api.engOrgs().then((d) => { setOrgs(d.orgs); setMilestones(d.milestones); }).catch(() => {});
  }, []);

  function toggleOrg(id) {
    setV((s) => ({
      ...s,
      org_ids: s.org_ids.includes(id) ? s.org_ids.filter((x) => x !== id) : [...s.org_ids, id],
    }));
  }

  async function save() {
    setError('');
    if (!v.sub_division_id) return setError('Choose the stakeholder this action belongs to.');
    if (!v.description.trim()) return setError('Describe the action.');
    if (!v.recorded_date) return setError('A date is required.');
    if (!v.source_type) return setError('Choose where this came from.');
    setBusy(true);
    try {
      const body = {
        ...v,
        sub_division_id: Number(v.sub_division_id),
        due_date: v.due_date || null,
        due_milestone: v.due_milestone || null,
      };
      const saved = editing
        ? await api.engUpdateAction(existing.id, body)
        : await api.engCreateAction(body);
      onSaved(saved.action_code);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={editing ? 'Edit action' : 'Raise an action'}
      sub={editing ? existing.action_code : 'It belongs to one stakeholder and comes from one source'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Raise action'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />

      <div className="form-grid">
        <div className="field col-2">
          <label className="field-label">Stakeholder<span className="req">*</span></label>
          <select
            className="select"
            value={v.sub_division_id}
            disabled={busy || editing}
            onChange={(e) => set('sub_division_id', e.target.value)}
          >
            <option value="">Choose a stakeholder…</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sub_reference} — {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field col-2">
          <label className="field-label">Action<span className="req">*</span></label>
          <textarea
            className="textarea"
            value={v.description}
            disabled={busy}
            placeholder="What has to happen, and by whom"
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div className="field">
          <label className="field-label">Date raised<span className="req">*</span></label>
          <input type="date" className="input" value={v.recorded_date} disabled={busy}
                 onChange={(e) => set('recorded_date', e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">Due date</label>
          <input type="date" className="input" value={v.due_date} disabled={busy}
                 onChange={(e) => set('due_date', e.target.value)} />
        </div>
        <div className="field col-2">
          <label className="field-label">Milestone</label>
          <select className="select" value={v.due_milestone} disabled={busy}
                  onChange={(e) => set('due_milestone', e.target.value)}>
            <option value="">No milestone</option>
            {milestones.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="field-help">
            Use a milestone when it depends on a stage rather than a date. Both can be set.
          </div>
        </div>
      </div>

      <div className="form-section">
        <div className="section-title">Action by</div>
        <div className="org-tags">
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={busy}
              className={'chip ' + (v.org_ids.includes(o.id) ? 'chip-on' : '')}
              onClick={() => toggleOrg(o.id)}
            >
              {o.name}
            </button>
          ))}
        </div>
      </div>

      <div className="form-section">
        <div className="section-title">Where it came from<span className="req">*</span></div>
        <div className="section-note" style={{ marginBottom: 10 }}>
          Pick the meeting, communication or QDRS record where this was raised.
        </div>
        <SourcePicker
          value={v}
          disabled={busy}
          onChange={(patch) => setV((s) => ({ ...s, ...patch }))}
        />
      </div>

      <div className="form-section">
        <div className="field">
          <label className="field-label">Standing note</label>
          <textarea
            className="textarea"
            value={v.notes}
            disabled={busy}
            placeholder="Context that isn’t progress — why it is waiting, what it depends on"
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
