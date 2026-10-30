import { describe, it, expect } from 'vitest';
import { splitNoteDetails } from '@/modules/print/engine/note-details';

// The Elegant print layout turns "Label: value" chunks of a document's notes
// into detail rows (Orvella's Event Type / Venue / Guests) and keeps the rest.
describe('splitNoteDetails', () => {
  it('splits semicolon-separated label/value pairs', () => {
    const r = splitNoteDetails('Event Type: Wedding; Event Date: 15 Nov 2026; Venue: Mahfil auditorium; Guests: 1,200');
    expect(r.details).toEqual([
      ['Event Type', 'Wedding'], ['Event Date', '15 Nov 2026'], ['Venue', 'Mahfil auditorium'], ['Guests', '1,200'],
    ]);
    expect(r.rest).toBe('');
  });

  it('keeps plain sentences as notes, and accepts newlines or pipes', () => {
    const r = splitNoteDetails('Deliver before noon\nVenue: City Hall | Guests: 80');
    expect(r.details).toEqual([['Venue', 'City Hall'], ['Guests', '80']]);
    expect(r.rest).toBe('Deliver before noon');
  });

  it('does not treat a long sentence containing a colon as a detail', () => {
    const r = splitNoteDetails('Please note the following before the event starts: arrive early');
    expect(r.details).toEqual([]);
    expect(r.rest).toBe('Please note the following before the event starts: arrive early');
  });

  it('handles empty notes', () => {
    expect(splitNoteDetails(null)).toEqual({ details: [], rest: '' });
  });
});
