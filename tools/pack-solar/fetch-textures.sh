#!/usr/bin/env bash
#
# Fetch + encode the Sol system surface textures into apps/web/public/textures/sol/.
#
# Downloads the 2k texture set from Solar System Scope (CC BY 4.0, NASA-derived,
# https://www.solarsystemscope.com/textures/) and encodes each map to KTX2 with
# KTX-Software's `toktx` — replacing the 12-byte placeholder stubs committed to
# the repo. This is the "Texture setup (manual, run once)" step from README.md,
# automated. Run from anywhere; paths resolve relative to the repo.
#
# Requirements:
#   - toktx (KTX-Software 4.x)   ->  macOS: `brew install ktx`
#                                    else:  https://github.com/KhronosGroup/KTX-Software/releases
#   - curl
#
# Optional: if you already downloaded the SSS .jpg/.png set, point the script at
# it and skip the network step:
#   TEXTURE_SRC_DIR=/path/to/sss-textures ./tools/pack-solar/fetch-textures.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$REPO_ROOT/apps/web/public/textures/sol"
BASE_URL="https://www.solarsystemscope.com/textures/download"
SRC_DIR="${TEXTURE_SRC_DIR:-}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

if ! command -v toktx >/dev/null 2>&1; then
  echo "ERROR: 'toktx' not found. Install KTX-Software:" >&2
  echo "  macOS:  brew install ktx" >&2
  echo "  other:  https://github.com/KhronosGroup/KTX-Software/releases" >&2
  exit 1
fi

# Mapping: <ktx2 basename> <Solar System Scope source basename> <ext>
# (SSS files are named like 2k_<basename>.<ext>; ring map carries alpha as PNG.)
MAPPINGS=(
  "sun         sun                 jpg"
  "mercury     mercury             jpg"
  "venus       venus_atmosphere    jpg"
  "earth       earth_daymap        jpg"
  "mars        mars                jpg"
  "jupiter     jupiter             jpg"
  "saturn      saturn              jpg"
  "saturn_ring saturn_ring_alpha   png"
  "uranus      uranus              jpg"
  "neptune     neptune             jpg"
  "moon        moon                jpg"
)

mkdir -p "$OUT_DIR"

obtain_source() {
  # $1 src basename, $2 ext -> echoes the local path to the source image
  local src="$1" ext="$2"
  local file="2k_${src}.${ext}"
  if [[ -n "$SRC_DIR" ]]; then
    if [[ -f "$SRC_DIR/$file" ]]; then
      echo "$SRC_DIR/$file"; return 0
    fi
    # also accept the README's <name>_2k naming, just in case
    if [[ -f "$SRC_DIR/${src}_2k.${ext}" ]]; then
      echo "$SRC_DIR/${src}_2k.${ext}"; return 0
    fi
    echo "ERROR: $file not found in TEXTURE_SRC_DIR ($SRC_DIR)" >&2
    return 1
  fi
  local dest="$WORK_DIR/$file"
  curl -fSL --retry 3 --retry-delay 2 \
    -A "Mozilla/5.0 (cosmos pack-solar fetch-textures)" \
    -o "$dest" "$BASE_URL/$file" >&2
  echo "$dest"
}

count=0
for row in "${MAPPINGS[@]}"; do
  read -r name src ext <<<"$row"
  echo "==> $name  (source: 2k_${src}.${ext})"
  srcpath="$(obtain_source "$src" "$ext")"
  toktx --t2 --encode etc1s --clevel 4 --qlevel 128 --genmipmap \
    "$OUT_DIR/${name}.ktx2" "$srcpath"
  count=$((count + 1))
done

echo
echo "Encoded ${count} textures -> $OUT_DIR"
du -sh "$OUT_DIR" 2>/dev/null || true
echo "Reminder: Solar System Scope textures are CC BY 4.0 — keep the credit in ATTRIBUTIONS.md."
