/**
 * phase135 — renders the legal markdown (docs/legal/*.md) as React elements.
 * Deliberately small: headings, paragraphs, bullet lists, quotes, tables,
 * **bold**, `code` and [links](url). No HTML is ever injected, so the text
 * cannot carry script. Headings get ids for the section navigation.
 */
import type { ReactNode } from 'react';

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={`${key}-${i++}`}>{m[2]}</code>);
    else {
      const href = m[4];
      const safe = /^(https?:\/\/|mailto:|\/)/.test(href) ? href : '#';
      out.push(<a key={`${key}-${i++}`} href={safe} rel="noopener noreferrer">{m[3]}</a>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function headingsOf(md: string): { id: string; text: string }[] {
  return md.split('\n').filter((l) => /^## /.test(l)).map((l) => ({ id: slug(l.slice(3)), text: l.slice(3).trim() }));
}

export function LegalMarkdown({ source }: { source: string }) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim() || /^---\s*$/.test(line)) { i++; continue; }
    if (/^# /.test(line)) { i++; continue; }                      // the page shows the title itself
    if (/^## /.test(line)) { blocks.push(<h2 key={k} id={slug(line.slice(3))}>{inline(line.slice(3), k)}</h2>); i++; continue; }
    if (/^### /.test(line)) { blocks.push(<h3 key={k}>{inline(line.slice(4), k)}</h3>); i++; continue; }
    if (/^> /.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push(<blockquote key={k}>{inline(q.join(' '), k)}</blockquote>);
      continue;
    }
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) { items.push(lines[i].slice(2)); i++; }
      blocks.push(<ul key={k}>{items.map((t, n) => <li key={n}>{inline(t, `${k}-${n}`)}</li>)}</ul>);
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        if (!/^\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={k} className="legal-table"><table>
          <thead><tr>{head.map((c, n) => <th key={n}>{inline(c, `${k}h${n}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, rn) => <tr key={rn}>{r.map((c, n) => <td key={n}>{inline(c, `${k}-${rn}-${n}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|>|- |\||---)/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p key={k}>{inline(para.join(' '), k)}</p>);
  }
  return <>{blocks}</>;
}
