# Pet Cam → Telegram — Termux CLI Implementation Spec

**Version:** 2.1
**Target:** Node.js CLI application running inside Termux on Android. No npm dependencies, no build step. Uses the `termux-api` package for camera capture and wake-lock control. Installs with a single `curl … | bash` command.
**Audience:** Implementation agents. Every interface in this document is a **frozen contract** — do not rename commands, flags, function names, file paths, or environment variables without updating this spec.

**Changelog v1.1 → v2.0:**
- Rewrote as a Termux CLI app (Node.js, ESM, no npm dependencies).
- Removed: PWA, service worker, `manifest.webmanifest`, `offline.html`, `beforeinstallprompt`, `localStorage`, `getUserMedia`, `MediaRecorder`, screen Wake Lock API, GitHub Pages, browser CORS concerns.
- Added: step-by-step interactive configuration wizard, subcommand CLI, `termux-camera-photo` capture, `termux-wake-lock`, `termux-notification`, settings file on disk, `ffmpeg`-optional post-processing, background daemon mode.

**Changelog v2.0 → v2.1:**
- Added one-line installation (`curl … | bash`), the `install.sh` / `uninstall.sh` contracts, the Termux-aware bootstrapper, non-interactive install mode, install-time environment variables, the wrapper-binary strategy that sidesteps Termux's shebang quirks, and the associated QA scenarios and tickets.

---

## 1. Overview

A single-binary Node.js CLI app that runs inside Termux on Android and:

1. Runs entirely on-device — no server, no bundler, no npm dependencies (`pkg install nodejs termux-api` is enough; `ffmpeg` is optional).
2. Talks directly to `https://api.telegram.org` using a user-supplied bot token.
3. Is configured **step by step** by an interactive wizard (`petcam setup`), with every value also editable via `petcam config set`.
4. Captures still photos with **`termux-camera-photo`**.
5. Captures video by launching the system camera app via an Android intent (default) or by burst-encoding stills through `ffmpeg` (fallback).
6. Sends photos on a repeating timer with a visible countdown, and sends video on demand.
7. Persists all settings to a JSON file on disk.
8. Uses `termux-wake-lock` so the process keeps running while Termux is backgrounded.
9. Installs with a single `curl … | bash` command and uninstalls symmetrically.

### 1.1 Goals

| # | Goal |
|---|------|
| G1 | Zero-install beyond `pkg install nodejs termux-api`: run `petcam setup`, answer prompts, done. |
| G2 | Reliable repeating photo upload with a visible countdown on stdout. |
| G3 | On-demand video clip (1–60 s) sent to the same chat, with a document fallback. |
| G4 | Clear, non-technical error messages for every failure mode. |
| G5 | All settings persist in `~/.petcam/settings.json` across runs. |
| G6 | Runs in the foreground **or** as a background daemon with a PID file. |
| G7 | Keep the CPU awake while auto-upload is active, via `termux-wake-lock`. |
| G8 | Works fully offline-from-the-browser-world — no page, no origin, no CORS. |
| G9 | Installs in one line: `curl -fsSL <install-url> \| bash`. |

### 1.2 Non-goals (v2)

- No GUI, no TUI dashboards, no live video preview in the terminal.
- No multi-bot or multi-chat management.
- No motion detection / AI.
- No receiving messages from Telegram (send-only, plus `getMe`/`getUpdates` for setup).
- No offline upload queue — a failed upload is logged and skipped.
- No Windows/macOS/Linux-desktop support. Termux is assumed.
- No package-manager publishing (no npm registry, no F-Droid submission).

### 1.3 Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Termux:API app not installed → every `termux-camera-photo` call fails. | `petcam doctor` subcommand probes each required binary and reports exactly what to install; `install.sh` bootstraps the packages. |
| `termux-camera-photo` has no quality/size flags. | Optional `ffmpeg` post-processing step resizes + re-encodes; if `ffmpeg` is missing, upload the raw JPEG and log a warning. |
| Android kills background processes. | `termux-wake-lock` while running; README instructs the user to disable battery optimization for Termux and Termux:API. |
| Bot token is stored in plaintext on disk. | File mode `0600`; explicit warning on first save; `petcam forget` wipes it; README documents revocation via `/revoke`. |
| Video intent `EXTRA_OUTPUT` unsupported by some OEM camera apps. | Fall back to the burst+`ffmpeg` path; if `ffmpeg` is absent, log a clear error and skip. |
| Shared storage not set up (`~/storage/shared` missing). | `petcam setup` runs `termux-setup-storage` automatically and waits for the directory to exist. |
| Telegram 400 on `sendVideo` for Android-produced MP4s. | Automatic retry as `sendDocument` on any 400. |
| `getUpdates` returns 409 because a webhook is set. | Map to a clear message pointing at `/deletewebhook`. |
| Settings schema drift. | `deepMerge` drops unknown keys; `version` field is checked and migrations are explicit. |
| `curl … \| bash` consumes stdin so prompts fail. | The installer reattaches `stdin` to `/dev/tty` before the first prompt, and degrades to fully non-interactive when no TTY exists. |
| Termux lacks `/usr/bin/env`, so `#!/usr/bin/env node` shebangs fail. | `install.sh` writes a shell wrapper at `$PREFIX/bin/petcam` that `exec`s `node <install-dir>/bin/petcam.js "$@"`. |
| A `curl \| bash` install on a non-Termux box silently mangles the environment. | The installer exits 3 with an explicit message unless `PETCAM_FORCE=1`. |
| Re-running the installer wipes user settings. | The installer only ever writes under `$PETCAM_DIR` and `$PREFIX/bin`; `~/.petcam` is never touched. |

### 1.4 Platform limitations (state these in `petcam --help` and README)

- The app runs **only while the Termux process is alive**. With `termux-wake-lock` and battery optimization disabled, it survives Termux being backgrounded; it does **not** survive a reboot unless the user adds a `~/.termux/boot/` script.
- Android may still freeze the process on aggressive OEM ROMs. Document this; do not promise 24/7.
- `termux-camera-photo` triggers the camera through the Termux:API app — it is a one-shot capture, not a stream. There is no live preview.
- Video recording launches the **system camera app** via an intent. The user must record and confirm inside that app; Termux then reads the resulting file. This is inherently interactive.
- The device must be plugged in for long runs; the wake lock keeps the CPU alive but does **not** keep the screen on.

---

## 2. Tech constraints

- **Runtime:** Node.js 18+ (`pkg install nodejs`). ESM (`"type": "module"` in `package.json`). Global `fetch`, `FormData`, `Blob` are assumed (Node 18+).
- **Dependencies:** none. `ffmpeg` and `termux-api` are **optional external binaries**, detected at runtime; the app degrades gracefully without them.
- **Language:** ES2022. `node:fs/promises`, `node:readline/promises`, `node:child_process`, `node:path`, `node:os`, `node:process`.
- **No build step.** `bin/petcam.js` is a shebang script.
- **Output:** ANSI-colored stdout when `process.stdout.isTTY`; plain text otherwise. All user-facing text on **stderr** for errors, stdout for results.
- **Serving:** none. The CLI runs locally.
- **Platform:** Termux on Android. No Windows/macOS support.
- **Installer shell:** Bash 4+ (`#!/data/data/com.termux/files/usr/bin/bash`) with `set -euo pipefail`. Only `curl` and `tar` are required in addition to `nodejs`, `termux-api`, and optionally `git` and `ffmpeg`. No `sudo`, `npm`, `npx`, `wget`, or `jq`.

---

## 3. File layout

```
pet-cam-cli/
├── install.sh                # one-line installer; fetched via curl | bash
├── uninstall.sh              # symmetric removal; fetched via curl | bash
├── package.json              # { "name", "type": "module", "version", "bin": { "petcam": "./bin/petcam.js" } }
├── README.md
├── bin/
│   └── petcam.js             # entry, shebang #!/usr/bin/env node
├── src/
│   ├── config.js             # constants + helpers (no I/O)
│   ├── settings.js           # load/save/merge/validate
│   ├── telegram.js           # API client + TelegramError + withRetry
│   ├── camera.js             # termux-camera-photo / ffmpeg wrappers
│   ├── video.js              # intent-based + burst-based recording
│   ├── termux.js             # thin wrappers around termux-api binaries
│   ├── scheduler.js          # wall-clock tick scheduler
│   ├── wakelock.js           # termux-wake-lock / -unlock lifecycle
│   ├── cli.js                # prompts, colors, spinners, tables
│   └── app.js                # subcommand dispatch + orchestration
└── test/
    └── manual.md             # manual QA checklist (no unit test framework)
```

**Dependency direction (never violate):**

```
config.js   ←  every other module
settings.js ←  app.js
telegram.js ←  app.js
camera.js   ←  app.js
video.js    ←  app.js
termux.js   ←  camera.js, video.js, wakelock.js
scheduler.js←  app.js
wakelock.js ←  app.js
cli.js      ←  app.js            (cli.js MUST NOT import app.js)
app.js      ←  bin/petcam.js
```

`telegram.js`, `camera.js`, `video.js`, `termux.js`, `settings.js`, `scheduler.js`, `wakelock.js` **MUST NOT** import `cli.js` or `app.js`. They take plain data in and return plain data out.

