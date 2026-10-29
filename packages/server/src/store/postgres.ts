import { scopedPool } from '../corporateScopedPool';
import { reservedBotLogin } from '../botNicknames';
import { archiveMetadataOf, archiveStateBytes, type ArchiveSummaryMetadata } from '../matchArchiveMetadata';
import { readArchiveMetadata } from '../matchArchiveCatalog';
import { isCorpEmblemId, type CorpEmblemId } from '@void/protocol';
import type {
  CorpBuildOrder,
  CorpInfrastructureResult,
  CorpInfrastructureState,
  NewsAnnouncement,
  NewsAnnouncementKind,
} from '@void/protocol';
import { corpBuildPrice, updateCorpInfrastructure } from '../corpConstruction';
import { corpFoundedNews, corpLevelNews } from '../corpNews';
import { corpFacilities, publicCorpFacilities, validateShowcase } from '../corpFacilities';
import type { CorpShowcaseResult } from '@void/protocol';
import { MAX_META_ACTIVITY_FACTS_PER_ROLE } from '../metaEconomyActivity';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ArsenalItem, PlayerId } from '@void/shared-core';
import type {
  AccountStore,
  AnnouncementStore,
  ArsenalStore,
  AvaBattleReport,
  AvaChallenge,
  AvaChallengeStatus,
  AvaChallengeStore,
  AvaFeedStore,
  AvaResult,
  AvaResultStore,
  AvaRosterEntry,
  AvaRosterStore,
  AvaSession,
  AvaSessionStore,
  AvaSide,
  AvaTally,
  CommanderStore,
  CorpAuditEntry,
  CorpMembership,
  CorpRecord,
  CorpRent,
  CorpRentStore,
  CorpRole,
  CorpStore,
  CorpSummary,
  DropStore,
  FeedEntry,
  FeedKind,
  FriendEdge,
  FriendParty,
  FriendStore,
  MatchSnapshot,
  MatchStore,
  Medal,
  MedalStore,
  OwnedArsenalItem,
  PushStore,
  PushSubscriptionRecord,
  ReceiptStore,
  SeatAssignment,
  StoredReceipt,
  UserRecord,
  UserStore,
} from './types';
import {
  ACTIVE_ANNOUNCEMENTS_MAX,
  isAvaFeedEntry,
  DEFAULT_AUDIT_LIMIT,
  DEFAULT_FEED_LIMIT,
  DEFAULT_CHALLENGES_LIMIT,
  DEFAULT_LOCKED_MATCHUPS_LIMIT,
  DEFAULT_RESULTS_LIMIT,
  PUSH_KINDS,
} from './types';

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

interface MatchRow {
  id: string;
  data_version: string;
  seq: number;
  status: string;
  state: MatchSnapshot['state'];
  clock: MatchSnapshot['clock'] | null;
  economy_observations: MatchSnapshot['economyObservations'] | null;
  economy_activity: MatchSnapshot['economyActivity'] | null;
  career: MatchSnapshot['career'] | null;
  created_at: Date;
  ended_at: Date | null;
}

export class PostgresMatchStore implements MatchStore {
  async economyMatchIds(after = '', limit = 100): Promise<string[]> {
    const size = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 100;
    const result = await this.pool.query<{ id: string }>(
      'SELECT id FROM matches WHERE id>$1 ORDER BY id LIMIT $2',
      [after, size],
    );
    return result.rows.map((row) => row.id);
  }
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<boolean> {
    try {
      // This query is read-only: a client deadline can safely discard its response.
      // pg supports per-query deadlines, although @types/pg declares this option
      // only on ClientConfig. Keep the structural value rather than widening all queries.
      const probe = { text: 'SELECT 1', query_timeout: 1000 };
      await this.pool.query(probe);
      return true;
    } catch {
      return false; // pool exhausted / DB unreachable → not ready
    }
  }

  async load(matchId: string): Promise<MatchSnapshot | null> {
    const r = await this.pool.query<MatchRow>(
      `SELECT id, data_version, seq, status, state, clock, economy_observations, economy_activity, career, created_at, ended_at FROM matches WHERE id = $1`,
      [matchId],
    );
    const row = r.rows[0];
    return this.snapshotFromRow(row);
  }

  async loadArchive(matchId: string, since: number, maxBytes: number): Promise<MatchSnapshot | null> {
    const r = await this.pool.query<MatchRow>(
      `SELECT id, data_version, seq, status, state, clock, economy_observations, economy_activity, career, created_at, ended_at
       FROM matches WHERE id=$1 AND status='ended' AND ended_at>$2 AND archive_state_bytes<=$3`,
      [matchId, new Date(since), maxBytes],
    );
    return this.snapshotFromRow(r.rows[0]);
  }

  archiveMetadata(ids: readonly string[], since: number): Promise<ArchiveSummaryMetadata[]> {
    return readArchiveMetadata(this.pool, { ids, since });
  }

  private snapshotFromRow(row: MatchRow | undefined): MatchSnapshot | null {
    if (!row) return null;
    return {
      matchId: row.id,
      dataVersion: row.data_version,
      seq: row.seq,
      status: row.status === 'ended' ? 'ended' : 'ongoing',
      ...(row.created_at ? { createdAt: row.created_at.getTime() } : {}),
      ...(row.ended_at ? { endedAt: row.ended_at.getTime() } : {}),
      ...(row.career ? { career: row.career } : {}),
      state: row.state, // pg parses jsonb → JS object
      ...(row.clock ? { clock: row.clock } : {}),
      ...(row.economy_observations ? { economyObservations: row.economy_observations } : {}),
      ...(row.economy_activity ? { economyActivity: row.economy_activity } : {}),
    };
  }

  async save(snapshot: MatchSnapshot): Promise<void> {
    await this.saveUsing(this.pool, snapshot);
  }

  async saveWithReceipt(
    snapshot: MatchSnapshot,
    receipt: StoredReceipt,
    receipts: ReceiptStore,
  ): Promise<void> {
    if (!(receipts instanceof PostgresReceiptStore) || !receipts.sharesPool(this.pool))
      throw new Error('E_MATCH_COMMIT_BACKEND');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const written = await this.saveUsing(client, snapshot);
      if (!written) throw new Error('E_MATCH_COMMIT_STALE');
      await receipts.saveUsing(client, snapshot.matchId, receipt);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveUsing(query: Pick<Pool, 'query'>, snapshot: MatchSnapshot): Promise<boolean> {
    // Optimistic by seq: only overwrite when our snapshot is at least as new as the
    // stored one (the WHERE on the upsert path drops a stale late write).
    const result = await query.query(
      `INSERT INTO matches (id, data_version, seq, status, state, clock, economy_observations, economy_activity, career, ended_at, created_at, archive_meta, archive_state_bytes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $10::jsonb, $11, COALESCE($12, now()), $13::jsonb, $14, now())
       ON CONFLICT (id) DO UPDATE SET
         data_version = EXCLUDED.data_version,
         seq          = EXCLUDED.seq,
         status       = EXCLUDED.status,
         state        = EXCLUDED.state,
         clock        = EXCLUDED.clock,
         career       = EXCLUDED.career,
         ended_at     = COALESCE(matches.ended_at, EXCLUDED.ended_at),
         archive_meta = EXCLUDED.archive_meta,
         archive_state_bytes = EXCLUDED.archive_state_bytes,
         economy_observations = CASE
           WHEN matches.economy_observations IS NULL AND EXCLUDED.economy_observations IS NULL THEN NULL
           ELSE COALESCE(EXCLUDED.economy_observations, '{}'::jsonb) || COALESCE(matches.economy_observations, '{}'::jsonb)
         END,
         economy_activity = CASE
           WHEN matches.economy_activity IS NULL AND EXCLUDED.economy_activity IS NULL THEN NULL
           ELSE COALESCE((
             SELECT jsonb_object_agg(tenure, ids) FROM (
               SELECT tenure, jsonb_agg(activity_id ORDER BY activity_rank) AS ids FROM (
                 SELECT tenure, activity_id, row_number() OVER(PARTITION BY tenure ORDER BY source, ordinal, activity_id) AS activity_rank
                 FROM (
                   SELECT DISTINCT ON(tenure, activity_id) tenure, activity_id, source, ordinal FROM (
                     SELECT entry.key AS tenure, activity.value AS activity_id, 0 AS source, activity.ordinality AS ordinal
                     FROM jsonb_each(COALESCE(matches.economy_activity, '{}'::jsonb)) AS entry
                     CROSS JOIN LATERAL jsonb_array_elements_text(entry.value) WITH ORDINALITY AS activity
                     UNION ALL
                     SELECT entry.key AS tenure, activity.value AS activity_id, 1 AS source, activity.ordinality AS ordinal
                     FROM jsonb_each(COALESCE(EXCLUDED.economy_activity, '{}'::jsonb)) AS entry
                     CROSS JOIN LATERAL jsonb_array_elements_text(entry.value) WITH ORDINALITY AS activity
                   ) AS all_activity ORDER BY tenure, activity_id, source, ordinal
                 ) AS distinct_activity
               ) AS ranked_activity WHERE activity_rank <= $9 GROUP BY tenure
             ) AS per_tenure
           ), '{}'::jsonb)
         END,
         updated_at   = now()
       WHERE matches.seq <= EXCLUDED.seq`,
      [
        snapshot.matchId,
        snapshot.dataVersion,
        snapshot.seq,
        snapshot.status,
        snapshot.state,
        snapshot.clock ?? null,
        snapshot.economyObservations ? JSON.stringify(snapshot.economyObservations) : null,
        snapshot.economyActivity
          ? JSON.stringify(
              Object.fromEntries(
                Object.entries(snapshot.economyActivity).map(([key, ids]) => [
                  key,
                  [...new Set(ids)].slice(0, MAX_META_ACTIVITY_FACTS_PER_ROLE),
                ]),
              ),
            )
          : null,
        MAX_META_ACTIVITY_FACTS_PER_ROLE,
        snapshot.career ? JSON.stringify(snapshot.career) : null,
        snapshot.status === 'ended' ? new Date(snapshot.endedAt ?? Date.now()) : null,
        snapshot.createdAt !== undefined ? new Date(snapshot.createdAt) : null,
        snapshot.status === 'ended' ? JSON.stringify(archiveMetadataOf(snapshot)) : null,
        snapshot.status === 'ended' ? archiveStateBytes(snapshot.state) : null,
      ],
    );
    return result.rowCount === 1;
  }

  async ongoingMatchIds(): Promise<string[]> {
    // Uses matches_status_idx — never touches the JSONB `state`.
    const r = await this.pool.query<{ id: string }>(
      `SELECT id FROM matches WHERE status = 'ongoing'`,
    );
    return r.rows.map((row) => row.id);
  }

  async endedMatchIds(since: number): Promise<string[]> {
    const r = await this.pool.query<{ id: string }>(
      `SELECT id FROM matches WHERE status = 'ended' AND ended_at > $1 ORDER BY ended_at DESC, id`,
      [new Date(since)],
    );
    return r.rows.map((row) => row.id);
  }
}

export class PostgresAccountStore implements AccountStore {
  constructor(private readonly pool: Pool) {}

