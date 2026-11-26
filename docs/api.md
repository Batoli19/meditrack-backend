# MediClinicTrack API

All paths below start with `/api/v1`. Send JSON request bodies with `Content-Type: application/json`. Use a same-origin frontend proxy for the API so the browser can send the session cookie. Request dates use the clinic’s local calendar in `YYYY-MM-DD` format. Response timestamps include a UTC offset.

## Sign-in and accounts

| Method and path | Who can call it | Input | Success |
| --- | --- | --- | --- |
| `POST /auth/register` | Public | `email, password, displayName, phone, nationalId` | `201 {user}`. Creates a patient. Call login next. |
| `POST /auth/login` | Public | `email, password` | `200 {user}` and an HTTP-only session cookie. |
| `GET /auth/me` | Signed-in user | None | `200 {user}` for the active session. |
| `POST /auth/logout` | Anyone | None | `204` with an empty body. Revokes the presented session. |
| `POST /admin/staff` | Administrator | `email, password, displayName, role, clinicId` | `201 {user}`. Allowed staff roles are `receptionist`, `clinician`, `manager` and `admin`. |

Example account response:

```json
{"user":{"id":1,"email":"patient@demo.test","role":"patient","clinicId":null}}
```

New account passwords must have 12–256 characters. PostgreSQL stores a password hash and a keyed hash of the normalized national ID. Redis sessions expire after eight hours. Each authenticated request reloads the account's role and clinic from PostgreSQL. Set `COOKIE_SECURE=true` when serving through HTTPS.

## Availability and appointments

| Method and path | Who can call it | Input | Success |
| --- | --- | --- | --- |
| `GET /catalog` | Any signed-in user | None | `200` with `clinics` and `appointmentTypes`. Each clinic has `id, name, timezone`. Each type has `id, name, durationMinutes, requiresApproval`. |
| `GET /availability` | Patient, or receptionist at the selected clinic | Query `clinicId, appointmentTypeId, date` | `200` with `slots` and `nextAvailableDate`. Each slot has `id, startsAt, endsAt, clinicianId, clinicianName`. |
| `POST /appointments` | Patient | `{"slotId":1}` | `201 {appointment}` for the signed-in patient. |
| `GET /me/appointments` | Patient | None | `200 {appointments:[...]}`, newest appointment time first. Returns only the signed-in patient's bookings. |
| `GET /reception/schedule` | Receptionist | Query `clinicId, date` | `200 {appointments:[...]}` for the receptionist’s clinic. Includes `patientName`. |
| `PATCH /reception/appointments/:id/check-in` | Receptionist | Empty body or `{}` | `200 {"appointment":{"id":1,"status":"checked_in"}}`. Requires a booked appointment at the receptionist’s clinic. |
| `GET /clinician/schedule` | Clinician | Query `date` | `200 {appointments:[...]}` for the signed-in clinician. Includes `patientName`. |

Availability excludes past and blocked slots and times that overlap an active booking for the clinician. If the requested day has no available slots, `nextAvailableDate` gives the next matching day, if one exists. A booked slot might become unavailable after a search. PostgreSQL checks overlapping bookings at write time. The API returns `409` when another booking wins and includes updated `slots` and `nextAvailableDate`. Types with `requiresApproval: true` return `409` when submitted for direct booking.

Example booking confirmation, with illustrative IDs and times:

```json
{
  "appointment": {
    "id": 1, "slotId": 4, "status": "booked",
    "startsAt": "2026-11-27T07:00:00.000Z", "endsAt": "2026-11-27T07:30:00.000Z",
    "clinicId": 1, "clinicName": "Central Clinic",
    "clinicianId": 1, "clinicianName": "Dr. Taylor",
    "appointmentTypeId": 1, "appointmentTypeName": "Standard consultation"
  }
}
```

## Follow-ups and reporting

| Method and path | Who can call it | Input | Success |
| --- | --- | --- | --- |
| `POST /appointments/:id/follow-ups` | Clinician who owns the appointment | `{"dueDate":"2026-11-30","task":"Arrange the next clinic visit"}` | `201 {followUp}` with `id, appointmentId, dueDate, task, status`. Appointment must be checked in or completed. Due date must fall on or after the visit, in clinic time. |
| `GET /follow-ups` | Clinician or receptionist | None | `200 {followUps:[...]}`. Clinicians see their own appointments and reception sees its clinic. Includes `patientName` on each item. Open items are listed first. |
| `PATCH /follow-ups/:id` | Clinician or receptionist with access to the item | `{"status":"done"}` | `200 {"followUp":{"id":1,"status":"done"}}`. Repeating the request preserves the original completion time. |
| `GET /manager/summary` | Clinic manager | None | `200 {"summary":{"appointments":3,"checkedIn":1,"openFollowUps":1}}` for the manager’s clinic, across all dates. |

## Errors to test

Errors contain an `error` message. Examples that exercise the access rules:

- Missing or expired session on `GET /auth/me` → `401`.
- Signed-in patient calling `GET /reception/schedule` → `403`. Reception asking for another clinic’s schedule also returns `403`.
- Invalid date or unknown fields in a booking body → `400`. Unknown slot ID → `404`.
- Two patients booking overlapping times with the same clinician → one `201` and one `409`.
- A second patient calling `GET /me/appointments` → `200` with only that patient's records.

## Classroom walkthrough

1. Sign in as `patient@demo.test`. Open the catalog, search for a standard consultation at Central Clinic on the day after seeding, then book an open time. Refresh the patient’s appointments.
2. Sign in as `reception@demo.test`. Open Central Clinic’s schedule for the booking date and check the patient in.
3. Sign in as `clinician@demo.test`. Open the same date in the clinician’s schedule and create a follow-up on the checked-in appointment.
4. Return to reception, open follow-ups and mark the task done. Sign in as `manager@demo.test` to see the clinic totals.

The seeded accounts use the `DEMO_PASSWORD` configured for that development environment. Standard bookings, check-in and follow-ups are implemented here. Approval requests, cancellation, working-hours administration and automated no-show marking remain backlog work.