**Path discipline:**

- All internal imports use explicit relative paths ending in `.js` (`'./settings.js'`, `'../src/telegram.js'`).
- No absolute paths in source files.
- Settings file path resolved via `path.join(os.homedir(), '.petcam', 'settings.json')`, overridable with the `PETCAM_HOME` env var.
- `install.sh` and `uninstall.sh` may reference only relative paths within the repo and the remote URLs enumerated in §11.3. They must never `curl | bash` a second script.

---

## 4. Data model

### 4.1 Settings object

Single file: **`~/.petcam/settings.json`**, mode `0600`. Constant `SETTINGS_PATH` derived from `PETCAM_HOME` if set, else `path.join(os.homedir(), '.petcam')`.

```jsonc
{
  "version": 2,
  "telegram": {
    "token": "",                                  // string, may be ""
    "chatId": "",                                 // string, may be ""
    "captionTemplate": "Pet cam 🐾 {datetime}"    // string, max 1024 chars after render
  },
  "camera": {
    "cameraId": "0",            // string, "" = let termux-camera-photo decide
    "facing": "back",           // "back" | "front" | "external" | "" (unknown)
    "maxWidth": 1280,           // 0 = no resize; resizing requires ffmpeg
    "jpegQuality": 0.85         // 0.3..1.0; used only if ffmpeg is available
  },
  "autoUpload": {
    "enabled": false,
    "intervalSec": 60,          // 15..86400
    "pauseWhenHidden": false    // true = pause while Termux is not in the foreground
  },
  "video": {
    "mode": "intent",           // "intent" | "burst"
    "durationSec": 10,          // 1..60 (burst mode only; intent mode ignores it)
    "includeAudio": false,      // intent mode only
    "burstFps": 4               // 1..10 (burst mode only)
  },
  "device": {
    "keepAwake": true           // request termux-wake-lock while running
  }
}
```

### 4.2 Constants (`src/config.js`)

```js
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'petcam';
export const APP_VERSION = '2.1.0';   // must equal package.json "version"
export const SETTINGS_DIR  = process.env.PETCAM_HOME || path.join(os.homedir(), '.petcam');
export const SETTINGS_PATH = path.join(SETTINGS_DIR, 'settings.json');
export const PID_PATH      = path.join(SETTINGS_DIR, 'petcam.pid');
export const LOG_PATH      = path.join(SETTINGS_DIR, 'petcam.log');
export const CACHE_DIR     = path.join(SETTINGS_DIR, 'cache');

export const API_BASE = 'https://api.telegram.org';

export const REPO_URL       = process.env.PETCAM_REPO   || 'https://github.com/<user>/pet-cam-cli';
export const DEFAULT_BRANCH = process.env.PETCAM_BRANCH || 'main';
export const INSTALL_DIR    = process.env.PETCAM_DIR    || path.join(os.homedir(), '.local', 'share', 'petcam');
export const WRAPPER_PATH   = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'bin', 'petcam');

export const LIMITS = {
  MIN_INTERVAL_SEC: 15,
  MAX_INTERVAL_SEC: 86400,
  RECOMMENDED_MIN_INTERVAL_SEC: 60,
  MIN_RECORD_SEC: 1,
  MAX_RECORD_SEC: 60,
  MAX_CAPTION_LEN: 1024,
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
  CAPTURE_TIMEOUT_MS: 20000,     // termux-camera-photo is slower than getUserMedia
  VIDEO_INTENT_TIMEOUT_MS: 5 * 60 * 1000,
  BURST_MIN_FPS: 1,
  BURST_MAX_FPS: 10
};

export const DEFAULT_SETTINGS = Object.freeze({ /* exactly the object in §4.1 */ });

export function deepMerge(base, override) { /* recursive, arrays replaced, unknown keys dropped */ }
export function clamp(n, min, max) { /* returns number, NaN -> min */ }
export function formatDateTime(d = new Date()) { /* "YYYY-MM-DD HH:mm:ss" local */ }
export function expandHome(p) { /* '~/x' -> '/data/data/com.termux/files/home/x' */ }
```

`deepMerge` **must** ignore keys in `override` that do not exist in `base`. It must not throw on malformed input; fall back to a deep clone of `base`. `clamp` returns `min` if the input is `NaN`.

`APP_VERSION` is the single source of truth for the app version and must match `package.json`'s `"version"`.

---

## 5. Module contracts

### 5.1 `src/settings.js`

```js
export async function loadSettings(): Promise<Settings>
export async function saveSettings(settings: Settings): Promise<void>
export async function clearSettings(): Promise<void>
export function settingsPath(): string
```

- `loadSettings()` — read `SETTINGS_PATH`; if missing, create the directory, return a deep clone of `DEFAULT_SETTINGS`. Parse JSON, `deepMerge(DEFAULT_SETTINGS, parsed)`, then clamp numeric fields. **Never throws** — any error returns defaults and writes a warning to stderr.
- `saveSettings()` — ensure the directory exists, `JSON.stringify(settings, null, 2)`, write atomically (write to `settings.json.tmp`, `fs.rename`), then `fs.chmod(SETTINGS_PATH, 0o600)`. **Never throws** — logs on failure.
- `clearSettings()` — `fs.rm` the file if it exists.
- `settingsPath()` — returns `SETTINGS_PATH`.

### 5.2 `src/telegram.js`

```js
export class TelegramError extends Error {
  code: number;          // HTTP-ish code from Telegram, 0 for network errors
  description: string;
  retryAfter: number;    // seconds, 0 if absent
}

export class TelegramClient {
  constructor(token: string)

  getMe(): Promise<{ id: number, username: string, first_name: string }>
  getUpdates(offset?: number): Promise<Array<Update>>

  sendPhoto(opts:    { chatId: string, file: File, caption?: string }): Promise<Message>
  sendVideo(opts:    { chatId: string, file: File, caption?: string,
                       durationSec?: number, width?: number, height?: number }): Promise<Message>
  sendDocument(opts: { chatId: string, file: File, caption?: string }): Promise<Message>
}

export async function withRetry(fn, { retries = 2, onRetry } = {})
```

**Implementation rules**

