import { UnavailableState } from "./EmptyState";

/**
 * GPS data quality, reported in the manuscript's three categories.
 *
 * Good (<= 20 m), Acceptable (<= 50 m), Poor (> 50 m). All three are shown
 * separately. Folding Acceptable into Poor would understate data quality,
 * because the manuscript's headline quality figure is Good plus Acceptable
 * measured against the threshold, not Good alone.
 *
 * The second row reports what reached the clustering stage. Poor records are
 * excluded from spatial input, and records taken while the vehicle was
 * moving are gated out before clustering, so the number of points DBSCAN
 * actually saw is much smaller than the record count. Showing that keeps the
 * cluster figures interpretable.
 */
export default function DataQualitySummary({ quality, dbscan }) {
  if (!quality) {
    return (
      <UnavailableState
        title="GPS quality not available"
        reason="The analytics response did not include a quality summary for this selection."
      />
    );
  }

  const total = quality.total_logs || 0;
  const met = (quality.good_count || 0) + (quality.acceptable_count || 0);
  const metPct = total ? (met / total) * 100 : 0;

  const cells = [
    {
      k: "Good",
      v: `${(quality.good_pct ?? 0).toFixed(1)}%`,
      n: `${(quality.good_count ?? 0).toLocaleString()} records, accuracy <= 20 m`,
      c: "var(--rs-on-normal)",
    },
    {
      k: "Acceptable",
      v: `${(quality.acceptable_pct ?? 0).toFixed(1)}%`,
      n: `${(quality.acceptable_count ?? 0).toLocaleString()} records, accuracy <= 50 m`,
      c: "var(--rs-on-moderate)",
    },
    {
      k: "Poor",
      v: `${(quality.poor_pct ?? 0).toFixed(1)}%`,
      n: `${(quality.poor_count ?? 0).toLocaleString()} records, accuracy > 50 m`,
      c: "var(--rs-on-critical)",
    },
    {
      k: "Met threshold",
      v: `${metPct.toFixed(2)}%`,
      n: `${met.toLocaleString()} of ${total.toLocaleString()} records (Good + Acceptable)`,
      c: "var(--rs-on-info)",
    },
  ];

  return (
    <div>
      <div className="rs-quality-grid">
        {cells.map((c) => (
          <div key={c.k} className="rs-quality-cell">
            <div className="rs-quality-k">{c.k}</div>
            <div className="rs-quality-v" style={{ color: c.c }}>{c.v}</div>
            <div className="rs-quality-n">{c.n}</div>
          </div>
        ))}
      </div>

      <dl className="rs-deflist">
        <div>
          <b>Spatial input.</b>{" "}
          {dbscan
            ? `${(dbscan.dbscan_input ?? 0).toLocaleString()} of ${(dbscan.total_input ?? 0).toLocaleString()} ` +
              `records reached the clustering stage. ${(dbscan.moving_excluded ?? 0).toLocaleString()} were gated out ` +
              `as moving, ${(dbscan.noise_points ?? 0).toLocaleString()} were spatial noise, and Poor-accuracy records ` +
              `were excluded from spatial input.`
            : "Not available for this selection."}
        </div>
        <div>
          <b>Occupancy coverage.</b> Poor-accuracy records are excluded from
          clustering only. Their occupancy values are still counted in the
          demand tier and load factor figures, because occupancy is recorded by
          the conductor and does not depend on GPS accuracy.
        </div>
        <div>
          <b>Timestamps.</b> Every record is stamped by the database on insert
          and binned to Philippine Standard Time (UTC+8) before its operating
          period is assigned.
        </div>
      </dl>
    </div>
  );
}
