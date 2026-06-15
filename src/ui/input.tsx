import { forwardRef, useState, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/**
 * Shared text input.
 *
 * Restyled in Phase 12.39 to match the inventory-wizard sample look:
 *   - 11px uppercase tracking-wide slate-500 label
 *   - 36px tall, 7px radius, slate-200 border, white background
 *   - 13px text, 8/10 padding
 *   - indigo focus ring (rgba(124,58,237,.10))
 *
 * Any className passed in (e.g. "w-40") is preserved for sizing/layout.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, className = '', onFocus, onBlur, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    const [focused, setFocused] = useState(false);
    const borderColor = error ? '#dc2626' : focused ? '#7c3aed' : '#e2e8f0';
    return (
      <div className={`flex flex-col gap-1 ${className.includes('w-') ? '' : 'w-full'}`}>
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              display: 'flex',
              gap: '3px',
              alignItems: 'center',
            }}
          >
            {label}
            {rest.required && <span style={{ color: '#ef4444' }}>*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={className}
          style={{
            width: '100%',
            padding: '8px 10px',
            fontSize: '13px',
            border: `1px solid ${borderColor}`,
            borderRadius: '7px',
            background: '#fff',
            color: '#1e293b',
            outline: 'none',
            transition: 'border-color .15s, box-shadow .15s',
            boxShadow: focused ? '0 0 0 3px rgba(124,58,237,.10)' : 'none',
          }}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e)  => { setFocused(false); onBlur?.(e); }}
          {...rest}
        />
        {error && <p style={{ fontSize: '11px', color: '#dc2626', margin: 0 }}>{error}</p>}
        {hint && !error && <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0 }}>{hint}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';
