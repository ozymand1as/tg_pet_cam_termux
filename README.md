# petcam

One-line install (Termux): `curl -fsSL https://raw.githubusercontent.com/ozymand1as/tg_pet_cam_termux/refs/heads/master/install.sh | bash`

Audited install: `curl -O install.sh; less install.sh; bash install.sh`

Requires: Termux + Termux:API (F-Droid), Android Camera permission, optional `ffmpeg`.

Commands: setup, photo, video, run, start/stop, config, doctor, forget, update, version.

Settings at `~/.petcam/settings.json` (mode 0600). Token redacted by default (`config show --reveal`).

Wake-lock policy: auto-on with `device.keepAwake`; released on SIGINT/SIGTERM.

Security: plaintext token stored locally; revoke via @BotFather `/revoke`; no telemetry; only `api.telegram.org` contacted.
