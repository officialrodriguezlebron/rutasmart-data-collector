import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminStats, getAdminTrips, seedUsers } from "../services/api";
import { authService } from "../services/authService";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate  = useNavigate();
  const user      = authService.getUser();

  const [stats, setStats]   = useState(null);
  const [trips, setTrips]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState("overview");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!authService.isAdmin()) {
      navigate("/login", { replace: true });
      return;
    }
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, tripsRes] = await Promise.all([
        getAdminStats(),
        getAdminTrips(),
      ]);
      setStats(statsRes.data);
      setTrips(tripsRes.data);
    } catch (e) {
      console.error("Admin fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    authService.clearSession();
    navigate("/login", { replace: true });
  };

  const handleSeed = async () => {
    try {
      await seedUsers();
      setSeeded(true);
      fetchData();
    } catch (e) {
      console.error("Seed error:", e);
    }
  };

  const statusColor = (status) => {
    if (status === "ACTIVE")    return "#2e7d32";
    if (status === "COMPLETED") return "#1565c0";
    return "#888";
  };

  return (
    <div className="admin-page">

      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <h2>RutaSmart</h2>
          <span>Admin Panel</span>
        </div>

        <div className="admin-user-info">
          <div className="admin-user-avatar">
            {user?.display_name?.charAt(0) || "A"}
          </div>
          <div>
            <div className="admin-user-name">{user?.display_name}</div>
            <div className="admin-user-role">Administrator</div>
          </div>
        </div>

        <nav className="admin-nav">
          <div className="admin-nav-section">MAIN</div>
          {[
            { key: "overview",  label: "Overview"        },
            { key: "trips",     label: "All Trips"       },
            { key: "analytics", label: "Analytics Engine"},
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`admin-nav-item ${tab === key ? "active" : ""}`}
              onClick={() => key === "analytics"
                ? navigate("/analytics")
                : setTab(key)
              }
            >
              {label}
            </button>
          ))}

          <div className="admin-nav-section">SYSTEM</div>
          {[
            { key: "seed",   label: "Seed Users" },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`admin-nav-item ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <button className="admin-signout" onClick={handleLogout}>
          Sign Out
        </button>
      </aside>

      {/* Main content */}
      <main className="admin-main">

        {/* Top bar */}
        <div className="admin-topbar">
          <h1>
            {tab === "overview"  && "Overview"}
            {tab === "trips"     && "All Trips"}
            {tab === "seed"      && "Seed Users"}
          </h1>
          <button className="admin-refresh" onClick={fetchData}>
            ↺ Refresh
          </button>
        </div>

        {loading && (
          <div className="admin-loading">Loading…</div>
        )}

        {/* Overview */}
        {!loading && tab === "overview" && stats && (
          <>
            <div className="admin-metrics">
              {[
                { label: "Active Trips",  value: stats.active_trips,           color: "#2e7d32" },
                { label: "Total Trips",   value: stats.total_trips,            color: "#1565c0" },
                { label: "GPS Logs",      value: stats.total_logs.toLocaleString(), color: "#1f2937" },
                { label: "Active Users",  value: stats.total_users,            color: "#1f2937" },
              ].map(({ label, value, color }) => (
                <div key={label} className="admin-metric-card">
                  <div className="admin-metric-label">{label}</div>
                  <div className="admin-metric-value" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Active jeeps */}
            <div className="admin-card">
              <div className="admin-card-title">Active Jeeps Now</div>
              {stats.active_jeeps.length === 0 ? (
                <p className="admin-empty">No jeeps currently active.</p>
              ) : (
                <div className="admin-jeep-list">
                  {stats.active_jeeps.map(jeep => (
                    <span key={jeep} className="admin-jeep-badge">{jeep}</span>
                  ))}
                </div>
              )}
            </div>

            {/* System health */}
            <div className="admin-card">
              <div className="admin-card-title">System Health</div>
              <div className="admin-health-grid">
                {[
                  ["API Server",    "UP"],
                  ["PostgreSQL DB", "UP"],
                  ["PWA CDN",       "UP"],
                ].map(([service, status]) => (
                  <div key={service} className="admin-health-row">
                    <span className="admin-health-dot" />
                    <span>{service}</span>
                    <span className="admin-health-status">{status}</span>
                  </div>
                ))}
              </div>
              <p className="admin-health-note">
                Render.com · PostgreSQL 15.x · FastAPI · React PWA
              </p>
            </div>

            {/* Recent trips preview */}
            <div className="admin-card">
              <div className="admin-card-title">Recent Trips (last 5)</div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Trip ID</th>
                      <th>Jeep</th>
                      <th>Direction</th>
                      <th>Status</th>
                      <th>Start</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.slice(0, 5).map(t => (
                      <tr key={t.trip_id}>
                        <td className="admin-mono">{t.trip_id}</td>
                        <td>{t.jeep_code}</td>
                        <td>{t.direction}</td>
                        <td>
                          <span className="admin-status-badge"
                            style={{ background: statusColor(t.status) + "22",
                                     color: statusColor(t.status) }}>
                            {t.status}
                          </span>
                        </td>
                        <td className="admin-mono" style={{ fontSize: 11, color: "#888" }}>
                          {t.start_time?.slice(0, 16)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* All Trips */}
        {!loading && tab === "trips" && (
          <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Trip ID</th>
                    <th>Jeep</th>
                    <th>Route</th>
                    <th>Direction</th>
                    <th>Capacity</th>
                    <th>Status</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Analytics</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map(t => (
                    <tr key={t.trip_id}>
                      <td className="admin-mono" style={{ fontSize: 11 }}>{t.trip_id}</td>
                      <td>{t.jeep_code}</td>
                      <td>{t.route_id}</td>
                      <td>{t.direction}</td>
                      <td style={{ textAlign: "center" }}>{t.official_capacity}</td>
                      <td>
                        <span className="admin-status-badge"
                          style={{ background: statusColor(t.status) + "22",
                                   color: statusColor(t.status) }}>
                          {t.status}
                        </span>
                      </td>
                      <td className="admin-mono" style={{ fontSize: 11, color: "#888" }}>
                        {t.start_time?.slice(0, 16)}
                      </td>
                      <td className="admin-mono" style={{ fontSize: 11, color: "#888" }}>
                        {t.end_time?.slice(0, 16) || "—"}
                      </td>
                      <td>
                        {t.status === "COMPLETED" && (
                          <button
                            className="admin-action-btn"
                            onClick={() => navigate(`/analytics?trip=${t.trip_id}`)}
                          >
                            Analyse
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Seed users */}
        {tab === "seed" && (
          <div className="admin-card" style={{ maxWidth: 480 }}>
            <div className="admin-card-title">Seed Default Users</div>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.6 }}>
              Creates default Admin, Analyst, and two Conductor accounts if they don't already exist.
              Safe to run multiple times.
            </p>
            <div className="admin-credentials">
              {[
                ["Admin",     "admin@rutasmart.ph",   "Admin2026!",    "—"],
                ["Analyst",   "analyst@rutasmart.ph", "Analyst2026!",  "—"],
                ["Conductor", "CDR-2024-042",          "PIN: 1234",    "JPN-001"],
                ["Conductor", "CDR-2024-043",          "PIN: 5678",    "JPN-002"],
              ].map(([role, id, cred, jeep]) => (
                <div key={id} className="admin-cred-row">
                  <span className="admin-cred-role">{role}</span>
                  <span className="admin-cred-id">{id}</span>
                  <span className="admin-cred-pass">{cred}</span>
                  <span className="admin-cred-jeep">{jeep}</span>
                </div>
              ))}
            </div>
            <button
              className="admin-seed-btn"
              onClick={handleSeed}
              disabled={seeded}
            >
              {seeded ? "✓ Users seeded" : "Seed Users"}
            </button>
            {seeded && (
              <p style={{ fontSize: 12, color: "#2e7d32", marginTop: 10 }}>
                Default users created. You can now log in with the credentials above.
              </p>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
