export const goodColor   = (v) => v >= 88 ? "#30d158" : v >= 78 ? "#ffd60a" : "#ff453a";
export const statusColor = (s) => s === "ACTIVE" ? "#30d158" : s === "COMPLETED" ? "#42a5f5" : "#8e9ab0";
export const dirLabel    = (d) => d === "MALANDAY-RECTO" ? "Malanday → Recto" : d === "RECTO-MALANDAY" ? "Recto → Malanday" : (d || "—");

export const periodColor = (p) => {
  if (!p) return { bg: "rgba(255,255,255,0.12)", text: "rgba(255,255,255,0.70)" };
  if (p.includes("Morning"))   return { bg: "rgba(255,214,10,0.18)",  text: "#ffd60a" };
  if (p.includes("Off"))       return { bg: "rgba(48,209,88,0.18)",   text: "#30d158" };
  if (p.includes("Afternoon")) return { bg: "rgba(66,165,245,0.18)",  text: "#42a5f5" };
  return { bg: "rgba(191,90,242,0.18)", text: "#bf5af2" };
};
export const periodColorCard = periodColor;

export const PERIOD_COLOR = { "Morning Peak": "#ffd60a", "Midday": "#42a5f5", "Afternoon Peak": "#ff453a", "Off-Peak": "#30d158" };
export const DEMAND_COLOR  = { Normal: "#30d158", Moderate: "#ffd60a", High: "#ff9f0a", Critical: "#ff453a" };

export const phtDateStr = (utcStr) => {
  if (!utcStr) return "—";
  const d = new Date(utcStr + (utcStr.endsWith("Z") ? "" : "Z"));
  d.setHours(d.getHours() + 8);
  return d.toISOString().slice(0, 10);
};

/**
 * Clock time of an instant in Philippine Standard Time.
 *
 * The previous implementation did `d.setHours(d.getHours() + 8)` and then
 * formatted with toLocaleTimeString(). getHours/setHours work in the
 * BROWSER's zone, so that moved the instant forward by eight hours, and
 * toLocaleTimeString then rendered the moved instant in the browser's zone
 * as well — a second +8 on a UTC+8 machine. A trip stored at 08:47 UTC
 * (4:47 PM PHT) rendered as 12:47 AM, which is how a trip could appear to
 * start just after midnight while its operating period said Afternoon Peak.
 * The stored data was correct throughout; only this formatter was wrong,
 * and only on a machine that is not already on UTC.
 *
 * Asking Intl for Asia/Manila directly is correct in every browser zone.
 */
export const phtTimeStr = (utcStr) => {
  if (!utcStr) return "—";
  const d = new Date(utcStr + (utcStr.endsWith("Z") ? "" : "Z"));
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila",
  });
};

/* ── Nearest field-reported stop ─────────────────────────────────────────────
 * The backend may attach an optional `field_stop_match` to a detected
 * hotspot. It is a label drawn from passenger and conductor field findings,
 * NOT from the manuscript's evaluation ground truth and NOT from the
 * published passenger zones. It never changes a cluster metric.
 *
 * Three states, and the wording stays honest about which one it is:
 *   matched       the name is asserted
 *   needs_review  the name is shown but flagged as unconfirmed
 *   unmatched     no name at all, rather than a guess
 *
 * Any missing or unrecognised payload falls back to the unmatched wording,
 * so an older backend that sends no label renders exactly as before.
 */
export const FIELD_STOP_STATUS = {
  MATCHED: "matched",
  NEEDS_REVIEW: "needs_review",
  UNMATCHED: "unmatched",
};

export function fieldStopLabel(match) {
  const status = match?.status;
  const name = match?.stop_name;
  const d = match?.distance_m;
  const metres = Number.isFinite(d) ? Math.round(d) : null;

  if (status === FIELD_STOP_STATUS.MATCHED && name && metres != null) {
    return {
      status,
      text: `Near ${name} · ${metres} m from field stop`,
      tone: "matched",
    };
  }
  if (status === FIELD_STOP_STATUS.NEEDS_REVIEW && name && metres != null) {
    return {
      status,
      text: `Near ${name} · Match needs review · ${metres} m away`,
      tone: "review",
    };
  }
  return {
    status: FIELD_STOP_STATUS.UNMATCHED,
    text: "Detected hotspot · No nearby field stop identified",
    tone: "none",
  };
}

/* Colour for the three states. Deliberately NOT the demand-tier palette:
 * these say how trustworthy a name is, not how busy a stop is, and reusing
 * the tier colours is exactly the confusion the earlier legend work removed. */
export const FIELD_STOP_TONE = {
  matched: "var(--rs-text-2)",
  review:  "var(--rs-text-3)",
  none:    "var(--rs-text-3)",
};
