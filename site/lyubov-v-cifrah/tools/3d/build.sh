#!/bin/sh
# Сборка 3D-сцены главной в один файл 3d/scene.js.
# Запуск из корня репозитория: sh site/lyubov-v-cifrah/tools/3d/build.sh
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
OUT="$DIR/../../3d/scene.js"
TMP=$(mktemp -d)
cp "$DIR/scene.src.js" "$DIR/digits.json" "$TMP/"
cd "$TMP"
npm init -y >/dev/null
npm i --silent three@0.169.0 esbuild@0.24.0
npx esbuild scene.src.js --bundle --format=esm --minify --target=es2020 --legal-comments=none --outfile="$OUT"
