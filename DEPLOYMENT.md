# Deployment Guide - Authority Engagement Tracker

This guide is for ECG IT. It covers putting the platform onto an ECG-hosted
server, securing it, and keeping it backed up.

The platform is two parts that run as **one process**: the Node API server
also serves the built React front end. So there is one service to run and one
port to expose.

---

## 1. Prerequisites

On the server that will host the platform:

- **Node.js 18 or newer** (`node --version` to check)
- **PostgreSQL 14 or newer** - either on the same server or a managed instance
- Outbound internet access for the one-time `npm install`

The platform has no other runtime dependencies.

---

## 2. Provision the database

Create a database and a dedicated user. Connected to PostgreSQL as an admin:

```sql
CREATE ROLE spd_user WITH LOGIN PASSWORD 'use-a-strong-password-here';
CREATE DATABASE spd_tracker OWNER spd_user;
GRANT ALL PRIVILEGES ON DATABASE spd_tracker TO spd_user;
```

Note the host, port, database name, user and password - they go into the
backend configuration next.

---

## 3. Configure the backend

In the `backend` folder, copy the example configuration and edit it:

```bash
cd backend
cp .env.example .env
```

Open `.env` and set real values. Every variable marked **required** must be
set in production — the server refuses to start otherwise, or the feature
that depends on it silently degrades. Variables marked *optional* have safe
defaults.

**Database** (required)
- `DATABASE_URL` - the full connection string, for example
  `postgres://spd_user:the-password@db-host:5432/spd_tracker`.
  (Or leave `DATABASE_URL` blank and set the individual `PGHOST` / `PGPORT` /
  `PGDATABASE` / `PGUSER` / `PGPASSWORD` values instead.)

**Auth secrets** (required)
- `JWT_SECRET` - signs every login JWT. The server refuses to start without
  this when `NODE_ENV=production`. Generate one:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `MFA_ENC_KEY` - 32 raw bytes, base64-encoded. Encrypts every user's TOTP
  secret at rest in the database. Required in production. Generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  **Treat this like a database password.** Losing it makes every enrolled
  MFA secret unrecoverable — users would need to re-enrol via super-admin
  `Clear MFA` + sign-in. Rotating it requires the same — see section 9.

**Outbound mail** (required for invitations and password resets)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — anything
  nodemailer supports works: Gmail with an app password, SES, Mailtrap,
  ECG's own mail server. `SMTP_SECURE=true` for port 465, otherwise STARTTLS.
- `APP_URL` - the public URL of the frontend, no trailing slash. Used to
  build invite and reset links inside outgoing emails
  (e.g. `https://spd-tracker.ecg.example`).

When `SMTP_HOST` is unset the server still runs but logs every outbound
email to its console instead of sending it — handy in dev, useless in
production. The startup log warns when this happens.

**Runtime** (optional)
- `PORT` - the port the platform listens on (default `4000`).
- `JWT_EXPIRES_IN` - how long a sign-in lasts (default `12h`).
- `UPLOAD_DIR` - where uploaded documents are stored on disk (see section 6).
- `MAX_UPLOAD_MB` - largest single upload allowed (default `25`).
- `CORS_ORIGIN` - lock to the deployed front-end URL once you have one
  (default `*`).
- `BACKUP_DIR` - where `npm run backup` writes its dumps (default
  `./backups`). Use an off-platform mount in production.

The `.env` file holds secrets. It must never be committed to source control;
the supplied `.gitignore` already excludes it.

---

## 4. Install, create the tables, load the data

From the `backend` folder:

```bash
npm install            # one-time, fetches dependencies
npm run migrate        # creates the tables and views
npm run seed           # loads the 16 / 23 / 16 starting register and 4 accounts
```

**Run `npm run seed` once only, on first setup.** It is destructive by design:
it clears the data tables so the starting state is always identical. Running it
again later would discard everything entered through the platform. After this
first run, leave it alone.

---

## 5. Build the front end

From the `frontend` folder:

```bash
npm install
npm run build
```

This produces `frontend/dist`. The backend detects that folder and serves it
automatically. There is nothing to deploy separately.

---

## 6. Run the platform in production

Start it from the `backend` folder with `npm start`. For a real deployment it
should run as a managed service so it restarts on reboot or on failure.

