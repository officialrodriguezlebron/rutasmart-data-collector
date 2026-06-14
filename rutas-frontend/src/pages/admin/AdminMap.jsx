import "../AdminDashboard.css";

export default function AdminMap() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Map Dashboard</h1>
      </div>
      <div className="admin-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400, gap: 16 }}>
        <div style={{ fontSize: 48 }}>🗺</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.80)" }}>Map Dashboard</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", textAlign: "center", maxWidth: 400 }}>
          Full-screen Leaflet map with stop zone demand tiers, confidence scores, and corridor overlays — coming in Checkpoint 2.
        </div>
      </div>
    </div>
  );
}
