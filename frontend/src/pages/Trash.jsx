// ---------------------------------------------------------------------------
//  Trash — super-admin view of soft-deleted records, grouped by entity.
//  Restore brings back the record plus everything in the same delete group.
//  Purge is permanent and cascades via the database's foreign keys.
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import {
  Section, Loading, Empty, ErrorBanner, ConfirmDialog, useToast, fmtDate,
} from '../components/ui.jsx';

function fmtTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${fmtDate(value)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SECTIONS = [
  {
    key: 'authorities',
    type: 'authority',
    title: 'Authorities',
    columns: ['Code', 'Name'],
    cells: (r) => [r.code, r.name],
  },
  {
    key: 'sub_divisions',
    type: 'sub_division',
    title: 'Sub-divisions',
    columns: ['Reference', 'Name', 'Authority'],
    cells: (r) => [r.sub_reference, r.name, r.authority_code],
  },
  {
    key: 'communications',
    type: 'communication',
    title: 'Communications',
    columns: ['Code', 'Direction', 'Date', 'Sub-division'],
    cells: (r) => [r.comm_code, r.direction, fmtDate(r.comm_date), r.sub_reference],
  },
  {
    key: 'meetings',
    type: 'meeting',
    title: 'Meetings',
    columns: ['Code', 'Date', 'Authority'],
    cells: (r) => [r.meeting_code, fmtDate(r.meeting_date), r.authority_code],
  },
  {
    key: 'qdrs',
    type: 'qdrs',
    title: 'QDRS',
    columns: ['Code', 'Date', 'Sub-division'],
    cells: (r) => [r.qdrs_code, fmtDate(r.qdrs_date), r.sub_reference],
  },
  {
    key: 'documents',
    type: 'document',
    title: 'Documents',
    columns: ['Name', 'Attached to'],
    cells: (r) => [r.original_name, `${r.parent_type}:${r.parent_id}`],
  },
];

export default function Trash() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [purging, setPurging] = useState(null);

  const reload = useCallback(async () => {
    setError('');
    try {
      const d = await api.trash();
      setData(d);
    } catch (e) {
      setError(e.message || 'Failed to load Trash.');
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function onRestore(type, id) {
    try {
      const r = await api.restore(type, id);
      toast(`Restored ${r.rows_restored} record${r.rows_restored === 1 ? '' : 's'}.`);
      reload();
    } catch (e) {
      setError(e.message || 'Restore failed.');
    }
  }

  async function onPurge(type, id) {
    try {
      await api.purge(type, id);
      toast('Permanently deleted.');
      setPurging(null);
      reload();
    } catch (e) {
      setError(e.message || 'Purge failed.');
      setPurging(null);
    }
  }

  if (!data && !error) return <Loading label="Loading Trash" />;

  const total = data?.total || 0;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Administration</div>
          <div className="page-title">Trash</div>
        </div>
      </div>

      <div className="page stack-lg">
        <ErrorBanner message={error} />

        <div className="info-banner">
          Records here have been deleted but not destroyed. <strong>Restore</strong> brings
          a record back together with everything that was deleted in the same click
          (sub-divisions, communications, documents…). <strong>Purge</strong> is
          permanent — the row and its children are removed from the database and any
          files are unlinked from disk.
        </div>

        {total === 0 ? (
          <Empty title="Trash is empty" sub="Deleted records will appear here." />
        ) : (
          SECTIONS.map((s) => {
            const rows = data[s.key] || [];
            if (rows.length === 0) return null;
            return (
              <div key={s.key}>
                <Section title={s.title} note={`${rows.length} record${rows.length === 1 ? '' : 's'}`} />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {s.columns.map((c) => <th key={c}>{c}</th>)}
                        <th>Deleted</th>
                        <th>By</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          {s.cells(r).map((cell, i) => (
                            <td key={i} className={i === 0 ? 'mono' : ''}>{cell}</td>
                          ))}
                          <td>{fmtTime(r.deleted_at)}</td>
                          <td className="mono">{r.deleted_by_email || '—'}</td>
                          <td className="num">
                            <div className="row-actions">
                              <button
                                className="btn btn-ghost"
                                onClick={() => onRestore(s.type, r.id)}
                              >
                                Restore
                              </button>
                              <button
                                className="btn btn-ghost btn-danger"
                                onClick={() => setPurging({ type: s.type, row: r, label: s.cells(r).join(' · ') })}
                              >
                                Purge
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      {purging && (
        <ConfirmDialog
          title="Purge permanently?"
          message={`Permanently delete: ${purging.label}. This cannot be undone, and any children and document files are also removed.`}
          confirmLabel="Purge"
          onClose={() => setPurging(null)}
          onConfirm={() => onPurge(purging.type, purging.row.id)}
        />
      )}
    </>
  );
}