**Option A - systemd** (typical Linux server). Create
`/etc/systemd/system/spd-tracker.service`:

```ini
[Unit]
Description=SPD Authority Engagement Tracker
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/spd-tracker/backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
User=spd
EnvironmentFile=/opt/spd-tracker/backend/.env

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spd-tracker
sudo systemctl status spd-tracker
```

**Option B - a process manager** such as PM2:

```bash
npm install -g pm2
cd backend
pm2 start src/server.js --name spd-tracker
pm2 save && pm2 startup
```

Either way, confirm it is alive by requesting the health check:
`http://the-server:4000/api/health` should return `{"ok":true,...}`.

### Uploaded documents

Documents that users upload are stored as files in the `UPLOAD_DIR` folder
(default `backend/uploads`). This folder is **not** in the database and **not**
in source control. It must:

- live on persistent storage (a real disk or a mounted volume - not a
  container layer that is wiped on redeploy), and
- be included in the backup routine (section 9).

If you redeploy by replacing the project folder, preserve `UPLOAD_DIR` or point
it at a path outside the project folder so uploads survive.

**On Render's free tier, the disk is wiped on every redeploy.** Switch to
object storage before going live — see §6a.

### 6a. Object storage (S3 / Cloudflare R2 / MinIO)

For any deployment where the runtime filesystem isn't persistent (Render
free tier, Fly volumes that get reset, Heroku, containers without a mounted
volume), point uploads at object storage. The platform speaks the S3 API,
so any S3-compatible provider works.

Set the following in `.env`:

```
STORAGE_BACKEND=s3
S3_BUCKET=spd-tracker-prod
S3_REGION=auto                # e.g. eu-west-1 for AWS, "auto" for R2
S3_ENDPOINT=https://...       # required for R2 / MinIO; leave blank for AWS
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false     # true for MinIO
S3_KEY_PREFIX=documents/
```

Bucket settings: **private** (block all public access), versioning enabled
is recommended. Files only become accessible by hitting
`GET /api/documents/:id/download` over the authenticated API — the bucket
itself never serves them.

If you're flipping a live deployment from disk to S3 with documents already
on disk, run the one-shot migrator afterwards:

```bash
cd backend
npm run migrate-uploads
```

The script walks every `documents` row still flagged `storage_backend=disk`,
uploads its file to the bucket, and updates the flag. Safe to re-run — rows
already on S3 are skipped. Missing source files are reported and left as
historical placeholders (the database row stays, but the download will
return 410).

---

## 7. Security hardening - do this before sharing the platform

### 7a. Rotate the seeded super-admin password immediately

The seed creates one **super-admin** plus a handful of pre-existing demo
accounts whose passwords are listed in `README.md`. **Sign in as the
super-admin once and change its password before letting anyone else near
the URL.** The seed marks every starter account with
`password_must_change = TRUE`, so the change-password screen is forced
on first sign-in.

After the super-admin's password is rotated, delete or disable the demo
accounts you don't need from the **Users** page in the app:

- Navigate to *Administration → Users* (visible only to super-admin).
- For each demo account, click **Delete** or **Edit → Disabled**.
- Invite the real ECG / Egis / Safari Park Doha users with **Invite user**;
  they receive a one-hour email with a "set your password" link.

### 7b. Manage accounts from the Users page, not from SQL

All account lifecycle is now done in the app:

- **Invite user** — creates the row, emails a 72-hour invitation link.
- **Edit** — change role, organisation, or disable.
- **Force reset** — bumps the user's token_version (kicks every device)
  and emails a one-hour password reset link.
- **Clear MFA** — wipes the TOTP secret so the user re-enrols on next
  sign-in. Use this when a user loses their authenticator device.
- **Delete** — permanent. The Users page refuses to delete the last
  active super-admin.

Direct SQL is no longer necessary, and bypasses the audit log. If you must,
remember that `password_hash` is now nullable (invite-pending accounts have
no hash until they accept) and that bcrypt rounds are **12**, not 10.

### 7c. Roles

- `super_admin` — manages accounts. Should be **one or two** trusted ECG
  IT staff. The Users page enforces "cannot disable or delete the only
  active super-admin" so you can't lock yourself out.
