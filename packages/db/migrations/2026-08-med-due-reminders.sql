-- ============================================================================
-- Medication due-soon reminders  (pg_cron, server-side)
-- Hosted migration snippet. Idempotent: safe to re-run.
--
-- Every minute, find scheduled doses whose next-due time is entering the
-- reminder window (default 5 minutes) and notify the ward's nurses with a
-- COUNT-ONLY message ("3 medications due in the next 5 min"). No patient
-- names or drug names in the notification: pushes render on lock screens,
-- and the MAR — one tap away via the link — is the source of truth the
-- nurse must administer from anyway.
--
-- Unlike every other notification (client-generated at action time), this one
-- is TIME-based, so it must be produced server-side to reach nurses whose
-- app is closed. Inserting into `notifications` rides the existing pipeline:
-- Realtime → open tabs, pg_net trigger → send-push → devices.
--
-- Scheduling model mirrors the client MAR exactly
-- (apps/web/components/medications/prescriptions.ts):
--   next due = last GIVEN administration (else prescription created_at)
--              + parse_frequency_hours(frequency)
--   PRN / unparseable frequency → never reminded.
--
-- Admin controls live in `hospital_settings` (on/off + lead minutes); a
-- missing row means "enabled, 5 minutes".
-- ============================================================================

-- ---- 1. Admin-controlled settings ------------------------------------------

create table if not exists hospital_settings (
  hospital_id               uuid primary key references hospitals(id) on delete cascade,
  med_reminders_enabled     boolean not null default true,
  med_reminder_lead_minutes integer not null default 5
    check (med_reminder_lead_minutes between 1 and 120),
  updated_at                timestamptz not null default now()
);

drop trigger if exists trg_hospital_settings_updated_at on hospital_settings;
create trigger trg_hospital_settings_updated_at before update on hospital_settings
  for each row execute function set_updated_at();

alter table hospital_settings enable row level security;

drop policy if exists "staff read own hospital settings" on hospital_settings;
create policy "staff read own hospital settings" on hospital_settings
  for select to authenticated
  using (hospital_id = (select current_hospital_id()));

drop policy if exists "admin write own hospital settings" on hospital_settings;
create policy "admin write own hospital settings" on hospital_settings
  for all to authenticated
  using (hospital_id = (select current_hospital_id()) and (select current_staff_role()) = 'admin')
  with check (hospital_id = (select current_hospital_id()) and (select current_staff_role()) = 'admin');

-- ---- 2. Reminder de-dupe log ------------------------------------------------
-- One row per (prescription, computed due time) already reminded, so a dose is
-- never announced twice. due_at is deterministic (anchor + interval), so it is
-- stable across cron runs. RLS on, no policies: server-only table.

create table if not exists medication_reminder_log (
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  due_at          timestamptz not null,
  notified_at     timestamptz not null default now(),
  primary key (prescription_id, due_at)
);

alter table medication_reminder_log enable row level security;

-- ---- 3. Frequency parser (SQL twin of parseFrequencyHours) ------------------
-- Keep in sync with apps/web/components/medications/prescriptions.ts.
-- Returns dosing interval in hours, or null for PRN / not understood.

create or replace function public.parse_frequency_hours(freq text)
returns numeric
language plpgsql
immutable
as $$
declare
  f text;
  m text[];
  n numeric;
begin
  if freq is null then return null; end if;
  f := lower(trim(freq));
  if f = '' then return null; end if;

  -- On-demand / as-needed — no fixed interval.
  if f ~ '\y(prn|as required|as needed|when required|sos)\y' then return null; end if;

  -- "every N hours" / "N hourly" / "qNh".
  m := regexp_match(f, 'every\s+(\d+(?:\.\d+)?)\s*(?:h|hour|hours|hrs?)');
  if m is null then m := regexp_match(f, '(\d+(?:\.\d+)?)\s*(?:h|hour|hours|hrs?)\s*ly'); end if;
  if m is null then m := regexp_match(f, '\yq\s*(\d+(?:\.\d+)?)\s*h\y'); end if;
  if m is not null then
    n := m[1]::numeric;
    if n > 0 then return n; end if;
  end if;

  -- "<word> times a day/daily" — before the bare "daily" fallback so
  -- "three times daily" isn't mistaken for once daily.
  m := regexp_match(f, '\y(once|twice|thrice|one|two|three|four)\y.*\y(?:times\s+)?(?:a\s+day|daily|per\s+day)\y');
  if m is not null then
    n := case m[1]
      when 'once' then 1 when 'one' then 1
      when 'twice' then 2 when 'two' then 2
      when 'three' then 3 when 'thrice' then 3
      when 'four' then 4
    end;
    if n is not null then return 24 / n; end if;
  end if;

  -- "N times a day" (numeric).
  m := regexp_match(f, '(\d+)\s*times?\s*(?:a\s+day|daily|per\s+day)');
  if m is not null then
    n := m[1]::numeric;
    if n > 0 then return 24 / n; end if;
  end if;

  -- Latin shorthand commonly seen on a drug chart.
  if f ~ '\y(qds|qid)\y' then return 6; end if;
  if f ~ '\y(tds|tid)\y' then return 8; end if;
  if f ~ '\y(bd|bid)\y' then return 12; end if;

  -- Named time-of-day schedules, before the once-daily fallback.
  declare
    has_morning boolean := f ~ '\y(morning|mane|breakfast)\y';
    has_midday  boolean := f ~ '\y(noon|midday|lunch|afternoon)\y';
    has_evening boolean := f ~ '\y(evening|night|nocte|bedtime|before\s+bed)\y';
  begin
    if has_morning and has_midday and has_evening then return 8; end if;
    if has_morning and has_evening then return 12; end if;
    if has_morning or has_evening then return 24; end if;
  end;

  -- Weekly.
  if f ~ '\y(weekly|once\s+a\s+week|per\s+week|every\s+week)\y' then return 168; end if;

  -- Once-daily phrasings.
  if f ~ '\y(od|nocte|mane|daily|nightly|at night|every day|each day)\y' then return 24; end if;

  return null;
