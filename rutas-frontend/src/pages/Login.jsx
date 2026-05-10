import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginAdmin, loginConductor } from "../services/api";
import { authService } from "../services/authService";
import "./Login.css";

export default function Login() {
  const navigate = useNavigate();
  const [role, setRole] = useState("CONDUCTOR"); // STAFF or CONDUCTOR
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  // Admin / Analyst fields
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");

  // Conductor fields
  const [empId, setEmpId]       = useState("");
  const [pin, setPin]           = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let res;
      if (role === "CONDUCTOR") {
        res = await loginConductor({ employee_id: empId, pin });
      } else {
        // STAFF tab — backend returns actual role (ADMIN or ANALYST)
        res = await loginAdmin({ email, password });
      }
      authService.setSession(res.data);
      navigate(authService.getHomeRoute(), { replace: true });
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.message ||
        "Login failed. Check your credentials."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">

        {/* Header */}
        <div className="login-header">
          <h1>RutaSmart</h1>
          <p>Malanday – Recto Corridor</p>
          <span className="login-institute">Devion · FEU Institute of Technology · 2026</span>
        </div>

        {/* Role tabs */}
        <div className="login-tabs">
          {[
            { key: "STAFF",     label: "Admin"     },
            { key: "CONDUCTOR", label: "Conductor" },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`login-tab ${role === key ? "active" : ""}`}
              onClick={() => { setRole(key); setError(null); }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>

          {role !== "CONDUCTOR" ? (
            <>
              <div className="login-field">
                <label>Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@rutasmart.ph"
                  required
                  autoComplete="username"
                />
              </div>
              <div className="login-field">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>
            </>
          ) : (
            <>
              <div className="login-field">
                <label>Employee ID</label>
                <input
                  type="text"
                  value={empId}
                  onChange={e => setEmpId(e.target.value)}
                  placeholder="CDR-2024-042"
                  required
                  autoComplete="username"
                />
              </div>
              <div className="login-field">
                <label>PIN Code</label>
                <input
                  type="password"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  placeholder="••••"
                  maxLength={8}
                  inputMode="numeric"
                  required
                  autoComplete="current-password"
                />
              </div>
              <div className="login-pwa-note">
                Works offline · PWA installed
              </div>
            </>
          )}

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading
              ? "Signing in…"
              : role === "CONDUCTOR" ? "Start My Shift" : "Sign In"
            }
          </button>

        </form>

        <div className="login-role-desc">
          {role === "STAFF"     && "Admin → full access · Analyst → read + export"}
          {role === "CONDUCTOR" && "Collect only · Own trips · PWA mobile"}
        </div>

        <div className="login-role-desc" style={{ marginTop: 10 }}>
          No account?{" "}
          <button
            type="button"
            onClick={() => navigate("/signup")}
            style={{ background: "none", border: "none", color: "#1565c0", fontSize: 12,
                     fontWeight: 600, cursor: "pointer", padding: 0,
                     textDecoration: "underline", fontFamily: "inherit" }}
          >
            Create one
          </button>
        </div>

      </div>
    </div>
  );
}
