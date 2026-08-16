#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PKG_NAME="amuin-ai-stack"
VERSION="$(node -p "require('./package.json').version")"
ARCH="amd64"
DEB_NAME="${PKG_NAME}_${VERSION}_${ARCH}.deb"
BUILD_ROOT="dist-deb/${PKG_NAME}_${VERSION}_${ARCH}"
APP_DIR="${BUILD_ROOT}/opt/${PKG_NAME}"
BIN_DIR="${BUILD_ROOT}/usr/bin"
DESKTOP_DIR="${BUILD_ROOT}/usr/share/applications"
PIXMAP_DIR="${BUILD_ROOT}/usr/share/pixmaps"
DOC_DIR="${BUILD_ROOT}/usr/share/doc/${PKG_NAME}"

printf '%s\n' "=== Building TypeScript/Vite assets ==="
npm run build

printf '%s\n' "=== Preparing package tree ==="
rm -rf "$BUILD_ROOT"
mkdir -p \
  "$APP_DIR/src/main" \
  "$APP_DIR/src/api" \
  "$APP_DIR/src/frontend" \
  "$APP_DIR/src/inference" \
  "$APP_DIR/configs" \
  "$APP_DIR/LICENSES" \
  "$APP_DIR/ops" \
  "$BIN_DIR" \
  "$DESKTOP_DIR" \
  "$PIXMAP_DIR" \
  "$DOC_DIR" \
  "$BUILD_ROOT/DEBIAN"

cp -a package.json README.md RELEASE_NOTES.md LICENSE THIRD_PARTY_NOTICES.md "$APP_DIR/"
cp -a configs/. "$APP_DIR/configs/"
cp -a LICENSES/. "$APP_DIR/LICENSES/"
rm -f "$APP_DIR/configs/proxy.env"
cp -a ops/. "$APP_DIR/ops/"
cp -a src/main/dist "$APP_DIR/src/main/"
cp -a src/api/dist src/api/package.json "$APP_DIR/src/api/"
cp -a src/api/node_modules "$APP_DIR/src/api/"
cp -a src/frontend/dist "$APP_DIR/src/frontend/"
cp -a src/inference/. "$APP_DIR/src/inference/"
cp -a node_modules "$APP_DIR/"
install -m 0644 LICENSE "$DOC_DIR/copyright"
install -m 0644 RELEASE_NOTES.md "$DOC_DIR/RELEASE_NOTES.md"
install -m 0644 THIRD_PARTY_NOTICES.md "$DOC_DIR/THIRD_PARTY_NOTICES.md"
install -m 0644 LICENSES/Apache-2.0.txt "$DOC_DIR/Apache-2.0.txt"
install -m 0644 src/frontend/public/brand/logo-au.png "$PIXMAP_DIR/${PKG_NAME}.png"

printf '%s\n' "=== Pruning build-only dependencies ==="
rm -rf \
  "$APP_DIR/node_modules/.vite" \
  "$APP_DIR/node_modules/@types" \
  "$APP_DIR/node_modules/typescript" \
  "$APP_DIR/node_modules/.bin/tsc" \
  "$APP_DIR/node_modules/.bin/tsserver" \
  "$APP_DIR/src/api/node_modules/@types" \
  "$APP_DIR/src/api/node_modules/@esbuild" \
  "$APP_DIR/src/api/node_modules/esbuild" \
  "$APP_DIR/src/api/node_modules/tsx" \
  "$APP_DIR/src/api/node_modules/typescript" \
  "$APP_DIR/src/api/node_modules/.bin/esbuild" \
  "$APP_DIR/src/api/node_modules/.bin/tsx" \
  "$APP_DIR/src/api/node_modules/.bin/tsc" \
  "$APP_DIR/src/api/node_modules/.bin/tsserver"

find "$APP_DIR" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$APP_DIR" -type d -exec chmod 0755 {} +
find "$APP_DIR" -type f -exec chmod 0644 {} +
find "$APP_DIR/ops/scripts" -type f -name "*.sh" -exec chmod 0755 {} +
chmod 0755 \
  "$APP_DIR/node_modules/electron/cli.js" \
  "$APP_DIR/node_modules/electron/dist/electron"
chmod 4755 "$APP_DIR/node_modules/electron/dist/chrome-sandbox"

cat > "${BIN_DIR}/${PKG_NAME}" <<'LAUNCHER'
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
chmod 0755 "${BIN_DIR}/${PKG_NAME}"

cat > "${DESKTOP_DIR}/${PKG_NAME}.desktop" <<DESKTOP
[Desktop Entry]
Name=Amuin AI Stack
Comment=Local AI Stack for Linux Intel
Exec=${PKG_NAME}
Icon=${PKG_NAME}
Terminal=false
Type=Application
Categories=Utility;Development;
StartupNotify=true
DESKTOP
chmod 0644 "${DESKTOP_DIR}/${PKG_NAME}.desktop"

INSTALLED_SIZE="$(du -sk "$BUILD_ROOT" | awk '{print $1}')"
cat > "${BUILD_ROOT}/DEBIAN/control" <<CONTROL
Package: ${PKG_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: Amuin <opensource@amuin.ai>
Installed-Size: ${INSTALLED_SIZE}
Depends: python3 (>= 3.10), python3-venv, nodejs (>= 18), ffmpeg, sox, libgtk-3-0, libnss3, libxss1, libgbm1, libdrm2, libatk-bridge2.0-0, libxkbcommon0, libxcomposite1, libxdamage1, libxrandr2, libasound2 | libasound2t64
Description: Local AI desktop stack for Linux Intel
 Desktop model manager, OpenAI-compatible API, and Python OpenVINO
 inference launchers for Intel CPU, GPU, and NPU devices.
CONTROL
chmod 0644 "${BUILD_ROOT}/DEBIAN/control"
find "$BUILD_ROOT" -type d -exec chmod 0755 {} +

printf '%s\n' "=== Building .deb ==="
mkdir -p dist-deb
dpkg-deb --root-owner-group --build "$BUILD_ROOT" "dist-deb/$DEB_NAME"
(
  cd dist-deb
  sha256sum "$DEB_NAME" > SHA256SUMS
  chmod 0644 SHA256SUMS
)
install -m 0644 RELEASE_NOTES.md dist-deb/RELEASE_NOTES.md

printf '%s\n' "=== Release artifacts ==="
ls -lh "dist-deb/$DEB_NAME" dist-deb/SHA256SUMS dist-deb/RELEASE_NOTES.md
