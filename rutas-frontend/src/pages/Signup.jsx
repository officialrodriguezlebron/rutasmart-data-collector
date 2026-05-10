import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createUser } from "../services/api";
import "./Login.css";
import "./Signup.css";

export default function Signup() {
  const navigate = useNavigate();
  const [role, setRole]             = useState("ANALYST");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [success, setSuccess]       = useState(false);

  // Shared
  const [displayName, setDisplayName] = useState("");

  // Analyst fields
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");

  // Conductor fields
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin]               = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [jeepCode, setJeepCode]     = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!displayName.trim()) {
      setError("Full name is required."); return;
    }

    if (role === "ANALYST") {
      if (password.length < 6) {
        setError("Password must be at least 6 characters."); return;
      }
      if (password !== confirm) {
        setError("Passwords do not match."); return;
      }
    } else {
      if (pin.length < 4) {
        setError("PIN must be at least 4 digits."); return;
      }
      if (pin !== confirmPin) {
        setError("PINs do not match."); return;
      }
    }

    setLoading(true);
    try {
      const payload = role === "ANALYST"
        ? { role, display_name: displayName, email, password }
        : { role, display_name: displayName, employee_id: employeeId, pin, jeep_code: jeepCode };

      await createUser(payload);
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
          <p>
            {role === "ANALYST"
              ? `Your analyst account for ${email} is ready.`
              : `Conductor account ${employeeId} has been created.`}
          </p>
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

        {/* Header */}
        <div className="login-header">
          <h1>RutaSmart</h1>
          <p>Create an account</p>
          <span className="login-institute">Malanday – Recto Corridor · 2026</span>
        </div>

        {/* Role tabs */}
        <div className="login-tabs">
          {[
            { key: "ANALYST",   label: "Analyst"   },
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

        <form className="login-form" onSubmit={handleSubmit}>

          {/* Shared — display name */}
          <div className="login-field">
            <label>Full name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder=" Lebron James Rodriguez"
              required
            />
          </div>

          {role === "ANALYST" ? (
            <>
              <div className="login-field">
                <label>Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="lebjames@rutasmart.ph"
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
                  placeholder="Min. 6 characters"
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="login-field">
                <label>Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  required
                  autoComplete="new-password"
                />
              </div>
            </>
          ) : (
            <>
              <div className="login-field">
                <label>Employee ID</label>
                <input
                  type="text"
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  placeholder="e.g. CDR-2024-099"
                  required
                />
              </div>
              <div className="login-field">
                <label>PIN code</label>
                <input
                  type="password"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="4–8 digits"
                  maxLength={8}
                  inputMode="numeric"
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="login-field">
                <label>Confirm PIN</label>
                <input
                  type="password"
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="Repeat PIN"
                  maxLength={8}
                  inputMode="numeric"
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="login-field">
                <label>Assigned jeep code <span style={{ fontWeight: 400, color: "#aaa" }}>(optional)</span></label>
                <input
                  type="text"
                  value={jeepCode}
                  onChange={e => setJeepCode(e.target.value)}
                  placeholder="e.g. JPN-003"
                />
              </div>
            </>
          )}

          {error && (
            <div className="login-error" role="alert">{error}</div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>

        </form>

        {/* Back to login */}
        <div className="signup-login-link">
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="signup-link-btn"
          >
            Sign in
          </button>
        </div>

      </div>
    </div>
  );
}
