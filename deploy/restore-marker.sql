-- Runs BEFORE the dump, in its same transaction. Never trust a marker that the
-- incoming archive did not supply; a current archive replaces this stale value.
DO $restore_marker$
BEGIN
  IF to_regclass('public.vd_schema_revision') IS NOT NULL THEN
    UPDATE public.vd_schema_revision SET fingerprint='restore-requires-migration';
  END IF;
END
$restore_marker$;
