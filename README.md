# meditrack-backend
Are je code  mrena💨💨🐱‍🏍😭

## Backend handoff

Alan owns the Node.js and TypeScript backend implementation. Begin with the [authentication implementation log](docs/implementation-log.md) to align the database, Redis sessions, access rules and frontend integration.

| Folder | Intended work |
| --- | --- |
| `src/modules/auth/`, `access/` and `users/` under `src/modules/` | Authentication, permission checks and account management |
| `src/infrastructure/postgres/` and `src/infrastructure/redis/` | Database and session-store connections |
| `database/migrations/` and `database/seeds/` | Schema history and fictional test data |
| `src/modules/appointments/`, `schedules/`, `follow-ups/`, `reports/` under `src/modules/` | Clinic workflows |
| `tests/unit/` and `tests/integration/` | Rule checks and end-to-end API tests |

Empty `.gitkeep` files preserve the folders in Git. Implementation starts with Alan’s first change.
