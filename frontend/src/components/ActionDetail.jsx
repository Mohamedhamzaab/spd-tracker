// ---------------------------------------------------------------------------
//  ActionDetail — one action and everything that has happened to it.
//
//  The timeline is the substance: each entry says what was done and points at
//  the record it happened in. Status is read from that timeline, never set by
//  hand, so the two can never disagree.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Modal, ErrorBanner, Loading, Pill, ConfirmDialog, fmtDate, useToast } from './ui.jsx';
import { StatusPill } from '../pages/Engagement.jsx';
import SourcePicker from './SourcePicker.jsx';
import ActionForm from './ActionForm.jsx';

const KIND_LABEL = {
  progress: 'Progress',
  closure: 'Closed',
  cancellation: 'Cancelled',
  supersession: 'Superseded',
};

// The record an entry points at, rendered as a link into that register.
function SourceLink({ e }) {
  if (e.source_type === 'external') {
    return (
      <span className="src-tag src-tag-ext" title="Evidence held outside the system">
        {e.source_ref_external}
      </span>
    );
  }
  if (e.meeting_code) {
    return <Link className="src-tag" to={`/app/meetings?open=${e.source_id}`}>{e.meeting_code}</Link>;
  }
  if (e.comm_code) {
    return <Link className="src-tag" to={`/app/communications?open=${e.source_id}`}>{e.comm_code}</Link>;
  }
  if (e.qdrs_code) {
    return <Link className="src-tag" to={`/app/qdrs?open=${e.source_id}`}>{e.qdrs_code}</Link>;
  }
  return null;
}

