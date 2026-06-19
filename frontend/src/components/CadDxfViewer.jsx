// ---------------------------------------------------------------------------
//  CadDxfViewer — renders a native .dxf drawing in-page with dxf-viewer
//  (MPL-2.0, WebGL): pan, zoom, per-layer show/hide. Used only for .dxf files;
//  .dwg drawings are rendered to SVG server-side (CadSvgViewer) because this
//  WASM build can't read DXF and LibreDWG's DXF *output* trips strict parsers.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { DxfViewer } from 'dxf-viewer';
import { api } from '../lib/api.js';
import { Loading, ErrorBanner } from './ui.jsx';

// Self-hosted font so text/dimension labels render (geometry renders without).
const FONTS = ['/fonts/Roboto-Regular.ttf'];

export default function CadDxfViewer({ docId }) {
  const hostRef = useRef(null);
  const viewerRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [layers, setLayers] = useState([]);
  const [hidden, setHidden] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    let blobUrl = null;
    let viewer = null;
    setStatus('loading');
    setError('');
    setLayers([]);
    setHidden(new Set());

    (async () => {
      try {
        blobUrl = await api.fetchDxfBlobUrl(docId);
        if (cancelled || !hostRef.current) return;
        viewer = new DxfViewer(hostRef.current, { autoResize: true, antialias: true });
        viewerRef.current = viewer;
        await viewer.Load({ url: blobUrl, fonts: FONTS });
        if (cancelled) { viewer.Destroy(); viewerRef.current = null; return; }
        const lyrs = (viewer.GetLayers ? viewer.GetLayers(true) : []) || [];
        setLayers(lyrs.map((l) => ({ name: l.name, label: l.displayName || l.name })));
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Could not render this drawing.');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (viewer) { try { viewer.Destroy(); } catch { /* */ } }
      viewerRef.current = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [docId]);

  function toggleLayer(name) {
    setHidden((prev) => {
      const next = new Set(prev);
      const willShow = next.has(name);
      if (willShow) next.delete(name); else next.add(name);
      if (viewerRef.current) viewerRef.current.ShowLayer(name, willShow);
      return next;
    });
  }
  function fit() {
    try { viewerRef.current && viewerRef.current.FitView && viewerRef.current.FitView(); }
    catch { /* */ }
  }

  return (
    <div className="cadviewer">
      <div className="cadviewer-host" ref={hostRef} />

      {status === 'loading' && (
        <div className="cadviewer-overlay"><Loading label="Rendering drawing" /></div>
      )}
      {status === 'error' && (
        <div className="cadviewer-overlay">
          <div style={{ padding: 20, maxWidth: 460 }}><ErrorBanner message={error} /></div>
        </div>
      )}

      {status === 'ready' && (
        <div className="cadviewer-tools">
          <button className="btn btn-sm" onClick={fit}>Fit</button>
          {layers.length > 0 && (
            <details className="cadviewer-layers">
              <summary>Layers · {layers.length}</summary>
              <div className="cadviewer-layer-list">
                {layers.map((l) => (
                  <label className="cadviewer-layer" key={l.name}>
                    <input
                      type="checkbox"
                      checked={!hidden.has(l.name)}
                      onChange={() => toggleLayer(l.name)}
                    />
                    <span title={l.label}>{l.label}</span>
                  </label>
                ))}
              </div>
            </details>
          )}
          <span className="cadviewer-hint">Scroll to zoom · drag to pan</span>
        </div>
      )}
    </div>
  );
}
