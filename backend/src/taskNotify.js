// ---------------------------------------------------------------------------
//  Task notifications.
//
//    - notifyAssignment(...)  email the assignee when a task is assigned to
//                             them (on create or re-assign). Fire-and-forget.
//    - runReminders()         email assignees whose open task is due TOMORROW,
//                             once per task (de-duped via reminder_sent_at).
//    - startScheduler()       register the daily reminder cron.
//
//  Reminders are ON by default; set TASK_REMINDERS_ENABLED=false to disable.
//  Override the time with TASK_REMINDER_CRON (default 07:00 daily).
// ---------------------------------------------------------------------------
const cron = require('node-cron');
const { query } = require('./db');
const mail = require('./mail');
const { logAudit } = require('./audit');

// Resolve a human-friendly label for the record a task hangs off, e.g.
// "communication C-0005" or "authority KAHRAMAA (KM)". Best-effort: on any
// miss it falls back to a generic label so a notification never breaks.
async function parentLabel(parentType, parentId) {
  try {
    if (parentType === 'communication') {
      const r = await query('SELECT comm_code FROM communications WHERE id = $1', [parentId]);
      if (r.rows[0]) return `communication ${r.rows[0].comm_code}`;
    } else if (parentType === 'meeting') {
      const r = await query('SELECT meeting_code FROM meetings WHERE id = $1', [parentId]);
      if (r.rows[0]) return `meeting ${r.rows[0].meeting_code}`;
    } else if (parentType === 'sub_division') {
      const r = await query('SELECT sub_reference, name FROM sub_divisions WHERE id = $1', [parentId]);
      if (r.rows[0]) return `${r.rows[0].name} (${r.rows[0].sub_reference})`;
    } else if (parentType === 'authority') {
      const r = await query('SELECT code, name FROM authorities WHERE id = $1', [parentId]);
      if (r.rows[0]) return `${r.rows[0].name} (${r.rows[0].code})`;
    }
  } catch (_) { /* fall through to generic */ }
  return parentType ? parentType.replace('_', '-') : '';
}

// Called from the tasks route after a task is created or re-assigned. Never
// throws — a failed notification must not fail the task write.
async function notifyAssignment({ assignee, taskTitle, assignedByName, parentType, parentId, dueDate }) {
  try {
    if (!assignee || !assignee.email) return;
    const label = await parentLabel(parentType, parentId);
    mail.sendTaskAssigned({
      to: assignee.email,
      name: assignee.name,
      taskTitle,
      assignedByName,
      parentLabel: label,
      dueDate: dueDate ? String(dueDate).slice(0, 10) : null,
    });
  } catch (err) {
    console.error('[task-notify] assignment email failed:', err.message);
  }
}

// Find every open, assigned task due tomorrow that hasn't been reminded yet,
// email the assignee, and stamp reminder_sent_at so it only goes once.
async function runReminders() {
  const { rows } = await query(
    `SELECT t.id, t.title, t.parent_type, t.parent_id,
            to_char(t.due_date, 'YYYY-MM-DD') AS due_str,
            a.name AS assignee_name, a.email AS assignee_email
       FROM tasks t
       JOIN users a ON a.id = t.assignee_id
      WHERE t.deleted_at IS NULL
        AND t.status = 'open'
        AND a.is_disabled = FALSE
        AND t.due_date = CURRENT_DATE + 1
        AND t.reminder_sent_at IS NULL`
  );

  if (rows.length === 0) {
    console.log('[task-reminders] none due tomorrow.');
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const t of rows) {
    try {
      const label = await parentLabel(t.parent_type, t.parent_id);
      await mail.sendTaskReminder({
        to: t.assignee_email,
        name: t.assignee_name,
        taskTitle: t.title,
        parentLabel: label,
        dueDate: t.due_str,
      });
      await query('UPDATE tasks SET reminder_sent_at = now() WHERE id = $1', [t.id]);
      await logAudit({
        actor_id: null,
        event: 'data.task.reminder_sent',
        target_type: 'task',
        target_id: t.id,
        payload: { to: t.assignee_email, due: t.due_str },
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(`[task-reminders] failed for task ${t.id} -> ${t.assignee_email}: ${err.message}`);
    }
  }
  console.log(`[task-reminders] done — sent ${sent}, failed ${failed}.`);
  return { sent, failed };
}

function startScheduler() {
  if (String(process.env.TASK_REMINDERS_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[task-reminders] TASK_REMINDERS_ENABLED=false — scheduler is OFF.');
    return null;
  }
  const expr = process.env.TASK_REMINDER_CRON || '0 7 * * *';
  const timezone = require('./db').APP_TZ;
  console.log(`[task-reminders] scheduling cron: ${expr} (${timezone})`);
  return cron.schedule(expr, () => {
    runReminders().catch((err) =>
      console.error('[task-reminders] run failed:', err.message)
    );
  }, { timezone });
}

module.exports = { notifyAssignment, runReminders, startScheduler, parentLabel };
