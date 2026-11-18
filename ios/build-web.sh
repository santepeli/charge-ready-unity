#!/bin/sh
# Packs the game into one offline HTML file (assets/game.html) that WKWebView can open from disk.
set -e
SRC=/home/claude/apk/project/app/src/main/assets/www; OUT=$(dirname "$0")
mkdir -p $OUT/assets
NODE_PATH=/home/claude/charge-ready/node_modules npx --yes esbuild@0.24.0 $SRC/game.js --bundle --format=esm --target=safari15 --minify --outfile=/tmp/cr-game.js --log-level=warning
python3 - $SRC /tmp/cr-game.js $OUT/assets/game.html <<'PY'
import sys, json, base64, re
src, js, out = sys.argv[1:]
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
kay = json.load(open(f'{src}/assets/kaykit.json'))
for im in kay['gltf'].get('images', []):
    if not im['uri'].startswith('data:'): im['uri'] = 'data:image/png;base64,' + b64(f"{src}/assets/{im['uri']}")
packs = {'kaykit.json': json.dumps(kay, separators=(',', ':')), 'kenney.json': open(f'{src}/assets/kenney.json').read()}
html = open(f'{src}/index.html').read()
for w in ('600', '800'):
    html = html.replace(f'url(fonts/baloo-2-latin-{w}-normal.woff2)', f"url(data:font/woff2;base64,{b64(f'{src}/fonts/baloo-2-latin-{w}-normal.woff2')})")
code = open(js).read()
assert '</script' not in code and all('</script' not in p for p in packs.values())
shim = ''.join(f'<script type="application/json" id="pack-{n}">{p}</script>' for n, p in packs.items())
# Serves the two asset packs from the page itself, since fetch cannot read file:// URLs in WKWebView.
shim += '''<script>(() => { const f = window.fetch; window.fetch = (u, o) => { const m = String(u).match(/assets\\/(\\w+\\.json)$/); const el = m && document.getElementById('pack-' + m[1]);
if (!el) return f(u, o); const b = new TextEncoder().encode(el.textContent); return Promise.resolve(new Response(b, { headers: { 'content-length': String(b.length) } })); }; })();</script>'''
html, n = re.subn(r'<script type="importmap">.*?</script>\s*<script type="module" src="\./game\.js"></script>', lambda _: shim + '<script type="module">' + code + '</script>', html, flags=re.S)
assert n == 1 and 'fonts/baloo' not in html
open(out, 'w').write(html)
PY
ls -la $OUT/assets/game.html | awk '{print $5}'
