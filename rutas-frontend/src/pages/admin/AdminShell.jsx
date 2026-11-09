import { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { authService } from "../../services/authService";
import "../AdminDashboard.css";
import "../../components/admin/adminUi.css";

/**
 * Admin shell and sidebar.
 *
 * The groups follow the manuscript's section 3.3.2 description of the
 * administrative dashboard: Overview, Trips, Conductors and an Analytics
 * Engine. Operations holds the day-to-day corridor views, Analytics Engine
 * holds the analytical outputs, and System holds account management.
 *
 * Two of the Analytics Engine entries deep-link into /analytics with a tab
 * preselected. Before this change /analytics was routed but had no inbound
 * link anywhere in the app, so the manuscript's Analytics Engine section was
 * reachable only by typing the URL.
 *
 * The research tools below the main groups are the thesis-facing pages:
 * parameter sweeps, pipeline inspection, inter-trip overlap and manual zone
 * management. They are collapsed by default because they serve method
 * validation rather than corridor review, but they stay reachable so that
 * tightening the primary navigation does not orphan them.
 */

const NAV_OPERATIONS = [
  { to: "/admin/overview",   label: "Overview"   },
  { to: "/admin/map",        label: "Demand Hotspots" },
  { to: "/admin/trips",      label: "Trips"      },
  { to: "/admin/stop-zones", label: "Stop Zones" },
];

const NAV_ANALYTICS = [
  { to: "/admin/demand",        label: "Demand and Load Factor" },
  { to: "/analytics?tab=time",  label: "Time Period Analysis"   },
  { to: "/analytics?tab=dbscan", label: "Stop Cluster Analysis" },
  { to: "/admin/evaluate",      label: "Evaluation"             },
  { to: "/admin/export",        label: "Export Data"            },
];

const NAV_SYSTEM = [
  { to: "/admin/conductors", label: "Conductors" },
];

const NAV_RESEARCH = [
  { to: "/analytics",          label: "Analytics Engine (full)" },
  { to: "/admin/research",     label: "Research Summary"        },
  { to: "/admin/pipeline",     label: "Pipeline Inspector"      },
  { to: "/admin/sensitivity",  label: "Sensitivity Analysis"    },
  { to: "/admin/overlap",      label: "Route Overlap"           },
  { to: "/admin/zones",        label: "Zone Management"         },
];

export default function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = authService.getUser();

  const inResearch = NAV_RESEARCH.some((i) => i.to.split("?")[0] === location.pathname);
  const [showResearch, setShowResearch] = useState(inResearch);

  const initials = (user?.display_name || "A")
    .split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  /**
   * NavLink matches on pathname only, so the two /analytics entries would
   * both highlight. Compare the tab query too.
   */
  const itemClass = (to) => ({ isActive }) => {
    const [path, query] = to.split("?");
    if (path !== location.pathname) return "admin-nav-item";
    if (!query) {
      // The bare /analytics entry is active only when no tab is pinned.
      const hasTab = new URLSearchParams(location.search).has("tab");
      return `admin-nav-item${isActive && !hasTab ? " active" : ""}`;
    }
    const want = new URLSearchParams(query).get("tab");
    const have = new URLSearchParams(location.search).get("tab");
    return `admin-nav-item${want === have ? " active" : ""}`;
  };

  const renderItems = (items) =>
    items.map(({ to, label }) => (
      <NavLink key={to} to={to} className={itemClass(to)} end={false}>
        {label}
      </NavLink>
    ));

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

        <nav className="admin-nav" aria-label="Admin sections">
          <div className="admin-nav-section">Operations</div>
          {renderItems(NAV_OPERATIONS)}

          <div className="admin-nav-section" style={{ marginTop: 10 }}>Analytics Engine</div>
          {renderItems(NAV_ANALYTICS)}

          <div className="admin-nav-section" style={{ marginTop: 10 }}>System</div>
          {renderItems(NAV_SYSTEM)}

          <button
            type="button"
            className="rs-navdisclosure"
            onClick={() => setShowResearch((v) => !v)}
            aria-expanded={showResearch}
          >
            <span>Research tools</span>
            <span aria-hidden="true">{showResearch ? "−" : "+"}</span>
          </button>

          {showResearch && (
            <div className="rs-navsub">{renderItems(NAV_RESEARCH)}</div>
          )}
        </nav>

        <button
          className="admin-signout"
          onClick={() => { authService.clearSession(); navigate("/login", { replace: true }); }}
        >
          Sign Out
        </button>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
