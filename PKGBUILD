# Local checkout package: see packaging/README.md.
# Keep makepkg --cleanbuild away from the repository’s own src/ directory.
BUILDDIR="$startdir/artifacts/arch"
pkgname=derpbird
pkgver=0.1.0
pkgrel=36
pkgdesc='DerpBird with native MCP automation'
arch=('x86_64')
license=('OFL-1.1' 'MIT' 'BSD-2-Clause' 'MPL-2.0' 'GPL-3.0-or-later' 'Apache-2.0')
depends=('ffmpeg' 'qt6-base' 'qt6-svg' 'qt6-wayland' 'glib2' 'gcc-libs' 'glibc' 'fontconfig' 'ca-certificates' 'libglvnd' 'qt6-positioning' 'libpulse' 'libsecret' 'duktape' 'libdrm' 'libxcb' 'libxkbcommon' 'ncurses' 'vulkan-icd-loader' 'wayland' 'xcb-util-wm')
makedepends=('python' 'patchelf' 'cmake' 'ninja' 'git' 'curl' 'autoconf-archive' 'nasm' 'qt6-tools' 'unzip' 'zip')
options=('!strip' '!debug' '!lto')

build() {
  cd "$startdir"
  command -v bun >/dev/null || { error 'Bun is required on PATH'; return 1; }
  if [[ ${DERPBIRD_PACKAGE_REUSE_BUILD:-0} != 1 ]]; then
    bun install --frozen-lockfile
    python3 scripts/workflow.py build
  fi
  mkdir -p artifacts/package
  bun build --compile --minify --define 'window=undefined' src/automation/server.ts --outfile artifacts/package/derpbird-mcp
  bun build --target=bun src/browser/style-compiler.worker.ts --outfile artifacts/package/style-compiler.worker.js
}

package() {
  cd "$startdir"
  python3 scripts/package-runtime.py "$pkgdir"
  install -Dm755 packaging/derpbird "$pkgdir/usr/bin/derpbird"
  install -Dm755 packaging/derpbird-mcp "$pkgdir/usr/bin/derpbird-mcp"
  install -Dm644 packaging/derpbird.desktop "$pkgdir/usr/share/applications/derpbird.desktop"
  install -Dm644 packaging/derpbird.svg "$pkgdir/usr/share/icons/hicolor/scalable/apps/derpbird.svg"
}
