// ---------------------------------------------------------------------------
//  Re-number communication codes so the ACTIVE list is always a clean
//  chronological sequence: earliest comm_date = C-0001, building up with no
//  gaps. Soft-deleted rows are pushed to the end (they keep a unique code but
//  it's irrelevant while they sit in Trash); if one is restored, calling this
//  again slots it back into its date position.
//
//  Runs as two passes inside the CALLER's transaction so it is atomic with the
//  delete/restore that triggered it:
//    1. park every row on a collision-proof temporary code
//    2. assign the final C-#### codes in (active-first, date) order
//
//  Reply links (in_response_to) are stored by row id, so threads are never
//  affected — only the displayed codes re-flow.
// ---------------------------------------------------------------------------
async function renumberCommunications(client) {
  await client.query(`UPDATE communications SET comm_code = 'TMP-' || id`);
  await client.query(
    `WITH ordered AS (
       SELECT id,
              'C-' || lpad(
                (row_number() OVER (
                  ORDER BY (deleted_at IS NOT NULL), comm_date ASC, id ASC
                ))::text, 4, '0'
              ) AS new_code
         FROM communications
     )
     UPDATE communications c
        SET comm_code = o.new_code
       FROM ordered o
      WHERE c.id = o.id`
  );
}

module.exports = { renumberCommunications };
