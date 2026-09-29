# Petcam Local Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local HTML/CSS/JS config page + media serving served by Node `http` inside Termux; update spec v2.1.

**Architecture:** `src/web.js` (Node server, 127.0.0.1), `public/` (vanilla JS), CLI `petcam web`; media endpoint `/media`; settings endpoint `/api/settings`.

**Tech Stack:** Node built-in `http`, vanilla HTML/JS/CSS, existing `settings.js` contract.

**Spec:** `docs/superpowers/specs/2026-09-29-petcam-web-ui-design.md`

## Global Constraints
- Bind `127.0.0.1` only (no `0.0.0.0`).
- Default port `8765`; configurable via `settings.webPort`.
- Bot token hidden by default; show only with `?reveal=1`.
- No external CDN; no framework.
- Spec v2.1 §1.2 updated; `README.md` and `TODO.md` updated.

---

### Task 1: Server module `src/web.js`
**Files:** Create `src/web.js`
**Produces:** `createServer()`, `start(port)`, `stop()`, endpoints `/`, `/api/settings`, `/media`
- [ ] Write module with `http.createServer`; serve `public/` static; handle `GET /api/settings` (redact token); `POST /api/settings` (parse JSON, write via existing settings logic); `GET /media` (list dirs from `~/.petcam/photos/` and `videos/`).
- [ ] Bind to `127.0.0.1`; reject non-localhost `Host` header (defense in depth).
- [ ] Test: `node -e "const w=require('./src/web.js'); w.start(8765);"` then `curl -s http://127.0.0.1:8765/ | head`. Expected: HTML page.
- [ ] Commit.

### Task 2: Static assets `public/`
**Files:** Create `public/index.html`, `public/style.css`, `public/app.js`
**Produces:** Config form + media list UI
- [ ] Write `index.html`: form fields (botToken, chatId, interval, webPort), "Reveal token" checkbox, gallery `<ul>`; link `style.css`, `app.js`.
- [ ] Write `style.css`: responsive dark/light via `prefers-color-scheme`; minimal layout.
- [ ] Write `app.js`: fetch `/api/settings`, render form, POST updates, fetch `/media`, render list; handle reveal toggle.
- [ ] Test: open `public/index.html` directly (file://) — form loads; then via server — fetch works.
- [ ] Commit.

### Task 3: CLI integration `cli.js` + `settings.js`
**Files:** Modify `src/cli.js`, `src/settings.js`; modify `spec.md`, `README.md`, `TODO.md`
**Produces:** `petcam web` subcommand
- [ ] Add `webPort: 8765` default to settings schema (`settings.js`).
- [ ] Add `web` command to CLI (`cli.js`): parse `--port`, `--daemon`; call `src/web.js`; write PID to `~/.petcam/web.pid`; if `--daemon`, background.
- [ ] Update `spec.md` §1.2 (non-goals) and add web command section.
- [ ] Update `README.md`: new command, localhost-only warning.
- [ ] Update `TODO.md`: add T16 web.
- [ ] Test: `node src/cli.js web` starts server; `curl localhost:8765/api/settings` returns JSON with redacted token.
- [ ] Commit.

### Task 4: Security / verification
**Files:** `src/web.js` (verify bind), `public/app.js` (verify reveal)
**Produces:** Verified localhost-only + token hidden
- [ ] Confirm `netstat -tlnp | grep 8765` shows `127.0.0.1` only.
- [ ] Confirm `curl` from `127.0.0.1` works; external access blocked.
- [ ] Confirm page default hides token; reveal checkbox exposes.
- [ ] Commit.

## Execution Choice
Plan complete and saved to `docs/superpowers/plans/2026-09-29-petcam-web-ui.md`. Two execution options:

1. Subagent-Driven (recommended) — dispatch fresh subagent per task, review between tasks, fast iteration
2. Inline Execution — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
