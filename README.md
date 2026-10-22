# AAPNA ATS

The applicant tracking system of AAPNA Infotech's recruitment team: MRF approval, resume intake and AI parsing, candidate screening, the interview pipeline (Zeko, Evalground, Teams interviews, scorecards), documents, offers and analytics.

- **Backend:** Node.js, Express, Prisma, PostgreSQL + pgvector, Redis / BullMQ, Socket.io (`backend/`)
- **Frontend:** React 18, Vite, Ant Design 5 (`frontend/`)

## Start here
| You are… | Read |
|---|---|
| A developer new to the project | [docs/system/](docs/system/README.md): overview, modules, data model, jobs, configuration, runbook, history, [onboarding](docs/system/08-ONBOARDING.md) |
| On call / something is broken | [docs/system/06-OPERATIONS-RUNBOOK.md](docs/system/06-OPERATIONS-RUNBOOK.md) |
| HR, an Admin, a Super Admin or a vendor | [docs/user-guides/](docs/user-guides/README.md) |

## Run it locally (short version)
```
redis\redis-server.exe
cd backend  && npm install && npx prisma generate && npm run dev     # uses the STAGING database
cd frontend && npm install && npm run dev                             # http://localhost:5173
```
Env files are not in git; ask a developer. Read [onboarding](docs/system/08-ONBOARDING.md) §2 before starting a local backend: it runs the scheduled jobs against the staging database.
