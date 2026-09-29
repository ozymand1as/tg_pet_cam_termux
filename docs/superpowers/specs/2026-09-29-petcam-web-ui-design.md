---
name: petcam-local-web-ui
description: Design doc for local HTML/CSS/JS config + media serving page in Termux (spec v2.1 update)
type: project
---

# Petcam Local Web UI — Design (2026-09-29)

**Status:** Approved by user. Scope: config + media serving; spec v2.1 updated; Node built-in server; localhost-only.

## Context / Conflict with v2.1
- Spec §1.2 (non-goals) excluded: "PWA, service worker, localStorage, getUserMedia, MediaRecorder, screen Wake Lock API, browser CORS concerns, no page, no origin."
- User explicitly wants local page for config and media gallery; overrides non-goals for this subsystem.
- Must keep CLI (`petcam setup`, `petcam config`) intact; page is parallel.

## Architecture
- `src/web.js`: Node `http.createServer`; binds `127.0.0.1` (configurable via `settings.webPort`, default 8765); serves static + JSON endpoints.
- `public/index.html`: single-page config form + media gallery list (no framework; vanilla JS).
- `public/style.css`: minimal responsive layout; dark/light only via CSS media; no external CDN.
- `public/app.js`: fetches `/api/settings`, POST updates; fetches `/media` for gallery; handles `reveal` toggle for bot token.

## Endpoints
- `GET /` → `public/index.html`
- `GET /style.css`, `GET /app.js` → static
- `GET /api/settings` → returns settings (redacts token unless `?reveal=1` or `?show=1`)
- `POST /api/settings` → writes `~/.petcam/settings.json` (same `settings.js` contract); validates required fields; requires `Content-Type: application/json`; only accepts localhost (enforced by server bind)
- `GET /media` → lists files in `~/.petcam/photos/` and `videos/` (names, sizes, timestamps); returns JSON array; no binary streaming (keep it simple)
- `GET /media/<filename>` → serve file (optional; if omitted, user opens folder via Termux file manager)

## Security
- Bind `127.0.0.1` only; no `0.0.0.0`. Document in `README.md`.
- Bot token visible in DOM/JS only if user toggles "Reveal token" (mirrors `config show --reveal`). Default hidden.
- No authentication / PIN (per user choice); rely on localhost physical access.
- No telemetry; only `api.telegram.org` via bot (existing contract).

## CLI Integration
- `petcam web [--port N] [--daemon]` — starts server; writes PID to `~/.petcam/web.pid`; if `--daemon`, backgrounds (reuse `scheduler.js` / daemon logic).
- `petcam web --stop` — kills PID.
- `petcam config show --reveal` stays; page just visualizes same data.

## Files Added / Modified
- New: `src/web.js`, `public/index.html`, `public/style.css`, `public/app.js`
- Modify: `src/cli.js` (add `web` command), `src/settings.js` (add `webPort` default), `spec.md` (§1.2 non-goals update + new §5/§11 web section), `README.md` (new command, localhost warning), `TODO.md` (add T16 web)

## Spec Changes (v2.1 → v2.2 or section update)
- §1.2: replace "no page" with note: local config page permitted, localhost-only, no external origin.
- §5 (commands): add `web` subcommand.
- §11/12: add web-server ticket.

## Implementation Path (after approval)
1. Write `docs/superpowers/specs/YYYY-MM-DD-petcam-web-ui-design.md` (done).
2. Write plan via `writing-plans` skill.
3. Implement `src/web.js` + `public/` + CLI updates + spec edit.
4. Verify with `node src/web.js` + `curl localhost:8765/api/settings`.
