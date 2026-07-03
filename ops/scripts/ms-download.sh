#!/usr/bin/env bash
set -euo pipefail
REPO_ID="${1:?repo id is required}"
ALIAS="${2:-$(basename "$REPO_ID")}"
BASE_DIR="${AI_STACK_BASE:-$(pwd)}"
TARGET_DIR="${BASE_DIR}/models/${ALIAS}"
TEMP_DIR="${TARGET_DIR}/.temp"

mkdir -p "$TEMP_DIR"

echo "[modelscope] repo=${REPO_ID}"
echo "[modelscope] target=${TARGET_DIR}"

if command -v modelscope >/dev/null 2>&1; then
  modelscope download --model "$REPO_ID" --local_dir "$TEMP_DIR"
elif python3 - <<'PY_CHECK' >/dev/null 2>&1
import modelscope
PY_CHECK
then
  python3 - "$REPO_ID" "$TEMP_DIR" <<'PY_DOWNLOAD'
import sys
from modelscope import snapshot_download
repo_id, target = sys.argv[1], sys.argv[2]
snapshot_download(repo_id, local_dir=target)
PY_DOWNLOAD
elif command -v git >/dev/null 2>&1; then
  git clone "https://www.modelscope.cn/${REPO_ID}.git" "$TEMP_DIR/repo"
  shopt -s dotglob
  mv "$TEMP_DIR/repo"/* "$TEMP_DIR/"
  rmdir "$TEMP_DIR/repo"
else
  echo "ModelScope download requires modelscope CLI/Python package or git." >&2
  exit 127
fi

mkdir -p "$TARGET_DIR"
shopt -s dotglob nullglob
for item in "$TEMP_DIR"/*; do
  mv "$item" "$TARGET_DIR/"
done
rmdir "$TEMP_DIR" 2>/dev/null || true

echo "[modelscope] download complete: ${TARGET_DIR}"
