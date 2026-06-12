import { useState, useEffect } from "react";
import { getStopZoneRecommendations } from "../services/api";

const DEMAND_COLOR = { High: "#ff453a", Medium: "#ffd60a", Low: "#30d158" };
const CONF_COLOR   = { High: "#30d158", Medium: "#ffd60a", Low: "#ff453a" };
const TIER_ORDER   = { High: 0, Medium: 1, Low: 2 };
const CONF_ORDER   = { High: 0, Medium: 1, Low: 2 };

const dirLabel = (d) =>
  d === "MALANDAY-RECTO" ? "Malanday → Recto"
  : d === "RECTO-MALANDAY" ? "Recto → Malanday"
  : d || "—";

function Chip({ children, color }) {
  return (
    <span style={{
      fontSize: 10, padding: "3px 9px", borderRadius: 6, fontWeight: 700,
      background: (color || "#8e9ab0") + "22",
      color: color || "#8e9ab0",
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

export default function StopZoneManagement() {
  const [zones,        setZones]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [sortKey,      setSortKey]      = useState("demand_tier");
  const [sortDir,      setSortDir]      = useState("desc");
  const [filterDemand, setFilterDemand] = useState("all");
  const [filterDir,    setFilterDir]    = useState("all");

  useEffect(() => {
    Promise.all([
      getStopZoneRecommendations("MR-001", "MALANDAY-RECTO"),
      getStopZoneRecommendations("MR-001", "RECTO-MALANDAY"),
    ])
      .then(([mr, rm]) => {
        const mrZones = (mr.data.zones || []).map(z => ({ ...z, direction: "MALANDAY-RECTO" }));
        const rmZones = (rm.data.zones || []).map(z => ({ ...z, direction: "RECTO-MALANDAY" }));
        setZones([...mrZones, ...rmZones]);
      })
      .catch(e => setError(e.response?.data?.detail || e.message || "Failed to load recommendations."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = zones.filter(z =>
    (filterDemand === "all" || z.demand_tier === filterDemand) &&
    (filterDir    === "all" || z.direction   === filterDir)
  );

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if      (sortKey === "demand_tier")   cmp = (TIER_ORDER[a.demand_tier] ?? 9) - (TIER_ORDER[b.demand_tier] ?? 9);
    else if (sortKey === "confidence")    cmp = (CONF_ORDER[a.confidence]  ?? 9) - (CONF_ORDER[b.confidence]  ?? 9);
    else if (sortKey === "point_count")   cmp = (b.point_count   || 0) - (a.point_count   || 0);
    else if (sortKey === "avg_occupancy") cmp = (b.avg_occupancy || 0) - (a.avg_occupancy || 0);
    else if (sortKey === "coverage")      cmp = (b.trip_day_coverage_pct || 0) - (a.trip_day_coverage_pct || 0);
    else if (sortKey === "direction")     cmp = a.direction.localeCompare(b.direction);
    return sortDir === "asc" ? -cmp : cmp;
  });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortTh = ({ k, style, children }) => (
    <th
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", ...style }}
      onClick={() => toggleSort(k)}
    >
      {children}{" "}
      {sortKey === k
        ? <span style={{ opacity: 0.7 }}>{sortDir === "desc" ? "↓" : "↑"}</span>
        : <span style={{ opacity: 0.25 }}>↕</span>}
    </th>
  );

  if (loading) return (
    <div className="admin-loading">Loading stop zone recommendations…</div>
  );
  if (error) return (
    <div className="admin-loading" style={{ color: "#ff453a" }}>{error}</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── Disclosure note ── */}
      <div style={{
        background: "rgba(255,214,10,0.06)", border: "1px solid rgba(255,214,10,0.18)",
        borderRadius: 10, padding: "9px 14px", marginBottom: 14, fontSize: 11,
        color: "rgba(255,255,255,0.45)", lineHeight: 1.6,
      }}>
        <strong style={{ color: "#ffd60a" }}>Data proxy disclosure — </strong>
        "Avg Occupancy (proxy for boarding activity)" and "Dwell Pings" are derived from
        GOOD/ACCEPTABLE GPS logs within each zone. The current data model does not record
        discrete boarding or alighting events; these columns serve as spatial activity proxies
        only. See thesis Chapter 4 for full methodology.
      </div>

      {/* ── Filters ── */}
      <div className="admin-card" style={{ padding: "14px 20px", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Filter:
          </span>

          <select
            value={filterDemand}
            onChange={e => setFilterDemand(e.target.value)}
            className="trips-filter-select"
          >
            <option value="all">All Demand Tiers</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          <select
            value={filterDir}
            onChange={e => setFilterDir(e.target.value)}
            className="trips-filter-select"
          >
            <option value="all">All Directions</option>
            <option value="MALANDAY-RECTO">Malanday → Recto</option>
            <option value="RECTO-MALANDAY">Recto → Malanday</option>
          </select>

          <span style={{ marginLeft: "auto", fontSize: 12, color: "rgba(255,255,255,0.38)" }}>
            {sorted.length} zone{sorted.length !== 1 ? "s" : ""}{filtered.length !== zones.length ? ` (${zones.length} total)` : ""}
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        {sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: "56px 0", color: "rgba(255,255,255,0.38)", fontSize: 14 }}>
            {zones.length === 0
              ? "No published stop zones found. Publish zones from the Stop Zones tab first."
              : "No zones match the current filters."}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <SortTh k="direction">Corridor</SortTh>
                  <th>Name</th>
                  <SortTh k="demand_tier">Demand Tier</SortTh>
                  <SortTh k="confidence">Confidence</SortTh>
                  <SortTh k="avg_occupancy">
                    Avg Occupancy
                    <div style={{ fontWeight: 400, fontSize: 9, opacity: 0.55, lineHeight: 1.3, marginTop: 1 }}>
                      proxy for boarding activity
                    </div>
                  </SortTh>
                  <SortTh k="point_count">
                    Dwell Pings
                    <div style={{ fontWeight: 400, fontSize: 9, opacity: 0.55, lineHeight: 1.3, marginTop: 1 }}>
                      GOOD/ACCEPTABLE logs
                    </div>
                  </SortTh>
                  <SortTh k="coverage">Trip-Day Coverage</SortTh>
                  <th>Peak Period</th>
                  <th style={{ minWidth: 240 }}>Recommendation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((z, i) => (
                  <tr key={`${z.direction}-${z.cluster_id}-${i}`}>
                    <td style={{
                      fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                      color: z.direction === "MALANDAY-RECTO" ? "#42a5f5" : "#00b4d8",
                    }}>
                      {dirLabel(z.direction)}
                    </td>

                    <td style={{
                      maxWidth: 180, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                      fontSize: 12,
                    }} title={z.name}>
                      {z.name}
                    </td>

                    <td><Chip color={DEMAND_COLOR[z.demand_tier]}>{z.demand_tier}</Chip></td>
                    <td><Chip color={CONF_COLOR[z.confidence]}>{z.confidence}</Chip></td>

                    <td className="admin-mono" style={{ fontSize: 12 }}>
                      {(z.avg_occupancy ?? 0).toFixed(1)}
                    </td>

                    <td className="admin-mono" style={{ fontSize: 12 }}>
                      {(z.point_count ?? 0).toLocaleString()}
                    </td>

                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span className="admin-mono" style={{ fontSize: 12 }}>
                          {z.trip_day_coverage}/{z.total_trip_days ?? "?"}
                        </span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.38)" }}>
                          {z.trip_day_coverage_pct?.toFixed(0)}%
                        </span>
                      </div>
                    </td>

                    <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                      {z.peak_period || "—"}
                    </td>

                    <td style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", minWidth: 240 }}>
                      {z.recommendation}
                    </td>

                    <td>
                      <Chip color={z.source === "published" ? "#30d158" : "#42a5f5"}>
                        {z.source === "published" ? "Published" : "Suggested"}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
