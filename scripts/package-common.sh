#!/usr/bin/env bash

package_build_assets() {
  if [[ "${AI_STACK_SKIP_BUILD:-0}" == "1" ]]; then
    return
  fi
  printf '%s\n' "=== Building TypeScript/Vite assets ==="
  npm run build
}

package_prepare_tree() {
  local build_root="$1"
  local pkg_name="$2"
  local app_dir="${build_root}/opt/${pkg_name}"
  local bin_dir="${build_root}/usr/bin"
  local desktop_dir="${build_root}/usr/share/applications"
  local pixmap_dir="${build_root}/usr/share/pixmaps"
  local doc_dir="${build_root}/usr/share/doc/${pkg_name}"

  printf '%s\n' "=== Preparing package tree ==="
  rm -rf "$build_root"
  mkdir -p \
    "$app_dir/src/main" \
    "$app_dir/src/api" \
    "$app_dir/src/frontend" \
    "$app_dir/src/inference" \
    "$app_dir/configs" \
    "$app_dir/LICENSES" \
    "$app_dir/ops" \
    "$bin_dir" \
    "$desktop_dir" \
    "$pixmap_dir" \
    "$doc_dir"

  cp -a package.json README.md RELEASE_NOTES.md LICENSE THIRD_PARTY_NOTICES.md "$app_dir/"
  cp -a configs/. "$app_dir/configs/"
  cp -a LICENSES/. "$app_dir/LICENSES/"
  rm -f "$app_dir/configs/proxy.env"
  cp -a ops/. "$app_dir/ops/"
  cp -a src/main/dist "$app_dir/src/main/"
  cp -a src/api/dist src/api/package.json "$app_dir/src/api/"
  cp -a src/api/node_modules "$app_dir/src/api/"
  cp -a src/frontend/dist "$app_dir/src/frontend/"
  cp -a src/inference/. "$app_dir/src/inference/"
  cp -a node_modules "$app_dir/"
  install -m 0644 LICENSE "$doc_dir/copyright"
  install -m 0644 RELEASE_NOTES.md "$doc_dir/RELEASE_NOTES.md"
  install -m 0644 THIRD_PARTY_NOTICES.md "$doc_dir/THIRD_PARTY_NOTICES.md"
  install -m 0644 LICENSES/Apache-2.0.txt "$doc_dir/Apache-2.0.txt"
  install -m 0644 src/frontend/public/brand/logo-au.png "$pixmap_dir/${pkg_name}.png"

  printf '%s\n' "=== Pruning build-only dependencies ==="
  rm -rf \
    "$app_dir/node_modules/.vite" \
    "$app_dir/node_modules/@types" \
    "$app_dir/node_modules/typescript" \
    "$app_dir/node_modules/.bin/tsc" \
    "$app_dir/node_modules/.bin/tsserver" \
    "$app_dir/src/api/node_modules/@types" \
    "$app_dir/src/api/node_modules/@esbuild" \
    "$app_dir/src/api/node_modules/esbuild" \
    "$app_dir/src/api/node_modules/tsx" \
    "$app_dir/src/api/node_modules/typescript" \
    "$app_dir/src/api/node_modules/.bin/esbuild" \
    "$app_dir/src/api/node_modules/.bin/tsx" \
    "$app_dir/src/api/node_modules/.bin/tsc" \
    "$app_dir/src/api/node_modules/.bin/tsserver"

  find "$app_dir" -type d -name __pycache__ -prune -exec rm -rf {} +
  find "$app_dir" -type d -exec chmod 0755 {} +
  find "$app_dir" -type f -exec chmod 0644 {} +
  find "$app_dir/ops/scripts" -type f -name "*.sh" -exec chmod 0755 {} +
  chmod 0755 \
    "$app_dir/node_modules/electron/cli.js" \
    "$app_dir/node_modules/electron/dist/electron"
  chmod 4755 "$app_dir/node_modules/electron/dist/chrome-sandbox"

  cat > "${bin_dir}/${pkg_name}" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/amuin-ai-stack"
DATA_HOME="${AI_STACK_DATA_HOME:-${XDG_DATA_HOME:-${HOME}/.local/share}/amuin-ai-stack}"
RUNTIME_DIR="${AI_STACK_RUNTIME_DIR:-${DATA_HOME}/runtime}"
mkdir -p "${DATA_HOME}/models" "${DATA_HOME}/state" "${DATA_HOME}/logs"
export AI_STACK_PRODUCTION=1
export AI_STACK_BASE="$APP_DIR"
export AI_STACK_DATA_HOME="$DATA_HOME"
export MODELS_ROOT="${MODELS_ROOT:-$DATA_HOME/models}"
export STATE_ROOT="${STATE_ROOT:-$DATA_HOME/state}"
export LOGS_ROOT="${LOGS_ROOT:-$DATA_HOME/logs}"
export QWEN3_ASR_PYTHON="${QWEN3_ASR_PYTHON:-$DATA_HOME/qwen3-asr/bin/python}"
if [[ -x "$RUNTIME_DIR/bin/python3" ]]; then
  export PATH="$RUNTIME_DIR/bin:$PATH"
fi
exec "$APP_DIR/node_modules/.bin/electron" "$APP_DIR" "$@"
LAUNCHER
  chmod 0755 "${bin_dir}/${pkg_name}"

  cat > "${desktop_dir}/${pkg_name}.desktop" <<DESKTOP
[Desktop Entry]
Name=Amuin AI Stack
Comment=Local AI Stack for Linux Intel
Exec=${pkg_name}
Icon=${pkg_name}
Terminal=false
Type=Application
Categories=Utility;Development;
StartupNotify=true
DESKTOP
  chmod 0644 "${desktop_dir}/${pkg_name}.desktop"
}
