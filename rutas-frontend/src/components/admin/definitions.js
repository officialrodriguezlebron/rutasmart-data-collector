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
