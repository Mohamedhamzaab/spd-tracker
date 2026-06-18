// ---------------------------------------------------------------------------
//  QDRS — the Qatar Design Review System (Ashghal / PWA) received-data log.
//  One row per "data received" event, linked to the sub-authority it came
//  from, with the uploaded documents. Editors create/edit/delete; reviewers
//  read-only (open a record to view it).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, Modal, FormFields, ConfirmDialog, Pill,
  fmtDate, fileSize, useToast, useTableSort, SortableTH, FileDrop,
} from '../components/ui.jsx';
import DocViewer, { isPreviewable } from '../components/DocViewer.jsx';
import { useLive } from '../lib/liveStream.js';

const QDRS_LIVE_EVENTS = [
  'data.qdrs.created', 'data.qdrs.updated', 'data.qdrs.deleted',
];

function useDebouncedValue(value, ms) {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer.current);
  }, [value, ms]);
  return debounced;
}

const QDRS_COLS = {
  qdrs_code:      { value: (r) => r.qdrs_code },
  qdrs_date:      { value: (r) => r.qdrs_date, type: 'date', defaultDir: 'desc' },
  sub_reference:  { value: (r) => r.sub_reference || '' },
  authority_code: { value: (r) => r.authority_code || '' },
  category:       { value: (r) => r.category || '' },
  reference:      { value: (r) => r.reference || '' },
};

