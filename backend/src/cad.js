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
//  Each drawing is rendered in its own short-lived process (cadWorker.js), one
//  at a time, under a memory watchdog. LibreDWG is memory-hungry (a 3-4 MB
//  drawing can need several hundred MB) and its WASM heap never shrinks, so
//  running it inside the API got the whole server OOM-killed (15 Nov 2026).
//  Now a drawing that does not fit is stopped and the user is told to download
//  it; the API itself is never at risk. Rendered SVGs are kept in a small
//  memory-bounded LRU keyed by the document's immutable stored_name.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { logger } = require('./logger');

const WORKER = path.join(__dirname, 'cadWorker.js');
const TIMEOUT_MS = Number(process.env.CAD_TIMEOUT_MS) || 60000;
const POLL_MS = 50;
// Headroom kept free on the instance while a drawing renders. LibreDWG can
// grow by ~300 MB/s, so this covers one poll interval with room to spare.
const MARGIN_MB = Number(process.env.CAD_MEMORY_MARGIN_MB) || 48;
// Only used where there is no container limit to watch (a dev machine).
const WORKER_MAX_MB = Number(process.env.CAD_WORKER_MAX_MB) || 1024;

const MB = 1024 * 1024;

function tooLarge() {
  const err = new Error('This drawing is too large to preview on the server. You can still download it.');
  err.code = 'CAD_TOO_LARGE';
  return err;
}

function tooSlow() {
  const err = new Error('This drawing took too long to render. You can still download it.');
  err.code = 'CAD_TIMEOUT';
  return err;
}

function convertFailed() {
  const err = new Error('This drawing could not be rendered — it may use features LibreDWG cannot read, or be a newer/unsupported AutoCAD version. You can still download it.');
  err.code = 'CAD_CONVERT_FAILED';
  return err;
}

// --- memory of the whole instance (the container's cgroup) ------------------
// Render kills every process in the container once it passes its limit, so
// the worker is judged on the instance's total memory, not just its own.
function readNum(file) {
  try { return Number(fs.readFileSync(file, 'utf8').trim()); } catch { return NaN; }
}
function statValue(file, key) {
  try {
    const m = new RegExp(`^${key} (\\d+)$`, 'm').exec(fs.readFileSync(file, 'utf8'));
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}
const realLimit = (n) => Number.isFinite(n) && n > 0 && n < 64 * 1024 * MB;
const CGROUP = (() => {
  const v2 = '/sys/fs/cgroup';
  const v1 = '/sys/fs/cgroup/memory';
  if (fs.existsSync(`${v2}/memory.current`)) {
    return { cur: `${v2}/memory.current`, max: `${v2}/memory.max`, stat: `${v2}/memory.stat`, inactive: 'inactive_file' };
  }
  if (fs.existsSync(`${v1}/memory.usage_in_bytes`)) {
    return { cur: `${v1}/memory.usage_in_bytes`, max: `${v1}/memory.limit_in_bytes`, stat: `${v1}/memory.stat`, inactive: 'total_inactive_file' };
  }
  return null;
})();
// The instance's memory limit: the cgroup's own file ("max" = none reads as
// NaN), else Node's reading of it. None on a dev machine.
const LIMIT = (() => {
  const fromCgroup = CGROUP ? readNum(CGROUP.max) : NaN;
  if (realLimit(fromCgroup)) return fromCgroup;
  const fromNode = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0;
  return realLimit(fromNode) ? fromNode : null;
})();
const CAN_READ_USAGE = Boolean(CGROUP) && Number.isFinite(readNum(CGROUP.cur));

// Working set the way the kubelet counts it: usage minus reclaimable cache.
function instanceUsed() {
  return readNum(CGROUP.cur) - statValue(CGROUP.stat, CGROUP.inactive);
}

logger.info(
  LIMIT
    ? `CAD previews: drawings render within the instance's ${Math.round(LIMIT / MB)} MB, keeping ${MARGIN_MB} MB free`
    : `CAD previews: no instance memory limit found, so each drawing may use up to ${WORKER_MAX_MB} MB`
);

function workerRss(pid, cb) {
  fs.readFile(`/proc/${pid}/status`, 'utf8', (err, txt) => {
    if (!err) {
      const m = /VmRSS:\s+(\d+) kB/.exec(txt);
      return cb(m ? Number(m[1]) * 1024 : 0);
    }
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], (e, out) => cb(e ? 0 : Number(String(out).trim()) * 1024 || 0));
  });
}

