// ---------------------------------------------------------------------------
//  Re-number record codes so the ACTIVE list is always a clean chronological
//  sequence: earliest date = #0001, building up with no gaps. Soft-deleted
//  rows are pushed to the end (they keep a unique code but it's irrelevant
//  while they sit in Trash); if one is restored, calling this again slots it
//  back into its date position.
//
//  Runs as two passes inside the CALLER's transaction so it is atomic with the
//  delete/restore that triggered it:
//    1. park every row on a collision-proof temporary code
//    2. assign the final codes in (active-first, date) order
//
//  Cross-references (reply links, related links) are stored by row id, so they
//  are never affected — only the displayed codes re-flow.
//
//  All config values (table/column/prefix/width/date column) are internal
//  constants, never user input, so the string interpolation here is safe.
// ---------------------------------------------------------------------------
async function renumberByDate(client, { table, codeCol, prefix, width, dateCol, timeCol }) {
  await client.query(`UPDATE ${table} SET ${codeCol} = 'TMP-' || id`);
  // When the table has a time-of-day column (meetings), same-date rows order
  // by start time so the codes are fully chronological; a missing time counts
  // as 00:00 (start of day). dateCol/timeCol are internal constants.
  const timeOrder = timeCol ? `coalesce(${timeCol}, '00:00:00') ASC, ` : '';
  await client.query(
    `WITH ordered AS (
       SELECT id,
              '${prefix}-' || lpad(
                (row_number() OVER (
                  ORDER BY (deleted_at IS NOT NULL), ${dateCol} ASC, ${timeOrder}id ASC
                ))::text, ${width}, '0'
              ) AS new_code
         FROM ${table}
     )
     UPDATE ${table} t
        SET ${codeCol} = o.new_code
       FROM ordered o
      WHERE t.id = o.id`
  );
}

const renumberCommunications = (client) =>
  renumberByDate(client, {
    table: 'communications', codeCol: 'comm_code',
    prefix: 'C', width: 4, dateCol: 'comm_date',
  });

const renumberMeetings = (client) =>
  renumberByDate(client, {
    table: 'meetings', codeCol: 'meeting_code',
    prefix: 'M', width: 3, dateCol: 'meeting_date', timeCol: 'meeting_time',
  });

const renumberQdrs = (client) =>
  renumberByDate(client, {
    table: 'qdrs_records', codeCol: 'qdrs_code',
    prefix: 'Q', width: 4, dateCol: 'qdrs_date',
  });

module.exports = { renumberCommunications, renumberMeetings, renumberQdrs };
