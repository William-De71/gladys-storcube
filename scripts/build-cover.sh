#!/usr/bin/env bash
# Builds cover.jpg (800 x 534, < 150 KB, as the store requires) from
# docs/assets/cover.svg, with the StorCube logo (docs/assets/storcube-logo.png)
# inlined as a data URI: no external link in the rendered cover.
# StorCube is a trademark of its owner; this project is not affiliated.
# Needs Inkscape and ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
logo="data:image/png;base64,$(base64 -w0 docs/assets/storcube-logo.png)"
sed "s|xlink:href=\"storcube-logo.png\"|xlink:href=\"${logo}\"|" docs/assets/cover.svg >"$tmp/cover.svg"
grep -q 'data:image/png;base64,' "$tmp/cover.svg" || { echo "logo not inlined" >&2; exit 1; }
inkscape "$tmp/cover.svg" --export-type=png --export-filename="$tmp/cover.png" -w 800 -h 534 >/dev/null 2>&1
magick "$tmp/cover.png" -strip -quality 85 -sampling-factor 4:2:0 cover.jpg
size="$(stat -c %s cover.jpg)"
dims="$(magick identify -format '%wx%h' cover.jpg)"
echo "cover.jpg: ${dims}, ${size} bytes"
[ "$dims" = "800x534" ] || { echo "wrong dimensions" >&2; exit 1; }
[ "$size" -lt $((150 * 1024)) ] || { echo "too heavy" >&2; exit 1; }
