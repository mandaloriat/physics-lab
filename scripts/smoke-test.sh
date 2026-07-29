#!/usr/bin/env bash
# End-to-end smoke test against a *running* lab.
#
#   ./scripts/smoke-test.sh                          # http://127.0.0.1:8000
#   ./scripts/smoke-test.sh https://lab.andolfatto.eu
#
# It exercises the same path a visitor does — health, catalogue, submit, wait, result,
# artifact, homepage — and exits non-zero on the first thing that is wrong. Nothing here
# needs the repository: curl and python3 are the only requirements, so it can be copied
# to a server and run against a deployment built from a different checkout.
set -uo pipefail

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1:8000}}"
BASE_URL="${BASE_URL%/}"
TIMEOUT="${SMOKE_TIMEOUT:-120}"

failures=0
step=0

pass() { step=$((step + 1)); printf '  \033[32mok\033[0m   %d. %s\n' "$step" "$1"; }
fail() {
  step=$((step + 1))
  failures=$((failures + 1))
  printf '  \033[31mFAIL\033[0m %d. %s\n' "$step" "$1"
  [ $# -gt 1 ] && printf '       %s\n' "$2"
}

json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)" 2>/dev/null; }

echo "smoke test: $BASE_URL"

# ---------------------------------------------------------------- 1. health
HEALTH=$(curl -fsS --max-time 15 "$BASE_URL/health" 2>&1)
if [ $? -ne 0 ]; then
  fail "/health responds" "$HEALTH"
  echo; echo "the server is not answering at all; stopping here."
  exit 1
fi
STATUS=$(printf '%s' "$HEALTH" | json "['status']")
if [ "$STATUS" = "ok" ]; then
  COMMIT=$(printf '%s' "$HEALTH" | json "['fenixspoon']['pinned_commit'][:7]")
  pass "/health reports ok (fenix-spoon @ ${COMMIT})"
else
  fail "/health reports ok" "$HEALTH"
fi

JOBS_ENABLED=$(printf '%s' "$HEALTH" | json "['jobs_enabled']")

# ---------------------------------------------------------------- 2. solver catalogue
SOLVERS=$(curl -fsS --max-time 15 "$BASE_URL/api/v1/solvers" 2>&1)
# One parse, one pass: the count and the solver name come out together rather than
# round-tripping the payload through a Python repr and eval()-ing it back.
read -r COUNT MOCK <<< "$(printf '%s' "$SOLVERS" | python3 -c "
import json, sys
solvers = json.load(sys.stdin)
names = [s['name'] for s in solvers]
mock = next((n for n in names if n.startswith('mock.') and 'laplace' in n), '')
print(len(solvers), mock)
" 2>/dev/null)"
if [ -n "$MOCK" ]; then
  pass "solver catalogue is not empty (${COUNT} solvers, using ${MOCK})"
else
  fail "solver catalogue contains a mock potential-flow solver" "$SOLVERS"
  MOCK="mock.laplace2d"
fi

# ---------------------------------------------------------------- 3. homepage & experiment
for path in "/" "/experiments/airfoil/"; do
  BODY=$(curl -fsS --max-time 15 "$BASE_URL$path" 2>&1)
  if [ $? -eq 0 ] && printf '%s' "$BODY" | grep -q "Andolfatto Physics Lab"; then
    pass "$path is served"
  else
    fail "$path is served"
  fi
done

if printf '%s' "$(curl -fsS --max-time 15 "$BASE_URL/experiments/airfoil/")" | grep -q "fs-geometry-2d"; then
  pass "the airfoil page embeds the Fenix Spoon widgets"
else
  fail "the airfoil page embeds the Fenix Spoon widgets"
fi

if curl -fsS --max-time 15 -o /dev/null "$BASE_URL/vendor/fenix-spoon/viewer/index.js"; then
  pass "the vendored widget bundles are reachable"
else
  fail "the vendored widget bundles are reachable" "run ./scripts/fetch-widgets.sh or rebuild the image"
fi