1. `baseUrl = \`${API_BASE}/bot${this.token}\``.
2. Internal `_call(method, { formData, params })`:
   - If `formData` → `fetch(url, { method: 'POST', body: formData })`.
   - Else → `fetch(url + '?' + new URLSearchParams(params))`.
   - **Do not set any headers.** (Node's fetch handles multipart boundaries automatically.)
   - Parse JSON. Parse failure → `TelegramError` with `code = response.status`.
   - `json.ok === false` → throw `TelegramError(json.description, { code: json.error_code, retryAfter: json.parameters?.retry_after ?? 0 })`.
   - Return `json.result`.
3. `sendPhoto` builds `FormData` with `chat_id`, `photo` (filename `photo_<timestamp>.jpg`), optional `caption` truncated to `LIMITS.MAX_CAPTION_LEN`.
4. `sendVideo` adds `duration`, `width`, `height`, `supports_streaming: 'true'`.
5. `sendDocument` uses field name `document`.
6. `getUpdates` calls `_call('getUpdates', { params: { offset: offset ?? '', timeout: 0, allowed_updates: JSON.stringify(['message']) } })`.

**Retry wrapper** — retries on `TypeError` (network) and `TelegramError` with `code === 429` or `code >= 500`. 429 → wait `max(retryAfter, 1) * 1000` ms. Other retryable → `1000ms` then `3000ms`. Never retries 400/401/403/404/409. Calls `onRetry(attempt, delayMs, error)` before each wait.

**Error message mapping** (owned by `app.js`):

| Condition | User-facing message |
|---|---|
| `code === 401` | "Invalid bot token. Check the token from @BotFather." |
| `code === 400` & description contains "chat not found" | "Chat ID not found. Send /start to your bot first." |
| `code === 403` | "The bot can't message this chat. Open Telegram and press Start in the bot chat." |
| `code === 409` | "A webhook is set for this bot. Delete it via @BotFather → /deletewebhook." |
| `code === 429` | "Rate limited by Telegram. Waiting Ns…" |
| `code === 413` | "File too large for Telegram (max 50 MB)." |
| network error (`code === 0`) | "Network error. Check your connection." |

### 5.3 `src/termux.js`

Thin, testable wrappers around the Termux:API binaries. Every function returns `Promise<{ stdout, stderr, code }>` and **never throws** for a non-zero exit — callers inspect `code`.

```js
export async function hasBinary(name: string): Promise<boolean>
export async function termuxCameraInfo(): Promise<CameraInfo[]>              // parses `termux-camera-info` JSON
export async function termuxCameraPhoto({ cameraId, outPath, timeoutMs }): Promise<void>
export async function termuxWakeLock(): Promise<void>
export async function termuxWakeUnlock(): Promise<void>
export async function termuxNotification({ title, content, id }): Promise<void>
export async function termuxToast({ text }): Promise<void>
export async function termuxSetupStorage(): Promise<void>
export async function termuxIsForeground(): Promise<boolean>                // via `termux-info` or dumpsys fallback
export async function ffmpegAvailable(): Promise<boolean>
export async function ffmpegResize({ inPath, outPath, maxWidth, quality }): Promise<void>
export async function ffmpegEncodeBurst({ frames, outPath, fps }): Promise<void>
export async function amStartVideoCapture({ outUri, facing, withAudio, timeoutMs }): Promise<void>
export async function readSharedFile(uriOrPath): Promise<Buffer>
```

`hasBinary` uses `which <name>` (Termux ships a `which`). `termuxCameraInfo()` runs `termux-camera-info` and `JSON.parse`s the output; on parse failure returns `[]`.

### 5.4 `src/camera.js`

```js
export async function listCameras(): Promise<Array<{ id: string, facing: string, label: string }>>
export async function capturePhoto({ cameraId, outPath }):
  Promise<{ path: string, width: number, height: number, bytes: number }>
export async function postProcess({ inPath, outPath, maxWidth, quality }):
  Promise<{ path: string, width: number, height: number, bytes: number }>
```

**`listCameras()`** wraps `termuxCameraInfo()`, normalizing to `{ id, facing, label }` where `facing` is `"back" | "front" | "external" | "unknown"`.

**`capturePhoto()`**
1. Ensure the output directory exists.
2. Call `termuxCameraPhoto({ cameraId, outPath, timeoutMs: LIMITS.CAPTURE_TIMEOUT_MS })`.
3. On non-zero exit → throw with a normalized message:
   - `stderr` contains "permission" → `"Camera permission denied. Grant the Camera permission to Termux:API in Android Settings → Apps."`
   - `stderr` contains "not found" → `"Camera not found. Run 'petcam doctor'."`
   - `stderr` contains "in use" → `"Camera is in use by another app."`
   - `ENOENT` on the binary → `"termux-api is not installed. Run: pkg install termux-api"`
   - else → `"Camera capture failed: <stderr>"`
4. Read the file size. Return `{ path, width: 0, height: 0, bytes }` — `termux-camera-photo` does not report dimensions; dimensions are filled in by `postProcess()`.

**`postProcess()`**
- If `maxWidth === 0` **and** `quality >= 0.99` → return the input unchanged (no re-encode).
- If `ffmpeg` is unavailable → log a warning (`"ffmpeg not installed; sending full-size photo."`) and return the input unchanged.
- Otherwise run `ffmpegResize(...)` into a temp file and return its stats (parse dimensions from `ffmpeg`'s stderr, or via `ffprobe` if present — fallback to `0×0` and let Telegram infer).

### 5.5 `src/video.js`

```js
export async function recordVideo({ mode, durationSec, includeAudio, facing, burstFps, onProgress }):
  Promise<{ path: string, mimeType: string, width: number, height: number, durationSec: number, bytes: number }>
export function extensionForMime(mime: string): string
```

**`mode === 'intent'`** — the default.
1. Ensure `~/storage/shared/Pictures/petcam/` exists (run `termux-setup-storage` first if missing).
2. Build the output URI `file://<expanded path>/rec_<timestamp>.mp4`.
3. Call `amStartVideoCapture({ outUri, facing, withAudio: includeAudio, timeoutMs: VIDEO_INTENT_TIMEOUT_MS })`.
   - The intent: `am start -a android.media.action.VIDEO_CAPTURE -e output <uri> [--ez android.intent.extras.VIDEO_CAPTURE_WITH_AUDIO true] [--ei android.intent.extras.CAMERA_FACING <0|1>]`.
4. Poll for the output file every 500 ms until it appears **and** its size stops growing for 1.5 s, or `timeoutMs` elapses.
5. If the file never appears → throw `"The camera app did not return a video. Your device may not support this; try 'petcam config set video.mode burst'."`
6. Return stats. `durationSec` is estimated by probing the file with `ffprobe` if available, else left at `0` and omitted from the Telegram call.

**`mode === 'burst'`** — the fallback.
1. Compute frame count `n = clamp(round(durationSec * burstFps), 2, 600)`.
2. For each frame: `capturePhoto({ cameraId, outPath: `${tmp}/frame_%05d.jpg` })`, calling `onProgress(i, n)`.
   - Termux's capture latency limits real fps to roughly 1–4; document this.
3. `ffmpegEncodeBurst({ frames: `${tmp}/frame_%05d.jpg`, outPath: `${tmp}/rec_<ts>.mp4`, fps: burstFps })`.
4. Return stats. `mimeType` is `'video/mp4'`. Audio is not supported in burst mode.

**`extensionForMime(mime)`** — `'video/mp4…' → 'mp4'`, `'video/webm…' → 'webm'`, default `'mp4'`.

### 5.6 `src/scheduler.js`

```js
export class AutoUploadScheduler {
  constructor({ onDue }: { onDue: () => Promise<void> })
  start(intervalSec: number): void
  stop(): void
  setInterval(intervalSec: number): void   // no-op if not running
  isRunning(): boolean
  secondsUntilNext(): number | null
}
```

Internal `setInterval(tick, 1000)`, wall-clock comparison against `nextAt`, sets `nextAt` **before** awaiting `onDue()` so a slow upload never causes a burst, `busy` flag prevents overlap, `tick` never throws, `start()` schedules the first upload one full interval from now.

### 5.7 `src/wakelock.js`

```js
export class WakeLockKeeper {
  constructor({ onChange })   // onChange(state: 'active'|'off'|'unsupported'|'denied')
  async enable(): Promise<boolean>
  async disable(): Promise<void>
  isActive(): boolean
}
```

- `enable()`:
  - If `termux-wake-lock` is not on `PATH` → `onChange('unsupported')`, return `false`.
  - Call `termuxWakeLock()`. On success → set flag, `onChange('active')`, return `true`.
  - Non-zero exit containing `"permission"` or `"denied"` → `onChange('denied')`, return `false`.
  - Anything else → `onChange('off')`, log a warning, return `false`.
- `disable()` → call `termuxWakeUnlock()`, clear the flag, `onChange('off')`.
- On `SIGINT`/`SIGTERM`, `app.js` calls `disable()` before exit.
- **Never throws.** All failures are reported via `onChange`.

### 5.8 `src/cli.js`

Pure I/O helpers. No business logic.

```js
export const colors = { ok, warn, err, dim, bold, cyan, green, yellow, red };

export async function prompt(question, { default: d, validate } = {}): Promise<string>
export async function promptPassword(question): Promise<string>   // masks input, echoes '*'
export async function confirm(question, { default: d } = {}): Promise<boolean>
export async function choose(question, options): Promise<string>  // numbered menu, returns option.value
export async function withSpinner(label, fn): Promise<T>          // async spinner on TTY, plain line otherwise
export function log(level: 'info'|'success'|'warn'|'error', message): void
export function status(msg: string): void        // overwriting single line, e.g. countdown
export function clearStatus(): void
export function banner(text: string): void
export function table(rows: Array<[string, string]>): void
export function die(msg: string, code = 1): never
```

**Rules**
- All prompts write to **stderr**, all results to **stdout**. This lets `petcam photo > file` capture output without prompt noise.
- `promptPassword` uses `readline` with `terminal: true` and manually intercepts keystrokes to print `*`. It never stores the input in shell history.
- When `!process.stdout.isTTY`, `withSpinner` and `status` degrade to one `log()` line per state change.
- `colors.*` are no-ops when `!process.stdout.isTTY` or `NO_COLOR` is set.

### 5.9 `src/app.js`

Orchestration only. Owns:

- Subcommand dispatch (`setup`, `run`, `photo`, `video`, `test`, `find-chat`, `config`, `forget`, `status`, `doctor`, `start`, `stop`, `version`, `update`, `help`).
- The `isSending` mutex so photo/video uploads never overlap.
- `lastRecording = { path, mimeType, width, height, durationSec, bytes } | null`.
- Translating `TelegramError` → user messages via §5.2's table.
- Caption rendering (`renderCaption(template, now)` — same signature and semantics as §7.10).
- Wake-lock policy (§7.11).
- Signal handlers: `SIGINT`/`SIGTERM` stop the scheduler, unlock the wake lock, remove the PID file, exit cleanly.

---

## 6. CLI specification

### 6.1 Commands (frozen)

```
petcam                        Same as `petcam help`
petcam help                   Print usage
petcam version                Print the app version, install path, and settings path
petcam setup                  Interactive step-by-step configuration wizard
petcam test                   Verify the token with getMe
petcam find-chat              Call getUpdates and offer to save the newest chat ID
petcam photo                  Capture and send one photo now
petcam video                  Record and send one video now
petcam run [--daemon]         Start the auto-upload loop (foreground unless --daemon)
petcam start                  Alias for `run --daemon`
petcam stop                   Stop the daemon via the PID file
petcam status                 Print the current settings summary and daemon status
petcam config show            Print the settings file path and contents
petcam config set <k> <v>     Set a dotted key, e.g. `autoUpload.intervalSec 30`
petcam config get <k>         Print one value
petcam update                 git pull the install dir and restart the daemon if running
petcam forget                 Delete ~/.petcam (settings, PID, cache) after a confirm prompt
petcam doctor                 Probe Node, termux-api, ffmpeg, shared storage, token, chat ID
```

All commands accept `--json` to emit machine-readable output on stdout (prompts are suppressed; missing values cause an error exit instead of a prompt).

`petcam update` refuses to run if the install dir is not a git checkout and prints the reinstall one-liner instead.

### 6.2 Interactive setup wizard (`petcam setup`)

Runs the following steps in order. Each step is skippable with an empty input where a default is shown. The wizard is **resumable**: pressing Ctrl+C at any step saves nothing and prints `"Aborted. No changes saved."`.

```
🐾 Pet Cam — Setup
This wizard configures the app step by step. Press Ctrl+C to abort.

Step 1/8 — Prerequisites
  ✔ node        v20.11.0
  ✔ termux-api  found
  ✔ ffmpeg      found   (optional, enables resize/quality control)
  ✔ storage     ~/storage/shared
  All set.

Step 2/8 — Telegram bot token
  Create a bot with @BotFather on Telegram (send /newbot).
  Paste the token (input hidden): ********************

Step 3/8 — Verify token
  Connecting to api.telegram.org…
  ✔ Connected as @my_pet_bot

Step 4/8 — Chat ID
  Open Telegram, send /start to @my_pet_bot, then press Enter.
  [Enter]
  ✔ Found chat: Alice (123456789)
  Use this chat? [Y/n]

Step 5/8 — Camera
  Available cameras:
    1) back     (id "0")
    2) front    (id "1")
  Choose [1]: 1
  Max width (0 = original) [1280]:
  JPEG quality (0.3–1.0) [0.85]:

Step 6/8 — Auto-upload
  Enable auto-upload? [y/N]: y
  Interval (seconds, 15–86400) [60]:
  Pause while Termux is in the background? [y/N]:

Step 7/8 — Video
  Mode: 1) intent (use the system camera app)  2) burst (ffmpeg stills)
  Choose [1]: 1
  Default duration (seconds, 1–60) [10]:
  Include audio? [y/N]:

Step 8/8 — Device
  Keep the CPU awake while running? [Y/n]:

✔ Setup complete.
Settings saved to ~/.petcam/settings.json (mode 0600).

Next steps:
  petcam photo      – send a photo now
  petcam run        – start auto-upload in the foreground
  petcam start      – run as a background daemon
  petcam doctor     – check everything is healthy
```

Rules:
- Step 1 runs the same checks as `petcam doctor` and **refuses to continue** if `node` or `termux-api` is missing; it prints the exact `pkg install` command.
- Step 3 retries `getMe()` up to 2 times via `withRetry`; on final failure it re-prompts for the token.
- Step 4 accepts manual entry as an alternative to `getUpdates`: `"Or paste a chat ID: "`.
- Every subsequent step uses the current settings as defaults, so re-running `petcam setup` is a fast reconfigure.

### 6.3 Output conventions

- Log lines: `[HH:MM:SS] <level-icon> <message>` on stderr. Levels: `·` info, `✔` success, `!` warn, `✖` error.
- The auto-upload loop keeps a single **status line** on stderr: `next photo in 42 s · last: 128 KB @ 12:03:04 · sent: 17 · failed: 0`. It is overwritten in place with `\r` on a TTY, printed once per tick otherwise.
- `petcam status` and `petcam config show` write to stdout and are `--json`-friendly.
- No emoji in `--json` output.

---

## 7. Behavior flows

### 7.1 Boot (shared by every command)

1. `loadSettings()`.
2. If `settings.version !== 2`, run the v1→v2 migration (see §9.2) and save.
3. Instantiate `TelegramClient` lazily when a command needs it.
4. Wire `SIGINT`/`SIGTERM` → graceful shutdown.

### 7.2 `petcam test`

- Requires a non-empty token.
- `withSpinner('Connecting…', () => withRetry(() => client.getMe()))`.
- Success → `"✔ Connected as @<username>"`, exit 0.
- Failure → mapped message on stderr, exit 1.

### 7.3 `petcam find-chat`

1. Require a non-empty token; else `"Enter a bot token first — run 'petcam setup'."`, exit 1.
2. `getUpdates()`.
3. Empty → `"No messages found. Open Telegram, send /start to your bot, then try again."`, exit 1.
4. Otherwise take the **last** update with `message.chat.id` and prompt: `"Found chat: <first_name or title> (<id>). Save? [Y/n]"`.
5. On confirm, write `settings.telegram.chatId`, save, exit 0.
6. On `409`, print the webhook message from §5.2.

### 7.4 `petcam photo`

1. Require token, chat ID, and a camera on the device; else exit 1 with the specific missing item.
2. `isSending = true`.
3. `capturePhoto()` → temp file under `CACHE_DIR`.
4. `postProcess()` if `ffmpeg` is available.
5. Build a `File` named `petcam_<YYYYMMDD_HHMMSS>.jpg` with type `image/jpeg`.
6. If `bytes > LIMITS.MAX_UPLOAD_BYTES` → abort with `"File too large for Telegram (max 50 MB)."`.
7. Render the caption from the template (§7.10).
8. `withRetry(() => client.sendPhoto({ chatId, file, caption }), { onRetry: log })`.
9. Success → `"✔ Photo sent (123 KB)."`, exit 0.
10. Failure → mapped error, exit 1.
11. `finally` → `isSending = false`; delete the temp file.

### 7.5 `petcam video`

1. Require token and chat ID.
2. `recordVideo({ mode, durationSec, includeAudio, facing, burstFps, onProgress })`.
   - In `intent` mode, before launching the intent: `"Opening the system camera app. Record your clip, then return to Termux."`
   - In `burst` mode, the spinner shows `frame 12/40`.
3. After the file exists, build a `File` named `petcam_<timestamp>.<extensionForMime(mime)>` with the detected MIME type.
4. Size check (> 50 MB → error, abort).
5. `withRetry(() => client.sendVideo({ chatId, file, caption, durationSec, width, height }))`.
6. **Fallback:** if it throws a `TelegramError` with `code === 400`, retry once with `sendDocument`. Log `"Telegram rejected the video format; sent as a file instead."`
7. Success → `"✔ Video sent (1.8 MB, 10 s)."`, delete the temp file, exit 0.
8. Failure → keep the file, print its path, log the mapped error, exit 1.

### 7.6 `petcam run`

1. Require token, chat ID, and camera. If `autoUpload.enabled` is false, prompt once: `"autoUpload.enabled is false. Enable and continue? [Y/n]"` and persist.
2. If `device.keepAwake` and the wake lock is supported, `keeper.enable()`.
3. `scheduler.start(settings.autoUpload.intervalSec)`.
4. Enter the loop: update the status line every 1 s from `scheduler.secondsUntilNext()` and running counters.
5. **Each due tick:**
   1. If `pauseWhenHidden` and Termux is not in the foreground → log `"paused (backgrounded)"`, reset `nextAt = now + intervalMs`, and skip. ("Foreground" is detected via `termuxIsForeground()`; if the helper is unavailable, this setting is a no-op and a one-time warning is printed.)
   2. If `isSending` → log `"skipped: previous upload still in progress"`.
   3. Otherwise run `sendPhoto({ reason: 'auto' })` — the same routine as §7.4 but with no process exit.
6. **Manual sends reset the timer baseline**: after any successful manual `petcam photo` that happens while the daemon is running (via `SIGUSR1` — optional), call `scheduler.setInterval(intervalSec)`.
7. Ctrl+C → stop the scheduler, disable the wake lock, delete the PID file, exit 0.

### 7.7 `petcam start` / `petcam stop`

- `start` forks itself: `spawn(process.execPath, [binPath, 'run'], { detached: true, stdio: ['ignore', fd(LOG_PATH), fd(LOG_PATH)] }).unref()`, writes the child PID to `PID_PATH`, prints `"✔ Running as PID <n>. Logs: ~/.petcam/petcam.log"`.
- If `PID_PATH` exists and the process is alive → `"Already running (PID n). Use 'petcam stop' first."`, exit 1.
- `stop` reads `PID_PATH`, sends `SIGTERM`, waits up to 5 s, then `SIGKILL`, removes the PID file.
- `status` reports daemon state by probing `PID_PATH`.

### 7.8 `petcam config set <k> <v>`

- Accepts dotted keys: `telegram.token`, `telegram.chatId`, `telegram.captionTemplate`, `camera.cameraId`, `camera.facing`, `camera.maxWidth`, `camera.jpegQuality`, `autoUpload.enabled`, `autoUpload.intervalSec`, `autoUpload.pauseWhenHidden`, `video.mode`, `video.durationSec`, `video.includeAudio`, `video.burstFps`, `device.keepAwake`.
- Coerces types per the schema in §4.1 and clamps numerics to `LIMITS`.
- Unknown keys → `"Unknown setting: <k>. Run 'petcam config show' to list keys."`, exit 2.
- On success → prints the new value and saves.

### 7.9 `petcam forget`

1. `"This deletes ~/.petcam (settings, logs, cache, PID file) and revokes nothing on Telegram's side."`
2. `confirm("Continue?", { default: false })`.
3. Stop the daemon if running, `clearSettings()`, `rm -rf` the cache dir and log file, print the path to revoke the token via @BotFather, exit 0.

### 7.10 Caption template

```js
export function renderCaption(template, now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return template
    .replaceAll('{datetime}', `${date} ${time}`)
    .replaceAll('{date}', date)
    .replaceAll('{time}', time)
    .slice(0, 1024);
}
```

Unknown placeholders are left untouched. If the rendered result is empty/whitespace → send no caption at all.

### 7.11 Wake-lock policy

- Auto-enable when `petcam run` starts and `device.keepAwake` is true.
- `petcam photo`/`petcam video` do **not** acquire the lock (they are short-lived).
- `petcam config set device.keepAwake true` while a daemon is running → the running daemon does not retroactively pick it up until restarted; the CLI prints a hint.
- Always released on process exit via `SIGINT`/`SIGTERM` handlers.

### 7.12 `petcam doctor`

Checks, in order, printing `✔`/`✖`/`!` for each:

1. Node version ≥ 18.
2. `termux-api` on `PATH` (via `hasBinary('termux-camera-photo')`).
3. `ffmpeg` on `PATH` (optional — `!` if missing, not `✖`).
4. `~/storage/shared` exists.
5. Camera list non-empty (`termuxCameraInfo()`).
6. `~/.petcam/settings.json` exists and is valid JSON, mode 0600.
7. Token present and `getMe()` succeeds.
8. Chat ID present and non-empty (no round-trip to Telegram).

Exit 0 if all non-optional checks pass, else exit 1.

### 7.13 `petcam version`

Prints `APP_VERSION`, `INSTALL_DIR`, `SETTINGS_PATH`, and the resolved `PETCAM_HOME`. Exits 0. Under `--json`, emits `{ "version", "installDir", "settingsPath" }`.

### 7.14 `petcam update`

1. Verify `INSTALL_DIR/.git` exists; else `"This install is not a git checkout. Reinstall with:\n  curl -fsSL <install-url> | bash"`, exit 1.
2. `git -C INSTALL_DIR fetch --depth 1 origin <branch>` then `checkout FETCH_HEAD`.
3. Print the old and new short SHAs.
4. If the daemon was running before the update, restart it (`stop` then `start`); else print a hint.

---

## 8. Error handling rules

1. **No unhandled rejections.** `bin/petcam.js` installs `process.on('unhandledRejection')` and `process.on('uncaughtException')` that log and exit with code 1.
2. Every `async` command handler is wrapped in `try/catch` in `app.js`; the catch maps errors to messages and sets the exit code.
3. User-visible errors go through `cli.log('error', ...)`. Raw stack traces are only shown when `PETCAM_DEBUG=1`.
4. The app must never enter a permanently broken state. Temp files are deleted in `finally`; the mutex is always released.
5. `console.error(err)` (not `console.log`) preserves the original error object for debugging when `PETCAM_DEBUG=1`.
6. Every non-zero exit code is documented:
   - `1` — generic failure (network, Telegram, camera).
   - `2` — usage error (unknown subcommand, unknown config key, bad flag).
   - `3` — missing prerequisite (`termux-api`, Node version, storage, non-Termux environment).

---

## 9. Security & privacy requirements

### 9.1 Token handling

- Printed warning under the token prompt in `petcam setup`: *"Your bot token is stored in plaintext at ~/.petcam/settings.json (mode 0600). Anyone with this token controls your bot. Use a dedicated bot and run `petcam forget` when you're done."*
- The settings file is written atomically and `chmod 0600`.
- `petcam config show` **redacts** the token by default (`1234…cdef`); pass `--reveal` to print it.
- `petcam forget` prints the exact @BotFather command to revoke a token.
- No third-party scripts, no telemetry, no network calls other than `https://api.telegram.org`.

### 9.2 Settings migration

- v1.1's browser settings (a `localStorage` JSON blob) cannot be imported automatically; the migration is a no-op that sets `version: 2` and leaves the token/chat ID empty. Users re-run `petcam setup`.
- Future schema changes bump `version` and add a numbered migration in `settings.js`. Unknown keys are dropped by `deepMerge`.

### 9.3 Camera & storage

- The camera is only invoked by an explicit `petcam photo`, `petcam video`, or a `petcam run` tick the user enabled.
- Photos and videos are written under `~/.petcam/cache/` (photo) or `~/storage/shared/Pictures/petcam/` (video, required by the intent) and deleted after a successful send. On failure the file is kept and its path is printed so the user can inspect or resend it.
- `termux-setup-storage` is run at setup time only; the app never reads files outside its own cache and the `Pictures/petcam/` directory.

### 9.4 Installer security

- The README must state, verbatim: *"`curl | bash` runs a script without showing it to you first. If you'd rather read it, use the two-step form in §11.2 — the result is identical."*
- `install.sh` and `uninstall.sh` must be self-contained: no sourcing of remote files, no `eval` of remote output, no `curl | bash` inside.
- The installer must never echo the token or any value of `PETCAM_HOME` that could contain one.
- Every fetch uses `-fsSL` (fail on HTTP errors, silent progress, show errors, follow redirects) and every extraction writes only under `$PETCAM_DIR`.
- The installer must not run `sudo`, must not modify any file outside `$PETCAM_DIR`, `$PREFIX/bin/petcam`, and (with explicit consent) the uninstaller's optional removal of `$PETCAM_HOME`.

---

## 10. Testing

### 10.1 Manual QA checklist

| # | Scenario | Expected |
|---|---|---|
| 1 | `petcam doctor` on a fresh Termux with `node` + `termux-api` only | All non-optional checks pass; `ffmpeg` shown as optional |
| 2 | `petcam setup` with no token | Prompts until a valid token is entered; `getMe` verified |
| 3 | `petcam setup` with a wrong token three times | Exits 1 with the invalid-token message |
| 4 | `petcam setup`, then send `/start`, then `petcam find-chat` | Chat ID saved |
| 5 | `petcam find-chat` before `/start` | "No messages found…" hint, exit 1 |
| 6 | `petcam test` with a valid token | `✔ Connected as @…`, exit 0 |
| 7 | `petcam photo` with a bad chat ID | "Chat ID not found…", exit 1 |
| 8 | `petcam photo` with the camera permission denied | Exact permission message with the Android Settings hint |
| 9 | `petcam photo` with a valid setup | Photo arrives in Telegram within 30 s; temp file deleted |
| 10 | `petcam run` with `intervalSec=15` | Status line counts down; a photo arrives every ~15 s |
| 11 | `petcam run` for 2 minutes with the screen off and Termux backgrounded | Wake lock keeps the loop alive; photos continue |
| 12 | `petcam config set autoUpload.intervalSec 99999` | Clamped to 86400 |
| 13 | `petcam config set bogus.key 1` | Usage error, exit 2 |
| 14 | `petcam video` (intent mode) | System camera app opens; after returning, the clip is sent |
| 15 | `petcam video` (burst mode, 5 s @ 4 fps) | ~20 frames captured, ffmpeg encodes, video sent |
| 16 | Send a `.webm`/unusual MP4 | Telegram returns 400; the app retries as a document and logs the fallback |
| 17 | `petcam start`, then `petcam status`, then `petcam stop` | Daemon runs, status shows the PID, stop exits cleanly |
| 18 | Kill the daemon with `kill -9` | `petcam status` detects a stale PID and cleans it up |
| 19 | `petcam run`, then Ctrl+C | Wake lock released, PID file removed, exit 0 |
| 20 | `petcam run`, then turn off Wi-Fi mid-interval | Network error logged, next tick retries, app stays alive |
| 21 | `petcam config show` | Token redacted; path printed |
| 22 | `petcam config show --reveal` | Token printed in full |
| 23 | `petcam forget` | Confirm prompt; `~/.petcam` removed; nothing sent to Telegram |
| 24 | `PETCAM_HOME=/tmp/pc petcam setup` | Settings written to `/tmp/pc/settings.json` |
| 25 | `petcam --json photo` | Single JSON object on stdout, no prompts, no ANSI |
| 26 | `petcam run` with `pauseWhenHidden=true`, then background Termux | Ticks logged as "paused (backgrounded)" and rescheduled |
| 27 | `grep -rn 'from "/\|require("/' .` | No matches (no absolute paths) |
| 28 | `curl -fsSL https://raw.githubusercontent.com/<user>/pet-cam-cli/main/install.sh \| bash` on a factory-fresh Termux | Installs `nodejs`, `termux-api`, and (prompted) `ffmpeg`; clones the repo; writes `$PREFIX/bin/petcam`; runs `petcam doctor`; offers to run `petcam setup`; exits 0 |
| 29 | Re-run the same one-liner over an existing install | Fast-forwards the git checkout; overwrites `$PREFIX/bin/petcam`; **does not** touch `~/.petcam/settings.json` |
| 30 | `PETCAM_YES=1 PETCAM_NO_SETUP=1 curl … \| bash` with no TTY (e.g. from a script) | Completes without prompting; exits 0; `petcam doctor` runs non-interactively |
| 31 | `PETCAM_DIR=$HOME/pc PETCAM_REPO=… PETCAM_BRANCH=dev curl … \| bash` | Installs into `$HOME/pc` from the `dev` branch; wrapper points at `$HOME/pc/bin/petcam.js` |
| 32 | `curl … \| bash` on a non-Termux Linux box | Exits 3 with `"This installer must run inside Termux on Android."`; makes no changes |
| 33 | `curl -fsSL …/uninstall.sh \| bash`, answer "n" to "Remove ~/.petcam?" | Removes `$PREFIX/bin/petcam` and the install dir; leaves `~/.petcam` intact |
| 34 | `PETCAM_PURGE=1 curl …/uninstall.sh \| bash` | Also removes `~/.petcam` |
| 35 | `petcam version` | Prints `2.1.0`, the install dir, and the settings path; exits 0 |
| 36 | `petcam update` on a git checkout | Fast-forwards, prints the new commit SHA, restarts the daemon if one was running |
| 37 | `petcam update` on a tarball install (no `.git`) | Exits 1 with the reinstall one-liner |

### 10.2 Static checks

- No `console.log` in `src/` (only `cli.log`, or `console.error` guarded by `PETCAM_DEBUG`).
- No `TODO` comments.
- No `npm install` step required; `package.json` has `"dependencies": {}`.
- `node --check` passes for every file in `src/` and `bin/`.
- Running any command with `NO_COLOR=1` produces no ANSI escapes.
- `shellcheck install.sh uninstall.sh` produces no warnings.
- `install.sh` contains no nested `curl | bash` and no absolute paths outside Termux's `$PREFIX`.
- `grep -c 'curl' install.sh` counts only the two documented fetches (§11.3) plus `curl --version` guards, if any.

---

## 11. Installation & deployment

### 11.1 One-line install (primary path)

On a device that already has the **Termux** app (from F-Droid) and the **Termux:API** addon (also from F-Droid) installed:

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/pet-cam-cli/main/install.sh | bash
```

That single command:

1. Verifies it is running inside Termux on Android (§11.4.1).
2. Reattaches `stdin` to `/dev/tty` so later prompts work despite `stdin` being the script pipe (§11.4.2).
3. Runs `pkg update -y` and `pkg install -y nodejs termux-api git`.
4. Prompts once to optionally install `ffmpeg` (skippable via `PETCAM_WITH_FFMPEG=0`; auto-yes via `PETCAM_YES=1` or `PETCAM_WITH_FFMPEG=1`).
5. Fetches the app into `$PETCAM_DIR` (default `~/.local/share/petcam`) via `git clone --depth 1` when git is present, or a tarball from GitHub when it is not.
6. Writes the wrapper binary at `$PREFIX/bin/petcam` (§11.4.5).
7. Runs `petcam doctor` (skippable via `PETCAM_NO_DOCTOR=1`).
8. Offers to run the interactive `petcam setup` wizard (skippable via `PETCAM_NO_SETUP=1`).
9. Prints the next-steps banner.

The canonical install URL is frozen once the repo owner is chosen. A short redirector (e.g. `petcam.dev/install`) may be added later, but the `raw.githubusercontent.com` URL remains the source of truth and must always work.

### 11.2 Audited install (recommended in the README)

Because `curl | bash` executes a script the user has not read, the README must present this alternative **immediately below** the one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/pet-cam-cli/main/install.sh -o install.sh
less install.sh        # read it
bash install.sh
```

The installer must be written so this flow produces an identical result. In particular, the installer must not depend on being piped.

### 11.3 Remote references (the complete list)

The installer and uninstaller may contact exactly these origins:

| Purpose | URL |
|---|---|
| `install.sh` fetch | `https://raw.githubusercontent.com/<user>/pet-cam-cli/<branch>/install.sh` |
| `uninstall.sh` fetch | `https://raw.githubusercontent.com/<user>/pet-cam-cli/<branch>/uninstall.sh` |
| Repo clone (git) | `${PETCAM_REPO}` (default `https://github.com/<user>/pet-cam-cli`) |
| Repo tarball (no git) | `${PETCAM_REPO}/archive/refs/heads/${PETCAM_BRANCH}.tar.gz` |
| Termux packages | Termux's configured mirrors, via `pkg` |

No other host may be contacted. The installer must not embed analytics, telemetry, or a shortened URL that hides a redirect.

### 11.4 `install.sh` contract (frozen)

**Shebang and shell:** `#!/data/data/com.termux/files/usr/bin/bash` with `set -euo pipefail`. `sh` is not sufficient because the script uses `[[ ]]` and `${var,,}`.

**Environment variables (frozen names):**

| Variable | Default | Meaning |
|---|---|---|
| `PETCAM_REPO` | `https://github.com/<user>/pet-cam-cli` | Git remote or tarball base |
| `PETCAM_BRANCH` | `main` | Branch or tag to install |
| `PETCAM_DIR` | `$HOME/.local/share/petcam` | Install directory |
| `PETCAM_HOME` | `$HOME/.petcam` | Passed through to the app; **never written by the installer** |
| `PETCAM_WITH_FFMPEG` | unset → prompt | `1` install, `0` skip, no prompt |
| `PETCAM_YES` | unset | `1` = assume yes for every prompt |
| `PETCAM_NO_DOCTOR` | unset | `1` = skip the post-install doctor run |
| `PETCAM_NO_SETUP` | unset | `1` = skip the setup wizard offer |
| `PETCAM_FORCE` | unset | `1` = proceed even if Termux detection is uncertain |

All variables are exported to the child `petcam` invocation so the app sees the same `PETCAM_HOME`/`PETCAM_DIR` the installer used.

#### 11.4.1 Termux detection

```sh
if [[ -z "${TERMUX_VERSION:-}" ]] && [[ "${PREFIX:-}" != /data/data/com.termux/files/usr ]]; then
  if [[ "${PETCAM_FORCE:-0}" != 1 ]]; then
    echo "This installer must run inside Termux on Android." >&2
    echo "Install Termux from F-Droid: https://f-droid.org/packages/com.termux/" >&2
    exit 3
  fi
fi
```

Exit code **3** on failure, per §8.6. Detection must not rely solely on `TERMUX_VERSION`, because older Termux builds do not set it.

#### 11.4.2 Reattaching stdin

Under `curl … | bash`, `stdin` is the script text. Any `read` would consume the script body. The installer must reattach before the first prompt:

```sh
if [[ ! -t 0 ]]; then
  if [[ -e /dev/tty ]] && [[ -t 1 || -t 2 ]]; then
    exec </dev/tty
  else
    # No TTY available — become fully non-interactive.
    export PETCAM_YES=1
    export PETCAM_NO_SETUP=1
    export PETCAM_WITH_FFMPEG="${PETCAM_WITH_FFMPEG:-0}"
  fi
fi
```

This block is mandatory. `set -e` must not abort the script when `/dev/tty` is absent — hence the `[[ -t 1 || -t 2 ]]` guard and the explicit non-interactive fallback.

#### 11.4.3 Package bootstrap

```sh
export DEBIAN_FRONTEND=noninteractive
pkg update -y
pkg install -y nodejs termux-api git
```

`git` is best-effort: if `pkg install git` fails, the installer must continue and use the tarball path. `ffmpeg` is installed only after the prompt / env-var resolution and its failure is non-fatal (a warning, not an exit).

The installer must never run `termux-setup-storage` — it raises an Android permission dialog that cannot be answered from a pipe. `petcam setup` handles it interactively instead.

#### 11.4.4 Fetching the app

```sh
if [[ -d "$PETCAM_DIR/.git" ]]; then
  git -C "$PETCAM_DIR" fetch --depth 1 origin "$PETCAM_BRANCH"
  git -C "$PETCAM_DIR" checkout -q FETCH_HEAD
elif command -v git >/dev/null 2>&1; then
  rm -rf "$PETCAM_DIR"
  mkdir -p "$(dirname "$PETCAM_DIR")"
  git clone --depth 1 --branch "$PETCAM_BRANCH" "$PETCAM_REPO" "$PETCAM_DIR"
else
  mkdir -p "$PETCAM_DIR"
  curl -fsSL "$PETCAM_REPO/archive/refs/heads/$PETCAM_BRANCH.tar.gz" \
    | tar -xz -C "$PETCAM_DIR" --strip-components=1
fi
```

Idempotency rule: re-running the installer over an existing checkout **fast-forwards in place** and never deletes `~/.petcam`. The `rm -rf` above only fires when the destination exists but is not a git repo (i.e. a prior tarball install being upgraded to a git install).

After fetching, the installer prints the installed commit SHA:

```sh
sha="$(git -C "$PETCAM_DIR" rev-parse --short HEAD 2>/dev/null || echo 'tarball')"
printf '✔ Installed petcam at %s (%s)\n' "$PETCAM_DIR" "$sha"
```

#### 11.4.5 Wrapper binary

The installer must **not** symlink `bin/petcam.js` directly, because Termux does not provide `/usr/bin/env` and shebangs of the form `#!/usr/bin/env node` fail there. Instead it writes a small POSIX shell wrapper:

```sh
cat > "$PREFIX/bin/petcam" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec node "$PETCAM_DIR/bin/petcam.js" "\$@"
EOF
chmod 755 "$PREFIX/bin/petcam"
```

`bin/petcam.js` keeps `#!/usr/bin/env node` as its shebang so it remains runnable on non-Termux systems and via `node bin/petcam.js` everywhere. The wrapper is the only artifact that ends up on `PATH`.

The installer must also create `$PREFIX/bin` if missing (it never is on a real Termux, but be defensive).

#### 11.4.6 Post-install

- Run `petcam doctor` unless `PETCAM_NO_DOCTOR=1`. A non-zero doctor exit is **not** fatal — the installer prints the findings and continues.
- Unless `PETCAM_NO_SETUP=1`, prompt `"Run the setup wizard now? [Y/n]"` and exec `petcam setup` on yes.
- Always print the next-steps block:

```
✔ petcam 2.1.0 installed.

Next steps:
  petcam setup     – configure your bot token, chat ID, and camera
  petcam doctor    – re-check prerequisites at any time
  petcam photo     – capture and send a photo now
  petcam run       – start the auto-upload loop in the foreground
  petcam start     – run it as a background daemon

Settings live in ~/.petcam/settings.json (mode 0600).
To remove everything: petcam forget (settings) or uninstall.sh (the app).
```

### 11.5 `uninstall.sh` contract (frozen)

Same shebang, `set -euo pipefail`, same Termux detection, same stdin reattachment.

Steps:

1. Read `PETCAM_DIR` (default `$HOME/.local/share/petcam`) and `PETCAM_HOME` (default `$HOME/.petcam`).
2. Stop a running daemon if `$PETCAM_HOME/petcam.pid` exists and the process is alive.
3. `rm -f "$PREFIX/bin/petcam"`.
4. `rm -rf "$PETCAM_DIR"`.
5. Unless `PETCAM_PURGE=1`, prompt `"Also delete $PETCAM_HOME (settings, logs, cache)? [y/N]"` and only remove it on an explicit yes. With `PETCAM_PURGE=1`, remove it without prompting.
6. Print what was removed and note that the bot token has **not** been revoked on Telegram's side; include the exact @BotFather `/revoke` instruction.

Canonical invocation:

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/pet-cam-cli/main/uninstall.sh | bash
```

The installer must **never** be invoked by the uninstaller, and vice versa.

### 11.6 Autostart on boot

With the **Termux:Boot** addon installed, place an executable script at `~/.termux/boot/`:

```bash
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
petcam start
```

Because `petcam` is a wrapper on `PATH`, the boot script needs no absolute paths. Document this.

### 11.7 Updating

- Preferred: `petcam update` (git checkout only).
- Fallback: re-run the one-liner; it fast-forwards in place.
- Settings in `~/.petcam/` are never touched by either path.

### 11.8 Manual install (fallback, still supported)

```bash
git clone https://github.com/<user>/pet-cam-cli.git
cd pet-cam-cli
npm link                    # exposes `petcam` on PATH — no download, no build
# or, without npm link:
node bin/petcam.js setup
```

`package.json` must contain `"bin": { "petcam": "./bin/petcam.js" }` and `"type": "module"`. No `postinstall`, no dependencies.

---

## 12. Implementation tickets (ordered)

> **Contract freeze:** the subcommands in §6.1, the settings keys in §4.1, the module exports in §5, the installer env vars in §11.4, and the wrapper path `$PREFIX/bin/petcam` are the interfaces between tickets.

| # | Ticket | Files | Depends on | Done when |
|---|---|---|---|---|
| T1 | Scaffold: `package.json`, `bin/petcam.js` (shebang + dispatch stub), `src/config.js` with constants + helpers, `src/cli.js` with colors/prompts/spinner/table/log. | `package.json`, `bin/petcam.js`, `src/config.js`, `src/cli.js` | — | `petcam help` prints usage; `node --check` passes |
| T2 | Settings module with atomic write, mode 0600, `PETCAM_HOME` override, migration hook. | `src/settings.js` | T1 | Round-trip, missing file, corrupt JSON, clamping verified by hand |
| T3 | Telegram client + `TelegramError` + `withRetry`. | `src/telegram.js` | T1 | `petcam test` works with a real token |
| T4 | Termux wrappers: binaries probe, camera info, camera photo, wake lock, notifications, storage setup, ffmpeg detection. | `src/termux.js` | T1 | `petcam doctor` reports each binary correctly |
| T5 | Camera module: `listCameras`, `capturePhoto`, `postProcess`. | `src/camera.js` | T4 | A JPEG is captured and (with ffmpeg) resized |
| T6 | Video module: intent mode + burst mode + `extensionForMime`. | `src/video.js` | T5 | Both modes produce a file Telegram accepts |
| T7 | Scheduler. | `src/scheduler.js` | T1 | `onDue` fires at the correct wall-clock cadence; no burst after a slow `onDue` |
| T8 | Wake-lock module. | `src/wakelock.js` | T4 | `petcam run` acquires and releases the lock on Ctrl+C |
| T9 | Wiring: `setup`, `test`, `find-chat`, `config show/get/set`, `forget`, `status`. | `src/app.js` | T2, T3, T4 | QA 1–6, 12–13, 21–24 pass |
| T10 | Wiring: `photo` command, caption rendering, mutex, temp-file lifecycle. | `src/app.js` | T5, T9 | QA 7–9 pass |
| T11 | Wiring: `run` (foreground + daemon), `start`/`stop`, status line, PID file, signal handling. | `src/app.js` | T7, T8, T10 | QA 10–11, 17–20 pass |
| T12 | Wiring: `video` command with document fallback. | `src/app.js` | T6, T10 | QA 14–16 pass |
| T13 | `--json` mode, `doctor`, `NO_COLOR`, exit codes, README. | `src/app.js`, `src/cli.js`, `README.md` | T12 | QA 25, 27 pass; README covers install, boot, revocation, limitations |
| T14 | One-line installer and uninstaller: Termux detection, stdin reattachment, package bootstrap, tarball fallback, wrapper binary, doctor/setup hand-off, env-var plumbing. | `install.sh`, `uninstall.sh` | T4, T13 | QA 28–34 pass |
| T15 | `petcam version` and `petcam update`; README's one-line install section; wrapper-vs-shebang documentation. | `src/app.js`, `src/config.js`, `README.md` | T14 | QA 35–37 pass |

---

## 13. Reference snippets

### 13.1 Scheduler tick

```js
_tick() {
  if (this.nextAt === null) return;
  const now = Date.now();
  if (now < this.nextAt) return;
  const intervalMs = this.nextAt - this._prevAt;
  this._prevAt = now;
  this.nextAt = now + intervalMs;
  if (this._busy) { cli.log('warn', '[scheduler] skipped: busy'); return; }
  this._busy = true;
  Promise.resolve(this._onDue())
    .catch(err => console.error('[scheduler] onDue failed', err))
    .finally(() => { this._busy = false; });
}
```

### 13.2 Capturing a photo

```js
import { spawn } from 'node:child_process';

export async function termuxCameraPhoto({ cameraId, outPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = [];
    if (cameraId) args.push('-c', String(cameraId));
    args.push(outPath);
    const p = spawn('termux-camera-photo', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Camera capture timed out.')); }, timeoutMs);
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `termux-camera-photo exited ${code}`));
    });
  });
}
```

### 13.3 Sending a photo

```js
import { readFile } from 'node:fs/promises';

