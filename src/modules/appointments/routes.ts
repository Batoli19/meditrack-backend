import { Router } from "express";
import type { Pool } from "pg";
import { allow, ApiError, calendarDate, fields, identifier, sqlState, type User } from "../../http.js";

const openSlot = `s.starts_at > now() AND NOT s.blocked AND NOT EXISTS (
  SELECT 1 FROM appointments other
  WHERE other.clinician_id = s.clinician_id AND other.status <> 'cancelled'
    AND tstzrange(other.starts_at, other.ends_at, '[)') && tstzrange(s.starts_at, s.ends_at, '[)')
)`;

const bookingColumns = `a.id, a.slot_id AS "slotId", a.status, a.starts_at AS "startsAt", a.ends_at AS "endsAt",
  c.id AS "clinicId", c.name AS "clinicName", s.clinician_id AS "clinicianId", cl.display_name AS "clinicianName",
  t.id AS "appointmentTypeId", t.name AS "appointmentTypeName"`;
const bookingTables = `appointments a JOIN slots s ON s.id = a.slot_id
  JOIN clinics c ON c.id = s.clinic_id JOIN clinicians cl ON cl.id = s.clinician_id
  JOIN appointment_types t ON t.id = s.appointment_type_id JOIN patients p ON p.id = a.patient_id`;

async function availability(pool: Pool, clinicId: number, typeId: number, day: string) {
  const params = [clinicId, typeId, day];
  const filteredSlots = `FROM slots s JOIN clinics c ON c.id = s.clinic_id
    JOIN clinicians cl ON cl.id = s.clinician_id WHERE s.clinic_id = $1 AND s.appointment_type_id = $2 AND ${openSlot}`;
  const localDate = "(s.starts_at AT TIME ZONE c.timezone)::date";
  const {rows: slots} = await pool.query(
    `SELECT s.id, s.starts_at AS "startsAt", s.ends_at AS "endsAt", cl.id AS "clinicianId", cl.display_name AS "clinicianName"
     ${filteredSlots} AND ${localDate} = $3::date ORDER BY s.starts_at, s.id`, params);
  if (slots.length) return {slots, nextAvailableDate: null};
  const next = await pool.query(
    `SELECT to_char(min(${localDate}), 'YYYY-MM-DD') AS day ${filteredSlots} AND ${localDate} > $3::date`, params);
  return {slots, nextAvailableDate: next.rows[0].day as string | null};
}

export function appointmentRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/catalog", async (_req, res) => {
    const [clinics, types] = await Promise.all([
      pool.query("SELECT id, name, timezone FROM clinics ORDER BY name"),
      pool.query('SELECT id, name, duration_minutes AS "durationMinutes", requires_approval AS "requiresApproval" FROM appointment_types ORDER BY name'),
    ]);
    res.json({clinics: clinics.rows, appointmentTypes: types.rows});
  });

  router.get("/availability", allow("patient", "receptionist"), async (req, res) => {
    const query = fields(req.query, ["clinicId", "appointmentTypeId", "date"]);
    const clinicId = identifier(query.clinicId);
    const user: User = res.locals.user;
    if (user.role === "receptionist" && user.clinicId !== clinicId) throw new ApiError(403, "Access denied.");
    res.json(await availability(pool, clinicId, identifier(query.appointmentTypeId), calendarDate(query.date)));
  });

  router.post("/appointments", allow("patient"), async (req, res) => {
    const slotId = identifier(fields(req.body, ["slotId"]).slotId);
    const user: User = res.locals.user;
    const slot = (await pool.query(
      `SELECT s.clinic_id, s.appointment_type_id, t.requires_approval,
              to_char(s.starts_at AT TIME ZONE c.timezone, 'YYYY-MM-DD') AS day
       FROM slots s JOIN clinics c ON c.id = s.clinic_id JOIN appointment_types t ON t.id = s.appointment_type_id
       WHERE s.id = $1`, [slotId])).rows[0];
    if (!slot) throw new ApiError(404, "Slot not found.");
    if (slot.requires_approval) throw new ApiError(409, "This appointment type requires reception approval.");

    let id: number | undefined;
    try {
      const saved = await pool.query<{id: number}>(
        `INSERT INTO appointments (patient_id, slot_id, clinician_id, starts_at, ends_at)
         SELECT p.id, s.id, s.clinician_id, s.starts_at, s.ends_at
         FROM slots s JOIN patients p ON p.user_id = $2 JOIN appointment_types t ON t.id = s.appointment_type_id
         WHERE s.id = $1 AND NOT t.requires_approval AND ${openSlot}
         RETURNING id`, [slotId, user.id]);
      id = saved.rows[0]?.id;
    } catch (error) {
      if (!["23P01", "23505"].includes(sqlState(error) ?? "")) throw error;
    }
    if (id === undefined) {
      const alternatives = await availability(pool, slot.clinic_id, slot.appointment_type_id, slot.day);
      res.status(409).json({error: "That time is unavailable. Choose another appointment.", ...alternatives});
      return;
    }
    const booked = await pool.query(`SELECT ${bookingColumns} FROM ${bookingTables} WHERE a.id = $1`, [id]);
    res.status(201).json({appointment: booked.rows[0]});
  });

  router.get("/me/appointments", allow("patient"), async (req, res) => {
    fields(req.query, []);
    const result = await pool.query(
      `SELECT ${bookingColumns} FROM ${bookingTables} WHERE p.user_id = $1 ORDER BY a.starts_at DESC, a.id`,
      [res.locals.user.id]);
    res.json({appointments: result.rows});
  });

  router.get("/reception/schedule", allow("receptionist"), async (req, res) => {
    const query = fields(req.query, ["clinicId", "date"]);
    const clinicId = identifier(query.clinicId);
    if (clinicId !== res.locals.user.clinicId) throw new ApiError(403, "Access denied.");
    const result = await pool.query(
      `SELECT ${bookingColumns}, p.display_name AS "patientName" FROM ${bookingTables}
       WHERE c.id = $1 AND (a.starts_at AT TIME ZONE c.timezone)::date = $2::date ORDER BY a.starts_at, a.id`,
      [clinicId, calendarDate(query.date)]);
    res.json({appointments: result.rows});
  });

  router.patch("/reception/appointments/:id/check-in", allow("receptionist"), async (req, res) => {
    fields(req.body ?? {}, []);
    const id = identifier(req.params.id);
    const saved = await pool.query(
      `UPDATE appointments a SET status = 'checked_in' FROM slots s
       WHERE a.id = $1 AND s.id = a.slot_id AND s.clinic_id = $2 AND a.status = 'booked'
       RETURNING a.id, a.status`, [id, res.locals.user.clinicId]);
    if (!saved.rows[0]) throw new ApiError(409, "No appointment available for check-in.");
    res.json({appointment: saved.rows[0]});
  });

  router.get("/clinician/schedule", allow("clinician"), async (req, res) => {
    const query = fields(req.query, ["date"]);
    const result = await pool.query(
      `SELECT ${bookingColumns}, p.display_name AS "patientName" FROM ${bookingTables}
       WHERE cl.user_id = $1 AND (a.starts_at AT TIME ZONE c.timezone)::date = $2::date ORDER BY a.starts_at, a.id`,
      [res.locals.user.id, calendarDate(query.date)]);
    res.json({appointments: result.rows});
  });
  return router;
}
