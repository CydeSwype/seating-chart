#!/usr/bin/env bash
# Stamp index.html's asset links with the current time.
# GitHub Pages caches files for 10 minutes, so without this a browser can pair a
# fresh index.html with a stale app.js. Run before committing a change.
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP="$(date -u +%Y%m%d%H%M)"
uv run python - "$STAMP" <<'PY'
import re, sys
stamp = sys.argv[1]
h = open("index.html").read()
h = re.sub(r'(href="app\.css)(\?v=\d+)?"', rf'\1?v={stamp}"', h)
h = re.sub(r'(src="app\.js)(\?v=\d+)?"', rf'\1?v={stamp}"', h)
open("index.html", "w").write(h)
print("stamped", stamp)
PY
./tools/make-artifact.sh
