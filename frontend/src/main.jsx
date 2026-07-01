import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { StoreProvider } from './lib/store.jsx';
import './lib/i18n.js';
import './lib/theme.js';
import './styles.css';

// DEV/LOCAL ONLY: one-click sign-in for the local sandbox. If the URL carries
// a #token=... (or ?token=...), stash it and drop the user straight into the
// app. import.meta.env.DEV is FALSE in the production build, so this code is
// stripped out entirely and can never exist on the deployed site.
if (import.meta.env.DEV) {
  const raw = window.location.hash + '&' + window.location.search;
  const m = raw.match(/token=([^&]+)/);
  if (m) {
    try { localStorage.setItem('spd_token', decodeURIComponent(m[1])); } catch (_) {}
    window.history.replaceState(null, '', '/app');
  }
}

// App-wide safety net: if any screen throws, show a recovery card with a
// Reload button instead of a blank white page the user can't escape.
function AppCrash() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 24, textAlign: 'center',
    }}>
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: '#64748b', marginBottom: 20, lineHeight: 1.5 }}>
          The page hit an unexpected error. Reloading usually clears it — your
          data is safe.
        </p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<AppCrash />}>
      <BrowserRouter>
        <StoreProvider>
          <App />
        </StoreProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
