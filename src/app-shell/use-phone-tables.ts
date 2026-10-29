/**
 * Phone tables — the app's global answer to ~140 desktop tables.
 *
 * A table with more than PHONE_MAX_COLUMNS columns cannot fit a phone, and
 * horizontal scrolling inside a list is miserable. While the app shell is
 * mounted this watches the page and, for each such table, copies its column
 * headings onto every cell (`data-label`) and marks it `data-phone-cards`.
 * index.css (html.app-shell …) then draws each row as a card of
 * "Label …… value" lines — lists, reports and line-item editors alike.
 *
 * Narrow tables are left as tables. Print templates (.signature-page, the
 * A4 documents) are never touched. Nothing here changes data or behaviour:
 * the same cells, inputs and click handlers, laid out differently.
 */
import { useEffect } from 'react';

const PHONE_MAX_COLUMNS = 4;
const SKIP_INSIDE = '.signature-page, [data-phone-keep]';

function headerLabels(table: HTMLTableElement): string[] | null {
  const head = table.tHead?.rows;
  if (!head || head.length === 0) return null;
  const row = head[head.length - 1]!;
  const labels: string[] = [];
  for (const cell of Array.from(row.cells)) {
    const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < Math.max(1, cell.colSpan); i++) labels.push(text);
  }
  return labels;
}

function labelRow(row: HTMLTableRowElement, labels: string[]): void {
  let col = 0;
  for (const cell of Array.from(row.cells)) {
    const span = Math.max(1, cell.colSpan);
    // A cell spanning several columns (totals label, empty state) has no single heading.
    const label = span > 1 ? '' : labels[col] ?? '';
    if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
    col += span;
  }
}

function processTable(table: HTMLTableElement): void {
  if (table.closest(SKIP_INSIDE)) return;
  const labels = headerLabels(table);
  if (!labels || labels.length <= PHONE_MAX_COLUMNS) {
    table.removeAttribute('data-phone-cards');
    return;
  }
  if (!table.hasAttribute('data-phone-cards')) table.setAttribute('data-phone-cards', '');
  for (const body of [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])]) {
    for (const row of Array.from(body.rows)) labelRow(row, labels);
  }
}

function processAll(root: ParentNode): void {
  root.querySelectorAll('table').forEach((t) => processTable(t as HTMLTableElement));
}

export function usePhoneTables(): void {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        processAll(document.body);
      });
    };
    schedule();
    // childList only: our own data-label writes are attributes and never re-trigger this.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
