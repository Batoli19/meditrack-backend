CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE clinics (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    timezone text NOT NULL
);

CREATE TABLE users (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
    display_name text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('patient', 'receptionist', 'clinician', 'manager', 'admin')),
    clinic_id integer REFERENCES clinics (id),
    CHECK (role NOT IN ('receptionist', 'clinician', 'manager') OR clinic_id IS NOT NULL)
);

CREATE TABLE patients (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL UNIQUE REFERENCES users (id),
    display_name text NOT NULL,
    phone text NOT NULL,
    national_id_hash text NOT NULL UNIQUE
);

CREATE TABLE clinicians (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer UNIQUE REFERENCES users (id),
    display_name text NOT NULL
);

CREATE TABLE appointment_types (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
    requires_approval boolean NOT NULL DEFAULT false
);

CREATE TABLE slots (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clinic_id integer NOT NULL REFERENCES clinics (id),
    clinician_id integer NOT NULL REFERENCES clinicians (id),
    appointment_type_id integer NOT NULL REFERENCES appointment_types (id),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    blocked boolean NOT NULL DEFAULT false,
    UNIQUE (id, clinician_id, starts_at, ends_at),
    UNIQUE (clinic_id, clinician_id, appointment_type_id, starts_at, ends_at)
);

CREATE INDEX slots_search ON slots (clinic_id, appointment_type_id, starts_at) WHERE NOT blocked;

CREATE TABLE appointments (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id integer NOT NULL REFERENCES patients (id),
    slot_id integer NOT NULL,
    clinician_id integer NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'checked_in', 'completed', 'no_show', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),

    -- The copied time range lets PostgreSQL enforce overlap and the FK keeps it tied to its actual slot.
    FOREIGN KEY (slot_id, clinician_id, starts_at, ends_at)
        REFERENCES slots (id, clinician_id, starts_at, ends_at),
    CONSTRAINT appointments_clinician_no_overlap EXCLUDE USING gist (
        clinician_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status <> 'cancelled')
);

CREATE INDEX appointments_patient_time ON appointments (patient_id, starts_at);

CREATE TABLE follow_ups (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id integer NOT NULL REFERENCES appointments (id),
    created_by integer NOT NULL REFERENCES users (id),
    due_date date NOT NULL,
    task text NOT NULL CHECK (btrim(task) <> ''),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    completed_at timestamptz,
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

CREATE INDEX follow_ups_appointment ON follow_ups (appointment_id);
CREATE INDEX follow_ups_open_due ON follow_ups (due_date) WHERE status = 'open';
