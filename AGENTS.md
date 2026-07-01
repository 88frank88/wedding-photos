# AGENTS.md

Wedding photo upload web app for a single event (Irina & Alexander, 26. Juni 2026).
German-language UI — preserve German strings when editing user-facing text.

## Toolchain reality

- **No build step.** Frontend is plain HTML/CSS/JS (`frontend/index.html`), no bundler/transpiler.
- **No tests, lint, formatter, or typecheck are configured.** `backend/package.json` only defines `start`.
  Verification is manual: start the server and hit `/api/health`, `/api/photos`, `/admin`.
- **No lockfile is committed.** Dependencies install via `npm install` (production uses `--production`).

## Running locally

```bash
# .env MUST live at the repo ROOT (not backend/). server.js loads ../.env.
cp .env.example .env   # then set ADMIN_PASSWORD
cd backend && npm install
npm start              # node server.js, listens on 127.0.0.1:3000
```

## Two non-obvious sources of truth

- **App version lives in `./VERSION`** (e.g. `2.0.4`). `backend/package.json` version is stale (`1.0.0`) — do not rely on it; bump `VERSION` for releases.
- **Upload categories are hardcoded in two places that must stay in sync:**
  - `backend/server.js` → `CATEGORIES` object (`standesamt`, `kirche`, `feier`)
  - `frontend/index.html` → `CATS` array + the `.category-btn` buttons / gallery sections
  Changing one without the other breaks upload or display.

## Architecture

- **Single entrypoint:** `backend/server.js` (Express). Auto-enables cluster mode on multi-core hosts via `cluster` (`isMaster`); each worker is a full server instance.
- **Storage is the filesystem.** Files land in `$UPLOAD_DIR` (`backend/uploads/` by default), one subdir per category. Chunked uploads buffer under `uploads/.chunks/` then are assembled by `/api/upload-finalize`. Both `uploads/` and `.chunks/` are gitignored runtime data.
- **Admin auth is a single shared password** (`ADMIN_PASSWORD`, Basic Auth, username ignored). No user DB.
- Backend binds to `127.0.0.1` only — direct external access requires nginx (or changing `HOST`).

## Production deployment (how it actually runs)

`install.sh` (run as root, interactive) clones the repo to **`/opt/wedding-photos`** and wires:
- **systemd** `wedding-photos.service` → runs `node server.js` as **`www-data`**, `WorkingDirectory=/opt/wedding-photos/backend`, `EnvironmentFile=/opt/wedding-photos/.env`.
- **nginx** `nginx/wedding-photos.conf` (port 80) serves `/uploads/`, `/fonts/`, and `/` (frontend) as static files; only `/api/` and `/admin` proxy to `127.0.0.1:3000`.
  - Keep nginx `client_max_body_size` (110M) above `MAX_FILE_SIZE_MB`, or large uploads fail at the proxy.
  - Editing frontend static assets does **not** require a Node restart.

Operate via: `systemctl {status,restart} wedding-photos`, `journalctl -u wedding-photos -f`.

## Env vars (`.env`, repo root)

`PORT`, `HOST`, `UPLOAD_DIR`, `MAX_FILE_SIZE_MB`, `MAX_FILES_PER_UPLOAD`, `ADMIN_PASSWORD`, `COUPLE_NAME`, `WEDDING_DATE`, `CORS_ORIGINS` (comma-separated; empty = no CORS middleware). See `.env.example`.
