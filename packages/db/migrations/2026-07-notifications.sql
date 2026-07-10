-- ============================================================================
-- Notifications & Web Push  (in-app bell + PWA push)
-- Hosted migration snippet. Idempotent: safe to re-run.
--
-- ⚠️ Apply this to the hosted Supabase project BEFORE deploying the app build
-- that writes notifications: the outbox replays whole rows against these tables,
-- and against the old schema every such write fails (PGRST204) and stays queued.
--
-- Verbatim extract of the additions in packages/db/schema.sql (source of truth).
--
-- Two tables:
--   notifications      — one row per (recipient, event); the bell reads these and
--                        Supabase Realtime streams inserts to the recipient live.
--   push_subscriptions — one row per device that granted OS push permission; the
--                        `send-push` Edge Function fans out Web Push to these.
-- ============================================================================

-- ---- 1. Tables --------------------------------------------------------------

create table if not exists notifications (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  -- Who should see it. The acting client writes rows addressed to OTHER staff,
  -- so RLS allows insert-for-anyone-in-hospital but select/update only for self.
  recipient_staff_id uuid not null references staff(id) on delete cascade,
  actor_staff_id     uuid references staff(id) on delete set null,
  actor_name         text,
  -- Stable machine key (e.g. 'consultation.created'); the bell localises from
  -- this + `data`. `title`/`body` are English fallbacks used by Web Push (built
  -- server-side, where no i18n runs) and when a locale template is missing.
  type               text not null,
  title              text not null,
  body               text,
  -- What it points at, for the deep link. `entity_id` is usually the visit id.
  entity_type        text,
  entity_id          uuid,
  patient_id         uuid references patients(id) on delete set null,
  patient_name       text,
  link               text,
  data               jsonb not null default '{}'::jsonb,
  read_at            timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  staff_id     uuid not null references staff(id) on delete cascade,
  -- The PushSubscription endpoint URL uniquely identifies a browser+device.
  -- Re-subscribing upserts on it so a device never accumulates stale rows.
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---- 2. Indexes -------------------------------------------------------------

create index if not exists idx_notifications_recipient
  on notifications(recipient_staff_id, created_at desc);
create index if not exists idx_notifications_unread
  on notifications(recipient_staff_id) where read_at is null;
create index if not exists idx_notifications_hospital on notifications(hospital_id);
create index if not exists idx_push_subscriptions_staff on push_subscriptions(staff_id);

-- ---- 3. updated_at trigger (push_subscriptions) -----------------------------

drop trigger if exists trg_push_subscriptions_updated_at on push_subscriptions;
create trigger trg_push_subscriptions_updated_at before update on push_subscriptions
  for each row execute function set_updated_at();

-- ---- 4. Row-Level Security --------------------------------------------------

alter table notifications      enable row level security;
alter table push_subscriptions enable row level security;

-- Notifications: read/update/delete ONLY your own; insert for anyone in your
-- hospital (so a doctor's action can notify a nurse). No version column — the
-- only update is stamping read_at, which is last-write-wins by design.
drop policy if exists "read own notifications" on notifications;
create policy "read own notifications" on notifications
  for select to authenticated
  using (is_staff() and recipient_staff_id = current_staff_id());

drop policy if exists "staff insert notifications" on notifications;
create policy "staff insert notifications" on notifications
  for insert to authenticated
  with check (is_staff() and hospital_id = current_hospital_id());

drop policy if exists "update own notifications" on notifications;
create policy "update own notifications" on notifications
  for update to authenticated
  using (recipient_staff_id = current_staff_id())
  with check (recipient_staff_id = current_staff_id());

drop policy if exists "delete own notifications" on notifications;
create policy "delete own notifications" on notifications
  for delete to authenticated
  using (recipient_staff_id = current_staff_id());

-- Push subscriptions: a device manages only its own staff's rows. The Edge
-- Function reads them with the service role (bypasses RLS) to fan out push.
drop policy if exists "manage own push subscriptions" on push_subscriptions;
create policy "manage own push subscriptions" on push_subscriptions
  for all to authenticated
  using (is_staff() and staff_id = current_staff_id())
  with check (is_staff() and staff_id = current_staff_id() and hospital_id = current_hospital_id());

-- ---- 5. Realtime ------------------------------------------------------------
-- Stream inserts to the recipient's open tab. Realtime honours the SELECT policy
-- above, so a client only ever receives its own notifications.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
