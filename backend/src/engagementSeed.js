// ---------------------------------------------------------------------------
//  Stakeholder reconciliation.
//
//  The Stakeholder Engagement Matrix workbook names 45 stakeholders; the
//  register held fewer. Because a stakeholder may only appear in the matrix
//  once it exists in the system, the gap has to be closed in the register
//  first — which is what this does.
//
//  Runs on every boot and only ever inserts what is missing, matching
//  authorities by code and sub-divisions by (authority, name). Re-running is
//  a no-op, so it is safe on a live database.
//
//  Ratings live on sub-divisions, so EVERY authority needs at least one. New
//  authorities therefore get a "<Name> General" sub-division, following the
//  convention already used for GORD, MCIT, Ooredoo and the rest.
// ---------------------------------------------------------------------------

// Authorities the workbook names that the register did not hold.
// [code, name, category, discipline for its General sub-division]
const AUTHORITIES = [
  ['CAA',   'Civil Aviation Authority (CAA)',                 'Statutory or Regulatory Authority', 'General'],
  ['QE',    'Qatar Energy - Transmission and Distribution',   'Utility Provider',                  'Electricity'],
  ['QMA',   'Qatar Museum Authority',                         'Statutory or Regulatory Authority', 'General'],
  ['AWQAF', 'Ministry of Awqaf and Islamic Affairs',          'Government Ministry',               'General'],
  ['PEO',   'Private Engineering Office (PEO)',               'Statutory or Regulatory Authority', 'General'],
  ['MWSL',  'Mowasalat',                                      'Adjacent Operator',                 'Transport'],
  ['QRAIL', 'Qatar Rail',                                     'Adjacent Operator',                 'Transport'],
  ['MRFQ',  'Marafeq',                                        'Utility Provider',                  'General'],
  ['AMIRI', 'Amiri Guard',                                    'Statutory or Regulatory Authority', 'Security Systems'],
  ['QCOOL', 'Qatar Cool',                                     'Utility Provider',                  'General'],
];

// Departments the workbook rates separately but the register did not hold.
// [authority code, sub-division name, discipline]
//
// Two of these sit under MOI rather than at top level as the workbook has
// them, because the register already models MOI Telecom that way and they are
// genuinely MOI departments.
const SUB_DIVISIONS = [
  ['MM',   'MM Agriculture and Fisheries Affairs',         'General'],
  ['MM',   'MM Cleaning Department',                       'General'],
  ['MM',   'MM Public Parks',                              'General'],
  ['PWA',  'ASHGHAL TSE Network',                          'TSE Networks'],
  ['PWA',  'ASHGHAL Beautification',                       'General'],
  ['QNBN', 'QNBN UGN',                                     'Broadband Network'],
  ['MOI',  'MoI Establishments and Authorities Security',  'Security Systems'],
];

// Insert a sub-division under an authority, taking the next free seq_no and
// building the reference the same way routes/subdivisions.js does (KM-S01).
async function addSubDivision(client, authorityId, authorityCode, name, discipline) {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(seq_no), 0) + 1 AS next FROM sub_divisions WHERE authority_id = $1',
    [authorityId]
  );
  const seq = rows[0].next;
  const subRef = `${authorityCode}-S${String(seq).padStart(2, '0')}`;
  await client.query(
    `INSERT INTO sub_divisions
       (authority_id, seq_no, sub_reference, name, discipline,
        primary_objective, target_stage,
        data_collection_status, consultation_status, noc_status, outcome_secured)
     VALUES ($1,$2,$3,$4,$5,'Data Collection Only','Stage 2 - Master Plan',
             'Not Started','Not Started','Not Started',FALSE)`,
    [authorityId, seq, subRef, name, discipline]
  );
  return subRef;
}

async function ensureEngagementStakeholders(client) {
  const created = { authorities: [], subDivisions: [] };

  for (const [code, name, category, discipline] of AUTHORITIES) {
    const found = await client.query(
      'SELECT id FROM authorities WHERE code = $1 AND deleted_at IS NULL',
      [code]
    );
    let authorityId = found.rows[0]?.id;
    if (!authorityId) {
      const ins = await client.query(
        `INSERT INTO authorities (code, name, category, notes)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [code, name, category, 'Added from the Stakeholder Engagement Matrix.']
      );
      authorityId = ins.rows[0].id;
      created.authorities.push(code);
    }
    // Every authority needs somewhere to hold its ratings.
    const hasSub = await client.query(
      'SELECT 1 FROM sub_divisions WHERE authority_id = $1 AND deleted_at IS NULL LIMIT 1',
      [authorityId]
    );
    if (!hasSub.rows[0]) {
      const ref = await addSubDivision(client, authorityId, code, `${name} General`, discipline);
      created.subDivisions.push(ref);
    }
  }

  for (const [authCode, name, discipline] of SUB_DIVISIONS) {
    const auth = await client.query(
      'SELECT id FROM authorities WHERE code = $1 AND deleted_at IS NULL',
      [authCode]
    );
    const authorityId = auth.rows[0]?.id;
    // A missing parent means the register is shaped differently than expected;
    // skip rather than invent an authority as a side effect.
    if (!authorityId) continue;
    const exists = await client.query(
      `SELECT 1 FROM sub_divisions
        WHERE authority_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL
        LIMIT 1`,
      [authorityId, name]
    );
    if (exists.rows[0]) continue;
    const ref = await addSubDivision(client, authorityId, authCode, name, discipline);
    created.subDivisions.push(ref);
  }

  return created;
}

module.exports = { ensureEngagementStakeholders, AUTHORITIES, SUB_DIVISIONS };
