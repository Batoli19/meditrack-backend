# Allen's backend implementation plan

**Start with clinic scheduling.** The starter can already read appointment slots, book a standard appointment, check in a patient and show a clinician's schedule. The availability currently comes from seeded rows. Give reception a way to produce tomorrow's real schedule from a clinician's working hours, breaks and leave. This is the first backend change the team can connect to both the patient and receptionist screens.

## 1. Publish a clinician's schedule and handle booking requests

**First pull request — working hours and slots (B10, B11).** Add a migration for recurring working hours, breaks, leave and appointment type availability. Give authorised staff a clinic-scoped way to edit working hours. Generate slots using the clinic timezone and the type duration. Expose active types to the patient booking screen. Existing bookings keep their original start and end times. Return a list of affected bookings when a clinician's leave intersects them.

**Demo.** Reception configures a 09:00–12:00 session, a 10:00–10:30 break and thirty-minute consultations. The patient sees five available starts. Repeat the generation and verify that the same five remain. Add leave over a booked slot and verify that the booking survives, reception can see the conflict, and new patients cannot take that time. Check a second clinic with a different receptionist account.

**Then handle approval and cancellation (B3–B7).** A patient requesting an approval-only type gets a pending request and can see its status. Reception can book a walk-in, review the oldest pending requests, approve one or reject it with a reason. Agree the hold lifetime and what happens at expiry before implementing the reservation model. A pending hold and a confirmed appointment must compete for a clinician's time through one transactional rule. Approval, rejection, expiry and cancellation each need an explicit outcome when repeated. Capture cancellation reason, channel and the late-cancellation flag. Confirm treatment of the exact 24-hour boundary.

**Acceptance test.** Two simultaneous approvals or bookings for overlapping times produce one valid reservation. A rejected or expired hold releases the slot. Reception at another clinic cannot approve the request. A patient can view and cancel only their own appointment.

## 2. Connect the patient record to follow-up work

**Deliverables (B9, D5, E1, E3).** Add clinic-scoped reception search by partial name, phone and exact ID digest. Support duplicate warnings for matching name and date of birth and block an exact national-ID match. Plan how reception creates a walk-in record before the patient has an online account. Add the clinician's patient history view with demographics, appointment history and open follow-ups. Keep consultation notes and test results in clinician-authorised responses. Build on the existing follow-up task and completion action by adding task type, ownership, owner/status filters, and the person who completed it. The product backlog gives follow-up ownership its own priority (E2).

**Acceptance test.** A clinician can open the history of a patient booked with them. An unrelated clinician cannot open it by changing the patient ID. Reception sees the operational follow-up, with clinical notes excluded from the response. The task appears immediately after creation, and completing it records the actor and completion time. Exercise both patients and both clinics.

## 3. Complete staff access, attendance and reporting

**Deliverables (A2, A3, D3, F1).** Extend staff provisioning with account deactivation and clinic reassignment. Apply changes to existing sessions on the next request. Use the agreed no-show timing to mark eligible unattended bookings, and let reception correct a same-day mistake with a reason. Agree how to calculate utilisation and how to count late cancellations before expanding the manager's clinic summary into a date-range report. Preserve historical attribution after a staff member leaves.

**Acceptance test.** A deactivated receptionist's existing session loses access. A repeated no-show run leaves checked-in and cancelled appointments untouched. A correction identifies the staff member and reason. Verify the manager's counts against known fixture rows, including late cancellation and no-show. Check the response for patient identifiers and repeat with a manager from a different clinic.

## Integration and release checks

For each pull request, send the frontend developer the request fields, a successful response, a permission error, and a realistic conflict or validation example. Exercise the corresponding flow through the browser and the API. Keep the current synthetic fixtures for quick startup, then expand the assessment dataset to the G4 target of two clinics, four clinicians, thirty patients, sixty appointments and ten follow-ups. Include the required conflict, late cancellation, no-show and overdue follow-up cases. For the shared demo, verify HTTPS login/logout, Redis-backed session expiry, keyboard operation and persistence after an API restart using fictional accounts.
