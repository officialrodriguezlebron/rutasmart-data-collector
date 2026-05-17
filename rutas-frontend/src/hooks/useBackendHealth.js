import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL;

/**
 * useBackendHealth
 * ----------------
 * Polls the backend root endpoint to detect when the API is unreachable.
 * This is distinct from `navigator.onLine` — the device may have signal
 * but Railway could be down or the API key may be misconfigured.
 *
 * Used by the conductor UI to surface a clear "Backend unreachable" banner
 * separate from the existing offline-queue indicator, so the conductor
 * knows whether to wait or to alert the office.
 *
 * Returns: "checking" | "up" | "down"
 */
export function useBackendHealth({ intervalMs = 30000 } = {}) {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    if (!API) {
      setStatus("down");
      return;
    }

    let cancelled = false;

    const check = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${API}/`, {
          signal: ctrl.signal,
          headers: { "X-API-Key": import.meta.env.VITE_API_KEY || "" },
        });
        clearTimeout(timer);
        if (!cancelled) setStatus(res.ok ? "up" : "down");
      } catch {
        if (!cancelled) setStatus("down");
      }
    };

    check();
    const id = setInterval(check, intervalMs);

    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  return status;
}
