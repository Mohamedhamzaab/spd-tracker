// ---------------------------------------------------------------------------
//  App. Routing.
//    /          → public Landing (always renders)
//    /login     → Login (redirects to /app when already signed in)
//    /app/*     → authed shell + tracker pages
//  Anything else falls back to Landing.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from './lib/store.jsx';
import { Loading, ToastProvider, initials } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Authorities from './pages/Authorities.jsx';
import AuthorityDetail from './pages/AuthorityDetail.jsx';
import SubDivisions from './pages/SubDivisions.jsx';
import SubDivisionDetail from './pages/SubDivisionDetail.jsx';
import Communications from './pages/Communications.jsx';
import Meetings from './pages/Meetings.jsx';
import Qdrs from './pages/Qdrs.jsx';
import Users from './pages/Users.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import MyAccount from './pages/MyAccount.jsx';
import MfaSetup from './pages/MfaSetup.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Trash from './pages/Trash.jsx';
import Reports from './pages/Reports.jsx';
import Tasks from './pages/Tasks.jsx';

const ROLE_LABEL = {
  super_admin: 'Super-admin',
  admin: 'Admin',
  reviewer: 'Reviewer',
};

const NAV = [
  { to: '/app', i18nKey: 'nav.dashboard', end: true },
  { to: '/app/authorities', i18nKey: 'nav.authorities' },
  { to: '/app/sub-divisions', i18nKey: 'nav.subDivisions' },
  { to: '/app/communications', i18nKey: 'nav.communications' },
  { to: '/app/meetings', i18nKey: 'nav.meetings' },
  { to: '/app/qdrs', i18nKey: 'nav.qdrs' },
  { to: '/app/tasks', i18nKey: 'nav.tasks' },
  { to: '/app/reports', i18nKey: 'nav.reports' },
];

// Simple single-colour line icons (stroke = currentColor, so they inherit the
// nav item's muted/hover/active colour automatically). Keyed by route path.
const NAV_ICONS = {
  '/app': <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  '/app/authorities': <path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-4h6v4M9 11h.01M15 11h.01" />,
  '/app/sub-divisions': <path d="M4 6h16M4 12h16M4 18h16" />,
  '/app/communications': <path d="M3 5h18v14H3zM3 6l9 7 9-7" />,
  '/app/meetings': <path d="M8 2v4M16 2v4M3 9h18M5 5h14v16H5z" />,
  '/app/qdrs': <path d="M8 3h8a1 1 0 0 1 1 1v16l-5-2.5L7 20V4a1 1 0 0 1 1-1zM9.5 9.5l1.5 1.5 3-3" />,
  '/app/tasks': <path d="M4 5h16v16H4zM8 12l3 3 5-6" />,
  '/app/reports': <path d="M5 20V12M11 20V6M17 20v-4M4 20h16" />,
  '/app/users': <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  '/app/audit': <path d="M4 12h4l3 8 4-16 3 8h2" />,
  '/app/trash': <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />,
  '/app/me': <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />,
};

function NavIcon({ to }) {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" width="17" height="17" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {NAV_ICONS[to]}
    </svg>
  );
}

