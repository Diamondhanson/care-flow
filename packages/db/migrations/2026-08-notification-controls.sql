-- ============================================================================
-- Notification controls: overdue-dose escalation + per-event toggles
-- Hosted migration snippet. Idempotent: safe to re-run.
--
-- 1. Escalation: the due-soon reminder's sibling. When a scheduled dose is
--    still not recorded X minutes past due (default 30 — the MAR's overdue
--    grace), alert the ward's nurses AND the visit's attending doctor with a
--    count-only message. Same privacy stance and pipeline as `meds.due_soon`.
--    Only doses whose threshold-crossing happened in the last 15 minutes are
--    considered, so enabling the feature (or a cron outage) can never flush a
--    burst of stale, long-overdue history at the staff.
--
-- 2. `notification_prefs`: a jsonb map of client event type → false to
--    silence it hospital-wide (missing key = enabled). Enforced at the
--    PRODUCER (queueNotifications in apps/web/services/db/notifications.ts):
--    no row is written, so bell, realtime and push all go quiet together.
--    The server-generated meds.* types have their own dedicated toggles.
-- ============================================================================

-- ---- 1. Settings columns ----------------------------------------------------

alter table hospital_settings
  add column if not exists med_escalation_enabled       boolean not null default true,
  add column if not exists med_escalation_after_minutes integer not null default 30,
  add column if not exists notification_prefs           jsonb   not null default '{}'::jsonb;

do $$ begin
  alter table hospital_settings
    add constraint hospital_settings_escalation_minutes_check
    check (med_escalation_after_minutes between 5 and 240);
exception when duplicate_object then null; end $$;

-- ---- 2. Escalation de-dupe log ---------------------------------------------
-- Mirrors medication_reminder_log: one row per (prescription, due time)
-- already escalated. RLS on, no policies: server-only table.

create table if not exists medication_escalation_log (
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  due_at          timestamptz not null,
  escalated_at    timestamptz not null default now(),
  primary key (prescription_id, due_at)
);

alter table medication_escalation_log enable row level security;

-- ---- 3. The escalation pass -------------------------------------------------
-- SECURITY DEFINER, cron-only (revoked from app roles), same shape as
-- remind_due_medications(): compute → claim → fan out per recipient.

create or replace function public.escalate_overdue_medications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  with cfg as (
    select h.id as hospital_id,
           coalesce(s.med_escalation_after_minutes, 30) as after_min
    from hospitals h
    left join hospital_settings s on s.hospital_id = h.id
    where coalesce(s.med_escalation_enabled, true)
  ),
  candidates as (
    -- Same next-due computation as the client MAR and the reminder pass.
    select distinct on (p.id)
           p.id as prescription_id,
           p.hospital_id,
           coalesce(w.department_id, v.department_id) as department_id,
           coalesce(a.attending_doctor_id, v.attending_doctor_id) as attending_doctor_id,
           c.after_min,
           coalesce(
             (select max(ma.administered_at)
                from medication_administrations ma
               where ma.prescription_id = p.id
                 and ma.status = 'given'
                 and ma.administered_at is not null),
             p.created_at
           ) + interval '1 hour' * parse_frequency_hours(p.frequency) as due_at
    from prescriptions p
    join cfg c on c.hospital_id = p.hospital_id
    join visits v on v.id = p.visit_id and v.status = 'open'
    left join admissions a on a.visit_id = v.id and a.status = 'active'
    left join wards w on w.id = a.ward_id
    where p.status = 'active'
      and parse_frequency_hours(p.frequency) is not null
    order by p.id, a.admitted_at desc nulls last
  ),
  crossed as (
    -- Threshold crossed, and crossed RECENTLY (see header: no stale bursts).
    select * from candidates
    where due_at + make_interval(mins => after_min) <= now()
      and due_at + make_interval(mins => after_min) > now() - interval '15 minutes'
  ),
  fresh as (
    insert into medication_escalation_log (prescription_id, due_at)
    select prescription_id, due_at from crossed
    on conflict do nothing
    returning prescription_id
  ),
  fresh_doses as (
    select c.* from crossed c
    join fresh f on f.prescription_id = c.prescription_id
  ),
  dose_recipients as (
    -- Ward nurses (nurseIdsForVisit rule) plus the attending doctor. UNION
    -- (not ALL) so a recipient matching both arms is still counted once.
    select d.hospital_id, d.after_min, d.prescription_id, st.id as staff_id
    from fresh_doses d
    join staff st
      on st.hospital_id = d.hospital_id
     and st.role = 'nurse'
     and st.is_active
     and (
       st.department_id = d.department_id
       or not exists (
         select 1 from staff s2
         where s2.hospital_id = d.hospital_id
           and s2.role = 'nurse' and s2.is_active
           and s2.department_id = d.department_id
       )
     )
    union
    select d.hospital_id, d.after_min, d.prescription_id, sd.id
    from fresh_doses d
    join staff sd on sd.id = d.attending_doctor_id and sd.is_active
  ),
  per_staff as (
    select hospital_id, staff_id, min(after_min) as after_min, count(*) as total
    from dose_recipients
    group by hospital_id, staff_id
  ),
  inserted as (
    insert into notifications
      (hospital_id, recipient_staff_id, type, title, body, link, data)
    select
      hospital_id,
      staff_id,
      'meds.overdue',
      case when total = 1
        then '1 medication overdue by ' || after_min || '+ min'
        else total || ' medications overdue by ' || after_min || '+ min'
      end,
      'Open the medication worklist to review and administer.',
      '/medications',
      jsonb_build_object('count', total, 'after_minutes', after_min)
    from per_staff
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end $$;

revoke execute on function public.escalate_overdue_medications() from public, anon, authenticated;

-- ---- 4. Schedule it ---------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'escalate-overdue-medications') then
    perform cron.unschedule('escalate-overdue-medications');
  end if;
end $$;

select cron.schedule('escalate-overdue-medications', '* * * * *',
  'select public.escalate_overdue_medications()');
