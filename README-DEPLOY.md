# Deploying MediCore HR to a VPS

Everything needed to run the stack lives in `docker-compose.yml` — both app
Dockerfiles are inlined into that one file. You only need the repo
checkout, that file, and a `.env`.

No reverse proxy is bundled in this stack. `api` and `web` each `EXPOSE`
port 3000 and are meant to be fronted directly by whatever proxy already
runs on the host — on Coolify that's its built-in Traefik; on a bare VPS
you'd put your own (Caddy, nginx) or a load balancer in front, or publish
their ports directly for quick testing.

web and api are two separate origins. Login returns a short-lived Bearer
access token plus a longer-lived refresh token in the response body — no
cookie crosses the app/api boundary — so the browser calls the API
cross-origin via CORS. See `apps/api/src/auth.ts` and
`apps/web/src/lib/auth.svelte.ts` for the token flow.

## Prerequisites

- A VPS with Docker + the Compose plugin installed (`docker compose version`
  should work), **or** a Coolify instance pointed at this repo.
- Two domains (or two sslip.io/subdomains) — one for `web`, one for `api`.

### Deploying via Coolify (recommended)

Coolify runs this same `docker-compose.yml` but manages environment
variables through its own dashboard, not a committed `.env` file — a `.env`
in the repo is never read. Open the resource's **Environment Variables**
tab and add every variable from `.env.prod.example` there (generate
`JWT_SECRET`/`ENCRYPTION_KEY` with `openssl rand -hex 32`). Leaving
`POSTGRES_PASSWORD` unset makes the official Postgres image refuse to start
at all — its container shows as `Error` in the deploy log almost
immediately, rather than a slow healthcheck timeout, if this is missed.

Coolify auto-assigns a domain to **each** exposed service in the file —
`web` and `api` both get one (`db` has no exposed port, so it doesn't). This
is correct, not a misconfiguration: give each service its real domain (or
keep Coolify's generated ones) under the resource's **Domains** tab, then
set:

```
PUBLIC_APP_URL=<the web service's domain, full https:// URL>
PUBLIC_API_URL=<the api service's domain, full https:// URL>
```

Coolify's Traefik terminates TLS and issues Let's Encrypt certs for both
automatically — no ACME email or cert config needed in this repo.

### Deploying with plain `docker compose` instead

There's no bundled proxy, so uncomment the `ports:` lines under `api` and
`web` in `docker-compose.yml` (`3000:3000` and `5173:3000` by default) and
put your own reverse proxy — or a DNS A record straight at the host, for
quick testing — in front of each. Set `PUBLIC_APP_URL`/`PUBLIC_API_URL` in
`.env` to wherever each one ends up being reachable.

## First deploy

```bash
git clone <your-repo-url> medicore-hr
cd medicore-hr

cp .env.prod.example .env
# edit .env: PUBLIC_APP_URL, PUBLIC_API_URL, POSTGRES_PASSWORD, JWT_SECRET, ENCRYPTION_KEY
# generate the two secrets with: openssl rand -hex 32

docker compose up -d --build
docker compose ps        # all 3 services healthy?
docker compose logs -f api web
```

On this first boot the API auto-creates the schema and seeds the officer
accounts (`AUTO_MIGRATE=true` in `.env.prod.example`'s default). Once you've
confirmed the app is up, log in, and change the seeded passwords:

```bash
# then flip AUTO_MIGRATE to false in .env and:
docker compose up -d api
```

Visit `PUBLIC_APP_URL` — it calls `PUBLIC_API_URL` under the hood for every
API request.

## Subsequent deploys (code changes)

```bash
git pull
docker compose up -d --build
```

Existing containers for unchanged services are left alone; only images that
actually changed get rebuilt and restarted. Migrations for schema changes
still run automatically on `api` boot as long as `AUTO_MIGRATE=true` — set
it back to `true` in `.env` before a deploy that includes a schema change,
then back to `false` afterwards, or just leave it `true` permanently (the
migrations are hand-written to be safe to re-run against an already-migrated
database).

## Backups

Postgres is intentionally not exposed to the host or the internet — reach it
through the running container:

```bash
docker compose exec db \
  pg_dump -U medicore medicore_hr > backup-$(date +%F).sql
```

Uploaded employee documents live in the `uploads` named volume
(`FILE_BUCKET_DIR=/app/data/uploads` inside the `api` container). Back it up
with:

```bash
docker run --rm -v medicore-hr_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

## What's running

| Service | Image built from                          | Reachable from                    |
|---------|--------------------------------------------|-------------------------------------|
| `web`   | inlined Dockerfile, `oven/bun:1-alpine`     | the platform proxy (Coolify/yours)  |
| `api`   | inlined Dockerfile, `oven/bun:1-alpine`     | the platform proxy, and `web` via CORS |
| `db`    | `postgres:16-alpine`                        | `api` only                          |

`web` and `api` are separate origins reached directly by whatever fronts
this stack — there's no internal routing between them. The browser talks to
both: pages from `PUBLIC_APP_URL`, API calls (with a `Bearer` header) to
`PUBLIC_API_URL`. `CORS_ORIGIN` (set to `PUBLIC_APP_URL` on the `api`
service) is what actually gates which origin may call the API from a
browser — it matters in every deploy, not just an edge case.

## Resource sizing

Each service has a conservative `deploy.resources.limits` in the compose
file (api/web/db: 512MB & 1 CPU each) — sized for a small 2–4GB VPS. Raise
them if you have more headroom, or if Postgres starts getting OOM-killed
under real load (`docker compose logs db`).

Every service also caps its own logs at 10MB × 3 rotated files (the
`x-logging` anchor at the top of the compose file), so a long-running
deployment's container logs can't quietly fill the VPS's disk over time.

## Troubleshooting

- **A service won't go healthy**: `docker compose logs <service>`.
  `api` will crash-loop if `ENCRYPTION_KEY` isn't exactly 64
  hex characters, or if `db` isn't reachable yet (it waits on `db`'s
  healthcheck, so this usually means Postgres itself is failing to start —
  check `POSTGRES_PASSWORD`/`POSTGRES_DB` match between first boot and now).
- **Certificate not issuing (Coolify)**: confirm each domain's DNS actually
  resolves to this VPS and that ports 80/443 are reachable from the
  internet — check the Domains tab on the specific service (`web` or
  `api`), not the resource as a whole.
- **Login fails with a CORS error in the browser console**: `CORS_ORIGIN`
  on the `api` service must exactly match `PUBLIC_APP_URL` (scheme
  included) — a mismatch here is the #1 cause of "network error" on login
  in a fresh two-domain deploy.
- **Login succeeds but every subsequent request 401s**: check
  `PUBLIC_API_URL` on the `web` service points at the API's real reachable
  domain — `apps/web/src/lib/apiBase.ts` uses it to build every request URL,
  so a stale/wrong value sends requests nowhere useful.
