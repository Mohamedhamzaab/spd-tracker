// ---------------------------------------------------------------------------
//  Seed  -  loads the starting accounts and the real project register
//  (16 authorities, 23 sub-divisions, 16 communications) carried over from
//  the Excel tracker. Run once on a fresh database.
//
//  Usage:  npm run seed
//
//  This is destructive: it clears the five data tables first so a re-run
//  always produces the same known starting state. It does NOT touch any
//  rows added later through the application unless re-run deliberately.
// ---------------------------------------------------------------------------
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('./db');

// Starting accounts. Passwords here are first-login defaults and MUST be
// changed by ECG IT before the platform is shared. See README.
// password_must_change is set TRUE on every seeded account so the first
// sign-in goes straight into the change-password flow.
const USERS = [
  {
    name: 'Mohamed Hamza',
    email: 'mohamedhamza.ab@gmail.com',
    password: 'ChangeMe-Super-1',
    role: 'super_admin',
    organisation: 'ECG',
  },
  {
    name: 'Sherif El Daly',
    email: 'sherif.eldaly@ecg.example',
    password: 'ChangeMe-Admin-1',
    role: 'admin',
    organisation: 'ECG',
  },
  {
    name: 'ECG Project Administrator',
    email: 'spd.admin@ecg.example',
    password: 'ChangeMe-Admin-2',
    role: 'admin',
    organisation: 'ECG',
  },
  {
    name: 'Egis Reviewer',
    email: 'reviewer@egis.example',
    password: 'ChangeMe-Reviewer-1',
    role: 'reviewer',
    organisation: 'Egis',
  },
  {
    name: 'Safari Park Doha',
    email: 'client@safariparkdoha.example',
    password: 'ChangeMe-Reviewer-2',
    role: 'reviewer',
    organisation: 'Safari Park Doha',
  },
];

const DATA = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'seed_data.json'), 'utf8')
);

async function seedUsers(client) {
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await client.query(
      `INSERT INTO users
         (name, email, password_hash, role, organisation, password_must_change)
       VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             role = EXCLUDED.role,
             organisation = EXCLUDED.organisation`,
      [u.name, u.email.toLowerCase(), hash, u.role, u.organisation]
    );
  }
  console.log(`Users ready: ${USERS.length}`);
}

async function seedRegister(client) {
  // Clear data tables for a deterministic starting state.
  await client.query(
    'TRUNCATE documents, communications, meetings, sub_divisions, authorities RESTART IDENTITY CASCADE'
  );

  // --- Authorities -------------------------------------------------------
  // seed row: [code, name, category, influence, decision, strategy, notes]
  const authIdByCode = {};
  const authIdByName = {};
  for (const a of DATA.authorities) {
    const { rows } = await client.query(
      `INSERT INTO authorities
         (code, name, category, influence_level, decision_authority,
          engagement_strategy, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [a[0], a[1], a[2], a[3], a[4], a[5], a[6]]
    );
    authIdByCode[a[0]] = rows[0].id;
    authIdByName[a[1]] = rows[0].id;
  }
  console.log(`Authorities loaded: ${DATA.authorities.length}`);

  // --- Sub-divisions -----------------------------------------------------
  // seed row: [parentName, seq, name, discipline, primaryObjective,
  //            targetStage, contact, designation, contactDetails,
  //            dataCollStatus, consultStatus, nocStatus, outcomeYesNo]
  const subIdByRef = {};
  for (const s of DATA.subs) {
    const authorityId = authIdByName[s[0]];
    if (!authorityId) throw new Error(`Unknown authority for sub-division: ${s[0]}`);
    const authCode = Object.keys(authIdByCode).find(
      (c) => authIdByCode[c] === authorityId
    );
    const seq = s[1];
    const subRef = `${authCode}-S${String(seq).padStart(2, '0')}`;
    const { rows } = await client.query(
      `INSERT INTO sub_divisions
         (authority_id, seq_no, sub_reference, name, discipline,
          primary_objective, target_stage, date_identified,
          primary_contact, designation, contact_details,
          data_collection_status, consultation_status, noc_status,
          outcome_secured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        authorityId,
        seq,
        subRef,
        s[2],
        s[3],
        s[4],
        s[5],
        '2026-04-20',
        s[6] || null,
        s[7] || null,
        s[8] || null,
        s[9],
        s[10],
        s[11],
        s[12] === 'Yes',
      ]
    );
    subIdByRef[subRef] = rows[0].id;
  }
  console.log(`Sub-divisions loaded: ${DATA.subs.length}`);

  // --- Communications ----------------------------------------------------
  // seed row: [date, direction, subRef, purpose, mode, submissionRef,
  //            inResponseToCode, summary, replyNeededYesNo]
  // Inserted in order so an Inbound row can reference an earlier comm_code.
  const commIdByCode = {};
  let n = 0;
  for (const c of DATA.comms) {
    n += 1;
    const code = `C-${String(n).padStart(4, '0')}`;
    const subId = subIdByRef[c[2]];
    if (!subId) throw new Error(`Unknown sub-division for communication: ${c[2]}`);
    let inResponseTo = null;
    if (c[6]) {
      inResponseTo = commIdByCode[c[6]] || null;
      if (!inResponseTo) {
        throw new Error(`Communication ${code} references unknown ${c[6]}`);
      }
    }
    const { rows } = await client.query(
      `INSERT INTO communications
         (comm_code, sub_division_id, comm_date, direction, purpose, mode,
          submission_reference, in_response_to, summary, reply_needed,
          logged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        code,
        subId,
        c[0],
        c[1],
        c[3] || null,
        c[4] || null,
        c[5] || null,
        inResponseTo,
        c[7] || null,
        c[8] === 'Yes',
        'S. El Daly',
      ]
    );
    commIdByCode[code] = rows[0].id;
  }
  console.log(`Communications loaded: ${DATA.comms.length}`);
}

async function main() {
  await withTransaction(async (client) => {
    await seedUsers(client);
    await seedRegister(client);
  });
  console.log('Seed complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
