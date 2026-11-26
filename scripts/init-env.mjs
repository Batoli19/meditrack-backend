import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const secret = () => randomBytes(32).toString('hex');
const password = secret();
const contents = [
  'POSTGRES_PASSWORD=' + password,
  'DATABASE_URL=postgresql://meditrack:' + password + '@127.0.0.1:5432/meditrack',
  'REDIS_URL=redis://127.0.0.1:6379',
  'TEST_DATABASE_URL=postgresql://meditrack:' + password + '@127.0.0.1:5432/meditrack_integration',
  'TEST_REDIS_URL=redis://127.0.0.1:6379/2',
  'NATIONAL_ID_SECRET=' + secret(),
  'DEMO_PASSWORD=' + secret().slice(0, 24),
  'COOKIE_SECURE=false',
  'PORT=4000',
].join('\n') + '\n';
writeFileSync('.env', contents, { flag: 'wx', mode: 0o600 });
console.log('Created .env. Demo accounts use the locally generated DEMO_PASSWORD.');
