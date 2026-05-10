import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authService } from "../services/authService";
import "./AnalyticsEngine.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

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

const PERIOD_COLOR = {
  "Morning Peak":   COLORS.morning,
  "Midday":         COLORS.midday,
  "Afternoon Peak": COLORS.afternoon,
  "Off-Peak":       COLORS.offpeak,
};

function MetricCard({ label, value, sub, variant }) {
  return (
    <div className="ae-metric">
      <span className="ae-metric-label">{label}</span>
      <span className={`ae-metric-value ${variant || ""}`}>{value}</span>
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

export default function AnalyticsEngine() {
  const navigate    = useNavigate();
  const [searchParams] = useSearchParams();
  const [tripId, setTripId]       = useState(searchParams.get("trip") || "");
  const [epsM, setEpsM]           = useState(50);
  const [minPts, setMinPts]       = useState(5);
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

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

          <div className="ae-card">
            <p className="ae-card-title">Trip selection</p>
            <div className="ae-field">
              <label className="ae-label" htmlFor="trip-id-input">Completed trip ID</label>
              <input
                id="trip-id-input"
                className="ae-input"
                value={tripId}
                onChange={e => setTripId(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runAnalysis()}
                placeholder="2026-05-09_JEEP4_MLD-RCT_c49e"
              />
            </div>
            <button className="ae-run-btn" onClick={runAnalysis} disabled={loading}>
              {loading
                ? <><span className="ae-spinner" aria-hidden="true" /> Running…</>
                : "▶  Run all algorithms"
              }
            </button>
          </div>

          <div className="ae-card">
            <p className="ae-card-title">DBSCAN parameters</p>

            <div className="ae-param">
              <div className="ae-param-header">
                <span className="ae-param-label">eps (metres)</span>
                <span className="ae-param-value">{epsM}m</span>
              </div>
              <input
                type="range" min="10" max="200" step="5"
                value={epsM} onChange={e => setEpsM(Number(e.target.value))}
                className="ae-slider"
                aria-label="DBSCAN epsilon in metres"
              />
            </div>

            <div className="ae-param">
              <div className="ae-param-header">
                <span className="ae-param-label">min samples</span>
                <span className="ae-param-value">{minPts}</span>
              </div>
              <input
                type="range" min="2" max="20" step="1"
                value={minPts} onChange={e => setMinPts(Number(e.target.value))}
                className="ae-slider"
                aria-label="DBSCAN minimum samples"
              />
            </div>

            <button
              className="ae-rerun-btn"
              onClick={rerunDBSCAN}
              disabled={loading || !data}
            >
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

        </aside>

        {/* Main content */}
        <main className="ae-content">

          {error && (
            <div className="ae-error" role="alert">
              <span className="ae-error-icon" aria-hidden="true">⚠</span>
              {error}
            </div>
          )}

          {!data && !loading && !error && (
            <div className="ae-empty">
              <span className="ae-empty-icon" aria-hidden="true">🗺</span>
              <p>Enter a completed trip ID and run the algorithms</p>
              <small>Trip must have status COMPLETED in the database</small>
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
                    <MetricCard label="Total logs"     value={q.total_logs}                           sub={`${q.dbscan_eligible} eligible`} />
                    <MetricCard label="POOR excluded"  value={`${q.poor_pct.toFixed(0)}%`}            sub={`${q.poor_count} logs`}          variant={q.poor_pct > 30 ? "danger" : q.poor_pct > 15 ? "warning" : ""} />
                    <MetricCard label="Clusters"       value={db.clusters.length}                     sub={`eps=${db.eps_m}m · pts=${db.min_samples}`} variant="info" />
                    <MetricCard label="Avg load factor" value={`${lf.overall.avg_lf.toFixed(1)}%`}   sub={`max ${lf.overall.max_lf.toFixed(1)}%`} variant={lf.overall.avg_lf >= 100 ? "danger" : lf.overall.avg_lf >= 80 ? "warning" : ""} />
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
            </>
          )}
        </main>
      </div>
    </div>
  );
}
