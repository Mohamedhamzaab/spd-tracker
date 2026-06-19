// ---------------------------------------------------------------------------
//  CAD conversion — turn a DWG into an open DXF so the browser only ever
//  receives DXF (rendered client-side by dxf-viewer, which is MPL-2.0).
//
//  This uses LibreDWG (via the @mlightcad/libredwg-web WASM build). LibreDWG is
//  GPLv3, but it runs SERVER-SIDE ONLY here — we convert on our backend and
//  serve the *output* (a DXF). We never distribute the LibreDWG binary to end
//  users, and GPLv3 (unlike AGPL) does not cover serving a program's output
//  over a network, so this imposes no licensing obligation on the app itself.
//
//  The WASM module is loaded once and reused. Converted DXFs are kept in a
//  small LRU keyed by the document's immutable stored_name so re-opening a
//  drawing doesn't re-run the conversion.
// ---------------------------------------------------------------------------
const path = require('path');

let _libPromise = null;

// Resolve the package's wasm directory without touching package.json (its
// "exports" map hides it), by locating the main entry and stepping up to /wasm.
function wasmDir() {
  const mainPath = require.resolve('@mlightcad/libredwg-web');
  return path.join(path.dirname(mainPath), '..', 'wasm') + path.sep;
}

// The package is ESM-only for its WASM init, so load it via dynamic import even
// though we are CommonJS. Cached so the WASM compiles once per process.
function getLib() {
  if (!_libPromise) {
    _libPromise = (async () => {
      const mod = await import('@mlightcad/libredwg-web');
      const LibreDwg = mod.LibreDwg || (mod.default && mod.default.LibreDwg);
      if (!LibreDwg) throw new Error('libredwg-web: LibreDwg export not found.');
      return LibreDwg.create(wasmDir());
    })().catch((err) => {
      _libPromise = null; // allow a later retry if the first init failed
      throw err;
    });
  }
  return _libPromise;
}

// --- tiny LRU of converted DXF buffers --------------------------------------
const cache = new Map();
const CACHE_MAX = 16;
function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v); // move to most-recently-used
  return v;
}
function cacheSet(key, buf) {
  cache.set(key, buf);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// Convert a DWG buffer to a DXF Buffer. `cacheKey` (the stored_name) is
// optional but lets us memoise. Throws a tagged error on a DWG we can't read.
async function dwgToDxf(buffer, cacheKey) {
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }
  const lib = await getLib();
  // Hand the WASM a clean ArrayBuffer view of exactly this file's bytes.
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const out = lib.dwg_write_dxf(ab);
  if (!out || !out.length) {
    const err = new Error('This DWG could not be read — it may be a newer or unsupported AutoCAD version. You can still download it.');
    err.code = 'CAD_CONVERT_FAILED';
    throw err;
  }
  const dxf = Buffer.from(out);
  if (cacheKey) cacheSet(cacheKey, dxf);
  return dxf;
}

module.exports = { dwgToDxf };
