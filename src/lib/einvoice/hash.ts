/**
 * AC-4C — content hash for an e-invoice payload.
 *
 * sha-256 over the exact serialized payload (India GST JSON string / UAE UBL
 * XML string). Used for integrity + idempotent re-generate (the RPC returns the
 * existing snapshot when the hash is unchanged). Uses the Web Crypto API, which
 * is present both in the browser and in the Node test runner.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
