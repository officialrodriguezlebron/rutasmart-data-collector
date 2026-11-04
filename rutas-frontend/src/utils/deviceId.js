/**
 * Device identity for GPS logging.
 *
 * Every GPS payload carries a device_id, and the backend requires a string of
 * at least 3 characters (gps_schema.GPSLogCreate). The id was previously
 * created as a side effect of mounting Dashboard, while Recording and
 * TripSetup only read the key. A conductor who reached the recording screen
 * without passing through the dashboard therefore sent device_id: null, and
 * every log was rejected with HTTP 422.
 *
 * Centralising the get-or-create here means any screen that needs the id gets
 * a valid one, and the id itself is unchanged: same localStorage key, same
 * "RS-XXXXXXXX" format, same value for devices that already have one.
 */

export const DEVICE_KEY = "rutasmart_device_id";

function generateDeviceId() {
  // crypto.randomUUID needs a secure context. Fall back to Math.random so a
  // plain-HTTP LAN deployment still produces a usable id rather than throwing
  // and leaving device_id null again.
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  return "RS-" + raw.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Stable per-device id, created on first use and reused thereafter.
 * Never returns null or an empty string.
 */
export function getOrCreateDeviceId() {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored && stored.length >= 3) return stored;
    const fresh = generateDeviceId();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode or blocked storage: still return a usable id for this
    // session so logging works, even though it will not persist.
    return generateDeviceId();
  }
}

/**
 * Normalise GeolocationPosition.timestamp for the backend.
 *
 * position.timestamp is a DOMHighResTimeStamp — a double. The backend field
 * is Optional[int] (gps_schema), and Pydantic rejects a float carrying a
 * fractional part, so every log was failing validation with
 * "Input should be a valid integer, got a number with a fractional part".
 *
 * Rounding discards sub-millisecond precision. That field feeds KPI #7,
 * inter-arrival jitter between GPS fixes roughly 3 seconds apart, so
 * sub-millisecond resolution is far below anything the metric resolves — and
 * until now the field was rejected outright, so it carried no data at all.
 * Math.round rather than Math.floor: flooring would bias every timestamp
 * downward by up to 1 ms.
 */
export function toEpochMillis(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