  async resolveSeat(
    room: string,
    nick: string,
    seats: readonly PlayerId[],
    preferred?: PlayerId,
  ): Promise<SeatAssignment | null> {
    const existing = await this.pool.query<{ player_id: string }>(
      `SELECT player_id FROM seats WHERE room = $1 AND nick = $2`,
      [room, nick],
    );
    const seat = existing.rows[0];
    if (seat) return { playerId: seat.player_id, isNew: false };

    // Assign a free seat. The unique (room, player_id) index makes the INSERT the
    // atomic claim — a concurrent claim of the same seat raises a unique violation,
    // and we fall through to the next free seat.
    const takenR = await this.pool.query<{ player_id: string }>(
      `SELECT player_id FROM seats WHERE room = $1`,
      [room],
    );
    const taken = new Set(takenR.rows.map((r) => r.player_id));
    // Preferred slot first (REL-7 seat selection): try it before the default order.
    const order =
      preferred && seats.includes(preferred) && !taken.has(preferred)
        ? [preferred, ...seats.filter((s) => s !== preferred)]
        : seats;
    for (const candidate of order) {
      if (taken.has(candidate)) continue;
      try {
        await this.pool.query(`INSERT INTO seats (room, nick, player_id) VALUES ($1, $2, $3)`, [
          room,
          nick,
          candidate,
        ]);
        return { playerId: candidate, isNew: true };
      } catch {
        // (room, nick) or (room, player_id) was claimed concurrently — try the next.
        const reread = await this.pool.query<{ player_id: string }>(
          `SELECT player_id FROM seats WHERE room = $1 AND nick = $2`,
          [room, nick],
        );
        const now = reread.rows[0];
        if (now) return { playerId: now.player_id, isNew: false };
        taken.add(candidate);
      }
    }
    return null; // every seat taken
  }

  async seatOf(room: string, nick: string): Promise<PlayerId | null> {
    const r = await this.pool.query<{ player_id: string }>(
      `SELECT player_id FROM seats WHERE room = $1 AND nick = $2`,
      [room, nick],
    );
    return r.rows[0]?.player_id ?? null;
  }

  async bindSeatTicket(room: string, nick: string, ticketHash: string): Promise<string | null> {
    // First bind wins atomically: the UPDATE only lands on a NULL hash, then the
    // SELECT reads back whichever hash is durably bound (ours, or a concurrent
    // winner's). No row (nick holds no seat) → null → the caller refuses.
    await this.pool.query(
      `UPDATE seats SET ticket_hash = $3
       WHERE room = $1 AND nick = $2 AND ticket_hash IS NULL`,
      [room, nick, ticketHash],
    );
    const r = await this.pool.query<{ ticket_hash: string | null }>(
      `SELECT ticket_hash FROM seats WHERE room = $1 AND nick = $2`,
      [room, nick],
    );
    return r.rows[0]?.ticket_hash ?? null;
  }

  async seatTicket(room: string, nick: string): Promise<string | null> {
    const r = await this.pool.query<{ ticket_hash: string | null }>(
      `SELECT ticket_hash FROM seats WHERE room = $1 AND nick = $2`,
      [room, nick],
    );
    return r.rows[0]?.ticket_hash ?? null;
  }

  async resetSeatTicket(room: string, nick: string): Promise<void> {
    await this.pool.query(`UPDATE seats SET ticket_hash = NULL WHERE room = $1 AND nick = $2`, [
      room,
      nick,
    ]);
  }

  async releaseSeat(room: string, nick: string): Promise<PlayerId | null> {
    // Одним запросом: DELETE ... RETURNING — читать место отдельным SELECT значило бы
    // окно, в котором соседний вход успел бы занять его между чтением и удалением, и
    // администратор увидел бы «снят» про уже другого человека. Билет лежит в той же
    // строке, поэтому уходит вместе с ней.
    const r = await this.pool.query<{ player_id: string }>(
      `DELETE FROM seats WHERE room = $1 AND nick = $2 RETURNING player_id`,
      [room, nick],
    );
    return (r.rows[0]?.player_id as PlayerId | undefined) ?? null;
  }

  async occupiedSeats(room: string): Promise<number> {
    const r = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM seats WHERE room = $1`,
      [room],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async seatedNicks(room: string): Promise<Array<{ playerId: PlayerId; nick: string }>> {
    const r = await this.pool.query<{ player_id: string; nick: string }>(
      `SELECT player_id, nick FROM seats WHERE room = $1`,
      [room],
    );
    return r.rows.map((row) => ({ playerId: row.player_id as PlayerId, nick: row.nick }));
  }
}

/** Durable commander XP (EC-*). `creditMatch` runs mark-then-increment in one
 *  transaction; the `commander_credits` PK makes the mark the atomic idempotency
 *  gate — a re-observed match end credits nothing a second time. */
export class PostgresCommanderStore implements CommanderStore {
  constructor(private readonly pool: Pool) {}

  async creditMatch(
    matchId: string,
    rows: ReadonlyArray<{ accountId: string; xp: number }>,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claim = await client.query(
        `INSERT INTO commander_credits (match_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [matchId],
      );
      if (claim.rowCount === 0) {
        await client.query('ROLLBACK'); // already credited — a restart re-observed the end
        return false;
      }
      for (const { accountId, xp } of rows) {
        if (xp > 0)
          await client.query(
            `INSERT INTO commander_xp (account_id, xp) VALUES ($1, $2)
             ON CONFLICT (account_id) DO UPDATE SET xp = commander_xp.xp + $2`,
            [accountId, xp],
          );
      }
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async xpOf(accountId: string): Promise<number> {
    const r = await this.pool.query<{ xp: string }>(
      `SELECT xp FROM commander_xp WHERE account_id = $1`,
      [accountId],
    );
    return Number(r.rows[0]?.xp ?? 0);
  }

  async topXp(limit: number): Promise<Array<{ accountId: string; xp: number }>> {
    // account_id is the second ORDER BY key so equal XP keeps one stable order —
    // rows that shuffle between refreshes read as a broken board.
    const r = await this.pool.query<{ account_id: string; xp: string }>(
      `SELECT account_id, xp FROM commander_xp ORDER BY xp DESC, account_id ASC LIMIT $1`,
      [Math.max(0, limit)],
    );
    return r.rows.map((row) => ({ accountId: row.account_id, xp: Number(row.xp) }));
  }

  async standingOf(accountId: string): Promise<{ rank: number | null; xp: number; total: number }> {
    // Ties SHARE a rank: «сколько аккаунтов строго выше меня» + 1. Counting rows
    // before mine instead would make the number depend on the tiebreaker.
    const r = await this.pool.query<{ xp: string | null; above: string; total: string }>(
      `SELECT (SELECT xp FROM commander_xp WHERE account_id = $1)              AS xp,
              (SELECT count(*) FROM commander_xp
                WHERE xp > (SELECT xp FROM commander_xp WHERE account_id = $1)) AS above,
              (SELECT count(*) FROM commander_xp)                              AS total`,
      [accountId],
    );
    const row = r.rows[0];
    const xp = row?.xp === null || row?.xp === undefined ? null : Number(row.xp);
    return {
      rank: xp === null ? null : Number(row?.above ?? 0) + 1,
      xp: xp ?? 0,
      total: Number(row?.total ?? 0),
    };
  }
}

export class PostgresUserStore implements UserStore {
  constructor(private readonly pool: Pool) {}

  async deletionStatus(accountId: string, requestId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM account_deletions WHERE account_id=$1 AND request_id=$2',
      [accountId, requestId],
    );
    return Boolean(result.rowCount);
  }
  async requestDeletion(
    user: UserRecord,
    requestId: string = randomUUID(),
  ): Promise<string | null> {
    const result = await this.pool.query<{ request_id: string }>(
      `
      WITH disabled AS (
        UPDATE users SET deletion_requested_at = now(), session_nonce = $4
        WHERE id = $1 AND pass_hash = $2 AND session_nonce = $3
          AND deletion_requested_at IS NULL RETURNING id,login
      ) INSERT INTO account_deletions(account_id, request_id, login_hash)
        SELECT id, $4, encode(sha256(convert_to(lower(login),'UTF8')),'hex') FROM disabled RETURNING request_id
    `,
      [user.userId, user.passHash, user.sessionNonce ?? '', requestId],
    );
    return result.rows[0]?.request_id ?? null;
  }

  async createUser(
    login: string,
    passHash: string,
    email?: string,
  ): Promise<
    { ok: true; userId: string } | { ok: false; code: 'E_LOGIN_TAKEN' | 'E_EMAIL_TAKEN' }
  > {
    if (reservedBotLogin(login)) return { ok: false, code: 'E_LOGIN_TAKEN' };
    const userId = randomUUID();
    try {
      // Historical snapshots can carry a callsign without an account ID. Reserve
      // it through the deletion-ledger/backup lifetime so replay cannot touch a
      // new person who reuses that name. The digest is still protected PDn.
      const reserved = await this.pool.query(
        "SELECT 1 FROM account_deletions WHERE login_hash=encode(sha256(convert_to(lower($1::text),'UTF8')),'hex') LIMIT 1",
        [login],
      );
      if (reserved.rowCount) return { ok: false, code: 'E_LOGIN_TAKEN' };
      await this.pool.query(
        `INSERT INTO users (id, login, pass_hash, email, registration_reward) VALUES ($1, $2, $3, $4, true)`,
        [userId, login, passHash, email?.toLowerCase() ?? null],
      );
      return { ok: true, userId };
    } catch (e) {
      // A unique-index violation makes the INSERT the atomic claim. Which one tells the
      // caller apart: login already taken vs. that recovery email already on another
      // account (the constraint name is on the pg error). Any other cause is treated as a
      // taken login too — fail-secure, no account is overwritten.
      const constraint = (e as { constraint?: string }).constraint;
      return {
        ok: false,
        code: constraint === 'users_email_idx' ? 'E_EMAIL_TAKEN' : 'E_LOGIN_TAKEN',
      };
    }
  }

