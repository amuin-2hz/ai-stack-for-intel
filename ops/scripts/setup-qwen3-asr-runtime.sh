#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_DIR="${BASE_DIR}/.venv/qwen3-asr"

python3 -m venv --system-site-packages "${VENV_DIR}"
"${VENV_DIR}/bin/python" -m pip install "qwen-asr==0.0.6" "websockets==16.0"
echo "Qwen3-ASR runtime ready: ${VENV_DIR}"
