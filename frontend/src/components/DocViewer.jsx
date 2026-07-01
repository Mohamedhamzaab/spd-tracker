// ---------------------------------------------------------------------------
//  DocViewer — in-page overlay that previews a document without leaving the
//  page. The file is fetched authenticated and rendered from an in-memory
//  blob: URL (PDF in an iframe, images in <img>). Read-only: it never writes.
//  Word (.docx) and Excel (.xlsx/.csv) render client-side too — everything
//  else keeps its Download button.
// ---------------------------------------------------------------------------
import { useEffect, useState, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { Loading, ErrorBanner } from './ui.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

// CAD viewers are heavy, so load them only when a drawing is opened — and load
// only the one that matches: an SVG viewer for .dwg (rendered server-side), and
// dxf-viewer (+ its own three.js) for native .dxf.
const CadSvgViewer = lazy(() => import('./CadSvgViewer.jsx'));
const CadDxfViewer = lazy(() => import('./CadDxfViewer.jsx'));
// Office viewers (docx-preview / SheetJS) are pulled in only when a Word or
// Excel file is opened — each renders fully in the browser from the raw bytes.
const OfficeDocxViewer = lazy(() => import('./OfficeDocxViewer.jsx'));
const OfficeXlsxViewer = lazy(() => import('./OfficeXlsxViewer.jsx'));

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg'];
const CAD_EXT = ['dwg', 'dxf'];
// Modern XML office formats only — the client-side libraries can't read the
// legacy binary .doc (those keep their Download button). SheetJS does read
// legacy .xls, so it stays in the Excel set.
const DOCX_EXT = ['docx'];
const XLSX_EXT = ['xlsx', 'xlsm', 'xls', 'csv'];

function ext(doc) {
  return (doc?.original_name || '').toLowerCase().split('.').pop();
}
function isImage(doc) {
  const m = (doc?.mime_type || '').toLowerCase();
  return m.startsWith('image/') || IMG_EXT.includes(ext(doc));
}
// CAD drawings render via dxf-viewer (DWG converted to DXF server-side).
function isCad(doc) {
  return CAD_EXT.includes(ext(doc));
}
function isDocx(doc) {
  return DOCX_EXT.includes(ext(doc));
}
function isXlsx(doc) {
  return XLSX_EXT.includes(ext(doc));
}
// Office files render their own bytes client-side, so they skip the blob fetch.
function isOffice(doc) {
  return isDocx(doc) || isXlsx(doc);
}
// Types the browser can render inline.
export function isPreviewable(doc) {
  const m = (doc?.mime_type || '').toLowerCase();
  if (m === 'application/pdf' || m.startsWith('image/')) return true;
  return ['pdf', ...IMG_EXT, ...CAD_EXT, ...DOCX_EXT, ...XLSX_EXT].includes(ext(doc));
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

export default function DocViewer({ doc, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);

  const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  const zoomIn = () => setZoom((z) => clampZoom(z + ZOOM_STEP));
  const zoomOut = () => setZoom((z) => clampZoom(z - ZOOM_STEP));
  const resetZoom = () => setZoom(1);

  // Fetch the file (authenticated) → blob: URL. Revoke on close/unmount.
  // CAD drawings are handled by CadViewer (its own DXF fetch), so skip here.
  useEffect(() => {
    let cancelled = false;
    let objUrl = null;
    setError('');
    setUrl(null);
    setZoom(1);
    if (isCad(doc) || isOffice(doc)) { setLoading(false); return; }
    setLoading(true);
    api
      .fetchDocBlobUrl(doc.id)
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        objUrl = u;
        setUrl(u);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) { setError(e.message || 'Could not load the document.'); setLoading(false); }
      });
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [doc.id]);

  // Esc closes the viewer; +/- zoom; 0 resets.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-' || e.key === '_') zoomOut();
      else if (e.key === '0') resetZoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pct = Math.round(zoom * 100);
  // Grow the element past the viewport when zoomed so the scroll container can
  // actually pan to the hidden parts (transforms don't create scroll space).
  const imgStyle = zoom > 1
    ? { width: pct + '%', maxWidth: 'none', height: 'auto', flexShrink: 0 }
    : undefined;
  const frameStyle = { width: pct + '%', height: pct + '%', flexShrink: 0 };

  // Portal to <body>: the viewer is often opened from inside a modal whose
  // backdrop uses backdrop-filter, which turns the modal into the containing
  // block for position:fixed children. That would pin this viewer to the top
  // of the scrollable modal instead of the viewport (opens off-screen when the
  // user has scrolled down). Rendering at the body root keeps it truly fixed.
  return createPortal(
    <div className="docviewer-scrim" onClick={onClose}>
      <div className="docviewer" onClick={(e) => e.stopPropagation()}>
        <div className="docviewer-head">
          <div className="docviewer-name" title={doc.original_name}>{doc.original_name}</div>
          <div className="docviewer-actions">
            {!loading && !error && !isCad(doc) && (
              <div className="docviewer-zoom" role="group" aria-label="Zoom">
                <button className="btn btn-sm btn-ghost" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">−</button>
                <button className="btn btn-sm btn-ghost docviewer-zoom-label" onClick={resetZoom} title="Reset zoom">{pct}%</button>
                <button className="btn btn-sm btn-ghost" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">+</button>
              </div>
            )}
            <button className="btn btn-sm" onClick={() => api.downloadDoc(doc.id, doc.original_name)}>
              Download
            </button>
            <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="docviewer-body">
          <ErrorBoundary
            resetKey={doc.id}
            fallback={
              <div className="docviewer-fallback">
                <ErrorBanner message="This file couldn’t be previewed in the browser." />
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                  onClick={() => api.downloadDoc(doc.id, doc.original_name)}
                >
                  Download instead
                </button>
              </div>
            }
          >
          {isCad(doc) ? (
            <Suspense fallback={<Loading label="Loading CAD viewer" />}>
              {ext(doc) === 'dwg'
                ? <CadSvgViewer docId={doc.id} />
                : <CadDxfViewer docId={doc.id} />}
            </Suspense>
          ) : isDocx(doc) ? (
            <Suspense fallback={<Loading label="Loading Word viewer" />}>
              <OfficeDocxViewer docId={doc.id} zoom={zoom} />
            </Suspense>
          ) : isXlsx(doc) ? (
            <Suspense fallback={<Loading label="Loading Excel viewer" />}>
              <OfficeXlsxViewer docId={doc.id} zoom={zoom} />
            </Suspense>
          ) : loading ? (
            <Loading label="Loading document" />
          ) : error ? (
            <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>
          ) : isImage(doc) ? (
            <img src={url} alt={doc.original_name} className="docviewer-img" style={imgStyle} />
          ) : (
            <iframe src={url} title={doc.original_name} className="docviewer-frame" style={frameStyle} />
          )}
          </ErrorBoundary>
        </div>
      </div>
    </div>,
    document.body
  );
}
