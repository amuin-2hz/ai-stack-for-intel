#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PKG_NAME="amuin-ai-stack"
VERSION="$(node -p "require('./package.json').version")"
DEB_NAME="${PKG_NAME}_${VERSION}_amd64.deb"
RPM_NAME="${PKG_NAME}-${VERSION}-1.x86_64.rpm"
DIST_DIR="$PWD/dist-release"

printf '%s\n' "=== Building release assets ==="
npm run build
AI_STACK_SKIP_BUILD=1 ./scripts/build-deb.sh
if command -v rpmbuild >/dev/null 2>&1; then
  AI_STACK_SKIP_BUILD=1 ./scripts/build-rpm.sh
else
  ./scripts/build-rpm-docker.sh
fi

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
install -m 0644 "dist-deb/${DEB_NAME}" "$DIST_DIR/$DEB_NAME"
install -m 0644 "dist-rpm/${RPM_NAME}" "$DIST_DIR/$RPM_NAME"
install -m 0644 RELEASE_NOTES.md "$DIST_DIR/RELEASE_NOTES.md"
(
  cd "$DIST_DIR"
  sha256sum "$DEB_NAME" "$RPM_NAME" > SHA256SUMS
  chmod 0644 SHA256SUMS
)

printf '%s\n' "=== Combined release artifacts ==="
ls -lh "$DIST_DIR/$DEB_NAME" "$DIST_DIR/$RPM_NAME" "$DIST_DIR/SHA256SUMS" "$DIST_DIR/RELEASE_NOTES.md"