export async function sendPhoto({ chatId, filePath, caption, token }) {
  const buf = await readFile(filePath);
  const file = new File([buf], filePath.split('/').pop(), { type: 'image/jpeg' });
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('photo', file, file.name);
  if (caption) fd.append('caption', caption);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: fd
  });
  const json = await res.json();
  if (!json.ok) {
    throw new TelegramError(json.description, {
      code: json.error_code, retryAfter: json.parameters?.retry_after ?? 0
    });
  }
  return json.result;
}
```

### 13.4 Caption rendering

```js
export function renderCaption(template, now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return template
    .replaceAll('{datetime}', `${date} ${time}`)
    .replaceAll('{date}', date)
    .replaceAll('{time}', time)
    .slice(0, 1024);
}
```

### 13.5 Launching the system camera for video

```js
import { spawn } from 'node:child_process';

export async function amStartVideoCapture({ outUri, facing = 'back', withAudio = false }) {
  const args = [
    'start',
    '-a', 'android.media.action.VIDEO_CAPTURE',
    '-e', 'output', outUri,
    '--ez', 'android.intent.extras.VIDEO_CAPTURE_WITH_AUDIO', String(withAudio)
  ];
  if (facing === 'front') args.push('--ei', 'android.intent.extras.CAMERA_FACING', '1');
  else if (facing === 'back') args.push('--ei', 'android.intent.extras.CAMERA_FACING', '0');
  return new Promise((resolve, reject) => {
    const p = spawn('am', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `am exited ${code}`)));
  });
}
```

### 13.6 Daemonizing

```js
import { spawn } from 'node:child_process';
import { open, writeFile } from 'node:fs/promises';

