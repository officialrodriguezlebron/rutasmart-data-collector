/**
 * A labelled divider between page sections.
 *
 * `note` is where the denominator belongs: how many records, how many
 * trips, over what window. A figure without its denominator is not
 * interpretable, so the note is part of the header rather than optional
 * decoration.
 */
export default function SectionHeader({ title, note, id, actions }) {
  return (
    <div className="rs-sectionhead">
      <h2 id={id}>{title}</h2>
      {note && <span className="rs-sectionhead-note">{note}</span>}
      {actions && <span style={{ marginLeft: "auto" }}>{actions}</span>}
    </div>
  );
}
