# MediCore HR — Onboarding Platform

Full-stack HR platform: officer login → side-menu dashboard → officer-scoped employee
register → onboarding wizard in a modal → per-document verification that drives each
employee's onboarding status.

| Layer    | Stack                                                        |
| -------- | ------------------------------------------------------------ |
| Runtime  | Bun (workspaces monorepo)                                     |
| Frontend | SvelteKit (Svelte 5 runes) — `apps/web`, port **5173**        |
| API      | Hono on `Bun.serve` — `apps/api`, port **3000**               |
| Database | PostgreSQL, dedicated schema **`medicore_hr_db`** — Drizzle ORM |
| Auth     | Username/password (argon2id) + JWT in an **httpOnly cookie**, backed by a revocable server-side session |

## Tech stack (detail)

**Monorepo** — Bun workspaces (`apps/web`, `apps/api`), single `bun.lock`.

**Frontend** (`apps/web`)
- SvelteKit 2 + Svelte 5, built/served with Vite 7
- Tailwind CSS 4 (`@tailwindcss/vite`, utilities-only mode)
- TypeScript, `svelte-check` for type checking
- `@sveltejs/adapter-node` — builds to a standalone Bun/Node server (`build/index.js`)
- `@tabler/icons-webfont`, `@fontsource/open-sans` (self-hosted, no CDN)
- `kenat` — Ethiopian calendar support for date pickers

**Backend** (`apps/api`)
- Bun runtime running **Hono** as the web framework
- **Drizzle ORM** + `drizzle-kit` for schema/migrations, over the `postgres` driver
- **Zod** for request validation
- JWT access/refresh tokens in an httpOnly cookie, backed by a revocable `sessions` table
- Passwords hashed with Bun's built-in **argon2id**
- AES-256-GCM field-level encryption for PII columns

**Database** — PostgreSQL 16, dedicated schema `medicore_hr_db`

**Infra / Deployment**
- Docker Compose (`db`, `api`, `web` services), inline multi-stage `oven/bun:1-alpine` Dockerfiles
- API and web are separate origins (CORS + Bearer/cookie auth, no shared cookie across origins)
- Built for Coolify (Traefik-fronted) but runs behind any reverse proxy
- Per-service health checks, log rotation, and resource limits

## Team & branching

Three developers collaborate on this repo. Branch strategy:

| Branch | Purpose |
| ------ | ------- |
| `main` | Stable, always-deployable baseline |
| `dev`  | Active development — feature branches merge here first |
| `prod` | Mirrors what's actually deployed to production; only fast-forwarded from `main`/`dev` after testing |

Workflow: branch off `dev` for new work, open a PR back into `dev`, then promote `dev` → `main` → `prod` once verified.

## Setup

```sh
bun install

# Point apps/api/.env DATABASE_URL at your Postgres, then set the required
# secrets (see apps/api/.env.example for the full list):
#   JWT_SECRET       — ≥32 random characters
#   ENCRYPTION_KEY   — 64 hex chars (32 bytes): openssl rand -hex 32
bun run db:migrate      # applies apps/api/drizzle/*.sql (starts with CREATE SCHEMA medicore_hr_db)
cd apps/api && bun run db:seed   # creates the HR officer accounts below
```

Seeded accounts (change in `apps/api/src/db/seed.ts`):

| Username  | Password        | Role       |
| --------- | --------------- | ---------- |
| `abebe.g` | `Medicore@2026` | HR officer |
| `selam.t` | `Medicore@2026` | HR officer |
| `admin`   | `Admin@2026`    | Admin      |
| `viewer`  | `Viewer@2026`   | Viewer (read-only) |

## Run

```sh
bun run dev:api    # Hono API  → http://localhost:3000
bun run dev:web    # SvelteKit → http://localhost:5173 (proxies /api to :3000)
```

Run the API's test suite (pure-logic unit tests — encryption round-trip, masking,
rate limiter — no DB required):

