/**
 * Data freshness and provenance indicators.
 *
 * DataStatusBadge is the generic pill. DataProvenanceNotice is the callout
 * that keeps the dashboard honest about which dataset is on screen.
 *
 * The provenance notice exists because the thesis reports 20 trips and
 * 35,326 GPS log records collected over 13 days, while a local or
 * development database holds whatever has been recorded into it. Figures
 * rendered from the connected database are not the manuscript's published
 * results, and the UI must say so rather than let a reader assume
 * otherwise.
 */
import { OFFICIAL_DATASET } from "./definitions";

export default function DataStatusBadge({ tone = "default", label, title }) {
  const dot = {
    ok: "var(--rs-fill-normal)",
    warn: "var(--rs-fill-moderate)",
    info: "var(--rs-fill-info)",
    default: "var(--rs-text-3)",
  }[tone];

  const cls = tone === "default" ? "rs-badge" : `rs-badge rs-badge--${tone}`;

  return (
    <span className={cls} title={title}>
      <span className="rs-badge-dot" style={{ background: dot }} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * States plainly that the figures come from the connected database, and how
 * that compares with the published dataset.
 */
export function DataProvenanceNotice({ trips, logs, days }) {
  const matchesOfficial =
    trips === OFFICIAL_DATASET.trips && logs === OFFICIAL_DATASET.logs;

  const observed = [
    trips == null ? null : `${trips} completed trip${trips === 1 ? "" : "s"}`,
    logs == null ? null : `${logs.toLocaleString()} GPS log records`,
    days == null ? null : `${days} collection day${days === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="rs-provenance" role="note">
      <div className="rs-provenance-body">
        <strong>Live figures from the connected database.</strong>{" "}
        Every number on this page is computed from {observed || "the current dataset"}.
        {!matchesOfficial && (
          <>
            {" "}This is <strong>not</strong> the published thesis dataset
            ({OFFICIAL_DATASET.trips} trips, {OFFICIAL_DATASET.logs.toLocaleString()} GPS
            log records over {OFFICIAL_DATASET.days} collection days), so these values
            should not be quoted as official results.
          </>
        )}
      </div>
    </div>
  );
}
