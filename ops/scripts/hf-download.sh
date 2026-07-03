#!/usr/bin/env bash
set -euo pipefail
REPO_ID="${1:?repo id is required}"
ALIAS="${2:-$(basename "$REPO_ID")}"
BASE_DIR="${AI_STACK_BASE:-$(pwd)}"
TARGET_DIR="${BASE_DIR}/models/${ALIAS}"
TEMP_DIR="${TARGET_DIR}/.temp"

mkdir -p "$TEMP_DIR"

echo "[huggingface] repo=${REPO_ID}"
echo "[huggingface] target=${TARGET_DIR}"

if command -v huggingface-cli >/dev/null 2>&1; then
  huggingface-cli download "$REPO_ID" --local-dir "$TEMP_DIR" --local-dir-use-symlinks False
elif command -v hf >/dev/null 2>&1; then
  hf download "$REPO_ID" --local-dir "$TEMP_DIR"
elif python3 - <<'PY_CHECK' >/dev/null 2>&1
import huggingface_hub
PY_CHECK
then
  python3 - "$REPO_ID" "$TEMP_DIR" <<'PY_DOWNLOAD'
import sys
from huggingface_hub import snapshot_download
repo_id, target = sys.argv[1], sys.argv[2]
snapshot_download(repo_id=repo_id, local_dir=target, local_dir_use_symlinks=False)
PY_DOWNLOAD
else
  echo "Hugging Face download requires huggingface-cli, hf, or huggingface_hub." >&2
  exit 127
fi

mkdir -p "$TARGET_DIR"
shopt -s dotglob nullglob
for item in "$TEMP_DIR"/*; do
  mv "$item" "$TARGET_DIR/"
done
rmdir "$TEMP_DIR" 2>/dev/null || true

echo "[huggingface] download complete: ${TARGET_DIR}"
