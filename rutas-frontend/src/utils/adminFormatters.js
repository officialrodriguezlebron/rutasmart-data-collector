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
