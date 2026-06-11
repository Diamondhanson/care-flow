-- =============================================================================
-- Phase 18.5 — Verified Tenant Onboarding: create_hospital_and_admin RPC
-- =============================================================================
-- Standalone, idempotent snippet. Apply it to an EXISTING database that already
-- has the full CareFlow schema (it only adds the onboarding RPC; the same
-- function also lives in schema.sql section 10, so a fresh schema load already
-- includes it — run this only when topping up a database created earlier).
--
-- LOCAL CLI:
--   supabase db execute --file supabase/snippets/phase-18_5-verified-onboarding.sql
--   # or paste into the local Studio SQL editor (http://127.0.0.1:54323)
--
-- After applying, a Google/email-OTP–verified user can create their hospital via
--   supabase.rpc('create_hospital_and_admin', { p_name, p_region, ... })
-- =============================================================================

set check_function_bodies = off;

create or replace function create_hospital_and_admin(
  p_name          text,
  p_region        text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_admin_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_email       text := auth.email();
  v_hospital_id uuid;
  v_existing    uuid;
  v_full_name   text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select hospital_id into v_existing from staff where user_id = v_uid limit 1;
  if v_existing is not null then
    raise exception 'This account already belongs to a hospital'
      using errcode = 'unique_violation';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Hospital name is required' using errcode = '22023';
  end if;

  v_full_name := coalesce(
    nullif(btrim(coalesce(p_admin_full_name, '')), ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    'Administrator'
  );

  insert into hospitals (name, region, contact_email, contact_phone, subscription_status)
  values (
    btrim(p_name),
    nullif(btrim(coalesce(p_region, '')), ''),
    nullif(btrim(coalesce(p_contact_email, '')), ''),
    nullif(btrim(coalesce(p_contact_phone, '')), ''),
    'trial'
  )
  returning id into v_hospital_id;

  insert into staff (hospital_id, user_id, full_name, role, email, is_active)
  values (v_hospital_id, v_uid, v_full_name, 'admin', v_email, true);

  return v_hospital_id;
end;
$$;

revoke all on function create_hospital_and_admin(text, text, text, text, text)
  from public, anon;
grant execute on function create_hospital_and_admin(text, text, text, text, text)
  to authenticated;
