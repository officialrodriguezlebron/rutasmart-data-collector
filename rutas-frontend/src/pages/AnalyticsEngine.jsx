import { useState, useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authService } from "../services/authService";
// getAggregateDashboard removed — analytics engine fetches directly via fetch()
import TripMap from "./TripMap";
import "./AnalyticsEngine.css";

const API = import.meta.env.VITE_API_URL;
if (!API && typeof window !== "undefined") {
  console.error(
    "RutaSmart: VITE_API_URL is not set. Analytics will not load. " +
    "Configure VITE_API_URL in your hosting provider's environment variables."
  );
}

const COLORS = {
  good:        "#2e7d32",
  acceptable:  "#ef6c00",
  poor:        "#c62828",
  normal:      "#2e7d32",
  moderate:    "#ef6c00",
  high:        "#d84315",
  critical:    "#c62828",
  morning:     "#1565c0",
  midday:      "#2e7d32",
  afternoon:   "#ef6c00",
  offpeak:     "#888780",
};

const DEMAND_COLOR = {
  Normal:   COLORS.normal,
  Moderate: COLORS.moderate,
  High:     COLORS.high,
  Critical: COLORS.critical,
};

// ── Centroid shift helper ───────────────────────────────────────────────────
// DBSCAN cluster IDs are not stable across runs — the same physical stop can
// emerge with label 3 in the vanilla run and label 7 after Kalman smoothing.
// Matching by array index (the original approach) compared unrelated clusters
// and produced meaningless "shift" distances.
//
// This helper does nearest-centroid matching with a Haversine-accurate metric:
// for each cluster in `base`, find the closest cluster in `other` within
// `maxMatchM` and report that distance. Unmatched bases are returned as null
// (UI renders them as "—"). Symmetric in spirit — we report shift from the
// vanilla cluster's perspective, which is what Chapter 4 needs.
function haversineMetres(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function matchCentroidShifts(base, other, maxMatchM = 150) {
  if (!base?.length || !other?.length) return null;
  return base.map((b) => {
    let best = Infinity;
    let bestCluster = null;
    for (const o of other) {
      const d = haversineMetres(
        b.centroid_lat, b.centroid_lon,
        o.centroid_lat, o.centroid_lon,
      );
      if (d < best) { best = d; bestCluster = o; }
    }
    return best <= maxMatchM
      ? { distance_m: best, matched: bestCluster }
      : { distance_m: null, matched: null };
  });
}

const PERIOD_COLOR = {
  "Morning Peak":   COLORS.morning,
  "Midday":         COLORS.midday,
  "Afternoon Peak": COLORS.afternoon,
  "Off-Peak":       COLORS.offpeak,
};

// ── Tip — hover ? icon with a plain-language explanation ────────────────────
// Helps non-technical inspectors understand a term without cluttering the UI.
function Tip({ text }) {
  return (
    <span className="ae-tip" tabIndex={0} aria-label={text}>
      <span className="ae-tip-icon" aria-hidden="true">?</span>
      <span className="ae-tip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

// ── HelpBox — a glass info banner explaining what a section shows ───────────
// variant: "info" (blue) or "warn" (amber, for researcher-only sections)
function HelpBox({ children, variant = "info" }) {
  return (
    <div className={`ae-helpbox ae-helpbox-${variant}`}>
      <span className="ae-helpbox-icon" aria-hidden="true">
        {variant === "warn" ? "⚠" : "ℹ"}
      </span>
      <span className="ae-helpbox-text">{children}</span>
    </div>
  );
}

function MetricCard({ label, value, sub, variant, hint, tip }) {
  return (
    <div className="ae-metric">
      <span className="ae-metric-label">
        {label}{tip && <Tip text={tip} />}
      </span>
      <span className={`ae-metric-value ${variant || ""}`}>{value}</span>
      {hint && <span className="ae-metric-hint">{hint}</span>}
      {sub && <span className="ae-metric-sub">{sub}</span>}
    </div>
  );
}

function BarRow({ label, pct, count, color }) {
  return (
    <div className="ae-bar-row">
      <span className="ae-bar-label">{label}</span>
      <div className="ae-bar-track">
        <div className="ae-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="ae-bar-pct">{pct.toFixed(1)}%</span>
      <span className="ae-bar-count">({count})</span>
    </div>
  );
}

function SectionHeader({ title, badge }) {
  return (
    <div className="ae-section-header">
      <span className="ae-section-title">{title}</span>
      {badge && <span className="ae-section-badge">{badge}</span>}
    </div>
  );
}


// ── Algorithm Comparison Dashboard ─────────────────────────────────────────
function AlgorithmComparison({ comparing, compareData, compareError }) {
  if (comparing) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                  justifyContent:"center", padding:60, gap:16 }}>
      <span className="ae-spinner" style={{ width:32, height:32, borderWidth:3 }} />
      <p style={{ color:"#555", fontSize:14 }}>
        Running Vanilla DBSCAN · Kalman+DBSCAN · W-DBSCAN · ML Evaluation…
      </p>
    </div>
  );

  if (compareError) return (
    <div className="ae-error" style={{ margin:"20px 0" }}>{compareError}</div>
  );

  if (!compareData) return (
    <div style={{ padding:40, textAlign:"center", color:"#aaa", fontSize:14 }}>
      Click <strong>📊 Compare Algorithms</strong> to run all three methods and
      view the statistical comparison.
    </div>
  );

  const { vanilla, kalman, weighted, evalData, shiftKalman, shiftWeighted } = compareData;

  // shiftKalman/shiftWeighted entries: { distance_m, matched } | null
  // distance_m is null when no other-cluster fell within the 150m match
  // threshold (i.e. the smoothed/weighted run produced a different stop set).
  const shiftStats = (arr) => {
    if (!arr?.length) return { avg: "—", matched: 0, total: 0 };
    const dists = arr.map((e) => e?.distance_m).filter((d) => d != null);
    if (!dists.length) return { avg: "—", matched: 0, total: arr.length };
    const avg = dists.reduce((a, b) => a + b, 0) / dists.length;
    return { avg: avg.toFixed(2), matched: dists.length, total: arr.length };
  };

  const typeCount = (clusters, type) =>
    clusters?.filter(c => c.cluster_type === type).length ?? 0;

  const methods = [
    { label:"Vanilla DBSCAN",  key:"vanilla",  data:vanilla,  color:"#1565c0", shift:null,          icon:"①" },
    { label:"Kalman + DBSCAN", key:"kalman",   data:kalman,   color:"#2e7d32", shift:shiftKalman,   icon:"②" },
    { label:"W-DBSCAN",        key:"weighted", data:weighted, color:"#ef6c00", shift:shiftWeighted, icon:"③" },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* Researcher-only notice — inspectors can skip this tab */}
      <HelpBox variant="warn">
        <strong>Inspectors can skip this tab.</strong> It compares three technical
        stop-detection methods against the 70 official LTFRB stops — used only for
        the thesis evaluation. Everything you need for daily operations is in the
        other tabs.
      </HelpBox>

      {/* Method summary cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:12 }}>
        {methods.map(m => (
          <div key={m.key} style={{
            background:"white", borderRadius:14, padding:18, boxShadow:"0 4px 16px rgba(0,0,0,.06)",
            borderTop:`4px solid ${m.color}`
          }}>
            <div style={{ fontSize:13, fontWeight:700, color:m.color, marginBottom:12 }}>
              {m.icon} {m.label}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {[
                ["Clusters",   m.data?.clusters?.length ?? "—"],
                ["TRUE_STOP",  typeCount(m.data?.clusters,"TRUE_STOP")],
                ["CREEP",      typeCount(m.data?.clusters,"CREEPING_QUEUE")],
                ["MOVING",     typeCount(m.data?.clusters,"MOVING")],
              ].map(([label, value]) => (
                <div key={label} style={{ background:"#f8fafc", borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ fontSize:18, fontWeight:700, color:m.color, fontFamily:"monospace" }}>{value}</div>
                  <div style={{ fontSize:10, color:"#aaa", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>
                </div>
              ))}
              {m.shift && (() => {
                const s = shiftStats(m.shift);
                return (
                  <div style={{ gridColumn:"1/-1", background:"#f3e5f5", borderRadius:8, padding:"8px 10px" }}>
                    <div style={{ fontSize:18, fontWeight:700, color:"#6200ea", fontFamily:"monospace" }}>
                      {s.avg}{s.avg !== "—" ? "m" : ""}
                    </div>
                    <div style={{ fontSize:10, color:"#9c27b0", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                      Avg centroid shift vs vanilla · {s.matched}/{s.total} matched
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* ML Evaluation table */}
      {evalData && (
        <div style={{ background:"white", borderRadius:14, padding:20, boxShadow:"0 4px 16px rgba(0,0,0,.06)" }}>
          <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase",
                        letterSpacing:"0.06em", color:"#888", marginBottom:14 }}>
            ML Evaluation Metrics (Vanilla DBSCAN · eps={evalData.eps_m}m · minPts={evalData.min_samples})
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {[
              { label:"Silhouette Coefficient",  value:evalData.silhouette?.score?.toFixed(4),             target:"≥ 0.5",  pass: evalData.silhouette?.score >= 0.5 },
              { label:"Davies-Bouldin Index",    value:evalData.davies_bouldin?.index?.toFixed(4),         target:"< 1.0",  pass: evalData.davies_bouldin?.index < 1.0 },
              { label:"MAE (matched stops)",     value:evalData.mae_m != null ? evalData.mae_m.toFixed(2)+"m":"—", target:"≤ 50m", pass: evalData.mae_m <= 50 },
              { label:"Precision",               value:evalData.precision?.toFixed(4),                     target:"≥ 0.70", pass: evalData.precision >= 0.7 },
              { label:"Recall",                  value:evalData.recall?.toFixed(4),                        target:"—",      pass: null },
              { label:"F1-score",                value:evalData.f1_score?.toFixed(4),                      target:"≥ 0.70", pass: evalData.f1_score >= 0.7 },
              { label:"True Positives (TP)",     value:evalData.true_positives,                            target:"—",      pass: null },
              { label:"False Positives (FP)",    value:evalData.false_positives,                           target:"—",      pass: null },
              { label:"False Negatives (FN)",    value:evalData.false_negatives,                           target:"—",      pass: null },
            ].map(({ label, value, target, pass }) => (
              <div key={label} style={{
                display:"grid", gridTemplateColumns:"2fr 1fr 80px 60px",
                gap:8, alignItems:"center", padding:"8px 12px",
                background:"#f8fafc", borderRadius:8,
              }}>
                <span style={{ fontSize:13, color:"#1f2937" }}>{label}</span>
                <span style={{
                  fontSize:14, fontWeight:700, fontFamily:"monospace",
                  color: pass===true?"#2e7d32": pass===false?"#c62828":"#1565c0"
                }}>{value ?? "—"}</span>
                <span style={{ fontSize:11, color:"#aaa" }}>{target}</span>
                <span style={{
                  fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                  textAlign:"center",
                  background: pass===true?"#e8f5e9": pass===false?"#ffebee":"#f4f6f8",
                  color: pass===true?"#2e7d32": pass===false?"#c62828":"#888",
                }}>
                  {pass===true?"PASS": pass===false?"FAIL":"—"}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize:11, color:"#aaa", marginTop:10 }}>
            {evalData.silhouette?.interpretation} · {evalData.davies_bouldin?.interpretation}
          </p>
        </div>
      )}

      {/* Centroid comparison table */}
      {vanilla?.clusters?.length > 0 && (
        <div style={{ background:"white", borderRadius:14, overflow:"hidden",
                      boxShadow:"0 4px 16px rgba(0,0,0,.06)" }}>
          <div style={{ padding:"16px 20px 0" }}>
            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase",
                          letterSpacing:"0.06em", color:"#888", marginBottom:12 }}>
              Centroid Positions — Vanilla vs Kalman vs W-DBSCAN
            </div>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8fafc", borderBottom:"1px solid #e5e7eb" }}>
                  {["Cluster","Type","Vanilla (lat,lon)","Kalman (lat,lon)","Δ Kalman","W-DBSCAN (lat,lon)","Δ W","LF%"]
                    .map(h => <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:10,
                                                    fontWeight:700, textTransform:"uppercase",
                                                    letterSpacing:"0.05em", color:"#888",
                                                    whiteSpace:"nowrap" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {vanilla.clusters.map((c,i) => {
                  const kShift = shiftKalman?.[i];
                  const wShift = shiftWeighted?.[i];
                  const kc = kShift?.matched;   // nearest Kalman cluster within 150m, or null
                  const wc = wShift?.matched;   // nearest W-DBSCAN cluster within 150m, or null
                  const typeColors = {
                    TRUE_STOP:      { bg:"#e8f0fe", color:"#1565c0" },
                    CREEPING_QUEUE: { bg:"#fff3e0", color:"#ef6c00" },
                    MOVING:         { bg:"#ffebee", color:"#c62828" },
                  };
                  const tc = typeColors[c.cluster_type] || { bg:"#f4f6f8", color:"#888" };
                  return (
                    <tr key={c.cluster_id} style={{ borderBottom:"1px solid #f0f2f5" }}>
                      <td style={{ padding:"10px 14px", fontFamily:"monospace", fontWeight:700 }}>C-{c.cluster_id}</td>
                      <td style={{ padding:"10px 14px" }}>
                        <span style={{ fontSize:10, fontWeight:700, padding:"2px 6px",
                                       borderRadius:4, background:tc.bg, color:tc.color }}>
                          {c.cluster_type.replace(/_/g," ")}
                        </span>
                      </td>
                      <td style={{ padding:"10px 14px", fontFamily:"monospace", color:"#1565c0", fontSize:11 }}>
                        {c.centroid_lat.toFixed(5)}, {c.centroid_lon.toFixed(5)}
                      </td>
                      <td style={{ padding:"10px 14px", fontFamily:"monospace", color:"#2e7d32", fontSize:11 }}>
                        {kc ? `${kc.centroid_lat.toFixed(5)}, ${kc.centroid_lon.toFixed(5)}` : "—"}
                      </td>
                      <td style={{ padding:"10px 14px", fontWeight:700, color:"#2e7d32" }}>
                        {kShift?.distance_m != null ? kShift.distance_m.toFixed(1)+"m" : "—"}
                      </td>
                      <td style={{ padding:"10px 14px", fontFamily:"monospace", color:"#ef6c00", fontSize:11 }}>
                        {wc ? `${wc.centroid_lat.toFixed(5)}, ${wc.centroid_lon.toFixed(5)}` : "—"}
                      </td>
                      <td style={{ padding:"10px 14px", fontWeight:700, color:"#ef6c00" }}>
                        {wShift?.distance_m != null ? wShift.distance_m.toFixed(1)+"m" : "—"}
                      </td>
                      <td style={{ padding:"10px 14px", fontWeight:700, color:"#1565c0" }}>
                        {c.load_factor_pct?.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize:11, color:"#aaa", padding:"8px 20px 14px" }}>
            Δ = Haversine distance from Vanilla centroid. Larger values indicate stronger smoothing / weighting effect.
          </p>
        </div>
      )}

      {/* GT match detail */}
      {evalData?.matches?.length > 0 && (
        <div style={{ background:"white", borderRadius:14, overflow:"hidden",
                      boxShadow:"0 4px 16px rgba(0,0,0,.06)" }}>
          <div style={{ padding:"16px 20px 0" }}>
            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase",
                          letterSpacing:"0.06em", color:"#888", marginBottom:12 }}>
              Ground Truth Match Detail · {evalData.match_threshold_m}m threshold · 23 GT stops
            </div>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8fafc", borderBottom:"1px solid #e5e7eb" }}>
                  {["Cluster","Nearest GT Stop","Offset (m)","Result"]
                    .map(h => <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:10,
                                                    fontWeight:700, textTransform:"uppercase",
                                                    letterSpacing:"0.05em", color:"#888" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {evalData.matches.map(m => (
                  <tr key={m.cluster_id} style={{ borderBottom:"1px solid #f0f2f5" }}>
                    <td style={{ padding:"10px 14px", fontFamily:"monospace", fontWeight:700 }}>C-{m.cluster_id}</td>
                    <td style={{ padding:"10px 14px", color:"#555" }}>{m.nearest_stop}</td>
                    <td style={{ padding:"10px 14px", fontWeight:700, fontFamily:"monospace",
                                 color: m.matched ? "#2e7d32":"#c62828" }}>
                      {m.offset_m.toFixed(1)}m
                    </td>
                    <td style={{ padding:"10px 14px" }}>
                      <span style={{
                        fontSize:10, fontWeight:700, padding:"2px 10px", borderRadius:20,
                        background: m.matched?"#e8f5e9":"#ffebee",
                        color: m.matched?"#2e7d32":"#c62828",
                      }}>
                        {m.matched ? "✓  TRUE POSITIVE" : "✗  FALSE POSITIVE"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

export default function AnalyticsEngine() {
  const navigate    = useNavigate();
  const [searchParams] = useSearchParams();
  const [tripId, setTripId]       = useState(searchParams.get("trip") || "");
  const [showMap, setShowMap]     = useState(false);
  const [epsM, setEpsM]           = useState(50);
  const [minPts, setMinPts]       = useState(5);
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [comparing,    setComparing]    = useState(false);
  const [compareData,  setCompareData]  = useState(null);
  const [compareError, setCompareError] = useState(null);

  // ── Mode switcher ────────────────────────────────────────────────────────
  const [mode,        setMode]        = useState("single");
  const [selectedDay, setSelectedDay] = useState(new Date().toISOString().slice(0, 10));
  const [aggData,     setAggData]     = useState(null);
  const [aggLoading,  setAggLoading]  = useState(false);
  const [aggError,    setAggError]    = useState(null);

  // ── Trip list — fetched once so admin can pick from a dropdown ───────────
  const [tripList,     setTripList]     = useState([]);
  const [tripsLoading, setTripsLoading] = useState(true);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_API_KEY || "";
    fetch(`${API}/admin/trips`, { headers: { "X-API-Key": apiKey } })
      .then(r => r.json())
      .then(d => {
        const completed = (d || []).filter(t => t.status === "COMPLETED");
        setTripList(completed);
        // If no tripId set yet and URL has one from admin panel, keep it
        // Otherwise pre-select the most recent completed trip
        if (!tripId && completed.length > 0) {
          setTripId(completed[0].trip_id);
        }
      })
      .catch(() => {}) // silently fail — manual input still works
      .finally(() => setTripsLoading(false));
    // Intentionally runs once on mount only. tripId is read only to check
    // if a URL param already pre-selected a trip — adding it to deps would
    // re-fetch on every keystroke in the trip ID input, which is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnalysis = useCallback(async () => {
    const id = tripId.trim();
    if (!id) { setError("Enter a trip ID first."); return; }
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch(
        `${API}/analytics/${encodeURIComponent(id)}/run-all?eps_m=${epsM}&min_samples=${minPts}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setData(await res.json());
      setActiveTab("overview");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tripId, epsM, minPts]);

  const rerunDBSCAN = useCallback(async () => {
    if (!data) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `${API}/analytics/${encodeURIComponent(data.trip_id)}/dbscan?eps_m=${epsM}&min_samples=${minPts}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dbscan = await res.json();
      setData(prev => ({ ...prev, dbscan }));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [data, epsM, minPts]);

  const q   = data?.gps_quality;
  // Clear comparison results when trip ID changes
  useEffect(() => {
    setCompareData(null);
    setCompareError(null);
  }, [tripId]);

  const runComparison = useCallback(async () => {
    setComparing(true);
    setCompareError(null);
    setCompareData(null);
    setActiveTab("compare");

    try {
      const apiKey = import.meta.env.VITE_API_KEY || "";
      const headers = { "X-API-Key": apiKey };

      // Merged mode — use the /merged/compare endpoint
      if ((mode === "day" || mode === "all") && aggData?.source_trips?.length) {
        const ids = aggData.source_trips.join(",");
        const url = `${API}/analytics/merged/compare?trip_ids=${encodeURIComponent(ids)}&eps_m=${epsM}&min_samples=${minPts}`;
        const res = await fetch(url, { headers });
        const json = await res.json();
        if (json.detail) throw new Error(json.detail);

        setCompareData({
          vanilla:       json.vanilla,
          kalman:        json.kalman,
          weighted:      json.weighted,
          evalData:      json.evalData,
          shiftKalman:   matchCentroidShifts(json.vanilla?.clusters, json.kalman?.clusters),
          shiftWeighted: matchCentroidShifts(json.vanilla?.clusters, json.weighted?.clusters),
        });
        return;
      }

      // Single trip mode — original behaviour
      const id = tripId.trim();
      if (!id) return;
      const eps = epsM; const mp = minPts;
      const [vanillaRes, kalmanRes, wRes, evalRes] = await Promise.all([
        fetch(`${API}/analytics/${encodeURIComponent(id)}/dbscan?eps_m=${eps}&min_samples=${mp}`, { headers }),
        fetch(`${API}/analytics/${encodeURIComponent(id)}/dbscan-kalman?eps_m=${eps}&min_samples=${mp}`, { headers }),
        fetch(`${API}/analytics/${encodeURIComponent(id)}/wdbscan?eps_m=${eps}&min_samples=${mp}`, { headers }),
        fetch(`${API}/analytics/${encodeURIComponent(id)}/evaluate?eps_m=${eps}&min_samples=${mp}`, { headers }),
      ]);
      const [vanilla, kalman, weighted, evalData] = await Promise.all([
        vanillaRes.json(), kalmanRes.json(), wRes.json(), evalRes.json(),
      ]);
      if (vanilla.detail) throw new Error(vanilla.detail);

      setCompareData({
        vanilla, kalman, weighted, evalData,
        shiftKalman:   matchCentroidShifts(vanilla.clusters, kalman.clusters),
        shiftWeighted: matchCentroidShifts(vanilla.clusters, weighted.clusters),
      });
    } catch (e) {
      setCompareError(e.message || "Comparison failed.");
    } finally {
      setComparing(false);
    }
  }, [tripId, epsM, minPts, mode, aggData]);
  const runAggregate = useCallback(async () => {
    setAggLoading(true); setAggError(null); setAggData(null);
    setData(null); setError(null); setCompareData(null); setCompareError(null);
    setActiveTab("overview");

    try {
      const apiKey = import.meta.env.VITE_API_KEY || "";
      const headers = { "X-API-Key": apiKey };

      // Step 1 — collect trip IDs for this mode
      let tripIds = [];
      if (mode === "all") {
        tripIds = tripList.filter(t => t.status === "COMPLETED").map(t => t.trip_id);
      } else {
        // By Day — filter tripList by PHT date.
        // start_time from backend is "2026-05-19 05:07:00" (space, no Z) stored as UTC.
        tripIds = tripList.filter(t => {
          if (t.status !== "COMPLETED") return false;
          const raw = t.start_time;
          if (!raw || raw === "None" || raw === "null") return false;
          // Normalise: "2026-05-19 05:07:00" → "2026-05-19T05:07:00Z"
          const utcStr = raw.replace(" ", "T").replace(/(\.\d+)?$/, "Z");
          const d = new Date(utcStr);
          if (isNaN(d.getTime())) {
            console.warn("[RutaSmart] Could not parse trip start_time:", raw);
            return false;
          }
          const phtDate = new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
          return phtDate === selectedDay;
        }).map(t => t.trip_id);
      }

      if (tripIds.length === 0) {
        setAggData({ empty: true, mode, date: selectedDay });
        return;
      }

      // Step 2 — call merged run-all endpoint
      const url = `${API}/analytics/merged/run-all?trip_ids=${encodeURIComponent(tripIds.join(","))}&eps_m=${epsM}&min_samples=${minPts}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const json = await res.json();

      // Step 3 — feed into setData so all 6 existing tabs render automatically
      setData(json);
      setAggData({
        mode,
        date: selectedDay,
        source_trips: json.source_trips,
        total_logs:   json.total_logs,
        label:        json.trip_id,
        empty:        false,
      });

    } catch (e) {
      setAggError(e.message || "Failed to load aggregate data.");
    } finally {
      setAggLoading(false);
    }
  }, [mode, selectedDay, tripList, epsM, minPts]);

  const db  = data?.dbscan;
  const lf  = data?.load_factor;
  const dem = data?.demand;
  const td  = data?.time_dist;

  const tabs = [
    { key: "overview",     label: "Overview"     },
    { key: "dbscan",       label: "DBSCAN"       },
    { key: "load factor",  label: "Load Factor"  },
    { key: "demand",       label: "Demand"       },
    { key: "time",         label: "Time"         },
    { key: "compare",      label: "📊 Compare"   },
  ];

  return (
    <div className="ae-page">

      {/* Header */}
      <div className="ae-header">
        <div className="ae-header-left">
          <button className="ae-back-btn" onClick={() => authService.isAdmin()
            ? navigate("/admin") : navigate("/login")}>
            ← {authService.isAdmin() ? "Admin Panel" : "Dashboard"}
          </button>
          <div className="ae-title-block">
            <h1>Analytics Engine</h1>
            <p>DBSCAN · Load Factor · Demand · Time Categorisation</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="ae-corridor-badge">Malanday–Recto</span>
          <button onClick={() => { authService.clearSession(); navigate("/login"); }}
            style={{ padding: "5px 12px", background: "white", border: "1px solid #e5e7eb",
                     borderRadius: 8, fontSize: 12, color: "#888", cursor: "pointer" }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="ae-layout">

        {/* Sidebar */}
        <aside className="ae-sidebar">

          {/* ── Mode selector ─────────────────────────────────── */}
          <div className="ae-card ae-mode-card">
            <p className="ae-card-title">Analysis Mode</p>
            <div className="ae-mode-tabs">
              {[
                { key: "single", icon: "🔍", label: "Single Trip"  },
                { key: "day",    icon: "📅", label: "By Day"       },
                { key: "all",    icon: "📊", label: "All Trips"    },
              ].map(({ key, icon, label }) => (
                <button
                  key={key}
                  className={`ae-mode-tab ${mode === key ? "active" : ""}`}
                  onClick={() => { setMode(key); setAggData(null); setAggError(null); setData(null); setError(null); }}
                >
                  <span className="ae-mode-tab-icon">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Mode intro help — plain-language guide for inspectors ── */}
          <HelpBox>
            {mode === "single" && (
              <><strong>Single Trip</strong> — deep-dive one jeepney run: how full it got, where it stopped, and which areas were busiest.</>
            )}
            {mode === "day" && (
              <><strong>By Day</strong> — combines every trip on one date into a single view. Best for daily inspector reports.</>
            )}
            {mode === "all" && (
              <><strong>All Trips</strong> — combines the full recorded history. Best for planning long-term schedules.</>
            )}
          </HelpBox>
          {mode === "single" && (
            <div className="ae-card">
              <p className="ae-card-title">Trip Selection</p>

              {/* Dropdown of completed trips */}
              <div className="ae-field">
                <label className="ae-label">Select trip</label>
                {tripsLoading ? (
                  <div style={{ fontSize: 12, color: "#8e9ab0", padding: "8px 0" }}>Loading trips…</div>
                ) : tripList.length > 0 ? (
                  <select
                    className="ae-select"
                    value={tripId}
                    onChange={e => setTripId(e.target.value)}
                  >
                    <option value="">— choose a trip —</option>
                    {tripList.map(t => (
                      <option key={t.trip_id} value={t.trip_id}>
                        {t.jeep_code} · {t.direction === "MALANDAY-RECTO" ? "Malanday → Recto" : "Recto → Malanday"} · {t.start_time?.slice(0, 10) || ""}
                      </option>
                    ))}
                  </select>
                ) : null}

                {/* Fallback manual input */}
                <label className="ae-label" style={{ marginTop: 8 }}>Or enter trip ID</label>
                <input
                  className="ae-input"
                  value={tripId}
                  onChange={e => setTripId(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runAnalysis()}
                  placeholder="2026-05-09_JEEP4_MLD-RCT_c49e"
                />
              </div>

              {/* Selected trip meta */}
              {tripId && tripList.find(t => t.trip_id === tripId) && (() => {
                const t = tripList.find(t => t.trip_id === tripId);
                return (
                  <div className="ae-trip-meta">
                    <span>🚌 {t.jeep_code}</span>
                    <span>{t.direction === "MALANDAY-RECTO" ? "Malanday → Recto" : "Recto → Malanday"}</span>
                    <span>Cap {t.official_capacity}</span>
                    <span className={`ae-status-pill ${t.status === "COMPLETED" ? "completed" : "active"}`}>{t.status}</span>
                  </div>
                );
              })()}

              <div className="ae-action-group">
                <button className="ae-run-btn ae-btn-primary" onClick={runAnalysis} disabled={loading || !tripId.trim()}>
                  {loading
                    ? <><span className="ae-spinner" /> Running…</>
                    : "▶  Run All Algorithms"
                  }
                </button>
                <div className="ae-action-row">
                  <button className="ae-run-btn ae-btn-secondary" style={{ background: "#0288d1" }}
                    onClick={() => setShowMap(true)} disabled={!tripId.trim()}>
                    🗺 Heatmap
                  </button>
                  <button className="ae-run-btn ae-btn-secondary" style={{ background: "#6200ea" }}
                    onClick={runComparison} disabled={comparing || !tripId.trim()}>
                    {comparing ? <><span className="ae-spinner" /> …</> : "📊 Compare"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── By Day controls ───────────────────────────────── */}
          {mode === "day" && (
            <div className="ae-card">
              <p className="ae-card-title">Select Date</p>
              <div className="ae-field">
                <label className="ae-label">Date (PHT)</label>
                <input
                  type="date"
                  className="ae-input"
                  value={selectedDay}
                  onChange={e => { setSelectedDay(e.target.value); setAggData(null); }}
                />
              </div>
              <div className="ae-day-hint">
                Aggregates all completed trips that started on this date — runs the same DBSCAN, Load Factor, Demand, and Time algorithms on the combined dataset.
              </div>
              <button className="ae-run-btn ae-btn-primary" onClick={runAggregate} disabled={aggLoading}>
                {aggLoading
                  ? <><span className="ae-spinner" /> Computing…</>
                  : `▶  Analyse ${selectedDay}`
                }
              </button>
              {aggData && !aggData.empty && (
                <button className="ae-run-btn" style={{ background: "#6200ea", marginTop: 8 }}
                  onClick={runComparison} disabled={comparing}>
                  {comparing ? <><span className="ae-spinner" /> Running…</> : "📊 Compare Algorithms"}
                </button>
              )}
            </div>
          )}

          {/* ── All Trips controls ────────────────────────────── */}
          {mode === "all" && (
            <div className="ae-card">
              <p className="ae-card-title">All Trips</p>
              <div className="ae-day-hint">
                Aggregates every completed trip in the database into a single summary.
              </div>
              <div className="ae-all-trips-count">
                {tripList.length > 0 && (
                  <span><strong>{tripList.length}</strong> completed trips available</span>
                )}
              </div>
              <button className="ae-run-btn ae-btn-primary" onClick={runAggregate} disabled={aggLoading}>
                {aggLoading
                  ? <><span className="ae-spinner" /> Computing…</>
                  : "▶  Run Aggregate Analysis"
                }
              </button>
              {aggData && !aggData.empty && (
                <button className="ae-run-btn" style={{ background: "#6200ea", marginTop: 8 }}
                  onClick={runComparison} disabled={comparing}>
                  {comparing ? <><span className="ae-spinner" /> Running…</> : "📊 Compare Algorithms"}
                </button>
              )}
              {aggData && (
                <button className="ae-run-btn" style={{ background: "#546e7a", marginTop: 8 }}
                  onClick={() => { setAggData(null); setAggError(null); setData(null); }}>
                  ↺ Reset
                </button>
              )}
            </div>
          )}

          {/* ── DBSCAN params — only show in single trip mode ─── */}
          {mode === "single" && (
            <div className="ae-card">
              <p className="ae-card-title">DBSCAN Parameters</p>

              <div className="ae-param">
                <div className="ae-param-header">
                  <span className="ae-param-label">Epsilon (metres)</span>
                  <span className="ae-param-value">{epsM}m</span>
                </div>
                <input type="range" min="10" max="200" step="5"
                  value={epsM} onChange={e => setEpsM(Number(e.target.value))}
                  className="ae-slider" />
              </div>

              <div className="ae-param">
                <div className="ae-param-header">
                  <span className="ae-param-label">Min samples</span>
                  <span className="ae-param-value">{minPts}</span>
                </div>
                <input type="range" min="2" max="20" step="1"
                  value={minPts} onChange={e => setMinPts(Number(e.target.value))}
                  className="ae-slider" />
              </div>

              <button className="ae-rerun-btn" onClick={rerunDBSCAN} disabled={loading || !data}>
                ↺ Re-run DBSCAN
              </button>

              <hr className="ae-divider" />

              <div className="ae-sensitivity-grid">
                {[
                  { eps: "30m",   note: "Too tight — splits stops", rec: false },
                  { eps: "50m ✓", note: "Blueprint default",        rec: true  },
                  { eps: "100m",  note: "Merges nearby stops",      rec: false },
                ].map(({ eps, note, rec }) => (
                  <div key={eps} className={`ae-sensitivity-row ${rec ? "recommended" : ""}`}>
                    <span className="ae-sensitivity-eps">{eps}</span>
                    <span className="ae-sensitivity-note">{note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </aside>

        {/* Main content */}
        <main className="ae-content">

          {error && (
            <div className="ae-error" role="alert">
              <span className="ae-error-icon" aria-hidden="true">⚠</span>
              {error}
            </div>
          )}

          {/* Aggregate error */}
          {aggError && (
            <div className="ae-error" role="alert">
              <span className="ae-error-icon">⚠</span> {aggError}
            </div>
          )}

          {/* Aggregate loading */}
          {aggLoading && (
            <div className="ae-empty">
              <span className="ae-spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
              <p>Computing aggregate data…</p>
            </div>
          )}

          {/* ── By Day / All Trips — merged mode banner + same tabs ── */}
          {aggData && !aggLoading && !aggData.empty && (
            <div className="ae-merged-banner">
              <span className="ae-merged-icon">
                {aggData.mode === "day" ? "📅" : "📊"}
              </span>
              <div className="ae-merged-text">
                <strong>
                  {aggData.mode === "day"
                    ? `Day Analysis — ${aggData.date}`
                    : "All Trips — Combined Analysis"}
                </strong>
                <span>
                  {aggData.source_trips?.length} trip{aggData.source_trips?.length !== 1 ? "s" : ""}
                  {" · "}{aggData.total_logs?.toLocaleString()} GPS logs combined
                  {" · "}DBSCAN and all algorithms run on merged dataset
                </span>
              </div>
            </div>
          )}

          {/* Empty result — no trips found for this day */}
          {aggData?.empty && !aggLoading && (
            <div className="ae-empty">
              <span className="ae-empty-icon">📭</span>
              <p>
                {aggData.mode === "day"
                  ? `No completed trips found on ${aggData.date}`
                  : "No completed trips in the database yet"}
              </p>
            </div>
          )}

          {/* Single trip empty state */}
          {mode === "single" && !data && !loading && !error && (
            <div className="ae-empty">
              <span className="ae-empty-icon" aria-hidden="true">🗺</span>
              <p>Select a completed trip and run the algorithms</p>
              <small>Trip must have status COMPLETED in the database</small>
            </div>
          )}

          {/* Day / All Trips empty state — not yet run */}
          {(mode === "day" || mode === "all") && !aggData && !aggLoading && !aggError && (
            <div className="ae-empty">
              <span className="ae-empty-icon">{mode === "day" ? "📅" : "📊"}</span>
              <p>{mode === "day"
                ? `Select a date and click Analyse`
                : `Click Run to aggregate all completed trips`}
              </p>
            </div>
          )}

          {data && (
            <>
              <nav className="ae-tabs" aria-label="Analytics sections">
                {tabs.map(({ key, label }) => (
                  <button
                    key={key}
                    className={`ae-tab ${activeTab === key ? "active" : ""}`}
                    onClick={() => setActiveTab(key)}
                    aria-selected={activeTab === key}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              {/* Overview */}
              {activeTab === "overview" && (
                <>
                  <div className="ae-metrics">
                    <MetricCard label="GPS pings"      value={q.total_logs}                           sub={`${q.dbscan_eligible} usable for stops`} tip="Number of location readings sent during the trip — one every 2–3 seconds." />
                    <MetricCard label="Poor signal"    value={`${q.poor_pct.toFixed(0)}%`}            sub={`${q.poor_count} readings`}      variant={q.poor_pct > 30 ? "danger" : q.poor_pct > 15 ? "warning" : ""} tip="Readings that were off by more than 50m. These are excluded from stop detection but still count for passenger numbers." />
                    <MetricCard label="Stops found"    value={db.clusters.length}                     sub="where people boarded/exited" variant="info" tip="Places where the jeep paused long enough for passengers to board or alight." />
                    <MetricCard label="How full"       value={`${lf.overall.avg_lf.toFixed(1)}%`}   sub={`peaked at ${lf.overall.max_lf.toFixed(1)}%`} variant={lf.overall.avg_lf >= 100 ? "danger" : lf.overall.avg_lf >= 80 ? "warning" : ""} tip="Load factor — passengers vs the 26-seat limit. 100% = exactly full, above 100% = overcrowded." />
                  </div>

                  <div className="ae-card">
                    <SectionHeader title="GPS quality breakdown" badge={`${q.dbscan_excluded} excluded from DBSCAN`} />
                    <div className="ae-bars">
                      <BarRow label="GOOD (≤20m)"       pct={q.good_pct}       count={q.good_count}       color={COLORS.good} />
                      <BarRow label="ACCEPTABLE (≤50m)" pct={q.acceptable_pct} count={q.acceptable_count} color={COLORS.acceptable} />
                      <BarRow label="POOR (>50m)"        pct={q.poor_pct}       count={q.poor_count}       color={COLORS.poor} />
                    </div>
                    {q.poor_pct === 100 && (
                      <div className="ae-notice">
                        <span className="ae-notice-icon" aria-hidden="true">ℹ</span>
                        100% POOR is expected on desktop — browser geolocation without GPS hardware returns ~50,000m accuracy.
                        DBSCAN will find no clusters. Use a real Android device during field rides.
                      </div>
                    )}
                  </div>

                  <div className="ae-card">
                    <SectionHeader title="Time period distribution" badge="PHT (UTC+8)" />
                    <div className="ae-bars">
                      {Object.entries(td.distribution).map(([period, { count, pct }]) => (
                        <BarRow key={period} label={period} pct={pct} count={count} color={PERIOD_COLOR[period]} />
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* DBSCAN */}
              {activeTab === "dbscan" && (
                <>
                  <div className="ae-metrics">
                    <MetricCard label="Clusters found" value={db.clusters.length}                           variant="info" />
                    <MetricCard label="DBSCAN input"   value={db.dbscan_input}  sub={`of ${db.total_input} logs`} />
                    <MetricCard label="Noise ratio"    value={`${(db.noise_ratio*100).toFixed(1)}%`} sub="POOR excluded" />
                    <MetricCard label="Spatial noise"  value={db.noise_points}  sub="non-cluster pts" />
                  </div>

                  <div className="ae-card" style={{ padding: 0, overflow: "hidden" }}>
                    {db.clusters.length === 0 ? (
                      <div className="ae-no-clusters">
                        <span className="ae-no-clusters-icon" aria-hidden="true">📍</span>
                        <p>No clusters detected</p>
                        <small>
                          {db.dbscan_input === 0
                            ? "All logs filtered as POOR — no data for spatial clustering."
                            : `Try lowering min samples (${db.min_samples}) or increasing eps (${db.eps_m}m).`}
                        </small>
                      </div>
                    ) : (
                      <div className="ae-table-wrap">
                        <table className="ae-table">
                          <thead>
                            <tr>
                              {["Cluster","Centroid","Points","Avg occ","Load factor","Demand","Peak period"].map(h => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {db.clusters.map(c => {
                              const lfColor = c.load_factor_pct >= 100 ? COLORS.critical : c.load_factor_pct >= 80 ? COLORS.high : c.load_factor_pct >= 60 ? COLORS.moderate : COLORS.normal;
                              return (
                                <tr key={c.cluster_id}>
                                  <td><span className="ae-cluster-id">C-{String(c.cluster_id).padStart(3,"0")}</span></td>
                                  <td><span className="ae-coord">{c.centroid_lat.toFixed(4)}, {c.centroid_lon.toFixed(4)}</span></td>
                                  <td>{c.point_count}</td>
                                  <td>{c.avg_occupancy.toFixed(1)}</td>
                                  <td>
                                    <div className="ae-lf-cell">
                                      <div className="ae-lf-track">
                                        <div className="ae-lf-fill" style={{ width: `${Math.min(c.load_factor_pct, 100)}%`, background: lfColor }} />
                                      </div>
                                      <span className={`ae-lf-text ${c.load_factor_pct >= 100 ? "over" : ""}`}>
                                        {c.load_factor_pct.toFixed(1)}%{c.load_factor_pct >= 100 ? " !" : ""}
                                      </span>
                                    </div>
                                  </td>
                                  <td><span className={`ae-badge ${c.demand_tier}`}>{c.demand_tier}</span></td>
                                  <td style={{ fontSize: 12, color: "#777" }}>{c.peak_period}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Load Factor */}
              {activeTab === "load factor" && (
                <>
                  <div className="ae-metrics">
                    <MetricCard label="Avg load factor" value={`${lf.overall.avg_lf.toFixed(1)}%`} variant={lf.overall.avg_lf >= 100 ? "danger" : ""} />
                    <MetricCard label="Max load factor" value={`${lf.overall.max_lf.toFixed(1)}%`} variant={lf.overall.max_lf >= 100 ? "danger" : ""} />
                    <MetricCard label="Min load factor" value={`${lf.overall.min_lf.toFixed(1)}%`} />
                    <MetricCard label="Capacity"        value={`C = ${lf.official_capacity}`}      sub="official seats" />
                  </div>

                  <div className="ae-card">
                    <SectionHeader title="Load factor by time period" badge="LF = occupancy ÷ capacity × 100" />
                    <div className="ae-lf-periods">
                      {Object.entries(lf.by_period).map(([period, stats]) => {
                        const color  = PERIOD_COLOR[period];
                        const isOver = stats.avg_lf >= 100;
                        const scale  = 150;
                        return (
                          <div key={period} className="ae-lf-period">
                            <div className="ae-lf-period-header">
                              <span className="ae-lf-period-label">
                                <span className="ae-lf-period-dot" style={{ background: color }} />
                                {period}
                              </span>
                              <span className={`ae-lf-period-stats ${isOver ? "over" : ""}`}>
                                avg {stats.avg_lf.toFixed(1)}% · max {stats.max_lf.toFixed(1)}% · {stats.log_count} logs
                              </span>
                            </div>
                            <div className="ae-lf-dual-track">
                              <div className="ae-lf-dual-max" style={{ width: `${Math.min(stats.max_lf, scale) / scale * 100}%`, background: color }} />
                              <div className="ae-lf-dual-avg" style={{ width: `${Math.min(stats.avg_lf, scale) / scale * 100}%`, background: color }} />
                              <div className="ae-lf-capacity-line" style={{ left: `${(100 / scale) * 100}%` }} />
                            </div>
                            {stats.log_count === 0 && (
                              <span className="ae-lf-empty-period">No logs in this period</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="ae-lf-footnote">
                      Red line marks 100% capacity. Light band = max LF, solid band = avg LF.
                      POOR logs included — occupancy is valid regardless of GPS accuracy. Times in PHT (UTC+8).
                    </p>
                  </div>
                </>
              )}

              {/* Demand */}
              {activeTab === "demand" && (
                <>
                  <div className="ae-metrics">
                    {Object.entries(dem.distribution).map(([tier, { count, pct }]) => (
                      <MetricCard
                        key={tier}
                        label={tier}
                        value={`${pct.toFixed(1)}%`}
                        sub={`${count} logs`}
                        variant={tier === "Critical" ? "danger" : tier === "High" ? "warning" : tier === "Normal" ? "good" : ""}
                      />
                    ))}
                  </div>
                  <div className="ae-card">
                    <SectionHeader title="Demand intensity distribution" badge={`C = ${lf.official_capacity}`} />
                    <div className="ae-bars">
                      {Object.entries(dem.distribution).map(([tier, { count, pct }]) => (
                        <BarRow key={tier} label={tier} pct={pct} count={count} color={DEMAND_COLOR[tier]} />
                      ))}
                    </div>
                    <div className="ae-tier-legend">
                      {[
                        ["Normal",   `occ ≤ ${lf.official_capacity}`,      COLORS.normal],
                        ["Moderate", `occ ≤ ${lf.official_capacity + 5}`,   COLORS.moderate],
                        ["High",     `occ ≤ ${lf.official_capacity + 10}`,  COLORS.high],
                        ["Critical", `occ > ${lf.official_capacity + 10}`,  COLORS.critical],
                      ].map(([tier, rule, color]) => (
                        <div key={tier} className="ae-tier-legend-item">
                          <span className="ae-tier-dot" style={{ background: color }} />
                          <span className="ae-tier-name">{tier}</span>
                          <span className="ae-tier-rule">{rule}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Time */}
              {activeTab === "time" && (
                <>
                  <div className="ae-card">
                    <SectionHeader title="Time period distribution" badge="PHT (UTC+8)" />
                    <div className="ae-bars">
                      {Object.entries(td.distribution).map(([period, { count, pct }]) => (
                        <BarRow key={period} label={period} pct={pct} count={count} color={PERIOD_COLOR[period]} />
                      ))}
                    </div>
                    <div className="ae-period-legend">
                      {[
                        ["Morning Peak",   "06:00–08:59 PHT", COLORS.morning],
                        ["Midday",         "09:00–15:59 PHT", COLORS.midday],
                        ["Afternoon Peak", "16:00–18:59 PHT", COLORS.afternoon],
                        ["Off-Peak",       "19:00–05:59 PHT", COLORS.offpeak],
                      ].map(([period, hours, color]) => (
                        <div key={period} className="ae-period-legend-item">
                          <span className="ae-period-dot" style={{ background: color }} />
                          <span className="ae-period-name">{period}</span>
                          <span className="ae-period-hours">{hours}</span>
                        </div>
                      ))}
                    </div>
                    <p className="ae-tz-note">
                      Timestamps stored as UTC in the database. PHT offset (+8h) applied at the analytics layer —
                      consistent across local dev and Render deployments.
                    </p>
                  </div>

                  <div className="ae-card">
                    <SectionHeader title="Cross-reference with DBSCAN" />
                    <p className="ae-crossref">
                      Each detected cluster carries a <code>peak_period</code> field — the most common time
                      period among its member logs. Compare cluster demand tiers against peak periods to identify
                      which stops become overcrowded at which time of day. Run the DBSCAN tab after a Morning Peak
                      or Afternoon Peak field ride for the most analytically useful output.
                    </p>
                  </div>
                </>
              )}


              {activeTab === "compare" && (
                <AlgorithmComparison
                  comparing={comparing}
                  compareData={compareData}
                  compareError={compareError}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Heatmap modal */}
      {showMap && tripId.trim() && (
        <TripMap
          tripId={tripId.trim()}
          onClose={() => setShowMap(false)}
        />
      )}

    </div>
  );
}
