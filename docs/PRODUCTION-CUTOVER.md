# Production go-live checklist (manual steps)

Everything here is a **manual step only you can do** — dashboard clicks and
account settings no code change can perform. Work top to bottom. Until the
Database + Auth sections are done, **real hospital signups will fail in
production.**

---

## 1. Database — bring the HOSTED project up to date

The hosted database needs, in order (all idempotent):

```bash
supabase login
supabase link --project-ref ftudvptmhblydmrsmazw
supabase db execute --file packages/db/migrations/2026-07-phase21-demographics-ros.sql --linked   # if not yet applied
supabase db execute --file packages/db/migrations/2026-07-notifications.sql --linked              # if not yet applied
supabase db execute --file packages/db/migrations/2026-07-merge-overhaul.sql --linked             # the merge top-up
```

Fresh project instead? One shot: `supabase db execute --file packages/db/schema.sql --linked`
(the full schema includes everything the migrations add).

## 2. Google sign-in (hospital owners)

**Google Cloud Console → Credentials → OAuth client (Web):**
- Authorized redirect URIs: add `https://ftudvptmhblydmrsmazw.supabase.co/auth/v1/callback` (keep the local `http://127.0.0.1:54321/auth/v1/callback`).
- Authorized JavaScript origins: add `https://<yourdomain>`.
- OAuth consent screen → **Publish app** (needs privacy policy URL, terms URL, authorized domain, logo).

**Supabase dashboard → Authentication → Providers → Google:** enable, paste
Client ID + Secret. (Never set `skip_nonce_check` in production.)

## 3. Auth URLs + email

**Authentication → URL Configuration:** Site URL = `https://<yourdomain>`;
add `https://<yourdomain>/auth/callback` to Redirect URLs.

**Email codes:** the app sends owner OTP codes through **Resend**
(`lib/email/resend.ts`) — set `RESEND_API_KEY`, `RESEND_FROM` (and optionally
`RESEND_REPLY_TO`) in the hosting env, with a verified sending domain
(SPF/DKIM/DMARC). Also check Authentication → Email Templates → Magic Link
uses `{{ .Token }}` for the built-in fallback path.

## 4. Vercel — TWO projects from this one repo

**Hospital app** (`@careflow/web`):
- Root Directory: **`apps/web`**
- Env vars (Production): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `RESEND_API_KEY`, `RESEND_FROM`.
- Do NOT set `ALLOW_LEGACY_PROVISIONING` (keeps the legacy unauthenticated
  signup path disabled).

**Owner console** (`@careflow/owner-console`) — optional, deploy when ready:
- Root Directory: **`apps/owner-console`**
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `PLATFORM_ADMIN_EMAILS` (comma-separated
  allowlist of your own login emails).
- Protect it further (Vercel password/SSO) if you like — it is the
  highest-privilege surface.

## 5. Web push (notifications)

The `send-push` Edge Function needs deploying + VAPID keys:
```bash
supabase functions deploy send-push --linked
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... --linked
```
(Reuse the keys already configured locally if you generated them; otherwise
`npx web-push generate-vapid-keys`.) Set the public key in the web app env if
the code reads it from env (check `notifications-client.ts` usage).

## 6. Audit-log cleanup schedule (recommended)

Dashboard → Database → Extensions: enable `pg_cron`, then in SQL editor:
```sql
select cron.schedule('prune-audit-log', '0 3 1 * *',
                     $$select prune_audit_log(24)$$);
```

## 7. Faster sign-ins at scale (optional)

Authentication → Hooks → Custom Access Token hook: copy the user's staff
`hospital_id` and `role` into `app_metadata` claims named `hospital_id` and
`staff_role`. The database helpers already prefer these claims and fall back
to a lookup — a pure speed-up, safe to skip or add later.

---

### After go-live smoke test (10 minutes)

1. Owner signup via Google → create hospital → land on the board.
2. Owner signup via email code → same.
3. Admin creates a staff login → staff signs in; admin resets a password.
4. Two browsers, same hospital: an edit in one appears in the other within
   seconds; the notification bell fires on a doctor→nurse event.
5. Airplane-mode an edit → back online → cloud icon settles; sync panel clean.
6. Intake with demographics → doctor: Background + ROS → compiled summary in
   the consultation; discharge → follow-up tasks appear on /follow-ups.
7. Billing: settle flow (two-step confirm); reports: register + long-range
   with server fill-in.
8. Owner console (if deployed): tenant list loads; suspend a test hospital →
   its writes are blocked, reads still work.
