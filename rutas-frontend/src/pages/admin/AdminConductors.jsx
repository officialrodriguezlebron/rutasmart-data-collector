import { useState, useEffect } from "react";
import { getConductors, createUser } from "../../services/api";
import "../AdminDashboard.css";

export default function AdminConductors() {
  const [conductors, setConductors] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [name,  setName]  = useState("");
  const [empId, setEmpId] = useState("");
  const [pin,   setPin]   = useState("");
  const [jeep,  setJeep]  = useState("");
  const [busy,  setBusy]  = useState(false);
  const [msg,   setMsg]   = useState(null);

  const load = () => {
    setLoading(true);
    getConductors()
      .then(r => setConductors(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name || !empId || pin.length !== 6) {
      setMsg({ type: "error", text: "All fields required. PIN must be exactly 6 digits." });
      return;
    }
    setBusy(true);
    try {
      await createUser({ role: "CONDUCTOR", display_name: name, employee_id: empId, pin, jeep_code: jeep || undefined });
      setMsg({ type: "success", text: `Conductor "${name}" (${empId}) created.` });
      setName(""); setEmpId(""); setPin(""); setJeep("");
      load();
    } catch (e) {
      setMsg({ type: "error", text: e.response?.data?.detail || "Failed to create." });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="admin-topbar">
        <h1>Conductors</h1>
        <button className="admin-refresh" onClick={load} disabled={loading}>↺ Refresh</button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading conductors…</div>
      ) : (
        <>
          <div className="admin-card">
            <div className="admin-card-title">Conductors ({conductors.length})</div>
            {conductors.length === 0 ? (
              <p className="admin-empty">No conductors yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {conductors.map(c => {
                  const init = (c.display_name || "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div key={c.user_id} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "16px 18px", border: "1px solid rgba(255,255,255,0.14)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div className="admin-user-avatar" style={{ width: 38, height: 38, fontSize: 13 }}>{init}</div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.90)" }}>{c.display_name}</div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{c.employee_id}</div>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[["Jeep Code", c.jeep_code || "—"], ["Created", c.created_at?.slice(0, 10) || "—"]].map(([lbl, val]) => (
                          <div key={lbl} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 10px" }}>
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 2 }}>{lbl}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="admin-card">
            <div className="admin-card-title">Create Conductor Account</div>
            {msg && <div className={`admin-msg ${msg.type}`} style={{ marginBottom: 14 }}>{msg.text}</div>}
            <div className="admin-conductor-form">
              <div className="admin-form-row">
                {[
                  { label: "Display Name",   v: name,  s: setName,  ph: "e.g. Juan dela Cruz" },
                  { label: "Employee ID",    v: empId, s: setEmpId, ph: "e.g. EMP-001" },
                  { label: "PIN (6 digits)", v: pin,   s: setPin,   ph: "6-digit PIN", type: "password" },
                  { label: "Jeep Code",      v: jeep,  s: setJeep,  ph: "e.g. MR-001 (optional)" },
                ].map(({ label, v, s, ph, type }) => (
                  <div key={label} className="admin-form-field">
                    <label>{label}</label>
                    <input type={type || "text"} value={v} onChange={e => s(e.target.value)} placeholder={ph} />
                  </div>
                ))}
              </div>
              <button className="admin-create-btn" onClick={create} disabled={busy}>
                {busy ? "Creating…" : "➕ Create Conductor"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
