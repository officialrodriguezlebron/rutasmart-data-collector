import { useState, useEffect } from "react";
import { getAggregateDashboard, publishStopZones } from "../../services/api";
import { dirLabel, periodColorCard } from "../../utils/adminFormatters";
import StopZonePublishPreview from "../../components/StopZonePublishPreview";
import "../AdminDashboard.css";

const Icon = ({ name, size = 18 }) => {
  const icons = {
    clock: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
  };
  return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ flexShrink: 0 }}>
      {icons[name]}
    </svg>
  );
};

export default function AdminStopZones() {
  const [aggTrips,     setAggTrips]     = useState([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [status,       setStatus]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [showPreview,  setShowPreview]  = useState(false);

  useEffect(() => {
    getAggregateDashboard()
      .then(r => setAggTrips(r.data.trip_summaries || []))
      .catch(() => setAggTrips([]))
      .finally(() => setTripsLoading(false));
  }, []);

  const byDate = {};
  for (const t of aggTrips) {
    if (!byDate[t.date]) byDate[t.date] = { "MALANDAY-RECTO": [], "RECTO-MALANDAY": [] };
    if (t.direction in byDate[t.date]) byDate[t.date][t.direction].push(t);
  }
  const sortedDates = Object.keys(byDate).sort();

  const handlePublish = async () => {
    if (!window.confirm(
      "Publish stop zones for MR-001 (both directions)?\n\n" +
      "Runs stop detection across all completed trips for Malanday→Recto and Recto→Malanday " +
      "and updates the passenger map."
    )) return;
    setLoading(true);
    setStatus(null);
    try {
      const [resMR, resRM] = await Promise.all([
        publishStopZones("MR-001", "MALANDAY-RECTO"),
        publishStopZones("MR-001", "RECTO-MALANDAY"),
      ]);
      setStatus({
        ok: true,
        lines: [
          `Malanday → Recto: ${resMR.data.stop_zones} stop zones published (${resMR.data.logs_analyzed?.toLocaleString()} logs)`,
          `Recto → Malanday: ${resRM.data.stop_zones} stop zones published (${resRM.data.logs_analyzed?.toLocaleString()} logs)`,
        ],
      });
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || "Publish failed.";
      setStatus({ ok: false, lines: [detail] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Stop Zones</h1>
      </div>

      <div className="admin-card">
        <div className="admin-card-title" style={{ justifyContent: "space-between" }}>
          <span>Passenger Stop Zone Map</span>
          <button
            onClick={() => setShowPreview(true)}
            disabled={tripsLoading || aggTrips.length === 0}
            style={{
              padding: "7px 16px",
              background: tripsLoading || aggTrips.length === 0
                ? "rgba(0,0,0,0.10)" : "linear-gradient(135deg,#1044a3,#1565c0)",
              color: tripsLoading || aggTrips.length === 0 ? "#8e9ab0" : "white",
              border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700,
              cursor: tripsLoading || aggTrips.length === 0 ? "not-allowed" : "pointer",
              fontFamily: "var(--font)", boxShadow: tripsLoading || aggTrips.length === 0 ? "none" : "0 4px 12px rgba(16,68,163,0.35)",
              whiteSpace: "nowrap",
            }}
          >
            📤 Publish Stop Zones
          </button>
        </div>
        <p className="admin-card-desc">
          RutaSmart identifies high-demand passenger activity areas from collected GPS data and recommends stop zones for transport planners. Review both corridors before publishing to the passenger map.
        </p>

        {tripsLoading ? (
          <div style={{ fontSize: 13, color: "#8e9ab0" }}>Loading trips…</div>
        ) : sortedDates.length === 0 ? (
          <div style={{ fontSize: 13, color: "#c62828" }}>No completed trips found.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", padding: "2px 4px" }}>
              Signal Quality:&nbsp;
              <span style={{ color: "#30d158", fontWeight: 700 }}>≥95% excellent</span>
              {" · "}
              <span style={{ color: "#ffd60a", fontWeight: 700 }}>≥70% normal</span>
              {" · "}
              <span style={{ color: "#ff453a", fontWeight: 700 }}>&lt;70% degraded</span>
            </div>
            {sortedDates.map(date => (
              <div key={date}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                  <Icon name="clock" size={13} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#42a5f5", textTransform: "uppercase", letterSpacing: "0.06em" }}>📅 {date}</span>
                </div>
                {["MALANDAY-RECTO", "RECTO-MALANDAY"].map(dir => {
                  const dirTrips = byDate[date][dir];
                  if (!dirTrips.length) return null;
                  return (
                    <div key={dir} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.40)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 4 }}>
                        {dirLabel(dir)}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {dirTrips.map(t => {
                          const pc = periodColorCard(t.dominant_period || t.time_period);
                          const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                          const gpColor = gp == null ? "rgba(255,255,255,0.38)" : gp >= 95 ? "#30d158" : gp >= 70 ? "#ffd60a" : "#ff453a";
                          return (
                            <div key={t.trip_id} style={{
                              display: "grid", gridTemplateColumns: "64px 120px 1fr 88px",
                              alignItems: "center", gap: 8,
                              background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "6px 12px",
                              border: "1px solid rgba(255,255,255,0.10)", fontSize: 12,
                            }}>
                              <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 600, fontFamily: "var(--mono)" }}>{t.pht_start || "—"}</span>
                              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: pc.bg, color: pc.text, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {t.dominant_period || t.time_period || "—"}
                              </span>
                              <span style={{ color: "rgba(255,255,255,0.70)" }}>{t.log_count?.toLocaleString()} logs</span>
                              <span style={{ fontWeight: 700, textAlign: "right", fontSize: 12, color: gpColor }}>
                                {gp != null ? `${gp.toFixed(1)}%` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {status && (
          <div className={`admin-msg ${status.ok ? "success" : "error"}`} style={{ marginTop: 14 }}>
            <span style={{ fontWeight: 700, color: status.ok ? "#30d158" : "#ff453a" }}>{status.ok ? "✓ " : "✗ "}</span>
            {status.lines.map((line, i) => <span key={i}>{line}{i < status.lines.length - 1 && <br />}</span>)}
          </div>
        )}

        {showPreview && (
          <StopZonePublishPreview
            routeId="MR-001"
            onClose={() => setShowPreview(false)}
            onSuccess={() => setStatus({ ok: true, lines: ["Stop zones published successfully."] })}
          />
        )}
      </div>
    </div>
  );
}
