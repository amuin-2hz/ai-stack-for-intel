#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/package-common.sh

PKG_NAME="amuin-ai-stack"
VERSION="$(node -p "require('./package.json').version")"
ARCH="amd64"
DEB_NAME="${PKG_NAME}_${VERSION}_${ARCH}.deb"
BUILD_ROOT="dist-deb/${PKG_NAME}_${VERSION}_${ARCH}"

package_build_assets
package_prepare_tree "$BUILD_ROOT" "$PKG_NAME"
mkdir -p "$BUILD_ROOT/DEBIAN"

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
