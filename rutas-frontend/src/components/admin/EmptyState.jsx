/**
 * Empty, unavailable, and error states.
 *
 * These are separate concepts and are deliberately worded differently:
 *
 *   EmptyState       nothing has been recorded yet
 *   UnavailableState the API cannot supply this metric at all
 *   ErrorState       the request failed
 *
 * Collapsing them into one "no data" message hides the difference between
 * "there is nothing to show" and "this cannot be shown", which is exactly
 * the distinction an inspector needs in order to trust the figure above it.
 */

export default function EmptyState({ title, body, action }) {
  return (
    <div className="rs-state">
      <div className="rs-state-title">{title}</div>
      {body && <p className="rs-state-body">{body}</p>}
      {action}
    </div>
  );
}

/**
 * For a metric the current API genuinely cannot provide. `reason` should say
 * what is missing, so the gap is documented on screen instead of being
 * filled with an invented value.
 */
export function UnavailableState({ title = "Not available in current dataset", reason }) {
  return (
    <div className="rs-state">
      <div className="rs-state-title">{title}</div>
      {reason && <p className="rs-state-body">{reason}</p>}
    </div>
  );
}

export function ErrorState({ title = "Could not load this section", body, onRetry }) {
  return (
    <div className="rs-state rs-state--error" role="alert">
      <div className="rs-state-title">{title}</div>
      {body && <p className="rs-state-body">{body}</p>}
      {onRetry && (
        <button type="button" className="rs-btn" onClick={onRetry} style={{ marginTop: 4 }}>
          Try again
        </button>
      )}
    </div>
  );
}
