#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
if [[ -z "${TERMUX_VERSION:-}" && "${PREFIX:-}" != /data/data/com.termux/files/usr ]]; then
  [[ "${PETCAM_FORCE:-0}" != 1 ]] && { echo "Not Termux. Exit 3." >&2; exit 3; }
fi
if [[ ! -t 0 ]]; then [[ -e /dev/tty && -t 1 ]] && exec </dev/tty || { export PETCAM_YES=1; export PETCAM_NO_SETUP=1; } ; fi
export DEBIAN_FRONTEND=noninteractive
pkg update -y; pkg install -y nodejs termux-api git
# ffmpeg optional prompt / env skipped for brevity — real prompt per PETCAM_WITH_FFMPEG
mkdir -p "${PETCAM_DIR:-$HOME/.local/share/petcam}"
# fetch: git clone (simplified) — real idempotent fetch requires full logic
# wrapper: $PREFIX/bin/petcam heredoc
mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/petcam" <<'W'
#!/data/data/com.termux/files/usr/bin/sh
exec node "$PETCAM_DIR/bin/petcam.js" "$@"
W
chmod 755 "$PREFIX/bin/petcam"
echo "Installed petcam wrapper to $PREFIX/bin/petcam"
