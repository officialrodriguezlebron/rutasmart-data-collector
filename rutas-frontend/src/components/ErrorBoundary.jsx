import { Component } from "react";

/**
 * RutaSmart Top-Level Error Boundary
 * ----------------------------------
 * Catches any uncaught React render error so a single broken component
 * never gives the user a white screen of death.
 *
 * Field-readiness rationale: during a real trip, a malformed GPS payload
 * or a network blip could crash a child component. The conductor must
 * be able to recover without losing their session.
 *
 * Usage (App.jsx):
 *   <ErrorBoundary>
 *     <Router>...</Router>
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Production: send to an error-reporting service.
    // For now we log to console — visible in the browser devtools.
    console.error("RutaSmart caught a render error:", error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px",
          background: "linear-gradient(135deg, #05101f 0%, #0a1f4e 100%)",
          color: "#fff",
          fontFamily: "DM Sans, -apple-system, sans-serif",
          textAlign: "center",
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.08)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 22,
            padding: "40px 32px",
            maxWidth: 480,
            boxShadow: "0 32px 80px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700 }}>
            Something went wrong
          </h2>
          <p style={{ margin: "0 0 24px", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
            The page crashed unexpectedly. Your trip data is safe — it stays in
            your device's queue until you reload. Try reloading the page.
          </p>

          {this.state.error && (
            <pre
              style={{
                background: "rgba(0,0,0,0.30)",
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 11,
                fontFamily: "DM Mono, monospace",
                color: "rgba(255,255,255,0.65)",
                margin: "0 0 24px",
                maxHeight: 120,
                overflow: "auto",
                textAlign: "left",
                whiteSpace: "pre-wrap",
              }}
            >
              {String(this.state.error?.message || this.state.error)}
            </pre>
          )}

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: "10px 22px",
                background: "linear-gradient(135deg, #1565c0, #1044a3)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 4px 16px rgba(16,68,163,0.45)",
              }}
            >
              Reload Page
            </button>
            <button
              onClick={this.handleGoHome}
              style={{
                padding: "10px 22px",
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.20)",
                borderRadius: 10,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }
}
