#!/bin/sh
# Rebuilds the offline web bundle and the Android project archive from the game sources.
set -e
SRC=/home/claude/charge-ready; B=/home/claude/apk; W=$B/project/app/src/main/assets/www
rm -rf $W && mkdir -p $W/vendor/addons/loaders $W/vendor/addons/utils $W/fonts
cp $SRC/*.js $W/ && cp -r $SRC/assets $W/
cp $SRC/node_modules/three/build/three.module.js $W/vendor/
cp $SRC/node_modules/three/examples/jsm/loaders/GLTFLoader.js $W/vendor/addons/loaders/
cp $SRC/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js $W/vendor/addons/utils/
cp /tmp/fs/package/files/baloo-2-latin-600-normal.woff2 /tmp/fs/package/files/baloo-2-latin-800-normal.woff2 $W/fonts/
python3 - "$SRC/index.html" "$W/index.html" <<'PY'
import sys
s = open(sys.argv[1]).read()
fonts = '''<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;800&display=swap">'''
cdn = '"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"'
assert fonts in s and cdn in s
s = s.replace(fonts, '''<style>
  /* Baloo 2 ships with the app so it works offline. */
  @font-face { font-family: 'Baloo 2'; font-weight: 600; src: url(fonts/baloo-2-latin-600-normal.woff2) format('woff2'); }
  @font-face { font-family: 'Baloo 2'; font-weight: 800; src: url(fonts/baloo-2-latin-800-normal.woff2) format('woff2'); }
</style>''').replace(cdn, '"three": "./vendor/three.module.js", "three/addons/": "./vendor/addons/"')
open(sys.argv[2], 'w').write(s)
PY
cd $B && rm -f project.tar.gz && tar czf project.tar.gz project && ls -la project.tar.gz