```sh
cd apps/api && bun test
```

## Roles

| Role         | Sees                          | Can write? | Can reveal PII / export CSV? |
| ------------ | ----------------------------- | ---------- | ----------------------------- |
| `hr_officer` | Only employees they registered | Yes        | Yes                            |
| `admin`      | Every employee                 | Yes        | Yes — plus reassign ownership  |
| `viewer`     | Every employee                 | No (403)   | No (403)                       |

## Security model

- **Sessions, not bare JWTs.** Login creates a row in `sessions` and signs a JWT whose
  `sid` claim references it. The token lives in an **httpOnly, SameSite=Lax cookie** —
  client-side JS never sees it (verified: `document.cookie` never contains it, and
  nothing resembling a token is written to `localStorage`). Every request re-checks the
  session row, so **logout / forced sign-out revokes access immediately**, not just when
  the JWT would naturally expire.
- **Login brute-force lockout.** 5 wrong passwords locks the account for 15 minutes
  (`hr_officers.failed_login_attempts` / `locked_until`). Unknown-username logins pay
  the same argon2 cost as real ones so response timing can't be used to enumerate
  accounts.
- **Field-level encryption at rest.** National ID, bank account number, pension number,
  and TIN are stored as AES-256-GCM ciphertext (`apps/api/src/crypto-field.ts`), keyed by
  `ENCRYPTION_KEY`. A compromised database dump alone does not hand over this data.
- **Masked by default, revealed on demand.** `GET /api/employees/:id` returns those same
  four fields masked (e.g. `*********8827`). Only `POST /api/employees/:id/reveal`
  returns the full plaintext — and every call to it writes a `pii_revealed` audit log
  entry, so viewing raw PII always leaves a trail.
- **Audit log** (`audit_logs` table) — every login attempt (success/fail/locked),
  logout, employee create/update/delete/reassign, document status change/upload,
  PII reveal, and CSV export is recorded with the acting officer, entity, and IP.
- **Rate limiting** — the whole authenticated API is limited per-officer (180 req/min),
  and the public upload-link portal is limited per-IP (30 req/min) on top of its own
  per-link attempt lockout. Both are in-memory (`apps/api/src/rate-limit.ts`) — fine for
  a single instance, would need a shared store (Redis) if this ever scales horizontally.
- **RBAC** — mutating routes (`create/update/delete/reassign`, document status/upload,
  PII reveal, CSV export) require `requireRole('admin', 'hr_officer')`; `viewer` gets a
  clean 403. See `apps/api/src/rbac.ts`.

## How it works

- **Ownership**: every employee row stores `registered_by` → the officer who onboarded
  them. `hr_officer` only sees their **own** registrations; `admin` and `viewer` see the
  whole hospital (a read-only viewer scoped to "employees they registered" would see
  nothing, since a viewer never registers anyone).
- **Onboarding status** is computed from documents: an employee is `completed` only
  when every collected document is `verified`; otherwise `docs_pending`. Updating a
  document status on the employee page recomputes it automatically.
- **Start onboarding** (top-right) opens the wizard in a modal; submission is a single DB
  transaction across employees/credentials/contracts/documents/emergency_contacts.

## API

