#!/usr/bin/env python3
"""Builds Cubic Player into one self-contained HTML file (dist/cubic.html) and the Android asset.

Steps: patch libopenmpt for channel muting, bundle the AudioWorklet, vendor modules and the app with
esbuild, then inline everything (gzip + base64) into web/index.html.
Needs: node + `npm install`, and the engine .wasm files in engines/ (see engines/README.md).
"""
import base64, gzip, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(ROOT, 'build')
NM = os.path.join(ROOT, 'node_modules')
os.makedirs(os.path.join(B, 'vendor'), exist_ok=True)

def esbuild(entry, out, fmt='esm', extra=()):
    cmd = [os.path.join(NM, '.bin', 'esbuild'), entry, '--bundle', '--minify', f'--format={fmt}', '--external:node:*',
           '--platform=browser', '--target=es2020', '--log-level=warning', f'--outfile={out}', *extra]
    subprocess.run(cmd, check=True, cwd=ROOT)

# 1. libopenmpt: expose the wasm function table (for the "interactive" extension: channel mute)
src = open(os.path.join(NM, 'chiptune3', 'libopenmpt.worklet.js'), encoding='utf-8').read()
anchor = 'return Module}export default libopenmpt;'
assert src.count(anchor) == 1, 'libopenmpt.worklet.js changed; update the patch'
src = src.replace(anchor, 'Module.getWasmTableEntry=getWasmTableEntry;Object.defineProperty(Module,"HEAPU32",{get:()=>HEAPU32});' + anchor)
open(os.path.join(B, 'libopenmpt.patched.js'), 'w', encoding='utf-8').write(src)

# 2. bundles
esbuild('web/worklet-src.js', os.path.join(B, 'worklet.js'))
for f in sorted(os.listdir(os.path.join(ROOT, 'web', 'vendor'))):
    if f.endswith('.js'):
        esbuild(f'web/vendor/{f}', os.path.join(B, 'vendor', f))
esbuild('web/src/main.js', os.path.join(B, 'app.js'), fmt='iife')
subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'make_demo.py'), os.path.join(B, 'demo.mid')], check=True, stdout=subprocess.DEVNULL)

# 3. assets
assets = [('worklet', os.path.join(B, 'worklet.js'))]
for k in ['adplug', 'gme', 'hvl', 'midi', 'speex']:
    assets.append((k, os.path.join(ROOT, 'engines', k + '.wasm')))
for f in sorted(os.listdir(os.path.join(B, 'vendor'))):
    assets.append((f[:-3], os.path.join(B, 'vendor', f)))
CW = os.path.join(NM, 'cawtooth')
for k in ['psid', 'ay', 'sndh', 'zxay']:
    assets.append(('caw-w-' + k, os.path.join(CW, 'dist', 'worklet', k + '-processor.js')))
for k in ['sidplay', 'ayumi', 'sndh', 'zxay']:
    assets.append(('caw-' + k, os.path.join(CW, 'wasm', k + '.wasm')))
assets.append(('demo', os.path.join(B, 'demo.mid')))

tags = []
total = 0
for name, path in assets:
    raw = open(path, 'rb').read()
    gz = gzip.compress(raw, 9, mtime=0)
    b64 = base64.b64encode(gz).decode()
    total += len(b64)
    tags.append(f'<script type="text/plain" data-asset="{name}">{b64}</script>')

def font(family, path, weight):
    b = base64.b64encode(open(path, 'rb').read()).decode()
    return f'@font-face{{font-family:"{family}";font-style:normal;font-weight:{weight};font-display:swap;src:url(data:font/woff2;base64,{b}) format("woff2")}}'
F = os.path.join(NM, '@fontsource')
fonts = font('VT323', os.path.join(F, 'vt323', 'files', 'vt323-latin-400-normal.woff2'), 400)
fonts += font('JetBrains Mono', os.path.join(F, 'jetbrains-mono', 'files', 'jetbrains-mono-latin-400-normal.woff2'), 400)
fonts += font('JetBrains Mono', os.path.join(F, 'jetbrains-mono', 'files', 'jetbrains-mono-latin-500-normal.woff2'), 500)

html = open(os.path.join(ROOT, 'web', 'index.html'), encoding='utf-8').read()
app = open(os.path.join(B, 'app.js'), encoding='utf-8').read().replace('</script', '<\\/script')
html = html.replace('/*FONTS*/', fonts).replace('<!--ASSETS-->', '\n'.join(tags)).replace('/*APP*/', app)

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'cubic.html')
open(out, 'w', encoding='utf-8').write(html)
# variant for hosts that supply their own document skeleton (claude.ai artifacts)
frag = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>|</head>\s*<body>|</body>\s*</html>\s*$', '', html, flags=re.I)
open(os.path.join(ROOT, 'dist', 'cubic-embed.html'), 'w', encoding='utf-8').write(frag)
adir = os.path.join(ROOT, 'android', 'assets')
if os.path.isdir(os.path.join(ROOT, 'android')):
    os.makedirs(adir, exist_ok=True)
    shutil.copy(out, os.path.join(adir, 'index.html'))
print(f'dist/cubic.html: {os.path.getsize(out) / 1048576:.2f} MB ({total / 1048576:.2f} MB of assets)')
