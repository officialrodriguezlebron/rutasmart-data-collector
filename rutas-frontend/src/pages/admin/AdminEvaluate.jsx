import { useState, useEffect } from "react";
import { getAdminTrips, getTripEvaluate } from "../../services/api";
import { phtDateStr, dirLabel } from "../../utils/adminFormatters";
import "../AdminDashboard.css";

function MetricCard({ label, value, color, subtitle }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 10, padding: "14px 18px", textAlign: "center", flex: 1,
    }}>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color ?? "#e8eaf0", fontFamily: "var(--mono)", lineHeight: 1 }}>{value ?? "—"}</div>
      {subtitle && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.30)", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export default function AdminEvaluate() {
  const [trips,        setTrips]        = useState([]);
  const [tripId,       setTripId]       = useState("");
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [err,          setErr]          = useState(null);

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
    getTripEvaluate(tripId)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.detail || "Evaluation failed. Trip may have too few clusters (need ≥ 2)."))
      .finally(() => setLoading(false));
  }, [tripId]);

  const sil = data?.silhouette    || {};
  const db  = data?.davies_bouldin || {};
  const silColor = !sil.score ? "#8e9ab0" : sil.score > 0.5 ? "#30d158" : sil.score > 0.2 ? "#ffd60a" : "#ff453a";
  const dbColor  = !db.index  ? "#8e9ab0" : db.index  < 0.5 ? "#30d158" : db.index  < 1.0 ? "#ffd60a" : "#ff453a";
  const f1Color  = !data?.f1_score ? "#8e9ab0" : data.f1_score > 0.8 ? "#30d158" : data.f1_score > 0.6 ? "#ffd60a" : "#ff453a";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Cluster Evaluation</h1>
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

      {loading && <div className="admin-loading">Running cluster evaluation…</div>}
      {err    && <div className="admin-msg error">{err}</div>}

      {data && (
        <>
          {/* Internal validity */}
          <div className="admin-card" style={{ marginBottom: 18 }}>
            <div className="admin-card-title">Internal Validity</div>
            <div style={{ display: "flex", gap: 12 }}>
              <MetricCard label="Silhouette Score"      value={sil.score?.toFixed(3)}  color={silColor} subtitle={sil.interpretation} />
              <MetricCard label="Davies-Bouldin Index"  value={db.index?.toFixed(3)}   color={dbColor}  subtitle={db.interpretation}  />
              <MetricCard label="Clusters Evaluated"    value={sil.n_clusters}          color="#42a5f5"  subtitle={`${sil.n_points} points`} />
            </div>
          </div>

          {/* External validity */}
          <div className="admin-card" style={{ marginBottom: 18 }}>
            <div className="admin-card-title">
              External Validity — Ground Truth Comparison
              <span style={{ marginLeft: 10, fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.15)", fontWeight: 600 }}>
                threshold: {data.match_threshold_m}m
              </span>
            </div>

            {/* Precision / Recall / F1 / MAE */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <MetricCard label="Precision" value={`${(data.precision  * 100).toFixed(1)}%`} color="#42a5f5" />
              <MetricCard label="Recall"    value={`${(data.recall     * 100).toFixed(1)}%`} color="#00b4d8" />
              <MetricCard label="F1 Score"  value={`${(data.f1_score   * 100).toFixed(1)}%`} color={f1Color} />
              <MetricCard label="MAE"       value={`${data.mae_m?.toFixed(1)}m`}             color="#bf5af2" subtitle="mean centroid offset" />
            </div>

            {/* Confusion matrix */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {[
                { label: "True Positives",  value: data.true_positives,  color: "#30d158", desc: "clusters matching a GT stop"   },
                { label: "False Positives", value: data.false_positives, color: "#ff453a", desc: "clusters with no GT match"      },
                { label: "False Negatives", value: data.false_negatives, color: "#ffd60a", desc: "GT stops with no cluster match" },
              ].map(({ label, value, color, desc }) => (
                <div key={label} style={{ flex: 1, background: color + "14", border: `1px solid ${color}44`, borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.50)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color, fontFamily: "var(--mono)", lineHeight: 1 }}>{value}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.30)", marginTop: 4 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* Ground truth match table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: "0 4px", width: "100%", minWidth: 600 }}>
                <thead>
                  <tr>
                    {["Cluster", "Centroid", "Nearest GT Stop", "Offset", "Match"].map(h => (
                      <th key={h} style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textAlign: "left", padding: "4px 10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.matches || []).map(m => {
                    const offsetColor = m.offset_m < 50 ? "#30d158" : m.offset_m < 100 ? "#ffd60a" : "#ff453a";
                    return (
                      <tr key={m.cluster_id}>
                        <td style={{ padding: "6px 10px", fontSize: 11, fontFamily: "var(--mono)", color: "#42a5f5", background: "rgba(255,255,255,0.03)", borderRadius: "8px 0 0 8px" }}>#{m.cluster_id}</td>
                        <td style={{ padding: "6px 10px", fontSize: 10, color: "rgba(255,255,255,0.48)", fontFamily: "var(--mono)", background: "rgba(255,255,255,0.03)" }}>{m.detected_lat.toFixed(5)}, {m.detected_lon.toFixed(5)}</td>
                        <td style={{ padding: "6px 10px", fontSize: 11, color: "rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.03)" }}>{m.nearest_stop}</td>
                        <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: "var(--mono)", color: offsetColor, fontWeight: 700, background: "rgba(255,255,255,0.03)" }}>{m.offset_m.toFixed(0)}m</td>
                        <td style={{ padding: "6px 10px", fontSize: 16, textAlign: "center", background: "rgba(255,255,255,0.03)", borderRadius: "0 8px 8px 0" }}>{m.matched ? "✅" : "❌"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
