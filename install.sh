#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
if [[ -z "${TERMUX_VERSION:-}" && "${PREFIX:-}" != /data/data/com.termux/files/usr ]]; then
  [[ "${PETCAM_FORCE:-0}" != 1 ]] && { echo "Not Termux. Exit 3." >&2; exit 3; }
fi
if [[ ! -t 0 ]]; then [[ -e /dev/tty && -t 1 ]] && exec </dev/tty || { export PETCAM_YES=1; export PETCAM_NO_SETUP=1; } ; fi
export DEBIAN_FRONTEND=noninteractive
pkg update -y; pkg install -y nodejs termux-api git

# Check / install each dependency individually via Termux pkg
for dep in nodejs termux-api git; do
  if ! command -v "$dep" >/dev/null 2>&1 && ! (pkg list-installed 2>/dev/null | grep -q "$dep"); then
    echo "Installing missing dependency: $dep"; pkg install -y "$dep"
  else
    echo "Dependency OK: $dep"
  fi
done
# ffmpeg optional prompt / env skipped for brevity — real prompt per PETCAM_WITH_FFMPEG

# Resolve target dir once; empty/unset -> default. No nested :- inside :- (it is literal).
PETCAM_DIR="${PETCAM_DIR:-$HOME/.local/share/petcam}"
if [[ -z "$PETCAM_DIR" ]]; then echo "PETCAM_DIR resolved empty; aborting." >&2; exit 1; fi
export PETCAM_DIR
REPO_URL="https://github.com/ozymand1as/tg_pet_cam_termux"

# Fetch: idempotent clone/pull so files exist at $PETCAM_DIR regardless of caller cwd.
if [[ -f "$(pwd)/bin/petcam.js" ]]; then
  # Running from the repo checkout: use it directly
  cp -r "$(pwd)/src" "$PETCAM_DIR/"
  mkdir -p "$PETCAM_DIR/bin"
  cp "$(pwd)/bin/petcam.js" "$PETCAM_DIR/bin/petcam.js"
elif [[ -d "$PETCAM_DIR/.git" ]]; then
  git -C "$PETCAM_DIR" pull --ff-only || echo "pull failed; keeping existing checkout"
elif [[ -f "$PETCAM_DIR/bin/petcam.js" ]]; then
  echo "PETCAM_DIR populated (no git metadata); leaving as-is"
else
  rm -rf "$PETCAM_DIR" 2>/dev/null || true
  git clone --depth 1 "$REPO_URL" "$PETCAM_DIR"
fi

# Verify entry point exists before wiring the wrapper
[[ -f "$PETCAM_DIR/bin/petcam.js" ]] || { echo "Install failed: $PETCAM_DIR/bin/petcam.js missing after fetch." >&2; exit 1; }

# wrapper: $PREFIX/bin/petcam
mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/petcam" <<'W'
#!/data/data/com.termux/files/usr/bin/sh
PETCAM_DIR="${PETCAM_DIR:-$HOME/.local/share/petcam}"
if [ ! -f "$PETCAM_DIR/bin/petcam.js" ]; then
  echo "petcam: entry $PETCAM_DIR/bin/petcam.js not found." >&2
  echo "petcam: run the install script again (or set PETCAM_DIR correctly)." >&2
  exit 1
fi
exec node "$PETCAM_DIR/bin/petcam.js" "$@"
W
chmod 755 "$PREFIX/bin/petcam"
echo "Installed petcam wrapper to $PREFIX/bin/petcam (data: $PETCAM_DIR)"
