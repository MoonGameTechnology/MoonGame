-- Applied AFTER the dump in the SAME transaction. Legacy/dev dumps have no marker.
-- Roles/passwords are cluster state: provision them first on a replacement cluster.
DO $restore_acl$
DECLARE
  app_tables text[] := ARRAY['matches', 'seats', 'receipts', 'users', 'corps', 'corp_members', 'corp_audit', 'corp_ready', 'player_ready', 'ava_challenges', 'ava_roster', 'ava_results', 'ava_sessions', 'ava_feed', 'medals', 'arsenal', 'corp_arsenal_rent', 'meta_wallets', 'meta_market_listings', 'meta_market_ledger', 'drop_claims', 'drop_meta', 'commander_xp', 'commander_credits', 'player_profiles', 'profile_progress', 'profile_credits', 'push_subscriptions', 'friend_edges'];
  item record;
BEGIN
  IF to_regclass('public.vd_schema_revision') IS NULL THEN RETURN; END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('vd_schema', 'vd_runtime')
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls) <> 2 THEN
    RAISE EXCEPTION 'E_RESTORE_ROLES: provision database roles before restore';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND c.relname <> 'vd_schema_revision' AND NOT c.relname=ANY(app_tables)) THEN
    RAISE EXCEPTION 'E_RESTORE_NOT_DEDICATED';
  END IF;
  GRANT USAGE ON SCHEMA public TO vd_runtime;
  GRANT USAGE, CREATE ON SCHEMA public TO vd_schema;
  FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY(app_tables)
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO vd_schema', item.relname);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO vd_runtime', item.relname);
  END LOOP;
  ALTER TABLE public.vd_schema_revision OWNER TO vd_schema;
  GRANT SELECT ON public.vd_schema_revision TO vd_runtime;
  FOR item IN SELECT s.relname FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace
      JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass
      JOIN pg_class t ON t.oid=d.refobjid
      WHERE s.relkind='S' AND n.nspname='public' AND t.relname=ANY(app_tables)
        AND d.deptype IN ('a','i')
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO vd_runtime', item.relname);
  END LOOP;
END
$restore_acl$;