const logFd = await open(LOG_PATH, 'a');
const child = spawn(process.execPath, [binPath, 'run'], {
  detached: true,
  stdio: ['ignore', logFd.fd, logFd.fd]
});
child.unref();
await writeFile(PID_PATH, String(child.pid), { mode: 0o600 });
console.log(`✔ Running as PID ${child.pid}. Logs: ${LOG_PATH}`);
```

### 13.7 Termux-safe wrapper creation

```sh
install_wrapper() {
  local dir="$1"
  mkdir -p "$PREFIX/bin"
  cat > "$PREFIX/bin/petcam" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec node "$dir/bin/petcam.js" "\$@"
EOF
  chmod 755 "$PREFIX/bin/petcam"
}
```

### 13.8 Non-interactive detection

```sh
is_interactive() {
  [[ -t 0 || -t 1 || -t 2 ]] && [[ -e /dev/tty ]]
}

ask_yes() {  # ask_yes "prompt" default(y/n)
  local prompt="$1" def="${2:-n}" reply
  if [[ "${PETCAM_YES:-0}" == 1 ]]; then return 0; fi
  if ! is_interactive; then [[ "$def" == y ]]; return; fi
  read -r -p "$prompt " reply </dev/tty
  reply="${reply:-$def}"
  [[ "${reply,,}" == y* ]]
}
```

### 13.9 Idempotent fetch

```sh
fetch_app() {
  if [[ -d "$PETCAM_DIR/.git" ]]; then
    git -C "$PETCAM_DIR" fetch --depth 1 origin "$PETCAM_BRANCH"
    git -C "$PETCAM_DIR" checkout -q FETCH_HEAD
  elif command -v git >/dev/null 2>&1; then
    rm -rf "$PETCAM_DIR"
    git clone --depth 1 --branch "$PETCAM_BRANCH" "$PETCAM_REPO" "$PETCAM_DIR"
  else
    mkdir -p "$PETCAM_DIR"
    curl -fsSL "$PETCAM_REPO/archive/refs/heads/$PETCAM_BRANCH.tar.gz" \
      | tar -xz -C "$PETCAM_DIR" --strip-components=1
  fi
}
```

---

## 14. Definition of Done

- All 37 QA scenarios in §10.1 pass on a real Android device with Termux, Termux:API, and (for the `ffmpeg`-dependent items) `ffmpeg` installed.
- `curl -fsSL <canonical-install-url> | bash` completes on a factory-fresh Termux with no manual pre-installation beyond the F-Droid Termux and Termux:API apps.
- The installer is idempotent and never mutates `~/.petcam`.
- `install.sh` contains exactly **zero** nested `curl | bash` invocations and exactly **two** remote fetches (the repo archive, or `git clone`; plus nothing else).
- `PETCAM_YES=1 PETCAM_NO_SETUP=1` yields a fully non-interactive install that exits 0 without a TTY.
- `uninstall.sh` removes the wrapper and the install dir and leaves `~/.petcam` intact unless `PETCAM_PURGE=1`.
- The README opens with the one-line install command and immediately below it the audited-install alternative (`curl -O`, inspect, `bash`).
- `petcam doctor` exits 0 on a correctly configured device.
- Every §6.1 subcommand exists and behaves as specified.
- `petcam version` and `petcam update` behave as specified; `APP_VERSION` in `src/config.js` equals `package.json`'s `"version"`.
- Settings survive across runs and are stored at mode 0600.
- `petcam forget` removes `~/.petcam` and nothing else.
- The daemon (`petcam start`) survives Termux being backgrounded for at least 30 minutes with the screen off, given a wake lock and battery optimization disabled.
- `sw.js` from v1.1 does not exist in this codebase; no browser code paths remain.
- No same-origin absolute paths exist anywhere in the source (`grep -rn 'from "/\|require("/' .` is empty).
- `package.json` declares `"type": "module"` and `"dependencies": {}`.
- `shellcheck install.sh uninstall.sh` reports no warnings.
- `README.md` covers: one-line install, audited install, one-time Termux setup (`pkg install nodejs termux-api`, optional `ffmpeg`, `termux-setup-storage`), Termux:API install from F-Droid, granting Camera permission, disabling battery optimization, `npm link` installation, the `petcam setup` wizard, every subcommand, autostart via Termux:Boot, updating (`petcam update` and the one-liner), uninstall, security warnings (plaintext token on disk, revocation via `/revoke`, `/deletewebhook` for 409), and the platform limitations (§1.4).
- No network requests to any host other than `https://api.telegram.org`.

