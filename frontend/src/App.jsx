// ---------------------------------------------------------------------------
//  App. Routing.
//    /          → public Landing (always renders)
//    /login     → Login (redirects to /app when already signed in)
//    /app/*     → authed shell + tracker pages
//  Anything else falls back to Landing.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
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

const ROLE_LABEL = {
  super_admin: 'Super-admin',
  admin: 'Admin',
  reviewer: 'Reviewer',
};

const NAV = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/authorities', label: 'Authorities' },
  { to: '/app/sub-divisions', label: 'Sub-Divisions' },
  { to: '/app/communications', label: 'Communications' },
  { to: '/app/meetings', label: 'Meetings' },
  { to: '/app/reports', label: 'Reports' },
];

function Sidebar({ open, onClose }) {
  const { user, isSuperAdmin, signOut } = useStore();
  return (
    <aside className={'sidebar' + (open ? ' sidebar-open' : '')} onClick={(e) => {
      // Clicking a NavLink inside should close the drawer on mobile.
      if (e.target.tagName === 'A' && onClose) onClose();
    }}>
      <div className="brand">
        <div className="brand-mark">Safari Park Project</div>
        <div className="brand-name">Authority Engagement</div>
        <div className="brand-sub">Design Consultancy &middot; Contract No. 6</div>
      </div>
      <nav className="nav">
        <div className="nav-section">Tracker</div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
          >
            {n.label}
          </NavLink>
        ))}
        {isSuperAdmin && (
          <>
            <div className="nav-section">Administration</div>
            <NavLink
              to="/app/users"
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              Users
            </NavLink>
            <NavLink
              to="/app/audit"
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              Audit log
            </NavLink>
            <NavLink
              to="/app/trash"
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              Trash
            </NavLink>
          </>
        )}
        <div className="nav-section">Account</div>
        <NavLink
          to="/app/me"
          className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
        >
          My account
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
  const { mustChangePassword, mfaEnrolled } = useStore();
  const location = useLocation();
  const path = location.pathname;
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Two stacked gates, evaluated in order:
  //   1. password reset comes first — admins forcing a reset want the new
  //      password set before MFA is touched.
  //   2. MFA enrollment is mandatory for every role.
  if (mustChangePassword && path !== '/app/change-password') {
    return <Navigate to="/app/change-password" replace />;
  }
  if (!mfaEnrolled && !mustChangePassword && path !== '/app/mfa-setup') {
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
          <div className="mobile-brand">Safari Park Project</div>
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
            <Route path="reports" element={<Reports />} />
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
