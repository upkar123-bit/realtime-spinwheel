# Spin Wheel Game - Fullstack Project

This repository contains a complete Spin Wheel game (backend + frontend), ready to run locally using Docker Compose or manually.

## Contents
- `backend/` — Node.js (Express) server with Socket.IO and PostgreSQL integration.
- `frontend/` — React + Vite single-page app (socket client).
- `migrations/` — SQL schema and seed data.
- `docker-compose.yml` — Runs `db` (Postgres) and `backend` + `frontend` containers.
- `README.md` — This file.

## Quick start (Docker Compose)
1. Install Docker & Docker Compose.
2. From project root:
   ```bash
   docker-compose up --build
   ```
3. Backend: http://localhost:4000
   Frontend: http://localhost:5173

## Quick start (local)
### DB
- Start Postgres (or use Docker).
- Create database `spinwheel` and run SQL in `migrations/001_schema.sql`.

### Backend
```bash
cd backend
npm install
# set environment variables in .env
node src/index.js
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Notes & Assumptions
- Admin is a simple flag in users table; no auth flows provided — use `is_admin` in DB seed.
- Real-time elimination uses server timers; if backend restarts, active wheel is aborted and users refunded.
- Coin operations are done in SQL transactions with `SELECT ... FOR UPDATE` to avoid races.
- This is a starting implementation focusing on correctness and safety; extend for production (migrations, tests, monitoring).

If you'd like, I can:
- Add automated tests.
- Add GitHub Actions for CI (lint, test).
- Push to your GitHub repository (I cannot push without your token).

Happy hacking!