---

## 15. Appendix — Telegram Bot API notes

| Method | Content type | Fields used |
|---|---|---|
| `getMe` | GET | — |
| `getUpdates` | GET | `offset`, `timeout=0`, `allowed_updates` |
| `sendPhoto` | multipart/form-data | `chat_id`, `photo`, `caption` |
| `sendVideo` | multipart/form-data | `chat_id`, `video`, `caption`, `duration`, `width`, `height`, `supports_streaming` |
| `sendDocument` | multipart/form-data | `chat_id`, `document`, `caption` |

- Success: `{ "ok": true, "result": { ... } }`
- Failure: `{ "ok": false, "error_code": 400, "description": "...", "parameters": { "retry_after": 5 } }`
- Bot upload limit: **50 MB** per file.
- Caption limit: **1024 characters**.
- `getUpdates` returns `409 Conflict` if a webhook is registered — the user must call `/deletewebhook` in @BotFather.
- Rate limits: ~30 messages/second globally, and no more than 20 messages per minute to the same group. The 15 s minimum interval keeps us safely under this.

---

## 16. Appendix — Termux API notes

| Binary | Used for | Fallback if unavailable |
|---|---|---|
| `termux-camera-photo` | Still photo capture | App exits with "termux-api is not installed. Run: pkg install termux-api" |
| `termux-camera-info` | Enumerating cameras and facing | Camera list is empty; user must set `camera.cameraId` manually |
| `termux-wake-lock` / `termux-wake-unlock` | Keeping the CPU alive while `petcam run` is active | `device.keepAwake` is a no-op; log a warning once |
| `termux-notification` | Optional status notifications | Silent no-op |
| `termux-toast` | Optional quick confirmations | Silent no-op |
| `termux-setup-storage` | Creating `~/storage/shared` for the video intent path | Video intent mode unavailable; burst mode still works |
| `am` (built-in) | Launching the system camera in video mode | Video intent mode unavailable; burst mode still works |
| `ffmpeg` / `ffprobe` | Resizing stills, encoding burst frames, probing durations | Stills are sent raw; burst mode unavailable |

