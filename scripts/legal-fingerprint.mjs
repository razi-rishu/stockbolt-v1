// Prints the SHA-256 of the legal texts exactly as the app fingerprints them
// (UTF-8, line endings normalised to \n). Use the output in the publish SQL
// for public.legal_documents. Read-only.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
for (const [type, file] of [['terms', 'docs/legal/terms-of-service.md'], ['privacy', 'docs/legal/privacy-policy.md']]) {
  const text = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const version = /\*\*Version:\*\*\s*([^\s*]+)/.exec(text)?.[1] ?? '?';
  console.log(`${type}\tversion ${version}\tsha256 ${createHash('sha256').update(text, 'utf8').digest('hex')}`);
}
