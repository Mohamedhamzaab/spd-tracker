// ---------------------------------------------------------------------------
//  Meetings. The register with an add form whose Primary Sub-Division list
//  is filtered to the chosen authority's sub-divisions only.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, Modal, FormFields, ConfirmDialog, Pill,
  fmtDate, useToast,
} from '../components/ui.jsx';

export default function Meetings() {
  const { lists, isEditor } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [authorities, setAuthorities] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [delRow, setDelRow] = useState(null);

  function load() {
    api.meetings().then(setRows).catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    api.authorities().then(setAuthorities).catch(() => {});
  }, []);

  const filtered = (rows || []).filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (r.authority_name || '').toLowerCase().includes(s) ||
      r.meeting_code.toLowerCase().includes(s) ||
      (r.mom_reference || '').toLowerCase().includes(s) ||
      (r.location || '').toLowerCase().includes(s)
    );
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Meetings</div>
        </div>
        {isEditor && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add Meeting
          </button>
        )}
      </div>
      <div className="page">
        <ErrorBanner message={error} />
        <div className="section-note" style={{ marginBottom: 16 }}>
          Attendees, outcomes and actions live in the Minutes of Meeting. The
          tracker records the meeting and links to the MoM.
        </div>

        <div className="toolbar">
          <input
            className="search"
            placeholder="Search by authority, code, MoM reference or location"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="section-note">
            {filtered.length} of {(rows || []).length}
          </span>
        </div>

        {!rows ? (
          <Loading label="Loading meetings" />
        ) : filtered.length === 0 ? (
          <Empty
            title="No meetings logged"
            sub={isEditor ? 'Add the first one above.' : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Date</th>
                  <th>Authority</th>
                  <th>Primary Sub-Division</th>
                  <th>Purpose</th>
                  <th>Mode</th>
                  <th>MoM</th>
                  {isEditor && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.meeting_code}</td>
                    <td>{fmtDate(m.meeting_date)}</td>
                    <td>
                      <div className="cell-strong">{m.authority_name}</div>
                    </td>
                    <td>
                      {m.primary_sub_reference ? (
                        <>
                          <div className="cell-strong">{m.primary_sub_name}</div>
                          <div className="cell-sub">{m.primary_sub_reference}</div>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{m.purpose ? <Pill tone="grey">{m.purpose}</Pill> : '-'}</td>
                    <td>{m.mode || '-'}</td>
                    <td>
                      {m.mom_link ? (
                        <a href={m.mom_link} target="_blank" rel="noreferrer">
                          {m.mom_reference || 'Open MoM'}
                        </a>
                      ) : (
                        m.mom_reference || '-'
                      )}
                    </td>
                    {isEditor && (
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setEditRow(m)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setDelRow(m)}
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
        <MeetingForm
          lists={lists}
          authorities={authorities}
          onClose={() => setAdding(false)}
          onSaved={(code) => {
            setAdding(false);
            toast('Meeting added: ' + code);
            load();
          }}
        />
      )}
      {editRow && (
        <MeetingForm
          lists={lists}
          authorities={authorities}
          existing={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            setEditRow(null);
            toast('Meeting updated');
            load();
          }}
        />
      )}
      {delRow && (
        <ConfirmDialog
          title="Delete meeting"
          message={`Delete meeting ${delRow.meeting_code}? This cannot be undone.`}
          onClose={() => setDelRow(null)}
          onConfirm={async () => {
            await api.deleteMeeting(delRow.id);
            setDelRow(null);
            toast('Meeting deleted');
            load();
          }}
        />
      )}
    </>
  );
}

function MeetingForm({ lists, authorities, existing, onClose, onSaved }) {
  const editing = !!existing;
  const [values, setValues] = useState(
    editing
      ? {
          authority_id: String(existing.authority_id),
          primary_sub_id: existing.primary_sub_id
            ? String(existing.primary_sub_id)
            : '',
          other_sub_divisions: existing.other_sub_divisions || '',
          meeting_date: (existing.meeting_date || '').slice(0, 10),
          purpose: existing.purpose || '',
          mode: existing.mode || '',
          location: existing.location || '',
          mom_reference: existing.mom_reference || '',
          mom_link: existing.mom_link || '',
        }
      : {
          authority_id: '', primary_sub_id: '', other_sub_divisions: '',
          meeting_date: new Date().toISOString().slice(0, 10),
          purpose: '', mode: '', location: '', mom_reference: '', mom_link: '',
        }
  );
  const [subOptions, setSubOptions] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Dependent dropdown: load this authority's sub-divisions when it changes.
  useEffect(() => {
    if (!values.authority_id) {
      setSubOptions([]);
      return;
    }
    api
      .subDivisions({ authority_id: values.authority_id })
      .then((subs) =>
        setSubOptions(
          subs.map((s) => ({
            value: String(s.id),
            label: `${s.sub_reference} - ${s.name}`,
          }))
        )
      )
      .catch(() => setSubOptions([]));
  }, [values.authority_id]);

  function onChange(name, value) {
    setValues((v) => {
      const next = { ...v, [name]: value };
      // Changing the authority clears a sub-division that no longer belongs.
      if (name === 'authority_id') next.primary_sub_id = '';
      return next;
    });
  }

  const fields = [
    { name: 'authority_id', label: 'Authority', type: 'select', required: true,
      span: 2,
      options: authorities.map((a) => ({
        value: String(a.id),
        label: `${a.code} - ${a.name}`,
      })) },
    { name: 'primary_sub_id', label: 'Primary Sub-Division', type: 'select',
      span: 2, options: subOptions,
      placeholder: values.authority_id
        ? 'Select a sub-division'
        : 'Choose an authority first',
      disabled: !values.authority_id,
      help: "The list shows only the chosen authority's sub-divisions." },
    { name: 'other_sub_divisions', label: 'Other Sub-Divisions Covered', span: 2,
      placeholder: 'Free text, e.g. KM-S02, PWA-S01' },
    { name: 'meeting_date', label: 'Date', type: 'date', required: true },
    { name: 'purpose', label: 'Purpose', type: 'select',
      options: lists.meeting_purpose },
    { name: 'mode', label: 'Mode', type: 'select', options: lists.meeting_mode },
    { name: 'location', label: 'Location' },
    { name: 'mom_reference', label: 'MoM Reference', span: 2 },
    { name: 'mom_link', label: 'MoM Link (ACC)', span: 2,
      placeholder: 'Link to the Minutes of Meeting in ACC' },
  ];

  async function save() {
    setError('');
    if (!values.authority_id) return setError('An authority is required.');
    if (!values.meeting_date) return setError('A date is required.');
    setBusy(true);
    try {
      const payload = {
        ...values,
        authority_id: Number(values.authority_id),
        primary_sub_id: values.primary_sub_id
          ? Number(values.primary_sub_id)
          : null,
      };
      if (editing) {
        await api.updateMeeting(existing.id, payload);
        onSaved(existing.meeting_code);
      } else {
        const created = await api.createMeeting(payload);
        onSaved(created.meeting_code);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={editing ? 'Edit Meeting' : 'Add Meeting'}
      sub={editing ? existing.meeting_code : 'A new entry in the meetings register'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Add meeting'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <FormFields fields={fields} values={values} onChange={onChange} disabled={busy} />
    </Modal>
  );
}
