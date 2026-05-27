// ---------------------------------------------------------------------------
//  Authority detail. One authority and the sub-divisions beneath it.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import {
  Loading, Empty, ErrorBanner, Section, EngagementPill,
} from '../components/ui.jsx';

export default function AuthorityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api.authority(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

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

  const subs = data.sub_divisions || [];

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">
            <Link to="/authorities">Authorities</Link> &nbsp;/&nbsp; {data.code}
          </div>
          <div className="page-title">{data.name}</div>
        </div>
        <button className="btn" onClick={() => navigate('/authorities')}>
          Back to register
        </button>
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
                    <th>Reference</th>
                    <th>Sub-Division</th>
                    <th>Discipline</th>
                    <th>Status</th>
                    <th className="num">Outbound</th>
                    <th className="num">Responses</th>
                    <th className="num">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr
                      key={s.id}
                      className="clickable"
                      onClick={() => navigate('/sub-divisions/' + s.id)}
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
      </div>
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
