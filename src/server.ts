import { Pool } from 'pg';
import { createClient } from 'redis';
import { createApp } from './app.js';
import { redisSessions } from './modules/auth/sessions.js';

const { DATABASE_URL, REDIS_URL, NATIONAL_ID_SECRET } = process.env;
if (!DATABASE_URL || !REDIS_URL || Buffer.byteLength(NATIONAL_ID_SECRET ?? '') < 32) {
  throw new Error('Set DATABASE_URL, REDIS_URL and a NATIONAL_ID_SECRET of at least 32 bytes before starting.');
}

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = createClient({ url: REDIS_URL, disableOfflineQueue: true });
redis.on('error', () => console.error('Redis connection error'));
pool.on('error', () => console.error('PostgreSQL connection error'));
await pool.query('SELECT 1');
await redis.connect();
const app = createApp(pool, redisSessions(redis), process.env.COOKIE_SECURE === 'true');
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log('MediClinicTrack API listening on port', port));
function shutdown() {
  server.close(async () => {
    await Promise.allSettled([pool.end(), redis.close()]);
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
