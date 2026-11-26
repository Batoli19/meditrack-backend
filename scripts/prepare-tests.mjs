import { spawnSync } from 'node:child_process';
import { Client } from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL || '');
const name = url.pathname.slice(1);
if (!/^[a-z][a-z0-9_]*_integration$/.test(name)) throw new Error('TEST_DATABASE_URL must name a dedicated *_integration database.');
url.pathname = '/postgres';
const client = new Client({connectionString:url.href});
await client.connect();
try {
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!found.rowCount) await client.query('CREATE DATABASE "' + name + '"');
} finally {
  await client.end();
}
const result = spawnSync(process.execPath, ['--import','tsx','src/migrate.ts','--seed'], {
  stdio:'inherit', env:{...process.env, DATABASE_URL:process.env.TEST_DATABASE_URL},
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
