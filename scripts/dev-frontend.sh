#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8000}"
export FRONTEND_PORT="${FRONTEND_PORT:-58888}"
cd "${BASE_DIR}/src/frontend"
exec npm run dev
