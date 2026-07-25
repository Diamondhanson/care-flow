# Production go-live checklist (do these by hand)

Everything in this file is a **manual step only you can do** — dashboard clicks
and account settings that no code change can perform. Work top to bottom; each
section says where to click and what to paste. Until the Database + Auth
sections are done, **real hospital signups will fail in production.**

---

## 1. Database — load the schema on the HOSTED project

The hosted database is missing everything added recently (the
`create_hospital_and_admin` signup function, `clinical_terms`,
`follow_up_tasks`, realtime streaming, the subscription write-gate…).

Easiest path — apply the whole schema (it is safe to re-run):

1. Install the Supabase CLI and log in: `supabase login`.
2. Link the repo to the hosted project (project ref is in the dashboard URL):
   ```bash
   supabase link --project-ref ftudvptmhblydmrsmazw
   ```
3. Push the schema:
   ```bash
   supabase db execute --file supabase/schema.sql --linked
   ```

Alternative (already-live database, minimal touch): run only the top-ups in
`supabase/snippets/` — `phase-18_5-verified-onboarding.sql`,
`stage-2-clinical-terms.sql`, `stage-4-realtime.sql`,
`stage-5-follow-up-tasks.sql`, `stage-6-hardening.sql` — in that order.
(Re-running the full `schema.sql` covers all of them and also refreshes the
faster row-security policies.)

## 2. Google sign-in (hospital owners)

**Google Cloud Console → APIs & Services → Credentials:**
- OAuth client (Web) → **Authorized redirect URIs**: add
  `https://ftudvptmhblydmrsmazw.supabase.co/auth/v1/callback`
  (keep the local `http://127.0.0.1:54321/auth/v1/callback` too).
- **Authorized JavaScript origins**: add `https://<yourdomain>`.
- **OAuth consent screen → Publish app** (Testing → Production) so any Google
  user can sign in without the "unverified app" warning. Requires a privacy
  policy URL, terms URL, authorized domain, and logo.

**Supabase dashboard (hosted project) → Authentication → Providers → Google:**
- Enable, paste the Client ID + Secret. (Do NOT set `skip_nonce_check` in
  production — that was a local-only workaround.)

## 3. Auth URLs + email codes

**Supabase dashboard → Authentication → URL Configuration:**
- **Site URL**: `https://<yourdomain>`
- **Redirect URLs**: add `https://<yourdomain>/auth/callback`

**Authentication → Email Templates → Magic Link:**
- Make sure the template shows `{{ .Token }}` so owners receive a **6-digit
  code**, not a link.

**SMTP (real email delivery):**
- Authentication → SMTP settings: configure a provider (e.g. Resend) with a
  verified sending domain (SPF/DKIM/DMARC), then raise the auth email rate
  limit. Without this, signup codes won't reliably reach real inboxes.

## 4. Host environment (Vercel)

Set the production env vars:
```
NEXT_PUBLIC_SUPABASE_URL=https://ftudvptmhblydmrsmazw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<hosted anon key>
SUPABASE_SERVICE_ROLE_KEY=<hosted service-role key — server-only>
```
(No code change needed for the OAuth callback — the app uses
`window.location.origin/auth/callback`, which resolves to your domain.)

## 5. Realtime (live collaboration between colleagues)

Step 1 already added every table to the realtime publication. Verify in the
dashboard: **Database → Replication → supabase_realtime** should list the
app's tables. Nothing else to click — clients subscribe automatically.

## 6. Audit-log cleanup schedule (recommended)

**Database → Extensions:** enable `pg_cron`, then in the SQL editor run:
```sql
select cron.schedule('prune-audit-log', '0 3 1 * *',
                     $$select prune_audit_log(24)$$);
```
Keeps 24 months of change history; adjust to your retention policy.

## 7. Faster sign-ins at scale (optional but recommended)

The row-security helpers can read the hospital/role from the login token
instead of querying on every request. To enable that:

**Authentication → Hooks → Custom Access Token hook** — create a hook that
copies the user's staff `hospital_id` and `role` into `app_metadata` claims
named `hospital_id` and `staff_role`. The database functions already prefer
these claims and fall back to the lookup, so this is purely a speed-up and safe
to skip or add later.

## 8. Custom auth domain (optional)

**Settings → Auth → Custom domain** (e.g. `auth.<yourdomain>`): the Google
consent screen then shows your domain instead of `supabase.co`. If you do this,
update the Google redirect URI to
`https://auth.<yourdomain>/auth/v1/callback`.

---

### After go-live smoke test (5 minutes)

1. Sign up a fresh owner via Google → create a hospital → land on the board.
2. Sign up another owner via email code → same.
3. Admin creates a staff login → staff signs in with username+password.
4. Two browsers, same hospital: a change in one appears in the other within
   seconds (realtime).
5. Turn off Wi-Fi, make an edit, turn it back on → the edit syncs and the
   cloud icon settles.
