// ---------------------------------------------------------------------------
//  CadSvgViewer — displays a DWG drawing that the backend rendered to SVG with
//  LibreDWG. We inject the SVG and provide scroll-to-zoom / drag-to-pan over a
//  black (model-space) background. The drawing never leaves our own servers.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Loading, ErrorBanner } from './ui.jsx';

export default function CadSvgViewer({ docId }) {
  const hostRef = useRef(null);
  const svgRef = useRef(null);
  const view = useRef({ scale: 1, tx: 0, ty: 0, drag: false, lx: 0, ly: 0 });
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');

  function apply() {
    const v = view.current;
    if (svgRef.current) {
      svgRef.current.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
    }
  }
  function reset() {
    view.current.scale = 1;
    view.current.tx = 0;
    view.current.ty = 0;
    apply();
  }

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    setStatus('loading');
    setError('');

    (async () => {
      try {
        const svgText = await api.fetchCadSvg(docId);
        if (cancelled || !host) return;
        // Our own LibreDWG output, but strip scripts defensively before inject.
        host.innerHTML = svgText.replace(/<script[\s\S]*?<\/script>/gi, '');
        const svg = host.querySelector('svg');
        if (!svg) throw new Error('The drawing had no displayable content.');
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.display = 'block';
        svg.style.transformOrigin = '0 0';
        svgRef.current = svg;
        view.current = { scale: 1, tx: 0, ty: 0, drag: false, lx: 0, ly: 0 };
        apply();
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
      if (host) host.innerHTML = '';
      svgRef.current = null;
    };
  }, [docId]);

  // Wheel zoom toward the cursor. Attached natively so preventDefault works
  // (React's onWheel can be passive).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const onWheel = (e) => {
      if (!svgRef.current) return;
      e.preventDefault();
      const v = view.current;
      const rect = host.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.min(80, Math.max(0.05, v.scale * factor));
      v.tx = cx - (cx - v.tx) * (ns / v.scale);
      v.ty = cy - (cy - v.ty) * (ns / v.scale);
      v.scale = ns;
      apply();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  function onPointerDown(e) {
    const v = view.current;
    v.drag = true;
    v.lx = e.clientX;
    v.ly = e.clientY;
    if (e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    }
  }
  function onPointerMove(e) {
    const v = view.current;
    if (!v.drag) return;
    v.tx += e.clientX - v.lx;
    v.ty += e.clientY - v.ly;
    v.lx = e.clientX;
    v.ly = e.clientY;
    apply();
  }
  function onPointerUp() { view.current.drag = false; }

  return (
    <div className="cadviewer">
      <div
        className="cadviewer-host cadviewer-svg"
        ref={hostRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
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
          <button className="btn btn-sm" onClick={reset}>Fit</button>
          <span className="cadviewer-hint">Scroll to zoom · drag to pan</span>
        </div>
      )}
    </div>
  );
}
