#!/usr/bin/env bash
set -euo pipefail

DATA_HOME="${AI_STACK_DATA_HOME:-${XDG_DATA_HOME:-${HOME}/.local/share}/amuin-ai-stack}"
VENV_DIR="${QWEN3_ASR_VENV:-${DATA_HOME}/qwen3-asr}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

mkdir -p "${DATA_HOME}"
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

PYTHON="${VENV_DIR}/bin/python"
"${PYTHON}" -m pip install --upgrade pip wheel "setuptools<82"
"${PYTHON}" -m pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.11.0+cpu" "torchaudio==2.11.0+cpu"
"${PYTHON}" -m pip install \
  "openvino==2026.2.1" \
  "openvino-genai==2026.2.1.0" \
  "openvino-tokenizers==2026.2.1.0" \
  "numpy<2" \
  "transformers==4.57.6" \
  "qwen-asr==0.0.6" \
  "websockets==16.0" \
  "librosa==0.11.0" \
  "soundfile==0.14.0"

"${PYTHON}" -c 'import openvino as ov, qwen_asr; print("OpenVINO", ov.__version__); print("Devices", ov.Core().available_devices)'
"${PYTHON}" -m pip check
echo "Qwen3-ASR runtime ready: ${VENV_DIR}"
