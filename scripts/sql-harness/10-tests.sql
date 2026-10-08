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
SELECT t_run   ('an admin sees both admin rows',           'authenticated', '11111111-1111-1111-1111-111111111111', 'select * from public.admins',     'ok:2');
SELECT t_scalar('every admin row is bound by user_id',    'authenticated', '11111111-1111-1111-1111-111111111111',
                $q$select (count(*) = 0)::text from public.admins where user_id is null$q$, 'true');
SELECT t_scalar('the second admin is also an admin',      'authenticated', '55555555-5555-5555-5555-555555555555',
                'select public.is_admin()::text', 'true');

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
SELECT t_run   ('admin_provider_claims() as non-admin',   'authenticated', '33333333-3333-3333-3333-333333333333', 'select * from public.admin_provider_claims()', 'ok:0');
SELECT t_run   ('admin_provider_claims() as admin',       'authenticated', '11111111-1111-1111-1111-111111111111', 'select * from public.admin_provider_claims()', 'ok:1');

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
\echo '════ provider_feedback.sql ════'

-- The regression that matters most here: a pet parent sends provider_id NULL
-- and must be governed by exactly the rule they were governed by before.
SELECT t_run   ('pet parent inserts feedback',            'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.feedback (user_id, message) values ('33333333-3333-3333-3333-333333333333', 'the scanner is slow')$q$, 'ok:1');
SELECT t_run   ('anonymous inserts feedback',             'anon',          NULL,
                $q$insert into public.feedback (user_id, message) values (null, 'spam')$q$, 'denied');
SELECT t_run   ('user inserts as another user_id',        'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.feedback (user_id, message) values ('22222222-2222-2222-2222-222222222222', 'not me')$q$, 'denied');

SELECT t_scalar('is_provider_claimant() as anonymous',    'anon',          NULL,
                $q$select public.is_provider_claimant('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'false');

-- The suspended account from the block above is still suspended here, which is
-- exactly the case this feature exists for: is_provider_member() is false for
-- them, and they must still be able to send a message.
SELECT t_scalar('suspended user is still not a member',   'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.is_provider_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'false');
SELECT t_scalar('...but IS a claimant',                   'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.is_provider_claimant('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'true');
SELECT t_run   ('SUSPENDED provider sends feedback',      'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$insert into public.feedback (user_id, provider_id, message) values ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'why was my access paused?')$q$, 'ok:1');

SELECT t_run   ('stranger attributes to that business',   'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.feedback (user_id, provider_id, message) values ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'they were terrible')$q$, 'denied');

\echo ''
\echo '════ provider_self_registration.sql ════'

SELECT t_run   ('anonymous registers a business',        'anon',          NULL,
                $q$select public.register_and_claim_provider('Backstreet Kennels','Boarder','9876500000')$q$, 'denied');

-- user 33333333 has no claims yet, so this is a clean first registration.
SELECT t_scalar('signed-in user registers and claims',   'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select (public.register_and_claim_provider('Backstreet Kennels','Boarder','9876500000','Kothrud','Pune') is not null)::text$q$, 'true');
SELECT t_scalar('the listing is NOT published yet',      'postgres',      NULL,
                $q$select (is_approved = false)::text from public.providers where name = 'Backstreet Kennels'$q$, 'true');
SELECT t_scalar('the listing is marked self_registered', 'postgres',      NULL,
                $q$select source from public.providers where name = 'Backstreet Kennels'$q$, 'self_registered');
SELECT t_scalar('their claim is pending',                'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select status from public.my_provider_accounts() where provider_name = 'Backstreet Kennels'$q$, 'pending');
SELECT t_scalar('the claim carries their email',         'postgres',      NULL,
                $q$select email from public.provider_accounts where provider_id = (select id from public.providers where name = 'Backstreet Kennels')$q$, 'stranger@example.test');
SELECT t_scalar('they are not a member while pending',   'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.is_provider_member((select provider_id from public.my_provider_accounts() where provider_name = 'Backstreet Kennels'))::text$q$, 'false');

SELECT t_run   ('a blank name is refused',               'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.register_and_claim_provider('   ','Boarder','9876500000')$q$, 'error:P0001');
SELECT t_run   ('a blank phone is refused',              'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.register_and_claim_provider('Nameless','Boarder','  ')$q$, 'error:P0001');
SELECT t_run   ('an unknown type is refused',            'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.register_and_claim_provider('Odd One','Taxidermist','9876500000')$q$, 'error:P0001');
SELECT t_run   ('a junk maps link is refused',           'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.register_and_claim_provider('Linky','Boarder','9876500000',null,null,null,null,null,null,'javascript:alert(1)')$q$, 'error:P0001');

-- They now hold one pending claim; two more reach the ceiling, the fourth stops.
SELECT t_scalar('a second registration is allowed',      'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select (public.register_and_claim_provider('Second Kennels','Boarder','9876500001') is not null)::text$q$, 'true');
SELECT t_scalar('a third is allowed',                    'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select (public.register_and_claim_provider('Third Kennels','Boarder','9876500002') is not null)::text$q$, 'true');
SELECT t_run   ('a fourth pending claim is refused',     'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.register_and_claim_provider('Fourth Kennels','Boarder','9876500003')$q$, 'error:P0001');

SELECT t_run   ('non-admin approves a claim',            'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.approve_provider_claim((select id from public.provider_accounts where provider_id = (select provider_id from public.my_provider_accounts() limit 1)))$q$, 'error:P0001');

SELECT t_run   ('admin approves it',                     'authenticated', '11111111-1111-1111-1111-111111111111',
                $q$select public.approve_provider_claim((select id from public.admin_provider_claims() where provider_name = 'Backstreet Kennels'))$q$, 'ok:1');
SELECT t_scalar('the account is now active',             'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select status from public.my_provider_accounts() where provider_name = 'Backstreet Kennels'$q$, 'active');
SELECT t_scalar('and the listing is PUBLISHED',          'postgres',      NULL,
                $q$select is_approved::text from public.providers where name = 'Backstreet Kennels'$q$, 'true');
SELECT t_scalar('they are a member now',                 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.is_provider_member((select provider_id from public.my_provider_accounts() where provider_name = 'Backstreet Kennels'))::text$q$, 'true');
SELECT t_scalar('the queue shows publication state',     'authenticated', '11111111-1111-1111-1111-111111111111',
                $q$select provider_is_approved::text from public.admin_provider_claims() where provider_name = 'Second Kennels'$q$, 'false');


\echo ''
\echo '════ provider_notes.sql ════'

-- Fixtures, as postgres. Two things to know about the identities above, because
-- getting them wrong makes these assertions test nothing:
--   33333333 registered Backstreet Kennels and is ACTIVE on it.
--   22222222 claimed Unleash and was left SUSPENDED by the tests above.
-- That suspension is reused below rather than worked around: "same provider,
-- not active" is exactly the case worth attacking.
--
-- providers has RLS and no policy in this stub, mirroring live, where the
-- directory is read through search_providers(). So every statement below names
-- provider ids literally — an INSERT..SELECT from providers would silently
-- match zero rows and report ok:0, which looks like a denial and is not one.

INSERT INTO auth.users (id, email) VALUES
  ('66666666-6666-4666-8666-666666666666', 'parent@pippy.test');

INSERT INTO public.pets (id, user_id, name, species) VALUES
  ('d0000000-0000-4000-8000-000000000001',
   '66666666-6666-4666-8666-666666666666', 'Pippin', 'Dog');

-- The informed business: 33333333 active on Unleash.
INSERT INTO public.provider_accounts (provider_id, user_id, email, status, role)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '33333333-3333-3333-3333-333333333333', 'stranger@example.test', 'active', 'owner');

-- A DIFFERENT business, also active, so "cannot read" below means "wrong
-- provider" and not "no account at all".
INSERT INTO public.provider_accounts (provider_id, user_id, email, status, role)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '55555555-5555-5555-5555-555555555555', 'tins08@gmail.com', 'active', 'owner');

-- Positive first: prove each actor is who the later negatives assume.
SELECT t_scalar('the informed provider is a member',     'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.is_provider_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'true');
SELECT t_scalar('the other provider is a member too',    'authenticated', '55555555-5555-5555-5555-555555555555',
                $q$select public.is_provider_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::text$q$, 'true');
SELECT t_scalar('the suspended claimant is NOT',         'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.is_provider_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$q$, 'false');
SELECT t_scalar('the parent can edit their own pet',     'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$select public.is_pet_editor('d0000000-0000-4000-8000-000000000001')::text$q$, 'true');

-- The note, written through the real INSERT policy — so the read half below is
-- testing a row the policy actually admitted, not one planted past it.
SELECT t_run   ('the parent sends a note',               'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$insert into public.provider_notes
                     (provider_id, pet_id, sent_by, body, pet_label, contact_name, starts_on, ends_on)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'd0000000-0000-4000-8000-000000000001',
                           '66666666-6666-4666-8666-666666666666',
                           'Pippin is due a booster on the 14th.', 'Pippin, Dog', 'Teena',
                           current_date + 3, current_date + 7)$q$, 'ok:1');

SELECT t_run   ('the parent reads it back',              'authenticated', '66666666-6666-4666-8666-666666666666',
                'select * from public.provider_notes', 'ok:1');
SELECT t_run   ('the informed provider reads it',        'authenticated', '33333333-3333-3333-3333-333333333333',
                'select * from public.provider_notes', 'ok:1');
SELECT t_scalar('and gets the denormalised label',       'authenticated', '33333333-3333-3333-3333-333333333333',
                'select pet_label from public.provider_notes', 'Pippin, Dog');

-- The whole point of the model: the note travels, the pet record does not.
SELECT t_run   ('the provider cannot read the pet',      'authenticated', '33333333-3333-3333-3333-333333333333',
                'select * from public.pets', 'ok:0');

-- Each negative below fails for exactly ONE reason.
SELECT t_run   ('an active provider, wrong business',    'authenticated', '55555555-5555-5555-5555-555555555555',
                'select * from public.provider_notes', 'ok:0');
SELECT t_run   ('the right business, SUSPENDED',         'authenticated', '22222222-2222-2222-2222-222222222222',
                'select * from public.provider_notes', 'ok:0');
SELECT t_run   ('a signed-in stranger',                  'authenticated', '44444444-4444-4444-4444-444444444444',
                'select * from public.provider_notes', 'ok:0');
SELECT t_run   ('an anonymous reader',                   'anon',          NULL,
                'select * from public.provider_notes', 'ok:0');

-- Attribution: an editor must not sign somebody else's name to a note, because
-- sent_by is all the provider has to judge who told them.
SELECT t_run   ('a stranger sends a note',               'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$insert into public.provider_notes (provider_id, pet_id, sent_by, body, pet_label)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'd0000000-0000-4000-8000-000000000001',
                           '44444444-4444-4444-4444-444444444444', 'let me in', 'Pippin')$q$, 'denied');
SELECT t_run   ('the parent forges the sender',          'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$insert into public.provider_notes (provider_id, pet_id, sent_by, body, pet_label)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'd0000000-0000-4000-8000-000000000001',
                           '44444444-4444-4444-4444-444444444444', 'not mine', 'Pippin')$q$, 'denied');

-- No UPDATE and no DELETE policy exists, so both touch zero rows for everyone,
-- including the two people who can READ the row. A note cannot be taken back.
SELECT t_run   ('the parent edits a sent note',          'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$update public.provider_notes set body = 'rewritten'$q$, 'ok:0');
SELECT t_run   ('the provider edits it',                 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.provider_notes set body = 'rewritten'$q$, 'ok:0');
SELECT t_run   ('the parent deletes it',                 'authenticated', '66666666-6666-4666-8666-666666666666',
                'delete from public.provider_notes', 'ok:0');
SELECT t_run   ('an admin deletes it',                   'authenticated', '11111111-1111-1111-1111-111111111111',
                'delete from public.provider_notes', 'ok:0');
SELECT t_scalar('the body is untouched',                 'authenticated', '66666666-6666-4666-8666-666666666666',
                'select body from public.provider_notes', 'Pippin is due a booster on the 14th.');

-- Constraints that stop a malformed note existing at all.
SELECT t_run   ('a blank body',                          'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$insert into public.provider_notes (provider_id, pet_id, sent_by, body, pet_label)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'd0000000-0000-4000-8000-000000000001',
                           '66666666-6666-4666-8666-666666666666', '   ', 'Pippin')$q$, 'error:23514');
SELECT t_run   ('a stay that ends before it starts',     'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$insert into public.provider_notes
                     (provider_id, pet_id, sent_by, body, pet_label, starts_on, ends_on)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'd0000000-0000-4000-8000-000000000001',
                           '66666666-6666-4666-8666-666666666666', 'ok', 'Pippin',
                           current_date + 7, current_date + 3)$q$, 'error:23514');

-- A re-send supersedes rather than edits, which is the only way to correct a
-- note. Both rows survive; the provider's inbox is what filters.
SELECT t_run   ('a correction supersedes the first',     'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$insert into public.provider_notes
                     (provider_id, pet_id, sent_by, body, pet_label, supersedes)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'd0000000-0000-4000-8000-000000000001',
                           '66666666-6666-4666-8666-666666666666',
                           'Booster was moved to the 20th.', 'Pippin, Dog',
                           (select id from public.provider_notes where supersedes is null))$q$, 'ok:1');
SELECT t_scalar('both rows survive the correction',      'authenticated', '33333333-3333-3333-3333-333333333333',
                'select count(*)::text from public.provider_notes', '2');
SELECT t_scalar('only one is current',                   'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select count(*)::text from public.provider_notes n
                   where not exists (select 1 from public.provider_notes s where s.supersedes = n.id)$q$, '1');

-- onboarded_provider_ids: signed in only, active only, ids only.
SELECT t_run   ('anon asks which are onboarded',         'anon',          NULL,
                $q$select * from public.onboarded_provider_ids(array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[])$q$,
                'denied');
SELECT t_scalar('a customer gets the active one',        'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$select count(*)::text from public.onboarded_provider_ids(
                     array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[])$q$, '1');
SELECT t_scalar('an unknown id returns nothing',         'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$select count(*)::text from public.onboarded_provider_ids(
                     array['99999999-9999-4999-8999-999999999999']::uuid[])$q$, '0');
SELECT t_scalar('a null argument is survivable',         'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$select count(*)::text from public.onboarded_provider_ids(null)$q$, '0');
SELECT t_scalar('it returns ids and nothing else',       'postgres',      NULL,
                $q$select pg_get_function_result(p.oid) from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'onboarded_provider_ids'$q$,
                'TABLE(provider_id uuid)');

-- Using it discloses nothing about the account behind the listing.
SELECT t_run   ('the customer cannot read claims',       'authenticated', '66666666-6666-4666-8666-666666666666',
                'select * from public.provider_accounts', 'ok:0');


\echo ''
\echo '════ provider_broadcasts.sql ════'

-- Written as postgres, because that is the only way it is ever written: the
-- table has no INSERT policy, and api/_lib/provider-broadcast.js writes it with
-- the service key AFTER a send. The assertions below prove the client cannot.
INSERT INTO public.provider_broadcasts (provider_id, sent_by, subject, body, recipients)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '33333333-3333-3333-3333-333333333333',
        'Closed for Diwali', 'We are shut 20th to 23rd.', 12);

-- Positive first, so every zero below is a denial and not an empty table.
SELECT t_run   ('the business reads its own outbox',    'authenticated', '33333333-3333-3333-3333-333333333333',
                'select * from public.provider_broadcasts', 'ok:1');
SELECT t_scalar('and sees how many it reached',         'authenticated', '33333333-3333-3333-3333-333333333333',
                'select recipients::text from public.provider_broadcasts', '12');

SELECT t_run   ('a different business reads it',        'authenticated', '55555555-5555-5555-5555-555555555555',
                'select * from public.provider_broadcasts', 'ok:0');
SELECT t_run   ('the SUSPENDED claimant reads it',      'authenticated', '22222222-2222-2222-2222-222222222222',
                'select * from public.provider_broadcasts', 'ok:0');
SELECT t_run   ('a customer who was mailed reads it',   'authenticated', '66666666-6666-4666-8666-666666666666',
                'select * from public.provider_broadcasts', 'ok:0');
SELECT t_run   ('an anonymous reader',                  'anon',          NULL,
                'select * from public.provider_broadcasts', 'ok:0');

-- No INSERT policy is the rate limit's enforcement: a count the client can
-- write is a count the client chooses.
SELECT t_run   ('the business records its own send',    'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_broadcasts (provider_id, sent_by, subject, body)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           '33333333-3333-3333-3333-333333333333', 'Sneaky', 'Not through the server')$q$,
                'denied');
SELECT t_run   ('or edits the recorded count',          'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.provider_broadcasts set recipients = 0$q$, 'ok:0');
SELECT t_run   ('or deletes an awkward one',            'authenticated', '33333333-3333-3333-3333-333333333333',
                'delete from public.provider_broadcasts', 'ok:0');
SELECT t_scalar('so the outbox is intact',              'authenticated', '33333333-3333-3333-3333-333333333333',
                'select count(*)::text from public.provider_broadcasts', '1');

SELECT t_run   ('a blank subject',                      'postgres',      NULL,
                $q$insert into public.provider_broadcasts (provider_id, sent_by, subject, body)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           '33333333-3333-3333-3333-333333333333', '  ', 'body')$q$, 'error:23514');
SELECT t_run   ('a blank body',                         'postgres',      NULL,
                $q$insert into public.provider_broadcasts (provider_id, sent_by, subject, body)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           '33333333-3333-3333-3333-333333333333', 'subject', '   ')$q$, 'error:23514');


\echo ''
\echo '════ stay_updates.sql ════'

-- The note from the provider_notes block above is the handle everything here
-- hangs off: pet d0000000… owned by 66666666…, sent to Unleash (aaaaaaaa…),
-- which 33333333… is active on. 55555555… is active on a DIFFERENT business.
-- A second note, to that other business about the SAME pet, is what makes
-- "posts claiming another's note" a real attack rather than a typo.
-- Both notes get literal ids, and every statement below names them outright
-- rather than sub-selecting. A subselect reads provider_notes AS THE ATTACKER,
-- and an attacker who cannot read it inserts nothing and reports ok:0 — which
-- looks exactly like a policy denial and is not one. That is the false pass the
-- harness header is about; it caught this one on the suspended-business case.
INSERT INTO public.provider_notes (id, provider_id, pet_id, sent_by, body, pet_label)
VALUES ('e0000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'd0000000-0000-4000-8000-000000000001',
        '66666666-6666-4666-8666-666666666666', 'For the stay', 'Pippin, Dog');
INSERT INTO public.provider_notes (id, provider_id, pet_id, sent_by, body, pet_label)
VALUES ('e0000000-0000-4000-8000-000000000002',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'd0000000-0000-4000-8000-000000000001',
        '66666666-6666-4666-8666-666666666666', 'For the vet', 'Pippin, Dog');

-- Positive first.
SELECT t_run   ('the business posts an update',         'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.stay_updates (note_id, provider_id, pet_id, posted_by, body)
                   values ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-4000-8000-000000000001',
                           '33333333-3333-3333-3333-333333333333', 'She ate everything and slept on the sofa.')$q$, 'ok:1');
SELECT t_run   ('the pet owner reads it',               'authenticated', '66666666-6666-4666-8666-666666666666',
                'select * from public.stay_updates', 'ok:1');
SELECT t_run   ('the business reads it back',           'authenticated', '33333333-3333-3333-3333-333333333333',
                'select * from public.stay_updates', 'ok:1');

SELECT t_run   ('a different active business',          'authenticated', '55555555-5555-5555-5555-555555555555',
                'select * from public.stay_updates', 'ok:0');
SELECT t_run   ('a signed-in stranger',                 'authenticated', '44444444-4444-4444-4444-444444444444',
                'select * from public.stay_updates', 'ok:0');
SELECT t_run   ('an anonymous reader',                  'anon',          NULL,
                'select * from public.stay_updates', 'ok:0');

-- A stay update is the PROVIDER's account of the stay. The pet's own household
-- reads it and cannot write one, or it would be something else entirely.
SELECT t_run   ('the owner posts an update',            'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$insert into public.stay_updates (note_id, provider_id, pet_id, posted_by, body)
                   values ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-4000-8000-000000000001',
                           '66666666-6666-4666-8666-666666666666', 'me again')$q$, 'denied');

-- The dangerous one: pet_id is on the row, so a business that could pass any
-- value would post into a stranger's pet screen. The triple must be a real note.
SELECT t_run   ('a business posts against another note', 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.stay_updates (note_id, provider_id, pet_id, posted_by, body)
                   values ('e0000000-0000-4000-8000-000000000002',
                           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'd0000000-0000-4000-8000-000000000001',
                           '33333333-3333-3333-3333-333333333333', 'not mine to post on')$q$, 'denied');
SELECT t_run   ('or against a pet it was never told of','authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.stay_updates (note_id, provider_id, pet_id, posted_by, body)
                   values ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999999',
                           '33333333-3333-3333-3333-333333333333', 'wrong pet')$q$, 'denied');
SELECT t_run   ('or forges who posted it',              'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.stay_updates (note_id, provider_id, pet_id, posted_by, body)
                   values ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-4000-8000-000000000001',
                           '66666666-6666-4666-8666-666666666666', 'signed by the owner')$q$, 'denied');
SELECT t_run   ('a SUSPENDED business posts',           'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$insert into public.stay_updates (note_id, provider_id, pet_id, posted_by, body)
                   values ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-4000-8000-000000000001',
                           '22222222-2222-2222-2222-222222222222', 'still here')$q$, 'denied');
SELECT t_run   ('an update with neither words nor photo','postgres',     NULL,
                $q$insert into public.stay_updates (note_id, provider_id, pet_id, posted_by, body)
                   values ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-4000-8000-000000000001',
                           '33333333-3333-3333-3333-333333333333', '   ')$q$, 'error:23514');

-- No UPDATE policy; DELETE belongs to the business that posted, NOT the reader.
SELECT t_run   ('the business edits its update',        'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.stay_updates set body = 'rewritten'$q$, 'ok:0');
SELECT t_run   ('the owner deletes it',                 'authenticated', '66666666-6666-4666-8666-666666666666',
                'delete from public.stay_updates', 'ok:0');
SELECT t_scalar('so it is still there',                 'authenticated', '66666666-6666-4666-8666-666666666666',
                'select count(*)::text from public.stay_updates', '1');
SELECT t_run   ('the business takes its own down',      'authenticated', '33333333-3333-3333-3333-333333333333',
                'delete from public.stay_updates', 'ok:1');

\echo ''
\echo '════ stay-photos bucket ════'

-- Photos are attacked through storage.objects, because that is where a boarder
-- could otherwise reach a pet's medical imagery.
SELECT t_run   ('the business uploads a stay photo',    'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into storage.objects (bucket_id, name)
                   values ('stay-photos', 'e0000000-0000-4000-8000-000000000001/abc.jpg')$q$, 'ok:1');
SELECT t_run   ('the owner can see it',                 'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$select * from storage.objects where bucket_id = 'stay-photos'$q$, 'ok:1');
SELECT t_run   ('a different business cannot',          'authenticated', '55555555-5555-5555-5555-555555555555',
                $q$select * from storage.objects where bucket_id = 'stay-photos'$q$, 'ok:0');
SELECT t_run   ('nor a stranger',                       'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select * from storage.objects where bucket_id = 'stay-photos'$q$, 'ok:0');
SELECT t_run   ('nor anyone anonymous',                 'anon',          NULL,
                $q$select * from storage.objects where bucket_id = 'stay-photos'$q$, 'ok:0');
SELECT t_run   ('the owner cannot upload one',          'authenticated', '66666666-6666-4666-8666-666666666666',
                $q$insert into storage.objects (bucket_id, name)
                   values ('stay-photos', 'e0000000-0000-4000-8000-000000000001/mine.jpg')$q$, 'denied');
SELECT t_run   ('a business cannot upload to another note', 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into storage.objects (bucket_id, name)
                   values ('stay-photos', 'e0000000-0000-4000-8000-000000000002/sneak.jpg')$q$, 'denied');
SELECT t_run   ('and the bucket is private',            'postgres',      NULL,
                $q$select * from storage.buckets where id = 'stay-photos' and public = false$q$, 'ok:1');
SELECT t_run   ('the business removes its photo',       'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$delete from storage.objects where bucket_id = 'stay-photos'$q$, 'ok:1');


\echo ''
\echo '════ provider_account_adoption.sql ════'

-- Two fresh listings of its own. provider_accounts carries a unique index on
-- (provider_id, lower(email)), and the blocks above have already claimed the
-- seeded providers under several addresses — reusing one here collided and the
-- whole file stopped, which is a fixture clash rather than a finding.
INSERT INTO public.providers (id, name, type, area, city, is_approved) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Adoption Test Kennels', 'Boarder', 'Baner', 'Pune', true),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Someone Elses Kennels', 'Boarder', 'Aundh', 'Pune', true);

-- An unbound claim, exactly as api/_lib/register-provider.js writes one: the
-- address somebody typed into the form, no user_id, waiting for them to sign in.
-- 77777777… is 'adopter@kennel.test', used by this block alone. Deliberately SHOUTED here, to
-- prove the match ignores letter case.
INSERT INTO public.provider_accounts (provider_id, user_id, email, status, role)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', NULL, 'ADOPTER@Kennel.TEST', 'pending', 'owner');

-- A claim carrying somebody else's address, which must never be adopted.
INSERT INTO public.provider_accounts (provider_id, user_id, email, status, role)
VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', NULL, 'nobody@elsewhere.test', 'pending', 'owner');

SELECT t_scalar('an unbound claim matching me is adopted', 'authenticated', '77777777-7777-4777-8777-777777777777',
                'select public.adopt_my_provider_accounts()::text', '1');
SELECT t_scalar('and the match ignored letter case',       'postgres',      NULL,
                $q$select (user_id = '77777777-7777-4777-8777-777777777777')::text
                   from public.provider_accounts where lower(email) = 'adopter@kennel.test'$q$, 'true');
-- Adoption binds identity. It does NOT grant access: that is still an admin's call.
SELECT t_scalar('its status is untouched',                 'postgres',      NULL,
                $q$select status from public.provider_accounts where lower(email) = 'adopter@kennel.test'$q$, 'pending');
SELECT t_scalar('and they are still not a member',         'authenticated', '77777777-7777-4777-8777-777777777777',
                $q$select public.is_provider_member('cccccccc-cccc-4ccc-8ccc-cccccccccccc')::text$q$, 'false');
SELECT t_scalar('running it again is a no-op',             'authenticated', '77777777-7777-4777-8777-777777777777',
                'select public.adopt_my_provider_accounts()::text', '0');

-- The takeover this function must not enable.
SELECT t_scalar('somebody else cannot adopt my claim',     'authenticated', '66666666-6666-4666-8666-666666666666',
                'select public.adopt_my_provider_accounts()::text', '0');
SELECT t_scalar('a claim for another address is left alone','postgres',     NULL,
                $q$select (user_id is null)::text from public.provider_accounts
                   where email = 'nobody@elsewhere.test'$q$, 'true');
SELECT t_scalar('and an already-bound claim is never moved','postgres',     NULL,
                $q$select (user_id = '33333333-3333-3333-3333-333333333333')::text
                   from public.provider_accounts
                   where provider_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
                     and user_id = '33333333-3333-3333-3333-333333333333' limit 1$q$, 'true');

SELECT t_run   ('anon cannot call it',                     'anon',          NULL,
                'select public.adopt_my_provider_accounts()', 'denied');


\echo ''
\echo '════ provider_book.sql ════'

-- 33333333… is active on Unleash (aaaaaaaa…); 55555555… is active on Vetic
-- (bbbbbbbb…); 22222222… is SUSPENDED on Unleash; 66666666… is a pet parent.
-- Fixed ids throughout — a subselect would read as the attacker and an attacker
-- who can read nothing inserts nothing, which looks like a denial and is not.

SELECT t_run   ('a business adds a customer',            'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_customers (id, provider_id, name, phone, created_by)
                   values ('c0000000-0000-4000-8000-000000000001',
                           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mrs Rao', '9876500001',
                           '33333333-3333-3333-3333-333333333333')$q$, 'ok:1');
SELECT t_run   ('and their animal',                      'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_pets (id, provider_id, customer_id, name, species)
                   values ('c0000000-0000-4000-8000-000000000002',
                           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'c0000000-0000-4000-8000-000000000001', 'Simba', 'Dog')$q$, 'ok:1');
SELECT t_run   ('and books a stay',                      'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_appointments
                     (id, provider_id, customer_id, provider_pet_id, kind, starts_on, ends_on)
                   values ('c0000000-0000-4000-8000-000000000003',
                           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'c0000000-0000-4000-8000-000000000001',
                           'c0000000-0000-4000-8000-000000000002',
                           'Boarding', current_date + 7, current_date + 11)$q$, 'ok:1');
SELECT t_run   ('and reads its own book back',           'authenticated', '33333333-3333-3333-3333-333333333333',
                'select * from public.provider_customers', 'ok:1');

-- A customer who never uses Pippy is the common case; linking is optional.
SELECT t_run   ('a card can point at a note it was sent','authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.provider_pets
                   set note_id = 'e0000000-0000-4000-8000-000000000001'
                   where id = 'c0000000-0000-4000-8000-000000000002'$q$, 'ok:1');
SELECT t_run   ('but never at another business''s note', 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.provider_pets
                   set note_id = 'e0000000-0000-4000-8000-000000000002'
                   where id = 'c0000000-0000-4000-8000-000000000002'$q$, 'denied');

-- Nobody else sees a word of it.
SELECT t_run   ('a different business reads it',         'authenticated', '55555555-5555-5555-5555-555555555555',
                'select * from public.provider_customers', 'ok:0');
SELECT t_run   ('the SUSPENDED claimant reads it',       'authenticated', '22222222-2222-2222-2222-222222222222',
                'select * from public.provider_customers', 'ok:0');
SELECT t_run   ('a pet parent reads it',                 'authenticated', '66666666-6666-4666-8666-666666666666',
                'select * from public.provider_customers', 'ok:0');
SELECT t_run   ('anon reads it',                         'anon',          NULL,
                'select * from public.provider_customers', 'ok:0');
SELECT t_run   ('a pet parent reads the bookings',       'authenticated', '66666666-6666-4666-8666-666666666666',
                'select * from public.provider_appointments', 'ok:0');

-- Cross-business writes, which is what WITH CHECK is for.
SELECT t_run   ('filing a pet under another''s customer','authenticated', '55555555-5555-5555-5555-555555555555',
                $q$insert into public.provider_pets (provider_id, customer_id, name)
                   values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                           'c0000000-0000-4000-8000-000000000001', 'Poached')$q$, 'denied');
SELECT t_run   ('booking against another''s customer',   'authenticated', '55555555-5555-5555-5555-555555555555',
                $q$insert into public.provider_appointments (provider_id, customer_id, starts_on)
                   values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                           'c0000000-0000-4000-8000-000000000001', current_date)$q$, 'denied');
SELECT t_run   ('writing into a business I am not on',   'authenticated', '55555555-5555-5555-5555-555555555555',
                $q$insert into public.provider_customers (provider_id, name)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Not mine')$q$, 'denied');
-- The one way a write-everything policy still leaks: moving the row sideways.
SELECT t_run   ('moving a customer to another business', 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.provider_customers
                   set provider_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$q$, 'denied');

-- Constraints.
SELECT t_run   ('an unknown booking status',             'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_appointments (provider_id, customer_id, starts_on, status)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'c0000000-0000-4000-8000-000000000001', current_date, 'maybe')$q$, 'error:23514');
SELECT t_run   ('a stay ending before it starts',        'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_appointments (provider_id, customer_id, starts_on, ends_on)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'c0000000-0000-4000-8000-000000000001',
                           current_date + 7, current_date + 3)$q$, 'error:23514');
SELECT t_run   ('a blank customer name',                 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_customers (provider_id, name)
                   values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '   ')$q$, 'error:23514');

-- Deleting a customer takes their animals and bookings with them, so a
-- provider who removes somebody from their book is really done with them.
SELECT t_run   ('deleting the customer',                 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$delete from public.provider_customers
                   where id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok:1');
SELECT t_scalar('took their animals',                    'postgres',      NULL,
                $q$select count(*)::text from public.provider_pets
                   where id = 'c0000000-0000-4000-8000-000000000002'$q$, '0');
SELECT t_scalar('and their bookings',                    'postgres',      NULL,
                $q$select count(*)::text from public.provider_appointments
                   where id = 'c0000000-0000-4000-8000-000000000003'$q$, '0');


\echo ''
\echo '════ provider_book_detail.sql ════'

-- A booking of its own, so deleting it at the end cannot disturb the block above.
SELECT t_run   ('a business books a stay to log against','authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_customers (id, provider_id, name)
                   values ('c1000000-0000-4000-8000-000000000001',
                           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mr Log')$q$, 'ok:1');
SELECT t_run   ('and the booking itself',                'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_appointments (id, provider_id, customer_id, starts_on, ends_on)
                   values ('c1000000-0000-4000-8000-000000000002',
                           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'c1000000-0000-4000-8000-000000000001',
                           current_date, current_date + 4)$q$, 'ok:1');

-- The two flags a front desk checks before an animal arrives.
SELECT t_scalar('trial_done defaults to false',          'postgres',      NULL,
                $q$select trial_done::text from public.provider_appointments
                   where id = 'c1000000-0000-4000-8000-000000000002'$q$, 'false');
SELECT t_scalar('criteria_met defaults to false',        'postgres',      NULL,
                $q$select criteria_met::text from public.provider_appointments
                   where id = 'c1000000-0000-4000-8000-000000000002'$q$, 'false');
SELECT t_run   ('and the business can tick them',        'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.provider_appointments set trial_done = true, criteria_met = true
                   where id = 'c1000000-0000-4000-8000-000000000002'$q$, 'ok:1');

-- The day log.
SELECT t_run   ('a day of notes is written',             'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_appointment_logs
                     (appointment_id, provider_id, on_date, body, created_by)
                   values ('c1000000-0000-4000-8000-000000000002',
                           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date,
                           'Ate everything, slept through.',
                           '33333333-3333-3333-3333-333333333333')$q$, 'ok:1');
SELECT t_run   ('and read back',                         'authenticated', '33333333-3333-3333-3333-333333333333',
                'select * from public.provider_appointment_logs', 'ok:1');

SELECT t_run   ('a different business reads the log',    'authenticated', '55555555-5555-5555-5555-555555555555',
                'select * from public.provider_appointment_logs', 'ok:0');
SELECT t_run   ('the SUSPENDED claimant reads it',       'authenticated', '22222222-2222-2222-2222-222222222222',
                'select * from public.provider_appointment_logs', 'ok:0');
SELECT t_run   ('a pet parent reads it',                 'authenticated', '66666666-6666-4666-8666-666666666666',
                'select * from public.provider_appointment_logs', 'ok:0');
SELECT t_run   ('anon reads it',                         'anon',          NULL,
                'select * from public.provider_appointment_logs', 'ok:0');

-- The pair must be real, or a kennel could annotate another kennel's stay.
SELECT t_run   ('logging against another''s booking',    'authenticated', '55555555-5555-5555-5555-555555555555',
                $q$insert into public.provider_appointment_logs (appointment_id, provider_id, body)
                   values ('c1000000-0000-4000-8000-000000000002',
                           'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'not mine')$q$, 'denied');
SELECT t_run   ('a blank entry',                         'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$insert into public.provider_appointment_logs (appointment_id, provider_id, body)
                   values ('c1000000-0000-4000-8000-000000000002',
                           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '   ')$q$, 'error:23514');

-- Money, when a provider chooses to type it. Nullable on purpose: most rows
-- will never carry one, so "no amount" must stay distinguishable from zero.
SELECT t_scalar('a booking carries no amount by default', 'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select coalesce(amount::text, 'null') from public.provider_appointments
                   where id = 'c1000000-0000-4000-8000-000000000002'$q$, 'null');
SELECT t_run   ('the business can price its own stay',   'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.provider_appointments set amount = 4500.00
                   where id = 'c1000000-0000-4000-8000-000000000002'$q$, 'ok:1');
SELECT t_run   ('a negative amount',                     'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$update public.provider_appointments set amount = -1
                   where id = 'c1000000-0000-4000-8000-000000000002'$q$, 'error:23514');
-- What a kennel charges is nobody else's business, and the column must not have
-- arrived with a hole in the policy that covers the rest of the row.
SELECT t_run   ('another business reads the priced row', 'authenticated', '55555555-5555-5555-5555-555555555555',
                $q$select amount from public.provider_appointments
                   where id = 'c1000000-0000-4000-8000-000000000002'$q$, 'ok:0');

SELECT t_run   ('deleting the booking',                  'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$delete from public.provider_appointments
                   where id = 'c1000000-0000-4000-8000-000000000002'$q$, 'ok:1');
SELECT t_scalar('took its day log with it',              'postgres',      NULL,
                $q$select count(*)::text from public.provider_appointment_logs$q$, '0');

-- ════════════════════════════════════════════════════════════════════════════
-- A provider editing their own listing (provider_self_service.sql)
-- ════════════════════════════════════════════════════════════════════════════
--
-- The claimant here is the one already used above for business A; a second,
-- UNAPPROVED listing is claimed so the read path can be tested where the
-- directory's own policy would answer nothing.

INSERT INTO public.provider_accounts (provider_id, user_id, email, status, role, claimed_type)
VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444',
        'invited@kennel.test', 'active', 'owner', 'Boarder');

SELECT t_run   ('a business reads its own UNAPPROVED listing', 'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select * from public.my_provider_details('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$q$, 'ok:1');
-- The point of the function: the table itself still says no.
SELECT t_run   ('and the table itself still says no',     'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select * from public.providers where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$, 'ok:0');
SELECT t_run   ('a different business reads it',          'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select * from public.my_provider_details('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$q$, 'ok:0');
SELECT t_run   ('the SUSPENDED claimant reads it',        'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select * from public.my_provider_details('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$, 'ok:0');

SELECT t_run   ('the business edits its own phone',       'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.update_my_provider('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      p_phone := '9000012345', p_hours := 'Mon-Sun 8am-7pm')$q$, 'ok:1');
SELECT t_scalar('and it landed',                          'postgres',      NULL,
                $q$select phone from public.providers where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$,
                '9000012345');
-- NULL means "leave it alone", so a caller that knows about six fields cannot
-- blank the seventh it has never heard of.
SELECT t_run   ('an untouched field stays put',           'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.update_my_provider('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      p_area := 'Kothrud')$q$, 'ok:1');
SELECT t_scalar('the phone survived',                     'postgres',      NULL,
                $q$select phone from public.providers where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$,
                '9000012345');
-- An empty string is how a field is deliberately cleared.
SELECT t_run   ('an empty string clears a field',         'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.update_my_provider('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', p_phone := '')$q$, 'ok:1');
SELECT t_scalar('and it is null, not blank',              'postgres',      NULL,
                $q$select coalesce(phone, 'null') from public.providers
                   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$, 'null');

SELECT t_run   ('a DIFFERENT business edits it',          'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.update_my_provider('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', p_phone := '9999999999')$q$,
                'error:P0001');
SELECT t_run   ('a SUSPENDED claimant edits theirs',      'authenticated', '22222222-2222-2222-2222-222222222222',
                $q$select public.update_my_provider('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p_phone := '9999999999')$q$,
                'error:P0001');

-- The whole reason this is a function and not a policy: the columns that are
-- NOT on the list stay exactly as they were, whatever the caller does.
SELECT t_scalar('the type is untouched',                  'postgres',      NULL,
                $q$select type from public.providers where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$, 'Boarder');
SELECT t_scalar('and so is approval',                     'postgres',      NULL,
                $q$select is_approved::text from public.providers
                   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$, 'false');
SELECT t_scalar('and so is the name',                     'postgres',      NULL,
                $q$select name from public.providers where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$,
                'Quiet Paws Boarding');

-- Services. One business is very often a boarder AND a groomer AND a counter
-- selling food; the TYPE decides their tab, this says everything else they do.
SELECT t_run   ('a business says what else it does',    'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.update_my_provider('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      p_services := array['Boarding','Grooming','Pet Supplies'])$q$, 'ok:1');
SELECT t_scalar('and it lands in order',                 'postgres',      NULL,
                $q$select array_to_string(services, ',') from public.providers
                   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$, 'Boarding,Grooming,Pet Supplies');
-- The browser is not a validator, and this column is read by the directory
-- every pet parent searches.
SELECT t_run   ('a service nobody has heard of',         'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.update_my_provider('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      p_services := array['Boarding','Astrology'])$q$, 'error:P0001');
SELECT t_scalar('and the good list survived it',         'postgres',      NULL,
                $q$select array_to_string(services, ',') from public.providers
                   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$, 'Boarding,Grooming,Pet Supplies');
-- An empty array is a real answer: "I do only the one thing". Only NULL means
-- leave it alone.
SELECT t_run   ('it can be emptied',                     'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.update_my_provider('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      p_services := array[]::text[])$q$, 'ok:1');
SELECT t_scalar('and is empty, not null',                'postgres',      NULL,
                $q$select coalesce(array_length(services, 1), 0)::text from public.providers
                   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$, '0');
SELECT t_run   ('another business sets them',            'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.update_my_provider('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      p_services := array['Grooming'])$q$, 'error:P0001');

-- Boarding criteria. What a pet parent reads before they travel, written by the
-- business itself rather than by an admin on their behalf.
SELECT t_run   ('a boarder states its own criteria',      'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.update_my_boarding_policy('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      '{"required":["rabies","deworming"],"trial_required":true}'::jsonb)$q$, 'ok:1');
SELECT t_scalar('and it round trips',                     'postgres',      NULL,
                $q$select boarding_policy->>'trial_required' from public.providers
                   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$, 'true');
-- A bare array would survive the column's type and then break resolvePolicy's
-- spread for every pet parent reading that row.
SELECT t_run   ('a policy that is not an object',         'authenticated', '44444444-4444-4444-4444-444444444444',
                $q$select public.update_my_boarding_policy('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                      '["rabies"]'::jsonb)$q$, 'error:P0001');
SELECT t_run   ('a stranger states criteria for them',    'authenticated', '33333333-3333-3333-3333-333333333333',
                $q$select public.update_my_boarding_policy('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '{}'::jsonb)$q$,
                'error:P0001');

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
