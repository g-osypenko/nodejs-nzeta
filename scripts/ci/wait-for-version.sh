#!/usr/bin/env bash
# Waits until <base-url>/version reports <sha> (spec.md §8, CD step 4) and proves zero downtime:
# every poll during the switch must be HTTP 200 — answered by the old version or by the new one.
#   scripts/ci/wait-for-version.sh https://lch-staging.onrender.com <sha> [timeout-seconds]
set -euo pipefail

base_url="${1:?base url}"
want="${2:?expected commit sha}"
timeout="${3:-600}"
deadline=$(( $(date +%s) + timeout ))
failures=0
old=""

while [ "$(date +%s)" -lt "$deadline" ]; do
  # --max-time 90: a sleeping free Render instance needs ~1 min to wake up.
  body=$(curl -sS --max-time 90 -w '\n%{http_code}' "$base_url/version" || printf '\n000')
  code=$(printf '%s' "$body" | tail -n1)
  commit=$(printf '%s' "$body" | head -n1 | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')
  printf '%s  HTTP %s  commit=%s\n' "$(date -u +%H:%M:%S)" "$code" "${commit:-?}"
  if [ "$code" != "200" ]; then
    failures=$((failures + 1))
  elif [ "$commit" = "$want" ]; then
    echo "deployed: $want (previous: ${old:-unknown}); non-200 polls during switch: $failures"
    [ "$failures" -eq 0 ] || { echo "::error::downtime detected during deploy"; exit 1; }
    exit 0
  else
    old="$commit"
  fi
  sleep 3
done

echo "::error::timeout: $base_url/version did not report $want within ${timeout}s"
exit 1
