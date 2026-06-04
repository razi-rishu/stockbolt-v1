/**
 * useFormInvalidBanner — Phase 14.14l.
 *
 * Wraps react-hook-form's silent-failure trap. When zod (or any other
 * resolver) rejects a submit, `handleSubmit(onValid)` returns without
 * calling either handler — so the Submit button looks dead. The setup
 * wizard hit this in Phase 14.13i; the senior-dev audit (Phase 14.14j)
 * found every other RHF-using form has the same trap.
 *
 * Usage:
 *
 *   const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('invoice-editor');
 *
 *   <form onSubmit={handleSubmit(onValid, onInvalid)}>
 *     {bannerMessage && <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />}
 *     …
 *   </form>
 *
 * What it does:
 *   - Logs the full errors object to console (devs see it during dev).
 *   - Sets `bannerMessage` to a human-readable first-error string
 *     (operators see it in production).
 *   - Auto-clears on next successful submit, or via clearBanner().
 *
 * Why a banner + a console log + the existing per-field <Input error={…}/>:
 *   - Per-field is great when the bad field is on-screen, but step-by-step
 *     wizards and long modals can have validation errors on a field that
 *     isn't visible. Banner says "something is wrong" even when the field
 *     is scrolled off.
 *   - Console log lets us catch the class of bug (e.g. an optional field
 *     defaulted to undefined breaking z.string()) during code review.
 */
import { useCallback, useState } from 'react';
import type { FieldErrors, FieldValues } from 'react-hook-form';

export interface UseFormInvalidBannerResult {
  /** Pass as the second arg to `handleSubmit`. */
  onInvalid: (errors: FieldErrors<FieldValues>) => void;
  /** Render this above your form fields when truthy. */
  bannerMessage: string | null;
  /** Call to dismiss the banner manually (e.g. when the user starts typing). */
  clearBanner: () => void;
}

export function useFormInvalidBanner(componentName: string): UseFormInvalidBannerResult {
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const onInvalid = useCallback((errors: FieldErrors<FieldValues>) => {
    // Always log — dev wants the structured errors object, not a string.
    // eslint-disable-next-line no-console
    console.warn(`[${componentName}] submit blocked by validation`, errors);
    setBannerMessage(firstFormError(errors));
  }, [componentName]);

  const clearBanner = useCallback(() => setBannerMessage(null), []);

  return { onInvalid, bannerMessage, clearBanner };
}

/** Walks the FieldErrors tree and returns the first human-readable message,
 *  falling back to a generic prompt. Exported separately so non-React code
 *  (or tests) can use it without spinning up a hook. */
export function firstFormError(errors: FieldErrors<FieldValues>): string {
  for (const key of Object.keys(errors)) {
    const e = errors[key] as { message?: string; type?: string } | undefined;
    if (e?.message) {
      // Prefix with the field name so the operator knows where to look.
      const fieldLabel = humanizeFieldName(key);
      return `${fieldLabel}: ${e.message}`;
    }
  }
  return 'Please re-check the form — one or more fields look invalid.';
}

/** Turn `bank_account_name_ar` into `Bank account name ar`. Cheap heuristic
 *  good enough for an error banner; per-field labels remain the source of
 *  truth in the actual UI. */
function humanizeFieldName(snake: string): string {
  if (!snake) return 'Field';
  return snake
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}
