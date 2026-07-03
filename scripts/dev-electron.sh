#!/usr/bin/env bash
# ── Smart dev launcher ────────────────────────────────────────────────────────
# - With physical display: launches full Electron app
# - Without display (SSH/remote): starts API + Vite only, for browser access
#   from your local machine via http://<remote-host>:8888
#
# Override with: DISPLAY_MODE=electron | web | xvfb
#   xvfb = force Electron inside a virtual framebuffer (Xvfb)
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${DISPLAY_MODE:-auto}"
API_PORT="${API_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-58888}"

# ── Helpers ─────────────────────────────────────────────────────────────────

has_display() {
  if [[ -n "${DISPLAY:-}" ]] && xdpyinfo -display "$DISPLAY" &>/dev/null; then
    return 0
  fi
  return 1
}

start_xvfb() {
  local disp="${XVFB_DISPLAY:-:99}"
  if ! command -v Xvfb &>/dev/null; then
    echo "[xvfb] Xvfb not installed. Run: sudo apt install xvfb"
    return 1
  fi
  Xvfb "$disp" -screen 0 1920x1080x24 -ac +extension GLX +render &
  XVFB_PID=$!
  local waited=0
  while [[ $waited -lt 10 ]]; do
    if xdpyinfo -display "$disp" &>/dev/null; then break; fi
    sleep 0.3
    waited=$((waited + 1))
  done
  export DISPLAY="$disp"
  echo "[xvfb] Started virtual display on $disp (pid=$XVFB_PID)"
  return 0
}

stop_xvfb() {
  if [[ -n "${XVFB_PID:-}" ]] && kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "[xvfb] Stopping Xvfb (pid=$XVFB_PID)"
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
}

launch_web() {
  echo "══════════════════════════════════════════════════════════"
  echo "  Web dev mode — open in your local browser:"
  echo "  Frontend : http://127.0.0.1:${FRONTEND_PORT}"
  echo "  API      : http://127.0.0.1:${API_PORT}"
  echo "══════════════════════════════════════════════════════════"
  echo ""

  # Trap cleanup on exit
  trap 'kill 0' EXIT INT TERM

  # Start API
  "${BASE_DIR}/scripts/dev-api.sh" &
  API_PID=$!

  # Start frontend (Vite)
  "${BASE_DIR}/scripts/dev-frontend.sh" &
  FRONTEND_PID=$!

  echo "[web] API pid=${API_PID}  |  Vite pid=${FRONTEND_PID}"
  echo "[web] Press Ctrl+C to stop all servers"
  wait -n "${API_PID}" "${FRONTEND_PID}" || true
}

launch_electron() {
  trap stop_xvfb EXIT INT TERM

  echo "[build] Compiling main process..."
  cd "$BASE_DIR"
  npx tsc -p src/main/tsconfig.json

  ELECTRON_FLAGS=("--no-sandbox")
  if [[ "${XVFB_DISPLAY:-}" != "" ]] || [[ "$MODE" == "xvfb" ]]; then
    # Virtual display — disable GPU compositing for stability
    ELECTRON_FLAGS+=("--disable-gpu" "--disable-software-rasterizer")
  fi

  echo "[electron] Launching on DISPLAY=$DISPLAY"
  exec npx electron . "${ELECTRON_FLAGS[@]}"
}

# ── Main ────────────────────────────────────────────────────────────────────

cd "$BASE_DIR"

case "$MODE" in
  web)
    launch_web
    ;;
  electron)
    if ! has_display; then
      echo "[electron] No display found — starting Xvfb..."
      start_xvfb || { echo "[electron] Xvfb failed, falling back to web mode"; launch_web; exit 0; }
    fi
    launch_electron
    ;;
  xvfb)
    start_xvfb || { echo "[xvfb] Failed — falling back to web mode"; launch_web; exit 0; }
    launch_electron
    ;;
  auto)
    if has_display; then
      echo "[auto] Display found — launching Electron"
      launch_electron
    else
      echo "[auto] No display (SSH/remote) — launching web mode"
      launch_web
    fi
    ;;
esac