// --- documents panel (view / download / remove / download-all) -------------
function QdrsDocs({ recordId, code }) {
  const { isEditor } = useStore();
  const toast = useToast();
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [zipping, setZipping] = useState(false);

  function load() {
    api.qdrsRecord(recordId)
      .then((r) => setDocs(r.documents || []))
      .catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [recordId]);

  async function upload(files) {
    if (!files || !files.length) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadDocs('qdrs', recordId, files);
      toast(files.length > 1 ? 'Documents uploaded' : 'Document uploaded');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  async function removeDoc(docId) {
    try {
      await api.deleteDoc(docId);
      toast('Document removed');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!docs) return <Loading label="Loading documents" />;

  return (
    <div>
      <ErrorBanner message={error} />
      {docs.length >= 2 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button
            className="btn btn-sm"
            disabled={zipping}
            onClick={async () => {
              setZipping(true);
              setError('');
              try {
                await api.downloadDocsZip('qdrs', recordId, `${code || 'qdrs'}-documents.zip`);
              } catch (e) {
                setError(e.message);
              } finally {
                setZipping(false);
              }
            }}
          >
            {zipping ? 'Preparing…' : 'Download all'}
          </button>
        </div>
      )}
      {docs.length === 0 && (
        <div className="section-note" style={{ marginBottom: 10 }}>
          No documents attached yet.
        </div>
      )}
      {docs.map((d) => (
        <div className="doc-chip" key={d.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="doc-name">{d.original_name}</div>
            <div className="doc-meta">
              {fileSize(d.size_bytes)}
              {d.uploaded_by ? ' · ' + d.uploaded_by : ''}
            </div>
          </div>
          {isPreviewable(d) && (
            <button className="btn btn-sm" onClick={() => setViewerDoc(d)}>View</button>
          )}
          <button className="btn btn-sm" onClick={() => api.downloadDoc(d.id, d.original_name)}>
            Download
          </button>
          {isEditor && (
            <button className="btn btn-sm btn-ghost" onClick={() => removeDoc(d.id)}>
              Remove
            </button>
          )}
        </div>
      ))}
      {isEditor && (
        <div style={{ marginTop: 10 }}>
          <FileDrop onFiles={upload} uploading={uploading} />
        </div>
      )}
      {viewerDoc && <DocViewer doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </div>
  );
}

// --- read-only detail (any user) -------------------------------------------
function QdrsDetail({ record, isEditor, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.qdrsRecord(record.id).then(setData).catch((e) => setError(e.message));
  }, [record.id]);

  return (
    <Modal
      wide
      title={data ? data.qdrs_code : record.qdrs_code}
      sub={data ? `${data.sub_reference} · ${data.authority_name}` : ''}
      onClose={onClose}
      footer={
        <>
          {isEditor && <button className="btn" onClick={onEdit}>Edit</button>}
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
            <Item label="Sub-Authority" value={`${data.sub_reference} — ${data.sub_division_name}`} />
            <Item label="Authority" value={`${data.authority_code} — ${data.authority_name}`} />
            <Item label="Date Received" value={fmtDate(data.qdrs_date)} />
            <Item label="Category" value={data.category || '—'} />
            <Item label="QDRS Reference" value={data.reference || '—'} />
          </div>
          {data.summary && (
            <div style={{ marginTop: 14 }}>
              <div className="dl">Summary / Key Content</div>
              <div className="dv" style={{ whiteSpace: 'pre-wrap' }}>{data.summary}</div>
            </div>
          )}
          <div style={{ marginTop: 22 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Documents</div>
            <QdrsDocs recordId={record.id} code={data.qdrs_code} />
          </div>
        </>
      )}
    </Modal>
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

// --- add / edit form -------------------------------------------------------
export function QdrsForm({ lists, subDivisions, existing, defaults, onClose, onSaved }) {
  const editing = !!existing;
  const [values, setValues] = useState(
    editing
      ? {
          sub_division_id: String(existing.sub_division_id),
          qdrs_date: (existing.qdrs_date || '').slice(0, 10),
          category: existing.category || '',
          reference: existing.reference || '',
          summary: existing.summary || '',
        }
      : {
          sub_division_id: '',
          qdrs_date: new Date().toISOString().slice(0, 10),
          category: '', reference: '', summary: '',
          ...(defaults || {}),
        }
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [createdId, setCreatedId] = useState(null);
  const [createdCode, setCreatedCode] = useState(null);
  const onChange = (n, v) => setValues((s) => ({ ...s, [n]: v }));

  const subOptions = (subDivisions || []).map((s) => ({
    value: String(s.id),
    label: `${s.sub_reference} — ${s.name}`,
  }));

  const fields = [
    { name: 'sub_division_id', label: 'Sub-Authority (Sub-Division)', type: 'select',
      required: true, span: 2, options: subOptions,
      help: 'Which sub-authority the data was received from, via QDRS.' },
    { name: 'qdrs_date', label: 'Date Received', type: 'date', required: true },
    { name: 'category', label: 'Category', type: 'select', options: lists.qdrs_category },
    { name: 'reference', label: 'QDRS Reference', span: 2,
      placeholder: 'e.g. QDRS portal reference / transaction no.' },
    { name: 'summary', label: 'Summary / Key Content', type: 'textarea', span: 2 },
  ];

  async function save() {
    setError('');
    if (!values.sub_division_id) return setError('A sub-authority is required.');
    if (!values.qdrs_date) return setError('A date is required.');
    setBusy(true);
    try {
      if (editing) {
        await api.updateQdrs(existing.id, values);
        onSaved(existing.qdrs_code);
        return;
      }
      let id = createdId;
      let code = createdCode;
      if (!id) {
        const created = await api.createQdrs(values);
        id = created.id;
        code = created.qdrs_code;
        setCreatedId(id);
        setCreatedCode(code);
      }
      if (pendingFiles.length) {
        await api.uploadDocs('qdrs', id, pendingFiles);
      }
      onSaved(code);
    } catch (e) {
      setError(
        createdId
          ? 'Saved, but the documents failed to upload. Click again to retry, or attach them later by opening the record. (' + e.message + ')'
          : e.message
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={editing ? 'Edit QDRS Record' : 'Log QDRS Record'}
      sub="One row per data-received event"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Log record'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <FormFields fields={fields} values={values} onChange={onChange} disabled={busy} />

      {editing ? (
        <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <div className="section-title" style={{ marginBottom: 10 }}>Documents</div>
          <QdrsDocs recordId={existing.id} code={existing.qdrs_code} />
        </div>
      ) : (
        <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <div className="section-title" style={{ marginBottom: 10 }}>Documents</div>
          {pendingFiles.length === 0 && (
            <div className="section-note" style={{ marginBottom: 10 }}>
              Attach the received files now — they upload when you click “Log record”.
            </div>
          )}
          {pendingFiles.map((f, i) => (
            <div className="doc-chip" key={i}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="doc-name">{f.name}</div>
                <div className="doc-meta">{fileSize(f.size)}</div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => setPendingFiles((fs) => fs.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <FileDrop
              label="+ Add document"
              hint="or drag & drop files here — they upload when you save"
              uploading={busy}
              onFiles={(files) => setPendingFiles((fs) => [...fs, ...Array.from(files)])}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

// --- list page -------------------------------------------------------------
export default function Qdrs() {
  const { lists, isEditor } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [authorities, setAuthorities] = useState([]);
  const [subDivisions, setSubDivisions] = useState([]);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [authorityId, setAuthorityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [adding, setAdding] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [delRow, setDelRow] = useState(null);
  const [openRow, setOpenRow] = useState(null);

  const qDebounced = useDebouncedValue(q, 250);
  useEffect(() => {
    api.authorities().then(setAuthorities).catch(() => {});
    api.subDivisions().then(setSubDivisions).catch(() => {});
  }, []);

  const params = useMemo(() => {
    const p = {};
    if (qDebounced) p.q = qDebounced;
    if (authorityId) p.authority_id = authorityId;
    if (from) p.from = from;
    if (to) p.to = to;
    return p;
  }, [qDebounced, authorityId, from, to]);

  function load(p) {
    api.qdrsList(p).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(() => { setError(''); load(params); }, [params]);
  useLive(QDRS_LIVE_EVENTS, () => load(params));

  // Deep-link ?open=<id> (e.g. from a sub-division panel).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !rows) return;
    const o = new URLSearchParams(window.location.search).get('open');
    if (!o || !/^\d+$/.test(o)) return;
    const row = rows.find((r) => r.id === Number(o));
    if (row) { setOpenRow(row); autoOpenedRef.current = true; }
  }, [rows]);

  function clearFilters() { setQ(''); setAuthorityId(''); setFrom(''); setTo(''); }
  const filtersActive = !!(q || authorityId || from || to);

  const { sorted, sortKey, sortDir, onSort } = useTableSort(rows || [], QDRS_COLS, {
    defaultKey: 'qdrs_date', defaultDir: 'asc',
  });

  async function remove() {
    try {
      await api.deleteQdrs(delRow.id);
      toast('QDRS record deleted.');
      setDelRow(null);
      load(params);
    } catch (e) {
      toast(e.message || 'Delete failed.');
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">QDRS</div>
        </div>
        {isEditor && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Log QDRS
          </button>
        )}
      </div>

      <div className="page stack-lg">
        <ErrorBanner message={error} />

        <div className="filter-bar">
          <input
            className="search"
            placeholder="Search by code, reference, sub-division or authority"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="filter-select" value={authorityId} onChange={(e) => setAuthorityId(e.target.value)}>
            <option value="">All authorities</option>
            {authorities.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
          <div className="filter-date-pair">
            <input className="filter-select" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className="filter-date-sep">→</span>
            <input className="filter-select" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
          {filtersActive && (
            <button className="btn btn-ghost" onClick={clearFilters} style={{ marginLeft: 'auto' }}>Clear</button>
          )}
        </div>

        {!rows ? (
          <Loading label="Loading QDRS records" />
        ) : sorted.length === 0 ? (
          <Empty
            title="No QDRS records"
            sub={isEditor ? 'Log the first received-data entry.' : undefined}
          />
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortableTH id="qdrs_code" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Code</SortableTH>
                    <SortableTH id="qdrs_date" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Date Received</SortableTH>
                    <SortableTH id="sub_reference" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Sub-Authority</SortableTH>
                    <SortableTH id="authority_code" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Authority</SortableTH>
                    <SortableTH id="category" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Category</SortableTH>
                    <SortableTH id="reference" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Reference</SortableTH>
                    <th>Docs</th>
                    {isEditor && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => setOpenRow(r)}>
                      <td className="mono">{r.qdrs_code}</td>
                      <td>{fmtDate(r.qdrs_date)}</td>
                      <td>
                        <div className="cell-strong">{r.sub_reference}</div>
                        <div className="cell-sub">{r.sub_division_name}</div>
                      </td>
                      <td>{r.authority_code}</td>
                      <td>{r.category ? <Pill tone="grey">{r.category}</Pill> : '—'}</td>
                      <td>{r.reference || '—'}</td>
                      <td>{Number(r.document_count) > 0 ? r.document_count : '—'}</td>
                      {isEditor && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-sm btn-ghost" onClick={() => setEditRow(r)}>Edit</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setDelRow(r)}>Delete</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {adding && (
        <QdrsForm
          lists={lists}
          subDivisions={subDivisions}
          onClose={() => setAdding(false)}
          onSaved={(code) => { setAdding(false); toast('QDRS record logged: ' + code); load(params); }}
        />
      )}
      {editRow && (
        <QdrsForm
          lists={lists}
          subDivisions={subDivisions}
          existing={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => { setEditRow(null); toast('QDRS record updated'); load(params); }}
        />
      )}
      {openRow && (
        <QdrsDetail
          record={openRow}
          isEditor={isEditor}
          onClose={() => setOpenRow(null)}
          onEdit={() => { setEditRow(openRow); setOpenRow(null); }}
        />
      )}
      {delRow && (
        <ConfirmDialog
          title="Delete QDRS record"
          message={`Move ${delRow.qdrs_code} to Trash? Remaining codes re-order by date automatically. You can restore from Trash later.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setDelRow(null)}
        />
      )}
    </>
  );
}