export default function ActionDetail({ id, isEditor, onClose, onChanged, openProgress }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // openProgress lands straight in the progress form, for the inline
  // "Register progress" button on the register accordion.
  const [mode, setMode] = useState(openProgress ? 'progress' : null);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  function load() {
    api.engAction(id).then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, [id]);

  async function remove() {
    try {
      await api.engDeleteAction(id);
      toast('Action deleted');
      onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
      setConfirmDel(false);
    }
  }

  const live = data && !data.resolution;

  return (
    <>
      <Modal
        wide
        title={data ? data.action_code : 'Action'}
        sub={data ? `${data.sub_reference} · ${data.authority_name}` : ''}
        onClose={onClose}
        footer={
          <>
            {isEditor && data && (
              <>
                <button className="btn btn-ghost btn-danger" onClick={() => setConfirmDel(true)}>
                  Delete
                </button>
                <button className="btn" onClick={() => setEditing(true)}>Edit</button>
                <button className="btn" onClick={() => setMode('resolve')}>
                  {data.resolution ? 'Reopen' : 'Cancel / supersede'}
                </button>
                {live && (
                  <>
                    <button className="btn" onClick={() => setMode('closure')}>Close action</button>
                    <button className="btn btn-primary" onClick={() => setMode('progress')}>
                      Add progress
                    </button>
                  </>
                )}
              </>
            )}
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </>
        }
      >
        <ErrorBanner message={error} />
        {!data ? (
          <Loading label="Loading" />
        ) : (
          <>
            <div className="detail-grid">
              <Item label="Status" value={<StatusPill status={data.status} />} />
              <Item label="Raised" value={data.recorded_date ? fmtDate(data.recorded_date) : '—'} />
              <Item
                label="Due"
                value={
                  <>
                    {data.due_date ? fmtDate(data.due_date) : data.due_milestone || '—'}
                    {data.is_overdue && <> <Pill tone="red">Overdue</Pill></>}
                  </>
                }
              />
              <Item
                label="Action by"
                value={data.orgs.length
                  ? data.orgs.map((o) => <Pill key={o.id} tone="grey">{o.name}</Pill>)
                  : '—'}
              />
              <Item label="Priority" value={data.action_priority || '—'} />
              <Item
                label="Raised in"
                value={<SourceLink e={{
                  source_type: data.source_type, source_id: data.source_id,
                  source_ref_external: data.source_ref_external,
                  meeting_code: data.source_type === 'meeting' ? 'Meeting' : null,
                  comm_code: data.source_type === 'communication' ? 'Communication' : null,
                  qdrs_code: data.source_type === 'qdrs' ? 'QDRS' : null,
                }} />}
              />
            </div>

            <div className="detail-item" style={{ marginTop: 14 }}>
              <div className="dl">Action</div>
              <div className="dv" style={{ whiteSpace: 'pre-wrap' }}>{data.description}</div>
            </div>

            {data.notes && (
              <div className="detail-item" style={{ marginTop: 12 }}>
                <div className="dl">Standing note</div>
                <div className="dv" style={{ whiteSpace: 'pre-wrap' }}>{data.notes}</div>
              </div>
            )}

            {data.resolution === 'cancelled' && (
              <div className="info-banner" style={{ marginTop: 14 }}>
                <strong>Cancelled.</strong> {data.cancel_reason}
              </div>
            )}
            {data.resolution === 'superseded' && (
              <div className="info-banner" style={{ marginTop: 14 }}>
                <strong>Superseded</strong> by{' '}
                {data.superseded_by_id ? `action #${data.superseded_by_id}` : data.superseded_ref_external}
              </div>
            )}

            <div style={{ marginTop: 22 }}>
              <div className="section-title" style={{ marginBottom: 4 }}>
                Timeline
              </div>
              <div className="section-note" style={{ marginBottom: 12 }}>
                {data.timeline.length === 0
                  ? 'Nothing registered yet — which is why this reads as Pending.'
                  : 'Newest first. Each entry names the record it happened in.'}
              </div>
              {data.timeline.map((e) => (
                <div key={e.id} className={'tl-entry tl-' + e.kind}>
                  <div className="tl-head">
                    <Pill tone={e.kind === 'closure' ? 'green' : e.kind === 'progress' ? 'navy' : 'grey'}>
                      {KIND_LABEL[e.kind] || e.kind}
                    </Pill>
                    <span className="section-note">{fmtDate(e.entry_date)}</span>
                    <SourceLink e={e} />
                    {e.created_by_name && <span className="cell-sub">· {e.created_by_name}</span>}
                    {isEditor && (
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ marginLeft: 'auto' }}
                        onClick={async () => {
                          try {
                            await api.engDeleteProgress(e.id);
                            toast('Entry removed');
                            load();
                            onChanged();
                          } catch (err) { setError(err.message); }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="tl-note">{e.note}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>

      {mode === 'progress' || mode === 'closure' ? (
        <ProgressForm
          actionId={id}
          kind={mode}
          onClose={() => setMode(null)}
          onSaved={() => {
            setMode(null);
            toast(mode === 'closure' ? 'Action closed' : 'Progress registered');
            load();
            onChanged();
          }}
        />
      ) : null}

      {mode === 'resolve' && data && (
        <ResolveForm
          action={data}
          onClose={() => setMode(null)}
          onSaved={() => { setMode(null); load(); onChanged(); }}
        />
      )}

      {editing && data && (
        <ActionForm
          existing={data}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); toast('Action updated'); load(); onChanged(); }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          title="Delete action"
          message="This removes the action and its whole timeline from the register."
          confirmLabel="Delete"
          onClose={() => setConfirmDel(false)}
          onConfirm={remove}
        />
      )}
    </>
  );
}

function Item({ label, value }) {
  return (
    <div className="detail-item">
      <div className="dl">{label}</div>
      <div className="dv">{value}</div>
    </div>
  );
}

/* ---- register progress, or close ---------------------------------------- */
function ProgressForm({ actionId, kind, onClose, onSaved }) {
  const closing = kind === 'closure';
  const [v, setV] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    note: '',
    source_type: '', source_id: null, source_ref_external: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setError('');
    if (!v.note.trim()) return setError(closing ? 'Say how it was closed.' : 'Say what was done.');
    if (closing && !v.source_type) return setError('Closing needs the record that closed it.');
    setBusy(true);
    try {
      await api.engAddProgress(actionId, { ...v, kind });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={closing ? 'Close this action' : 'Register progress'}
      sub={closing
        ? 'Closing always cites the record that closed it'
        : 'Anything real — a call, a meeting, a letter sent'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : closing ? 'Close action' : 'Register progress'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <div className="form-grid">
        <div className="field">
          <label className="field-label">Date<span className="req">*</span></label>
          <input type="date" className="input" value={v.entry_date} disabled={busy}
                 onChange={(e) => setV((s) => ({ ...s, entry_date: e.target.value }))} />
        </div>
      </div>
      <div className="field">
        <label className="field-label">
          {closing ? 'How was it closed?' : 'What was done?'}<span className="req">*</span>
        </label>
        <textarea
          className="textarea"
          value={v.note}
          disabled={busy}
          placeholder={closing
            ? 'e.g. Non-objection received and filed'
            : 'e.g. Called KAHRAMAA planning; they confirmed the application is logged'}
          onChange={(e) => setV((s) => ({ ...s, note: e.target.value }))}
        />
      </div>
      <div className="form-section">
        <div className="section-title">
          Where it happened{closing && <span className="req">*</span>}
        </div>
        <div className="section-note" style={{ marginBottom: 10 }}>
          {closing
            ? 'Pick the meeting, communication or QDRS record that closed this.'
            : 'Optional for progress, but linking the record is what makes it verifiable.'}
        </div>
        <SourcePicker
          value={v}
          disabled={busy}
          onChange={(patch) => setV((s) => ({ ...s, ...patch }))}
        />
      </div>
    </Modal>
  );
}

/* ---- cancel / supersede / reopen ---------------------------------------- */
function ResolveForm({ action, onClose, onSaved }) {
  const [choice, setChoice] = useState(action.resolution || 'cancelled');
  const [reason, setReason] = useState(action.cancel_reason || '');
  const [ref, setRef] = useState(action.superseded_ref_external || '');
  const [byId, setById] = useState(action.superseded_by_id || '');
  const [options, setOptions] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.engActions({ sub_division_id: action.sub_division_id })
      .then((r) => setOptions(r.filter((a) => a.id !== action.id)))
      .catch(() => {});
  }, [action.id]);

  async function save(resolution) {
    setError('');
    setBusy(true);
    try {
      await api.engResolve(action.id, {
        resolution,
        cancel_reason: reason,
        superseded_by_id: byId || null,
        superseded_ref_external: ref,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={action.resolution ? 'Reopen this action' : 'Cancel or supersede'}
      sub={action.action_code}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          {action.resolution ? (
            <button className="btn btn-primary" onClick={() => save(null)} disabled={busy}>
              {busy ? 'Saving…' : 'Reopen'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => save(choice)} disabled={busy}>
              {busy ? 'Saving…' : choice === 'cancelled' ? 'Cancel action' : 'Mark superseded'}
            </button>
          )}
        </>
      }
    >
      <ErrorBanner message={error} />
      {action.resolution ? (
        <p className="section-note">
          This puts the action back into the register. Its status returns to whatever
          its timeline says.
        </p>
      ) : (
        <>
          <div className="filter-bar" style={{ marginBottom: 14 }}>
            {[['cancelled', 'Cancel'], ['superseded', 'Superseded by another item']].map(([k, l]) => (
              <button key={k} type="button"
                className={'chip ' + (choice === k ? 'chip-on' : '')}
                onClick={() => setChoice(k)}>{l}</button>
            ))}
          </div>

          {choice === 'cancelled' ? (
            <div className="field">
              <label className="field-label">Why is it cancelled?<span className="req">*</span></label>
              <textarea className="textarea" value={reason} disabled={busy}
                        placeholder="e.g. Scope removed from Stage 2"
                        onChange={(e) => setReason(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="field">
                <label className="field-label">Replaced by</label>
                <select className="select" value={byId} disabled={busy}
                        onChange={(e) => setById(e.target.value)}>
                  <option value="">Choose an action…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.action_code} — {o.description.slice(0, 60)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">or a reference</label>
                <input className="input" value={ref} disabled={busy}
                       placeholder="Item or document number outside this register"
                       onChange={(e) => setRef(e.target.value)} />
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
