#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PKG_NAME="amuin-ai-stack"
VERSION="$(node -p "require('./package.json').version")"
ARCH="amd64"
BUILD_ROOT="dist-deb/${PKG_NAME}_${VERSION}_${ARCH}"
APP_DIR="${BUILD_ROOT}/opt/${PKG_NAME}"
BIN_DIR="${BUILD_ROOT}/usr/bin"
DESKTOP_DIR="${BUILD_ROOT}/usr/share/applications"

echo "=== Building TypeScript/Vite assets ==="
npm run build

echo "=== Preparing package tree ==="
rm -rf "$BUILD_ROOT"
mkdir -p   "$APP_DIR/src/main"   "$APP_DIR/src/api"   "$APP_DIR/src/frontend"   "$APP_DIR/src/inference"   "$APP_DIR/configs"   "$APP_DIR/ops"   "$APP_DIR/models"   "$APP_DIR/logs"   "$APP_DIR/state"   "$BIN_DIR"   "$DESKTOP_DIR"   "$BUILD_ROOT/DEBIAN"

cp -a package.json README.md "$APP_DIR/"
cp -a configs/. "$APP_DIR/configs/"
cp -a ops/. "$APP_DIR/ops/"
cp -a src/main/dist "$APP_DIR/src/main/"
cp -a src/api/dist src/api/package.json "$APP_DIR/src/api/"
cp -a src/api/node_modules "$APP_DIR/src/api/"
cp -a src/frontend/dist "$APP_DIR/src/frontend/"
cp -a src/inference/. "$APP_DIR/src/inference/"
cp -a node_modules "$APP_DIR/"

find "$APP_DIR" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$APP_DIR" -type d -exec chmod 0755 {} +
find "$APP_DIR" -type f -exec chmod 0644 {} +
find "$APP_DIR/ops/scripts" -type f -name "*.sh" -exec chmod 0755 {} +

cat > "${BIN_DIR}/${PKG_NAME}" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/amuin-ai-stack"
export AI_STACK_PRODUCTION=1
export AI_STACK_BASE="$APP_DIR"
export MODELS_ROOT="${MODELS_ROOT:-$APP_DIR/models}"
export STATE_ROOT="${STATE_ROOT:-$APP_DIR/state}"
export LOGS_ROOT="${LOGS_ROOT:-$APP_DIR/logs}"
exec "$APP_DIR/node_modules/.bin/electron" "$APP_DIR" --no-sandbox "$@"
LAUNCHER
chmod 0755 "${BIN_DIR}/${PKG_NAME}"

cat > "${DESKTOP_DIR}/${PKG_NAME}.desktop" <<'DESKTOP'
[Desktop Entry]
Name=Amuin AI Stack
Comment=Local AI Stack for Linux Intel
Exec=amuin-ai-stack
Terminal=false
Type=Application
Categories=Utility;Development;
DESKTOP

cat > "${BUILD_ROOT}/DEBIAN/postinst" <<'POSTINST'
#!/usr/bin/env bash
set -e
mkdir -p /opt/amuin-ai-stack/models /opt/amuin-ai-stack/logs /opt/amuin-ai-stack/state
chmod 0777 /opt/amuin-ai-stack/models /opt/amuin-ai-stack/logs /opt/amuin-ai-stack/state
POSTINST
chmod 0755 "${BUILD_ROOT}/DEBIAN/postinst"

INSTALLED_SIZE="$(du -sk "$BUILD_ROOT" | awk '{print $1}')"
cat > "${BUILD_ROOT}/DEBIAN/control" <<CONTROL
Package: ${PKG_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: Amuin <opensource@amuin.ai>
Installed-Size: ${INSTALLED_SIZE}
Depends: python3, nodejs, ffmpeg, sox
Recommends: intel-openvino-runtime-2026.2
Description: Amuin AI Stack for Linux Intel
 Local AI desktop stack for Intel Linux machines, including Electron UI,
 Node API, and Python OpenVINO inference engine launchers.
CONTROL

echo "=== Building .deb ==="
mkdir -p dist-deb
dpkg-deb --root-owner-group --build "$BUILD_ROOT" "dist-deb/${PKG_NAME}_${VERSION}_${ARCH}.deb"

echo "=== Done ==="
ls -lh "dist-deb/${PKG_NAME}_${VERSION}_${ARCH}.deb"
