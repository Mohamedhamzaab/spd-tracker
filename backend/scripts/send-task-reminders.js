// ---------------------------------------------------------------------------
//  Manual task-reminder runner. The server runs this automatically once a day
//  (see TASK_REMINDER_CRON), but you can trigger it on demand to test or to
//  catch up after downtime.
//
//  It emails the assignee of every OPEN task that is due TOMORROW and hasn't
//  already been reminded. Safe to run repeatedly — each task is reminded once.
//
//  Usage:
//    npm run task-reminders
// ---------------------------------------------------------------------------
require('dotenv').config();
const { pool } = require('../src/db');
const { runReminders } = require('../src/taskNotify');

async function main() {
  const result = await runReminders();
  console.log(`[task-reminders] result: ${JSON.stringify(result)}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[task-reminders] fatal:', err);
  process.exit(1);
});
