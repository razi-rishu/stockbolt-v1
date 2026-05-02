import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, id, className = '', ...rest }, ref) => {
    const areaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={areaId} className="text-sm font-medium text-ink-primary">
            {label}
            {rest.required && <span className="ms-1 text-danger-500">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={areaId}
          rows={3}
          className={`w-full rounded-card border bg-surface-subtle px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-y ${
            error ? 'border-danger-500' : 'border-border-strong'
          } ${className}`}
          {...rest}
        />
        {error && <p className="text-xs text-danger-500">{error}</p>}
        {hint && !error && <p className="text-xs text-ink-tertiary">{hint}</p>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