  // Each lookup is a FULLY-LITERAL query (no string interpolation into SQL — the WHERE
  // clauses differ only by column, and are hardcoded here rather than passed in, so the
  // `no-sql-string-interpolation` guard stays satisfied). All three share `rowToUser`.
  async findUser(login: string): Promise<UserRecord | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT id, login, pass_hash, email, session_nonce, registration_reward FROM users WHERE lower(login) = lower($1) AND deletion_requested_at IS NULL`,
      [login],
    );
    return rowToUser(r.rows[0]);
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT id, login, pass_hash, email, session_nonce, registration_reward FROM users WHERE email IS NOT NULL AND lower(email) = lower($1) AND deletion_requested_at IS NULL`,
      [email],
    );
    return rowToUser(r.rows[0]);
  }

  async findById(userId: string): Promise<UserRecord | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT id, login, pass_hash, email, session_nonce, registration_reward FROM users WHERE id = $1 AND deletion_requested_at IS NULL`,
      [userId],
    );
    return rowToUser(r.rows[0]);
  }

  async loginsOf(userIds: readonly string[]): Promise<Record<string, string>> {
    if (userIds.length === 0) return {};
    const r = await this.pool.query<{ id: string; login: string }>(
      `SELECT id, login FROM users WHERE id = ANY($1::text[]) AND deletion_requested_at IS NULL`,
      [[...userIds]],
    );
    const out: Record<string, string> = {};
    for (const row of r.rows) out[row.id] = row.login;
    return out;
  }

  async revokeSessions(userId: string): Promise<void> {
    await this.pool.query('UPDATE users SET session_nonce = $2 WHERE id = $1', [
      userId,
      randomUUID(),
    ]);
  }

  async setPassword(userId: string, passHash: string): Promise<void> {
    await this.pool.query(`UPDATE users SET pass_hash = $2 WHERE id = $1`, [userId, passHash]);
  }
  async setPasswordIfCurrent(
    userId: string,
    expectedHash: string,
    passHash: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE users SET pass_hash = $3 WHERE id = $1 AND pass_hash = $2 AND deletion_requested_at IS NULL`,
      [userId, expectedHash, passHash],
    );
    return result.rowCount === 1;
  }
}

interface UserRow {
  id: string;
  login: string;
  pass_hash: string;
  session_nonce: string;
  email: string | null;
  registration_reward: boolean;
}

function rowToUser(row: UserRow | undefined): UserRecord | null {
  if (!row) return null;
  return {
    userId: row.id,
    login: row.login,
    passHash: row.pass_hash,
    ...(row.session_nonce ? { sessionNonce: row.session_nonce } : {}),
    registrationReward: row.registration_reward,
    ...(row.email ? { email: row.email } : {}),
  };
}

interface CorpMemberRow {
  corp_id: string;
  account_id: string;
  login: string;
  role: string;
}

function memberOf(row: CorpMemberRow): CorpMembership {
  return {
    corpId: row.corp_id,
    accountId: row.account_id,
    login: row.login,
    role: row.role as CorpRole, // the store only ever writes CorpRole values
  };
}

type CorpFacilityRow = { infrastructure: CorpInfrastructureState | null; showcase: string[] };