**Wake-lock notes**
- `termux-wake-lock` acquires an Android `PARTIAL_WAKE_LOCK`: it keeps the CPU running so timers and network calls continue while the screen is off. It does **not** keep the screen on.
- Android may still kill the process if battery optimization is enabled for Termux or Termux:API. Document the "Disable battery optimization" step prominently.
- The lock is released automatically when the Termux process exits, but the app still calls `termux-wake-unlock` in its signal handler for cleanliness.

**Camera notes**
- `termux-camera-photo -c <id> <file>` writes a full-resolution JPEG. It has **no** size or quality flags — the only way to control output size is post-processing with `ffmpeg`.
- Capture latency on most Android devices is 1–4 seconds; `LIMITS.CAPTURE_TIMEOUT_MS` is set to 20 s to accommodate slow devices.
- The camera permission must be granted to the **Termux:API** app, not to Termux itself. `petcam doctor` checks this by attempting a capture and inspecting stderr.

**Termux shebang notes**
- Termux does **not** provide `/usr/bin/env`. Any file installed to `$PREFIX/bin` with a `#!/usr/bin/env node` shebang will fail with `env: not found`.
- The remedy is the wrapper in §11.4.5: a small `#!/data/data/com.termux/files/usr/bin/sh` script that `exec`s `node` on the real entry point.
- `bin/petcam.js` itself keeps `#!/usr/bin/env node` so the repo remains runnable on non-Termux systems and via `node bin/petcam.js`.

