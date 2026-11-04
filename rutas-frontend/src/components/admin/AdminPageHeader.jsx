/**
 * Page title, one-line purpose, and an optional action slot.
 *
 * Every admin page gets the same heading shape so the h1 is predictable for
 * screen readers and the eye lands in the same place between pages.
 */
export default function AdminPageHeader({ title, subtitle, badges, actions }) {
  return (
    <header className="rs-pagehead">
      <div className="rs-pagehead-top">
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {subtitle && <p className="rs-pagehead-sub">{subtitle}</p>}
        </div>
        {actions && <div className="rs-pagehead-actions">{actions}</div>}
      </div>
      {badges && <div className="rs-badges" style={{ marginTop: 14 }}>{badges}</div>}
    </header>
  );
}
