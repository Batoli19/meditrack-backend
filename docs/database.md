# MediClinicTrack database

An appointment belongs to one patient and reserves a specific clinician's time at a clinic. The slot describes the time the clinic offers. The appointment records who booked it. A clinician can attach several follow-up tasks to that appointment.

## Implemented entity relationships

```mermaid
erDiagram
    clinics |o--o{ users : assigns
    users ||--o| patients : identifies
    users |o--o| clinicians : identifies
    clinics ||--o{ slots : hosts
    clinicians ||--o{ slots : offers
    appointment_types ||--o{ slots : classifies
    slots ||--o{ appointments : reserves
    patients ||--o{ appointments : books
    appointments ||--o{ follow_ups : generates
    users ||--o{ follow_ups : creates
    clinics {
        int id PK
        text name UK
        text timezone
    }
    users {
        int id PK
        text email UK
        text display_name
        text password_hash
        text role
        int clinic_id FK
    }
    patients {
        int id PK
        int user_id FK,UK
        text display_name
        text phone
        text national_id_hash UK
    }
    clinicians {
        int id PK
        int user_id FK,UK
        text display_name
    }
    appointment_types {
        int id PK
        text name UK
        int duration_minutes
        boolean requires_approval
    }
    slots {
        int id PK
        int clinic_id FK
        int clinician_id FK
        int appointment_type_id FK
        timestamptz starts_at
        timestamptz ends_at
        boolean blocked
    }
    appointments {
        int id PK
        int patient_id FK
        int slot_id FK
        int clinician_id FK
        timestamptz starts_at FK
        timestamptz ends_at FK
        text status
        timestamptz created_at
    }
    follow_ups {
        int id PK
        int appointment_id FK
        int created_by FK
        date due_date
        text task
        text status
        timestamptz completed_at
    }
```

The four appointment fields `slot_id`, `clinician_id`, `starts_at` and `ends_at` form **one composite foreign key** to the slot. A slot can have several historical appointments after cancellations. The database allows at most one occupying that clinician's time.

## Rules that affect application code

- Store each slot as a start and end instant. Use the clinic's timezone when turning a calendar date into a search interval. The slot end must be later than its start.
- A PostgreSQL exclusion constraint rejects overlapping non-cancelled bookings for the same clinician, including bookings at different clinics. A 09:00–09:30 booking conflicts with 09:15–09:45. A 09:30 start is valid. A competing insert can fail with SQLSTATE `23P01` after an availability search succeeded. Return a conflict and let the patient select again.
- A cancelled booking releases its time. `checked_in`, `completed` and `no_show` retain the time in the appointment history. Clinical policies such as when to mark a no-show belong in the workflow implementing the transition.
- Each account has one role. Receptionists, clinicians and managers require a clinic on their account. Every protected query also checks record ownership or clinic scope on the server. Follow-ups store administrative task text, a due date and an `open` or `done` status. A completed task requires a completion timestamp.
- PostgreSQL stores salted scrypt password hashes and a keyed digest for duplicate national-ID checks. Redis stores temporary sessions. The cookie carries an opaque token, and the Redis key uses its digest. Keep `NATIONAL_ID_SECRET` stable across API and seed runs so duplicate-ID checks continue to work.

## Run and extend the schema

From the backend repository root, with its backend dependencies installed and the local services running, use:

```sh
npm run db:migrate
npm run db:seed
```

`DATABASE_URL` selects the PostgreSQL database. The migration role needs permission to install `btree_gist` or the extension must already exist. Initial classroom seeding reads `DEMO_PASSWORD` (at least 12 characters) and `NATIONAL_ID_SECRET` (at least 32 bytes). The seed creates fictional accounts and two clinics. Rerunning it adds missing example slots for tomorrow and the following day while preserving existing bookings and passwords. The repository setup instructions cover local environment generation. [Backend README](../README.md)

Add new schema changes as numbered SQL files in `database/migrations/`. The runner acquires a transaction lock and records completed filenames in `schema_migrations`. Extend the classroom fixtures for new data and test the upgrade against a populated database as well as an empty one. [Initial migration](../database/migrations/001_clinic_bookings.sql) · [Slot fixtures](../database/seeds/classroom_slots.sql)
