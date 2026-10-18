-- The restored snapshot cannot certify deletion requests received AFTER it.
-- Runtime refuses startup until the external ledger is replayed on BOTH databases.
CREATE TABLE IF NOT EXISTS public.account_erasure_guard (
  id integer PRIMARY KEY CHECK(id=1), required boolean NOT NULL
);
INSERT INTO public.account_erasure_guard VALUES(1,true)
  ON CONFLICT(id) DO UPDATE SET required=true;