function Sidebar({ open, onClose }) {
  const { t } = useTranslation();
  const { user, isSuperAdmin, signOut } = useStore();
  return (
    <aside className={'sidebar' + (open ? ' sidebar-open' : '')} onClick={(e) => {
      // Clicking a NavLink inside should close the drawer on mobile.
      if (e.target.tagName === 'A' && onClose) onClose();
    }}>
      <div className="brand">
        <Link to="/" className="brand-mark brand-home" title="Go to the landing page">
          Safari Park Project
        </Link>
        <div className="brand-name">Authority Engagement</div>
        <div className="brand-sub">Design Consultancy &middot; Contract No. 6</div>
      </div>
      <nav className="nav">
        <div className="nav-section">{t('nav.section.tracker')}</div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
          >
            <NavIcon to={n.to} />
            {t(n.i18nKey)}
          </NavLink>
        ))}
        {isSuperAdmin && (
          <>
            <div className="nav-section">{t('nav.section.administration')}</div>
            <NavLink
              to="/app/users"
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              <NavIcon to="/app/users" />
              {t('nav.users')}
            </NavLink>
            <NavLink
              to="/app/audit"
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              <NavIcon to="/app/audit" />
              {t('nav.auditLog')}
            </NavLink>
            <NavLink
              to="/app/trash"
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              <NavIcon to="/app/trash" />
              {t('nav.trash')}
            </NavLink>
          </>
        )}
        <div className="nav-section">{t('nav.section.account')}</div>
        <NavLink
          to="/app/me"
          className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
        >
          <NavIcon to="/app/me" />
          {t('nav.myAccount')}
        </NavLink>
      </nav>
      <div className="sidebar-foot">
        <NavLink to="/app/me" className="user-chip user-chip-link">
          <div className="avatar">{initials(user.name)}</div>
          <div className="user-meta">
            <div className="user-name">{user.name}</div>
            <div className="user-role">
              {user.organisation} &middot; {ROLE_LABEL[user.role] || user.role}
            </div>
          </div>
        </NavLink>
        <button className="signout" onClick={signOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

function RequireSuperAdmin({ children }) {
  const { isSuperAdmin } = useStore();
  if (!isSuperAdmin) return <Navigate to="/app" replace />;
  return children;
}

function AppShell() {
  const { mustChangePassword, mfaEnrolled, mfaExempt } = useStore();
  const location = useLocation();
  const path = location.pathname;
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Two stacked gates, evaluated in order:
  //   1. password reset comes first — admins forcing a reset want the new
  //      password set before MFA is touched.
  //   2. MFA enrollment is mandatory for every role, EXCEPT accounts a
  //      super-admin has explicitly exempted (internal SPD staff).
  if (mustChangePassword && path !== '/app/change-password') {
    return <Navigate to="/app/change-password" replace />;
  }
  if (!mfaEnrolled && !mfaExempt && !mustChangePassword && path !== '/app/mfa-setup') {
    return <Navigate to="/app/mfa-setup" replace />;
  }
  return (
    <ToastProvider>
      <div className={'shell' + (drawerOpen ? ' shell-drawer-open' : '')}>
        {/* Mobile-only top bar with hamburger. The CSS hides it >720px. */}
        <header className="mobile-topbar">
          <button
            className="hamburger"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <span /><span /><span />
          </button>
          <Link to="/" className="mobile-brand brand-home" title="Go to the landing page">
            Safari Park Project
          </Link>
        </header>
        {drawerOpen && (
          <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />
        )}
        <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <div className="main">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="authorities" element={<Authorities />} />
            <Route path="authorities/:id" element={<AuthorityDetail />} />
            <Route path="sub-divisions" element={<SubDivisions />} />
            <Route path="sub-divisions/:id" element={<SubDivisionDetail />} />
            <Route path="communications" element={<Communications />} />
            <Route path="meetings" element={<Meetings />} />
            <Route path="qdrs" element={<Qdrs />} />
            <Route path="reports" element={<Reports />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="me" element={<MyAccount />} />
            <Route path="change-password" element={<ChangePassword />} />
            <Route path="mfa-setup" element={<MfaSetup />} />
            <Route
              path="users"
              element={
                <RequireSuperAdmin>
                  <Users />
                </RequireSuperAdmin>
              }
            />
            <Route
              path="audit"
              element={
                <RequireSuperAdmin>
                  <AuditLog />
                </RequireSuperAdmin>
              }
            />
            <Route
              path="trash"
              element={
                <RequireSuperAdmin>
                  <Trash />
                </RequireSuperAdmin>
              }
            />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </div>
      </div>
    </ToastProvider>
  );
}

function RequireAuth({ children }) {
  const { user } = useStore();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

function LoginRoute() {
  const { user } = useStore();
  if (user) return <Navigate to="/app" replace />;
  return <Login />;
}

export default function App() {
  const { ready } = useStore();
  if (!ready) {
    return <Loading label="Starting up" />;
  }
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route
        path="/app/*"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
