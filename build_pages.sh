#!/usr/bin/env bash
# usage: PAGES_PASSWORD='<shared password>' ./build_pages.sh [path/to/acme-post-dashboard.html]
set -euo pipefail
cd "$(dirname "$0")"
: "${PAGES_PASSWORD:?set PAGES_PASSWORD (it is read from the environment only, never stored)}"
python3 build_pages.py "$@"