// --- one worker run ---------------------------------------------------------
function renderInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER], { stdio: ['pipe', 'inherit', 'inherit', 'pipe'] });
    const chunks = [];
    let stoppedFor = null;
    const stop = (why) => {
      if (stoppedFor) return;
      stoppedFor = why;
      child.kill('SIGKILL');
    };

    const watch = setInterval(() => {
      if (LIMIT && CAN_READ_USAGE) {
        if (instanceUsed() > LIMIT - MARGIN_MB * MB) stop('memory');
      } else if (LIMIT) {
        workerRss(child.pid, (rss) => {
          if (process.memoryUsage().rss + rss > LIMIT - MARGIN_MB * MB) stop('memory');
        });
      } else {
        workerRss(child.pid, (rss) => { if (rss > WORKER_MAX_MB * MB) stop('memory'); });
      }
    }, POLL_MS);
    const timer = setTimeout(() => stop('time'), TIMEOUT_MS);

    child.stdio[3].on('data', (c) => chunks.push(c));
    child.stdin.on('error', () => { /* worker exited before reading it all */ });
    child.on('error', (err) => { stoppedFor = stoppedFor || 'spawn'; logger.error({ err }, 'CAD worker failed to start'); });
    child.on('close', (code, signal) => {
      clearInterval(watch);
      clearTimeout(timer);
      if (stoppedFor === 'memory' || (!stoppedFor && signal === 'SIGKILL')) {
        logger.warn({ bytes: buffer.length }, 'CAD worker stopped: drawing too large for the memory available');
        return reject(tooLarge());
      }
      if (stoppedFor === 'time') {
        logger.warn({ bytes: buffer.length }, 'CAD worker stopped: timed out');
        return reject(tooSlow());
      }
      if (code === 0 && !stoppedFor) return resolve(Buffer.concat(chunks));
      if (code !== 2) logger.warn({ code, signal, bytes: buffer.length }, 'CAD worker failed');
      return reject(convertFailed());
    });

    child.stdin.end(buffer);
  });
}

// One drawing at a time: two workers side by side could still fill the
// instance between them.
let queue = Promise.resolve();
function oneAtATime(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// --- small LRU of rendered SVG buffers, bounded by total size ---------------
const CACHE_MAX_BYTES = 32 * MB;
const CACHE_ITEM_MAX = 12 * MB; // bigger drawings are re-rendered when reopened
const cache = new Map();
let cacheBytes = 0;
function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v);
  return v;
}
function cacheSet(key, buf) {
  if (buf.length > CACHE_ITEM_MAX || cache.has(key)) return;
  cache.set(key, buf);
  cacheBytes += buf.length;
  while (cacheBytes > CACHE_MAX_BYTES) {
    const [oldKey, oldBuf] = cache.entries().next().value;
    cache.delete(oldKey);
    cacheBytes -= oldBuf.length;
  }
}

// The same drawing opened twice while it renders shares one worker run.
const inflight = new Map();

// Convert a DWG buffer to an SVG Buffer.
async function dwgToSvg(buffer, cacheKey) {
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  }
  const job = oneAtATime(() => renderInWorker(buffer)).then((out) => {
    if (cacheKey) cacheSet(cacheKey, out);
    return out;
  });
  if (!cacheKey) return job;
  inflight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    inflight.delete(cacheKey);
  }
}

module.exports = { dwgToSvg };
