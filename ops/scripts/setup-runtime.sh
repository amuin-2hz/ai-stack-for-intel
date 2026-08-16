#!/usr/bin/env bash
set -euo pipefail

WITH_TTS=0
if [[ "${1:-}" == "--with-tts" ]]; then
  WITH_TTS=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--with-tts]" >&2
  exit 2
fi

DATA_HOME="${AI_STACK_DATA_HOME:-${XDG_DATA_HOME:-${HOME}/.local/share}/amuin-ai-stack}"
VENV_DIR="${AI_STACK_RUNTIME_DIR:-${DATA_HOME}/runtime}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

mkdir -p "${DATA_HOME}"
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

PYTHON="${VENV_DIR}/bin/python"
"${PYTHON}" -m pip install --upgrade pip wheel "setuptools<82"
"${PYTHON}" -m pip install \
  "openvino==2026.2.1" \
  "openvino-genai==2026.2.1.0" \
  "openvino-tokenizers==2026.2.1.0" \
  "numpy<2" \
  "transformers==4.57.3" \
  "librosa==0.11.0" \
  "soundfile==0.14.0" \
  "pillow>=11,<13" \
  "websockets==16.0"

if [[ "${WITH_TTS}" -eq 1 ]]; then
  "${PYTHON}" -m pip install \
    --index-url https://download.pytorch.org/whl/cpu \
    "torch==2.11.0+cpu" \
    "torchaudio==2.11.0+cpu"
  "${PYTHON}" -m pip install "qwen-tts==0.1.1"
fi

"${PYTHON}" -c 'import openvino as ov; print("OpenVINO", ov.__version__); print("Devices", ov.Core().available_devices)'
"${PYTHON}" -m pip check
echo "Runtime ready: ${VENV_DIR}"