end $$;

-- ---- 4. The reminder pass ---------------------------------------------------
-- SECURITY DEFINER: runs from pg_cron as its owner; inserts bypass RLS the same
-- way the rest of the server side does. Not callable by app users (revoked
-- below) — it takes no input and is driven purely by the clock.

create or replace function public.remind_due_medications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  with cfg as (
    -- Hospitals with reminders on (missing settings row = defaults).
    select h.id as hospital_id,
           coalesce(s.med_reminder_lead_minutes, 5) as lead_min
    from hospitals h
    left join hospital_settings s on s.hospital_id = h.id
    where coalesce(s.med_reminders_enabled, true)
  ),
  candidates as (
    -- Scheduled doses on active prescriptions of open visits, with the same
    -- next-due computation as the client MAR. Ward department (via an active
    -- admission) wins over the visit department, as in nurseIdsForVisit.
    select distinct on (p.id)
           p.id as prescription_id,
           p.hospital_id,
           coalesce(w.department_id, v.department_id) as department_id,
           c.lead_min,
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
  windowed as (
    select * from candidates
    where due_at > now()
      and due_at <= now() + make_interval(mins => lead_min)
  ),
  fresh as (
    -- Claim each dose once; a conflict means an earlier run already announced it.
    insert into medication_reminder_log (prescription_id, due_at)
    select prescription_id, due_at from windowed
    on conflict do nothing
    returning prescription_id
  ),
  grouped as (
    select w.hospital_id, w.department_id, w.lead_min, count(*) as n_due
    from windowed w
    join fresh f on f.prescription_id = w.prescription_id
    group by w.hospital_id, w.department_id, w.lead_min
  ),
  recipients as (
    -- Nurses of the dose's department; a department with no nurses (or no
    -- department at all) falls back to every active nurse in the hospital —
    -- the same rule as nurseIdsForVisit on the client.
    select g.hospital_id, g.lead_min, g.n_due, st.id as staff_id
    from grouped g
    join staff st
      on st.hospital_id = g.hospital_id
     and st.role = 'nurse'
     and st.is_active
     and (
       st.department_id = g.department_id
       or not exists (
         select 1 from staff s2
         where s2.hospital_id = g.hospital_id
           and s2.role = 'nurse' and s2.is_active
           and s2.department_id = g.department_id
       )
     )
  ),
  per_nurse as (
    -- One notification per nurse per run, however many wards contributed.
    select hospital_id, staff_id, min(lead_min) as lead_min, sum(n_due) as total
    from recipients
    group by hospital_id, staff_id
  ),
  inserted as (
    insert into notifications
      (hospital_id, recipient_staff_id, type, title, body, link, data)
    select
      hospital_id,
      staff_id,
      'meds.due_soon',
      case when total = 1
        then '1 medication due in the next ' || lead_min || ' min'
        else total || ' medications due in the next ' || lead_min || ' min'
      end,
      'Open the medication worklist to review and administer.',
      '/medications',
      jsonb_build_object('count', total, 'lead_minutes', lead_min)
    from per_nurse
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end $$;

revoke execute on function public.remind_due_medications() from public, anon, authenticated;

-- ---- 5. Schedule it ---------------------------------------------------------

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'remind-due-medications') then
    perform cron.unschedule('remind-due-medications');
  end if;
end $$;

select cron.schedule('remind-due-medications', '* * * * *',
  'select public.remind_due_medications()');
