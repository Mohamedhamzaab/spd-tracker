// ---------------------------------------------------------------------------
//  App. Routing, the protected-route gate, and the sidebar layout shell.
// ---------------------------------------------------------------------------
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './lib/store.jsx';
import { Loading, ToastProvider, initials } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Authorities from './pages/Authorities.jsx';
import AuthorityDetail from './pages/AuthorityDetail.jsx';
import SubDivisions from './pages/SubDivisions.jsx';
import SubDivisionDetail from './pages/SubDivisionDetail.jsx';
import Communications from './pages/Communications.jsx';
import Meetings from './pages/Meetings.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/authorities', label: 'Authorities' },
  { to: '/sub-divisions', label: 'Sub-Divisions' },
  { to: '/communications', label: 'Communications' },
  { to: '/meetings', label: 'Meetings' },
];

function Sidebar() {
  const { user, signOut } = useStore();
  return (
    <aside className="sidebar">
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
      </nav>
      <div className="sidebar-foot">
        <div className="user-chip">
          <div className="avatar">{initials(user.name)}</div>
          <div className="user-meta">
            <div className="user-name">{user.name}</div>
            <div className="user-role">
              {user.organisation} &middot; {user.role === 'editor' ? 'Editor' : 'Viewer'}
            </div>
          </div>
        </div>
        <button className="signout" onClick={signOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

function Shell() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/authorities" element={<Authorities />} />
          <Route path="/authorities/:id" element={<AuthorityDetail />} />
          <Route path="/sub-divisions" element={<SubDivisions />} />
          <Route path="/sub-divisions/:id" element={<SubDivisionDetail />} />
          <Route path="/communications" element={<Communications />} />
          <Route path="/meetings" element={<Meetings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  const { user, ready } = useStore();
  const location = useLocation();

  if (!ready) {
    return <Loading label="Starting up" />;
  }
  if (!user) {
    if (location.pathname !== '/login') {
      return <Navigate to="/login" replace />;
    }
    return <Login />;
  }
  if (location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
