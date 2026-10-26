#!/usr/bin/env bash
set -euo pipefail

# Run at repository root: bash tools/build_static_site.sh
# No CI secrets are necessary. Download only manufacturer-published,
# hash-verified mesh assets; fail rather than publish broken robot cards.

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "[Robotists] 1/4 Installing verified Unitree Go2/A1 meshes..."
python3 tools/install_unitree_models.py --all

echo "[Robotists] 2/4 Installing verified LimX OLI/LUNA meshes..."
python3 tools/install_limx_models.py --all

echo "[Robotists] 3/4 Installing JavaScript dependencies..."
npm --prefix web install --no-audit --no-fund

echo "[Robotists] 4/4 Running tests and creating the static site..."
npm --prefix web run test:motions
npm --prefix web run build

# A successful Vite build is not sufficient: when marker files are missing
# every non-MagicDog robot appears as "Model not available" in production.
for robot in go2 a1 oli luna; do
  marker="web/dist/${robot}/meshes/asset-ready.txt"
  if [[ ! -f "${marker}" ]]; then
    echo "ERROR: Missing deployed model marker: ${marker}" >&2
    exit 1
  fi
  if ! grep -q "^ready: ${robot}" "${marker}"; then
    echo "ERROR: Invalid model marker: ${marker}" >&2
    exit 1
  fi
done

if [[ ! -f "web/dist/magicdog/meshes/base.obj" ]]; then
  echo "ERROR: MagicDog original OBJ geometry missing from build." >&2
  exit 1
fi

echo "[Robotists] Static website ready at web/dist."
