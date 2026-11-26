# MediClinicTrack backend

The patient books a visit, reception checks the patient in, the clinician creates a follow-up and reception completes it. The React web app calls a Node.js and TypeScript API. PostgreSQL owns clinic data and enforces booking conflicts. Redis holds expiring login sessions. The API checks each user’s role and limits which records they can read or change.

## Get both repositories

Use Node.js 22.18 or newer. Run these commands from the directory that will contain both repositories.

```sh
git clone --branch feat/allen-backend-foundation https://github.com/Batoli19/meditrack-backend.git
git clone --branch feat/clinic-web https://github.com/Batoli19/meditrack-frontend.git
cd meditrack-backend
npm ci
npm run env:init
```

`env:init` creates a private `.env` with a generated database password, classroom login password and national-ID hashing key. Keep that file local. Preserve its values when restarting with the same database.

## Start coding locally

From the backend directory, start PostgreSQL and Redis with Docker Compose, then run the API. If the services already run locally, point `DATABASE_URL` and `REDIS_URL` at them and begin with the migration command.

```sh
docker compose up -d --wait postgres redis
npm run db:migrate
npm run db:seed
npm run dev
```

In a second terminal, start the web app.

```sh
cd meditrack-frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. The dev server forwards `/api/v1` to `127.0.0.1:4000`. Sign in as `patient@demo.test`, `reception@demo.test`, `clinician@demo.test`, `manager@demo.test` or `admin@demo.test` using the generated `DEMO_PASSWORD` in your own `.env`. Use Central Clinic and a future seeded date for the booking walkthrough.

## Where Alan works

| Folder | Responsibility |
| --- | --- |
| `src/modules/auth/` | Registration, staff provisioning, sign-in, role lookup, password and identity hashing, Redis session creation and revocation |
| `src/modules/appointments/` | Availability, appointment confirmation, personal bookings, reception and clinician schedules, check-in |
| `src/modules/follow-ups/` | Clinician tasks, reception completion and aggregate clinic counts |
| `database/migrations/` | Ordered, transactional PostgreSQL schema changes and booking constraints |
| `database/seeds/` | Synthetic availability data; the migration runner also creates fictional role accounts |
| `tests/` | Real HTTP, PostgreSQL and Redis integration checks |
| `docs/` | Entity relationships, API contracts, deployment topology and implementation work packages |

**Alan’s first feature is clinician scheduling.** Let authorised staff enter a clinician’s working hours, breaks and leave, and let those rules generate the slots patients can actually book. Existing bookings must survive a schedule change. The plan gives acceptance cases for this feature and the later approval, cancellation, clinical-record and reporting work. [Implementation plan](docs/implementation-plan.md)

Review the schema and endpoint contracts before changing either side of the web app. [Database and ERD](docs/database.md) · [API and role access](docs/api.md) · [Local and shared environments](docs/runtime.md)

## Verify a change

```sh
npm run build
npm run test:prepare
npm test
```

The tests use `TEST_DATABASE_URL` for a dedicated database ending in `_integration` and `TEST_REDIS_URL` for a separate Redis logical database. `test:prepare` creates and seeds that database using a PostgreSQL role with database-creation privileges. With a pre-created test database, the same command seeds it. The frontend has its own `npm run build`.
