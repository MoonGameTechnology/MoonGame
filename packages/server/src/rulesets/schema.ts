/** Composed into the normal, separately authorized database migration. */
export const RULESET_SCHEMA = `
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS ruleset jsonb;
    -- Immutable pin + state/version agreement also protects late/old host writes.
    CREATE OR REPLACE FUNCTION protect_match_ruleset() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.ruleset IS NOT NULL THEN
        IF NEW.ruleset IS NOT NULL AND NEW.ruleset IS DISTINCT FROM OLD.ruleset THEN
          RAISE EXCEPTION 'E_RULESET_PIN_CONFLICT';
        END IF;
        NEW.ruleset := OLD.ruleset;
      END IF;
      IF NEW.ruleset IS NOT NULL AND (
        NEW.ruleset->'version' IS DISTINCT FROM NEW.state->'version' OR
        NEW.data_version IS DISTINCT FROM NEW.ruleset->'version'->>'data' OR
        NEW.ruleset->>'id' IS NULL OR NEW.ruleset->>'signature' IS NULL OR
        NEW.ruleset->'version'->>'manifest' IS DISTINCT FROM 'ruleset:' || (NEW.ruleset->>'id')
      ) THEN RAISE EXCEPTION 'E_RULESET_PIN_CONFLICT'; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS matches_ruleset_pin ON matches;
    CREATE TRIGGER matches_ruleset_pin BEFORE INSERT OR UPDATE ON matches
      FOR EACH ROW EXECUTE FUNCTION protect_match_ruleset();
`;

/** Upgrade legacy admin-owned objects before switching to the NOLOGIN schema owner. */
export async function adoptRulesetFunction(client: Pick<import('pg').PoolClient, 'query'>): Promise<void> {
  const result = await client.query<{ name: string | null }>(
    "SELECT to_regprocedure('public.protect_match_ruleset()') AS name",
  );
  if (result.rows[0]?.name)
    await client.query('ALTER FUNCTION public.protect_match_ruleset() OWNER TO vd_schema');
}
