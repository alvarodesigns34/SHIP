#!/usr/bin/env bash
# Publica web/dist en la rama gh-pages SIN reescribir su historial.
# Cada despliegue es un commit nuevo sobre gh-pages: reversión = `git revert` del commit
# de despliegue (o volver a publicar un commit anterior con DEPLOY_FROM=<sha>).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f dist/index.html ] || { echo "Falta dist/: ejecuta npm run build"; exit 1; }
REMOTE=$(git remote get-url origin)
SRC_SHA=$(git rev-parse --short HEAD)
WT=$(mktemp -d)
git fetch origin gh-pages
git worktree add --detach "$WT" origin/gh-pages
trap 'git worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT
# reemplazar el contenido publicado (conservando .git del worktree)
find "$WT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r dist/. "$WT"/
touch "$WT/.nojekyll"
echo "$SRC_SHA" > "$WT/VERSION"
cd "$WT"
git add -A
if git diff --cached --quiet; then echo "Sin cambios que publicar"; exit 0; fi
git commit -qm "Publicación ALCIÓN HX-4 Rebirth (origen ${SRC_SHA})"
for i in 1 2 3 4; do git push origin HEAD:gh-pages && break || sleep $((2 ** i)); done
echo "Publicado: $(git rev-parse --short HEAD) (origen ${SRC_SHA}); anterior: $(git rev-parse --short HEAD~1)"
