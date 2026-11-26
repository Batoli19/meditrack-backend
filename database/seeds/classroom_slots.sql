-- All clinic times below are local. Include adjacent, overlapping, and blocked examples.
WITH samples(clinic_name, clinician_email, type_name, days_ahead, local_start, blocked) AS (
    VALUES ('Central Clinic', 'clinician@demo.test', 'Standard consultation', 1, time '09:00', false),
           ('Central Clinic', 'clinician@demo.test', 'Standard consultation', 1, time '09:15', false),
           ('Central Clinic', 'clinician@demo.test', 'Standard consultation', 1, time '09:30', false),
           ('Central Clinic', 'clinician@demo.test', 'Standard consultation', 1, time '10:00', true),
           ('Central Clinic', 'clinician@demo.test', 'Standard consultation', 2, time '09:00', false),
           ('Central Clinic', 'clinician@demo.test', 'Extended consultation', 1, time '11:00', false),
           ('West Clinic', 'clinician2@demo.test', 'Standard consultation', 1, time '09:00', false)
),
schedule AS (
    SELECT c.id AS clinic_id, clinician.id AS clinician_id, t.id AS type_id, t.duration_minutes,
           ((current_timestamp AT TIME ZONE c.timezone)::date + s.days_ahead + s.local_start)
               AT TIME ZONE c.timezone AS starts_at, s.blocked
    FROM samples AS s
    JOIN clinics AS c ON c.name = s.clinic_name
    JOIN users AS u ON u.email = s.clinician_email
    JOIN clinicians AS clinician ON clinician.user_id = u.id
    JOIN appointment_types AS t ON t.name = s.type_name
)
INSERT INTO slots (clinic_id, clinician_id, appointment_type_id, starts_at, ends_at, blocked)
SELECT clinic_id, clinician_id, type_id, starts_at, starts_at + make_interval(mins => duration_minutes), blocked
FROM schedule
ON CONFLICT (clinic_id, clinician_id, appointment_type_id, starts_at, ends_at) DO NOTHING;
