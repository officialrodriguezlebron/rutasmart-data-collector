import { useState, useEffect } from "react";
import { getAggregateDashboard, getMlStatus, runMergedCompare } from "../../services/api";
import { goodColor, dirLabel, periodColorCard, phtDateStr, phtTimeStr } from "../../utils/adminFormatters";
import "../AdminDashboard.css";

function FeatureBar({ feature, importance, maxImportance }) {
  const pct   = (importance * 100).toFixed(1);
  const relW  = maxImportance > 0 ? (importance / maxImportance) * 100 : 0;
  const color = importance > 0.5 ? "#42a5f5" : importance > 0.15 ? "#00b4d8" : "#8e9ab0";
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: "rgba(255,255,255,0.65)", fontFamily: "var(--mono)" }}>{feature}</span>
        <span style={{ color, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,0.10)", borderRadius: 99 }}>
        <div style={{ height: "100%", width: `${relW}%`, background: color, borderRadius: 99 }} />
      </div>
    </div>
  );
}

export default function AdminResearch() {
  const [aggregate,   setAggregate]   = useState(null);
  const [mlStatus,    setMlStatus]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [compareData, setCompareData] = useState(null);
  const [comparing,   setComparing]   = useState(false);
  const [compareErr,  setCompareErr]  = useState(null);

  const load = () => {
    setLoading(true);
    Promise.allSettled([getAggregateDashboard(), getMlStatus()])
      .then(([aggResult, mlResult]) => {
        if (aggResult.status === "fulfilled") setAggregate(aggResult.value.data);
        if (mlResult.status  === "fulfilled") setMlStatus(mlResult.value.data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const summaries    = aggregate?.trip_summaries || [];
  const mrGood = summaries.filter(t => t.direction === "MALANDAY-RECTO").reduce((s, t) => s + (t.good_count || 0), 0);
  const rmGood = summaries.filter(t => t.direction === "RECTO-MALANDAY").reduce((s, t) => s + (t.good_count || 0), 0);

  const handleCompare = async () => {
    const tripIds = (aggregate?.trip_summaries || []).map(t => t.trip_id).filter(Boolean);
    if (!tripIds.length) return;
    setComparing(true);
    setCompareErr(null);
    try {
      const res = await runMergedCompare(tripIds);
      setCompareData(res.data);
    } catch (e) {
      setCompareErr(e.response?.data?.detail || "Compare failed — try again.");
    } finally {
      setComparing(false);
    }
  };

  const featImp     = mlStatus?.feature_importance || [];
  const maxFeatImp  = featImp.reduce((m, f) => Math.max(m, f.importance), 0);
  const metrics     = mlStatus?.metrics || {};

  const trainedAtPHT = mlStatus?.trained_at
    ? `${phtDateStr(mlStatus.trained_at)} ${phtTimeStr(mlStatus.trained_at)} PHT`
    : null;

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
          {/* ── Stop Detection Readiness ──────────────────────────────────── */}
          <div className="admin-card">
            <div className="admin-card-title">Stop Detection Readiness</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { label: "Malanday → Recto", good: mrGood,          color: "#42a5f5" },
                { label: "Recto → Malanday", good: rmGood,          color: "#00b4d8" },
                { label: "Combined Pool",    good: mrGood + rmGood,  color: "#30d158" },
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

          {/* ── ML Model Intelligence ─────────────────────────────────────── */}
          <div className="admin-card">
            <div className="admin-card-title">
              ML Model Intelligence
              {mlStatus?.trained && (
                <span style={{ marginLeft: 10, fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(48,209,88,0.14)", color: "#30d158", border: "1px solid rgba(48,209,88,0.28)", fontWeight: 700 }}>
                  TRAINED
                </span>
              )}
              {mlStatus && !mlStatus.trained && (
                <span style={{ marginLeft: 10, fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(255,69,58,0.14)", color: "#ff453a", border: "1px solid rgba(255,69,58,0.28)", fontWeight: 700 }}>
                  NOT TRAINED
                </span>
              )}
            </div>

            {!mlStatus?.trained ? (
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
                Random Forest model not yet trained. Run <code>train_pipeline.py</code> to generate <code>rf_model.pkl</code>.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

                {/* Left: metrics */}
                <div>
                  {trainedAtPHT && (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginBottom: 14 }}>
                      Trained {trainedAtPHT}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    {[
                      { label: "Accuracy",   value: metrics.accuracy_pct   ? `${metrics.accuracy_pct}%` : "—", accent: "#30d158"  },
                      { label: "F1 Weighted", value: metrics.f1_weighted   || "—",                             accent: "#42a5f5"  },
                      { label: "F1 (Stop)",   value: metrics.f1_stop       || "—",                             accent: "#00b4d8"  },
                      { label: "Train/Test",  value: metrics.training_samples && metrics.test_samples
                          ? `${metrics.training_samples}/${metrics.test_samples}` : "—",                       accent: "#ffd60a"  },
                    ].map(({ label, value, accent }) => (
                      <div key={label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.10)" }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: accent, fontFamily: "var(--mono)" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {metrics.smote_applied && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, padding: "3px 9px", borderRadius: 5, background: "rgba(191,90,242,0.12)", color: "#bf5af2", border: "1px solid rgba(191,90,242,0.25)", fontWeight: 700 }}>
                      SMOTE applied — class imbalance handled
                    </div>
                  )}
                </div>

                {/* Right: feature importance */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10 }}>
                    Feature Importance
                  </div>
                  {featImp.length === 0 ? (
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.38)" }}>No feature importance data found.</p>
                  ) : (
                    [...featImp]
                      .sort((a, b) => b.importance - a.importance)
                      .map(f => (
                        <FeatureBar key={f.feature} feature={f.feature} importance={f.importance} maxImportance={maxFeatImp} />
                      ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Algorithm Comparison ─────────────────────────────────────── */}
          <div className="admin-card">
            <div className="admin-card-title" style={{ justifyContent: "space-between" }}>
              <span>Algorithm Comparison</span>
              <button
                onClick={handleCompare}
                disabled={comparing || !(aggregate?.trip_summaries?.length)}
                style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  fontFamily: "var(--font)", cursor: comparing ? "not-allowed" : "pointer",
                  border: "1px solid rgba(66,165,245,0.35)",
                  background: comparing ? "rgba(255,255,255,0.06)" : "rgba(66,165,245,0.12)",
                  color: comparing ? "rgba(255,255,255,0.38)" : "#42a5f5",
                }}
              >
                {comparing ? "Running…" : compareData ? "↺ Re-run" : "▶ Run Compare"}
              </button>
            </div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", margin: "0 0 14px" }}>
              Runs Vanilla DBSCAN, Kalman-filtered DBSCAN, and W-DBSCAN on all {aggregate?.trip_summaries?.length || 0} completed trips pooled together, then evaluates detected clusters against 70 ground-truth stops.
            </p>

            {compareErr && (
              <div className="admin-msg error" style={{ marginBottom: 12 }}>{compareErr}</div>
            )}

            {compareData && (() => {
              const ev = compareData.evalData || {};
              const algs = [
                { key: "vanilla",  label: "Vanilla DBSCAN",         color: "#42a5f5" },
                { key: "kalman",   label: "Kalman + DBSCAN",        color: "#00b4d8" },
                { key: "weighted", label: "W-DBSCAN",               color: "#bf5af2" },
              ];
              return (
                <>
                  {/* Cluster counts comparison */}
                  <div className="admin-table-wrap" style={{ marginBottom: 16 }}>
                    <table className="admin-table">
                      <thead><tr>
                        <th>Algorithm</th><th>Clusters</th><th>Noise Ratio</th><th>TP</th><th>FP</th><th>FN</th><th>Precision</th><th>Recall</th><th>F1</th><th>MAE (m)</th>
                      </tr></thead>
                      <tbody>
                        {algs.map(({ key, label, color }) => {
                          const d = compareData[key] || {};
                          const nc = (d.clusters || []).length;
                          const nr = typeof d.noise_ratio === "number" ? `${(d.noise_ratio * 100).toFixed(1)}%` : "—";
                          const isVanilla = key === "vanilla";
                          return (
                            <tr key={key}>
                              <td style={{ fontWeight: 700, color }}>{label}</td>
                              <td className="admin-mono" style={{ color }}>{nc}</td>
                              <td className="admin-mono" style={{ color: "rgba(255,255,255,0.60)" }}>{nr}</td>
                              {isVanilla ? (
                                <>
                                  <td className="admin-mono" style={{ color: "#30d158" }}>{ev.true_positives ?? "—"}</td>
                                  <td className="admin-mono" style={{ color: "#ff453a" }}>{ev.false_positives ?? "—"}</td>
                                  <td className="admin-mono" style={{ color: "#ffd60a" }}>{ev.false_negatives ?? "—"}</td>
                                  <td className="admin-mono" style={{ color: "#30d158", fontWeight: 700 }}>{typeof ev.precision === "number" ? `${(ev.precision * 100).toFixed(1)}%` : "—"}</td>
                                  <td className="admin-mono" style={{ color: "#42a5f5", fontWeight: 700 }}>{typeof ev.recall    === "number" ? `${(ev.recall    * 100).toFixed(1)}%` : "—"}</td>
                                  <td className="admin-mono" style={{ color: "#ffd60a", fontWeight: 700 }}>{typeof ev.f1_score  === "number" ? `${(ev.f1_score  * 100).toFixed(1)}%` : "—"}</td>
                                  <td className="admin-mono" style={{ color: "rgba(255,255,255,0.60)" }}>{typeof ev.mae_m === "number" ? `${ev.mae_m.toFixed(1)}` : "—"}</td>
                                </>
                              ) : (
                                <td colSpan={7} style={{ color: "rgba(255,255,255,0.30)", fontSize: 11 }}>Evaluation run on Vanilla DBSCAN clusters</td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Cluster quality metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[
                      {
                        label: "Silhouette Score",
                        value: typeof ev.silhouette?.score === "number" ? ev.silhouette.score.toFixed(3) : "—",
                        sub:   ev.silhouette?.interpretation || "",
                        accent: (() => {
                          const s = ev.silhouette?.score;
                          return typeof s === "number" ? (s > 0.5 ? "#30d158" : s > 0.2 ? "#ffd60a" : "#ff453a") : "#8e9ab0";
                        })(),
                      },
                      {
                        label: "Davies-Bouldin Index",
                        value: typeof ev.davies_bouldin?.index === "number" ? ev.davies_bouldin.index.toFixed(3) : "—",
                        sub:   ev.davies_bouldin?.interpretation || "",
                        accent: (() => {
                          const db = ev.davies_bouldin?.index;
                          return typeof db === "number" ? (db < 0.5 ? "#30d158" : db < 1.0 ? "#ffd60a" : "#ff453a") : "#8e9ab0";
                        })(),
                      },
                    ].map(({ label, value, sub, accent }) => (
                      <div key={label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.10)" }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: accent, fontFamily: "var(--mono)", marginBottom: 4 }}>{value}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.42)" }}>{sub}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 10 }}>
                    Pooled {compareData.total_logs?.toLocaleString()} GPS logs across {compareData.source_trips?.length} trips · ε=50m minPts=5
                  </div>
                </>
              );
            })()}
          </div>

          {/* ── Trip Quality Trend ────────────────────────────────────────── */}
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
