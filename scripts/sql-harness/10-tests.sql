-- Boundary tests for admins.sql and provider_accounts.sql.
--
-- Two rules this file is built around.
--
-- 1. A test of a permission boundary must FIRST prove the actor holds the
--    permission being tested. Every "blocked" assertion below is preceded by a
--    positive one proving the role and the identity actually took effect. A
--    fixture that silently fails to grant a role turns every later "blocked"
--    into a false pass, which is what the 2026-09-16 correction was about.
--
-- 2. RLS denies in two different shapes, and conflating them hides a fail-open.
--    A blocked INSERT raises 42501. A blocked SELECT, UPDATE or DELETE raises
--    nothing at all and simply touches zero rows. So the expectations below say
--    'denied' or 'ok:0' deliberately, and an 'ok:1' where 'ok:0' was expected is
--    a real failure even though nothing errored.

\set ON_ERROR_STOP on

CREATE TABLE t_results(ord serial, label text, expected text, got text, ok boolean);

-- Runs a statement as a role, with an identity, and records what happened.
CREATE FUNCTION t_run(p_label text, p_role text, p_uid text, p_sql text, p_expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text; n bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    got := 'ok:' || n;
  EXCEPTION
    WHEN insufficient_privilege THEN got := 'denied';
    WHEN others                 THEN got := 'error:' || SQLSTATE;
  END;
  RESET ROLE;
  INSERT INTO t_results(label, expected, got, ok) VALUES (p_label, p_expected, got, got = p_expected);
END $$;

-- Same, for a scalar result. Kept separate because t_run discards rows, and a
-- function that returned false would otherwise pass as 'ok:1'.
CREATE FUNCTION t_scalar(p_label text, p_role text, p_uid text, p_sql text, p_expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO got;
    got := coalesce(got, 'null');
  EXCEPTION
    WHEN insufficient_privilege THEN got := 'denied';
    WHEN others                 THEN got := 'error:' || SQLSTATE;
  END;
  RESET ROLE;
  INSERT INTO t_results(label, expected, got, ok) VALUES (p_label, p_expected, got, got = p_expected);
END $$;

-- Fixtures live in 00-stub.sql, so that auth.users and providers exist before
-- the migrations run — which is the ordering production has.

\echo ''
\echo '════ admins.sql ════'

-- Positive first: prove the identity and role plumbing works at all.
SELECT t_scalar('owner calls is_admin()',                  'authenticated', '11111111-1111-1111-1111-111111111111', 'select public.is_admin()::text',  'true');
SELECT t_scalar('owner is bound by user_id, not email',     'authenticated', '11111111-1111-1111-1111-111111111111', 'select (a.user_id is not null)::text from public.admins a limit 1', 'true');
SELECT t_run   ('owner selects admins',                     'authenticated', '11111111-1111-1111-1111-111111111111', 'select * from public.admins',     'ok:1');

SELECT t_scalar('another signed-in user calls is_admin()',   'authenticated', '33333333-3333-3333-3333-333333333333', 'select public.is_admin()::text',  'false');
SELECT t_scalar('anonymous calls is_admin()',               'anon',          NULL,                                   'select public.is_admin()::text',  'false');
SELECT t_run   ('anonymous selects admins',                 'anon',          NULL,                                   'select * from public.admins',     'ok:0');
SELECT t_run   ('non-admin selects admins',                 'authenticated', '33333333-3333-3333-3333-333333333333', 'select * from public.admins',     'ok:0');

SELECT t_run   ('non-admin inserts themselves into admins', 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.admins (user_id, email) values ('33333333-3333-3333-3333-333333333333', 'stranger@example.test')$q$, 'denied');
SELECT t_run   ('owner inserts into admins (no policy)',    'authenticated', '11111111-1111-1111-1111-111111111111',
                $q$insert into public.admins (email) values ('second@admin.test')$q$, 'denied');
SELECT t_run   ('non-admin updates an admins row',          'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.admins set email = 'stranger@example.test'$q$, 'ok:0');
SELECT t_run   ('non-admin deletes an admins row',          'authenticated', '33333333-3333-3333-3333-333333333333',
                'delete from public.admins', 'ok:0');
SELECT t_run   ('owner deletes an admins row (no policy)',  'authenticated', '11111111-1111-1111-1111-111111111111',
                'delete from public.admins', 'ok:0');

-- is_admin() must be STABLE, not VOLATILE: a VOLATILE function in a policy is
-- re-evaluated per row. This asserts the fix rather than trusting the file.
SELECT t_scalar('is_admin() is STABLE', 'postgres', NULL,
                $q$select (provolatile = 's')::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_admin'$q$, 'true');
SELECT t_scalar('is_admin() pins search_path', 'postgres', NULL,
                $q$select (proconfig @> array['search_path=public'])::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_admin'$q$, 'true');
SELECT t_scalar('is_admin() not executable by PUBLIC', 'postgres', NULL,
                $q$select (not has_function_privilege('public', 'public.is_admin()', 'EXECUTE'))::text$q$, 'true');

\echo ''
\echo '════ provider_accounts.sql ════'

SELECT t_scalar('anonymous calls is_provider_member()',     'anon',          NULL,                                   $q$select public.is_provider_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'false');

-- These four are the regression guard for the current_user_email() bug: the
-- policy must not call anything anon lacks EXECUTE on. 'denied' here means an
-- anonymous read errors instead of returning nothing, which leaks that the
-- table exists and breaks signed-out rendering.
SELECT t_run   ('anonymous selects provider_accounts',      'anon',          NULL,                                   'select * from public.provider_accounts', 'ok:0');
SELECT t_scalar('anonymous calls email_is_mine()',          'anon',          NULL,                                   $q$select public.email_is_mine('teena.anie9@gmail.com')::text$q$, 'false');
SELECT t_scalar('email_is_mine() is true for my own',       'authenticated', '22222222-2222-2222-2222-222222222222', $q$select public.email_is_mine('boarder@unleash.test')::text$q$, 'true');
SELECT t_scalar('email_is_mine() is false for another',     'authenticated', '22222222-2222-2222-2222-222222222222', $q$select public.email_is_mine('stranger@example.test')::text$q$, 'false');

SELECT t_scalar('user claims a listing',                    'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select (public.claim_provider('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Boarder', 'the landline is mine') is not null)::text$q$, 'true');
SELECT t_scalar('the claim landed pending',                 'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select status from public.provider_accounts where user_id = '22222222-2222-2222-2222-222222222222'$q$, 'pending');
SELECT t_scalar('claiming twice returns the same id',       'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select (public.claim_provider('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = (select id from public.provider_accounts where user_id = '22222222-2222-2222-2222-222222222222'))::text$q$, 'true');
SELECT t_scalar('claiming twice made no second row',        'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select count(*)::text from public.provider_accounts where user_id = '22222222-2222-2222-2222-222222222222'$q$, '1');

-- A pending claimant is not yet a member. Proving this BEFORE the approval
-- below is what makes the post-approval 'true' meaningful.
SELECT t_scalar('pending claimant is not a member',         'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.is_provider_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'false');

SELECT t_run   ('user inserts a row with status=active',    'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$insert into public.provider_accounts (provider_id, user_id, status) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'active')$q$, 'denied');
SELECT t_run   ('user inserts a claim for someone else',    'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$insert into public.provider_accounts (provider_id, user_id, status) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'pending')$q$, 'denied');
SELECT t_run   ('user approves their own claim',            'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$update public.provider_accounts set status = 'active' where user_id = '22222222-2222-2222-2222-222222222222'$q$, 'ok:0');
SELECT t_run   ('stranger selects that claim',              'authenticated', '33333333-3333-3333-3333-333333333333',
                'select * from public.provider_accounts', 'ok:0');
SELECT t_run   ('my_provider_accounts() as anon',           'anon',          NULL, 'select * from public.my_provider_accounts()', 'denied');
SELECT t_run   ('admin_provider_accounts() as non-admin',   'authenticated', '33333333-3333-3333-3333-333333333333', 'select * from public.admin_provider_accounts()', 'ok:0');
SELECT t_run   ('admin_provider_accounts() as admin',       'authenticated', '11111111-1111-1111-1111-111111111111', 'select * from public.admin_provider_accounts()', 'ok:1');

-- The admin approves, through the same UPDATE the Claims panel issues.
SELECT t_run   ('admin approves the claim',                 'authenticated', '11111111-1111-1111-1111-111111111111',
                $q$update public.provider_accounts set status='active', granted_by='11111111-1111-1111-1111-111111111111', granted_at=now(), revoked_at=null where user_id = '22222222-2222-2222-2222-222222222222'$q$, 'ok:1');
SELECT t_scalar('approved user is a member',                'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.is_provider_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'true');
SELECT t_scalar('approved user is not a member elsewhere',  'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.is_provider_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::text$q$, 'false');
SELECT t_scalar('my_provider_accounts() joins the name',    'authenticated', '22222222-2222-2222-2222-222222222222',
                'select provider_name from public.my_provider_accounts()', 'Unleash - The Dog Town');

-- Suspension must actually revoke access, not just relabel the row.
SELECT t_run   ('admin suspends the account',               'authenticated', '11111111-1111-1111-1111-111111111111',
                $q$update public.provider_accounts set status='suspended', revoked_at=now() where user_id = '22222222-2222-2222-2222-222222222222'$q$, 'ok:1');
SELECT t_scalar('suspended user is not a member',           'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.is_provider_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'false');
SELECT t_scalar('suspended user still sees their own row',  'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select status from public.my_provider_accounts()$q$, 'suspended');

-- An admin invites by email before that person has ever signed in; their first
-- claim must adopt the waiting row rather than making a second one beside it.
SELECT t_run   ('admin invites by email',                   'authenticated', '11111111-1111-1111-1111-111111111111',
                $q$insert into public.provider_accounts (provider_id, email, status) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'invited@kennel.test', 'active')$q$, 'ok:1');
SELECT t_scalar('invitee is a member by email alone',       'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.is_provider_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::text$q$, 'true');
SELECT t_scalar('invitee claim adopts the waiting row',     'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select count(*)::text from public.provider_accounts where provider_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$q$, '1');
SELECT t_scalar('adopted row kept its active status',       'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select status from public.my_provider_accounts()$q$, 'active');

-- A claimed listing must not be deletable out from under the business.
SELECT t_run   ('deleting a claimed providers row',         'postgres',      NULL,
                $q$delete from public.providers where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$, 'error:23503');

\echo ''
\echo '════ results ════'
SELECT ord, label, expected, got, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM t_results ORDER BY ord;

\echo ''
SELECT count(*) FILTER (WHERE ok) AS passed,
       count(*) FILTER (WHERE NOT ok) AS failed,
       count(*) AS total
FROM t_results;

-- Non-zero exit when anything failed, so a runner can gate on this.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM t_results WHERE NOT ok;
  IF n > 0 THEN RAISE EXCEPTION '% boundary test(s) FAILED', n; END IF;
END $$;
