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

export default function DocViewer({ doc, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Fetch the file (authenticated) → blob: URL. Revoke on close/unmount.
  useEffect(() => {
    let cancelled = false;
    let objUrl = null;
    setLoading(true);
    setError('');
    setUrl(null);
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

  // Esc closes the viewer.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="docviewer-scrim" onClick={onClose}>
      <div className="docviewer" onClick={(e) => e.stopPropagation()}>
        <div className="docviewer-head">
          <div className="docviewer-name" title={doc.original_name}>{doc.original_name}</div>
          <div className="docviewer-actions">
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
            <img src={url} alt={doc.original_name} className="docviewer-img" />
          ) : (
            <iframe src={url} title={doc.original_name} className="docviewer-frame" />
          )}
        </div>
      </div>
    </div>
  );
}
