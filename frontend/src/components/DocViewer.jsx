// ---------------------------------------------------------------------------
//  DocViewer — in-page overlay that previews a document without leaving the
//  page. The file is fetched authenticated and rendered from an in-memory
//  blob: URL (PDF in an iframe, images in <img>). Read-only: it never writes.
//  Office files (.docx/.xlsx/...) can't render in-browser, so the lists only
//  show "View" for previewable types and keep "Download" for everything.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Loading, ErrorBanner } from './ui.jsx';

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg'];

function ext(doc) {
  return (doc?.original_name || '').toLowerCase().split('.').pop();
}
function isImage(doc) {
  const m = (doc?.mime_type || '').toLowerCase();
  return m.startsWith('image/') || IMG_EXT.includes(ext(doc));
}
// Types the browser can render inline.
export function isPreviewable(doc) {
  const m = (doc?.mime_type || '').toLowerCase();
  if (m === 'application/pdf' || m.startsWith('image/')) return true;
  return ['pdf', ...IMG_EXT].includes(ext(doc));
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
  useEffect(() => {
    let cancelled = false;
    let objUrl = null;
    setLoading(true);
    setError('');
    setUrl(null);
    setZoom(1);
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

  return (
    <div className="docviewer-scrim" onClick={onClose}>
      <div className="docviewer" onClick={(e) => e.stopPropagation()}>
        <div className="docviewer-head">
          <div className="docviewer-name" title={doc.original_name}>{doc.original_name}</div>
          <div className="docviewer-actions">
            {!loading && !error && (
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
          {loading ? (
            <Loading label="Loading document" />
          ) : error ? (
            <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>
          ) : isImage(doc) ? (
            <img src={url} alt={doc.original_name} className="docviewer-img" style={imgStyle} />
          ) : (
            <iframe src={url} title={doc.original_name} className="docviewer-frame" style={frameStyle} />
          )}
        </div>
      </div>
    </div>
  );
}
