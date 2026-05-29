// ---------------------------------------------------------------------------
//  ViewsBar — saved-views row at the top of a list page.
//  Props:
//    target          'communications' | 'sub_divisions' | 'meetings'
//    currentParams   object of the active filter set
//    onApply(params) called when the user picks a saved view
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal, ErrorBanner, useToast } from './ui.jsx';

export default function ViewsBar({ target, currentParams, onApply }) {
  const toast = useToast();
  const [views, setViews] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [savingNew, setSavingNew] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapped, setBootstrapped] = useState(false);

  async function reload() {
    try {
      const r = await api.views(target);
      setViews(r.views || []);
      return r.views || [];
    } catch (e) {
      setError(e.message || 'Could not load saved views.');
      return [];
    }
  }

  // On first mount, load views and, if the user has a default, apply it once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const vs = await reload();
      if (cancelled || bootstrapped) return;
      const def = vs.find((v) => v.is_default);
      if (def) {
        setActiveId(def.id);
        onApply(def.params || {});
      }
      setBootstrapped(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  function applyView(v) {
    setActiveId(v.id);
    onApply(v.params || {});
  }

  async function saveCurrent({ name, makeDefault }) {
    setError('');
    try {
      await api.createView({
        target,
        name,
        params: currentParams || {},
        is_default: !!makeDefault,
      });
      toast(`View "${name}" saved.`);
      await reload();
      setSavingNew(false);
    } catch (e) {
      throw new Error(e.message || 'Could not save the view.');
    }
  }

  async function rename(view) {
    const next = window.prompt('Rename view', view.name);
    if (!next || next.trim() === view.name) return;
    try {
      await api.updateView(view.id, { name: next.trim() });
      toast('Renamed.');
      reload();
    } catch (e) { setError(e.message || 'Rename failed.'); }
  }

  async function setDefault(view) {
    try {
      await api.updateView(view.id, { is_default: true });
      toast(`"${view.name}" is your default.`);
      reload();
    } catch (e) { setError(e.message || 'Could not set default.'); }
  }

  async function unsetDefault(view) {
    try {
      await api.updateView(view.id, { is_default: false });
      reload();
    } catch (e) { setError(e.message || 'Could not unset default.'); }
  }

  async function remove(view) {
    if (!window.confirm(`Delete view "${view.name}"?`)) return;
    try {
      await api.deleteView(view.id);
      toast('Deleted.');
      if (activeId === view.id) setActiveId(null);
      reload();
    } catch (e) { setError(e.message || 'Delete failed.'); }
  }

  async function overwrite(view) {
    if (!window.confirm(`Replace "${view.name}" filters with the current set?`)) return;
    try {
      await api.updateView(view.id, { params: currentParams || {} });
      toast('Filters saved into ' + view.name + '.');
      reload();
    } catch (e) { setError(e.message || 'Update failed.'); }
  }

  return (
    <>
      <ErrorBanner message={error} />
      <div className="views-bar">
        <span className="views-label">Views:</span>
        {views.length === 0 && (
          <span className="cell-sub">no saved views yet</span>
        )}
        {views.map((v) => (
          <div
            key={v.id}
            className={'view-chip' + (activeId === v.id ? ' view-chip-active' : '')}
          >
            <button
              type="button"
              className="view-chip-name"
              onClick={() => applyView(v)}
              title={v.is_default ? 'Default view' : 'Apply this view'}
            >
              {v.is_default ? '★ ' : ''}{v.name}
            </button>
            <div className="view-chip-menu">
              <button type="button" onClick={() => overwrite(v)} title="Save current filters into this view">
                Overwrite
              </button>
              <button type="button" onClick={() => rename(v)} title="Rename">Rename</button>
              {v.is_default ? (
                <button type="button" onClick={() => unsetDefault(v)} title="Unset as default">★ Unset</button>
              ) : (
                <button type="button" onClick={() => setDefault(v)} title="Use as default">★ Default</button>
              )}
              <button type="button" onClick={() => remove(v)} title="Delete">Delete</button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost views-save"
          onClick={() => setSavingNew(true)}
          title="Save the current filter set as a new view"
        >
          + Save view
        </button>
      </div>

      {savingNew && (
        <SaveViewModal
          onClose={() => setSavingNew(false)}
          onSubmit={saveCurrent}
        />
      )}
    </>
  );
}

function SaveViewModal({ onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setErr('Give the view a name.'); return; }
    setErr(''); setBusy(true);
    try {
      await onSubmit({ name: name.trim(), makeDefault });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Save view"
      sub="Names the current filter set so you can apply it later."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save view'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        <ErrorBanner message={err} />
        <div className="field">
          <label className="field-label">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "My overdue items"'
            required
          />
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
          />
          <span>Make this my default view on this page</span>
        </label>
      </form>
    </Modal>
  );
}
