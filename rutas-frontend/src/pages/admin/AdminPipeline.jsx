import { useState, useEffect } from "react";
import { getAdminTrips, getTripPipeline } from "../../services/api";
import { phtDateStr, dirLabel } from "../../utils/adminFormatters";
import "../AdminDashboard.css";

const STAGE_ACCENT = ["#42a5f5", "#00b4d8", "#30d158", "#ffd60a", "#ff9f0a", "#bf5af2"];

function StageCard({ index, title, children }) {
  return (
    <div style={{
      display: "flex", gap: 16, marginBottom: 12,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.10)",
      borderLeft: `3px solid ${STAGE_ACCENT[index]}`,
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: STAGE_ACCENT[index] + "22", border: `1px solid ${STAGE_ACCENT[index]}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: STAGE_ACCENT[index], fontFamily: "var(--mono)" }}>
        {index + 1}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: STAGE_ACCENT[index], marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function QualityBar({ label, count, pct, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: "rgba(255,255,255,0.65)" }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{count.toLocaleString()} <span style={{ color: "rgba(255,255,255,0.38)", fontWeight: 400 }}>({pct}%)</span></span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,0.10)", borderRadius: 99 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99 }} />
      </div>
    </div>
  );
}

export default function AdminPipeline() {
  const [trips,    setTrips]    = useState([]);
  const [tripId,   setTripId]   = useState("");
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [err,      setErr]      = useState(null);

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
    getTripPipeline(tripId)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.detail || "Failed to load pipeline data."))
      .finally(() => setLoading(false));
  }, [tripId]);

  const pipe  = data?.pipeline || {};
  const sum   = data?.summary  || {};
  const s3    = pipe.stage_3_quality_classification || {};
  const s4    = pipe.stage_4_poor_exclusion || {};
  const s5    = pipe.stage_5_velocity_filter || {};
  const s6    = pipe.stage_6_centroid_validation || {};

  const summarySteps = sum.raw_logs ? [
    { label: "Raw Logs",          value: sum.raw_logs,            color: "#8e9ab0" },
    { label: "DBSCAN Input",      value: sum.dbscan_input,        color: "#42a5f5" },
    { label: "Stop Clusters",     value: sum.final_stop_clusters, color: "#30d158" },
  ] : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Pipeline Inspector</h1>
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

      {loading && <div className="admin-loading">Running pipeline analysis…</div>}
      {err    && <div className="admin-msg error">{err}</div>}

      {data && (
        <>
          {/* Summary flow */}
          <div className="admin-card" style={{ marginBottom: 18 }}>
            <div className="admin-card-title">Pipeline Summary</div>
            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
              {summarySteps.map(({ label, value, color }, i) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 20px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: "var(--mono)" }}>{value?.toLocaleString() ?? "—"}</div>
                  </div>
                  {i < summarySteps.length - 1 && (
                    <div style={{ padding: "0 10px", color: "rgba(255,255,255,0.28)", fontSize: 18, fontWeight: 300 }}>→</div>
                  )}
                </div>
              ))}
              {sum.ghost_cluster_risk && (
                <div style={{ marginLeft: "auto", fontSize: 10, padding: "4px 10px", borderRadius: 5, background: "rgba(48,209,88,0.12)", color: "#30d158", border: "1px solid rgba(48,209,88,0.25)", fontWeight: 700, whiteSpace: "nowrap" }}>
                  ✓ {sum.ghost_cluster_risk}
                </div>
              )}
            </div>
          </div>

          {/* 6 stage cards */}
          <div className="admin-card">
            <div className="admin-card-title">Processing Stages</div>

            <StageCard index={0} title="Bounding Box Filter">
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
                {pipe.stage_1_bounding_box?.description} — Bounds: <code style={{ color: "#42a5f5" }}>{pipe.stage_1_bounding_box?.bounds}</code>
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 5 }}>{pipe.stage_1_bounding_box?.action}</div>
            </StageCard>

            <StageCard index={1} title="Schema Validation">
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 6 }}>{pipe.stage_2_schema_validation?.description}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(pipe.stage_2_schema_validation?.rules || []).map(r => (
                  <span key={r} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(0,180,216,0.12)", color: "#00b4d8", border: "1px solid rgba(0,180,216,0.25)", fontFamily: "var(--mono)" }}>{r}</span>
                ))}
              </div>
            </StageCard>

            <StageCard index={2} title="GPS Quality Classification">
              {s3.total_logs ? (
                <>
                  <QualityBar label="GOOD (≤20m accuracy)"       count={s3.good_count}       pct={s3.good_pct}       color="#30d158" />
                  <QualityBar label="ACCEPTABLE (≤50m accuracy)" count={s3.acceptable_count} pct={s3.acceptable_pct} color="#ffd60a" />
                  <QualityBar label="POOR (>50m accuracy)"       count={s3.poor_count}       pct={s3.poor_pct}       color="#ff453a" />
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>Total: {s3.total_logs?.toLocaleString()} logs</div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>No quality data.</div>
              )}
            </StageCard>

            <StageCard index={3} title="POOR Log Exclusion">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
                {[
                  { label: "Before Filter", value: s4.logs_before_filter, color: "#8e9ab0" },
                  { label: "After Filter",  value: s4.logs_after_filter,  color: "#42a5f5" },
                  { label: "Excluded",      value: s4.logs_excluded,      color: "#ff453a" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "var(--mono)" }}>{value?.toLocaleString() ?? "—"}</div>
                  </div>
                ))}
              </div>
              {s4.exclusion_rate_pct != null && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ height: 5, background: "rgba(255,255,255,0.10)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${s4.exclusion_rate_pct}%`, background: "#ff453a", borderRadius: 99 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 3 }}>{s4.exclusion_rate_pct}% exclusion rate</div>
                </div>
              )}
              {s4.rationale && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>{s4.rationale}</div>}
            </StageCard>

            <StageCard index={4} title="Velocity Filter">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
                {[
                  { label: "True Stops",      value: s5.true_stop_clusters,      color: "#30d158", threshold: s5.thresholds?.TRUE_STOP      },
                  { label: "Creeping Queues", value: s5.creeping_queue_clusters,  color: "#ffd60a", threshold: s5.thresholds?.CREEPING_QUEUE },
                  { label: "Moving (excluded)", value: s5.moving_clusters,         color: "#ff453a", threshold: s5.thresholds?.MOVING         },
                ].map(({ label, value, color, threshold }) => (
                  <div key={label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "var(--mono)", marginBottom: 2 }}>{value ?? "—"}</div>
                    {threshold && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.30)", fontFamily: "var(--mono)" }}>{threshold}</div>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)" }}>Total clusters detected by DBSCAN: {s5.clusters_detected ?? "—"}</div>
            </StageCard>

            <StageCard index={5} title="Centroid Validation">
              <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 14px" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>GT Stops</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#bf5af2", fontFamily: "var(--mono)" }}>{s6.ground_truth_stops ?? "—"}</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 14px" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Match Threshold</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#bf5af2", fontFamily: "var(--mono)" }}>{s6.match_threshold_m ?? "—"}m</div>
                </div>
              </div>
              {s6.note && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", lineHeight: 1.5 }}>{s6.note}</div>}
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>Full evaluation available via <code style={{ color: "#bf5af2" }}>GET /analytics/&#123;id&#125;/evaluate</code></div>
            </StageCard>
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
