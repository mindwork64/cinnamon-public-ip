#!/usr/bin/env bash
set -euo pipefail

UUID='public-ip-cinnamon@mindwork64'
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$ROOT/dist/$UUID"
PAYLOAD="$TARGET/files/$UUID"

for file in applet.js metadata.json icon.png info.json screenshot.png README.md LICENSE; do
    if [[ ! -s "$ROOT/$file" ]]; then
        printf 'Missing or empty required file: %s\n' "$ROOT/$file" >&2
        exit 1
    fi
done

rm -rf -- "$TARGET"
mkdir -p -- "$PAYLOAD"
install -m 0644 "$ROOT/info.json" "$TARGET/info.json"
install -m 0644 "$ROOT/screenshot.png" "$TARGET/screenshot.png"
install -m 0644 "$ROOT/README.md" "$TARGET/README.md"
install -m 0644 "$ROOT/LICENSE" "$TARGET/LICENSE"
install -m 0644 "$ROOT/applet.js" "$PAYLOAD/applet.js"
install -m 0644 "$ROOT/metadata.json" "$PAYLOAD/metadata.json"
install -m 0644 "$ROOT/icon.png" "$PAYLOAD/icon.png"
if [[ -d "$ROOT/po" ]]; then
    mkdir -p "$PAYLOAD/po"
    cp -a "$ROOT/po/." "$PAYLOAD/po/"
fi

printf 'Built Cinnamon Spices package:\n%s\n' "$TARGET"
printf 'Payload directory contents:\n'
find "$TARGET/files" -mindepth 1 -maxdepth 2 -printf '%P\n' | sort
