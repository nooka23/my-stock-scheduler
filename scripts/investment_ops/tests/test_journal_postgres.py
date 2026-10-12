"""Opt-in integration tests in an isolated temporary Docker PostgreSQL database."""
import copy
import json
import os
import subprocess
import unittest
import uuid
from pathlib import Path

from investment_ops.journal import batch_hash, validate_batch
from test_journal import synthetic_batch


@unittest.skipUnless(os.environ.get("JOURNAL_TEST_POSTGRES") == "1", "requires opt-in Docker PostgreSQL")
class JournalPostgresTests(unittest.TestCase):
    @classmethod
    def psql(cls, sql, database=None):
        result = subprocess.run(["docker", "exec", "-i", "supabase-db", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database or cls.database, "-At"], input=sql, text=True, capture_output=True)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    @classmethod
    def setUpClass(cls):
        cls.database = "journal_test_" + uuid.uuid4().hex[:16]
        cls.psql(f'create database "{cls.database}";', "postgres")
        try:
            cls.psql("""create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,service_role;
grant execute on function auth.uid() to authenticated,service_role;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');""")
            path = Path(__file__).resolve().parents[3] / "supabase/migrations/20261012000000_create_trade_journal.sql"
            cls.psql(path.read_text())
            cls.psql(path.with_name('20261012001000_create_trade_journal_position_snapshots.sql').read_text())
            cls.psql(path.with_name('20261012002000_create_trade_journal_sectors.sql').read_text())
            cls.psql(path.with_name('20261012003000_create_trade_journal_display_settings.sql').read_text())
        except Exception:
            cls.psql(f'drop database "{cls.database}";', "postgres")
            raise

    @classmethod
    def tearDownClass(cls):
        cls.psql(f'drop database "{cls.database}";', "postgres")

    def ingest_sql(self, batch):
        batch = validate_batch(batch)
        payload = json.dumps(batch).replace("'", "''")
        return f"select public.ingest_trade_journal_batch('00000000-0000-0000-0000-000000000001','{batch['account_alias']}','{batch_hash(batch)}','{payload}'::jsonb);"

    def test_snapshot_owner_isolation_and_empty_latest_portfolio(self):
        self.psql("begin;" + self.ingest_sql(synthetic_batch()) + """
insert into trade_journal_position_snapshots(account_id,user_id,observed_at,completed_at,content_hash,positions,cash,source)
select id,user_id,'2026-10-12T01:00Z','2026-10-12T01:01Z',repeat('a',64),'[{"symbol":"SYNTH"}]','[]','NAMUH_API' from trade_journal_accounts;
insert into trade_journal_position_snapshots(account_id,user_id,observed_at,completed_at,content_hash,positions,cash,source)
select id,user_id,'2026-10-12T02:00Z','2026-10-12T02:01Z',repeat('b',64),'[]','[]','NAMUH_API' from trade_journal_accounts;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin if exists(select 1 from trade_journal_latest_position_snapshots) then raise exception 'owner leak'; end if; end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin if (select positions from trade_journal_latest_position_snapshots) <> '[]'::jsonb then raise exception 'closed holding remains'; end if; end $$;
rollback;
""")

    def test_sector_owner_write_isolation_and_snapshot_independence(self):
        self.psql("""begin;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into trade_journal_sectors(user_id,market,symbol,sector) values
('00000000-0000-0000-0000-000000000001','US','SYNTH','반도체');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin
if exists(select 1 from trade_journal_sectors) then raise exception 'sector read leak'; end if;
update trade_journal_sectors set sector='wrong';
if found then raise exception 'sector update leak'; end if;
begin
insert into trade_journal_sectors(user_id,market,symbol,sector) values ('00000000-0000-0000-0000-000000000001','US','OTHER','wrong');
raise exception 'foreign owner insert allowed';
exception when insufficient_privilege then null;
end;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin if (select sector from trade_journal_sectors where symbol='SYNTH') <> '반도체' then raise exception 'sector overwritten'; end if; end $$;
update trade_journal_sectors set sector='';
do $$ begin if (select sector from trade_journal_sectors where symbol='SYNTH') <> '' then raise exception 'clear failed'; end if; end $$;
rollback;
""")

    def test_exchange_rate_validation_and_owner_isolation(self):
        self.psql("""begin;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into trade_journal_display_settings(user_id,usd_krw) values ('00000000-0000-0000-0000-000000000001',1400.1234);
do $$ begin
begin update trade_journal_display_settings set usd_krw=0; raise exception 'zero allowed'; exception when check_violation then null; end;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin
if exists(select 1 from trade_journal_display_settings) then raise exception 'rate leaked'; end if;
update trade_journal_display_settings set usd_krw=1500;
if found then raise exception 'foreign rate changed'; end if;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin if (select usd_krw from trade_journal_display_settings)<>1400.1234 then raise exception 'rate changed'; end if; end $$;
rollback;
""")

    def test_replay_correction_audit_and_notes(self):
        batch = synthetic_batch()
        second = copy.deepcopy(batch["executions"][0]); second["source_key"] += ":2"
        batch["executions"].append(second)
        self.psql("begin;" + self.ingest_sql(batch) + self.ingest_sql(batch) + """
do $$ begin
if (select count(*) from trade_journal_executions) <> 2 or (select count(*) from trade_journal_batches) <> 1 then raise exception 'replay or partial-fill failure'; end if;
end $$;
insert into trade_journal_notes select id,user_id,'keep memo',now() from trade_journal_executions;
""" + self.ingest_sql({**batch, "observed_at": "2026-10-11T06:00:00+09:00", "executions": [{**t,"status":"CONFIRMED","fee":"1"} for t in batch["executions"]]}) + self.ingest_sql({**batch, "observed_at": "2026-10-10T07:00:00+09:00"}) + """
do $$ begin
if exists(select 1 from trade_journal_executions where status <> 'CONFIRMED' or fee <> 1) then raise exception 'older replay overwrote correction'; end if;
if (select count(*) from trade_journal_batches) <> 3 then raise exception 'missing audit'; end if;
if (select count(*) from trade_journal_notes where note='keep memo') <> 2 then raise exception 'memo overwritten'; end if;
end $$; rollback;""")

    def test_owner_rls_view_and_rpc_permissions(self):
        output = self.psql("begin;" + self.ingest_sql(synthetic_batch()) + """
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select count(*) from trade_journal_executions;
select count(*) from trade_journal_latest_balances;
select has_function_privilege('authenticated','public.ingest_trade_journal_batch(uuid,text,text,jsonb)','execute');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select count(*) from trade_journal_latest_balances;
rollback;""")
        self.assertIn("0\n0\nf\nSET\n1", output)

    def test_invalid_batch_atomic_rollback(self):
        batch = validate_batch(synthetic_batch()); batch["executions"][0]["quantity"] = "-1"
        payload = json.dumps(batch).replace("'", "''")
        self.psql("""begin; do $$ begin
begin
perform public.ingest_trade_journal_batch('00000000-0000-0000-0000-000000000001','namuh-general','""" + batch_hash(batch) + "','" + payload + "'::jsonb);" + """
raise exception 'invalid data accepted';
exception when check_violation then null;
end;
if exists(select 1 from trade_journal_accounts) or exists(select 1 from trade_journal_batches) then raise exception 'partial write'; end if;
end $$; rollback;""")


if __name__ == "__main__": unittest.main()
