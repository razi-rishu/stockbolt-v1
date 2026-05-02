import type { JEPayload, JEPostResult, DataAdapter } from '@/data/adapter';
import { validateLines, assertMapping, JournalValidationError } from './journal-validator';

export { JournalValidationError };

/**
 * Validate then post a journal entry via the RPC.
 * TypeScript validates the 10 universal rules + mapping rules first.
 * The Postgres RPC handles the period lock check and atomic DB insert.
 */
export async function postJournalEntry(
  payload: JEPayload,
  adapter: DataAdapter,
): Promise<JEPostResult> {
  validateLines(payload.lines);
  assertMapping(payload.source_type, payload.lines);
  return adapter.accounting.postJE(payload);
}

/**
 * Reverse a journal entry — mirrors all GL lines with Dr↔Cr flipped.
 * Period lock is enforced by the RPC (reversal date = today).
 */
export async function reverseJournalEntry(
  je_id: string,
  adapter: DataAdapter,
  description?: string,
): Promise<JEPostResult> {
  return adapter.accounting.reverseJE(je_id, description);
}
