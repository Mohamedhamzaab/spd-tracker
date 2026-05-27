// ---------------------------------------------------------------------------
//  Communications. The full log with direction and overdue filters, search,
//  and a row click into the communication detail (documents, ACC link).
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, DirectionPill, Pill, fmtDate, useToast,
} from '../components/ui.jsx';
import { CommDetail } from './SubDivisionDetail.jsx';

export default function Communications() {
  const { isEditor } = useStore();
  useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [openComm, setOpenComm] = useState(null);

  function load() {
    api
      .communications()
      .then(setRows)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const filtered = (rows || []).filter((r) => {
    if (direction && r.direction !== direction) return false;
    if (overdueOnly && !r.is_overdue) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (r.summary || '').toLowerCase().includes(s) ||
      r.comm_code.toLowerCase().includes(s) ||
      (r.submission_reference || '').toLowerCase().includes(s) ||
      (r.sub_division_name || '').toLowerCase().includes(s)
    );
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Communications</div>
        </div>
      </div>
      <div className="page">
        <ErrorBanner message={error} />
        <div className="section-note" style={{ marginBottom: 16 }}>
          New communications are logged from a sub-division, so each is tied to
          its thread. Open any row to view detail and documents.
        </div>

        <div className="toolbar">
          <input
            className="search"
            placeholder="Search by summary, code, reference or sub-division"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="filter-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="">All directions</option>
            <option value="Outbound">Outbound</option>
            <option value="Inbound">Inbound</option>
          </select>
          <label
            className="filter-select"
            style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            Overdue only
          </label>
          <span className="section-note">
            {filtered.length} of {(rows || []).length}
          </span>
        </div>

        {!rows ? (
          <Loading label="Loading communications" />
        ) : filtered.length === 0 ? (
          <Empty title="No communications found" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Date</th>
                  <th>Direction</th>
                  <th>Sub-Division</th>
                  <th>Purpose</th>
                  <th>Summary</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="clickable"
                    onClick={() => setOpenComm(c.id)}
                  >
                    <td className="mono">{c.comm_code}</td>
                    <td>{fmtDate(c.comm_date)}</td>
                    <td>
                      <DirectionPill direction={c.direction} />
                    </td>
                    <td>
                      <div className="cell-strong">{c.sub_division_name}</div>
                      <div className="cell-sub">{c.authority_code}</div>
                    </td>
                    <td>{c.purpose || '-'}</td>
                    <td style={{ maxWidth: 320 }}>
                      <div
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.summary || '-'}
                      </div>
                    </td>
                    <td>
                      {c.is_overdue ? (
                        <Pill tone="red">Overdue</Pill>
                      ) : c.direction === 'Outbound' && c.reply_received ? (
                        <Pill tone="green">Replied</Pill>
                      ) : c.direction === 'Outbound' && c.reply_needed ? (
                        <Pill tone="amber">Awaiting</Pill>
                      ) : (
                        <Pill tone="grey">Logged</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openComm && (
        <CommDetail
          commId={openComm}
          isEditor={isEditor}
          onClose={() => setOpenComm(null)}
          onChanged={load}
        />
      )}
    </>
  );
}
