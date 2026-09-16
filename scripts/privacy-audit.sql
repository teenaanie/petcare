-- Data privacy audit — read-only. Safe to run against production at any time.
-- Returns one row per check: severity, PASS/FAIL, and the detail behind it.
--
-- Run it in the Supabase SQL editor, or have the monthly agent run it via the
-- Supabase MCP. Every check is a question someone would ask in a privacy review,
-- expressed so the answer is computed rather than remembered.
--
-- It writes nothing. There is no transaction to roll back.

with

-- 1. Every table holding user data must have RLS on. Without it the blanket
--    anon/authenticated grants Supabase creates by default are the whole story.
rls_off as (
  select string_agg(c.relname, ', ') as detail, count(*) as n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
),

-- 2. RLS on with no policies denies everything — correct for service-role-only
--    tables, a bug for anything the app reads. Reported so it stays deliberate.
rls_no_policy as (
  select string_agg(c.relname, ', ') as detail, count(*) as n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity
    and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)
),

-- 3. A policy whose expression is literally true constrains nothing. This is
--    what let anyone write to api_usage: "service role inserts" TO public
--    WITH CHECK (true). The role name in a policy's NAME means nothing.
blanket as (
  select string_agg(tablename||'.'||policyname||' ('||cmd||')', ', ') as detail, count(*) as n
  from pg_policies
  where schemaname='public'
    and (coalesce(qual,'') in ('true','(true)') or coalesce(with_check,'') in ('true','(true)'))
    and tablename <> 'providers'   -- the public directory is intentionally readable
),

-- 4. Anonymous visitors should never hold write privileges on user data.
anon_writes as (
  select string_agg(distinct table_name, ', ') as detail, count(distinct table_name) as n
  from information_schema.role_table_grants
  where table_schema='public' and grantee='anon'
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    and table_name not in ('providers')
),

-- 5. A SECURITY DEFINER function without a pinned search_path can be hijacked
--    by a caller-controlled schema. All of ours should pin it.
unpinned as (
  select string_agg(p.proname, ', ') as detail, count(*) as n
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
),

-- 6. Right to erasure. If a foreign key to auth.users is not ON DELETE CASCADE,
--    deleting the account either fails outright or leaves the data behind.
no_cascade as (
  select string_agg(c.conrelid::regclass::text||'.'||a.attname||' ('||
           case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
                              when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end||')', ', ') as detail,
         count(*) as n
  from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid='auth.users'::regclass
    and c.confdeltype not in ('c','n')          -- cascade fine; set null = deliberate anonymisation
    and c.connamespace::regnamespace::text = 'public'
),

-- 7. Accounts that cannot be deleted at all, because a NO ACTION/RESTRICT key
--    points at them. This is the erasure problem stated in people, not schema.
undeletable as (
  select count(*) as n,
         count(*)||' of '||(select count(*) from auth.users)||' accounts' as detail
  from auth.users u where exists (select 1 from public.pets p where p.user_id=u.id)
),

-- 8. Rows whose owner is already gone — data with nobody to exercise rights over it.
orphans as (
  select count(*) as n, count(*)||' pet row(s)' as detail
  from public.pets p where not exists (select 1 from auth.users u where u.id=p.user_id)
),

-- 9. Personal data about people who never signed up: invitations store the
--    invitee's email address before (and whether or not) they ever join.
third_party as (
  select count(*) as n, count(*)||' invite email(s) for non-users' as detail
  from public.pet_members m where not exists (select 1 from auth.users u where u.email=m.email)
),

-- 10. Retention. Usage telemetry is not needed indefinitely; anything older than
--     a year is past the point of serving the rate limit it was collected for.
stale_usage as (
  select count(*) as n, count(*)||' row(s) older than 12 months' as detail
  from public.api_usage where created_at < now() - interval '12 months'
),

-- 11. Unapproved providers must stay invisible to the public.
leak_providers as (
  select count(*) as n, count(*)||' unapproved row(s) readable by anon' as detail
  from public.providers where is_approved is not true
    and exists (select 1 from pg_policies where schemaname='public' and tablename='providers'
                and cmd='SELECT' and coalesce(qual,'') not like '%is_approved%')
)

select * from (
  select 1 as ord, 'RLS disabled on a table'             as check, 'CRITICAL' as severity, case when n=0 then 'PASS' else 'FAIL' end as status, coalesce(detail,'none') as detail from rls_off
  union all select 2,  'Policy expression is literally true',  'HIGH',     case when n=0 then 'PASS' else 'FAIL' end, coalesce(detail,'none') from blanket
  union all select 3,  'anon holds write grants',              'HIGH',     case when n=0 then 'PASS' else 'REVIEW' end, coalesce(detail,'none') from anon_writes
  union all select 4,  'SECURITY DEFINER without search_path', 'HIGH',     case when n=0 then 'PASS' else 'FAIL' end, coalesce(detail,'none') from unpinned
  union all select 5,  'Account deletion blocked (erasure)',   'HIGH',     case when n=0 then 'PASS' else 'FAIL' end, coalesce(detail,'none') from no_cascade
  union all select 6,  'Accounts that cannot be deleted',      'HIGH',     case when n=0 then 'PASS' else 'FAIL' end, coalesce(detail,'none') from undeletable
  union all select 7,  'Unapproved providers publicly visible','HIGH',     case when n=0 then 'PASS' else 'FAIL' end, coalesce(detail,'none') from leak_providers
  union all select 8,  'RLS enabled but no policies',          'INFO',     case when n=0 then 'PASS' else 'REVIEW' end, coalesce(detail,'none') from rls_no_policy
  union all select 9,  'Orphaned rows (owner deleted)',        'MEDIUM',   case when n=0 then 'PASS' else 'FAIL' end, coalesce(detail,'none') from orphans
  union all select 10, 'Third-party emails held (invites)',    'MEDIUM',   case when n=0 then 'PASS' else 'REVIEW' end, coalesce(detail,'none') from third_party
  union all select 11, 'Usage telemetry past retention',       'LOW',      case when n=0 then 'PASS' else 'REVIEW' end, coalesce(detail,'none') from stale_usage
) t order by case status when 'FAIL' then 0 when 'REVIEW' then 1 else 2 end, ord;
