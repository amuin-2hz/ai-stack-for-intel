#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Start API and frontend as background jobs in same process group
"${BASE_DIR}/scripts/dev-api.sh" &
api_pid=$!
"${BASE_DIR}/scripts/dev-frontend.sh" &
frontend_pid=$!

# Cleanup: kill direct children first, then terminate whole process group
cleanup() {
  # Kill direct children with SIGTERM
  kill "${api_pid}" "${frontend_pid}" 2>/dev/null || true
  # Wait up to 3s for graceful shutdown
  for i in $(seq 1 6); do
    if ! kill -0 "${api_pid}" 2>/dev/null && ! kill -0 "${frontend_pid}" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  # Force-kill remaining (includes Python engines spawned by Node)
  kill -9 "${api_pid}" "${frontend_pid}" 2>/dev/null || true
  # Also kill any leftover Python inference processes on engine ports
  for port in 31000 31001 31002 31003 31004 31005; do
    local pid
    pid=$(ss -tlnp 2>/dev/null | grep ":${port}" | grep -oP 'pid=\K\d+' | head -1) || true
    if [ -n "${pid}" ] && [ "${pid}" -gt 1 ]; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo ""
echo "══════════════════════════════════════════════"
echo "  Web dev mode"
echo "  Frontend : http://127.0.0.1:${FRONTEND_PORT:-58888}"
echo "  API      : http://127.0.0.1:${PORT:-8000}"
echo "  Press Ctrl+C to stop"
echo "══════════════════════════════════════════════"
echo ""

# Wait for either child to exit
wait -n "${api_pid}" "${frontend_pid}" 2>/dev/null || true
cleanup
wait 2>/dev/null || true
