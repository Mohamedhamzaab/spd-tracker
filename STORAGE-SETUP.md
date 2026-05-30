# Give the app a permanent document locker (Cloudflare R2)

Plain-English setup. ~10 minutes of clicking. No code. Two halves:
**(A)** make the locker in Cloudflare, **(B)** tell Render about it.

You'll end up copying **4 values** from Cloudflare and pasting them into Render.

---

## A. Make the locker (Cloudflare)

1. Go to **dash.cloudflare.com** → sign in (same account as your
   ecgportal.dev domain).
2. Left sidebar → **R2**.
   - First time only: Cloudflare asks you to **add a payment card to
     activate R2**. You still pay **$0** within the free allowance (10 GB
     storage, plenty for documents). The card is just to switch it on.
3. Click **Create bucket**.
   - **Name:** `spd-tracker-docs`
   - **Location:** leave on **Automatic**.
   - Click **Create bucket**. ✅ Locker made.
4. Find your **Account ID**:
   - On the R2 page, top-right (or R2 → Overview) there's an **Account ID** —
     a long string of letters/numbers. **Copy it.** → this is **VALUE 1**.
5. Make a key so the app can open the locker:
   - R2 → **Manage R2 API Tokens** → **Create API token**.
   - **Permissions:** choose **Object Read & Write**.
   - (Optional) scope it to "Apply to specific buckets only" → pick
     `spd-tracker-docs`.
   - Click **Create**. Cloudflare shows two secrets **once**:
     - **Access Key ID** → **VALUE 2** (copy it)
     - **Secret Access Key** → **VALUE 3** (copy it — you can't see it again)

So you now have:
| | What it is | Example |
|---|---|---|
| VALUE 1 | Account ID | `a1b2c3d4e5f6...` |
| VALUE 2 | Access Key ID | `f00ba7...` |
| VALUE 3 | Secret Access Key | `Zx9...` (long) |

---

## B. Tell Render about the locker

1. Go to **dashboard.render.com** → open the **spd-tracker** web service.
2. Left menu → **Environment** → you'll see a list of "Environment Variables".
3. Add / set these **six** keys (click **Add Environment Variable** for each).
   Four are fixed text; the others use your copied values:

   | Key | Value |
   |---|---|
   | `STORAGE_BACKEND` | `s3` |
   | `S3_BUCKET` | `spd-tracker-docs` |
   | `S3_REGION` | `auto` |
   | `S3_ENDPOINT` | `https://VALUE1.r2.cloudflarestorage.com`  ← paste VALUE 1 where it says VALUE1 |
   | `S3_ACCESS_KEY_ID` | VALUE 2 |
   | `S3_SECRET_ACCESS_KEY` | VALUE 3 |

   (If `STORAGE_BACKEND` already exists and says `disk`, just change it to `s3`.)
4. Click **Save Changes**. Render redeploys automatically (~2–3 min).

---

## C. Check it worked
1. Wait for the deploy to finish (Render shows "Live").
2. In the app, open any communication or meeting → **upload a document**.
3. **Redeploy or restart** the service once, then download that document
   again. If it still downloads → 🎉 it's living in the permanent locker.

That's it. From now on every uploaded document is safe, downloads still go
through the app (so they stay private + audit-logged), and your space is
effectively unlimited (free up to 10 GB, then about 1.5 US cents per GB/month).

---

### Notes
- Existing files that were on the old temporary disk (if any) can be copied
  over with `npm run migrate-uploads` — but there likely aren't any worth
  keeping, since the old disk wasn't permanent.
- Nothing about how you use the site changes. Same upload button, same
  download — the files just have a real home now.
