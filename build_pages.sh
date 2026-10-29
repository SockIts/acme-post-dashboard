#!/usr/bin/env bash
# usage: PAGES_PASSWORD='<shared password>' ./build_pages.sh [--no-relay] [path/to/acme-post-dashboard.html]
# The LIVE build always injects the relay: RELAY_BASE (env, else ../dashboard-relay/relay_url) and
# RELAY_TOKEN (env, else TEAM_TOKEN from ../dashboard-relay/secrets.env). If either is missing the build FAILS.
# --no-relay is ONLY for local tests (tests/browser_test.js); never push a --no-relay build.
set -euo pipefail
cd "$(dirname "$0")"
: "${PAGES_PASSWORD:?set PAGES_PASSWORD (it is read from the environment only, never stored)}"
NO_RELAY=0; ARGS=()
for a in "$@"; do if [ "$a" = "--no-relay" ]; then NO_RELAY=1; else ARGS+=("$a"); fi; done
R=../dashboard-relay
if [ "$NO_RELAY" = 1 ]; then
  echo "WARNING: --no-relay test build (copy mode). DO NOT PUSH this index.html." >&2
  RELAY_BASE= RELAY_TOKEN= NO_RELAY=1 python3 build_pages.py ${ARGS[@]+"${ARGS[@]}"}
  exit
fi
if [ -z "${RELAY_BASE:-}" ] && [ -f "$R/relay_url" ]; then RELAY_BASE=$(tr -d ' \n' < "$R/relay_url"); fi
if [ -z "${RELAY_TOKEN:-}" ] && [ -f "$R/secrets.env" ]; then RELAY_TOKEN=$(sed -n 's/^TEAM_TOKEN=//p' "$R/secrets.env" | tr -d ' \n\r'); fi
if [ -z "${RELAY_BASE:-}" ] || [ -z "${RELAY_TOKEN:-}" ]; then
  echo "ERROR: relay config missing (RELAY_BASE and/or RELAY_TOKEN). The live dashboard would fall back to copy mode and Approve & schedule would break." >&2
  echo "       Provide them, or pass --no-relay for a local TEST build only." >&2
  exit 3
fi
export RELAY_BASE RELAY_TOKEN
NO_RELAY=0 python3 build_pages.py ${ARGS[@]+"${ARGS[@]}"}
