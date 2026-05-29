// ---------------------------------------------------------------------------
//  AuditFeed — "Recent activity" panel mounted on entity detail pages.
//  Shows the last N events targeting one record, with relative timestamps.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Loading, Pill, fmtDate } from './ui.jsx';

function eventTone(type) {
  if (type.endsWith('.deleted') || type.endsWith('_failed')) return 'red';
  if (type.endsWith('.created') || type.endsWith('.enrolled')) return 'green';
  if (type.endsWith('.updated') || type.endsWith('_attached') || type.endsWith('_removed')) return 'navy';
  if (type.startsWith('user.disabled') || type.includes('force_reset') || type.includes('.cleared')) return 'amber';
  return 'grey';
}

// "5m ago", "2h ago", "3d ago", then fall back to a date.
function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(then)) return '';
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return sec + 's ago';
  const min = Math.round(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + 'h ago';
  const d = Math.round(hr / 24);
  if (d < 7) return d + 'd ago';
  return fmtDate(iso);
}

export default function AuditFeed({ targetType, targetId, limit = 25 }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!targetType || !targetId) return;
    let cancelled = false;
    setEvents(null);
    api.auditFor(targetType, targetId, { limit })
      .then((r) => { if (!cancelled) setEvents(r.events || []); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load activity.'); });
    return () => { cancelled = true; };
  }, [targetType, targetId, limit]);

  if (error) return <div className="cell-sub">Couldn't load activity: {error}</div>;
  if (!events) return <Loading label="Loading activity" />;
  if (events.length === 0) {
    return <div className="cell-sub">No activity recorded yet.</div>;
  }

  return (
    <ol className="audit-feed">
      {events.map((ev) => (
        <li key={ev.id} className="audit-feed-item">
          <div className="audit-feed-time" title={ev.created_at}>{ago(ev.created_at)}</div>
          <div className="audit-feed-body">
            <Pill tone={eventTone(ev.event_type)}>{ev.event_type}</Pill>
            <span className="audit-feed-actor">
              {ev.actor ? <>by {ev.actor.name}</> : <>(system)</>}
            </span>
            {ev.payload && (
              <span className="audit-feed-payload">
                {summarisePayload(ev.payload)}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// Concise one-line summary of the most useful payload fields.
function summarisePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const bits = [];
  if (payload.from && payload.to) bits.push(payload.from + ' → ' + payload.to);
  if (payload.original_name) bits.push(payload.original_name);
  if (payload.email && !bits.length) bits.push(payload.email);
  if (payload.reason && !bits.length) bits.push(payload.reason);
  return bits.length ? '· ' + bits.join(' · ') : null;
}
