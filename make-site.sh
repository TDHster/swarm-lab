#!/bin/bash
# Build a clean folder for static hosting: site/ is deployed by wrangler (see wrangler.jsonc, README).
# Copies the pages and their js/css, skips git, editor settings, notes for Claude (CLAUDE.md),
# console tools (tools/) and macOS junk.
#
# Usage: ./make-site.sh [cloudflare-web-analytics-token]
# Without a token (default) the site is built without analytics. With a token, the Cloudflare
# Web Analytics beacon is added to every page in site/ (the token is public, not a secret).
set -euo pipefail
cd "$(dirname "$0")"
TOKEN="${1:-}"
[ "$TOKEN" = "none" ] && TOKEN=""

rm -rf site
mkdir site
# tar instead of rsync: rsync is not in the Cloudflare build image (Workers Builds runs this script).
tar -cf - \
  --exclude '.git' --exclude '.gitignore' --exclude '.claude' --exclude '.DS_Store' \
  --exclude 'CLAUDE.md' --exclude 'tools' --exclude 'site' --exclude 'make-site.sh' \
  --exclude 'wrangler.jsonc' --exclude '.wrangler' --exclude 'node_modules' \
  . | tar -xf - -C site

if [ -n "$TOKEN" ]; then
  if ! [[ "$TOKEN" =~ ^[A-Za-z0-9]+$ ]]; then
    echo "ERROR: the token should be letters and digits only, got: $TOKEN" >&2
    exit 1
  fi
  # Exactly the snippet Cloudflare gives in Web Analytics -> Installation.
  BEACON="<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"$TOKEN\"}'></script><!-- End Cloudflare Web Analytics -->"
  find site -name '*.html' | while read -r page; do
    BEACON="$BEACON" perl -0pi -e 's|</body>|$ENV{BEACON}\n</body>|' "$page"
    echo "analytics: $page"
  done
fi

echo "Ready: $(find site -type f | wc -l | tr -d ' ') files, $(du -sh site | cut -f1) in site/"
find site -type f -size +25M -exec echo "WARNING: over 25 MB: {}" \;