# ---------------------------------------------------------------- 4. a real mock solve
if [ "$JOBS_ENABLED" = "False" ] || [ "$JOBS_ENABLED" = "false" ]; then
  echo
  echo "jobs are disabled on this deployment (PHYSICS_LAB_JOBS_ENABLED); skipping the solve."
  echo "$( [ "$failures" -eq 0 ] && echo 'smoke test passed (site only)' || echo "smoke test FAILED: $failures problem(s)" )"
  exit "$( [ "$failures" -eq 0 ] && echo 0 || echo 1 )"
fi

# Small on purpose: this proves the loop, not the physics, and a public deployment's
# hourly quota should not be spent by its own monitoring.
REQUEST='{
  "solver": "'"$MOCK"'",
  "geometry": {
    "type": "domain2d",
    "bounds": [-1.0, -1.0, 2.0, 1.0],
    "obstacle": {"type": "polygon2d",
                 "points": [[0.0, 0.0], [0.6, 0.08], [1.0, 0.0], [0.6, -0.08]]}
  },
  "params": {"resolution": 48, "iterations": 200}
}'

SUBMIT=$(curl -fsS --max-time 30 -X POST "$BASE_URL/api/v1/jobs" \
  -H 'Content-Type: application/json' -d "$REQUEST" 2>&1)
JOB_ID=$(printf '%s' "$SUBMIT" | json "['job_id']")
if [ -n "$JOB_ID" ]; then
  pass "a mock job was accepted ($JOB_ID)"
else
  fail "a mock job was accepted" "$SUBMIT"
  echo
  echo "smoke test FAILED: $((failures)) problem(s)"
  exit 1
fi

# Poll rather than open a WebSocket: this script must run anywhere curl does. The browser
# smoke test (e2e/smoke.spec.mjs) is what proves the event stream, because only a browser
# can prove the WebSocket survives the reverse proxy.
DEADLINE=$(( $(date +%s) + TIMEOUT ))
JOB_STATUS="queued"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  JOB_STATUS=$(curl -fsS --max-time 15 "$BASE_URL/api/v1/jobs/$JOB_ID" | json "['status']")
  case "$JOB_STATUS" in
    done|failed|cancelled) break ;;
  esac
  sleep 1
done

if [ "$JOB_STATUS" = "done" ]; then
  pass "the job finished (status: done)"
else
  fail "the job finished" "status after ${TIMEOUT}s: ${JOB_STATUS:-unknown}"
fi

RESULT=$(curl -fsS --max-time 30 "$BASE_URL/api/v1/jobs/$JOB_ID/result" 2>&1)
SECONDS_TAKEN=$(printf '%s' "$RESULT" | json "['stats']['seconds']")
HAS_FIELD=$(printf '%s' "$RESULT" | python3 -c "
import json,sys
data = json.load(sys.stdin)['data']
fields = data.get('fields') or data.get('point_fields') or {}
print('yes' if fields.get('speed') else 'no')
" 2>/dev/null)
if [ "$HAS_FIELD" = "yes" ]; then
  pass "the result carries a speed field (${SECONDS_TAKEN}s)"
else
  fail "the result carries a speed field" "$(printf '%s' "$RESULT" | head -c 300)"
fi

ARTIFACT_URL=$(printf '%s' "$RESULT" | python3 -c "
import json,sys
artifacts = json.load(sys.stdin).get('artifacts') or []
print(artifacts[0]['url'] if artifacts else '')
" 2>/dev/null)
if [ -n "$ARTIFACT_URL" ] && curl -fsS --max-time 30 -o /dev/null "$BASE_URL$ARTIFACT_URL"; then
  pass "the VTK artifact downloads"
elif [ -z "$ARTIFACT_URL" ]; then
  fail "the VTK artifact downloads" "the result listed no artifacts"
else
  fail "the VTK artifact downloads" "GET $ARTIFACT_URL failed"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "smoke test passed"
  exit 0
fi
echo "smoke test FAILED: $failures problem(s)"
exit 1
