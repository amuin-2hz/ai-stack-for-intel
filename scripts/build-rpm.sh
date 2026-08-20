#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/package-common.sh

if ! command -v rpmbuild >/dev/null 2>&1; then
  echo "rpmbuild is required (Ubuntu/Debian: sudo apt install rpm; Fedora/RHEL: sudo dnf install rpm-build)" >&2
  exit 1
fi

PKG_NAME="amuin-ai-stack"
VERSION="$(node -p "require('./package.json').version")"
RELEASE="1"
ARCH="x86_64"
RPM_NAME="${PKG_NAME}-${VERSION}-${RELEASE}.${ARCH}.rpm"
DIST_DIR="$PWD/dist-rpm"
BUILD_ROOT="${DIST_DIR}/stage/${PKG_NAME}-${VERSION}"
RPM_TOPDIR="${DIST_DIR}/rpmbuild"
SPEC_FILE="${RPM_TOPDIR}/SPECS/${PKG_NAME}.spec"

package_build_assets
package_prepare_tree "$BUILD_ROOT" "$PKG_NAME"

rm -rf "$RPM_TOPDIR"
mkdir -p \
  "$RPM_TOPDIR/BUILD" \
  "$RPM_TOPDIR/BUILDROOT" \
  "$RPM_TOPDIR/RPMS" \
  "$RPM_TOPDIR/SOURCES" \
  "$RPM_TOPDIR/SPECS" \
  "$RPM_TOPDIR/SRPMS"

cat > "$SPEC_FILE" <<SPEC
Name:           ${PKG_NAME}
Version:        ${VERSION}
Release:        ${RELEASE}
Summary:        Local AI desktop stack for Linux Intel
License:        MIT
URL:            https://github.com/amuin-2hz/ai-stack-for-intel
BuildArch:      ${ARCH}
AutoReqProv:    no

Requires:       python3 >= 3.10
Requires:       nodejs >= 18
Recommends:     /usr/bin/ffmpeg
Recommends:     /usr/bin/sox
Requires:       gtk3
Requires:       nss
Requires:       mesa-libgbm
Requires:       libdrm
Requires:       libxkbcommon
Requires:       libXcomposite
Requires:       libXdamage
Requires:       libXrandr
Requires:       alsa-lib

%description
Desktop model manager, OpenAI-compatible API, and Python OpenVINO
inference launchers for Intel CPU, GPU, and NPU devices.

%prep

%build

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}
cp -a ${BUILD_ROOT}/. %{buildroot}/

%files
%defattr(-,root,root,-)
/opt/${PKG_NAME}
/usr/bin/${PKG_NAME}
/usr/share/applications/${PKG_NAME}.desktop
/usr/share/pixmaps/${PKG_NAME}.png
/usr/share/doc/${PKG_NAME}

%post
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || :
fi

%postun
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || :
fi

%changelog
* Thu Aug 20 2026 Amuin <opensource@amuin.ai> - ${VERSION}-${RELEASE}
- Add native RPM packaging for Fedora, RHEL-compatible distributions, and openEuler.
SPEC

printf '%s\n' "=== Building .rpm ==="
rpmbuild --define "_topdir ${RPM_TOPDIR}" -bb "$SPEC_FILE"

BUILT_RPM="$(find "$RPM_TOPDIR/RPMS" -type f -name "${PKG_NAME}-${VERSION}-${RELEASE}*.${ARCH}.rpm" -print -quit)"
if [[ -z "$BUILT_RPM" ]]; then
  echo "rpmbuild completed without producing ${RPM_NAME}" >&2
  exit 1
fi
install -m 0644 "$BUILT_RPM" "${DIST_DIR}/${RPM_NAME}"
(
  cd "$DIST_DIR"
  sha256sum "$RPM_NAME" > SHA256SUMS
  chmod 0644 SHA256SUMS
)
install -m 0644 RELEASE_NOTES.md "$DIST_DIR/RELEASE_NOTES.md"

printf '%s\n' "=== Release artifacts ==="
ls -lh "${DIST_DIR}/${RPM_NAME}" "${DIST_DIR}/SHA256SUMS" "${DIST_DIR}/RELEASE_NOTES.md"
