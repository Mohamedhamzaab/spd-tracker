// ---------------------------------------------------------------------------
//  TasksPanel — open-tasks list scoped to a single record. Drop in on
//  SubDivisionDetail and similar. Inline add form for editors.
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { ErrorBanner, Loading, Pill, fmtDate, useToast } from './ui.jsx';
import { useLive } from '../lib/liveStream.js';

const LIVE = ['data.task.created', 'data.task.updated', 'data.task.completed', 'data.task.deleted'];

export default function TasksPanel({ parentType, parentId }) {
  const { user, isAdmin } = useStore();
  const toast = useToast();
  const [tasks, setTasks] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(async () => {
    setError('');
    try {
      const r = await api.tasks({ parent_type: parentType, parent_id: parentId });
      setTasks(r.tasks || []);
    } catch (e) {
      setError(e.message || 'Failed to load tasks.');
    }
  }, [parentType, parentId]);

  useEffect(() => { reload(); }, [reload]);
  useLive(LIVE, reload);

  // Assignee dropdown — any editor (admin or super-admin) can pull the
  // minimal "assignable members" list (id/name/email of active accounts).
  useEffect(() => {
    if (!isAdmin) return;
    api.taskAssignees()
      .then((r) => setUsers(r.users || []))
      .catch(() => setUsers([]));
  }, [isAdmin]);

  async function toggle(t) {
    try {
      await api.updateTask(t.id, { status: t.status === 'open' ? 'done' : 'open' });
      toast(t.status === 'open' ? 'Marked done.' : 'Reopened.');
      reload();
    } catch (e) { setError(e.message || 'Update failed.'); }
  }

  async function remove(t) {
    if (!window.confirm('Delete this task?')) return;
    try {
      await api.deleteTask(t.id);
      reload();
    } catch (e) { setError(e.message || 'Delete failed.'); }
  }

  if (!tasks) return <Loading label="Loading tasks" />;

  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done');

  return (
    <div>
      <ErrorBanner message={error} />
      {tasks.length === 0 && !showAdd && (
        <div className="cell-sub" style={{ marginBottom: 10 }}>No tasks yet.</div>
      )}

      {open.length > 0 && (
        <ul className="task-list">
          {open.map((t) => (
            <TaskRow key={t.id} t={t} user={user} onToggle={toggle} onDelete={remove} canEdit={isAdmin} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details className="task-done-section">
          <summary>Done ({done.length})</summary>
          <ul className="task-list">
            {done.map((t) => (
              <TaskRow key={t.id} t={t} user={user} onToggle={toggle} onDelete={remove} canEdit={isAdmin} />
            ))}
          </ul>
        </details>
      )}

      {isAdmin && (
        showAdd ? (
          <TaskAddForm
            users={users}
            currentUserId={user.id}
            onCancel={() => setShowAdd(false)}
            onCreate={async (vals) => {
              try {
                await api.createTask({ parent_type: parentType, parent_id: parentId, ...vals });
                toast('Task created.');
                setShowAdd(false);
                reload();
              } catch (e) { setError(e.message || 'Create failed.'); }
            }}
          />
        ) : (
          <button
            type="button"
            className="btn btn-ghost task-add-trigger"
            onClick={() => setShowAdd(true)}
          >
            + Add task
          </button>
        )
      )}
    </div>
  );
}

function TaskRow({ t, user, onToggle, onDelete, canEdit }) {
  const isAssignee = t.assignee && t.assignee.id === user.id;
  const canFlip = canEdit || isAssignee;
  return (
    <li className={'task-row' + (t.status === 'done' ? ' task-row-done' : '') + (t.is_overdue ? ' task-row-overdue' : '')}>
      <input
        type="checkbox"
        className="task-check"
        checked={t.status === 'done'}
        onChange={() => onToggle(t)}
        disabled={!canFlip}
        title={canFlip ? '' : 'Only the assignee or an editor can change status'}
      />
      <div className="task-body">
        <div className="task-title">{t.title}</div>
        {t.description && <div className="task-desc">{t.description}</div>}
        <div className="task-meta">
          {t.assignee ? <span>{t.assignee.name}</span> : <span className="cell-sub">unassigned</span>}
          {t.due_date && (
            <Pill tone={t.is_overdue ? 'red' : 'grey'}>
              Due {fmtDate(t.due_date)}{t.is_overdue ? ' · overdue' : ''}
            </Pill>
          )}
        </div>
      </div>
      {canEdit && (
        <button type="button" className="link-btn task-delete" onClick={() => onDelete(t)}>
          Delete
        </button>
      )}
    </li>
  );
}

function TaskAddForm({ users, currentUserId, onCancel, onCreate }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState(String(currentUserId));
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || null,
        assignee_id: assigneeId ? Number(assigneeId) : null,
        due_date: dueDate || null,
      });
    } finally { setBusy(false); }
  }

  return (
    <form className="task-add" onSubmit={submit}>
      <div className="field">
        <label className="field-label">Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label className="field-label">Notes (optional)</label>
        <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: 'vertical' }} />
      </div>
      <div className="task-add-row">
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">Assignee</label>
          <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">Due date</label>
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div className="task-add-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !title.trim()}>
          {busy ? 'Creating…' : 'Add task'}
        </button>
      </div>
    </form>
  );
}
