#!/usr/bin/env bash
# Every reference to Fenix Spoon must name the same commit.
#
# The lab pins its dependency in four places that cannot be derived from one another: the
# Python requirement in pyproject.toml, the Docker build arguments, the container image
# tag, and the default the fetch script and settings module carry for checkouts that use
# neither. They are pinned separately because they are consumed separately — pip, Docker
# and a bare `uvicorn` each read exactly one of them — and a bump that updates three of
# four produces a deployment whose widgets, server and adapters come from different
# commits. That failure is silent, so this check exists to make it loud.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The commit of record: the Python dependency, because that is the one pip resolves and
# therefore the one that decides what actually runs.
COMMIT=$(grep -oE 'fenix-spoon@[0-9a-f]{40}\b' pyproject.toml | head -1 | cut -d@ -f2)
if [ -z "$COMMIT" ]; then
  echo "check-pins: no 40-character Fenix Spoon commit found in pyproject.toml" >&2
  exit 1
fi
SHORT="${COMMIT:0:7}"
echo "fenix-spoon pin: $COMMIT"

status=0
bad() { echo "  MISMATCH: $1" >&2; status=1; }
good() { echo "  ok: $1"; }

# --- the full SHA, wherever it appears
for file in Dockerfile scripts/fetch-widgets.sh physics_lab/settings.py compose.yaml \
            compose.production.yaml .env.example; do
  [ -f "$file" ] || continue
  # Word-bounded, so a 64-character image digest is not mistaken for a commit: no
  # 40-character window inside one has a word boundary at both ends.
  found=$(grep -oE '\b[0-9a-f]{40}\b' "$file" | sort -u || true)
  if [ -z "$found" ]; then
    bad "$file names no Fenix Spoon commit"
  elif [ "$found" != "$COMMIT" ]; then
    bad "$file pins $(echo "$found" | tr '\n' ' ')"
  else
    good "$file"
  fi
done

# --- the image tags, which encode the short SHA
for file in Dockerfile compose.yaml compose.override.yaml compose.production.yaml .env.example; do
  [ -f "$file" ] || continue
  tags=$(grep -oE 'ghcr\.io/mandaloriat/fenix-spoon:[A-Za-z0-9._-]+' "$file" | sort -u || true)
  [ -z "$tags" ] && continue
  while read -r tag; do
    case "${tag##*:}" in
      "sha-$SHORT"|"sha-$SHORT-slim")
        good "$file image tag ${tag##*:}"
        ;;
      latest|latest-slim|main|main-slim)
        bad "$file uses the moving tag ${tag##*:}; pin sha-$SHORT or sha-$SHORT-slim"
        ;;
      *)
        bad "$file uses ${tag##*:}, which does not match sha-$SHORT"
        ;;
    esac
  done <<< "$tags"
done

# --- the vendored widgets, when they have been built
VENDOR_COMMIT_FILE=frontend/vendor/fenix-spoon/COMMIT
if [ -f "$VENDOR_COMMIT_FILE" ]; then
  vendored=$(tr -d '[:space:]' < "$VENDOR_COMMIT_FILE")
  if [ "$vendored" = "$COMMIT" ]; then
    good "vendored widgets"
  else
    bad "vendored widgets were built from ${vendored:0:7}; run FORCE=1 ./scripts/fetch-widgets.sh"
  fi
else
  echo "  skip: widgets not vendored yet (./scripts/fetch-widgets.sh)"
fi

# --- the documentation, which a reader trusts as much as the code
for file in README.md docs/architecture-decisions.md; do
  [ -f "$file" ] || continue
  if grep -q "$COMMIT" "$file"; then
    good "$file"
  else
    bad "$file does not mention $SHORT; the documented pin has drifted from the real one"
  fi
done

echo
if [ "$status" -eq 0 ]; then
  echo "all Fenix Spoon references agree on $SHORT"
else
  echo "Fenix Spoon references disagree — see docs/architecture-decisions.md (ADR-007)" >&2
fi
exit "$status"
