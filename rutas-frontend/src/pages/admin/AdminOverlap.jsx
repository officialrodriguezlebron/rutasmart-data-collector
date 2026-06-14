import { useState, useEffect } from "react";
import { getAdminTrips, runOverlap } from "../../services/api";
import { phtDateStr, dirLabel } from "../../utils/adminFormatters";
import "../AdminDashboard.css";

const SELECT_STYLE = {
  padding: "6px 10px", borderRadius: 8, fontSize: 11, fontFamily: "var(--mono)",
  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)",
  color: "rgba(255,255,255,0.80)", cursor: "pointer", width: "100%",
};

const DEMAND_COLORS = {
  High:     { bg: "rgba(255,69,58,0.18)",   text: "#ff453a" },
  Moderate: { bg: "rgba(255,214,10,0.18)",  text: "#ffd60a" },
  Low:      { bg: "rgba(48,209,88,0.18)",   text: "#30d158" },
  Normal:   { bg: "rgba(66,165,245,0.18)",  text: "#42a5f5" },
};

function SegmentTable({ segments, accent }) {
  if (!segments?.length) return <p style={{ fontSize: 12, color: "rgba(255,255,255,0.38)" }}>No segments.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: "0 3px", width: "100%", minWidth: 480 }}>
        <thead>
          <tr>
            {["Seg", "Centroid", "Pings", "Avg Occ", "Demand"].map(h => (
              <th key={h} style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textAlign: "left", padding: "4px 10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {segments.map((s, i) => {
            const dc = DEMAND_COLORS[s.demand_tier] || DEMAND_COLORS.Normal;
            return (
              <tr key={s.cluster_id ?? i}>
                <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: "var(--mono)", color: accent, background: "rgba(255,255,255,0.03)", borderRadius: "8px 0 0 8px" }}>#{s.cluster_id}</td>
                <td style={{ padding: "5px 10px", fontSize: 10, color: "rgba(255,255,255,0.45)", fontFamily: "var(--mono)", background: "rgba(255,255,255,0.03)" }}>{s.centroid_lat?.toFixed(5)}, {s.centroid_lon?.toFixed(5)}</td>
                <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.65)", background: "rgba(255,255,255,0.03)" }}>{s.point_count}</td>
                <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.65)", background: "rgba(255,255,255,0.03)" }}>{s.avg_occupancy?.toFixed(1) ?? "—"}</td>
                <td style={{ padding: "5px 10px", background: "rgba(255,255,255,0.03)", borderRadius: "0 8px 8px 0" }}>
                  <span style={{ padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700, background: dc.bg, color: dc.text }}>{s.demand_tier}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminOverlap() {
  const [trips,        setTrips]        = useState([]);
  const [tripAId,      setTripAId]      = useState("");
  const [tripBId,      setTripBId]      = useState("");
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [err,          setErr]          = useState(null);

  useEffect(() => {
    getAdminTrips()
      .then(r => {
        const completed = (r.data || []).filter(t => t.status === "COMPLETED");
        setTrips(completed);
        if (completed.length >= 1) setTripAId(completed[0].trip_id);
        if (completed.length >= 2) setTripBId(completed[1].trip_id);
      })
      .catch(() => {})
      .finally(() => setTripsLoading(false));
  }, []);

  function handleRun() {
    if (!tripAId || !tripBId || tripAId === tripBId) return;
    setLoading(true);
    setData(null);
    setErr(null);
    runOverlap(tripAId, tripBId)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.detail || "Overlap analysis failed."))
      .finally(() => setLoading(false));
  }

  const sameTrip = tripAId && tripBId && tripAId === tripBId;
  const tripLabel = t => `${phtDateStr(t.start_time)} · ${dirLabel(t.direction)} · ${t.trip_id.slice(-8)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Route Overlap</h1>
      </div>

      {/* Controls */}
      <div className="admin-card" style={{ marginBottom: 18 }}>
        <div className="admin-card-title">Trip Pair Selection</div>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", margin: "0 0 14px" }}>
          Detect shared road segments between two completed trips (Task B). Uses ε=75m, minPts=20 to tolerate GPS noise and lane-width variation.
        </p>
        {!tripsLoading && trips.length >= 2 ? (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Trip A</div>
              <select value={tripAId} onChange={e => setTripAId(e.target.value)} style={SELECT_STYLE}>
                {trips.map(t => <option key={t.trip_id} value={t.trip_id} style={{ background: "#0f1a2e" }}>{tripLabel(t)}</option>)}
              </select>
            </div>
            <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 20, paddingBottom: 2 }}>↔</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Trip B</div>
              <select value={tripBId} onChange={e => setTripBId(e.target.value)} style={SELECT_STYLE}>
                {trips.map(t => <option key={t.trip_id} value={t.trip_id} style={{ background: "#0f1a2e" }}>{tripLabel(t)}</option>)}
              </select>
            </div>
            <button
              onClick={handleRun}
              disabled={loading || sameTrip}
              style={{ padding: "8px 20px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: (loading || sameTrip) ? "not-allowed" : "pointer", background: sameTrip ? "rgba(66,165,245,0.30)" : "#42a5f5", color: "#0f1a2e", border: "none" }}
            >
              {loading ? "Analyzing…" : "▶ Detect Overlap"}
            </button>
          </div>
        ) : !tripsLoading ? (
          <p style={{ color: "rgba(255,255,255,0.42)", fontSize: 13 }}>Need at least 2 completed trips for overlap analysis.</p>
        ) : null}
        {sameTrip && <div style={{ fontSize: 11, color: "#ffd60a", marginTop: 8 }}>Select two different trips to compare.</div>}
      </div>

      {loading && <div className="admin-loading">Running overlap detection…</div>}
      {err    && <div className="admin-msg error">{err}</div>}

      {data && (
        <>
          {/* Summary cards */}
          <div className="admin-card" style={{ marginBottom: 18 }}>
            <div className="admin-card-title">Overlap Summary</div>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              {[
                { label: "Shared Segments", value: data.overlap_segments?.length, color: "#30d158", desc: "both trips traveled here" },
                { label: "Trip A Only",     value: data.trip_a_only?.length,      color: "#42a5f5", desc: "unique to Trip A"        },
                { label: "Trip B Only",     value: data.trip_b_only?.length,      color: "#00b4d8", desc: "unique to Trip B"        },
              ].map(({ label, value, color, desc }) => (
                <div key={label} style={{ flex: 1, background: color + "14", border: `1px solid ${color}44`, borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.50)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color, fontFamily: "var(--mono)", lineHeight: 1 }}>{value ?? "—"}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.30)", marginTop: 4 }}>{desc}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
              <span>Trip A: <strong style={{ color: "#42a5f5" }}>{data.total_a?.toLocaleString()}</strong> pings</span>
              <span>·</span>
              <span>Trip B: <strong style={{ color: "#00b4d8" }}>{data.total_b?.toLocaleString()}</strong> pings</span>
              <span>·</span>
              <span>ε={data.eps_m}m · minPts={data.min_samples}</span>
            </div>
          </div>

          {/* Shared segments */}
          {data.overlap_segments?.length > 0 && (
            <div className="admin-card" style={{ marginBottom: 18 }}>
              <div className="admin-card-title">
                Shared Segments
                <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(48,209,88,0.14)", color: "#30d158", border: "1px solid rgba(48,209,88,0.30)", fontWeight: 700 }}>{data.overlap_segments.length}</span>
              </div>
              <SegmentTable segments={data.overlap_segments} accent="#30d158" />
            </div>
          )}

          {/* Trip A only */}
          {data.trip_a_only?.length > 0 && (
            <div className="admin-card" style={{ marginBottom: 18 }}>
              <div className="admin-card-title">
                Trip A Only
                <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(66,165,245,0.14)", color: "#42a5f5", border: "1px solid rgba(66,165,245,0.30)", fontWeight: 700 }}>{data.trip_a_only.length}</span>
              </div>
              <SegmentTable segments={data.trip_a_only} accent="#42a5f5" />
            </div>
          )}

          {/* Trip B only */}
          {data.trip_b_only?.length > 0 && (
            <div className="admin-card">
              <div className="admin-card-title">
                Trip B Only
                <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "rgba(0,180,216,0.14)", color: "#00b4d8", border: "1px solid rgba(0,180,216,0.30)", fontWeight: 700 }}>{data.trip_b_only.length}</span>
              </div>
              <SegmentTable segments={data.trip_b_only} accent="#00b4d8" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
