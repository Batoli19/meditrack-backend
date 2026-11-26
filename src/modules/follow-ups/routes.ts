import { Router } from 'express';
import type { Pool } from 'pg';
import { allow, ApiError, calendarDate, fields, identifier, textField } from '../../http.js';

const followUpColumns = `f.id, f.appointment_id AS "appointmentId", f.due_date::text AS "dueDate",
  f.task, f.status, p.display_name AS "patientName"`;
const followUpTables = `follow_ups f JOIN appointments a ON a.id = f.appointment_id
  JOIN slots s ON s.id = a.slot_id JOIN clinicians c ON c.id = s.clinician_id
  JOIN patients p ON p.id = a.patient_id`;
const scope = `(($1 = 'receptionist' AND s.clinic_id = $2) OR ($1 = 'clinician' AND c.user_id = $3))`;

export function followUpRoutes(pool: Pool): Router {
  const router = Router();

  router.get('/follow-ups', allow('clinician', 'receptionist'), async (_req, res) => {
    const {role, clinicId, id} = res.locals.user;
    const result = await pool.query(
      `SELECT ${followUpColumns} FROM ${followUpTables} WHERE ${scope}
       ORDER BY (f.status = 'open') DESC, f.due_date, f.id`, [role, clinicId, id]);
    res.json({followUps: result.rows});
  });

  router.post('/appointments/:id/follow-ups', allow('clinician'), async (req, res) => {
    const appointmentId = identifier(req.params.id);
    const body = fields(req.body, ['dueDate', 'task']);
    const dueDate = calendarDate(body.dueDate);
    const task = textField(body.task, 'task', 500);
    const result = await pool.query(
      `INSERT INTO follow_ups (appointment_id, created_by, due_date, task)
       SELECT a.id, c.user_id, $3::date, $4 FROM appointments a
       JOIN clinicians c ON c.id = a.clinician_id JOIN slots s ON s.id = a.slot_id
       JOIN clinics location ON location.id = s.clinic_id
       WHERE a.id = $1 AND c.user_id = $2 AND a.status IN ('checked_in','completed')
         AND $3::date >= (a.starts_at AT TIME ZONE location.timezone)::date
       RETURNING id, appointment_id AS "appointmentId", due_date::text AS "dueDate", task, status`,
      [appointmentId, res.locals.user.id, dueDate, task]);
    if (!result.rowCount) throw new ApiError(409, 'Choose your checked-in appointment and a due date on or after the visit.');
    res.status(201).json({followUp: result.rows[0]});
  });

  router.patch('/follow-ups/:id', allow('receptionist', 'clinician'), async (req, res) => {
    const followUpId = identifier(req.params.id);
    if (fields(req.body, ['status']).status !== 'done') throw new ApiError(400, 'Set status to done.');
    const {role, clinicId, id} = res.locals.user;
    const result = await pool.query(
      `UPDATE follow_ups target SET status = 'done', completed_at = coalesce(target.completed_at, now())
       FROM ${followUpTables} WHERE f.id = target.id AND f.id = $4 AND ${scope}
       RETURNING target.id, target.status`, [role, clinicId, id, followUpId]);
    if (!result.rowCount) throw new ApiError(404, 'Follow-up not found.');
    res.json({followUp: result.rows[0]});
  });

  router.get('/manager/summary', allow('manager'), async (_req, res) => {
    const result = await pool.query(
      `SELECT count(*)::int AS appointments,
        (count(*) FILTER (WHERE a.status = 'checked_in'))::int AS "checkedIn",
        (SELECT count(*)::int FROM ${followUpTables} WHERE s.clinic_id = $1 AND f.status = 'open') AS "openFollowUps"
       FROM appointments a JOIN slots s ON s.id = a.slot_id WHERE s.clinic_id = $1`, [res.locals.user.clinicId]);
    res.json({summary: result.rows[0]});
  });
  return router;
}
