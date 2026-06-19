// ---------------------------------------------------------------------------
//  CAD conversion — render a DWG to SVG so the browser can display it.
//
//  We use LibreDWG's own geometry renderer (dwg_to_svg) rather than its DXF
//  writer: the DXF writer embeds AutoCAD Map/Civil 3D object data that strict
//  DXF parsers choke on ("Cannot parse group code: </MapLib>"), whereas the SVG
//  renderer walks the geometry directly and produces something that always
//  displays. (DXF files are handled separately, in the browser, by dxf-viewer —
//  this WASM build cannot read DXF input.)
//
//  LibreDWG is GPLv3 and runs SERVER-SIDE ONLY here — we serve its output (an
//  SVG), never the binary — so it imposes no licensing obligation on the app.
//
//  The WASM module loads once; rendered SVGs are kept in a small LRU keyed by
//  the document's immutable stored_name.
// ---------------------------------------------------------------------------
const path = require('path');

let _statePromise = null;

function wasmDir() {
  const mainPath = require.resolve('@mlightcad/libredwg-web');
  return path.join(path.dirname(mainPath), '..', 'wasm') + path.sep;
}

// ESM-only package — load via dynamic import even though we are CommonJS.
function getState() {
  if (!_statePromise) {
    _statePromise = (async () => {
      const mod = await import('@mlightcad/libredwg-web');
      const LibreDwg = mod.LibreDwg || (mod.default && mod.default.LibreDwg);
      const FileType = mod.Dwg_File_Type || (mod.default && mod.default.Dwg_File_Type);
      if (!LibreDwg || !FileType) throw new Error('libredwg-web: expected exports not found.');
      const lib = await LibreDwg.create(wasmDir());
      return { lib, FileType };
    })().catch((err) => {
      _statePromise = null; // allow a retry if init failed
      throw err;
    });
  }
  return _statePromise;
}

// --- tiny LRU of rendered SVG buffers ---------------------------------------
const cache = new Map();
const CACHE_MAX = 12;
function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v);
  return v;
}
function cacheSet(key, buf) {
  cache.set(key, buf);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function convertFailed() {
  const err = new Error('This drawing could not be rendered — it may use features LibreDWG cannot read, or be a newer/unsupported AutoCAD version. You can still download it.');
  err.code = 'CAD_CONVERT_FAILED';
  return err;
}

// Convert a DWG buffer to an SVG Buffer. CAD model space is black, so pure-black
// entities (AutoCAD "color 7" rendered as black) would be invisible on our dark
// canvas — remap them to white so the linework always shows.
async function dwgToSvg(buffer, cacheKey) {
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }
  const { lib, FileType } = await getState();
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const ptr = lib.dwg_read_data(ab, FileType.DWG);
  if (ptr === null || ptr === undefined) throw convertFailed();

  let svg;
  try {
    const db = lib.convert(ptr);
    svg = lib.dwg_to_svg(db);
  } catch {
    throw convertFailed();
  } finally {
    try { lib.dwg_free(ptr); } catch { /* */ }
  }
  if (!svg || typeof svg !== 'string' || !svg.includes('<svg')) throw convertFailed();

  svg = svg.replace(
    /(stroke|fill)="(#0{3}|#0{6}|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))"/gi,
    '$1="#ffffff"'
  );

  const out = Buffer.from(svg, 'utf8');
  if (cacheKey) cacheSet(cacheKey, out);
  return out;
}

module.exports = { dwgToSvg };
