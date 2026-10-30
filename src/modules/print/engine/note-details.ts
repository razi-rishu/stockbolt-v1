/**
 * Notes → detail rows, for the Elegant print layout.
 */

/** "Label: value" chunks of the document notes become extra detail rows
 *  (e.g. "Event Date: 15 Nov 2026; Venue: Mahfil auditorium"); the rest stays a note. */
export function splitNoteDetails(notes: string | null | undefined): { details: [string, string][]; rest: string } {
  const details: [string, string][] = [];
  const rest: string[] = [];
  for (const part of (notes ?? '').split(/\r?\n|;|\|/)) {
    const m = /^\s*([^:]{1,24}?)\s*:\s*(.+?)\s*$/.exec(part);
    if (m) details.push([m[1], m[2]]);
    else if (part.trim()) rest.push(part.trim());
  }
  return { details, rest: rest.join('\n') };
}
