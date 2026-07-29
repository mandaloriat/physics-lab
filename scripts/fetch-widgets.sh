#!/usr/bin/env bash
# Build the Fenix Spoon browser widgets from the pinned commit and vendor them into
# frontend/vendor/, where the pages load them through an import map.
#
# The packages are not published to npm (see docs/architecture-decisions.md, ADR-008),
# so "install the dependency" means "build it from the pinned source". The Docker image
# does exactly this in a separate build stage; this script is the local equivalent so a
# `pip install -e .` checkout can serve the same pages without Docker.
#
#   ./scripts/fetch-widgets.sh              # build at the pinned commit
#   FENIX_SPOON_COMMIT=<sha> ./scripts/fetch-widgets.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Keep this default in step with pyproject.toml and .env.example — scripts/check-pins.sh
# fails the build when they drift apart.
FENIX_SPOON_COMMIT="${FENIX_SPOON_COMMIT:-7c89be3d9641c382017931be407e5d6ba8ca9826}"
FENIX_SPOON_REPO="${FENIX_SPOON_REPO:-https://github.com/mandaloriat/fenix-spoon.git}"

VENDOR_DIR="$REPO_ROOT/frontend/vendor/fenix-spoon"
WORK_DIR="${FENIX_SPOON_CHECKOUT:-$REPO_ROOT/.fenix-spoon-src}"

if [ -f "$VENDOR_DIR/COMMIT" ] && [ "$(cat "$VENDOR_DIR/COMMIT")" = "$FENIX_SPOON_COMMIT" ] \
   && [ -z "${FORCE:-}" ]; then
  echo "widgets already vendored at $FENIX_SPOON_COMMIT (FORCE=1 to rebuild)"
  exit 0
fi

echo "==> fetching fenix-spoon @ ${FENIX_SPOON_COMMIT:0:7}"
mkdir -p "$WORK_DIR"
if [ ! -d "$WORK_DIR/.git" ]; then
  git init --quiet "$WORK_DIR"
  git -C "$WORK_DIR" remote add origin "$FENIX_SPOON_REPO"
fi
# Fetch the one commit rather than cloning history: the pin is a SHA, so there is
# nothing else worth downloading.
git -C "$WORK_DIR" fetch --quiet --depth 1 origin "$FENIX_SPOON_COMMIT"
git -C "$WORK_DIR" checkout --quiet FETCH_HEAD

echo "==> building @fenix-spoon/{client,geometry-2d,viewer}"
npm --prefix "$WORK_DIR/client" ci
npm --prefix "$WORK_DIR/client" run build

echo "==> vendoring into frontend/vendor/fenix-spoon"
rm -rf "$VENDOR_DIR"
for package in client geometry-2d viewer; do
  mkdir -p "$VENDOR_DIR/$package"
  cp -R "$WORK_DIR/client/packages/$package/dist/." "$VENDOR_DIR/$package/"
done
printf '%s\n' "$FENIX_SPOON_COMMIT" > "$VENDOR_DIR/COMMIT"

echo "==> done: $(find "$VENDOR_DIR" -name '*.js' | wc -l | tr -d ' ') modules vendored"
