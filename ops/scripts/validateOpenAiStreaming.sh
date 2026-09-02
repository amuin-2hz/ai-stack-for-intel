#!/usr/bin/env bash
# Author: zhenz

set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:39110}"
MODEL_NAME="${2:-qwen3.5-2b-fp16-ov}"
RUNTIME_PYTHON="${RUNTIME_PYTHON:-${HOME}/.local/share/amuin-ai-stack/runtime/bin/python}"

# Ensure the runtime Python exists before starting validation.
function checkRuntimePython() {
  if [[ ! -x "${RUNTIME_PYTHON}" ]]; then
    echo "Runtime python not found: ${RUNTIME_PYTHON}" >&2
    exit 1
  fi
}

# Measure first token timing and DONE timing for a short streaming request.
function runShortStreamProbe() {
  "${RUNTIME_PYTHON}" - <<'PY' "${BASE_URL}" "${MODEL_NAME}"
import json
import sys
import time
import requests

base_url = sys.argv[1]
model_name = sys.argv[2]
start = time.monotonic()
first_delta_ms = None
finish_ms = None
received = []

with requests.post(
    f"{base_url}/v1/chat/completions",
    json={
        "model": model_name,
        "messages": [{"role": "user", "content": "只输出OK"}],
        "stream": True,
        "max_tokens": 4,
        "temperature": 0,
    },
    stream=True,
    timeout=(30, 120),
) as response:
    response.raise_for_status()
    for raw_line in response.iter_lines(chunk_size=1, decode_unicode=True):
        if not raw_line or not raw_line.startswith("data: "):
            continue
        data = raw_line[6:]
        now_ms = (time.monotonic() - start) * 1000
        if data == "[DONE]":
            finish_ms = now_ms
            break
        event = json.loads(data)
        content = event.get("choices", [{}])[0].get("delta", {}).get("content")
        if content:
          received.append(content)
          if first_delta_ms is None:
              first_delta_ms = now_ms

print(json.dumps({
    "probe": "shortStream",
    "firstDeltaMs": round(first_delta_ms or -1, 1),
    "finishMs": round(finish_ms or -1, 1),
    "text": "".join(received),
}, ensure_ascii=False))
PY
}

# Measure realistic first token timing, then cancel after a few chunks.
function runCancelProbe() {
  "${RUNTIME_PYTHON}" - <<'PY' "${BASE_URL}" "${MODEL_NAME}"
import json
import sys
import time
import requests

base_url = sys.argv[1]
model_name = sys.argv[2]
start = time.monotonic()
first_delta_ms = None
received = []
cancel_ms = None

with requests.post(
    f"{base_url}/v1/chat/completions",
    json={
        "model": model_name,
        "messages": [{"role": "user", "content": "请用一句中文介绍OpenVINO。"}],
        "stream": True,
        "max_tokens": 32,
        "temperature": 0,
    },
    stream=True,
    timeout=(30, 120),
) as response:
    response.raise_for_status()
    for raw_line in response.iter_lines(chunk_size=1, decode_unicode=True):
        if not raw_line or not raw_line.startswith("data: "):
            continue
        data = raw_line[6:]
        if data == "[DONE]":
            break
        event = json.loads(data)
        content = event.get("choices", [{}])[0].get("delta", {}).get("content")
        if content:
            received.append(content)
            if first_delta_ms is None:
                first_delta_ms = (time.monotonic() - start) * 1000
            if len(received) >= 3:
                cancel_ms = (time.monotonic() - start) * 1000
                break
    response.close()

print(json.dumps({
    "probe": "cancelStream",
    "firstDeltaMs": round(first_delta_ms or -1, 1),
    "cancelAfterMs": round(cancel_ms or -1, 1),
    "tokenChunks": len(received),
    "partialText": "".join(received),
}, ensure_ascii=False))
PY
}

checkRuntimePython
runShortStreamProbe
runCancelProbe
