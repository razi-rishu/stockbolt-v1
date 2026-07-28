/**
 * AC-4B — e-invoice formatting library (pure, offline).
 *
 * Canonical model + jurisdiction formatters. Consumes the classification fields
 * AC-4A/AC-4A.2 capture; produces a compliant e-invoice payload for India (GST
 * JSON) and the UAE (PINT-AE UBL XML). No DB, no network, no signing.
 */
export * from './canonical';
export * from './india-gst';
export * from './pint-ae';
