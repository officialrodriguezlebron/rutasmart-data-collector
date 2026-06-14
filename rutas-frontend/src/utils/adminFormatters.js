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

export const phtTimeStr = (utcStr) => {
  if (!utcStr) return "—";
  const d = new Date(utcStr + (utcStr.endsWith("Z") ? "" : "Z"));
  d.setHours(d.getHours() + 8);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
};
