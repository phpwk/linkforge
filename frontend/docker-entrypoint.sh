#!/bin/sh
set -eu

# Renders /usr/share/nginx/html/config.js from the API_BASE_URL env var
# at container start. This is the whole trick that lets the same image
# run in dev/staging/prod without a rebuild: K8s sets API_BASE_URL per
# environment (see deploy/k8s/overlays/*), and this script bakes it
# into a tiny JS file nginx serves alongside the static bundle.
cat > /usr/share/nginx/html/config.js <<EOF
window.__LINKFORGE_CONFIG__ = { apiBaseUrl: "${API_BASE_URL:-}" };
EOF

exec "$@"
