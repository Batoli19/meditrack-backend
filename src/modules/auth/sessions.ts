import { createHash, randomBytes } from 'node:crypto';
import { createClient } from 'redis';

export interface SessionStore {
  create(userId: number): Promise<string>;
  get(token: string): Promise<number | null>;
  remove(token: string): Promise<void>;
}

export const SESSION_TTL_SECONDS = 8 * 60 * 60;

function keyFor(token: string): string {
  return 'meditrack:session:' + createHash('sha256').update(token).digest('hex');
}

export function redisSessions(client: ReturnType<typeof createClient>): SessionStore {
  return {
    async create(userId) {
      const token = randomBytes(32).toString('base64url');
      await client.set(keyFor(token), String(userId), { EX: SESSION_TTL_SECONDS });
      return token;
    },
    async get(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const value = await client.get(keyFor(token));
      return value === null ? null : Number(value);
    },
    async remove(token) {
      await client.del(keyFor(token));
    },
  };
}
