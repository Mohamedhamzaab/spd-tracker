// ---------------------------------------------------------------------------
//  CAD worker — renders ONE drawing in its own short-lived process.
//
//  cad.js starts this per drawing: the DWG bytes arrive on stdin, the SVG
//  leaves on file descriptor 3, and the process exits. (fd 3 rather than
//  stdout because LibreDWG prints its own diagnostics to the console.)
//
//  Why a separate process: LibreDWG runs as WebAssembly, and a WASM heap can
//  only grow. Converting a big drawing inside the API left the API holding
//  that memory for good, and on a 512 MB instance a few drawings in a row got
//  the whole server killed. Here the memory goes back to the system when the
//  process exits, and a drawing too heavy to render ends only this process.
//
//  Exit codes: 0 = SVG written, 2 = LibreDWG could not render the drawing.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

function wasmDir() {
  const mainPath = require.resolve('@mlightcad/libredwg-web');
  return path.join(path.dirname(mainPath), '..', 'wasm') + path.sep;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function render(buffer) {
  // ESM-only package — load via dynamic import even though we are CommonJS.
  const mod = await import('@mlightcad/libredwg-web');
  const LibreDwg = mod.LibreDwg || (mod.default && mod.default.LibreDwg);
  const FileType = mod.Dwg_File_Type || (mod.default && mod.default.Dwg_File_Type);
  if (!LibreDwg || !FileType) throw new Error('libredwg-web: expected exports not found.');
  const lib = await LibreDwg.create(wasmDir());

  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const ptr = lib.dwg_read_data(ab, FileType.DWG);
  if (ptr === null || ptr === undefined) return null;

  let svg;
  try {
    const db = lib.convert(ptr);
    svg = lib.dwg_to_svg(db);
  } catch {
    return null;
  } finally {
    try { lib.dwg_free(ptr); } catch { /* */ }
  }
  if (!svg || typeof svg !== 'string' || !svg.includes('<svg')) return null;

  // CAD model space is black, so pure-black entities (AutoCAD "color 7"
  // rendered as black) would be invisible on our dark canvas — remap them to
  // white so the linework always shows.
  return svg.replace(
    /(stroke|fill)="(#0{3}|#0{6}|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))"/gi,
    '$1="#ffffff"'
  );
}

(async () => {
  const svg = await render(await readStdin());
  if (!svg) process.exit(2);
  fs.createWriteStream(null, { fd: 3 }).end(svg, () => process.exit(0));
})().catch((err) => {
  console.error('CAD worker failed:', (err && err.stack) || err);
  process.exit(1);
});
