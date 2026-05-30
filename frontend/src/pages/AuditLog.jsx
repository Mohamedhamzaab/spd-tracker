// ---------------------------------------------------------------------------
//  Audit log — super-admin view of every recorded event.
//  Filters: event type, actor email, target type, date range, free-text q.
//  Pagination via limit/offset; default 50 rows per page.
//  Each row expands to show the raw payload + IP + user-agent.
// ---------------------------------------------------------------------------
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../lib/api.js';
import {
  Section, Loading, Empty, ErrorBanner, Pill, fmtDate,
} from '../components/ui.jsx';

const TARGET_TYPES = ['', 'user', 'authority', 'sub_division', 'communication', 'meeting', 'document'];

// Coarse tone per event family for quick visual scanning.
function eventTone(type) {
  if (type.startsWith('login.failed') || type.startsWith('login.locked') || type.endsWith('_failed')) return 'red';
  if (type.startsWith('login.') || type.startsWith('mfa.verified') || type.startsWith('mfa.enrolled')) return 'green';
  if (type.startsWith('user.deleted') || type.endsWith('.deleted')) return 'red';
  if (type.startsWith('user.disabled') || type.startsWith('user.force_reset') || type.startsWith('mfa.cleared')) return 'amber';
  if (type.startsWith('data.')) return 'navy';
  if (type.startsWith('invite.') || type.startsWith('password.')) return 'navy';
  return 'grey';
}

function fmtDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${fmtDate(value)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function targetLabel(ev) {
  if (!ev.target_type) return '—';
  return `${ev.target_type}:${ev.target_id ?? '?'}`;
}

export default function AuditLog() {
  const PAGE = 50;
  const [page, setPage] = useState(0);
  const [eventType, setEventType] = useState('');
  const [targetType, setTargetType] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const [eventTypes, setEventTypes] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const params = useMemo(() => {
    const p = { limit: PAGE, offset: page * PAGE };
    if (eventType) p.event_type = eventType;
    if (targetType) p.target_type = targetType;
    if (actorEmail) p.actor_email = actorEmail;
    if (from) p.from = from;
    if (to) p.to = to;
    if (q) p.q = q;
    return p;
  }, [page, eventType, targetType, actorEmail, from, to, q]);

  const reload = useCallback(async () => {
    setError('');
    try {
      const r = await api.audit(params);
      setData(r);
    } catch (e) {
      setError(e.message || 'Failed to load audit log.');
    }
  }, [params]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    api.auditEventTypes()
      .then((r) => setEventTypes(r.event_types || []))
      .catch(() => {});
  }, []);

  function resetFilters() {
    setEventType(''); setTargetType(''); setActorEmail('');
    setFrom(''); setTo(''); setQ(''); setPage(0);
  }

  function changeFilter(setter) {
    return (v) => { setter(v); setPage(0); };
  }

  if (!data && !error) return <Loading label="Loading audit log" />;

  const events = data?.events || [];
  const total = data?.total || 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Administration</div>
          <div className="page-title">Audit log</div>
        </div>
        <button className="btn" onClick={resetFilters}>Clear filters</button>
      </div>

      <div className="page stack-lg">
        <ErrorBanner message={error} />

        <div className="card card-pad">
          <Section title="Filters" />
          <div className="audit-filters">
            <div className="field">
              <label className="field-label">Event type</label>
              <select
                className="input"
                value={eventType}
                onChange={(e) => changeFilter(setEventType)(e.target.value)}
              >
                <option value="">All event types</option>
                {eventTypes.map((t) => (
                  <option key={t.event_type} value={t.event_type}>
                    {t.event_type} ({t.n})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Target</label>
              <select
                className="input"
                value={targetType}
                onChange={(e) => changeFilter(setTargetType)(e.target.value)}
              >
                {TARGET_TYPES.map((t) => (
                  <option key={t} value={t}>{t || 'Any target'}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Actor email contains</label>
              <input
                className="input"
                value={actorEmail}
                onChange={(e) => changeFilter(setActorEmail)(e.target.value)}
                placeholder="e.g. ecg.example"
              />
            </div>
            <div className="field">
              <label className="field-label">From</label>
              <input
                className="input"
                type="date"
                value={from}
                onChange={(e) => changeFilter(setFrom)(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">To</label>
              <input
                className="input"
                type="date"
                value={to}
                onChange={(e) => changeFilter(setTo)(e.target.value)}
              />
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label className="field-label">Search (IP, email, payload)</label>
              <input
                className="input"
                value={q}
                onChange={(e) => changeFilter(setQ)(e.target.value)}
                placeholder="Free text…"
              />
            </div>
          </div>
        </div>

        <Section title="Events" note={`${total.toLocaleString()} total`} />
        {events.length === 0 ? (
          <Empty title="No events match these filters" />
        ) : (
          <div className="table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>When</th>
                  <th>Actor</th>
                  <th>Event</th>
                  <th>Target</th>
                  <th style={{ width: 130 }}>IP</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const open = expanded === ev.id;
                  return (
                    <React.Fragment key={ev.id}>
                      <tr
                        className="clickable"
                        onClick={() => setExpanded(open ? null : ev.id)}
                      >
                        <td>{fmtDateTime(ev.created_at)}</td>
                        <td>
                          {ev.actor ? (
                            <>
                              <div className="cell-strong">{ev.actor.name}</div>
                              <div className="cell-sub mono">{ev.actor.email}</div>
                            </>
                          ) : (
                            <span className="cell-sub">—</span>
                          )}
                        </td>
                        <td>
                          <Pill tone={eventTone(ev.event_type)}>{ev.event_type}</Pill>
                        </td>
                        <td className="mono">{targetLabel(ev)}</td>
                        <td className="mono">{ev.ip || '—'}</td>
                        <td className="audit-chev">{open ? '▴' : '▾'}</td>
                      </tr>
                      {open && (
                        <tr className="audit-expanded">
                          <td colSpan={6}>
                            <div className="audit-payload">
                              <div>
                                <div className="dl">Payload</div>
                                <pre className="audit-payload-pre">
{ev.payload ? JSON.stringify(ev.payload, null, 2) : '(none)'}
                                </pre>
                              </div>
                              {ev.user_agent && (
                                <div>
                                  <div className="dl">User agent</div>
                                  <div className="cell-sub mono">{ev.user_agent}</div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <button className="btn" disabled={page === 0} onClick={() => setPage(0)}>« First</button>
          <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span className="section-note">Page {page + 1} of {lastPage + 1}</span>
          <button className="btn" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Next ›</button>
          <button className="btn" disabled={page >= lastPage} onClick={() => setPage(lastPage)}>Last »</button>
        </div>
      </div>
    </>
  );
}
