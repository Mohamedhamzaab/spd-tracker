// ---------------------------------------------------------------------------
//  CommentsThread — discussion thread attached to any record. Drop in on
//  CommDetail / SubDivisionDetail / etc. and pass the parent.
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { ErrorBanner, Loading, initials, fmtDate } from './ui.jsx';
import { useLive } from '../lib/liveStream.js';

const LIVE = ['data.comment.created', 'data.comment.updated', 'data.comment.deleted'];

function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(then)) return '';
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + 'h ago';
  const d = Math.round(hr / 24);
  if (d < 7) return d + 'd ago';
  return fmtDate(iso);
}

export default function CommentsThread({ parentType, parentId }) {
  const { user } = useStore();
  const [comments, setComments] = useState(null);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState('');

  const reload = useCallback(async () => {
    setError('');
    try {
      const r = await api.comments(parentType, parentId);
      setComments(r.comments || []);
    } catch (e) {
      setError(e.message || 'Failed to load comments.');
    }
  }, [parentType, parentId]);

  useEffect(() => { reload(); }, [reload]);
  useLive(LIVE, reload);

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api.createComment({ parent_type: parentType, parent_id: parentId, body });
      setBody('');
      reload();
    } catch (e2) {
      setError(e2.message || 'Failed to post.');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(c) {
    if (!editingBody.trim()) return;
    try {
      await api.updateComment(c.id, { body: editingBody });
      setEditingId(null);
      reload();
    } catch (e) { setError(e.message || 'Edit failed.'); }
  }

  async function remove(c) {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await api.deleteComment(c.id);
      reload();
    } catch (e) { setError(e.message || 'Delete failed.'); }
  }

  if (!comments) return <Loading label="Loading comments" />;

  return (
    <div className="comments">
      <ErrorBanner message={error} />
      {comments.length === 0 && (
        <div className="cell-sub" style={{ marginBottom: 12 }}>
          No comments yet. Start the discussion below.
        </div>
      )}
      {comments.map((c) => {
        const mine = c.author && c.author.id === user.id;
        const isSuperAdmin = user.role === 'super_admin';
        return (
          <div className="comment" key={c.id}>
            <div className="comment-avatar">{initials(c.author?.name || '?')}</div>
            <div className="comment-body">
              <div className="comment-head">
                <span className="comment-author">{c.author?.name || '(deleted user)'}</span>
                <span className="comment-time" title={c.created_at}>
                  {ago(c.created_at)}
                  {c.edited_at && <span className="comment-edited"> · edited</span>}
                </span>
                {(mine || isSuperAdmin) && editingId !== c.id && (
                  <div className="comment-menu">
                    {mine && (
                      <button
                        type="button"
                        onClick={() => { setEditingId(c.id); setEditingBody(c.body); }}
                      >Edit</button>
                    )}
                    <button type="button" onClick={() => remove(c)}>Delete</button>
                  </div>
                )}
              </div>
              {editingId === c.id ? (
                <div>
                  <textarea
                    className="input"
                    rows={3}
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                  <div className="comment-edit-actions">
                    <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => saveEdit(c)}>Save</button>
                  </div>
                </div>
              ) : (
                <div className="comment-text">{c.body}</div>
              )}
            </div>
          </div>
        );
      })}

      <form className="comment-compose" onSubmit={submit}>
        <div className="comment-avatar">{initials(user.name)}</div>
        <div style={{ flex: 1 }}>
          <textarea
            className="input"
            rows={2}
            placeholder="Add a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ resize: 'vertical' }}
          />
          <div className="comment-compose-actions">
            <button className="btn btn-primary" disabled={submitting || !body.trim()}>
              {submitting ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
