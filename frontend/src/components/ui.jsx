// ---------------------------------------------------------------------------
//  Shared UI building blocks: layout pieces, table, pills, buttons, modal,
//  a controlled form, file list, toast. Kept in one file so pages stay small.
// ---------------------------------------------------------------------------
import { useEffect, useState, createContext, useContext, useCallback } from 'react';

/* ---- formatting --------------------------------------------------------- */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${String(
    d.getFullYear()
  ).slice(2)}`;
}
export function pct(n) {
  return `${((Number(n) || 0) * 100).toFixed(1)}%`;
}
export function fileSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/* ---- loading & empty ---------------------------------------------------- */
export function Loading({ label = 'Loading' }) {
  return (
    <div className="center-load">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}
export function Empty({ title = 'Nothing here yet', sub }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  );
}
export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="banner-err">{message}</div>;
}

/* ---- section ------------------------------------------------------------ */
export function Section({ title, note, action, children }) {
  return (
    <div>
      <div className="section-head">
        <div className="section-title">{title}</div>
        {note && <div className="section-note">{note}</div>}
        {action}
      </div>
      {children}
    </div>
  );
}

/* ---- KPI ---------------------------------------------------------------- */
export function Kpi({ label, value, foot, tone }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value' + (tone ? ' ' + tone : '')}>{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

/* ---- bar chart ---------------------------------------------------------- */
export function BarChart({ rows, max, colorFor }) {
  const peak = max || Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <div className="bar-label">{r.label}</div>
          <div className="bar-track">
            <div
              className={'bar-fill ' + (colorFor ? colorFor(r) : '')}
              style={{ width: `${(r.value / peak) * 100}%` }}
            />
          </div>
          <div className="bar-value">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- pills -------------------------------------------------------------- */
const ENGAGEMENT_TONE = {
  Identified: 'grey',
  Contacted: 'navy',
  'Response Received': 'amber',
  'Outcome Secured': 'green',
};
const NOC_TONE = {
  'Objection Raised': 'red',
  'Non-objection Granted': 'green',
  'Non-objection with Conditions': 'amber',
};

export function Pill({ tone = 'grey', children }) {
  return (
    <span className={'pill ' + tone}>
      <span className="dot" />
      {children}
    </span>
  );
}
export function EngagementPill({ status }) {
  return <Pill tone={ENGAGEMENT_TONE[status] || 'grey'}>{status}</Pill>;
}
export function StatusPill({ status }) {
  if (!status) return null;
  return <Pill tone={NOC_TONE[status] || 'grey'}>{status}</Pill>;
}
export function DirectionPill({ direction }) {
  return <Pill tone={direction === 'Inbound' ? 'green' : 'navy'}>{direction}</Pill>;
}

/* ---- modal -------------------------------------------------------------- */
export function Modal({ title, sub, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className={'modal' + (wide ? ' wide' : '')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {sub && <div className="modal-sub">{sub}</div>}
          </div>
          <button className="x-btn" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>{message}</p>
    </Modal>
  );
}

/* ---- controlled form ---------------------------------------------------- */
// fields: [{ name, label, type, options, required, span, help, placeholder }]
// type: text | textarea | select | date | checkbox
export function FormFields({ fields, values, onChange, disabled }) {
  return (
    <div className="form-grid">
      {fields.map((f) => {
        const span = f.span === 2 ? ' col-2' : '';
        const val = values[f.name] ?? '';
        if (f.type === 'checkbox') {
          return (
            <div className={'field' + span} key={f.name}>
              <div className="check-row">
                <input
                  type="checkbox"
                  id={'f_' + f.name}
                  checked={!!values[f.name]}
                  disabled={disabled}
                  onChange={(e) => onChange(f.name, e.target.checked)}
                />
                <label className="field-label" style={{ margin: 0 }} htmlFor={'f_' + f.name}>
                  {f.label}
                </label>
              </div>
              {f.help && <div className="field-help">{f.help}</div>}
            </div>
          );
        }
        return (
          <div className={'field' + span} key={f.name}>
            <label className="field-label" htmlFor={'f_' + f.name}>
              {f.label}
              {f.required && <span className="req">*</span>}
            </label>
            {f.type === 'textarea' ? (
              <textarea
                id={'f_' + f.name}
                className="textarea"
                value={val}
                placeholder={f.placeholder}
                disabled={disabled}
                onChange={(e) => onChange(f.name, e.target.value)}
              />
            ) : f.type === 'select' ? (
              <select
                id={'f_' + f.name}
                className="select"
                value={val}
                disabled={disabled || f.disabled}
                onChange={(e) => onChange(f.name, e.target.value)}
              >
                <option value="">{f.placeholder || 'Select...'}</option>
                {(f.options || []).map((o) => {
                  const ov = typeof o === 'object' ? o.value : o;
                  const ol = typeof o === 'object' ? o.label : o;
                  return (
                    <option key={ov} value={ov}>
                      {ol}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                id={'f_' + f.name}
                className="input"
                type={f.type === 'date' ? 'date' : 'text'}
                value={val}
                placeholder={f.placeholder}
                disabled={disabled}
                onChange={(e) => onChange(f.name, e.target.value)}
              />
            )}
            {f.help && <div className="field-help">{f.help}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ---- toast -------------------------------------------------------------- */
const ToastContext = createContext(null);
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((message, kind = 'ok') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={'toast' + (toast.kind === 'err' ? ' err' : '')}>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
export function useToast() {
  return useContext(ToastContext) || (() => {});
}
