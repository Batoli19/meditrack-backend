import { Router, type CookieOptions, type RequestHandler } from "express";
import type { Pool } from "pg";
import { allow, ApiError, fields, identifier, sqlState, textField, type User } from "../../http.js";
import { nationalIdHash } from "./identity.js";
import { hashPassword, verifyPassword } from "./password.js";
import { SESSION_TTL_SECONDS, type SessionStore } from "./sessions.js";

const cookieName = "meditrack_session";
const userColumns = 'id, email, role, clinic_id AS "clinicId"';
// Unknown accounts go through the same password verification work as known ones.
const missingAccountHash = ["scrypt-v1", "0".repeat(32), "0".repeat(128)].join("$");

function tokenFrom(cookie: string | undefined): string | undefined {
  return cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
}

function credentials(body: Record<string, unknown>, creating: boolean) {
  const email = textField(body.email, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Invalid email address.");
  const password = body.password;
  if (typeof password !== "string" || password.length > 256 || password.length < (creating ? 12 : 1)) {
    throw new ApiError(400, creating ? "Use a password of 12 to 256 characters." : "Invalid password.");
  }
  return {email, password};
}

export function authenticated(pool: Pool, sessions: SessionStore): RequestHandler {
  return async (req, res, next) => {
    const token = tokenFrom(req.headers.cookie);
    const userId = token && await sessions.get(token);
    if (!userId) throw new ApiError(401, "Sign in to continue.");
    const result = await pool.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1`, [userId]);
    if (!result.rows[0]) throw new ApiError(401, "Sign in to continue.");
    res.locals.user = result.rows[0];
    next();
  };
}

export function authRoutes(pool: Pool, sessions: SessionStore, secureCookies: boolean): Router {
  const router = Router();
  const cookieOptions: CookieOptions = {httpOnly: true, secure: secureCookies, sameSite: "strict", path: "/api/v1"};
  const signedIn = authenticated(pool, sessions);

  router.post("/auth/login", async (req, res) => {
    const {email, password} = credentials(fields(req.body, ["email", "password"]), false);
    const result = await pool.query<User & {password_hash: string}>(
      `SELECT ${userColumns}, password_hash FROM users WHERE email = $1`, [email]);
    const account = result.rows[0];
    const verified = await verifyPassword(password, account?.password_hash ?? missingAccountHash);
    if (!account || !verified) {
      throw new ApiError(401, "Incorrect email or password.");
    }
    const old = tokenFrom(req.headers.cookie);
    if (old) await sessions.remove(old);
    const token = await sessions.create(account.id);
    res.cookie(cookieName, token, {...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000});
    res.json({user: {id: account.id, email: account.email, role: account.role, clinicId: account.clinicId}});
  });

  router.get("/auth/me", signedIn, (_req, res) => res.json({user: res.locals.user}));
  router.post("/auth/logout", async (req, res) => {
    const token = tokenFrom(req.headers.cookie);
    if (token) await sessions.remove(token);
    res.clearCookie(cookieName, cookieOptions).sendStatus(204);
  });

  router.post("/auth/register", createAccount(pool, false));
  router.post("/admin/staff", signedIn, allow("admin"), createAccount(pool, true));
  return router;
}

function createAccount(pool: Pool, staff: boolean): RequestHandler {
  return async (req, res) => {
    const extras = staff ? ["role", "clinicId"] : ["phone", "nationalId"];
    const data = fields(req.body, ["email", "password", "displayName", ...extras]);
    const {email, password} = credentials(data, true);
    const displayName = textField(data.displayName, "display name", 120);
    const role = staff ? textField(data.role, "role", 20) : "patient";
    if (staff && !["receptionist", "clinician", "manager", "admin"].includes(role)) throw new ApiError(400, "Invalid staff role.");
    const clinicId = staff ? identifier(data.clinicId) : null;
    const phone = staff ? null : textField(data.phone, "phone number", 30);
    const nationalId = staff ? null : textField(data.nationalId, "national ID", 64);
    if (phone && !/^\+?\d{6,15}$/.test(phone.replace(/[ ()-]/g, ""))) throw new ApiError(400, "Invalid phone number.");
    if (nationalId && !/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(nationalId)) throw new ApiError(400, "Invalid national ID.");
    const idHash = nationalId ? nationalIdHash(nationalId) : null;
    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<User>(
        `INSERT INTO users (email, password_hash, role, clinic_id, display_name)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${userColumns}`,
        [email, passwordHash, role, clinicId, displayName]);
      const user = result.rows[0]!;
      if (role === "patient") {
        await client.query("INSERT INTO patients (user_id, display_name, phone, national_id_hash) VALUES ($1,$2,$3,$4)",
          [user.id, displayName, phone, idHash]);
      } else if (role === "clinician") {
        await client.query("INSERT INTO clinicians (user_id, display_name) VALUES ($1,$2)", [user.id, displayName]);
      }
      await client.query("COMMIT");
      res.status(201).json({user});
    } catch (error) {
      await client.query("ROLLBACK");
      if (sqlState(error) === "23505") throw new ApiError(409, "An account with these details already exists.");
      if (sqlState(error) === "23503") throw new ApiError(400, "Unknown clinic.");
      throw error;
    } finally {
      client.release();
    }
  };
}
