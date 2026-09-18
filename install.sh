#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
# Termux detection (§11.4.1) — exit 3 if not Termux and PETCAM_FORCE!=1
# stdin reattach (§11.4.2) — exec </dev/tty; else non-interactive
# pkg update; pkg install nodejs termux-api git (§11.4.3)
# Optional ffmpeg prompt / PETCAM_WITH_FFMPEG / PETCAM_YES (§11.4)
# Fetch: git clone --depth 1 or tarball (§11.4.4)
# Wrapper at $PREFIX/bin/petcam (§11.4.5) — sh wrapper, NOT symlink
# Doctor skip with PETCAM_NO_DOCTOR; setup offer skip with PETCAM_NO_SETUP (§11.4.6)
# Env vars: PETCAM_REPO, PETCAM_BRANCH, PETCAM_DIR, PETCAM_HOME (§11.4 frozen)
# Canonical source: https://raw.githubusercontent.com/ozymand1as/tg_pet_cam_termux/refs/heads/master/install.sh
