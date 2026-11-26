import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { createApp } from '../src/app.js';
import { redisSessions } from '../src/modules/auth/sessions.js';

test('two patients compete for one visit, then reception and clinician complete a follow-up', async t => {
  const {TEST_DATABASE_URL, TEST_REDIS_URL, DEMO_PASSWORD} = process.env;
  assert.ok(TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).pathname.endsWith('_integration'));
  assert.ok(TEST_REDIS_URL && DEMO_PASSWORD);
  const pool = new Pool({connectionString: TEST_DATABASE_URL});
  const redis = createClient({url: TEST_REDIS_URL, disableOfflineQueue: true});
  redis.on('error', () => t.diagnostic('Redis integration connection error'));
  const slots: number[] = [];
  t.after(async () => {
    try {
      await pool.query('DELETE FROM follow_ups WHERE appointment_id IN (SELECT id FROM appointments WHERE slot_id = ANY($1::int[]))', [slots]);
      await pool.query('DELETE FROM appointments WHERE slot_id = ANY($1::int[])', [slots]);
      await pool.query('DELETE FROM slots WHERE id = ANY($1::int[])', [slots]);
    } finally {
      if (redis.isOpen) await redis.close();
      await pool.end();
    }
  });
  await redis.connect();
  const server = createApp(pool, redisSessions(redis)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/v1';
  function request(path: string, cookie: string, method = 'GET', body?: object) {
    return fetch(base + path, {method, headers: {Cookie: cookie, 'Content-Type':'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body)});
  }
  async function login(email: string) {
    const r = await request('/auth/login', '', 'POST', {email, password: DEMO_PASSWORD});
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie')!.split(';')[0];
  }
  const fixture = (await pool.query(`INSERT INTO slots (clinic_id, clinician_id, appointment_type_id, starts_at, ends_at)
    SELECT c.id, cl.id, t.id, start_time, start_time + interval '30 minutes'
    FROM clinics c, clinicians cl JOIN users u ON cl.user_id = u.id, appointment_types t,
    (SELECT (date_trunc('day', now()) + interval '40 days 10 hours') AS start_time) probe
    WHERE c.name = 'Central Clinic' AND u.email = 'clinician@demo.test' AND t.name = 'Standard consultation'
    RETURNING id, clinic_id, appointment_type_id, (starts_at AT TIME ZONE 'Africa/Gaborone')::date::text AS day`)).rows[0];
  slots.push(fixture.id);
  const [one, two, desk, otherDesk, clinician, manager] = await Promise.all(
    ['patient','patient2','reception','reception2','clinician','manager'].map(name => login(name + '@demo.test')));
  const search = '/availability?clinicId=' + fixture.clinic_id + '&appointmentTypeId=' + fixture.appointment_type_id + '&date=' + fixture.day;
  assert.ok((await (await request(search, one)).json()).slots.some((s: {id:number}) => s.id === fixture.id));
  const attempts = await Promise.all([one, two].map(cookie => request('/appointments', cookie, 'POST', {slotId:fixture.id})));
  assert.deepEqual(attempts.map(r => r.status).sort(), [201,409]);
  const winner = attempts[0].status === 201 ? 0 : 1;
  const appointment = (await attempts[winner].json()).appointment;
  const own = await request('/me/appointments', [one, two][winner]);
  assert.ok((await own.json()).appointments.some((a: {id:number}) => a.id === appointment.id));
  const others = await request('/me/appointments', [one, two][1-winner]);
  assert.ok(!(await others.json()).appointments.some((a: {id:number}) => a.id === appointment.id));
  const schedule = '/reception/schedule?clinicId=' + fixture.clinic_id + '&date=' + fixture.day;
  assert.equal((await request(schedule, one)).status, 403);
  assert.equal((await request(schedule, otherDesk)).status, 403);
  assert.ok((await (await request(schedule, desk)).json()).appointments.some((a: {id:number}) => a.id === appointment.id));
  assert.equal((await request('/reception/appointments/' + appointment.id + '/check-in', desk, 'PATCH', {})).status, 200);
  const add = await request('/appointments/' + appointment.id + '/follow-ups', clinician, 'POST',
    {task:'Call to arrange a return visit', dueDate:fixture.day});
  assert.equal(add.status, 201);
  const follow = (await add.json()).followUp;
  assert.ok((await (await request('/follow-ups', desk)).json()).followUps.some((f: {id:number}) => f.id === follow.id));
  assert.equal((await request('/follow-ups/' + follow.id, otherDesk, 'PATCH', {status:'done'})).status, 404);
  assert.equal((await request('/follow-ups/' + follow.id, desk, 'PATCH', {status:'done'})).status, 200);
  const summary = await request('/manager/summary', manager);
  assert.equal(summary.status, 200);
  assert.deepEqual(Object.keys((await summary.json()).summary).sort(), ['appointments','checkedIn','openFollowUps']);
  for (const cookie of [one,two,desk,otherDesk,clinician,manager]) {
    assert.equal((await request('/auth/logout', cookie, 'POST', {})).status, 204);
  }
});
