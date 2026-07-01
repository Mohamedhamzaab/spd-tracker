// ---------------------------------------------------------------------------
//  OfficeDocxViewer — render a Word .docx in the browser with docx-preview
//  (Apache-2.0). The file is fetched authenticated as an ArrayBuffer and
//  rendered into a container; the bytes never leave the browser. Read-only.
//  Lazy-loaded by DocViewer so the library is only pulled in when a Word doc
//  is opened.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { api } from '../lib/api.js';
import { Loading, ErrorBanner } from './ui.jsx';

export default function OfficeDocxViewer({ docId, zoom = 1 }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .fetchDocArrayBuffer(docId)
      .then(async (buf) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        await renderAsync(buf, containerRef.current, null, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          experimental: true,
        });
        if (!cancelled) setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || 'Could not render this Word document.');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [docId]);

  return (
    <div className="office-doc office-docx" style={{ zoom }}>
      {loading && <Loading label="Rendering document" />}
      {error && <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>}
      {/* docx-preview injects the rendered pages here. */}
      <div ref={containerRef} style={{ display: loading || error ? 'none' : 'block' }} />
    </div>
  );
}
