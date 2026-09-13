#!/usr/bin/env bash
# Regenerate artifact.html from index.html: drop the document wrapper and the
# cache-busting query strings, which the Artifact host doesn't use.
set -euo pipefail
cd "$(dirname "$0")/.."
uv run python - <<'PY'
import re
h = open("index.html").read()
head = re.search(r"<head>(.*?)</head>", h, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", h, re.S).group(1)
head = "\n".join(l for l in head.split("\n") if "<meta" not in l)
out = head.strip() + "\n" + body.strip() + "\n"
out = re.sub(r'(app\.(?:css|js))\?v=\d+', r"\1", out)
open("artifact.html", "w").write(out)
print("wrote artifact.html")
PY
