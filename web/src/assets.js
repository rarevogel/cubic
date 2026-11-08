// Embedded assets: gzip-compressed, base64 encoded, in <script type="text/plain" data-asset="name"> tags.
const cache = new Map();
const urls = new Map();

export function hasAsset(name) { return !!document.querySelector(`script[data-asset="${name}"]`); }

export async function asset(name) {
  if (cache.has(name)) return cache.get(name);
  const p = (async () => {
    const el = document.querySelector(`script[data-asset="${name}"]`);
    if (!el) throw new Error('missing asset ' + name);
    const bin = atob(el.textContent.trim());
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    if (el.dataset.gz === '0') return u8;
    const ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  })();
  cache.set(name, p);
  return p;
}

export async function assetURL(name, mime = 'text/javascript') {
  if (urls.has(name)) return urls.get(name);
  const p = asset(name).then(b => URL.createObjectURL(new Blob([b], { type: mime })));
  urls.set(name, p);
  return p;
}

export async function importAsset(name) {
  return import(/* @vite-ignore */ await assetURL(name));
}
