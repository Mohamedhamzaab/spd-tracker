# Safari Park Project - Authority Engagement Tracker

A web platform that tracks ECG's engagement with statutory authorities and
utility providers on the Safari Park Project (Design Consultancy Services,
Contract No. 6).

ECG staff log communications, sub-divisions and meetings. The Client, Egis
and Safari Park Doha sign in to a live, read-only view of the same data.

This is the web platform that succeeds the Excel tracker. The data model is
the same three-level structure - **Authority - Sub-Division - Communication** -
carried over directly, including the starting register of 16 authorities,
23 sub-divisions and 16 communications.

---

## What it does

- **Dashboard** - live KPIs, the engagement ladder, authorities by category,
  a meetings summary, and a date-window period view.
- **Authorities** - the parent register, with a Quick-Add panel that suggests
  a short code from the authority name.
- **Sub-Divisions** - each belongs to one authority; the sequence number and
  reference (for example `KM-S03`) are assigned automatically.
- **Communications** - one row per event; an inbound reply links to the
  outbound item it answers, which clears the overdue flag.
- **Meetings** - the register; the Primary Sub-Division list is filtered to
  the chosen authority's sub-divisions only.
- **Documents** - files upload into the platform and attach to a communication
  or a meeting; an optional ACC link field is also available on each.
- **Roles** - `editor` (ECG) may add and change data; `viewer` (Client, Egis,
  Safari Park Doha) has read-only access. Every user has an individual login.

The engagement rules - the four-step ladder and the seven-day overdue rule -
are computed in the database, so they stay consistent everywhere.

---

## How it is built

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Database  | PostgreSQL                              |
| API       | Node.js with Express                    |
| Front end | React, built with Vite                  |
| Auth      | Individual logins, bcrypt + JSON Web Token |

The project is two folders:

```
spd-tracker/
  backend/    Express API, database schema, seed data
  frontend/   React single-page application
```

In production the backend also serves the built front end, so the whole
platform runs as **one process on one port**.

---

## Running it

Deployment is a one-time task for ECG IT. Full step-by-step instructions,
including production hosting and security hardening, are in **DEPLOYMENT.md**.

The short version for a local trial:

```bash
# 1. Database - create a Postgres database and a user

# 2. Backend
cd backend
cp .env.example .env          # then edit .env with real values
npm install
npm run migrate               # create the tables
npm run seed                  # load the 16 / 23 / 16 starting data
npm start                     # API on http://localhost:4000

# 3. Front end
cd ../frontend
npm install
npm run build                 # output goes to frontend/dist

# The backend serves frontend/dist automatically.
# Open http://localhost:4000
```

For day-to-day development with hot reload, run `npm run dev` in the frontend
folder (front end on port 5173, proxying the API on 4000).

---

## Starting accounts

The seed creates five accounts. **The passwords below are first-login
defaults and must be changed before the platform is shared** — every seeded
account is flagged `password_must_change`, so the change-password screen is
forced on first sign-in. See DEPLOYMENT.md.

| Role         | Email                              | Default password        |
|--------------|------------------------------------|-------------------------|
| Super-admin  | superadmin@ecg.example             | ChangeMe-Super-1        |
| Admin        | sherif.eldaly@ecg.example          | ChangeMe-Admin-1        |
| Admin        | spd.admin@ecg.example              | ChangeMe-Admin-2        |
| Reviewer     | reviewer@egis.example              | ChangeMe-Reviewer-1     |
| Reviewer     | client@safariparkdoha.example      | ChangeMe-Reviewer-2     |

After signing in as the super-admin and finishing MFA enrollment, invite the
real ECG / Egis / Safari Park Doha users from the **Users** page
(Administration → Users), then delete or disable the demo accounts you don't
need. Roles:

- **super_admin** — manages accounts (invite, change role, force reset,
  clear MFA, delete). One or two trusted ECG IT staff.
- **admin** — writes data. ECG staff who log communications, meetings,
  documents.
- **reviewer** — read-only. Client, Egis, Safari Park Doha.

---

## A note on this delivery

The complete codebase is included and has been tested against a live
PostgreSQL database: the schema, the seed, every API endpoint, the role
permissions, file upload and download, and the production server serving the
built front end. What remains is deployment onto ECG infrastructure, which
only ECG IT can do because it needs ECG's own hosting and accounts.
