import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { authService } from "../../services/authService";
import "../AdminDashboard.css";

const NAV_OPERATIONS = [
  { to: "/admin/map",        label: "🗺 Map"        },
  { to: "/admin/overview",   label: "⊞ Overview"   },
  { to: "/admin/trips",      label: "🚌 Trips"      },
  { to: "/admin/corridors",  label: "📊 Corridors"  },
  { to: "/admin/zones",      label: "📍 Zone Mgmt"  },
];

const NAV_RESEARCH = [
  { to: "/admin/research",   label: "🔬 Research"   },
  { to: "/admin/stop-zones", label: "🗂 Stop Zones" },
];

const NAV_SYSTEM = [
  { to: "/admin/conductors", label: "👤 Conductors" },
];

export default function AdminShell() {
  const navigate  = useNavigate();
  const user      = authService.getUser();
  const initials  = (user?.display_name || "A").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  const navClass = ({ isActive }) => `admin-nav-item${isActive ? " active" : ""}`;

  return (
    <div className="admin-page">
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <h2>RutaSmart</h2>
          <span>Admin Panel</span>
        </div>

        <div className="admin-user-info">
          <div className="admin-user-avatar">{initials}</div>
          <div>
            <div className="admin-user-name">{user?.display_name || "Admin"}</div>
            <div className="admin-user-role">Administrator</div>
          </div>
        </div>

        <nav className="admin-nav">
          <div className="admin-nav-section">Operations</div>
          {NAV_OPERATIONS.map(({ to, label }) => (
            <NavLink key={to} to={to} className={navClass}>{label}</NavLink>
          ))}

          <div className="admin-nav-section" style={{ marginTop: 12 }}>Research</div>
          {NAV_RESEARCH.map(({ to, label }) => (
            <NavLink key={to} to={to} className={navClass}>{label}</NavLink>
          ))}

          <div className="admin-nav-section" style={{ marginTop: 12 }}>System</div>
          {NAV_SYSTEM.map(({ to, label }) => (
            <NavLink key={to} to={to} className={navClass}>{label}</NavLink>
          ))}
        </nav>

        <button className="admin-signout" onClick={() => { authService.clearSession(); navigate("/login", { replace: true }); }}>
          Sign Out
        </button>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