| Method | Path                                        | Auth        | Purpose                                     |
| ------ | ------------------------------------------- | ----------- | -------------------------------------------- |
| POST   | `/api/auth/login`                            | —           | Sets the session cookie; returns officer info |
| GET    | `/api/auth/me`                               | cookie      | Current officer claims                        |
| POST   | `/api/auth/logout`                           | cookie      | Revokes the session + clears the cookie       |
| GET    | `/api/employees`                             | cookie      | Scoped list + document progress               |
| GET    | `/api/employees/stats`                       | cookie      | Counts by onboarding status                   |
| GET    | `/api/employees/export.csv`                  | officer/admin | Server-side CSV export, audited              |
| GET    | `/api/employees/next-code`                   | cookie      | Next `HRM-YYYY-NNNN` code                     |
| GET    | `/api/employees/:id`                         | cookie      | Full record, PII masked                       |
| POST   | `/api/employees/:id/reveal`                  | officer/admin | Full unmasked PII — audited                  |
| POST   | `/api/employees`                             | officer/admin | Create onboarding record (transactional)     |
| PATCH  | `/api/employees/:id`                         | officer/admin | Update employee / contract fields            |
| DELETE | `/api/employees/:id`                         | officer/admin | Delete record + uploaded files                |
| POST   | `/api/employees/:id/reassign`                | admin only  | Transfer ownership to another officer         |
| PATCH  | `/api/employees/:id/documents/:docId`        | officer/admin | Update doc status → recompute onboarding     |
| POST   | `/api/employees/:id/documents/:docId/file`   | officer/admin | Upload document file (multipart `file`)      |
| GET    | `/api/employees/:id/documents/:docId/file`   | cookie      | Download the uploaded file                    |

## File bucket

Uploads are stored under **`apps/api/HR-EMP-FILE/`** (override with `FILE_BUCKET_DIR`),
one folder per employee named `<EmployeeCode>_<Name>`, e.g.
`HR-EMP-FILE/HRM-2026-0001_Helen_Worku/Police_clearance_certificate.pdf`.
Accepted types: PDF, JPEG, PNG, WebP — max 10 MB, and the actual file bytes are checked
against the declared type (not just the client's Content-Type header). Deleting an
employee removes their folder(s), matched by employee-code prefix so renames don't
strand files.

## Migrations

```sh
bun run db:generate   # regenerate SQL from apps/api/src/db/schema.ts
bun run db:migrate    # apply pending migrations
```

By default the server also auto-migrates + seeds on every boot (existing tables/rows are
skipped, so it's safe to restart repeatedly). Set `AUTO_MIGRATE=false` once you're
running against a shared or production database, so schema changes only happen via a
deliberate `bun run db:migrate`.

## Styling

- **Tailwind CSS v4** is integrated via `@tailwindcss/vite` in *utilities-only* mode
  (no preflight), so the hand-built design system in `src/app.css` is untouched.
  Brand tokens are mapped in `@theme` — `bg-navy`, `text-blue-dark`, `font-mono`
  etc. all match the MediCore palette.
- **Tabler icons** are self-hosted from `@tabler/icons-webfont` (imported in
  `+layout.svelte`) — no CDN, icons work offline.

## Localization

- `apps/web/src/lib/i18n/` — English/Amharic dictionaries (`t('key')`), toggled via the
  EN/አማ control in the sidebar and login page, persisted in `localStorage`.
- Date fields in the onboarding wizard use a custom Ethiopian-calendar picker
  (`EthiopianDatePicker.svelte`, built on the `kenat` package) — binds a Gregorian ISO
  string under the hood so the API/DB are unaffected, while every visible interaction
  happens in the Ethiopian calendar.

## Notes

- The pg schema is lowercase `medicore_hr_db` (Postgres folds unquoted identifiers to
  lowercase; a mixed-case name would need quoting in every raw query).
- The web app pins **Vite 7** — Vite 8's rolldown optimizer currently fails on this
  Windows + Bun workspace setup.
- The wizard's "Sample" menu loads mock candidates for demos; submissions are real DB rows.
- **Migrating pre-existing plaintext data**: rows created before field-level encryption
  existed still hold raw plaintext in what are now "encrypted" columns. The read path
  tolerates this automatically (`decryptFieldSafe` falls back to the raw value instead
  of throwing), so nothing breaks — but those specific rows aren't actually encrypted at
  rest until you run:
  ```sh
  cd apps/api && bun run db:backfill-encrypt
  ```
  Safe to run anytime, repeatedly — it detects and skips rows that are already
  encrypted, and only touches genuine legacy plaintext.