- `admin` — writes data. Use for ECG staff who log communications, log
  meetings, upload documents.
- `reviewer` — read-only. Use for Client, Egis, Safari Park Doha.

### 7d. Built-in protections to know about

These are on by default — useful to know what users will see:

- **MFA is mandatory for every role.** First sign-in routes to
  `/app/mfa-setup` which shows a QR code, eight one-time backup codes, and
  asks for the first 6-digit code to finalise. From then on every sign-in
  requires a code.
- **Password policy.** At least 12 characters and at least three of
  {lowercase, uppercase, digit, symbol}.
- **Account lockout.** Five wrong passwords in a row locks an account for
  15 minutes. The user can self-unlock via the Forgot Password flow.
- **Rate limiting.** 5 sign-in attempts per IP per 15 min, 3 forgot-password
  requests per IP per 15 min, 10 token-redemption attempts per IP per 15 min.
- **Helmet security headers.** HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, COOP, CORP are all set in production.

### 7e. Serve it over HTTPS

Logins, MFA codes, and project data must never travel over plain HTTP.
Put the platform behind something that terminates TLS:

- a reverse proxy such as nginx or Caddy with a certificate, forwarding to
  the platform's port, **or**
- an ECG hosting platform or load balancer that provides HTTPS.

Once HTTPS is in front, lock `CORS_ORIGIN` in `.env` from `*` to the exact
public URL, and set `APP_URL` to that URL too so outbound invitation /
reset links work.

### 7f. The audit log

Every auth event and every account-management action writes to the
`audit_events` table. A few useful queries:

```sql
-- Recent sign-in failures and lockouts
SELECT created_at, event_type, payload, ip
FROM audit_events
WHERE event_type LIKE 'login.%'
ORDER BY id DESC LIMIT 50;

-- Who changed whose role
SELECT created_at,
       (SELECT email FROM users WHERE id = actor_id) AS actor,
       payload->>'from' AS from_role, payload->>'to' AS to_role,
       target_id
FROM audit_events
WHERE event_type = 'user.role_changed'
ORDER BY id DESC LIMIT 50;

-- MFA enrolments and forced resets in the last 30 days
SELECT created_at, event_type, actor_id, target_id, ip
FROM audit_events
WHERE event_type IN ('mfa.enrolled', 'mfa.cleared', 'user.force_reset')
  AND created_at > now() - interval '30 days'
ORDER BY id DESC;
```

Audit rows persist when the actor is deleted (the foreign key is
`ON DELETE SET NULL`), so history survives staff turnover.

---

## 8. Updating the platform later

To apply a change to the code:

1. Replace the project files (keep `.env` and the `uploads` folder).
2. `cd backend && npm install` (only if dependencies changed).
3. `npm run migrate` - safe to run any time; it only adds what is missing and
   never drops data.
4. `cd ../frontend && npm install && npm run build`.
5. Restart the service (`sudo systemctl restart spd-tracker` or
   `pm2 restart spd-tracker`).

Do **not** run `npm run seed` again - that is first-setup only.

---

## 9. Backups

Three things need backing up. The `.env` file and the `UPLOAD_DIR` folder
are handled by your normal server-backup routine. The database has a
purpose-built script:

### 9a. Database (npm run backup)

From the `backend` folder:

```bash
npm run backup                     # writes backups/spd-tracker_<ts>.dump
npm run restore -- <path> --force  # destructive — refuses without --force
```

`backup` shells out to `pg_dump --format=custom` against the connection
string in `.env`. Custom format is compressed and `pg_restore`-compatible.
`restore` uses `pg_restore --clean --if-exists`, so existing rows are
dropped first.

Both require `pg_dump` / `pg_restore` on PATH. They ship with PostgreSQL
client tools (`brew install postgresql@16` on a Mac admin box;
`apt install postgresql-client` on Debian/Ubuntu).

**Recommended cadence:**
- **Daily**, automated via cron / systemd timer / Render cron job. Point
  `BACKUP_DIR` at an off-platform mount (S3-mounted folder, mounted volume,
  network share). Retain at least 14 days.
- **Weekly**, run `npm run restore` against a non-production database and
  verify the row counts match. A backup you have never restored is not a
  backup. Document the restore-test outcome.
