-- ============================================================================
-- Notifications → send-push webhook  (pg_net trigger)
-- Hosted migration snippet. Idempotent: safe to re-run.
--
-- Replaces the dashboard-created "Database Webhook": same mechanism (pg_net
-- HTTP POST from an AFTER INSERT trigger), but tracked here in SQL instead of
-- clicked together in the UI. On every insert into `notifications` it POSTs
-- the row to the `send-push` Edge Function, which fans out Web Push to the
-- recipient's subscribed devices.
--
-- NOTE: because this is a plain trigger (not created via the dashboard), it
-- shows up under Database → Triggers, NOT under Integrations → Webhooks.
-- ============================================================================

create extension if not exists pg_net;

-- SECURITY DEFINER: inserts arrive as the `authenticated` role, which has no
-- grant on the `net` schema; the trigger must call pg_net as its owner.
create or replace function public.notify_send_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://ftudvptmhblydmrsmazw.supabase.co/functions/v1/send-push',
    body := jsonb_build_object(
      'type',   'INSERT',
      'schema', tg_table_schema,
      'table',  tg_table_name,
      'record', to_jsonb(new)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
  return new;
end $$;

drop trigger if exists trg_notifications_send_push on public.notifications;
create trigger trg_notifications_send_push
  after insert on public.notifications
  for each row execute function public.notify_send_push();
