# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project at a glance

**Safari Park Project — Authority Engagement Tracker.** A web platform that
tracks ECG's engagement with statutory authorities and utility providers on
the Safari Park Project (Design Consultancy Services, Contract No. 6).

- **Live demo:** https://ecgportal.dev
- **GitHub:** https://github.com/Mohamedhamzaab/spd-tracker

Three-level data model carried over from the prior Excel tracker:
**Authority → Sub-Division → Communication**, plus separate Meetings and
Documents.

## Stack

| Layer       | Tech                                  |
|-------------|---------------------------------------|
| Database    | PostgreSQL (18 on Render, 14+ locally OK) |
| API         | Node.js (>=18) + Express              |
| Frontend    | React 18 + Vite 5 + React Router 6    |
| Auth        | bcryptjs + jsonwebtoken (JWT, 12h)    |
| Uploads     | multer to disk (UPLOAD_DIR)           |

The backend serves the built frontend (`frontend/dist`) in production, so
the deployed platform runs as **one Node process on one port**.

## Repo layout

```
spd-tracker/
├── backend/
│   ├── src/
│   │   ├── server.js        # express app, route mounts, serves frontend/dist
│   │   ├── init.js          # prod startup: migrate, seed-if-empty, then server
│   │   ├── migrate.js       # applies schema.sql (idempotent)
│   │   ├── seed.js          # loads starting register (DESTRUCTIVE - wipes data tables)
│   │   ├── schema.sql       # all tables, views, triggers
│   │   ├── seed_data.json   # 16 authorities / 23 sub-divisions / 16 communications
│   │   ├── db.js            # pg Pool, SSL auto-enabled for non-localhost
│   │   ├── auth.js          # /api/auth router + requireAuth middleware
│   │   ├── helpers.js
│   │   └── routes/          # authorities, subdivisions, communications, meetings,
│   │                        #   documents, dashboard, lists
│   ├── uploads/             # runtime only - gitignored, not in DB
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── main.jsx, App.jsx
│   │   ├── lib/
│   │   │   ├── api.js       # fetch wrapper, token in localStorage
│   │   │   └── store.jsx    # session/auth context
│   │   ├── components/ui.jsx
│   │   ├── pages/           # Dashboard, Authorities, AuthorityDetail,
│   │   │                    #   SubDivisions, SubDivisionDetail,
│   │   │                    #   Communications, Meetings, Login
│   │   └── styles.css
│   ├── index.html
│   ├── vite.config.js       # proxies /api → :4000 in dev
│   └── package.json
├── render.yaml              # Render Blueprint - DB + web service + env vars
├── README.md
└── DEPLOYMENT.md            # production deploy guide (also see render.yaml)
```

## Dev commands

Two terminals, two folders:

```bash
# Terminal 1 - backend (API on :4000)
cd backend
npm install
cp .env.example .env             # only the first time; then edit values
npm run migrate                  # create tables (idempotent)
npm run seed                     # ONE-TIME - loads 16/23/16 starter data; destructive on rerun
npm run dev                      # node --watch reload on save

# Terminal 2 - frontend (Vite on :5173, proxies /api → :4000)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in with one of the seeded accounts
(see README for emails; passwords are `ChangeMe-Editor-1`, `-2`, `-Viewer-1`,
`-Viewer-2`).

## Conventions and gotchas

- **`npm run seed` is destructive.** It truncates the five data tables to
  guarantee a clean starting state. Use it ONCE on first setup, never again
  on a real DB. The Render production deploy uses `init.js`, which only
  seeds when the authorities table is empty.
- **`init.js` must NOT call `pool.end()`** before requiring `./server`,
  because `server.js` shares the same pool via `db.js`. Doing so produces
  `Cannot use a pool after calling end on the pool` at first query.
- **SSL on the connection pool** is auto-enabled in `db.js` whenever the
  host in `DATABASE_URL` is not localhost (or you set `PGSSL=true`).
  Hosted Postgres providers (Render, Neon, Supabase) need this.
- **Frontend dev needs `--include=dev` only on hosted deploys** where
  `NODE_ENV=production` is set — Vite is in `devDependencies`. Local dev is
  fine because NODE_ENV isn't set.
- **Token storage.** Frontend keeps the JWT in `localStorage` under
  `spd_token`. `api.js#req()` adds the `Authorization: Bearer ...` header.
- **Routing.** The Express app mounts `/api/auth` open and everything else
  under `/api` behind `requireAuth`. Unknown `/api/*` returns 404 JSON; any
  other path falls through to `frontend/dist/index.html` (SPA fallback).
- **Roles.** `editor` (ECG staff) can write; `viewer` (Client/Egis/Safari
  Park Doha) is read-only. Enforced server-side per route via
  `requireEditor` in `helpers.js`.
- **Engagement rules** (the four-step ladder and the 7-day overdue rule)
  are computed in the database via views, not in JS. Look in `schema.sql`
  before reimplementing logic in routes.
- **Uploads are ephemeral on Render free tier** (no persistent disk).
  Local dev keeps them in `backend/uploads/` which is gitignored.

## Migration approach

`migrate.js` runs `schema.sql` end to end. Every CREATE uses
`IF NOT EXISTS` / `CREATE OR REPLACE`, so it's safe to run any time and
serves as the canonical schema. To add a column or index, edit `schema.sql`
in place. To do something destructive (drop column, rename, data migration),
add an explicit migration script — don't put `DROP` into `schema.sql`.

## Production deploy

`render.yaml` defines a free-tier Blueprint with one Postgres + one web
service. Pushes to `main` auto-deploy on Render. If you change the
`buildCommand` or env vars in `render.yaml`, click **Manual sync** on the
Blueprint page so Render re-reads it — auto-deploy alone won't pick up
config-as-code changes.

Production start command is `npm run start:prod` which runs `init.js`:
applies schema, seeds only if the DB is empty, then starts the server.

## i18n pattern

Two locales: **en** (default) and **ar** (RTL). The infrastructure is in
`frontend/src/lib/i18n.js` (i18next + react-i18next), with translation
files at `frontend/src/locales/{en,ar}.json`. Only the high-traffic
surfaces are wired so far (Login, sidebar nav, landing page); the rest of
the app is still hard-coded English.

**To translate a new surface:**

1. Add matching keys to both `en.json` and `ar.json`.
2. In the component:
   ```js
   import { useTranslation } from 'react-i18next';
   const { t } = useTranslation();
   ```
   Replace literals with `t('namespace.key')` or `t('namespace.key', { name })`.
3. No other code changes — `<html dir>` and persistence in localStorage
   are already handled in `lib/i18n.js`.

The Arabic file should have the same shape as the English one. Until a
proper translation pass lands, placeholder English values are acceptable
(they make untranslated strings obvious).

## What's open for development

The platform is working end-to-end but there are clear next steps. Some
candidates Claude Code can help with:

- Replace seed placeholder emails with real ECG/Egis/Safari Park addresses,
  and rotate passwords away from `ChangeMe-*` defaults.
- Persistent upload storage (S3 / R2 / Render disk) so attached documents
  survive redeploys.
- Email notifications on overdue communications (7-day rule already in DB).
- Audit log / activity history on each authority and communication.
- Excel/PDF export of the engagement register.
- Bulk import for sub-divisions and communications from CSV.
- Search and filter improvements (multi-status, date ranges) on every list page.
- Mobile-responsive layout pass.
