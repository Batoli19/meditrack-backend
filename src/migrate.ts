import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg, { type PoolClient } from 'pg';
import { nationalIdHash } from './modules/auth/identity.js';
import { hashPassword } from './modules/auth/password.js';

const migrationsDirectory = resolve('database/migrations');
const fixtureName = 'seed/classroom-accounts-v1';

async function seedAccounts(client: PoolClient, password: string): Promise<void> {
  await client.query(`INSERT INTO clinics (name, timezone) VALUES
    ('Central Clinic', 'Africa/Gaborone'), ('West Clinic', 'Africa/Gaborone')`);
  await client.query(`INSERT INTO appointment_types (name, duration_minutes, requires_approval) VALUES
    ('Standard consultation', 30, false), ('Extended consultation', 45, true)`);

  const accounts = [
    ['patient@demo.test', 'Demo Patient One', 'patient', null],
    ['patient2@demo.test', 'Demo Patient Two', 'patient', null],
    ['reception@demo.test', 'Central Receptionist', 'receptionist', 'Central Clinic'],
    ['reception2@demo.test', 'West Receptionist', 'receptionist', 'West Clinic'],
    ['clinician@demo.test', 'Dr. Taylor', 'clinician', 'Central Clinic'],
    ['clinician2@demo.test', 'Dr. Jordan', 'clinician', 'West Clinic'],
    ['manager@demo.test', 'Central Manager', 'manager', 'Central Clinic'],
    ['admin@demo.test', 'System Administrator', 'admin', null],
  ];
  for (const [email, displayName, role, clinicName] of accounts) {
    await client.query(
      `INSERT INTO users (email, display_name, password_hash, role, clinic_id)
       VALUES ($1, $2, $3, $4, (SELECT id FROM clinics WHERE name = $5))`,
      [email, displayName, await hashPassword(password), role, clinicName],
    );
  }

  await client.query(
    `INSERT INTO patients (user_id, display_name, phone, national_id_hash) VALUES
       ((SELECT id FROM users WHERE email = 'patient@demo.test'), 'Demo Patient One', '+00000000001', $1),
       ((SELECT id FROM users WHERE email = 'patient2@demo.test'), 'Demo Patient Two', '+00000000002', $2)`,
    [nationalIdHash('DEMO00001'), nationalIdHash('DEMO00002')],
  );
  await client.query(`INSERT INTO clinicians (user_id, display_name) VALUES
    ((SELECT id FROM users WHERE email = 'clinician@demo.test'), 'Dr. Taylor'),
    ((SELECT id FROM users WHERE email = 'clinician2@demo.test'), 'Dr. Jordan')`);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const seed = args[0] === '--seed';
  if (args.length > 1 || (args.length === 1 && !seed)) throw new Error('Expected no arguments or --seed.');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL before running migrations.');

  const pool = new pg.Pool({ connectionString });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('meditrack.schema'))");
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const rows = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
      const applied = new Set(rows.rows.map(row => row.name));
      const filenames = (await readdir(migrationsDirectory)).filter(name => name.endsWith('.sql')).sort();
      for (const name of filenames) {
        if (applied.has(name)) continue;
        await client.query(await readFile(resolve(migrationsDirectory, name), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      }
      if (seed) {
        if (!applied.has(fixtureName)) {
          const password = process.env.DEMO_PASSWORD;
          if (!password || password.length < 12) throw new Error('Set DEMO_PASSWORD to at least 12 characters.');
          await seedAccounts(client, password);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [fixtureName]);
        }
        await client.query(await readFile(resolve('database/seeds/classroom_slots.sql'), 'utf8'));
      }
      await client.query('COMMIT');
      console.log(seed ? 'Schema and classroom fixtures ready.' : 'Schema ready.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