---

## 17. Appendix — Installer notes

**Why Bash 4+ and not `sh`**
- `${var,,}` (lowercase), `[[ ]]`, and `set -o pipefail` are all required. Termux's `sh` is `dash` and lacks them.
- The shebang points at the Termux Bash so that `bash install.sh` works even if the user's login shell is different.

**Why `exec </dev/tty` and not `< /dev/tty` on every prompt**
- It reattaches once, up front, and every later `read` inherits the terminal. Per-prompt redirection would work too, but the single `exec` also lets `pkg` prompts (should any appear) receive input.

**Why the installer never runs `termux-setup-storage`**
- That command raises an Android runtime-permission dialog. When invoked from a piped installer there is no reliable way to know when the user has dismissed it, and a blocked `read` would hang.
- `petcam setup` is interactive by design and can poll for the `~/storage/shared` directory to appear before continuing.

**Why the installer refuses to touch `~/.petcam`**
- A re-install must be safe. The one-way flow is: installer → `$PETCAM_DIR` and `$PREFIX/bin/petcam`; app → `~/.petcam`. Only `uninstall.sh` with `PETCAM_PURGE=1` or `petcam forget` may cross that boundary.

**Why two remote fetches and not three**
- The repo archive (or clone) is one logical fetch; the wrapper is generated locally from a heredoc. Keeping the count low makes the installer auditable and minimizes the supply-chain surface the user has to trust.