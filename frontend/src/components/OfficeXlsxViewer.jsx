// ---------------------------------------------------------------------------
//  OfficeXlsxViewer — render an Excel workbook (.xlsx/.xls/.csv) in the browser
//  with SheetJS (Apache-2.0, patched CDN build). Fetched authenticated as an
//  ArrayBuffer and parsed in-browser; the bytes never leave the browser.
//  Read-only. Shows a tab per sheet and renders the active sheet as a table
//  (data + merged cells; not charts or cell colours). Lazy-loaded by DocViewer.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../lib/api.js';
import { Loading, ErrorBanner } from './ui.jsx';

export default function OfficeXlsxViewer({ docId, zoom = 1 }) {
  const [wb, setWb] = useState(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setWb(null);
    setActive(0);
    api
      .fetchDocArrayBuffer(docId)
      .then((buf) => {
        if (cancelled) return;
        // cellStyles keeps merged-cell info; dense arrays keep big sheets lean.
        const book = XLSX.read(new Uint8Array(buf), { type: 'array' });
        setWb(book);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || 'Could not read this spreadsheet.');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [docId]);

  // Render only the active sheet to HTML (SheetJS escapes every cell value).
  // Guarded: a malformed sheet must not throw during render (that would crash
  // the app), and a huge sheet is clipped so it can't freeze the tab.
  const { html, truncated } = useMemo(() => {
    if (!wb) return { html: '', truncated: false };
    try {
      const name = wb.SheetNames[active];
      const ws = name && wb.Sheets[name];
      if (!ws) return { html: '', truncated: false };

      const MAX_ROWS = 2000;
      const MAX_COLS = 100;
      let target = ws;
      let trunc = false;
      if (ws['!ref']) {
        const r = XLSX.utils.decode_range(ws['!ref']);
        if (r.e.r - r.s.r > MAX_ROWS || r.e.c - r.s.c > MAX_COLS) {
          trunc = true;
          target = { ...ws };
          target['!ref'] = XLSX.utils.encode_range({
            s: { r: r.s.r, c: r.s.c },
            e: {
              r: Math.min(r.e.r, r.s.r + MAX_ROWS),
              c: Math.min(r.e.c, r.s.c + MAX_COLS),
            },
          });
        }
      }
      return { html: XLSX.utils.sheet_to_html(target, { id: 'xlsx-sheet' }), truncated: trunc };
    } catch {
      return { html: '', truncated: false, failed: true };
    }
  }, [wb, active]);

  if (loading) return <Loading label="Reading spreadsheet" />;
  if (error) return <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>;
  if (!wb || !wb.SheetNames.length) return null;

  return (
    <div className="office-doc office-xlsx">
      {wb.SheetNames.length > 1 && (
        <div className="xlsx-tabs">
          {wb.SheetNames.map((n, i) => (
            <button
              key={n}
              type="button"
              className={'xlsx-tab' + (i === active ? ' xlsx-tab-on' : '')}
              onClick={() => setActive(i)}
              title={n}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      {truncated && (
        <div className="section-note" style={{ padding: '6px 12px' }}>
          Large sheet — showing the first 2000 rows. Download the file for the full data.
        </div>
      )}
      <div className="xlsx-sheet-wrap" style={{ zoom }}>
        {html
          ? <div dangerouslySetInnerHTML={{ __html: html }} />
          : <div className="section-note" style={{ padding: 16 }}>This sheet couldn’t be displayed.</div>}
      </div>
    </div>
  );
}
