import { useState, useEffect } from "react";
import { getAggregateDashboard } from "../../services/api";
import { goodColor, dirLabel, periodColorCard } from "../../utils/adminFormatters";
import "../AdminDashboard.css";

export default function AdminResearch() {
  const [aggregate, setAggregate] = useState(null);
  const [loading,   setLoading]   = useState(true);

  const load = () => {
    setLoading(true);
    getAggregateDashboard()
      .then(r => setAggregate(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const summaries = aggregate?.trip_summaries || [];
  const mrGood = summaries.filter(t => t.direction === "MALANDAY-RECTO").reduce((s, t) => s + (t.good_count || 0), 0);
  const rmGood = summaries.filter(t => t.direction === "RECTO-MALANDAY").reduce((s, t) => s + (t.good_count || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Research</h1>
        <button className="admin-refresh" onClick={load} disabled={loading}>↺ Refresh</button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading research data…</div>
      ) : (
        <>
          <div className="admin-card">
            <div className="admin-card-title">Stop Detection Readiness</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { label: "Malanday → Recto", good: mrGood,         color: "#42a5f5" },
                { label: "Recto → Malanday", good: rmGood,         color: "#00b4d8" },
                { label: "Combined Pool",    good: mrGood + rmGood, color: "#30d158" },
              ].map(({ label, good, color }) => (
                <div key={label} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "16px 18px", border: "1px solid rgba(255,255,255,0.14)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: good > 1000 ? "#30d158" : "#ff453a" }} />
                    <span style={{ fontSize: 10, color: good > 1000 ? "#30d158" : "#ff453a", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{good > 1000 ? "Ready" : "Insufficient"}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: "-0.5px", fontFamily: "var(--mono)" }}>{good.toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.06em" }}>GOOD log points</div>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-card">
            <div className="admin-card-title">Trip Quality Trend</div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr>
                  <th>Trip ID</th><th>Date</th><th>Corridor</th><th>Period</th><th>Logs</th><th>GOOD %</th><th>Quality</th>
                </tr></thead>
                <tbody>
                  {[...summaries].sort((a, b) => (b.good_pct || 0) - (a.good_pct || 0)).map(t => {
                    const gp = typeof t.good_pct === "number" ? t.good_pct : null;
                    const pc = periodColorCard(t.time_period);
                    return (
                      <tr key={t.trip_id}>
                        <td className="admin-mono" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trip_id}</td>
                        <td className="admin-mono" style={{ color: "#8e9ab0" }}>{t.date || "—"}</td>
                        <td style={{ fontSize: 11, fontWeight: 700, color: t.direction === "MALANDAY-RECTO" ? "#42a5f5" : "#00b4d8" }}>{dirLabel(t.direction)}</td>
                        <td><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: pc.bg, color: pc.text, fontWeight: 700 }}>{t.time_period || "—"}</span></td>
                        <td className="admin-mono">{t.log_count?.toLocaleString() || "—"}</td>
                        <td style={{ fontWeight: 700, color: gp != null ? goodColor(gp) : "#8e9ab0" }}>
                          {gp != null ? `${typeof gp === "number" ? gp.toFixed(1) : gp}%` : "—"}
                        </td>
                        <td>
                          <div style={{ width: 60, height: 5, background: "rgba(255,255,255,0.12)", borderRadius: 99, overflow: "hidden" }}>
                            {gp != null && <div style={{ height: "100%", width: `${gp}%`, background: goodColor(gp), borderRadius: 99 }} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {summaries.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: "32px 0", textAlign: "center", color: "rgba(255,255,255,0.38)" }}>No trip data available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
