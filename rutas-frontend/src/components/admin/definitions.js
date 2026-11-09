/**
 * Metric definitions shown in the admin UI.
 *
 * These exist so a transport inspector reading a figure can see what it
 * means without leaving the page, and so the wording is identical wherever
 * a metric appears. Every definition below restates the manuscript's own
 * method (sections 3.10.3 to 3.10.5) and nothing here changes a formula.
 *
 * Keep these descriptive. No definition should tell the reader what to do.
 */

/** Load factor, demand tiers, GPS quality, time periods. */
export const DEF = {
  loadFactor:
    "Load factor = recorded occupancy divided by the official seated capacity " +
    "entered at trip setup. 100% means every seat is taken. Above 100% means " +
    "the vehicle carried more passengers than it has seats, which is an " +
    "over-capacity condition rather than an error.",

  peakLoadFactor:
    "The highest mean load factor of the four operating periods, with the " +
    "period that produced it. Computed per GPS log record, then averaged " +
    "within each period.",

  overCapacity:
    "The share of GPS log records whose occupancy exceeded official seated " +
    "capacity, i.e. the Moderate, High and Critical tiers combined.",

  qualityThreshold:
    "The share of GPS log records that met the accuracy threshold, counting " +
    "Good (<= 20 m) and Acceptable (<= 50 m) together. Poor records (> 50 m) " +
    "are excluded from spatial clustering but their occupancy values are " +
    "still counted in demand and load factor.",

  gpsLogs:
    "The number of GPS log records in the selected trips. Each record is one " +
    "position-and-occupancy sample, taken roughly every 3 seconds.",

  tripsAnalyzed:
    "The number of completed trips included in the current selection. Active " +
    "trips are excluded because analytics run after a trip is completed.",

  clusterActivity:
    "Stop clusters found by DBSCAN, ranked by how many GPS log records fall " +
    "inside each one. Rank reflects recorded activity in this dataset only; " +
    "it is not a service recommendation.",

  afternoonPeakLoad:
    "The mean load factor of the Afternoon Peak period, 16:00 to 18:59 PHT. " +
    "Computed per recorded observation, then averaged within the period. " +
    "Above 100% means the average vehicle carried more passengers than it " +
    "has seats.",

  aboveSeatedCapacity:
    "The share of recorded observations with more than 26 passengers aboard, " +
    "i.e. above the official seated capacity. This combines the Moderate, " +
    "High and Critical tiers. It is a wider measure than Critical demand " +
    "alone and the two should not be quoted interchangeably.",

  highCritical:
    "The share of recorded observations with 32 or more passengers aboard: " +
    "the High tier (32 to 36) plus the Critical tier (37 and above). These " +
    "are the readings furthest beyond seated capacity.",

  dataReliability:
    "The share of recorded observations that met the data reliability " +
    "threshold, counting Good (<= 20 m) and Acceptable (<= 50 m) positional " +
    "accuracy together. Less accurate readings are excluded from spatial " +
    "detection, but their passenger counts still count towards demand.",

  detectedHotspots:
    "Places where vehicles repeatedly paused with passengers aboard, found " +
    "from the recorded positions in this selection by the spatial detection " +
    "method. A count of observed activity, not a list of approved stops.",

  reviewedZones:
    "Passenger-service areas that have been separately assessed and published " +
    "for this corridor. These are a reviewed list, not a product of the " +
    "detection run, so this count is not expected to equal the detected " +
    "hotspot count.",
};

/** The four demand intensity tiers. Boundaries are relative to capacity C. */
export const TIER_DEFS = [
  { name: "Normal",   fill: "var(--rs-fill-normal)",   on: "var(--rs-on-normal)",
    def: "Occupancy at or below capacity C. Spare seats available." },
  { name: "Moderate", fill: "var(--rs-fill-moderate)", on: "var(--rs-on-moderate)",
    def: "Above C, up to C+5. Common high-demand state on this corridor." },
  { name: "High",     fill: "var(--rs-fill-high)",     on: "var(--rs-on-high)",
    def: "Above C+5, up to C+10. At or approaching the physical maximum." },
  { name: "Critical", fill: "var(--rs-fill-critical)", on: "var(--rs-on-critical)",
    def: "Above C+10. Exceeds the vehicle's physical passenger maximum." },
];

/** The four operating periods, in Philippine Standard Time (UTC+8). */
export const PERIOD_DEFS = [
  { name: "Morning Peak",   range: "06:00 to 08:59" },
  { name: "Midday",         range: "09:00 to 15:59" },
  { name: "Afternoon Peak", range: "16:00 to 18:59" },
  { name: "Off-Peak",       range: "19:00 to 05:59" },
];

/** Canonical period order, used for every period chart and table. */
export const PERIOD_ORDER = PERIOD_DEFS.map((p) => p.name);

/** Canonical tier order, lowest to highest severity. */
export const TIER_ORDER = TIER_DEFS.map((t) => t.name);

/**
 * The published thesis dataset, for comparison against whatever is in the
 * connected database. Used by the provenance notice so local sample figures
 * are never mistaken for official results.
 */
export const OFFICIAL_DATASET = {
  trips: 20,
  logs: 35326,
  days: 13,
};

/**
 * Descriptive observation for a detected stop cluster.
 *
 * Replaces the prescriptive text the backend returns on
 * /stop-zones/recommendations ("Consider formalizing this location",
 * "Stop underutilized - consider consolidating with nearby stop",
 * "prioritize for formalization review").
 *
 * Those strings recommend franchise and route actions. The study is
 * descriptive: delimitation 1 excludes predictive modelling, delimitation 2
 * excludes route optimization, and delimitation 11 states the system is not
 * for binding operational decision-making. So the UI reports what was
 * observed and what an analyst could inspect next, and leaves the decision
 * to the person reading it.
 *
 * The backend response is left untouched; this only changes what is shown.
 *
 * @param tier   mapped demand tier from the API (High / Medium / Low)
 * @param conf   coverage confidence (High / Medium / Low)
 * @param days   number of collection days the cluster was observed on
 */
export function describeCluster(tier, conf, days) {
  if (days != null && days < 3) {
    return "Observed on fewer than 3 collection days. Data requires further inspection.";
  }
  if (tier === "High" && conf === "High") {
    return "High-demand cluster detected, consistent across collection days. " +
           "Compare against ground-truth stops.";
  }
  if (tier === "High" && conf === "Medium") {
    return "High-demand cluster detected, present on some collection days. " +
           "Review supporting trips.";
  }
  if (tier === "High") {
    return "High-demand cluster detected, but coverage across collection days " +
           "is inconsistent. Data requires further inspection.";
  }
  if (tier === "Low" && conf === "High") {
    return "Low recorded activity, consistently observed. " +
           "Compare against ground-truth stops.";
  }
  return "Moderate recorded activity. Review supporting trips.";
}

/** Short, non-prescriptive label for a cluster's recorded activity. */
export function clusterActivityLabel(tier) {
  if (tier === "Critical" || tier === "High") return "High recorded activity";
  if (tier === "Moderate" || tier === "Medium") return "Moderate recorded activity";
  return "Lower recorded activity";
}
