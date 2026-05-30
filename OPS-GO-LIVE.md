# Go-Live Ops — ecgportal.dev

Two operational items that aren't code: (1) kill the cold-start delay, and
(2) get email out of Spam. Both are done in dashboards (Render, Brevo,
Cloudflare) — follow these in order. Values you paste from Brevo are marked
`<like-this>`.

---

## 1. Remove the "Render is initiating…" cold start

**Why it happens:** the web service is on Render's **free** plan, which
spins the container down after ~15 min idle. The next visit triggers a
~30–60s cold boot. Paid plans stay warm 24/7.

### Do this
1. Render dashboard → **spd-tracker** (the web service) → **Settings**.
2. **Instance Type** → change **Free → Starter** (~$7/mo). Save. → no more
   spin-down, no cold starts.
3. **Database** (separate concern): the free Postgres **expires after ~30
   days** (see `render.yaml` header). Before that, either:
   - upgrade **spd-tracker-db** to a paid Render Postgres (~$7/mo), or
   - move to a managed Postgres elsewhere (Neon / Supabase free tiers are
     durable) and update `DATABASE_URL` in the service env.
   Take a backup first: `cd backend && npm run backup`.

### Free-tier-only stopgap (not recommended for a client tool)
Set an uptime monitor (e.g. UptimeRobot) to GET `https://ecgportal.dev/api/health`
every 10 min. Keeps it warm-ish but doesn't help the first visit of the day
and burns the free monthly hours. The $7 Starter plan is the real fix.

---

## 2. Stop emails landing in Spam

**Why it happens:** mail is sent via Brevo with a `From:` of
`no-reply@ecgportal.dev`, but `ecgportal.dev` has **no email-auth DNS
records** vouching that Brevo may send for it. Gmail/Outlook see unverified
mail → Spam.

**The fix is three DNS records that authenticate the domain.** Once SPF +
DKIM pass and align with the domain, inbox placement jumps.

### Step A — authenticate the domain in Brevo
1. Brevo → **Senders, Domains & Dedicated IPs → Domains** → **Add a domain**
   → `ecgportal.dev` → **Authenticate**.
2. Brevo shows the exact records to add. They look like the below — **use the
   values Brevo gives you**, they're account-specific.

### Step B — add the records in Cloudflare
Cloudflare → select **ecgportal.dev** → **DNS → Records**. Add:

| Type  | Name (host)            | Value                                                        | Notes |
|-------|------------------------|--------------------------------------------------------------|-------|
| TXT   | `@` (root)             | `v=spf1 include:spf.brevo.com mx ~all`                       | SPF. If a TXT `v=spf1` already exists, **merge** — one SPF record only, add `include:spf.brevo.com`. |
| TXT   | `<brevo-dkim-host>` e.g. `mail._domainkey` | `<brevo-dkim-value>` (long `k=rsa; p=…`)         | DKIM. Brevo gives the exact host + key. |
| CNAME | `<brevo-code>._domainkey` (if Brevo uses CNAME DKIM) | `<brevo-target>.dkim.brevo.com` | Some Brevo setups use a CNAME instead of TXT for DKIM — follow what Brevo shows. |
| TXT   | `_dmarc`               | `v=DMARC1; p=none; rua=mailto:dmarc@ecgportal.dev; fo=1`     | DMARC. Start at `p=none` (monitor), tighten to `p=quarantine` then `p=reject` after a week of clean reports. |
| TXT   | `<brevo-verify-host>`  | `<brevo-verification-code>`                                  | Brevo domain-ownership check (temporary; can stay). |

**Cloudflare gotchas**
- Set these records to **DNS only** (grey cloud), *not* proxied (orange).
  Proxying mail-auth TXT/CNAME records breaks them.
- Root SPF: in the **Name** field put `@` — Cloudflare stores it as the apex.
- DKIM value is long; paste it exactly, with no added quotes or line breaks.

### Step C — verify
1. Back in Brevo, click **Verify / Authenticate** on the domain until SPF +
   DKIM show green (DNS can take minutes–hours to propagate).
2. Send yourself a test (invite a throwaway address from **Users → Invite**).
   In Gmail, open the message → **⋮ → Show original** → confirm
   **SPF: PASS**, **DKIM: PASS**, **DMARC: PASS**.
3. Mark any earlier test messages **Not spam** to nudge your own domain
   reputation.

### Step D — (optional) friendlier sender + reply-to
In the Render service env:
- `MAIL_REPLY_TO=support@ecgportal.dev` (a real, monitored inbox) — recipients
  can reply; small trust win. The code already supports this.
- Keep `SMTP_FROM=SPD Tracker <no-reply@ecgportal.dev>` (already set).

---

## Quick checklist
- [ ] Render web service → **Starter** (no cold start)
- [ ] Plan for paid/managed Postgres before the 30-day free expiry (+ a backup)
- [ ] Brevo: add + authenticate `ecgportal.dev`
- [ ] Cloudflare: SPF (TXT), DKIM (TXT/CNAME), DMARC (TXT), Brevo verify TXT — all **DNS-only**
- [ ] Brevo shows SPF + DKIM green
- [ ] Gmail "Show original" → SPF/DKIM/DMARC = PASS
- [ ] (optional) `MAIL_REPLY_TO` set in Render

Code-side deliverability (HTML+text multipart, Reply-To plumbing,
List-Unsubscribe on the digest) is already shipped — these DNS records are
the part that actually moves inbox placement.
