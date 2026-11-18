#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "图标构建需要 macOS 的 sips 和 iconutil。" >&2
  exit 1
fi

work=$(mktemp -d /tmp/litdesk-icon.XXXXXX)
trap 'rm -rf "$work"' EXIT
sips -s format png build/icon.svg --out "$work/icon.png" >/dev/null
cp "$work/icon.png" build/icon.png
mkdir -p "$work/LitDesk.iconset"
for spec in '16 icon_16x16' '32 icon_16x16@2x' '32 icon_32x32' '64 icon_32x32@2x' '128 icon_128x128' '256 icon_128x128@2x' '256 icon_256x256' '512 icon_256x256@2x' '512 icon_512x512' '1024 icon_512x512@2x'; do
  read -r size name <<< "$spec"
  sips -z "$size" "$size" "$work/icon.png" --out "$work/LitDesk.iconset/${name}.png" >/dev/null
done
iconutil -c icns "$work/LitDesk.iconset" -o build/icon.icns
