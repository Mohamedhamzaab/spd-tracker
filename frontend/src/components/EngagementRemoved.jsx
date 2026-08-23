// ---------------------------------------------------------------------------
//  EngagementRemoved — everything taken out of the register, and the way back.
//
//  Nothing here is gone: removing an action or a timeline entry only hides it,
//  so a mis-click is always recoverable. Cancelled actions live here too, since
//  from the user's side "I cancelled that by accident" is the same problem.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Loading, Empty, ErrorBanner, Pill, fmtDate, useToast } from './ui.jsx';

export default function EngagementRemoved({ isEditor, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [cancelled, setCancelled] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  function load() {
    setError('');
    api.engRemoved().then(setData).catch((e) => setError(e.message));
    api.engActions({ status: 'Cancelled,Superseded' })
      .then(setCancelled).catch(() => setCancelled([]));
  }
  useEffect(load, []);

  async function run(key, fn, msg) {
    setBusy(key);
    try {
      await fn();
      toast(msg);
      load();
      onChanged && onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return <Loading label="Loading what was removed" />;

  const nothing = !data.actions.length && !data.entries.length && !cancelled.length;

  return (
    <div className="removed">
      <ErrorBanner message={error} />
      <p className="removed-lede">
        Nothing here is deleted for good — put anything back with one click.
      </p>

      {nothing && <Empty title="Nothing has been removed" />}

      {data.actions.length > 0 && (
        <section className="removed-block">
          <h3 className="removed-h">Removed actions <span>{data.actions.length}</span></h3>
          {data.actions.map((a) => (
            <div key={a.id} className="removed-row">
              <div className="removed-main">
                <div className="removed-text">{a.description}</div>
                <div className="removed-meta">
                  {a.authority_code} · {a.sub_division_name}
                  {a.deleted_at && ` · removed ${fmtDate(a.deleted_at)}`}
                  {a.deleted_by_name && ` by ${a.deleted_by_name}`}
                </div>
              </div>
              {isEditor && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy === 'a' + a.id}
                  onClick={() => run('a' + a.id, () => api.engRestoreAction(a.id), 'Action put back')}
                >
                  Put back
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {cancelled.length > 0 && (
        <section className="removed-block">
          <h3 className="removed-h">Cancelled or superseded <span>{cancelled.length}</span></h3>
          {cancelled.map((a) => (
            <div key={a.id} className="removed-row">
              <div className="removed-main">
                <div className="removed-text">
                  <span className="removed-code">{a.action_code}</span>
                  {a.description}
                </div>
                <div className="removed-meta">
                  {a.authority_code} · {a.sub_division_name} ·{' '}
                  <Pill tone="grey">{a.status}</Pill>
                  {a.cancel_reason && ` — “${a.cancel_reason}”`}
                </div>
              </div>
              {isEditor && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy === 'c' + a.id}
                  onClick={() => run('c' + a.id,
                    () => api.engResolve(a.id, { resolution: null }), 'Action reopened')}
                >
                  Reopen
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {data.entries.length > 0 && (
        <section className="removed-block">
          <h3 className="removed-h">Removed progress entries <span>{data.entries.length}</span></h3>
          {data.entries.map((e) => (
            <div key={e.id} className="removed-row">
              <div className="removed-main">
                <div className="removed-text">{e.note}</div>
                <div className="removed-meta">
                  <Pill tone={e.kind === 'closure' ? 'green' : 'navy'}>
                    {e.kind === 'closure' ? 'Closed' : 'Progress'}
                  </Pill>
                  {' '}{fmtDate(e.entry_date)} · on “{String(e.action_description).slice(0, 54)}…”
                  {e.deleted_by_name && ` · removed by ${e.deleted_by_name}`}
                </div>
              </div>
              {isEditor && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy === 'e' + e.id}
                  onClick={() => run('e' + e.id, () => api.engRestoreProgress(e.id), 'Entry put back')}
                >
                  Put back
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
