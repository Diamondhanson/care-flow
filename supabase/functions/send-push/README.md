# CareFlow Web Push (`send-push`)

Delivers OS-level push notifications to staff when their app is backgrounded or
closed. The in-app bell works **without** any of this — push is the extra reach.

## How it fits together

```
doctor's action → notifications row (synced via outbox)
      │
      ├─ Supabase Realtime ─────────────► recipient's OPEN tab → bell updates live
      │
      └─ Database Webhook on INSERT ────► send-push Edge Function
                                                │ reads push_subscriptions (service role)
                                                └─► Web Push ─► recipient's device (app closed)
```

## One-time setup

### 1. Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

Copy the **public** and **private** keys.

### 2. Expose the public key to the web app

Add to `apps/web` env (build-time, safe to ship):

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
```

The bell's "Enable push alerts" button uses it to subscribe the device.

### 3. Set the Edge Function secrets

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:ops@your-hospital.example
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### 4. Deploy the function

```bash
supabase functions deploy send-push --no-verify-jwt
```

`--no-verify-jwt` because it is called by a Database Webhook, not an end user.

### 5. Create the Database Webhook

Dashboard → **Database → Webhooks → Create**:

- Table: `public.notifications`
- Events: **Insert**
- Type: **Supabase Edge Function** → `send-push`

Now every inserted notification triggers a push to the recipient's devices.

## Notes

- **iOS** delivers Web Push only when CareFlow is installed to the Home Screen
  (iOS 16.4+). Desktop and Android work in the browser once permission is
  granted.
- Expired endpoints (HTTP 404/410) are pruned automatically on send.
- The migration `packages/db/migrations/2026-07-notifications.sql` must be
  applied to the hosted project first (creates `notifications`,
  `push_subscriptions`, RLS, and adds `notifications` to the realtime
  publication).
