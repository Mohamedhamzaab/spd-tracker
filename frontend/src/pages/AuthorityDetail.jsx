// ---------------------------------------------------------------------------
//  Authority detail. One authority and the sub-divisions beneath it.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, Section, EngagementPill,
  useTableSort, SortableTH, useToast,
} from '../components/ui.jsx';
import AuditFeed from '../components/AuditFeed.jsx';
import { AuthorityForm } from './Authorities.jsx';

const ENGAGEMENT_RANK = {
  'Identified': 0, 'Contacted': 1, 'Response Received': 2, 'Outcome Secured': 3,
};

const AUTH_SUB_COLS = {
  sub_reference:     { value: (s) => s.sub_reference },
  name:              { value: (s) => s.name },
  discipline:        { value: (s) => s.discipline || '' },
  engagement_status: { value: (s) => ENGAGEMENT_RANK[s.engagement_status] ?? -1, type: 'number' },
  outbound_count:    { value: (s) => s.outbound_count, type: 'number', defaultDir: 'desc' },
  inbound_count:     { value: (s) => s.inbound_count, type: 'number', defaultDir: 'desc' },
  overdue_count:     { value: (s) => s.overdue_count, type: 'number', defaultDir: 'desc' },
};

export default function AuthorityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lists, isEditor } = useStore();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  function reload() {
    api.authority(id).then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => {
    setData(null);
    reload();
  }, [id]);

  // Hooks must run on every render in the same order — compute the sort
  // BEFORE any conditional early-return below.
  const subs = data ? (data.sub_divisions || []) : [];
  const { sorted: sortedSubs, sortKey, sortDir, onSort } = useTableSort(
    subs, AUTH_SUB_COLS, { defaultKey: 'sub_reference', defaultDir: 'asc' }
  );

  if (error) {
    return (
      <>
        <div className="topbar">
          <div className="page-title">Authority</div>
        </div>
        <div className="page">
          <ErrorBanner message={error} />
        </div>
      </>
    );
  }
  if (!data) return <Loading label="Loading authority" />;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">
            <Link to="/app/authorities">Authorities</Link> &nbsp;/&nbsp; {data.code}
          </div>
          <div className="page-title">{data.name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isEditor && (
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              Edit authority
            </button>
          )}
          <button className="btn" onClick={() => navigate('/app/authorities')}>
            Back to register
          </button>
        </div>
      </div>
      <div className="page stack-lg">
        <div className="card card-pad">
          <Section title="Authority Profile">
            <div className="detail-grid">
              <Item label="Code" value={data.code} />
              <Item label="Category" value={data.category} />
              <Item label="Influence Level" value={data.influence_level || '-'} />
              <Item label="Decision Authority" value={data.decision_authority || '-'} />
              <Item label="Engagement Strategy" value={data.engagement_strategy || '-'} />
              <Item label="Sub-Divisions" value={data.sub_division_count} />
            </div>
            {data.notes && (
              <div className="detail-item" style={{ marginTop: 8 }}>
                <div className="dl">Notes</div>
                <div className="dv">{data.notes}</div>
              </div>
            )}
          </Section>
        </div>

        <div>
          <Section
            title="Sub-Divisions"
            note={`${subs.length} under this authority`}
          />
          {subs.length === 0 ? (
            <Empty
              title="No sub-divisions yet"
              sub="Add sub-divisions from the Sub-Divisions page."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortableTH id="sub_reference"     sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Reference</SortableTH>
                    <SortableTH id="name"              sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Sub-Division</SortableTH>
                    <SortableTH id="discipline"        sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Discipline</SortableTH>
                    <SortableTH id="engagement_status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Status</SortableTH>
                    <SortableTH id="outbound_count"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="num">Outbound</SortableTH>
                    <SortableTH id="inbound_count"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="num">Responses</SortableTH>
                    <SortableTH id="overdue_count"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="num">Overdue</SortableTH>
                  </tr>
                </thead>
                <tbody>
                  {sortedSubs.map((s) => (
                    <tr
                      key={s.id}
                      className="clickable"
                      onClick={() => navigate('/app/sub-divisions/' + s.id)}
                    >
                      <td className="mono">{s.sub_reference}</td>
                      <td>
                        <div className="cell-strong">{s.name}</div>
                        {s.primary_contact && (
                          <div className="cell-sub">{s.primary_contact}</div>
                        )}
                      </td>
                      <td>{s.discipline || '-'}</td>
                      <td>
                        <EngagementPill status={s.engagement_status} />
                      </td>
                      <td className="num">{s.outbound_count}</td>
                      <td className="num">{s.inbound_count}</td>
                      <td className="num">{s.overdue_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <Section title="Recent activity" />
          <AuditFeed targetType="authority" targetId={data.id} />
        </div>
      </div>

      {editing && (
        <AuthorityForm
          lists={lists}
          existing={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast('Authority updated');
            reload();
          }}
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
