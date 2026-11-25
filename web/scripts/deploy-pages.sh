#!/usr/bin/env bash
# Compila la web y la publica en la rama gh-pages (GitHub Pages, "Deploy from a branch").
set -e
cd "$(dirname "$0")/.."
npx vite build
TMP=$(mktemp -d)
cp -r dist/. "$TMP" && touch "$TMP/.nojekyll"
REMOTE=$(git remote get-url origin)
cd "$TMP" && git init -q -b gh-pages && git add -A && git commit -qm "Publicación web ALCIÓN HX-4"
git push -f "$REMOTE" gh-pages
echo "Publicado en la rama gh-pages"
