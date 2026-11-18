#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "当前打包脚本仅支持 Apple Silicon macOS (arm64)。" >&2
  exit 1
fi

version=$(node -p "require('./package.json').version")
app_path="dist-desktop/mac-arm64/LitDesk.app"
dmg_path="dist-desktop/LitDesk-${version}-arm64.dmg"
staging="dist-desktop/dmg-staging"

npm run build
npx --no-install electron --version
CSC_IDENTITY_AUTO_DISCOVERY=false npx --no-install electron-builder --mac dir --publish never
codesign --force --deep --sign - "$app_path"
codesign --verify --deep --strict "$app_path"

rm -rf "$staging"
mkdir -p "$staging"
cp -R "$app_path" "$staging/"
ln -s /Applications "$staging/Applications"
rm -f "$dmg_path"
hdiutil create -ov -fs HFS+ -format UDZO -imagekey zlib-level=9 -volname "LitDesk" -srcfolder "$staging" "$dmg_path"
rm -rf "$staging"

printf '\nLitDesk app: %s\nDMG installer: %s\n' "$app_path" "$dmg_path"
