// ---------------------------------------------------------------------------
//  Tasks page — global view across the engagement. Tabs for My open / My
//  overdue / All open. Filters compose with the tab.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Section, Loading, Empty, ErrorBanner, Modal, FormFields, Pill, fmtDate, useToast,
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
  const { user, isEditor } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('mine_open');
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [subDivisions, setSubDivisions] = useState([]);
  const [users, setUsers] = useState([]);

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

  // Editors can create a task here against any sub-division and assign it to a
  // project member — load both lists once. taskAssignees is editor-accessible
  // (admins included), unlike the super-admin-only user-management API.
  useEffect(() => {
    if (!isEditor) return;
    api.subDivisions().then(setSubDivisions).catch(() => setSubDivisions([]));
    api.taskAssignees().then((r) => setUsers(r.users || [])).catch(() => setUsers([]));
  }, [isEditor]);

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
        {isEditor && (
          <button
            className="btn btn-primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setCreating(true)}
          >
            + New task
          </button>
        )}
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

      {creating && (
        <NewTaskModal
          subDivisions={subDivisions}
          users={users}
          currentUserId={user.id}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            toast('Task created.');
            reload();
          }}
        />
      )}
    </>
  );
}

// Create a task from the Tasks page: pick the sub-division it relates to and
// (optionally) assign it to a project member. The assignee is emailed
// automatically by the server when they're not the creator.
function NewTaskModal({ subDivisions, users, currentUserId, onClose, onCreated }) {
  const [values, setValues] = useState({
    sub_division_id: '',
    title: '',
    description: '',
    assignee_id: String(currentUserId),
    due_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onChange = (n, v) => setValues((s) => ({ ...s, [n]: v }));

  const fields = [
    {
      name: 'sub_division_id', label: 'Sub-Division', type: 'select', required: true, span: 2,
      placeholder: 'Choose a sub-division…',
      options: subDivisions.map((s) => ({
        value: String(s.id), label: `${s.sub_reference} — ${s.name}`,
      })),
    },
    { name: 'title', label: 'Title', required: true, span: 2,
      placeholder: 'e.g. Chase KAHRAMAA for TSE data' },
    { name: 'description', label: 'Notes', type: 'textarea', span: 2 },
    {
      name: 'assignee_id', label: 'Assignee', type: 'select', span: 2,
      placeholder: 'Unassigned',
      options: users.map((u) => ({ value: String(u.id), label: `${u.name} · ${u.email}` })),
      help: 'The assignee is emailed when the task is created.',
    },
    { name: 'due_date', label: 'Due date', type: 'date', span: 2,
      help: 'A reminder is sent the day before the due date.' },
  ];

  async function save() {
    setError('');
    if (!values.sub_division_id) return setError('Please choose a sub-division.');
    if (!values.title.trim()) return setError('A title is required.');
    setBusy(true);
    try {
      await api.createTask({
        parent_type: 'sub_division',
        parent_id: Number(values.sub_division_id),
        title: values.title.trim(),
        description: values.description.trim() || null,
        assignee_id: values.assignee_id ? Number(values.assignee_id) : null,
        due_date: values.due_date || null,
      });
      onCreated();
    } catch (e) {
      setError(e.message || 'Could not create the task.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title="New Task"
      sub="Attach a follow-up to a sub-division and assign it to a member"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <FormFields fields={fields} values={values} onChange={onChange} disabled={busy} />
    </Modal>
  );
}