export class PostgresCorpStore implements CorpStore {
  async prepareBuild(corpId: string, actor: string, now: number, order: CorpBuildOrder): Promise<import('@void/protocol').CorpBuildPreparation> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const member = await db.query<{ membership_nonce: string; role: string }>('SELECT membership_nonce,role FROM corp_members WHERE account_id=$1 AND corp_id=$2 FOR UPDATE', [actor, corpId]);
      const m = member.rows[0];
      if (m?.role !== 'head') { await db.query('ROLLBACK'); return { ok: false, code: 'E_FORBIDDEN' }; }
      const old = await db.query<{ ticket: import('@void/protocol').CorpBuildTicket }>('SELECT ticket FROM corp_build_payments WHERE corp_id=$1 AND head_membership=$2 AND request_key=$3', [corpId, m.membership_nonce, order.requestId]);
      if (old.rows[0]) {
        const t = old.rows[0].ticket;
        await db.query('COMMIT');
        return t.order.price === order.price && t.order.buildingId === order.buildingId && t.order.expectedLevel === order.expectedLevel
          ? { ok: true, ticket: t } : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      }
      const result = await new PostgresCorpStore(scopedPool(db)).infrastructure(corpId, actor, now);
      const b = result.ok ? result.infrastructure.buildings.find((b) => b.id === order.buildingId) : undefined;
      let code: import('@void/protocol').CorpBuildError | null = !b?.next || b.level !== order.expectedLevel ? 'E_CORP_BUILD_LEVEL' : b.blocked;
      if (!order.requestId || !b?.next || order.price !== b.next.price) code = 'E_CORP_PRICE';
      if (code) { await db.query('COMMIT'); return { ok: false, code }; }
      const ticket = { id: randomUUID(), corpId, order: { ...order, requestId: undefined }, materials: { ...b!.next!.materials } };
      await db.query('INSERT INTO corp_build_payments(id,corp_id,head_membership,request_key,ticket) VALUES($1,$2,$3,$4,$5::jsonb)', [ticket.id, corpId, m.membership_nonce, order.requestId, JSON.stringify(ticket)]);
      await db.query('COMMIT');
      return { ok: true, ticket };
    } catch (e) { await db.query('ROLLBACK').catch(() => undefined); throw e; } finally { db.release(); }
  }
  async commitBuild(id: string, now: number): Promise<import('@void/protocol').CorpBuildSettlement> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      // Membership before receipt before corporation: same lock order as erase/disband.
      const peek = await db.query<{ head_membership: string | null }>('SELECT head_membership FROM corp_build_payments WHERE id=$1', [id]);
      const nonce = peek.rows[0]?.head_membership;
      const members = nonce ? await db.query<{ account_id: string; role: string; corp_id: string }>('SELECT account_id,role,corp_id FROM corp_members WHERE membership_nonce=$1 FOR UPDATE', [nonce]) : null;
      const row = (await db.query<{ ticket: import('@void/protocol').CorpBuildTicket; result: import('@void/protocol').CorpBuildSettlement | null; head_membership: string | null }>('SELECT ticket,result,head_membership FROM corp_build_payments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row || row.result) { await db.query('COMMIT'); return row?.result ?? { state: 'unknown' }; }
      const m = members?.rows[0];
      let result: import('@void/protocol').CorpBuildSettlement;
      if (!m || row.head_membership !== nonce || m.role !== 'head' || m.corp_id !== row.ticket.corpId)
        result = { state: 'rejected', code: 'E_FORBIDDEN' };
      else if (row.ticket.order.price !== corpBuildPrice(row.ticket.corpId, row.ticket.order)) result = { state: 'rejected', code: 'E_CORP_PRICE' };
      else {
        const applied = await new PostgresCorpStore(scopedPool(db)).infrastructure(row.ticket.corpId, m.account_id, now, row.ticket.order);
        result = applied.ok ? { state: 'applied' } : { state: 'rejected', code: applied.code };
      }
      await db.query('UPDATE corp_build_payments SET result=$2::jsonb WHERE id=$1', [id, JSON.stringify(result)]);
      await db.query('COMMIT');
      return result;
    } catch (e) { await db.query('ROLLBACK').catch(() => undefined); throw e; } finally { db.release(); }
  }

  async monumentsOf(ids: readonly string[]): Promise<string[]> {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string')) return [];
    const result = await this.pool.query<{ id: string; infrastructure: CorpInfrastructureState | null }>('SELECT id,infrastructure FROM corps WHERE id=ANY($1::text[])', [ids]);
    return result.rows.filter((row) => publicCorpFacilities(row.infrastructure, Date.now()).monument).map((row) => row.id);
  }
  async infrastructure(
    corpId: string,
    actor: string,
    now: number,
    order?: CorpBuildOrder,
  ): Promise<CorpInfrastructureResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock membership first, like disband: role transfer/kick cannot race spending.
      const members = await client.query<{ role: CorpRole }>(
        `SELECT role FROM corp_members WHERE account_id = $1 AND corp_id = $2 FOR UPDATE`,
        [actor, corpId],
      );
      const role = members.rows[0]?.role;
      if (!role || role === 'recruit' || (order && role !== 'head')) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_FORBIDDEN' };
      }
      const corps = await client.query<{
        name: string;
        influence: string;
        infrastructure: CorpInfrastructureState | null;
      }>(`SELECT name, influence, infrastructure FROM corps WHERE id = $1 FOR UPDATE`, [corpId]);
      const corp = corps.rows[0];
      if (!corp) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_FORBIDDEN' };
      }
      // CORP-6: what the level requirements count — members without recruits and the AvA
      // battles the corporation played on either side.
      const standing = await client.query<{ members: number; battles: number }>(
        `SELECT
           (SELECT count(*) FROM corp_members WHERE corp_id = $1 AND role <> 'recruit')::int AS members,
           (SELECT count(*) FROM ava_results WHERE challenger_corp = $1 OR target_corp = $1)::int AS battles`,
        [corpId],
      );
      const updated = updateCorpInfrastructure(
        corpId,
        actor,
        role,
        Number(corp.influence),
        corp.infrastructure,
        now,
        order,
        { members: standing.rows[0]?.members ?? 0, battles: standing.rows[0]?.battles ?? 0 },
      );
      await client.query(
        `UPDATE corps SET influence = $2, infrastructure = $3::jsonb WHERE id = $1`,
        [corpId, updated.influence, JSON.stringify(updated.state)],
      );
      for (const entry of updated.audit) {
        await client.query(
          `INSERT INTO corp_audit (corp_id, at, actor, action, target, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
          [corpId, entry.at, entry.actor, entry.action, entry.target ?? null, entry.detail ?? null],
        );
      }
      // CORP-1: a reached corporation level is public news, committed with the level.
      for (const news of corpLevelNews(corpId, corp.name, updated.audit)) {
        await client.query(FEED_INSERT, feedValues(news));
      }
      await client.query('COMMIT');
      return updated.result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  constructor(private readonly pool: Pool) {}

  async createCorp(
    name: string,
    headAccountId: string,
    headLogin: string,
    at: number = Date.now(),
    emblemId?: CorpEmblemId,
  ): Promise<{ ok: true; corpId: string } | { ok: false; code: 'E_NAME_TAKEN' | 'E_IN_CORP' }> {
    // One transaction, two atomic claims: the corp_members PK is the one-corp-per-
    // account claim, the lower(name) unique index is the name claim. ON CONFLICT
    // probes the first without an exception; the second reports through the catch.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const corpId = randomUUID();
      const claim = await client.query(
        `INSERT INTO corp_members (account_id, corp_id, login, role)
         VALUES ($1, $2, $3, 'head')
         ON CONFLICT (account_id) DO NOTHING`,
        [headAccountId, corpId, headLogin],
      );
      if ((claim.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_IN_CORP' };
      }
      try {
        await client.query(`INSERT INTO corps (id, name, emblem_id) VALUES ($1, $2, $3)`, [corpId, name, emblemId ?? null]);
      } catch (error) {
        const conflict = error as { code?: unknown; constraint?: unknown };
        if (conflict.code !== '23505' || conflict.constraint !== 'corps_name_idx') throw error;
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_NAME_TAKEN' };
      }
      // CORP-1: «founded» is public news, committed with the corporation itself.
      await client.query(FEED_INSERT, feedValues(corpFoundedNews(corpId, name, at)));
      await client.query('COMMIT');
      return { ok: true, corpId };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getCorp(corpId: string): Promise<CorpRecord | null> {
    const r = await this.pool.query<CorpFacilityRow & { id: string; name: string; influence: string; emblem_id: string | null }>(
      `SELECT id, name, influence, emblem_id, infrastructure, showcase FROM corps WHERE id = $1`,
      [corpId],
    );
    const row = r.rows[0];
    return row ? { corpId: row.id, name: row.name, influence: Number(row.influence),
      ...publicCorpFacilities(row.infrastructure, Date.now(), row.showcase),
      ...(isCorpEmblemId(row.emblem_id) ? { emblemId: row.emblem_id } : {}) } : null;
  }

  async setEmblem(corpId: string, actor: string, emblemId: CorpEmblemId, at: number): Promise<{ ok: true } | { ok: false; code: 'E_FORBIDDEN' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const allowed = await client.query<{ emblem_id: string | null }>(
        `SELECT c.emblem_id FROM corps c JOIN corp_members m ON m.corp_id=c.id
         WHERE c.id=$1 AND m.account_id=$2 AND m.role='head' FOR UPDATE OF c,m`, [corpId, actor]);
      if (!allowed.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_FORBIDDEN' };
      }
      if (allowed.rows[0].emblem_id !== emblemId) {
        await client.query('UPDATE corps SET emblem_id=$2 WHERE id=$1', [corpId, emblemId]);
        await client.query(`INSERT INTO corp_audit (corp_id,at,actor,action,detail) VALUES ($1,$2,$3,'emblem',$4)`,
          [corpId, at, actor, emblemId]);
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async listCorps(): Promise<CorpSummary[]> {
    const r = await this.pool.query<CorpFacilityRow & {
      id: string;
      name: string;
      influence: string;
      members: string;
      emblem_id: string | null;
    }>(
      `SELECT c.id, c.name, c.influence, c.emblem_id, c.infrastructure, c.showcase,
              count(m.account_id) FILTER (WHERE m.role <> 'recruit') AS members
       FROM corps c
       LEFT JOIN corp_members m ON m.corp_id = c.id
       GROUP BY c.id, c.name, c.influence
       ORDER BY lower(c.name)`,
    );
    return r.rows.map((row) => ({
      corpId: row.id,
      name: row.name,
      influence: Number(row.influence),
      members: Number(row.members),
      ...publicCorpFacilities(row.infrastructure, Date.now(), row.showcase),
      ...(isCorpEmblemId(row.emblem_id) ? { emblemId: row.emblem_id } : {}),
    }));
  }

  async setShowcase(corpId: string, actor: string, medalIds: readonly string[], at: number): Promise<CorpShowcaseResult> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const allowed = await db.query<CorpFacilityRow>(
        `SELECT c.infrastructure,c.showcase FROM corps c JOIN corp_members m ON m.corp_id=c.id
         WHERE c.id=$1 AND m.account_id=$2 AND m.role='head' FOR UPDATE OF c,m`, [corpId, actor]);
      const row = allowed.rows[0];
      if (!row) { await db.query('ROLLBACK'); return { ok: false, code: 'E_FORBIDDEN' }; }
      const stats = await db.query<{ wins: string; matches: string }>(
        `SELECT count(*) AS matches,count(*) FILTER(WHERE winner_corp=$1) AS wins FROM ava_results
         WHERE challenger_corp=$1 OR target_corp=$1`, [corpId]);
      const count = stats.rows[0]!;
      const error = validateShowcase(medalIds, corpFacilities(row.infrastructure, at).showcaseSlots, { wins: Number(count.wins), matches: Number(count.matches) });
      if (error) { await db.query('ROLLBACK'); return { ok: false, code: error }; }
      if (JSON.stringify(row.showcase) !== JSON.stringify(medalIds)) {
        await db.query('UPDATE corps SET showcase=$2::jsonb WHERE id=$1', [corpId, JSON.stringify(medalIds)]);
        await db.query(`INSERT INTO corp_audit(corp_id,at,actor,action,detail) VALUES($1,$2,$3,'showcase',$4)`, [corpId, at, actor, JSON.stringify(medalIds)]);
      }
      await db.query('COMMIT');
      return { ok: true };
    } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { db.release(); }
  }

  async membershipOf(accountId: string): Promise<CorpMembership | null> {
    const r = await this.pool.query<CorpMemberRow>(
      `SELECT corp_id, account_id, login, role FROM corp_members WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0] ? memberOf(r.rows[0]) : null;
  }

  async membersOf(corpId: string): Promise<CorpMembership[]> {
    const r = await this.pool.query<CorpMemberRow>(
      `SELECT corp_id, account_id, login, role FROM corp_members WHERE corp_id = $1`,
      [corpId],
    );
    return r.rows.map(memberOf);
  }

  async addMember(
    corpId: string,
    accountId: string,
    login: string,
    role: CorpRole,
  ): Promise<{ ok: true } | { ok: false; code: 'E_IN_CORP' }> {
    const r = await this.pool.query(
      `INSERT INTO corp_members (account_id, corp_id, login, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId, corpId, login, role],
    );
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_IN_CORP' };
  }

  async setRole(corpId: string, accountId: string, role: CorpRole): Promise<void> {
    await this.pool.query(
      `UPDATE corp_members SET role = $3 WHERE corp_id = $1 AND account_id = $2`,
      [corpId, accountId, role],
    );
  }

  async removeMember(corpId: string, accountId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM corp_members WHERE corp_id = $1 AND account_id = $2`, [
        corpId,
        accountId,
      ]);
      // Leaving the corp revokes the AvA player-ready consent (AVA-3).
      await client.query(`DELETE FROM player_ready WHERE account_id = $1`, [accountId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async swapHead(corpId: string, fromAccountId: string, toAccountId: string): Promise<void> {
    // One transaction so there is never a window with zero or two heads.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const demoted = await client.query(
        `UPDATE corp_members SET role = 'officer'
         WHERE corp_id = $1 AND account_id = $2 AND role = 'head'`,
        [corpId, fromAccountId],
      );
      if ((demoted.rowCount ?? 0) > 0) {
        const promoted = await client.query(
          `UPDATE corp_members SET role = 'head' WHERE corp_id = $1 AND account_id = $2`,
          [corpId, toAccountId],
        );
        if ((promoted.rowCount ?? 0) === 0) {
          // The target left (or was kicked) between the service's membership check
          // and this transaction — roll the demotion back rather than commit a
          // headless corp. Net effect: a no-op, same as the memory adapter.
          await client.query('ROLLBACK');
          return;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async removeCorp(corpId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Clear the corp's AvA readiness (its own flag + every member's consent) with it.
      await client.query(`DELETE FROM player_ready WHERE corp_id = $1`, [corpId]);
      await client.query(`DELETE FROM corp_ready WHERE corp_id = $1`, [corpId]);
      await client.query(`DELETE FROM corp_members WHERE corp_id = $1`, [corpId]);
      await client.query(`DELETE FROM corps WHERE id = $1`, [corpId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async addInfluence(corpId: string, delta: number): Promise<void> {
    if (delta <= 0) return;
    await this.pool.query(`UPDATE corps SET influence = influence + $2 WHERE id = $1`, [
      corpId,
      delta,
    ]);
  }

  async spendInfluence(
    corpId: string,
    cost: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_INSUFFICIENT' }> {
    if (cost <= 0) return { ok: false, code: 'E_INSUFFICIENT' };
    // The `influence >= cost` guard rides IN the UPDATE, so the check and the debit are
    // one atomic statement — two racing spends can't both pass and overdraw the balance.
    const r = await this.pool.query(
      `UPDATE corps SET influence = influence - $2 WHERE id = $1 AND influence >= $2`,
      [corpId, cost],
    );
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_INSUFFICIENT' };
  }

  async setCorpReady(corpId: string, since: number, formats: readonly number[]): Promise<void> {
    // Only a real corp joins the pool; keep the earliest `since`, take the new formats.
    await this.pool.query(
      `INSERT INTO corp_ready (corp_id, since, formats)
       SELECT $1, $2, $3::integer[] WHERE EXISTS (SELECT 1 FROM corps WHERE id = $1)
       ON CONFLICT (corp_id) DO UPDATE SET formats = EXCLUDED.formats`,
      [corpId, since, formats],
    );
  }

  async clearCorpReady(corpId: string): Promise<void> {
    await this.pool.query(`DELETE FROM corp_ready WHERE corp_id = $1`, [corpId]);
  }

  async listReadyCorps(): Promise<Array<CorpSummary & { readySince: number; formats: number[] }>> {
    const r = await this.pool.query<CorpFacilityRow & {
      id: string;
      name: string;
      influence: string;
      members: string;
      since: string;
      formats: number[];
      emblem_id: string | null;
    }>(
      `SELECT c.id, c.name, c.influence, c.emblem_id, c.infrastructure, c.showcase, r.since, r.formats,
              count(m.account_id) FILTER (WHERE m.role <> 'recruit') AS members
       FROM corp_ready r
       JOIN corps c ON c.id = r.corp_id
       LEFT JOIN corp_members m ON m.corp_id = c.id
       GROUP BY c.id, c.name, c.influence, r.since, r.formats
       ORDER BY lower(c.name)`,
    );
    return r.rows.map((row) => ({
      corpId: row.id,
      name: row.name,
      influence: Number(row.influence),
      members: Number(row.members),
      readySince: Number(row.since),
      formats: row.formats.map(Number),
      ...publicCorpFacilities(row.infrastructure, Date.now(), row.showcase),
      ...(isCorpEmblemId(row.emblem_id) ? { emblemId: row.emblem_id } : {}),
    }));
  }

  async readyFormatsOf(corpId: string): Promise<number[] | null> {
    const r = await this.pool.query<{ formats: number[] }>(
      `SELECT formats FROM corp_ready WHERE corp_id = $1`,
      [corpId],
    );
    return r.rows[0] ? r.rows[0].formats.map(Number) : null;
  }

  async setPlayerReady(accountId: string, corpId: string, since: number): Promise<void> {
    // Rebind to the current corp if the account moved; keep `since` when already set here.
    await this.pool.query(
      `INSERT INTO player_ready (account_id, corp_id, since) VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET corp_id = EXCLUDED.corp_id,
         since = CASE WHEN player_ready.corp_id = EXCLUDED.corp_id THEN player_ready.since
                      ELSE EXCLUDED.since END`,
      [accountId, corpId, since],
    );
  }

  async clearPlayerReady(accountId: string): Promise<void> {
    await this.pool.query(`DELETE FROM player_ready WHERE account_id = $1`, [accountId]);
  }

  async readyPlayersOf(corpId: string): Promise<string[]> {
    const r = await this.pool.query<{ account_id: string }>(
      `SELECT account_id FROM player_ready WHERE corp_id = $1 ORDER BY account_id`,
      [corpId],
    );
    return r.rows.map((row) => row.account_id);
  }

  async appendAudit(entry: CorpAuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO corp_audit (corp_id, at, actor, action, target, detail, event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(event_id) DO NOTHING`,
      [
        entry.corpId,
        entry.at,
        entry.actor,
        entry.action,
        entry.target ?? null,
        entry.detail ?? null,
        entry.eventId ?? null,
      ],
    );
  }

  async auditOf(corpId: string, limit = DEFAULT_AUDIT_LIMIT): Promise<CorpAuditEntry[]> {
    const r = await this.pool.query<{
      corp_id: string;
      at: string;
      actor: string;
      action: string;
      target: string | null;
      detail: string | null;
    }>(
      `SELECT corp_id, at, actor, action, target, detail
       FROM corp_audit WHERE corp_id = $1
       ORDER BY id DESC LIMIT $2`,
      [corpId, limit],
    );
    return r.rows.map((row) => ({
      corpId: row.corp_id,
      at: Number(row.at), // bigint arrives as a string
      actor: row.actor,
      action: row.action as CorpAuditEntry['action'],
      ...(row.target !== null ? { target: row.target } : {}),
      ...(row.detail !== null ? { detail: row.detail } : {}),
    }));
  }
}

interface ReceiptRow {
  action_id: string;
  player_id: string;
  seq: number;
  ok: boolean;
  code: string | null;
}

export class PostgresReceiptStore implements ReceiptStore {
  constructor(private readonly pool: Pool) {}

  sharesPool(pool: Pool): boolean {
    return this.pool === pool;
  }

  async loadAll(matchId: string): Promise<StoredReceipt[]> {
    const r = await this.pool.query<ReceiptRow>(
      `SELECT action_id, player_id, seq, ok, code FROM receipts WHERE match_id = $1`,
      [matchId],
    );
    return r.rows.map((row) => ({
      actionId: row.action_id,
      playerId: row.player_id,
      seq: row.seq,
      ok: row.ok,
      ...(row.code !== null ? { code: row.code } : {}),
    }));
  }

  async save(matchId: string, receipt: StoredReceipt): Promise<void> {
    await this.saveUsing(this.pool, matchId, receipt);
  }

  /** Used by the paired match adapter with its transaction client. */
  async saveUsing(
    query: Pick<Pool, 'query'>,
    matchId: string,
    receipt: StoredReceipt,
  ): Promise<void> {
    // Receipts are immutable — first write wins; a re-save of the same action is a no-op.
    await query.query(
      `INSERT INTO receipts (match_id, action_id, player_id, seq, ok, code)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (match_id, action_id) DO NOTHING`,
      [matchId, receipt.actionId, receipt.playerId, receipt.seq, receipt.ok, receipt.code ?? null],
    );
  }
}

interface ChallengeRow {
  id: string;
  challenger_corp: string;
  target_corp: string;
  format: number;
  cost: string;
  status: string;
  created_at: string;
  expires_at: string;
  pause_ends_at: string | null;
}

function challengeOf(row: ChallengeRow): AvaChallenge {
  return {
    id: row.id,
    challengerCorp: row.challenger_corp,
    targetCorp: row.target_corp,
    format: Number(row.format),
    cost: Number(row.cost),
    status: row.status as AvaChallengeStatus,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    ...(row.pause_ends_at === null ? {} : { pauseEndsAt: Number(row.pause_ends_at) }),
  };
}

/** Postgres AvA challenge store (AVA-4). The partial unique index enforces one pending
 *  per pair; the conditional UPDATE makes pending→terminal an exactly-once transition. */
export class PostgresAvaChallengeStore implements AvaChallengeStore {
  constructor(private readonly pool: Pool) {}

  async createChallenge(
    challenge: AvaChallenge,
  ): Promise<{ ok: true } | { ok: false; code: 'E_ALREADY_CHALLENGED' }> {
    const inserted = await this.pool.query(
      `INSERT INTO ava_challenges
         (id, challenger_corp, target_corp, cost, status, created_at, expires_at, format)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING id`,
      [
        challenge.id,
        challenge.challengerCorp,
        challenge.targetCorp,
        challenge.cost,
        challenge.status,
        challenge.createdAt,
        challenge.expiresAt,
        challenge.format,
      ],
    );
    return inserted.rowCount ? { ok: true } : { ok: false, code: 'E_ALREADY_CHALLENGED' };
  }

  async getChallenge(id: string): Promise<AvaChallenge | null> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? challengeOf(r.rows[0]) : null;
  }

  async challengesOf(corpId: string, limit = DEFAULT_CHALLENGES_LIMIT): Promise<AvaChallenge[]> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges
       WHERE challenger_corp = $1 OR target_corp = $1
       ORDER BY created_at DESC, id LIMIT $2`,
      [corpId, limit],
    );
    return r.rows.map(challengeOf);
  }

  async closeChallenge(id: string, status: 'accepted' | 'declined' | 'expired'): Promise<boolean> {
    // Only a still-pending row transitions — so a lost double-accept race changes
    // nothing and the caller (which keys the refund off this) can't double-refund.
    const r = await this.pool.query(
      `UPDATE ava_challenges SET status = $2 WHERE id = $1 AND status = 'pending'`,
      [id, status],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async duePending(now: number): Promise<AvaChallenge[]> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges
       WHERE status = 'pending' AND expires_at <= $1
       ORDER BY expires_at, id`,
      [now],
    );
    return r.rows.map(challengeOf);
  }

  async openRosterWindow(id: string, pauseEndsAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE ava_challenges SET pause_ends_at = $2 WHERE id = $1 AND status = 'accepted'`,
      [id, pauseEndsAt],
    );
  }

  async closeMatchup(id: string, status: 'locked' | 'cancelled'): Promise<boolean> {
    // Same exactly-once contract as closeChallenge, over the accepted state: only a
    // still-accepted matchup transitions, so the sweep can't cancel-and-refund twice.
    const r = await this.pool.query(
      `UPDATE ava_challenges SET status = $2 WHERE id = $1 AND status = 'accepted'`,
      [id, status],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async dueRosters(now: number): Promise<AvaChallenge[]> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges
       WHERE status = 'accepted' AND pause_ends_at IS NOT NULL AND pause_ends_at <= $1
       ORDER BY pause_ends_at, id`,
      [now],
    );
    return r.rows.map(challengeOf);
  }

  async lockedMatchups(limit = DEFAULT_LOCKED_MATCHUPS_LIMIT): Promise<AvaChallenge[]> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges
       WHERE status = 'locked'
       ORDER BY created_at DESC, id LIMIT $1`,
      [limit],
    );
    return r.rows.map(challengeOf);
  }

  async endMatchup(id: string, status: 'ended' | 'cancelled' = 'ended'): Promise<boolean> {
    // Same exactly-once contract as closeMatchup, over the locked state: only a
    // still-locked matchup transitions, so settlement can't award influence twice.
    const r = await this.pool.query(
      `UPDATE ava_challenges SET status = $2 WHERE id = $1 AND status = 'locked'`,
      [id, status],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

interface RosterRow {
  matchup_id: string;
  account_id: string;
  side: string;
  source: string;
  at: string;
}

function rosterEntryOf(row: RosterRow): AvaRosterEntry {
  return {
    matchupId: row.matchup_id,
    accountId: row.account_id,
    side: row.side as AvaSide,
    source: row.source as AvaRosterEntry['source'],
    at: Number(row.at),
  };
}

/** Postgres AvA roster store (AVA-6). The PK is the one-entry-per-account invariant;
 *  the per-side cap is guarded by serializing racing inserts of one matchup — the
 *  transaction takes FOR UPDATE on the matchup row before counting, so two joins for
 *  the last slot cannot both pass the count. */
export class PostgresAvaRosterStore implements AvaRosterStore {
  constructor(private readonly pool: Pool) {}

  async addEntry(
    entry: AvaRosterEntry,
    capPerSide: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_ALREADY_ROSTERED' | 'E_ROSTER_FULL' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize concurrent roster writes of this matchup (the cap guard's atomicity).
      await client.query(`SELECT id FROM ava_challenges WHERE id = $1 FOR UPDATE`, [
        entry.matchupId,
      ]);
      const dup = await client.query(
        `SELECT 1 FROM ava_roster WHERE matchup_id = $1 AND account_id = $2`,
        [entry.matchupId, entry.accountId],
      );
      if ((dup.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_ALREADY_ROSTERED' };
      }
      const onSide = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ava_roster WHERE matchup_id = $1 AND side = $2`,
        [entry.matchupId, entry.side],
      );
      if (Number(onSide.rows[0]?.n ?? 0) >= capPerSide) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_ROSTER_FULL' };
      }
      await client.query(
        `INSERT INTO ava_roster (matchup_id, account_id, side, source, at)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.matchupId, entry.accountId, entry.side, entry.source, entry.at],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async replaceSide(matchupId: string, side: AvaSide, entries: AvaRosterEntry[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM ava_challenges WHERE id = $1 FOR UPDATE`, [matchupId]);
      await client.query(`DELETE FROM ava_roster WHERE matchup_id = $1 AND side = $2`, [
        matchupId,
        side,
      ]);
      for (const entry of entries) {
        await client.query(
          `INSERT INTO ava_roster (matchup_id, account_id, side, source, at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (matchup_id, account_id) DO NOTHING`,
          [entry.matchupId, entry.accountId, entry.side, entry.source, entry.at],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async rosterOf(matchupId: string): Promise<AvaRosterEntry[]> {
    const r = await this.pool.query<RosterRow>(
      `SELECT matchup_id, account_id, side, source, at
       FROM ava_roster WHERE matchup_id = $1
       ORDER BY side, account_id`,
      [matchupId],
    );
    return r.rows.map(rosterEntryOf);
  }
}

interface ResultRow {
  matchup_id: string;
  challenger_corp: string;
  target_corp: string;
  winner_corp: string | null;
  at: string;
  format: number | null;
  report: AvaBattleReport | null;
}

function resultOf(row: ResultRow): AvaResult {
  return {
    matchupId: row.matchup_id,
    challengerCorp: row.challenger_corp,
    targetCorp: row.target_corp,
    winnerCorp: row.winner_corp,
    at: Number(row.at),
    ...(row.format === null ? {} : { format: Number(row.format) }),
    ...(row.report === null ? {} : { report: row.report }),
  };
}

/** Postgres AvA result store (AVA-8). `record` is idempotent via the matchup_id PK
 *  (ON CONFLICT DO NOTHING) — belt-and-braces behind the locked→ended gate. */
export class PostgresAvaResultStore implements AvaResultStore {
  constructor(private readonly pool: Pool) {}

  async record(result: AvaResult): Promise<void> {
    await this.pool.query(
      `INSERT INTO ava_results
         (matchup_id, challenger_corp, target_corp, winner_corp, at, format, report)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (matchup_id) DO NOTHING`,
      [
        result.matchupId,
        result.challengerCorp,
        result.targetCorp,
        result.winnerCorp,
        result.at,
        result.format ?? null,
        result.report ? JSON.stringify(result.report) : null,
      ],
    );
  }

  async get(matchupId: string): Promise<AvaResult | null> {
    const r = await this.pool.query<ResultRow>(
      `SELECT matchup_id, challenger_corp, target_corp, winner_corp, at, format, report
       FROM ava_results WHERE matchup_id = $1`,
      [matchupId],
    );
    return r.rows[0] ? resultOf(r.rows[0]) : null;
  }

  async recent(limit = DEFAULT_RESULTS_LIMIT): Promise<AvaResult[]> {
    const r = await this.pool.query<ResultRow>(
      `SELECT matchup_id, challenger_corp, target_corp, winner_corp, at, format, report
       FROM ava_results ORDER BY at DESC, matchup_id LIMIT $1`,
      [limit],
    );
    return r.rows.map(resultOf);
  }

  async resultsOf(
    corpId: string,
    limit = DEFAULT_RESULTS_LIMIT,
  ): Promise<Array<AvaResult & { format: number }>> {
    const r = await this.pool.query<ResultRow>(
      `SELECT matchup_id, challenger_corp, target_corp, winner_corp, at, format, report
       FROM ava_results WHERE challenger_corp = $1 OR target_corp = $1
       ORDER BY at DESC, matchup_id LIMIT $2`,
      [corpId, limit],
    );
    return r.rows.map((row) => ({ ...resultOf(row), format: Number(row.format ?? 2) }));
  }

  async tallyOf(corpId: string): Promise<AvaTally[]> {
    const r = await this.pool.query<{
      opponent: string;
      format: number;
      wins: string;
      losses: string;
      draws: string;
    }>(
      `SELECT
         CASE WHEN challenger_corp = $1 THEN target_corp ELSE challenger_corp END AS opponent,
         COALESCE(format, 2) AS format,
         count(*) FILTER (WHERE winner_corp = $1)::text AS wins,
         count(*) FILTER (WHERE winner_corp IS NOT NULL AND winner_corp <> $1)::text AS losses,
         count(*) FILTER (WHERE winner_corp IS NULL)::text AS draws
       FROM ava_results
       WHERE challenger_corp = $1 OR target_corp = $1
       GROUP BY 1, 2`,
      [corpId],
    );
    // Sorted here, not by the database collation: the same order as the memory store.
    return r.rows
      .map((row) => ({
        opponent: row.opponent,
        format: Number(row.format),
        wins: Number(row.wins),
        losses: Number(row.losses),
        draws: Number(row.draws),
      }))
      .sort((x, y) =>
        x.opponent < y.opponent ? -1 : x.opponent > y.opponent ? 1 : x.format - y.format,
      );
  }

  async statsForCorp(corpId: string): Promise<{ matches: number; wins: number }> {
    const r = await this.pool.query<{ matches: string; wins: string }>(
      `SELECT
         count(*) FILTER (WHERE challenger_corp = $1 OR target_corp = $1)::text AS matches,
         count(*) FILTER (WHERE winner_corp = $1)::text AS wins
       FROM ava_results`,
      [corpId],
    );
    return { matches: Number(r.rows[0]?.matches ?? 0), wins: Number(r.rows[0]?.wins ?? 0) };
  }
}

interface MedalRow {
  account_id: string;
  medal_id: string;
  corp_id: string | null;
  at: string;
}

/** Postgres medal store (MED-1) — PK (account, medal) makes `grant` idempotent (ON CONFLICT
 *  DO NOTHING; the affected-row count says whether it was newly earned). */
export class PostgresMedalStore implements MedalStore {
  constructor(private readonly pool: Pool) {}

  async grant(medal: Medal): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO medals (account_id, medal_id, corp_id, at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, medal_id) DO NOTHING`,
      [medal.accountId, medal.medalId, medal.corpId, medal.at],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async has(accountId: string, medalId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM medals WHERE account_id = $1 AND medal_id = $2`,
      [accountId, medalId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async medalsOf(accountId: string): Promise<Medal[]> {
    const r = await this.pool.query<MedalRow>(
      `SELECT account_id, medal_id, corp_id, at FROM medals
       WHERE account_id = $1 ORDER BY at DESC, medal_id`,
      [accountId],
    );
    return r.rows.map((row) => ({
      accountId: row.account_id,
      medalId: row.medal_id,
      corpId: row.corp_id,
      at: Number(row.at),
    }));
  }
}

interface FeedRow {
  id: string;
  at: string;
  kind: string;
  challenger_corp: string;
  challenger_name: string;
  target_corp: string | null;
  target_name: string | null;
  winner_corp: string | null;
  detail: { level?: unknown; medalId?: unknown } | null;
}

/** One feed row, whatever its kind (AVA-9 + CORP-1). `ON CONFLICT (id) DO NOTHING` is the
 *  idempotency the feed promises: a corp fact's id is derived from the fact. */
const FEED_INSERT = `INSERT INTO ava_feed
     (id, at, kind, challenger_corp, challenger_name, target_corp, target_name, winner_corp, detail)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
   ON CONFLICT (id) DO NOTHING`;

function feedValues(entry: FeedEntry): unknown[] {
  if (isAvaFeedEntry(entry)) {
    return [
      entry.id,
      entry.at,
      entry.kind,
      entry.challengerCorp,
      entry.challengerName,
      entry.targetCorp,
      entry.targetName,
      entry.winnerCorp ?? null,
      null,
    ];
  }
  const detail =
    entry.kind === 'level'
      ? { level: entry.level }
      : entry.kind === 'medal'
        ? { medalId: entry.medalId }
        : null;
  return [
    entry.id,
    entry.at,
    entry.kind,
    entry.corpId,
    entry.corpName,
    null,
    null,
    null,
    detail === null ? null : JSON.stringify(detail),
  ];
}

/** A stored row back to its entry; null for a kind or detail this build cannot read. */
function feedEntryOf(row: FeedRow): FeedEntry | null {
  const at = Number(row.at);
  switch (row.kind) {
    case 'matchup':
    case 'result':
      return {
        id: row.id,
        at,
        kind: row.kind,
        challengerCorp: row.challenger_corp,
        challengerName: row.challenger_name,
        targetCorp: row.target_corp ?? '',
        targetName: row.target_name ?? '',
        // A matchup entry has no winner concept; a result carries one (null = draw).
        ...(row.kind === 'result' ? { winnerCorp: row.winner_corp } : {}),
      };
    case 'founded':
      return {
        id: row.id,
        at,
        kind: 'founded',
        corpId: row.challenger_corp,
        corpName: row.challenger_name,
      };
    case 'level': {
      const level = row.detail?.level;
      return typeof level === 'number' && Number.isSafeInteger(level)
        ? {
            id: row.id,
            at,
            kind: 'level',
            corpId: row.challenger_corp,
            corpName: row.challenger_name,
            level,
          }
        : null;
    }
    case 'medal': {
      const medalId = row.detail?.medalId;
      return typeof medalId === 'string'
        ? {
            id: row.id,
            at,
            kind: 'medal',
            corpId: row.challenger_corp,
            corpName: row.challenger_name,
            medalId,
          }
        : null;
    }
    default:
      return null;
  }
}

/** Postgres public corporation feed store (AVA-9, CORP-1) — append-only, newest-first
 *  with an `at` cursor. */
export class PostgresAvaFeedStore implements AvaFeedStore {
  constructor(private readonly pool: Pool) {}

  async append(entry: FeedEntry): Promise<void> {
    await this.pool.query(FEED_INSERT, feedValues(entry));
  }

  async recent(
    limit = DEFAULT_FEED_LIMIT,
    before?: number,
    kinds?: readonly FeedKind[],
  ): Promise<FeedEntry[]> {
    const r = await this.pool.query<FeedRow>(
      `SELECT id, at, kind, challenger_corp, challenger_name, target_corp, target_name, winner_corp, detail
       FROM ava_feed
       WHERE ($2::bigint IS NULL OR at < $2) AND ($3::text[] IS NULL OR kind = ANY($3))
       ORDER BY at DESC, id DESC LIMIT $1`,
      [limit, before ?? null, kinds ? [...kinds] : null],
    );
    return r.rows.flatMap((row) => feedEntryOf(row) ?? []);
  }
}

interface AnnouncementRow {
  id: string;
  at: string;
  kind: string;
  pinned: boolean;
  until_at: string | null;
  title_ru: string;
  title_en: string;
  body_ru: string;
  body_en: string;
}

function announcementOf(row: AnnouncementRow): NewsAnnouncement {
  return {
    id: row.id,
    at: Number(row.at),
    kind: row.kind as NewsAnnouncementKind, // the CHECK constraint admits these three only
    pinned: row.pinned,
    until: row.until_at === null ? null : Number(row.until_at),
    title: { ru: row.title_ru, en: row.title_en },
    body: { ru: row.body_ru, en: row.body_en },
  };
}

/** Postgres admin announcements (CORP-1). A removal stamps `removed_at`; the row stays. */
export class PostgresAnnouncementStore implements AnnouncementStore {
  constructor(private readonly pool: Pool) {}

  async add(a: NewsAnnouncement): Promise<void> {
    await this.pool.query(
      `INSERT INTO announcements (id, at, kind, pinned, until_at, title_ru, title_en, body_ru, body_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.at, a.kind, a.pinned, a.until, a.title.ru, a.title.en, a.body.ru, a.body.en],
    );
  }

  async active(now: number): Promise<NewsAnnouncement[]> {
    const r = await this.pool.query<AnnouncementRow>(
      `SELECT id, at, kind, pinned, until_at, title_ru, title_en, body_ru, body_en FROM announcements
       WHERE removed_at IS NULL AND (until_at IS NULL OR until_at > $1)
       ORDER BY at DESC, id DESC LIMIT $2`,
      [now, ACTIVE_ANNOUNCEMENTS_MAX],
    );
    return r.rows.map(announcementOf);
  }

  async recent(limit: number): Promise<NewsAnnouncement[]> {
    const r = await this.pool.query<AnnouncementRow>(
      `SELECT id, at, kind, pinned, until_at, title_ru, title_en, body_ru, body_en FROM announcements
       WHERE removed_at IS NULL ORDER BY at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map(announcementOf);
  }

  async remove(id: string, at: number): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE announcements SET removed_at = $2 WHERE id = $1 AND removed_at IS NULL`,
      [id, at],
    );
    return (r.rowCount ?? 0) === 1;
  }
}

interface SessionRow {
  match_id: string;
  matchup_id: string;
  map_id: string;
  seats: Record<string, string>;
  at: string;
  war_at: string | null;
  war_declared_at: string | null;
}

function sessionOf(row: SessionRow): AvaSession {
  return {
    matchId: row.match_id,
    matchupId: row.matchup_id,
    mapId: row.map_id,
    seats: row.seats,
    at: Number(row.at),
    ...(row.war_at === null ? {} : { warAt: Number(row.war_at) }),
    ...(row.war_declared_at === null ? {} : { warDeclaredAt: Number(row.war_declared_at) }),
  };
}

/** The full session column list every SELECT shares (one place to extend). */
const SESSION_COLS = 'match_id, matchup_id, map_id, seats, at, war_at, war_declared_at';

/** Postgres AvA session store (AVA-7). The PK (match_id) + UNIQUE (matchup_id) make
 *  `create` atomically one-per-matchup and one-per-instance; a duplicate raises the
 *  insert conflict → `E_SESSION_EXISTS` (the orchestrator treats that as "already built"). */
export class PostgresAvaSessionStore implements AvaSessionStore {
  async pendingResults(
    limit = 100,
  ): Promise<Array<{ matchId: string; matchupId: string; winner: string | null }>> {
    const result = await this.pool.query<{
      match_id: string;
      matchup_id: string;
      winner: string | null;
    }>(
      `SELECT s.match_id,s.matchup_id,m.state->'match'->>'winner' AS winner
       FROM ava_sessions s JOIN matches m ON m.id=s.match_id
       LEFT JOIN ava_result_delivery d ON d.match_id=s.match_id
       WHERE m.status='ended' AND (d.match_id IS NULL OR (NOT d.delivered AND d.retry_at<=$2)) ORDER BY COALESCE(d.attempts,0),s.at,s.match_id LIMIT $1`,
      [limit, Date.now()],
    );
    return result.rows.map((r) => ({
      matchId: r.match_id,
      matchupId: r.matchup_id,
      winner: r.winner,
    }));
  }
  async markResultRetry(matchId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO ava_result_delivery(match_id,attempts,retry_at) VALUES($1,1,$2) ON CONFLICT(match_id) DO UPDATE SET attempts=ava_result_delivery.attempts+1,retry_at=$2',
      [matchId, Date.now() + 5000],
    );
  }
  async markResultDelivered(matchId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO ava_result_delivery(match_id,delivered) VALUES($1,true) ON CONFLICT(match_id) DO UPDATE SET delivered=true',
      [matchId],
    );
  }

  constructor(private readonly pool: Pool) {}

  async create(
    session: AvaSession,
  ): Promise<{ ok: true } | { ok: false; code: 'E_SESSION_EXISTS' }> {
    try {
      await this.pool.query(
        `INSERT INTO ava_sessions (match_id, matchup_id, map_id, seats, at, war_at, war_declared_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.matchId,
          session.matchupId,
          session.mapId,
          JSON.stringify(session.seats),
          session.at,
          session.warAt ?? null,
          session.warDeclaredAt ?? null,
        ],
      );
      return { ok: true };
    } catch {
      // PK (match_id) or UNIQUE (matchup_id) collision — a session already exists.
      return { ok: false, code: 'E_SESSION_EXISTS' };
    }
  }

  async byMatch(matchId: string): Promise<AvaSession | null> {
    const r = await this.pool.query<SessionRow>( // nosemgrep: no-sql-string-interpolation -- SESSION_COLS is a fixed column-list constant, not user input
      `SELECT ${SESSION_COLS} FROM ava_sessions WHERE match_id = $1`,
      [matchId],
    );
    return r.rows[0] ? sessionOf(r.rows[0]) : null;
  }

  async byMatchup(matchupId: string): Promise<AvaSession | null> {
    const r = await this.pool.query<SessionRow>( // nosemgrep: no-sql-string-interpolation -- SESSION_COLS is a fixed column-list constant, not user input
      `SELECT ${SESSION_COLS} FROM ava_sessions WHERE matchup_id = $1`,
      [matchupId],
    );
    return r.rows[0] ? sessionOf(r.rows[0]) : null;
  }

  async dueWar(now: number): Promise<AvaSession[]> {
    const r = await this.pool.query<SessionRow>( // nosemgrep: no-sql-string-interpolation -- SESSION_COLS is a fixed column-list constant, not user input
      `SELECT ${SESSION_COLS} FROM ava_sessions
       WHERE war_at IS NOT NULL AND war_at <= $1 AND war_declared_at IS NULL
       ORDER BY war_at, match_id`,
      [now],
    );
    return r.rows.map(sessionOf);
  }

  async markWarDeclared(matchId: string, at: number): Promise<boolean> {
    // Exactly-once: only an undeclared, war-scheduled session takes the stamp — two
    // racing sweep passes cannot both "win" and neither re-declares a declared war.
    const r = await this.pool.query(
      `UPDATE ava_sessions SET war_declared_at = $2
       WHERE match_id = $1 AND war_at IS NOT NULL AND war_declared_at IS NULL`,
      [matchId, at],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

interface ArsenalRow {
  item_id: string;
  account_id: string;
  kind: string;
  form: string;
  def_id: string;
  grade: number | null;
  soulbound: boolean;
  durability: number | null;
  origin: string;
  acquired_at: string;
}

function ownedItemOf(row: ArsenalRow): OwnedArsenalItem {
  return {
    itemId: row.item_id,
    accountId: row.account_id,
    kind: row.kind as ArsenalItem['kind'],
    form: row.form as ArsenalItem['form'],
    defId: row.def_id,
    ...(row.grade === null ? {} : { grade: row.grade }),
    soulbound: row.soulbound,
    ...(row.durability === null ? {} : { durability: row.durability }),
    origin: row.origin as ArsenalItem['origin'],
    acquiredAt: Number(row.acquired_at),
  };
}

const ARSENAL_COLS =
  'item_id, account_id, kind, form, def_id, grade, soulbound, durability, origin, acquired_at';

interface CorpRentRow {
  item_id: string;
  corp_id: string;
  matchup_id: string;
  account_id: string;
  rented_at: string;
  unworn: boolean;
}

function corpRentOf(row: CorpRentRow): CorpRent {
  return {
    itemId: row.item_id,
    corpId: row.corp_id,
    matchupId: row.matchup_id,
    accountId: row.account_id,
    rentedAt: Number(row.rented_at),
    ...(row.unworn ? { unworn: true as const } : {}),
  };
}

/** Postgres arsenal store (ARS-2). The PK makes `grant` idempotent (ON CONFLICT DO
 *  NOTHING — first write wins); transfer/consume are owner-guarded conditional writes,
 *  so a double-sell race and a soulbound move are impossible at the storage level. */
export class PostgresArsenalStore implements ArsenalStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async grant(item: OwnedArsenalItem): Promise<void> {
    await this.pool.query(
      // nosemgrep: no-sql-string-interpolation -- ARSENAL_COLS is a fixed column-list constant, not user input
      `INSERT INTO arsenal (${ARSENAL_COLS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (item_id) DO NOTHING`,
      [
        item.itemId,
        item.accountId,
        item.kind,
        item.form,
        item.defId,
        item.grade ?? null,
        item.soulbound,
        item.durability ?? null,
        item.origin,
        item.acquiredAt,
      ],
    );
  }

  async get(itemId: string): Promise<OwnedArsenalItem | null> {
    const r = await this.pool.query<ArsenalRow>( // nosemgrep: no-sql-string-interpolation -- ARSENAL_COLS is a fixed column-list constant, not user input
      `SELECT ${ARSENAL_COLS} FROM arsenal WHERE item_id = $1`,
      [itemId],
    );
    return r.rows[0] ? ownedItemOf(r.rows[0]) : null;
  }

  async listOf(accountId: string): Promise<ArsenalItem[]> {
    const r = await this.pool.query<ArsenalRow>( // nosemgrep: no-sql-string-interpolation -- ARSENAL_COLS is a fixed column-list constant, not user input
      `SELECT ${ARSENAL_COLS} FROM arsenal WHERE account_id = $1
       ORDER BY kind, def_id, item_id`,
      [accountId],
    );
    return r.rows.map((row) => {
      const { accountId: _owner, ...item } = ownedItemOf(row);
      return item;
    });
  }

  async transfer(
    itemId: string,
    from: string,
    to: string,
  ): Promise<{ ok: true } | { ok: false; code: 'E_NOT_OWNER' | 'E_SOULBOUND' }> {
    // The conditional UPDATE is the invariant: only the current owner's, non-soulbound
    // item moves — atomically, so two racing buyers cannot both win.
    const r = await this.pool.query(
      `UPDATE arsenal SET account_id = $3
       WHERE item_id = $1 AND account_id = $2 AND NOT soulbound`,
      [itemId, from, to],
    );
    if ((r.rowCount ?? 0) > 0) return { ok: true };
    // Post-hoc classification only (the guard above already held the invariant).
    const row = await this.get(itemId);
    return row && row.accountId === from && row.soulbound
      ? { ok: false, code: 'E_SOULBOUND' }
      : { ok: false, code: 'E_NOT_OWNER' };
  }

  async consume(itemId: string, accountId: string): Promise<boolean> {
    const r = await this.pool.query(`DELETE FROM arsenal WHERE item_id = $1 AND account_id = $2`, [
      itemId,
      accountId,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async wear(itemId: string, by: number): Promise<{ durability?: number } | null> {
    // Only an INSTANCE (durability IS NOT NULL) actually wears — a blueprint's row
    // stays NULL and the UPDATE simply changes nothing for it (still 1 row touched
    // if it exists, so we read the value back either way to report it honestly).
    const r = await this.pool.query<{ durability: number | null }>(
      `UPDATE arsenal SET durability = GREATEST(0, durability - $2)
       WHERE item_id = $1 AND durability IS NOT NULL
       RETURNING durability`,
      [itemId, by],
    );
    if (r.rows[0]) return { durability: r.rows[0].durability ?? undefined };
    const row = await this.get(itemId);
    if (!row) return null;
    return { durability: undefined }; // exists, but a blueprint — nothing to wear
  }
}

export class PostgresCorpRentStore implements CorpRentStore {
  async activeForCorp(corpId: string): Promise<CorpRent[]> {
    const result = await this.pool.query<CorpRentRow>('SELECT * FROM corp_arsenal_rent WHERE corp_id=$1 ORDER BY rented_at,item_id', [corpId]);
    return result.rows.map(corpRentOf);
  }
  async completeReturn(
    matchupId: string,
    itemId: string,
    at: number,
    wear: number,
  ): Promise<boolean> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const removed = await db.query<CorpRentRow>(
        'DELETE FROM corp_arsenal_rent WHERE matchup_id=$1 AND item_id=$2 RETURNING *',
        [matchupId, itemId],
      );
      const row = removed.rows[0];
      if (!row) {
        await db.query('COMMIT');
        return false;
      }
      const updated = await db.query(
        'UPDATE arsenal SET durability=CASE WHEN durability IS NULL THEN NULL ELSE GREATEST(0,durability-$3) END WHERE item_id=$1 AND account_id=$2 RETURNING item_id',
        [itemId, row.corp_id, row.unworn ? 0 : wear],
      );
      if (updated.rowCount !== 1) throw Error('E_CORP_ITEM_MISSING');
      const eventId = JSON.stringify(['rent_return', matchupId, itemId]);
      const entry: CorpAuditEntry = {
        eventId,
        corpId: row.corp_id,
        at,
        actor: 'system',
        action: 'rent_return',
        target: row.account_id,
        detail: itemId,
      };
      await db.query(
        'INSERT INTO corp_return_audit(event_id,matchup_id,entry) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
        [eventId, matchupId, JSON.stringify(entry)],
      );
      await db.query('COMMIT');
      return true;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  }
  async pendingReturnAudits(matchupId: string): Promise<CorpAuditEntry[]> {
    const result = await this.pool.query<{ entry: CorpAuditEntry }>(
      'SELECT entry FROM corp_return_audit WHERE matchup_id=$1 AND NOT delivered ORDER BY event_id',
      [matchupId],
    );
    return result.rows.map((row) => row.entry);
  }
  async markReturnAudited(eventId: string): Promise<void> {
    await this.pool.query('UPDATE corp_return_audit SET delivered=true WHERE event_id=$1', [
      eventId,
    ]);
  }
  async pendingMatchups(): Promise<string[]> {
    const result = await this.pool.query<{ matchup_id: string }>(
      `SELECT matchup_id FROM corp_arsenal_rent
       UNION SELECT matchup_id FROM corp_return_audit WHERE NOT delivered
       ORDER BY matchup_id`,
    );
    return result.rows.map((row) => row.matchup_id);
  }

  constructor(private readonly pool: Pool) {}

  async rent(entry: CorpRent): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO corp_arsenal_rent (item_id, corp_id, matchup_id, account_id, rented_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (item_id) DO NOTHING`,
      [entry.itemId, entry.corpId, entry.matchupId, entry.accountId, entry.rentedAt],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async rentWithLimit(entry: CorpRent, limit: number): Promise<'ok' | 'limit' | 'rented'> {
    if (!Number.isSafeInteger(limit) || limit < 1) return 'limit';
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['warehouse', entry.corpId, entry.matchupId])]);
      const held = await db.query('SELECT 1 FROM corp_arsenal_rent WHERE item_id=$1', [entry.itemId]);
      if (held.rowCount) { await db.query('ROLLBACK'); return 'rented'; }
      const used = await db.query<{ n: string }>('SELECT count(*) AS n FROM corp_arsenal_rent WHERE corp_id=$1 AND matchup_id=$2', [entry.corpId, entry.matchupId]);
      if (Number(used.rows[0]!.n) >= limit) { await db.query('ROLLBACK'); return 'limit'; }
      const inserted = await db.query(`INSERT INTO corp_arsenal_rent(item_id,corp_id,matchup_id,account_id,rented_at,unworn)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(item_id) DO NOTHING`,
        [entry.itemId, entry.corpId, entry.matchupId, entry.accountId, entry.rentedAt, entry.unworn === true]);
      await db.query('COMMIT');
      return inserted.rowCount ? 'ok' : 'rented';
    } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { db.release(); }
  }

  async activeForMatchup(matchupId: string): Promise<CorpRent[]> {
    const r = await this.pool.query<CorpRentRow>(
      `SELECT item_id, corp_id, matchup_id, account_id, rented_at, unworn
       FROM corp_arsenal_rent WHERE matchup_id = $1 ORDER BY item_id`,
      [matchupId],
    );
    return r.rows.map(corpRentOf);
  }

  async activeForAccount(matchupId: string, accountId: string): Promise<CorpRent[]> {
    const r = await this.pool.query<CorpRentRow>(
      `SELECT item_id, corp_id, matchup_id, account_id, rented_at, unworn
       FROM corp_arsenal_rent WHERE matchup_id = $1 AND account_id = $2 ORDER BY item_id`,
      [matchupId, accountId],
    );
    return r.rows.map(corpRentOf);
  }

  async closeRent(matchupId: string, itemId: string): Promise<boolean> {
    // Exactly-once: the DELETE only ever removes the row once — a replayed
    // match-end's second attempt finds nothing and changes nothing.
    const r = await this.pool.query(
      `DELETE FROM corp_arsenal_rent WHERE matchup_id = $1 AND item_id = $2`,
      [matchupId, itemId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

export class PostgresDropStore implements DropStore {
  constructor(private readonly pool: Pool) {}

  async claim(matchId: string, accountId: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING + rowCount IS the exactly-once gate: only the first
    // inserter of the (match, account) pair proceeds to roll.
    const r = await this.pool.query(
      `INSERT INTO drop_claims (match_id, account_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [matchId, accountId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async pityOf(accountId: string): Promise<number> {
    const r = await this.pool.query<{ pity: number }>(
      `SELECT pity FROM drop_meta WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0]?.pity ?? 0;
  }

  async setPity(accountId: string, value: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO drop_meta (account_id, pity) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET pity = $2`,
      [accountId, value],
    );
  }

  async stepPity(accountId: string, hit: boolean, pityAfter: number): Promise<number> {
    // The row lock is the atomicity: a second award pass for the same account waits
    // here and then reads the streak this one wrote, never the one it is replacing.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO drop_meta (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`,
        [accountId],
      );
      const r = await client.query<{ pity: number }>(
        `SELECT pity FROM drop_meta WHERE account_id = $1 FOR UPDATE`,
        [accountId],
      );
      const pity = r.rows[0]?.pity ?? 0;
      await client.query(`UPDATE drop_meta SET pity = $2 WHERE account_id = $1`, [
        accountId,
        hit || pity + 1 >= pityAfter ? 0 : pity + 1,
      ]);
      await client.query('COMMIT');
      return pity;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async addShards(accountId: string, delta: number): Promise<void> {
    // Atomic increment — two concurrent battle credits both land.
    await this.pool.query(
      `INSERT INTO drop_meta (account_id, shards) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET shards = drop_meta.shards + $2`,
      [accountId, delta],
    );
  }

  async shardsOf(accountId: string): Promise<number> {
    const r = await this.pool.query<{ shards: number }>(
      `SELECT shards FROM drop_meta WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0]?.shards ?? 0;
  }
}

interface FriendRow {
  lo_id: string;
  hi_id: string;
  lo_login: string;
  hi_login: string;
  requested_by: string;
  accepted: boolean;
  changed_at: string;
}

/** FRIENDS-1 · Durable social graph. Same one-row-per-pair model as the memory store
 *  (see {@link FriendStore}); the canonical sort happens here, not in the service. */
export class PostgresFriendStore implements FriendStore {
  constructor(private readonly pool: Pool) {}

  /** Canonical order: the pair is stored sorted, so lookups never need both directions. */
  private static pair(x: FriendParty, y: FriendParty): { lo: FriendParty; hi: FriendParty } {
    return x.accountId < y.accountId ? { lo: x, hi: y } : { lo: y, hi: x };
  }

  async edgesOf(accountId: string): Promise<FriendEdge[]> {
    const r = await this.pool.query<FriendRow>(
      `SELECT lo_id, hi_id, lo_login, hi_login, requested_by, accepted, changed_at
         FROM friend_edges WHERE lo_id = $1 OR hi_id = $1`,
      [accountId],
    );
    return r.rows.map((row) => {
      const mineIsLo = row.lo_id === accountId;
      return {
        accountId: mineIsLo ? row.hi_id : row.lo_id,
        login: mineIsLo ? row.hi_login : row.lo_login,
        kind: row.accepted ? 'friend' : row.requested_by === accountId ? 'outgoing' : 'incoming',
        at: Number(row.changed_at),
      } satisfies FriendEdge;
    });
  }

  async request(
    from: FriendParty,
    to: FriendParty,
    at: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_EXISTS' }> {
    const { lo, hi } = PostgresFriendStore.pair(from, to);
    // ON CONFLICT DO NOTHING is the fail-secure form: an existing pair (pending either
    // way, or accepted) is never overwritten — it reports as E_EXISTS.
    const r = await this.pool.query(
      `INSERT INTO friend_edges (lo_id, hi_id, lo_login, hi_login, requested_by, accepted, changed_at)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       ON CONFLICT (lo_id, hi_id) DO NOTHING`,
      [lo.accountId, hi.accountId, lo.login, hi.login, from.accountId, at],
    );
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_EXISTS' };
  }

  async accept(
    accountId: string,
    otherId: string,
    at: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_NO_EDGE' }> {
    const [lo, hi] = accountId < otherId ? [accountId, otherId] : [otherId, accountId];
    // The WHERE clause IS the rule: pending, and asked by the OTHER side.
    const r = await this.pool.query(
      `UPDATE friend_edges SET accepted = true, changed_at = $3
        WHERE lo_id = $1 AND hi_id = $2 AND accepted = false AND requested_by <> $4`,
      [lo, hi, at, accountId],
    );
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_NO_EDGE' };
  }

  async drop(
    accountId: string,
    otherId: string,
  ): Promise<{ ok: true } | { ok: false; code: 'E_NO_EDGE' }> {
    const [lo, hi] = accountId < otherId ? [accountId, otherId] : [otherId, accountId];
    const r = await this.pool.query(`DELETE FROM friend_edges WHERE lo_id = $1 AND hi_id = $2`, [
      lo,
      hi,
    ]);
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_NO_EDGE' };
  }

  async hidesMatches(accountId: string): Promise<boolean> {
    const r = await this.pool.query<{ hide_matches: boolean }>(
      `SELECT hide_matches FROM friend_privacy WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0]?.hide_matches ?? false;
  }

  async setHidesMatches(accountId: string, hide: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO friend_privacy (account_id, hide_matches) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET hide_matches = EXCLUDED.hide_matches`,
      [accountId, hide],
    );
  }
}

export class PostgresPushStore implements PushStore {
  constructor(private readonly pool: Pool) {}

  async save(accountId: string, sub: PushSubscriptionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth, kinds)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id) DO UPDATE
         SET endpoint = $2, p256dh = $3, auth = $4, kinds = $5`,
      [
        accountId,
        sub.endpoint,
        sub.keys.p256dh,
        sub.keys.auth,
        sub.kinds ? sub.kinds.join(',') : null,
      ],
    );
  }

  async remove(accountId: string): Promise<void> {
    await this.pool.query(`DELETE FROM push_subscriptions WHERE account_id = $1`, [accountId]);
  }

  async of(accountId: string): Promise<PushSubscriptionRecord | undefined> {
    const r = await this.pool.query<{
      endpoint: string;
      p256dh: string;
      auth: string;
      kinds: string | null;
    }>(`SELECT endpoint, p256dh, auth, kinds FROM push_subscriptions WHERE account_id = $1`, [
      accountId,
    ]);
    const row = r.rows[0];
    if (!row) return undefined;
    const kinds =
      row.kinds === null ? undefined : PUSH_KINDS.filter((k) => row.kinds!.split(',').includes(k));
    return {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
      ...(kinds ? { kinds } : {}),
    };
  }
}
