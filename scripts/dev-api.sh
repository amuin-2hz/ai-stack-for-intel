#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AI_STACK_BASE="${AI_STACK_BASE:-${BASE_DIR}}"
export MODELS_ROOT="${MODELS_ROOT:-${BASE_DIR}/models}"
export STATE_ROOT="${STATE_ROOT:-${BASE_DIR}/state}"
export LOGS_ROOT="${LOGS_ROOT:-${BASE_DIR}/logs}"
export UPLOADS_ROOT="${UPLOADS_ROOT:-${BASE_DIR}/state/uploads}"
export AUDIO_SERVICE_URL="${AUDIO_SERVICE_URL:-http://127.0.0.1:32000}"
export AUDIO_SERVICE_WS_URL="${AUDIO_SERVICE_WS_URL:-ws://127.0.0.1:32000/ws/realtime}"
export PORT="${PORT:-8000}"
mkdir -p "${MODELS_ROOT}" "${STATE_ROOT}" "${LOGS_ROOT}" "${UPLOADS_ROOT}"
cd "${BASE_DIR}/src/api"
exec npx tsx src/server.ts
