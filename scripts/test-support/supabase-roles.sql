-- Hermetic CI PostgreSQL lacks the built-in Supabase API roles referenced by
-- the applied migration ledger. Provision only inert roles, with no grants.
-- Run before migrations in disposable local/CI databases, never as app startup.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
