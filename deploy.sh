#!/usr/bin/env bash
# Build and publish to the anonimiza container (~/docker/anonimiza), served at https://anonimiza.aminox.dev
# The models are not part of the site: they live in the R2 bucket anonimiza-models (see tools/upload_r2.py).
set -euo pipefail
cd "$(dirname "$0")"
TARGET="${ANONIMIZA_DEPLOY_DIR:-$HOME/docker/anonimiza/data}"  # override for your own server

npm run build
rsync -a --delete dist/ "$TARGET/html/"
echo "Web publicada en $TARGET/html"
if ! cmp -s deploy/nginx.conf "$TARGET/../nginx.conf"; then
  echo "Aviso: deploy/nginx.conf difiere de la del contenedor; cópiala y ejecuta: docker exec anonimiza nginx -s reload"
fi
