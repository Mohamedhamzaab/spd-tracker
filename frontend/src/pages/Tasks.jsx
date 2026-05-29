// ---------------------------------------------------------------------------
//  Tasks page — global view across the engagement. Tabs for My open / My
//  overdue / All open. Filters compose with the tab.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Section, Loading, Empty, ErrorBanner, Pill, fmtDate, useToast,
} from '../components/ui.jsx';
import { useLive } from '../lib/liveStream.js';

const LIVE = ['data.task.created', 'data.task.updated', 'data.task.completed', 'data.task.deleted'];

const TABS = [
  { key: 'mine_open',    label: 'My open',      params: { mine: 'true', status: 'open' } },
  { key: 'mine_overdue', label: 'My overdue',   params: { mine: 'true', overdue: 'true' } },
  { key: 'all_open',     label: 'All open',     params: { status: 'open' } },
  { key: 'all_overdue',  label: 'All overdue',  params: { overdue: 'true' } },
  { key: 'all',          label: 'All',          params: {} },
];

const PARENT_LINK = {
  communication: (id) => '/app/communications',
  sub_division: (id) => `/app/sub-divisions/${id}`,
  meeting: (id) => '/app/meetings',
  authority: (id) => `/app/authorities/${id}`,
};

export default function Tasks() {
  const { user } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('mine_open');
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');

  const params = useMemo(() => TABS.find((t) => t.key === tab).params, [tab]);

  const reload = useCallback(async () => {
    setError('');
    try {
      const r = await api.tasks(params);
      setTasks(r.tasks || []);
    } catch (e) { setError(e.message || 'Failed to load tasks.'); }
  }, [params]);

  useEffect(() => { reload(); }, [reload]);
  useLive(LIVE, reload);

  async function toggle(t) {
    try {
      await api.updateTask(t.id, { status: t.status === 'open' ? 'done' : 'open' });
      toast(t.status === 'open' ? 'Marked done.' : 'Reopened.');
      reload();
    } catch (e) { setError(e.message || 'Update failed.'); }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Tasks</div>
        </div>
      </div>

      <div className="page stack-lg">
        <ErrorBanner message={error} />

        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={'tab ' + (tab === t.key ? 'tab-active' : '')}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!tasks ? (
          <Loading label="Loading tasks" />
        ) : tasks.length === 0 ? (
          <Empty title="Nothing in this view" />
        ) : (
          <ul className="task-list task-list-page">
            {tasks.map((t) => {
              const isAssignee = t.assignee && t.assignee.id === user.id;
              const canFlip = user.role === 'admin' || user.role === 'super_admin' || isAssignee;
              return (
                <li
                  key={t.id}
                  className={'task-row' + (t.status === 'done' ? ' task-row-done' : '') + (t.is_overdue ? ' task-row-overdue' : '')}
                >
                  <input
                    type="checkbox"
                    className="task-check"
                    checked={t.status === 'done'}
                    onChange={() => toggle(t)}
                    disabled={!canFlip}
                  />
                  <div className="task-body">
                    <div className="task-title">{t.title}</div>
                    {t.description && <div className="task-desc">{t.description}</div>}
                    <div className="task-meta">
                      <span>
                        <Link to={PARENT_LINK[t.parent_type]?.(t.parent_id) || '#'}>
                          {t.parent_type.replace('_', '-')} #{t.parent_id}
                        </Link>
                      </span>
                      {t.assignee
                        ? <span>{t.assignee.name}</span>
                        : <span className="cell-sub">unassigned</span>}
                      {t.due_date && (
                        <Pill tone={t.is_overdue ? 'red' : 'grey'}>
                          Due {fmtDate(t.due_date)}{t.is_overdue ? ' · overdue' : ''}
                        </Pill>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
