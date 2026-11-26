import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Pool } from "pg";
import { createClient } from "redis";
import { createApp } from "../src/app.js";
import { redisSessions } from "../src/modules/auth/sessions.js";

test("registration, staff provisioning, role checks and Redis session revocation", async (t) => {
  const database = process.env.TEST_DATABASE_URL;
  const cache = process.env.TEST_REDIS_URL;
  if (!database || !cache || !new URL(database).pathname.endsWith("_integration")) {
    throw new Error("Provide TEST_DATABASE_URL for a seeded *_integration database and TEST_REDIS_URL.");
  }
  const demoPassword = process.env.DEMO_PASSWORD;
  assert.ok(demoPassword, "Set DEMO_PASSWORD to the seeded accounts' password.");
  const pool = new Pool({connectionString: database});
  const redis = createClient({url: cache, disableOfflineQueue: true});
  redis.on("error", () => t.diagnostic("Redis integration connection error"));
  const suffix = randomUUID();
  const email = `patient-${suffix}@integration.test`;
  const staffEmail = `clinician-${suffix}@integration.test`;
  t.after(async () => {
    try {
      const emails = [[email, staffEmail]];
      await pool.query("DELETE FROM patients WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))", emails);
      await pool.query("DELETE FROM clinicians WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))", emails);
      await pool.query("DELETE FROM users WHERE email = ANY($1)", emails);
    } finally {
      if (redis.isOpen) await redis.close();
      await pool.end();
    }
  });
  await redis.connect();
  const server = createApp(pool, redisSessions(redis)).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const port = (server.address() as AddressInfo).port;
  function request(path: string, body?: object, cookie?: string) {
    return fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {...(body ? {"Content-Type": "application/json"} : {}), ...(cookie ? {Cookie: cookie} : {})},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function login(email: string, password: string) {
    const res = await request("/auth/login", {email, password});
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    return cookie.split(";")[0];
  }

  assert.equal((await request("/auth/me")).status, 401);
  const password = randomUUID();
  const patient = {displayName: "Synthetic patient", email, password, phone: "+267 5555555", nationalId: suffix};
  assert.equal((await request("/auth/register", {...patient, role: "admin"})).status, 400);
  const registered = await request("/auth/register", patient);
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).user.role, "patient");
  assert.equal((await request("/auth/register", patient)).status, 409);
  assert.equal((await request("/auth/login", {email, password: "wrong-password"})).status, 401);
  const patientSession = await login(email, password);
  const me = await request("/auth/me", undefined, patientSession);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, email);

  const clinic = await pool.query("SELECT id FROM clinics WHERE name = 'Central Clinic'");
  const staff = {email: staffEmail, displayName: "Synthetic clinician", password, role: "clinician", clinicId: clinic.rows[0].id};
  assert.equal((await request("/admin/staff", staff, patientSession)).status, 403);
  const adminSession = await login("admin@demo.test", demoPassword);
  const addedStaff = await request("/admin/staff", staff, adminSession);
  assert.equal(addedStaff.status, 201);
  assert.equal((await addedStaff.json()).user.clinicId, staff.clinicId);
  assert.equal((await request("/auth/logout", {}, adminSession)).status, 204);
  const staffSession = await login(staff.email, password);
  assert.equal((await (await request("/auth/me", undefined, staffSession)).json()).user.role, "clinician");
  assert.equal((await request("/auth/logout", {}, staffSession)).status, 204);
  assert.equal((await request("/auth/logout", {}, patientSession)).status, 204);
  assert.equal((await request("/auth/me", undefined, patientSession)).status, 401);
});
