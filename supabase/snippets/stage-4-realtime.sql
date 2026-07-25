-- =============================================================================
-- Stage 4 top-up: add every mirrored table to the realtime publication so
-- signed-in clients stream each other's changes live. Apply to an EXISTING
-- database (a full re-run of schema.sql includes this and is equivalent):
--
--   supabase db execute --file supabase/snippets/stage-4-realtime.sql
--   -- or: psql "$DB" -f supabase/snippets/stage-4-realtime.sql
-- =============================================================================

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'hospitals','departments','wards','beds','staff','patients','visits',
      'consultations','diagnoses','orders','results','prescriptions',
      'medication_administrations','treatment_records','admissions','transfers',
      'allergies','care_plan_items','care_plan_entries','billable_items',
      'charges','clinical_terms'
    ]
    loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table %I;', t);
      end if;
    end loop;
  end if;
end $$;
