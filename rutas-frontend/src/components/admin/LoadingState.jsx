/**
 * Loading states.
 *
 * LoadingState is the announced, labelled spinner for a whole section.
 * SkeletonMetrics stands in for the metric row specifically, so the page
 * does not jump when real numbers arrive.
 *
 * role="status" with aria-live="polite" means a screen reader is told that
 * work is in progress rather than being left on a silent, empty page.
 */

export default function LoadingState({ label = "Loading analytics" }) {
  return (
    <div className="rs-state" role="status" aria-live="polite">
      <div className="rs-spinner" aria-hidden="true" />
      <div className="rs-state-title" style={{ marginTop: 6 }}>{label}</div>
      <p className="rs-state-body">
        Analytics are computed across every selected trip, so this can take a
        few seconds on larger selections.
      </p>
    </div>
  );
}

export function SkeletonMetrics({ count = 5 }) {
  return (
    <div className="rs-metrics" role="status" aria-live="polite">
      <span className="rs-sr">Loading metrics</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rs-skeleton" style={{ height: 104 }} aria-hidden="true" />
      ))}
    </div>
  );
}
