// ---------------------------------------------------------------------------
//  Authorities. The parent register with a Quick-Add panel, search, and
//  row click-through to the authority drill-down.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, Modal, FormFields, ConfirmDialog, useToast,
  useTableSort, SortableTH,
} from '../components/ui.jsx';

const AUTH_COLS = {
  code:                 { value: (r) => r.code },
  name:                 { value: (r) => r.name },
  category:             { value: (r) => r.category || '' },
  influence_level:      { value: (r) => r.influence_level || '' },
  sub_division_count:   { value: (r) => r.sub_division_count, type: 'number' },
  sub_divisions_engaged:{ value: (r) => r.sub_divisions_engaged, type: 'number' },
  outcome_secured_count:{ value: (r) => r.outcome_secured_count, type: 'number' },
};

export default function Authorities() {
  const { lists, isEditor } = useStore();
  const toast = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [delRow, setDelRow] = useState(null);

  function load() {
    api.authorities().then(setRows).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const filtered = (rows || []).filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      r.name.toLowerCase().includes(s) ||
      r.code.toLowerCase().includes(s) ||
      (r.category || '').toLowerCase().includes(s)
    );
  });

  const { sorted, sortKey, sortDir, onSort } = useTableSort(filtered, AUTH_COLS, {
    defaultKey: 'code',
    defaultDir: 'asc',
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Authorities</div>
        </div>
        {isEditor && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add Authority
          </button>
        )}
      </div>
      <div className="page">
        <ErrorBanner message={error} />

        {isEditor && (
          <div className="quickadd">
            <div className="quickadd-text">
              <strong>Quick add.</strong> Add a new authority to the register. A
              short code is suggested from the name and can be adjusted.
            </div>
            <button className="btn" onClick={() => setAdding(true)}>
              + Add Authority
            </button>
          </div>
        )}

        <div className="toolbar">
          <input
            className="search"
            placeholder="Search authorities by name, code or category"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="section-note">
            {filtered.length} of {(rows || []).length}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => api.downloadExport('/exports/authorities.xlsx', 'authorities.xlsx')}
            title="Download all authorities as .xlsx"
          >
            Export
          </button>
        </div>

        {!rows ? (
          <Loading label="Loading authorities" />
        ) : filtered.length === 0 ? (
          <Empty title="No authorities found" sub="Adjust the search or add one." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortableTH id="code"                 sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Code</SortableTH>
                  <SortableTH id="name"                 sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Authority</SortableTH>
                  <SortableTH id="category"             sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Category</SortableTH>
                  <SortableTH id="influence_level"      sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Influence</SortableTH>
                  <SortableTH id="sub_division_count"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="num">Sub-Divisions</SortableTH>
                  <SortableTH id="sub_divisions_engaged" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="num">Engaged</SortableTH>
                  <SortableTH id="outcome_secured_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="num">Outcome</SortableTH>
                  {isEditor && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.id}
                    className="clickable"
                    onClick={() => navigate('/app/authorities/' + r.id)}
                  >
                    <td className="mono">{r.code}</td>
                    <td>
                      <div className="cell-strong">{r.name}</div>
                      {r.decision_authority && (
                        <div className="cell-sub">{r.decision_authority}</div>
                      )}
                    </td>
                    <td>{r.category}</td>
                    <td>{r.influence_level || '-'}</td>
                    <td className="num">{r.sub_division_count}</td>
                    <td className="num">{r.sub_divisions_engaged}</td>
                    <td className="num">{r.outcome_secured_count}</td>
                    {isEditor && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setEditRow(r)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setDelRow(r)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && (
        <AuthorityForm
          lists={lists}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            toast('Authority added');
            load();
          }}
        />
      )}
      {editRow && (
        <AuthorityForm
          lists={lists}
          existing={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            setEditRow(null);
            toast('Authority updated');
            load();
          }}
        />
      )}
      {delRow && (
        <ConfirmDialog
          title="Delete authority"
          message={`Delete "${delRow.name}"? This also removes its sub-divisions, communications and meetings. This cannot be undone.`}
          onClose={() => setDelRow(null)}
          onConfirm={async () => {
            await api.deleteAuthority(delRow.id);
            setDelRow(null);
            toast('Authority deleted');
            load();
          }}
        />
      )}
    </>
  );
}

export function AuthorityForm({ lists, existing, onClose, onSaved }) {
  const editing = !!existing;
  const [values, setValues] = useState(
    editing
      ? {
          code: existing.code,
          name: existing.name,
          category: existing.category,
          influence_level: existing.influence_level || '',
          decision_authority: existing.decision_authority || '',
          engagement_strategy: existing.engagement_strategy || '',
          notes: existing.notes || '',
        }
      : {
          code: '', name: '', category: '', influence_level: '',
          decision_authority: '', engagement_strategy: '', notes: '',
        }
  );
  const [codeTouched, setCodeTouched] = useState(editing);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function onChange(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
    if (name === 'code') setCodeTouched(true);
    // Suggest a code from the name until the user edits the code field.
    if (name === 'name' && !codeTouched && !editing) {
      api
        .suggestCode(value)
        .then((r) => setValues((v) => ({ ...v, code: r.code })))
        .catch(() => {});
    }
  }

  const fields = [
    { name: 'name', label: 'Authority Name', required: true, span: 2,
      placeholder: 'e.g. Qatar Civil Aviation Authority (QCAA)' },
    { name: 'code', label: 'Code', required: true,
      help: 'Suggested from the name. Adjust if needed.' },
    { name: 'category', label: 'Category', type: 'select', required: true,
      options: lists.authority_category },
    { name: 'influence_level', label: 'Influence Level', type: 'select',
      options: lists.influence_level },
    { name: 'decision_authority', label: 'Decision Authority', type: 'select',
      options: lists.decision_authority },
    { name: 'engagement_strategy', label: 'Engagement Strategy', type: 'select',
      options: lists.engagement_strategy },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];

  async function save() {
    setError('');
    if (!values.name.trim()) return setError('An authority name is required.');
    if (!values.category) return setError('A category is required.');
    setBusy(true);
    try {
      if (editing) await api.updateAuthority(existing.id, values);
      else await api.createAuthority(values);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? 'Edit Authority' : 'Add Authority'}
      sub={editing ? existing.code : 'A new entry in the parent register'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Add authority'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <FormFields fields={fields} values={values} onChange={onChange} disabled={busy} />
    </Modal>
  );
}
