import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createUser } from "../services/api";
import "./Login.css";
import "./Signup.css";

export default function Signup() {
  const navigate = useNavigate();
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [success,     setSuccess]     = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [employeeId,  setEmployeeId]  = useState("");
  const [pin,         setPin]         = useState("");
  const [confirmPin,  setConfirmPin]  = useState("");
  const [jeepCode,    setJeepCode]    = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!displayName.trim()) { setError("Full name is required."); return; }
    if (pin.length < 4)      { setError("PIN must be at least 4 digits."); return; }
    if (pin !== confirmPin)  { setError("PINs do not match."); return; }

    setLoading(true);
    try {
      await createUser({
        role:         "CONDUCTOR",
        display_name: displayName,
        employee_id:  employeeId,
        pin,
        jeep_code:    jeepCode || undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="login-page">
        <div className="login-card signup-success">
          <div className="signup-success-icon">✓</div>
          <h2>Account created!</h2>
          <p>Conductor account <strong>{employeeId}</strong> is ready.</p>
          <button className="login-btn" onClick={() => navigate("/login")}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">

        <div className="login-header">
          <h1>RutaSmart</h1>
          <p>Create Conductor Account</p>
          <span className="login-institute">Malanday – Recto Corridor · 2026</span>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>

          <div className="login-field">
            <label>Full name</label>
            <input type="text" value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. Juan dela Cruz" required />
          </div>

          <div className="login-field">
            <label>Employee ID</label>
            <input type="text" value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              placeholder="e.g. CDR-2024-099" required />
          </div>

          <div className="login-field">
            <label>PIN code</label>
            <input type="password" value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="4–8 digits" maxLength={8} inputMode="numeric"
              required autoComplete="new-password" />
          </div>

          <div className="login-field">
            <label>Confirm PIN</label>
            <input type="password" value={confirmPin}
              onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              placeholder="Repeat PIN" maxLength={8} inputMode="numeric"
              required autoComplete="new-password" />
          </div>

          <div className="login-field">
            <label>
              Assigned jeep code{" "}
              <span style={{ fontWeight: 400, color: "#aaa" }}>(optional)</span>
            </label>
            <input type="text" value={jeepCode}
              onChange={e => setJeepCode(e.target.value)}
              placeholder="e.g. JPN-003" />
          </div>

          {error && (
            <div className="login-error" role="alert">{error}</div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? "Creating account…" : "Create Conductor Account"}
          </button>

        </form>

        <div className="signup-login-link">
          Already have an account?{" "}
          <button type="button" onClick={() => navigate("/login")}
            className="signup-link-btn">
            Sign in
          </button>
        </div>

      </div>
    </div>
  );
}
