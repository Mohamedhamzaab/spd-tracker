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
  const html = useMemo(() => {
    if (!wb) return '';
    const name = wb.SheetNames[active];
    const ws = name && wb.Sheets[name];
    if (!ws) return '';
    return XLSX.utils.sheet_to_html(ws, { id: 'xlsx-sheet' });
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
      <div className="xlsx-sheet-wrap" style={{ zoom }}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
