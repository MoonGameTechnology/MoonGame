import type { Pool, PoolClient } from 'pg';
import {
  defaultAppearance,
  REGISTRATION_REWARD,
  type ProfileAppearance,
  type RegistrationReward,
} from '@void/protocol';
import type { CommanderStore, UserStore } from './store';
import type { ProfileStore } from './profileStore';

type AcceptResult =
  | { ok: true; reward: RegistrationReward }
  | { ok: false; code: 'E_NO_REWARD' | 'E_MEDAL_SLOTS_FULL' };
export interface RegistrationRewardStore {
  /** Repairs an interrupted registration hook, but never makes an old account eligible. */
  ensure(accountId: string): Promise<RegistrationReward | null>;
  /** Acknowledgement and optional placement are one operation, with first acceptance winning. */
  accept(accountId: string, equip: boolean): Promise<AcceptResult>;
}

function equipped(appearance: ProfileAppearance): ProfileAppearance | null {
  if (appearance.slots.includes(REGISTRATION_REWARD.medalId)) return appearance;
  const slot = appearance.slots.indexOf(null);
  if (slot < 0) return null;
  const slots = [...appearance.slots];
  slots[slot] = REGISTRATION_REWARD.medalId;
  return { ...appearance, slots };
}

/** Memory/dev adapter uses the existing idempotent credits; both projections are complete
 * before exposing the receipt. A failed credit can be retried without duplicating either. */
export class MemoryRegistrationRewardStore implements RegistrationRewardStore {
  private readonly rewards = new Map<string, RegistrationReward>();
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(
    private readonly users: Pick<UserStore, 'findById'>,
    private readonly profiles: ProfileStore,
    private readonly commanders: CommanderStore,
  ) {}

  private async serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(work);
    this.queues.set(id, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(id) === current) this.queues.delete(id);
    }
  }

  private async grant(id: string): Promise<RegistrationReward | null> {
    if (!(await this.users.findById(id))?.registrationReward) return null;
    const existing = this.rewards.get(id);
    if (existing) return { ...existing };
    const key = `registration:contribution:${id}`;
    await this.profiles.credit(key, [{ accountId: id, progress: { registered: 1 } }]);
    await this.commanders.creditMatch(key, [{ accountId: id, xp: REGISTRATION_REWARD.xp }]);
    const reward = { ...REGISTRATION_REWARD, accepted: false };
    this.rewards.set(id, reward);
    return { ...reward };
  }

  ensure(id: string): Promise<RegistrationReward | null> {
    return this.serial(id, () => this.grant(id));
  }

  accept(id: string, equip: boolean): Promise<AcceptResult> {
    return this.serial(id, async () => {
      const reward = await this.grant(id);
      if (!reward) return { ok: false, code: 'E_NO_REWARD' };
      if (!reward.accepted) {
        if (equip) {
          const appearance = equipped(await this.profiles.appearance(id));
          if (!appearance) return { ok: false, code: 'E_MEDAL_SLOTS_FULL' };
          await this.profiles.save(id, appearance);
        }
        reward.accepted = true;
        this.rewards.set(id, reward);
      }
      return { ok: true, reward: { ...reward } };
    });
  }
}

export class PostgresRegistrationRewardStore implements RegistrationRewardStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async grant(client: PoolClient, id: string): Promise<RegistrationReward | null> {
    // Shared serialization point for grant and acknowledgement, even across processes.
    const eligible = await client.query<{ registration_reward: boolean }>(
      'SELECT registration_reward FROM users WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!eligible.rows[0]?.registration_reward) return null;
    const found = await client.query<{ xp: number; accepted: boolean }>(
      'SELECT xp, accepted FROM registration_rewards WHERE account_id = $1',
      [id],
    );
    if (found.rows[0]) return { ...REGISTRATION_REWARD, ...found.rows[0] };
    await client.query(
      'INSERT INTO profile_progress (account_id, metric, value) VALUES ($1, $2, 1) ON CONFLICT (account_id, metric) DO UPDATE SET value = GREATEST(profile_progress.value, 1)',
      [id, 'registered'],
    );
    await client.query(
      'INSERT INTO commander_xp (account_id, xp) VALUES ($1, $2) ON CONFLICT (account_id) DO UPDATE SET xp = commander_xp.xp + EXCLUDED.xp',
      [id, REGISTRATION_REWARD.xp],
    );
    await client.query('INSERT INTO registration_rewards (account_id, xp) VALUES ($1, $2)', [
      id,
      REGISTRATION_REWARD.xp,
    ]);
    return { ...REGISTRATION_REWARD, accepted: false };
  }

  ensure(id: string): Promise<RegistrationReward | null> {
    return this.transaction((client) => this.grant(client, id));
  }

  accept(id: string, equip: boolean): Promise<AcceptResult> {
    return this.transaction(async (client) => {
      const reward = await this.grant(client, id);
      if (!reward) return { ok: false, code: 'E_NO_REWARD' };
      if (!reward.accepted) {
        if (equip) {
          await client.query(
            'INSERT INTO player_profiles (account_id, appearance) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING',
            [id, JSON.stringify(defaultAppearance())],
          );
          const saved = await client.query<{ appearance: ProfileAppearance }>(
            'SELECT appearance FROM player_profiles WHERE account_id = $1 FOR UPDATE',
            [id],
          );
          const appearance = equipped(saved.rows[0]!.appearance);
          if (!appearance) return { ok: false, code: 'E_MEDAL_SLOTS_FULL' };
          await client.query(
            'UPDATE player_profiles SET appearance = $2::jsonb WHERE account_id = $1',
            [id, JSON.stringify(appearance)],
          );
        }
        await client.query(
          'UPDATE registration_rewards SET accepted = true WHERE account_id = $1',
          [id],
        );
        reward.accepted = true;
      }
      return { ok: true, reward };
    });
  }
}
