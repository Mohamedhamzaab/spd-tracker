# SPD Tracker — Roadmap & Expansion Plan

Live at **https://ecgportal.dev**. This file tracks what's shipped, what's
deferred from the security/feature sweeps, and candidate future work. Ordered
by value-to-effort within each tier.

---

## Shipped

3D landing · auth rework (super_admin/admin/reviewer, invite, forgot/reset,
change-password) · mandatory TOTP MFA + backup codes · per-IP rate-limit +
per-user lockout · helmet · unified audit log + UI + per-record feed ·
soft-delete + Trash (restore/purge) · S3/R2 storage abstraction · Excel + PDF
exports · Postgres full-text search + filter bars · saved views · weekly
digest email · structured logging (pino) + Sentry · SSE live updates ·
comments + tasks · EN/AR i18n + RTL scaffold · reply-to linkage + threads.

---

## Deferred from the security sweep (recommended next)

These came out of the full security audit. None are live-exploitable today,
but each closes a real gap. Rough effort in parentheses.

1. **Session token → httpOnly cookie + CSRF** *(M, ~1 session)*. The JWT lives
   in `localStorage` today, so any future XSS could exfiltrate it. Moving to an
   httpOnly+Secure+SameSite cookie removes that class of risk. Requires a CSRF
   token on mutations and a small change to `api.js` + `requireAuth`.
2. **Per-user MFA-failure lockout** *(S)*. TOTP verify is per-IP rate-limited
   but has no per-account cap; a distributed attacker faces no account-level
   throttle. Mirror the password lockout (`failed_mfa_count` / `mfa_locked_until`).
3. **Explicit production CSP** *(S)*. Helmet's default CSP is on in prod, but an
   explicit `directives` block (script-src 'self', etc.) reviewed against the
   built bundle is stronger — especially as the XSS mitigation for item 1.
4. **Upload MIME allow-list + magic-byte sniff** *(S)*. Today only file size is
   capped. Restrict to expected document types; never serve `inline`.
5. **DB TLS cert verification** *(S)*. `db.js` uses `rejectUnauthorized:false`
   (standard for Render's self-signed chain). Pin the provider CA bundle.
6. **Strip IP/user-agent from per-record audit feed for non-super-admins** *(S)*.

---

## Feature expansion candidates

### Tier 1 — high value, modest effort
- **Dashboard upgrades** *(M)*: response-time KPIs (avg days to reply per
  authority), an activity sparkline per authority, and saved-view-driven
  tiles ("My overdue: 7").
- **In-app notifications** *(M)*: a bell with unread count — fired when you're
  assigned a task, @-mentioned in a comment, or an outbound goes overdue. The
  SSE bus + audit events already exist to drive it.
- **Bulk operations** *(M)*: multi-select on list pages → bulk export, bulk
  task-assign, bulk soft-delete.
- **CSV import** *(M)*: backfill communications / sub-divisions from the legacy
  Excel tracker; column-map UI + dry-run preview.

### Tier 2 — strategic
- **Outbound letter generation** *(M-L)*: produce a formatted PDF letter from a
  Communication (ECG letterhead, reference, body) — the actual artefact sent to
  authorities, logged back onto the record.
- **Full i18n coverage** *(M)*: extend `t()` from the 5 wired surfaces to the
  whole tracker UI; the EN/AR locale files + RTL are already in place.
- **A11y pass** *(S-M)*: WCAG 2.1 AA — focus rings, ARIA on the custom
  table-sort + chips, contrast check, keyboard traversal of modals.
- **Per-authority SLA / escalation rules** *(M)*: configurable overdue windows
  per authority (not the global 7-day rule), with escalation contacts.

### Tier 3 — scale & polish
- **Automated test suite** *(M-L)*: Vitest + Supertest on the auth, gate,
  soft-delete, and export paths; wire to CI before the next big change.
- **Pagination + server-side sort** on the registers once data volume grows
  (currently full result sets; fine at present scale).
- **Document preview** *(M)*: inline PDF/image preview in the detail modal.
- **Audit-log export + retention policy** *(S)*.

---

## Notes
- The weekly digest is built but `DIGEST_ENABLED=false` by default — flip it in
  Render when ready.
- Object storage defaults to `disk`; switch `STORAGE_BACKEND=s3` + run
  `npm run migrate-uploads` before relying on uploads surviving redeploys.
