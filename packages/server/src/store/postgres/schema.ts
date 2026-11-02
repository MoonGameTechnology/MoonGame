/**
 * Postgres-схема всех хранилищ одной строкой и `migrate` (SLIM-5). Строку не делят по
 * доменам: её отпечаток (`schemaFingerprint`) сверяет `databaseSecurity.ts`.
 */
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/** Create the tables (idempotent). JSONB discipline: the queryable fields (status,
 *  data_version, seq) are normalized COLUMNS; only the opaque match `state` is JSONB,
 *  so listing/filtering matches never full-scans the blob. See the roadmap PA-1.* */
const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS matches (
      id            text PRIMARY KEY,
      data_version  text NOT NULL,
      seq           integer NOT NULL,
      status        text NOT NULL,
      state         jsonb NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS clock jsonb;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS economy_observations jsonb;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS economy_activity jsonb;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS career jsonb;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS ended_at timestamptz;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS archive_meta jsonb;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS archive_state_bytes integer;
    -- Legacy snapshots have only simulation time. Infer their finish once, anchored
    -- at durable creation, rather than extending their archive on every restart.
    UPDATE matches SET ended_at = LEAST(updated_at, GREATEST(created_at,
      created_at + GREATEST(0,
        COALESCE((state->'match'->>'endedAt')::double precision, (state->>'time')::double precision, 0)
        - COALESCE((state->>'startedAt')::double precision, 0))
        / GREATEST(COALESCE((clock->>'timeScale')::double precision, 1), 1)
        * interval '1 millisecond'))
    WHERE status = 'ended' AND ended_at IS NULL;
    UPDATE matches SET archive_meta = jsonb_strip_nulls(jsonb_build_object(
      'mapId', COALESCE(state->>'mapId', 'nexus'), 'modeId', state->>'modeId',
      'gameTime', COALESCE((state->>'time')::double precision, 0),
      'startedAt', COALESCE((state->>'startedAt')::double precision, 0),
      'timeScale', COALESCE((clock->>'timeScale')::double precision, 1),
      'capacity', (SELECT count(*) FROM jsonb_each(COALESCE(state->'players', '{}'::jsonb)) AS p
        WHERE COALESCE(p.value->>'npc', '') IN ('', 'false')))),
      archive_state_bytes = octet_length(state::text)
    WHERE status='ended' AND (archive_meta IS NULL OR archive_state_bytes IS NULL);
    CREATE INDEX IF NOT EXISTS matches_ended_at_idx ON matches (ended_at) WHERE status = 'ended';
    CREATE TABLE IF NOT EXISTS profile_career (account_id text PRIMARY KEY, career jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_career_credits (match_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY(match_id,account_id));
    CREATE INDEX IF NOT EXISTS matches_status_idx ON matches (status);

    CREATE TABLE IF NOT EXISTS seats (
      room       text NOT NULL,
      nick       text NOT NULL,
      player_id  text NOT NULL,
      joined_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (room, nick)
    );
    -- a side is held by at most one nick per room (so two nicks can't take p1)
    CREATE UNIQUE INDEX IF NOT EXISTS seats_room_player_idx ON seats (room, player_id);
    CREATE INDEX IF NOT EXISTS seats_nick_room_idx ON seats (nick, room);
    -- seat lock (REL-5): sha256 of the seat ticket; NULL = seat claimed before the
    -- lock existed (adopted on the owner's next join). Plaintext never stored.
    ALTER TABLE seats ADD COLUMN IF NOT EXISTS ticket_hash text;

    CREATE TABLE IF NOT EXISTS receipts (
      match_id   text NOT NULL,
      action_id  text NOT NULL,
      player_id  text NOT NULL,
      seq        integer NOT NULL,
      ok         boolean NOT NULL,
      code       text,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (match_id, action_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id         text PRIMARY KEY,
      login      text NOT NULL,
      pass_hash  text NOT NULL,
      email      text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- existing DBs predating recovery: add the optional recovery-email column in place
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS session_nonce text NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
    CREATE TABLE IF NOT EXISTS player_activity_channels (
      account_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel text NOT NULL CHECK(channel ~ '^[a-f0-9]{32}$'),
      seen_ms bigint NOT NULL,
      sequence integer NOT NULL,
      active boolean NOT NULL,
      PRIMARY KEY(account_id,channel)
    );
    CREATE INDEX IF NOT EXISTS player_activity_seen_idx ON player_activity_channels(seen_ms);
    CREATE TABLE IF NOT EXISTS player_activity_days (
      account_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL,
      spans int8multirange NOT NULL DEFAULT '{}',
      visits integer NOT NULL DEFAULT 0 CHECK(visits>=0),
      PRIMARY KEY(account_id,day)
    );
    ALTER TABLE player_activity_days ADD COLUMN IF NOT EXISTS sector_zero_entries integer NOT NULL DEFAULT 0 CHECK(sector_zero_entries>=0);
    ALTER TABLE player_activity_days ADD COLUMN IF NOT EXISTS sector_zero_first_ms bigint;
    ALTER TABLE player_activity_days ADD COLUMN IF NOT EXISTS sector_zero_last_ms bigint;
    CREATE INDEX IF NOT EXISTS player_activity_day_idx ON player_activity_days(day);
    CREATE TABLE IF NOT EXISTS player_activity_state (
      id integer PRIMARY KEY CHECK(id=1), since_ms bigint NOT NULL
    );
    INSERT INTO player_activity_state VALUES(1,(extract(epoch FROM clock_timestamp())*1000)::bigint) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS account_erasure_guard (id integer PRIMARY KEY CHECK(id=1), required boolean NOT NULL);
    INSERT INTO account_erasure_guard VALUES(1,false) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS account_deletions (
      account_id text PRIMARY KEY,
      request_id text NOT NULL UNIQUE,
      requested_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      login_hash text
    );
    ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS login_hash text;
    UPDATE account_deletions d SET login_hash=encode(sha256(convert_to(lower(u.login),'UTF8')),'hex')
      FROM users u WHERE u.id=d.account_id AND d.login_hash IS NULL;
    CREATE INDEX IF NOT EXISTS account_deletions_login_idx ON account_deletions(login_hash);
    -- logins are unique case-insensitively: Vasya and vasya are one account
    CREATE UNIQUE INDEX IF NOT EXISTS users_login_idx ON users (lower(login));
    -- recovery emails are unique case-insensitively WHEN present (the reset lookup key)
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email)) WHERE email IS NOT NULL;

    CREATE TABLE IF NOT EXISTS corp_gateway_nonces (nonce text PRIMARY KEY, expires_at bigint NOT NULL);
    CREATE TABLE IF NOT EXISTS corps (
      id         text PRIMARY KEY,
      name       text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- corp names are unique case-insensitively (CORP-0)
    CREATE UNIQUE INDEX IF NOT EXISTS corps_name_idx ON corps (lower(name));
    -- AvA influence (AVA-2): inter-match corp currency; spend is atomic + guarded ≥0.
    -- ALTER … IF NOT EXISTS backfills pre-AVA-2 corps rows with the 0 default.
    ALTER TABLE corps ADD COLUMN IF NOT EXISTS influence bigint NOT NULL DEFAULT 0;
    ALTER TABLE corps ADD COLUMN IF NOT EXISTS infrastructure jsonb;
    ALTER TABLE corps ADD COLUMN IF NOT EXISTS emblem_id text;
    ALTER TABLE corps ADD COLUMN IF NOT EXISTS showcase jsonb NOT NULL DEFAULT '[]'::jsonb;

    -- account_id as the PRIMARY KEY is the one-corp-per-account invariant: a member
    -- (recruit rows included — a recruit row IS the pending application) can't join
    -- or apply to a second corp until the first row is gone.
    CREATE TABLE IF NOT EXISTS corp_members (
      account_id text PRIMARY KEY,
      corp_id    text NOT NULL,
      login      text NOT NULL,
      role       text NOT NULL,
      joined_at  timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE corp_members ADD COLUMN IF NOT EXISTS membership_nonce uuid NOT NULL DEFAULT gen_random_uuid();
    CREATE UNIQUE INDEX IF NOT EXISTS corp_members_nonce_idx ON corp_members(membership_nonce);
    CREATE TABLE IF NOT EXISTS corp_build_payments (
      id text PRIMARY KEY,
      corp_id text NOT NULL,
      head_membership uuid REFERENCES corp_members(membership_nonce) ON DELETE SET NULL,
      request_key text NOT NULL,
      ticket jsonb NOT NULL,
      result jsonb,
      UNIQUE(corp_id,head_membership,request_key)
    );
    CREATE INDEX IF NOT EXISTS corp_members_corp_idx ON corp_members (corp_id);

    -- audit rows are append-only and deliberately keep no FK to corps: they must
    -- survive a disband (the record is the point)
    CREATE TABLE IF NOT EXISTS corp_audit (
      id      bigserial PRIMARY KEY,
      corp_id text NOT NULL,
      at      bigint NOT NULL,
      actor   text NOT NULL,
      action  text NOT NULL,
      target  text,
      detail  text
    );
    ALTER TABLE corp_audit ADD COLUMN IF NOT EXISTS event_id text;
    CREATE UNIQUE INDEX IF NOT EXISTS corp_audit_event_idx ON corp_audit(event_id);
    CREATE INDEX IF NOT EXISTS corp_audit_corp_idx ON corp_audit (corp_id);

    -- AvA readiness (AVA-3). Corp-flag: the corp is in the ready pool (head-set).
    CREATE TABLE IF NOT EXISTS corp_ready (
      corp_id text PRIMARY KEY,
      since   bigint NOT NULL
    );
    -- CORP-7: the battle formats (players per side) the corp is ready for; corps already in
    -- the pool read as ready for 2 на 2, the only battle there was.
    ALTER TABLE corp_ready ADD COLUMN IF NOT EXISTS formats integer[] NOT NULL DEFAULT '{2}';
    -- Player-flag: a player's standing consent to offline deployment, bound to their
    -- CURRENT corp (account_id PK = one consent per account; leaving the corp clears it).
    CREATE TABLE IF NOT EXISTS player_ready (
      account_id text PRIMARY KEY,
      corp_id    text NOT NULL,
      since      bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS player_ready_corp_idx ON player_ready (corp_id);

    -- AvA challenges (AVA-4): the S0→S2 state machine. A partial unique index enforces
    -- ONE pending challenge per challenger→target pair (terminal rows don't collide).
    CREATE TABLE IF NOT EXISTS ava_challenges (
      id              text PRIMARY KEY,
      challenger_corp text NOT NULL,
      target_corp     text NOT NULL,
      cost            bigint NOT NULL,
      status          text NOT NULL,
      created_at      bigint NOT NULL,
      expires_at      bigint NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ava_challenges_pending_idx
      ON ava_challenges (challenger_corp, target_corp) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS ava_challenges_challenger_idx ON ava_challenges (challenger_corp);
    CREATE INDEX IF NOT EXISTS ava_challenges_target_idx ON ava_challenges (target_corp);
    -- AVA-6: the roster window deadline, stamped on accept (S3 opens at S2).
    -- ALTER … IF NOT EXISTS backfills pre-AVA-6 rows with NULL = window closed.
    ALTER TABLE ava_challenges ADD COLUMN IF NOT EXISTS pause_ends_at bigint;
    -- CORP-7: players per side; challenges written before the formats were 2 на 2.
    ALTER TABLE ava_challenges ADD COLUMN IF NOT EXISTS format integer NOT NULL DEFAULT 2;

    -- AvA rosters (AVA-6): one row per (matchup, account) — the PK is the
    -- one-entry-per-account invariant; the per-side cap is guarded inside the
    -- insert transaction (FOR UPDATE on the matchup row serializes racing joins).
    CREATE TABLE IF NOT EXISTS ava_roster (
      matchup_id text NOT NULL,
      account_id text NOT NULL,
      side       text NOT NULL,
      source     text NOT NULL,
      at         bigint NOT NULL,
      PRIMARY KEY (matchup_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS ava_roster_side_idx ON ava_roster (matchup_id, side);

    -- AvA results (AVA-8, MM-3.1 minimum): one recorded outcome per matchup. The PK is
    -- an idempotent record (belt-and-braces; the matchup's locked→ended transition is
    -- the primary exactly-once gate). winner_corp NULL = a draw. Foundation for the
    -- public feed (AVA-9), medal conditions and rating.
    CREATE TABLE IF NOT EXISTS ava_results (
      matchup_id      text PRIMARY KEY,
      challenger_corp text NOT NULL,
      target_corp     text NOT NULL,
      winner_corp     text,
      at              bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ava_results_at_idx ON ava_results (at DESC);
    -- CORP-9: the battle's format and breakdown, recorded with the result. An earlier
    -- result takes its challenge's format; it has no breakdown.
    ALTER TABLE ava_results ADD COLUMN IF NOT EXISTS format integer;
    UPDATE ava_results r SET format = c.format FROM ava_challenges c
      WHERE r.format IS NULL AND c.id = r.matchup_id;
    ALTER TABLE ava_results ADD COLUMN IF NOT EXISTS report jsonb;
    CREATE INDEX IF NOT EXISTS ava_results_challenger_idx ON ava_results (challenger_corp);
    CREATE INDEX IF NOT EXISTS ava_results_target_idx ON ava_results (target_corp);

    -- AvA sessions (AVA-7): the live match a locked matchup was raised into. PK match_id +
    -- a UNIQUE matchup_id enforce one session per matchup and per instance (the orchestrator
    -- never double-builds). seats is the fixed accountId -> playerId map resolveAvaSeat reads.
    CREATE TABLE IF NOT EXISTS ava_sessions (
      match_id   text PRIMARY KEY,
      matchup_id text NOT NULL UNIQUE,
      map_id     text NOT NULL,
      seats      jsonb NOT NULL,
      at         bigint NOT NULL
    );
    -- AVA-8 (S6): the peace deadline + the exactly-once war stamp. ALTER … IF NOT
    -- EXISTS backfills pre-S6 rows with NULL = no scheduled war (never escalated).
    ALTER TABLE ava_sessions ADD COLUMN IF NOT EXISTS war_at bigint;
    ALTER TABLE ava_sessions ADD COLUMN IF NOT EXISTS war_declared_at bigint;

    -- AvA public feed (AVA-9): append-only, read newest-first. PUBLIC facts only (corp
    -- names + winner), snapshotted at publish — no private roster ever enters this table.
    CREATE TABLE IF NOT EXISTS ava_result_delivery (match_id text PRIMARY KEY, delivered boolean NOT NULL DEFAULT false, attempts integer NOT NULL DEFAULT 0, retry_at bigint NOT NULL DEFAULT 0);
    ALTER TABLE ava_result_delivery ADD COLUMN IF NOT EXISTS delivered boolean NOT NULL DEFAULT false;
    ALTER TABLE ava_result_delivery ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
    ALTER TABLE ava_result_delivery ADD COLUMN IF NOT EXISTS retry_at bigint NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS ava_feed (
      id              text PRIMARY KEY,
      at              bigint NOT NULL,
      kind            text NOT NULL,
      challenger_corp text NOT NULL,
      challenger_name text NOT NULL,
      target_corp     text NOT NULL,
      target_name     text NOT NULL,
      winner_corp     text
    );
    CREATE INDEX IF NOT EXISTS ava_feed_at_idx ON ava_feed (at DESC, id DESC);
    -- CORP-1: the same public feed carries a corporation's own facts (founded, reached a
    -- level, reached a corp medal's condition). Such a row names one corp in the
    -- challenger columns and none in the target ones; detail holds the level / medal id.
    ALTER TABLE ava_feed ALTER COLUMN target_corp DROP NOT NULL;
    ALTER TABLE ava_feed ALTER COLUMN target_name DROP NOT NULL;
    ALTER TABLE ava_feed ADD COLUMN IF NOT EXISTS detail jsonb;

    -- Medals / achievements (corporations.md §3, MED-1): permanent per-account record. PK
    -- (account, medal) is the idempotency + one-per invariant; corp_id snapshots the corp
    -- a corp-scoped medal was earned with (kept after the player leaves).
    CREATE TABLE IF NOT EXISTS medals (
      account_id text NOT NULL,
      medal_id   text NOT NULL,
      corp_id    text,
      at         bigint NOT NULL,
      PRIMARY KEY (account_id, medal_id)
    );
    CREATE INDEX IF NOT EXISTS medals_account_idx ON medals (account_id, at DESC);

    -- Personal arsenal (ARS-2): what an account owns between sessions. item_id PK is
    -- the idempotent-grant invariant (first write wins); transfer/consume are
    -- owner-guarded conditional writes (double-sell impossible, soulbound never moves).
    CREATE TABLE IF NOT EXISTS arsenal (
      item_id     text PRIMARY KEY,
      account_id  text NOT NULL,
      kind        text NOT NULL,
      form        text NOT NULL,
      def_id      text NOT NULL,
      grade       integer,
      soulbound   boolean NOT NULL,
      durability  integer,
      origin      text NOT NULL,
      acquired_at bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS arsenal_account_idx ON arsenal (account_id);

    -- Corp-arsenal rentals (ARS-6): a corp-owned item (a row in the arsenal table
    -- with account_id = the corp's id) lent to a rostered fighter for one war. item_id PK
    -- is the "one war at a time" invariant; DELETE-on-return is the exactly-once
    -- close (a replayed match-end deletes nothing the second time).
    CREATE TABLE IF NOT EXISTS corp_arsenal_rent (
      item_id     text PRIMARY KEY,
      corp_id     text NOT NULL,
      matchup_id  text NOT NULL,
      account_id  text NOT NULL,
      rented_at   bigint NOT NULL
    );
    CREATE TABLE IF NOT EXISTS corp_return_audit (
      event_id text PRIMARY KEY, matchup_id text NOT NULL, entry jsonb NOT NULL, delivered boolean NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS corp_arsenal_rent_matchup_idx ON corp_arsenal_rent (matchup_id);
    CREATE INDEX IF NOT EXISTS corp_arsenal_rent_corp_matchup_idx ON corp_arsenal_rent (corp_id, matchup_id);
    ALTER TABLE corp_arsenal_rent ADD COLUMN IF NOT EXISTS unworn boolean NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS corp_return_audit_pending_idx ON corp_return_audit (matchup_id) WHERE NOT delivered;

    -- MetaMarket (EC-3): кошелёк Варрантов, книга лотов и леджер сделок.
    -- CHECK (warrants >= 0) — последний рубеж против ухода в минус: покупка запирает
    -- обе строки кошельков FOR UPDATE, но ограничение оставлено намеренно, чтобы даже
    -- будущий незапертый путь не смог напечатать деньги.
    -- item_id UNIQUE — один предмет не может стоять в двух лотах одновременно.
    CREATE TABLE IF NOT EXISTS meta_wallets (
      account_id text PRIMARY KEY,
      warrants bigint NOT NULL CHECK (warrants >= 0)
    );
    CREATE TABLE IF NOT EXISTS meta_market_listings (
      id text PRIMARY KEY,
      seller_id text NOT NULL,
      seller_login text NOT NULL,
      item_id text NOT NULL UNIQUE,
      price bigint NOT NULL CHECK (price > 0),
      created_at bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS meta_market_price_idx ON meta_market_listings(price, created_at);
    CREATE TABLE IF NOT EXISTS meta_market_ledger (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      delta bigint NOT NULL,
      reason text NOT NULL,
      listing_id text,
      at bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS meta_market_ledger_account_idx ON meta_market_ledger(account_id, at DESC);

    -- Player medal announcements commit with their reward; restricted degrees are
    -- filtered on the server before pagination, never sent through the public corp feed.
    CREATE TABLE IF NOT EXISTS player_medal_news (
      id text PRIMARY KEY,
      account_id text,
      medal_id text NOT NULL,
      grade smallint NOT NULL CHECK(grade BETWEEN 1 AND 3),
      at bigint NOT NULL,
      login text,
      corp jsonb,
      UNIQUE(account_id,medal_id,grade)
    );
    CREATE INDEX IF NOT EXISTS player_medal_news_public_idx ON player_medal_news(at DESC,id DESC) WHERE grade=1;
    CREATE INDEX IF NOT EXISTS player_medal_news_corp_idx ON player_medal_news((corp->>'id'),at DESC,id DESC);

    -- One local transaction owns material stock, crafting, seasons and trade receipts.
    CREATE TABLE IF NOT EXISTS meta_economy_accounts (
      account_id text PRIMARY KEY,
      state jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS meta_economy_corp_pending_idx ON meta_economy_accounts(account_id)
      WHERE account_id LIKE 'corp:%' AND state->'corpMaterials'->'pending' IS NOT NULL;
    CREATE TABLE IF NOT EXISTS meta_economy_receipts (
      receipt_key text PRIMARY KEY,
      fingerprint text NOT NULL,
      response jsonb NOT NULL
    );
    ALTER TABLE meta_economy_receipts ADD COLUMN IF NOT EXISTS account_ids text[];
    CREATE INDEX IF NOT EXISTS meta_economy_receipts_accounts_idx ON meta_economy_receipts USING gin(account_ids);
    CREATE TABLE IF NOT EXISTS meta_material_listings (
      id text PRIMARY KEY,
      seller_id text NOT NULL,
      seller_login text NOT NULL,
      material_id text NOT NULL,
      quantity bigint NOT NULL CHECK(quantity > 0),
      reserved jsonb NOT NULL,
      price bigint NOT NULL CHECK(price > 0),
      created_at bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS meta_material_price_idx ON meta_material_listings(price,created_at);
    CREATE TABLE IF NOT EXISTS meta_market_receipts (
      account_id text NOT NULL,
      trade_id text NOT NULL,
      fingerprint text NOT NULL,
      result jsonb NOT NULL,
      PRIMARY KEY(account_id,trade_id)
    );
    CREATE TABLE IF NOT EXISTS meta_entitlement_nonces (
      nonce text PRIMARY KEY,
      expires_at bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS meta_entitlement_nonce_expiry_idx ON meta_entitlement_nonces(expires_at);

    -- Drop loop (ARS-4): the (match, account) claim PK is the exactly-once roll gate
    -- (a replayed match end inserts nothing → no second roll, no double pity bump);
    -- drop_meta holds the pity counter and the salvage-shard balance per account.
    CREATE TABLE IF NOT EXISTS drop_claims (
      match_id    text NOT NULL,
      account_id  text NOT NULL,
      PRIMARY KEY (match_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS drop_meta (
      account_id  text PRIMARY KEY,
      pity        integer NOT NULL DEFAULT 0,
      shards      integer NOT NULL DEFAULT 0
    );
    -- Commander progression (EC-*): lifetime XP per account, credited once per match.
    -- commander_credits is the durable idempotency marker — a server restart that
    -- re-observes an already-ended match inserts nothing, so XP is never double-paid.
    CREATE TABLE IF NOT EXISTS commander_xp (
      account_id  text PRIMARY KEY,
      xp          bigint NOT NULL DEFAULT 0
    );
    -- RANK-1 leaderboard order (xp desc, account_id asc): the second key is what makes
    -- equal-XP rows keep one order between refreshes, so the index carries it too.
    CREATE INDEX IF NOT EXISTS commander_xp_board_idx ON commander_xp (xp DESC, account_id ASC);
    CREATE TABLE IF NOT EXISTS commander_credits (
      match_id     text PRIMARY KEY,
      credited_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS player_profiles (
      account_id text PRIMARY KEY,
      appearance jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_progress (
      account_id text NOT NULL,
      metric text NOT NULL,
      value bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, metric)
    );
    CREATE TABLE IF NOT EXISTS profile_credits (
      match_id text NOT NULL,
      account_id text NOT NULL,
      PRIMARY KEY (match_id, account_id)
    );
    -- Dedicated population bots are permanent system identities, never login users.
    -- Catalogue seeding never replaces their appearance, seed or earned XP.
    CREATE TABLE IF NOT EXISTS bot_roster_identities (
      id text PRIMARY KEY,
      login text NOT NULL,
      portrait integer NOT NULL CHECK (portrait BETWEEN 1 AND 40),
      seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
      xp bigint NOT NULL DEFAULT 0 CHECK (xp BETWEEN 0 AND 9007199254740991),
      last_assigned_at bigint CHECK (last_assigned_at BETWEEN 0 AND 8640000000000000)
    );
    -- Display names no longer carry a mandatory system prefix.
    ALTER TABLE bot_roster_identities DROP CONSTRAINT IF EXISTS bot_roster_identities_login_check;
    CREATE UNIQUE INDEX IF NOT EXISTS bot_roster_login_idx ON bot_roster_identities (lower(login));
    CREATE TABLE IF NOT EXISTS bot_roster_matches (
      match_id text PRIMARY KEY,
      status text NOT NULL CHECK (status IN ('active', 'ended', 'abandoned')),
      finished_at bigint CHECK (finished_at BETWEEN 0 AND 8640000000000000)
    );
    CREATE INDEX IF NOT EXISTS bot_roster_active_match_idx ON bot_roster_matches (match_id) WHERE status = 'active';
    -- History is retained after release. A process restart/heartbeat never expires a seat.
    CREATE TABLE IF NOT EXISTS bot_roster_assignments (
      match_id text NOT NULL REFERENCES bot_roster_matches(match_id),
      player_id text NOT NULL,
      bot_id text NOT NULL REFERENCES bot_roster_identities(id),
      assigned_at bigint NOT NULL CHECK (assigned_at BETWEEN 0 AND 8640000000000000),
      active boolean NOT NULL DEFAULT true,
      PRIMARY KEY (match_id, player_id),
      UNIQUE (match_id, bot_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bot_roster_active_bot_idx ON bot_roster_assignments (bot_id) WHERE active;
    CREATE TABLE IF NOT EXISTS bot_roster_results (
      match_id text NOT NULL,
      bot_id text NOT NULL,
      player_id text NOT NULL,
      map_id text NOT NULL,
      ended_at bigint NOT NULL CHECK (ended_at BETWEEN 0 AND 8640000000000000),
      outcome text NOT NULL CHECK (outcome IN ('win', 'draw', 'loss')),
      xp bigint NOT NULL CHECK (xp BETWEEN 0 AND 9007199254740991),
      place bigint CHECK (place BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY (match_id, bot_id),
      FOREIGN KEY (match_id, bot_id) REFERENCES bot_roster_assignments(match_id, bot_id)
    );
    CREATE INDEX IF NOT EXISTS bot_roster_history_idx ON bot_roster_results (bot_id, ended_at DESC, match_id DESC);
    -- Existing accounts stay ineligible; only the new registration writer opts in.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_reward boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS registration_rewards (
      account_id text PRIMARY KEY REFERENCES users(id),
      xp integer NOT NULL CHECK (xp >= 0),
      accepted boolean NOT NULL DEFAULT false
    );

    -- ONB-5: one Web Push subscription per account (a fresh subscribe replaces the
    -- old row — single-device, multi-device fan-out is a later brick).
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      account_id  text PRIMARY KEY,
      endpoint    text NOT NULL,
      p256dh      text NOT NULL,
      auth        text NOT NULL
    );
    -- UIX-4.4: allowed push kinds, comma-separated; NULL = every kind (older rows).
    ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS kinds text;

    -- FRIENDS-1: the social graph — ONE row per pair, keyed on the SORTED pair, so
    -- «A→B» and «B→A» cannot become two rows. requested_by carries the direction
    -- (which side asked), accepted the status: a pending request and a friendship
    -- are the same row, which is why decline/withdraw/unfriend are one DELETE.
    CREATE TABLE IF NOT EXISTS friend_edges (
      lo_id        text NOT NULL,
      hi_id        text NOT NULL,
      lo_login     text NOT NULL,
      hi_login     text NOT NULL,
      requested_by text NOT NULL,
      accepted     boolean NOT NULL DEFAULT false,
      changed_at   bigint NOT NULL,
      PRIMARY KEY (lo_id, hi_id)
    );
    CREATE INDEX IF NOT EXISTS friend_edges_hi ON friend_edges (hi_id);
    -- FRIENDS-2: «скрывать мои партии от друзей». A row exists only for an account
    -- that changed the switch; no row reads as «не скрывать».
    CREATE TABLE IF NOT EXISTS friend_privacy (
      account_id   text PRIMARY KEY,
      hide_matches boolean NOT NULL
    );

    -- CORP-1: admin announcements in the news feed — the admin's own text in both
    -- languages (the feed's other rows are facts the client words itself). A removed one
    -- keeps its row with removed_at set; until_at NULL = shown until removed.
    CREATE TABLE IF NOT EXISTS announcements (
      id         text PRIMARY KEY,
      at         bigint NOT NULL,
      kind       text NOT NULL CHECK (kind IN ('tech', 'update', 'event')),
      pinned     boolean NOT NULL DEFAULT false,
      until_at   bigint,
      title_ru   text NOT NULL,
      title_en   text NOT NULL DEFAULT '',
      body_ru    text NOT NULL DEFAULT '',
      body_en    text NOT NULL DEFAULT '',
      removed_at bigint
    );
    CREATE INDEX IF NOT EXISTS announcements_at_idx ON announcements (at DESC, id DESC) WHERE removed_at IS NULL;
  `;

export const schemaFingerprint = (): string =>
  createHash('sha256').update(SCHEMA_SQL).digest('hex');

export async function migrate(pool: Pool | PoolClient): Promise<void> {
  // Boot/admin callers already own their client's transaction and migration lock.
  if ('release' in pool) {
    await pool.query(SCHEMA_SQL);
    return;
  }
  // The advisory lock serializes migrations, not the schema's DDL against other sessions'
  // DML on the same tables: Postgres may abort the attempt as a deadlock (40P01) and asks
  // the client to retry it. The schema is idempotent, so a retried attempt is safe; any
  // other error, or a third deadlock, still fails the boot.
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(144731, 31)');
      await client.query(SCHEMA_SQL);
      await client.query('COMMIT');
      return;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (attempt < 2 && (error as { code?: unknown }).code === '40P01') continue;
      throw error;
    } finally {
      client.release();
    }
  }
}
