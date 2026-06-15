# SayScore — Deployment

This folder holds the Docker stacks.

| File | Stack | Frontend | Command |
|---|---|---|---|
| [`docker-compose.yml`](docker-compose.yml) | **Local / dev** | nginx, plain HTTP `:8080` | `make up` |
| [`docker-compose.prod.yml`](docker-compose.prod.yml) | **Production** | Caddy, automatic HTTPS | `make up-prod` |

The two are independent (different compose files and project names — `sayscore`
vs `sayscore-prod`); they can even run side by side. This README covers
**production**. For local dev see the root [`README.md`](../README.md).

---

## What the production stack runs

`deploy/docker-compose.prod.yml` (project `sayscore-prod`) brings up, in order:

**MySQL → migrate (one-shot) → seed (one-shot) → backend → Caddy**

- **Caddy** terminates TLS for your domain (auto Let's Encrypt), serves the
  built SPA, reverse-proxies `/api` to the backend (same-origin, so the session
  cookie works without CORS), and serves an internal `robots.txt` (`Disallow: /`).
  Config: [`../frontend/Caddyfile`](../frontend/Caddyfile); image built from
  [`../frontend/Dockerfile.prod`](../frontend/Dockerfile.prod).
- **backend** runs with `APP_ENV=production`, which enables Secure cookies and
  **disables the debug job-run route** (`POST /api/admin/jobs/run`) — so the
  Admin "Background jobs (debug)" panel does **not** appear in prod; the
  results-ingest and weekly-winner jobs run on their cron schedule instead.
- **MySQL and the backend are NOT published to the host** — only Caddy is, on
  ports 80 and 443. MySQL data and the TLS certs live in named volumes
  (`mysql_data`, `caddy_data`) so they survive restarts.

---

## Prerequisites

- A Linux host with **Docker + Docker Compose v2**.
- A **domain** whose DNS A/AAAA record points at the host, with **ports 80 and
  443 reachable** from the internet (Caddy needs both for the ACME challenge and
  HTTPS).
- The production origin (`https://<your-domain>`) added as an **Authorized
  JavaScript origin** on the Google OAuth client (the client id is baked into
  the frontend bundle at build time).

---

## Configure — a single `.env.prod`

Production is driven by **one file**, `.env.prod` at the **repo root** (not in
this folder). You do **not** need `backend/.env` or `frontend/.env` in prod —
compose injects everything from `.env.prod`.

```bash
cp .env.prod.example .env.prod
# then edit .env.prod
```

| Var | Required | Notes |
|---|---|---|
| `SITE_ADDRESS` | ✅ | Public hostname, e.g. `sayscore.example.com`. Caddy gets the cert for it. Use `:80` for a local no-TLS smoke. |
| `DB_PASSWORD` | ✅ | App DB user password. |
| `DB_ROOT_PASSWORD` | ✅ | MySQL root password. |
| `SESSION_SECRET` | ✅ | Cookie signing key — `openssl rand -base64 48`. |
| `GOOGLE_CLIENT_ID` | ✅ | SSO client id (also baked into the frontend build). |
| `DB_NAME`, `DB_USER` | – | Default `wcp`. |
| `ALLOWED_EMAIL_DOMAIN` | – | Default `sayonetech.com`. |
| `SEED_ADMIN_EMAILS` | – | Comma-separated; these become admins on first login. |
| `FOOTBALL_DATA_API_KEY` | – | Empty disables the results-ingest scheduler. |
| `RESULTS_CRON_ENABLED` | – | Default `true` in prod. |
| `SLACK_WEBHOOK_URL` | – | Optional cron-completion notifications. |

`.env.prod` is gitignored (`*.env`) — **never commit it**.

---

## Deploy

```bash
make up-prod        # build images + start detached (or: docker compose \
                    #   --env-file .env.prod -p sayscore-prod \
                    #   -f deploy/docker-compose.prod.yml up -d --build)
```

First boot, Caddy obtains the certificate (a few seconds once DNS + ports are
right). Then open `https://<your-domain>` and sign in with a
`@ALLOWED_EMAIL_DOMAIN` Google account.

| Command | What |
|---|---|
| `make logs-prod` | tail logs (watch Caddy's cert provisioning here) |
| `make ps-prod` | container status |
| `make down-prod` | stop + remove containers (keeps `mysql_data` + `caddy_data`) |

---

## Operations

**Redeploy a new version** — pull the new code, then:

```bash
make up-prod        # rebuilds changed images and recreates containers
```

Migrations and the (idempotent) seed run automatically on every boot; the seed
uses `INSERT IGNORE`, so it never clobbers admin-corrected rows.

**Background jobs** — results-ingest and weekly-winner run on their cron
schedule (IST). The manual trigger UI is dev-only and absent in prod. To force a
recompute in prod, use the admin **Settings → Recompute** action (a standard
admin route, available in all environments). Set `SLACK_WEBHOOK_URL` to get a
ping each time a job runs, so you can confirm the cron is alive.

**Back up the database** — the data is in the `mysql_data` volume:

```bash
docker compose -p sayscore-prod -f deploy/docker-compose.prod.yml \
  exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql \
  mysqldump -u"$DB_USER" --single-transaction "$DB_NAME" > backup.sql
```

**Rotate secrets** — change the value in `.env.prod` and `make up-prod`
(rotating `SESSION_SECRET` invalidates existing sessions → users re-login).

---

## Troubleshooting

- **No certificate / TLS errors** — confirm DNS points at the host and ports 80
  **and** 443 are open; check `make logs-prod` for the ACME challenge. For a
  quick HTTP-only check set `SITE_ADDRESS=:80`.
- **`make up-prod` says "missing .env.prod"** — you haven't created it yet
  (`cp .env.prod.example .env.prod`).
- **Port 80/443 already in use** — another web server (or the local stack on a
  shared host) is bound; stop it first.
- **Google sign-in fails** — the prod origin isn't an Authorized JavaScript
  origin on the OAuth client, or `GOOGLE_CLIENT_ID` differs from the one the
  bundle was built with (rebuild after changing it: `make up-prod`).
