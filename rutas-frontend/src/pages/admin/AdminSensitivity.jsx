import { useState, useEffect } from "react";
import { getAdminTrips, getTripSensitivity } from "../../services/api";
import { phtDateStr, dirLabel } from "../../utils/adminFormatters";
import "../AdminDashboard.css";

const EPS_VALUES      = [30, 40, 50, 60, 75, 100];
const MINPTS_VALUES   = [3, 5, 8, 10];
const REC_EPS         = 50;
const REC_MINPTS      = 5;

function cellColor(value, min, max) {
  if (min === max) return "#42a5f5";
  const t = (value - min) / (max - min);
  if (t > 0.66) return "#30d158";
  if (t > 0.33) return "#ffd60a";
  return "#ff453a";
}

export default function AdminSensitivity() {
  const [trips,       setTrips]       = useState([]);
  const [tripId,      setTripId]      = useState("");
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [tripsLoading,setTripsLoading]= useState(true);
  const [err,         setErr]         = useState(null);

  useEffect(() => {
    getAdminTrips()
      .then(r => {
        const completed = (r.data || []).filter(t => t.status === "COMPLETED");
        setTrips(completed);
        if (completed.length) setTripId(completed[0].trip_id);
      })
      .catch(() => {})
      .finally(() => setTripsLoading(false));
  }, []);

  useEffect(() => {
    if (!tripId) return;
    setLoading(true);
    setData(null);
    setErr(null);
    getTripSensitivity(tripId)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.detail || "Failed to load sensitivity data."))
      .finally(() => setLoading(false));
  }, [tripId]);

  // Build lookup: grid[eps][minPts] = row
  const grid = {};
  for (const row of (data?.rows || [])) {
    if (!grid[row.eps_m]) grid[row.eps_m] = {};
    grid[row.eps_m][row.min_samples] = row;
  }

  const allCounts = (data?.rows || []).map(r => r.true_stop_count);
  const minCount  = Math.min(...allCounts, 0);
  const maxCount  = Math.max(...allCounts, 1);

  const rec = data?.recommended || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Sensitivity Analysis</h1>
        {!tripsLoading && (
          <select
            value={tripId}
            onChange={e => setTripId(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, fontSize: 11, fontFamily: "var(--mono)", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.80)", cursor: "pointer" }}
          >
            {trips.map(t => (
              <option key={t.trip_id} value={t.trip_id} style={{ background: "#0f1a2e" }}>
                {phtDateStr(t.start_time)} · {dirLabel(t.direction)} · {t.trip_id.slice(-8)}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && <div className="admin-loading">Running sensitivity grid search…</div>}
      {err    && <div className="admin-msg error">{err}</div>}

      {data && (
        <>
          {/* Grid */}
          <div className="admin-card" style={{ marginBottom: 18 }}>
            <div className="admin-card-title">
              True Stop Clusters — ε (eps) × minPts Grid
              <span style={{ marginLeft: 10, fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(66,165,245,0.14)", color: "#42a5f5", border: "1px solid rgba(66,165,245,0.30)", fontWeight: 700 }}>
                ★ ε=50m, minPts=5 recommended
              </span>
            </div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", margin: "0 0 14px" }}>
              Each cell shows how many true stop clusters DBSCAN detects at that parameter combination. Green = more stops found, Red = fewer. Starred cell is the thesis-validated setting.
            </p>

            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 4, width: "100%", minWidth: 440 }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>ε (m) ↓ / minPts →</th>
                    {MINPTS_VALUES.map(mp => (
                      <th key={mp} style={{ fontSize: 10, color: mp === REC_MINPTS ? "#42a5f5" : "rgba(255,255,255,0.55)", textAlign: "center", padding: "4px 8px", fontWeight: mp === REC_MINPTS ? 800 : 600, minWidth: 72 }}>
                        {mp === REC_MINPTS ? `★ ${mp}` : mp}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EPS_VALUES.map(eps => (
                    <tr key={eps}>
                      <td style={{ fontSize: 10, color: eps === REC_EPS ? "#42a5f5" : "rgba(255,255,255,0.55)", padding: "4px 8px", fontWeight: eps === REC_EPS ? 800 : 600, whiteSpace: "nowrap" }}>
                        {eps === REC_EPS ? `★ ${eps}m` : `${eps}m`}
                      </td>
                      {MINPTS_VALUES.map(mp => {
                        const row = grid[eps]?.[mp];
                        const isRec = eps === REC_EPS && mp === REC_MINPTS;
                        const count = row?.true_stop_count ?? "—";
                        const noise = row ? `${(row.noise_ratio * 100).toFixed(0)}%` : "";
                        const color = row ? cellColor(row.true_stop_count, minCount, maxCount) : "#8e9ab0";
                        return (
                          <td key={mp} style={{ padding: 2 }}>
                            <div style={{
                              background: row ? color + "18" : "rgba(255,255,255,0.04)",
                              border: isRec ? `2px solid ${color}` : "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 8, padding: "8px 6px", textAlign: "center",
                              boxShadow: isRec ? `0 0 10px ${color}40` : "none",
                            }}>
                              <div style={{ fontSize: 18, fontWeight: 800, color: row ? color : "#8e9ab0", fontFamily: "var(--mono)", lineHeight: 1 }}>{count}</div>
                              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.30)", marginTop: 2 }}>noise {noise}</div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Noise ratio legend */}
            <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 10, color: "rgba(255,255,255,0.40)" }}>
              {[["#30d158","More true stops"], ["#ffd60a","Moderate"], ["#ff453a","Fewer stops"]].map(([c, label]) => (
                <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Recommended params + justification */}
          {rec.justification?.length > 0 && (
            <div className="admin-card">
              <div className="admin-card-title">
                Parameter Justification
                <span style={{ marginLeft: 10, fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(66,165,245,0.14)", color: "#42a5f5", border: "1px solid rgba(66,165,245,0.30)", fontWeight: 700 }}>
                  ε={rec.eps_m}m · minPts={rec.min_samples}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {rec.justification.map((point, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
                    <span style={{ color: "#42a5f5", fontWeight: 800, flexShrink: 0 }}>{i + 1}.</span>
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-eps summary: noise ratio trend */}
          <div className="admin-card">
            <div className="admin-card-title">Noise Ratio by ε (minPts=5)</div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", margin: "0 0 12px" }}>
              Smaller ε → more points classified as noise (strict). Larger ε → fewer noise points but risks merging nearby stops.
            </p>
            {EPS_VALUES.map(eps => {
              const row = grid[eps]?.[REC_MINPTS];
              if (!row) return null;
              const nr = (row.noise_ratio * 100).toFixed(1);
              const isRec = eps === REC_EPS;
              const barColor = isRec ? "#42a5f5" : "rgba(255,255,255,0.28)";
              return (
                <div key={eps} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: isRec ? "#42a5f5" : "rgba(255,255,255,0.55)", minWidth: 52, fontFamily: "var(--mono)", fontWeight: isRec ? 800 : 400 }}>{isRec ? `★ ${eps}m` : `${eps}m`}</span>
                  <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.10)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${nr}%`, background: barColor, borderRadius: 99 }} />
                  </div>
                  <span style={{ fontSize: 11, color: barColor, fontWeight: isRec ? 800 : 400, minWidth: 38, textAlign: "right", fontFamily: "var(--mono)" }}>{nr}%</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.30)", minWidth: 60 }}>{row.true_stop_count} stops</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && !data && !err && trips.length === 0 && (
        <div className="admin-card">
          <p style={{ color: "rgba(255,255,255,0.42)", fontSize: 13 }}>No completed trips found. Record and complete a trip first.</p>
        </div>
      )}
    </div>
  );
}
