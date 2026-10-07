#!/usr/bin/env bash
# Run the supabase/*.sql files against a throwaway Postgres and attack the
# policies they create. Nothing here touches the live project.
#
#   scripts/sql-harness/run.sh
#
# A fixed locale, for initdb AND for the server.
#
# Two separate failures without this, both of which read as database problems
# when they are environment ones:
#
#   initdb   : "invalid locale settings; check LANG and LC_* environment
#              variables" when the caller's LANG is unset or unknown to it.
#   postmaster: "became multithreaded during startup / Set the LC_ALL
#              environment variable to a valid locale" -- on macOS, looking up
#              an unset locale spawns a thread, and Postgres refuses to start
#              multithreaded.
#
# C also gives stable collation, which matters because these tests compare
# exact strings and ordering.
export LANG=C
export LC_ALL=C

# Needs a local PostgreSQL 16 (psql + initdb). The cluster is created fresh,
# used, and destroyed, so a failing run leaves nothing behind to clean up.
#
# Why this exists: every file in supabase/ ends with a table of boundary tests
# that someone is supposed to run by hand in the SQL editor and write the
# results into. Doing that by hand against production is both risky and the kind
# of chore that quietly stops happening. This does it in about two seconds, and
# fails loudly.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
[ -x "$PGBIN/initdb" ] || PGBIN="$(dirname "$(command -v initdb)")"

# initdb refuses to run as root, so when we are root we borrow the postgres
# account and put the cluster somewhere it can actually reach.
if [ "$(id -u)" = "0" ]; then
  RUNAS="postgres"
  BASE="$(getent passwd postgres | cut -d: -f6)/sql-harness-$$"
else
  RUNAS=""
  BASE="${TMPDIR:-/tmp}/sql-harness-$$"
fi

as() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $1"; else bash -c "PATH=$PGBIN:\$PATH $1"; fi; }

cleanup() {
  as "pg_ctl -D $BASE/pgdata -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$BASE"
}
trap cleanup EXIT

mkdir -p "$BASE/pgdata" "$BASE/sock"
[ -n "$RUNAS" ] && chown -R "$RUNAS:$RUNAS" "$BASE"

as "initdb -D $BASE/pgdata -U postgres -A trust --locale=C" >/dev/null
as "pg_ctl -D $BASE/pgdata -o \"-k $BASE/sock -c listen_addresses=''\" -l $BASE/pgdata/pg.log start" >/dev/null
for _ in $(seq 20); do
  "$PGBIN/psql" -h "$BASE/sock" -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 0.25
done

run() { "$PGBIN/psql" -h "$BASE/sock" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$1"; }

run "$HERE/00-stub.sql"
run "$REPO/supabase/admins.sql"
run "$REPO/supabase/provider_accounts.sql"
run "$REPO/supabase/provider_feedback.sql"
run "$REPO/supabase/provider_self_registration.sql"
run "$REPO/supabase/provider_notes.sql"
run "$REPO/supabase/provider_broadcasts.sql"
run "$REPO/supabase/stay_updates.sql"
run "$REPO/supabase/provider_account_adoption.sql"

# Mirror Supabase's own grants. Without these, anon and authenticated would be
# blocked by a missing table privilege rather than by RLS, and every "blocked"
# assertion would pass for the wrong reason.
"$PGBIN/psql" -h "$BASE/sock" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "
  GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;"

# Re-run them to prove they are safe to re-run, as their headers claim.
run "$REPO/supabase/admins.sql"
run "$REPO/supabase/provider_accounts.sql"
run "$REPO/supabase/provider_feedback.sql"
run "$REPO/supabase/provider_self_registration.sql"
run "$REPO/supabase/provider_notes.sql"
run "$REPO/supabase/provider_broadcasts.sql"
run "$REPO/supabase/stay_updates.sql"
run "$REPO/supabase/provider_account_adoption.sql"

"$PGBIN/psql" -h "$BASE/sock" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -tAc \
  "select case when count(*) = 1 then 'ok' else 'DUPLICATE SEED: ' || count(*) end
   from public.admins where lower(email) = 'teena.anie9@gmail.com';" \
  | grep -qx ok || { echo "re-running admins.sql duplicated the seed row"; exit 1; }

run "$HERE/10-tests.sql"
echo
echo "all boundary tests passed"
