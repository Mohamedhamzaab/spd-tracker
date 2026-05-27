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

Open `.env` and set real values:

- `DATABASE_URL` - the full connection string, for example
  `postgres://spd_user:the-password@db-host:5432/spd_tracker`.
  (Or leave `DATABASE_URL` blank and set the individual `PGHOST` / `PGPORT` /
  `PGDATABASE` / `PGUSER` / `PGPASSWORD` values instead.)
- `JWT_SECRET` - a long random string that signs login tokens. Generate one:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

  Paste the output as the value. Keep it secret. If it changes later, everyone
  is simply signed out and signs in again.
- `PORT` - the port the platform listens on (default `4000`).
- `UPLOAD_DIR` - where uploaded documents are stored on disk (see section 6).
- `MAX_UPLOAD_MB` - largest single upload allowed (default `25`).

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

---

## 7. Security hardening - do this before sharing the platform

### 7a. Change the default account passwords

The seed creates four accounts with **placeholder passwords that are written
in the README**. They must be changed.

For each account, generate a bcrypt hash of the new password (run from the
`backend` folder, which already has the `bcryptjs` library):

```bash
node -e "console.log(require('bcryptjs').hashSync('the-new-password', 10))"
```

Then set it in the database:

```sql
UPDATE users SET password_hash = 'paste-the-hash-here'
WHERE email = 'sherif.eldaly@ecg.example';
```

Repeat for each account.

### 7b. Replace the placeholder email addresses

The four seeded accounts use `.example` email addresses. Replace them with the
real addresses of the people who will use the platform:

```sql
UPDATE users SET email = 'real.person@ecg.com',  name = 'Real Name'
WHERE email = 'sherif.eldaly@ecg.example';
```

Email is the login identifier, so use the address each person will sign in
with. Keep `role` as `editor` for ECG staff and `viewer` for Client, Egis and
Safari Park Doha.

### 7c. Adding or removing people later

To add a user, insert a row with a bcrypt-hashed password:

```sql
INSERT INTO users (name, email, password_hash, role, organisation)
VALUES ('New Person', 'new.person@egis.com',
        'paste-a-bcrypt-hash-here', 'viewer', 'Egis');
```

To stop someone signing in without deleting their history, set them inactive:

```sql
UPDATE users SET is_active = false WHERE email = 'left@ecg.com';
```

### 7d. Serve it over HTTPS

Logins and project data must not travel over plain HTTP. Put the platform
behind something that terminates TLS:

- a reverse proxy such as nginx or Caddy with a certificate, forwarding to the
  platform's port, **or**
- an ECG hosting platform or load balancer that provides HTTPS.

Once HTTPS is in front, you may narrow `CORS_ORIGIN` in `.env` from `*` to the
exact public URL.

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

Two things need backing up.

**The database** - schedule a regular dump:

```bash
pg_dump "postgres://spd_user:the-password@db-host:5432/spd_tracker" \
  > spd_tracker_$(date +%Y%m%d).sql
```

To restore into an empty database: `psql "connection-string" < the-dump.sql`.

**The uploads folder** - copy `UPLOAD_DIR` to the same backup location on the
same schedule. The database holds each document's name and details; the actual
files live in that folder, so both are needed together.

---

## 10. Quick reference

| Item              | Value                                            |
|-------------------|--------------------------------------------------|
| Service to run    | `node src/server.js` in the `backend` folder     |
| Default port      | 4000 (set by `PORT` in `.env`)                   |
| Health check      | `GET /api/health`                                |
| Database setup    | `npm run migrate` then `npm run seed` (once)     |
| Front end build   | `npm run build` in the `frontend` folder         |
| Secrets file      | `backend/.env` (never commit)                    |
| Uploaded files    | `backend/uploads` (persist and back up)          |
| Update step       | migrate, rebuild front end, restart - never reseed |