- **On schema changes**, take a manual backup before running `npm run
  migrate`.

A bare-bones systemd timer example for nightly backups at 02:30:

```ini
# /etc/systemd/system/spd-backup.service
[Unit]
Description=SPD Tracker nightly database backup

[Service]
Type=oneshot
User=spd
WorkingDirectory=/opt/spd-tracker/backend
ExecStart=/usr/bin/npm run backup
Environment=BACKUP_DIR=/var/backups/spd-tracker

# /etc/systemd/system/spd-backup.timer
[Unit]
Description=Run SPD Tracker backup nightly

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

`sudo systemctl daemon-reload && sudo systemctl enable --now spd-backup.timer`.

### 9b. The `.env` file

`.env` contains `JWT_SECRET`, `MFA_ENC_KEY`, `SMTP_PASS` and the database
password. Back it up separately from the database — for example to your
team's password manager — and never commit it to git.

**Losing `MFA_ENC_KEY` makes every enrolled MFA secret unrecoverable.**
If the key is lost, sign in as super-admin and **Clear MFA** on every
account from the Users page; each user re-enrols on their next sign-in.
There is no other recovery path. Treat the key as carefully as the
database password.

### 9c. Document files

The database holds each document's name and metadata; the actual bytes
live in your chosen storage backend (see §6 and §6a).

- **Disk backend.** Copy `UPLOAD_DIR` to the same backup location on the
  same schedule as the database. If you redeploy by replacing the project
  folder, preserve `UPLOAD_DIR` or point it at a path outside the project
  folder so uploads survive.
- **S3 / R2 backend.** Enable bucket versioning so deleted or overwritten
  objects are recoverable. Most providers also offer cross-region
  replication if the bucket is mission-critical. The database backup
  contains the document metadata; the bucket contains the bytes — both
  are needed together for a full restore.

---

## 10. Quick reference

| Item              | Value                                                 |
|-------------------|-------------------------------------------------------|
| Service to run    | `node src/server.js` in the `backend` folder          |
| Default port      | 4000 (set by `PORT` in `.env`)                        |
| Health check      | `GET /api/health`                                     |
| Database setup    | `npm run migrate` then `npm run seed` (once)          |
| Front end build   | `npm run build` in the `frontend` folder              |
| Secrets file      | `backend/.env` (never commit)                         |
| Uploaded files    | `backend/uploads` (persist and back up)               |
| Daily backup      | `npm run backup` → `BACKUP_DIR` (`./backups` default) |
| Restore test      | `npm run restore -- <path> --force` (weekly)          |
| Update step       | migrate, rebuild front end, restart - never reseed    |
| User management   | Sign in as super-admin → Administration → Users       |
| Audit log         | `audit_events` table — query directly                 |

## 11. First-run checklist

In order, the first time the platform goes live:

1. ☐ `.env` populated with real `DATABASE_URL`, `JWT_SECRET`, `MFA_ENC_KEY`,
      `SMTP_*`, `APP_URL`, `CORS_ORIGIN`.
2. ☐ `STORAGE_BACKEND` set (`disk` for self-hosted with a real volume,
      `s3` + `S3_*` for any platform with an ephemeral filesystem).
      Test an upload + download before going live.
3. ☐ `npm run migrate` succeeds.
4. ☐ `npm run seed` run **once** (creates super-admin + demo accounts).
5. ☐ Frontend built (`npm run build`).
6. ☐ Service starts under systemd / PM2.
7. ☐ Health check returns 200 over HTTPS.
8. ☐ Test a real outbound email: super-admin invites yourself at a real
      address; the email arrives within seconds.
9. ☐ Sign in as super-admin (default password from README), change
      password on the forced screen, complete MFA enrollment, save backup
      codes in your password manager.
10. ☐ Invite the real ECG / Egis / Safari Park Doha users from the Users
       page.
11. ☐ Delete or disable the demo accounts (`sherif.eldaly@ecg.example` etc).
12. ☐ Daily backup timer enabled (`systemctl enable --now spd-backup.timer`).
13. ☐ Weekly restore-test scheduled.
14. ☐ `.env` and the latest backup file copied to a safe off-platform
       location.
