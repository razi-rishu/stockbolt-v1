import { forwardRef, useState, type SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

/**
 * Shared select dropdown.
 *
 * Restyled in Phase 12.39 to match the inventory-wizard sample look:
 *   - 11px uppercase tracking-wide slate-500 label
 *   - 36px tall, 7px radius, slate-200 border, white background
 *   - inline chevron SVG, indigo focus ring
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, id, className = '', onFocus, onBlur, ...rest }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    const [focused, setFocused] = useState(false);
    const borderColor = error ? '#dc2626' : focused ? '#7c3aed' : '#e2e8f0';
    return (
      <div className={`flex flex-col gap-1 ${className.includes('w-') ? '' : 'w-full'}`}>
        {label && (
          <label
            htmlFor={selectId}
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
        <select
          ref={ref}
          id={selectId}
          className={className}
          style={{
            width: '100%',
            padding: '8px 30px 8px 10px',
            fontSize: '13px',
            border: `1px solid ${borderColor}`,
            borderRadius: '7px',
            background: '#fff',
            color: '#1e293b',
            outline: 'none',
            transition: 'border-color .15s, box-shadow .15s',
            boxShadow: focused ? '0 0 0 3px rgba(124,58,237,.10)' : 'none',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 10px center',
            cursor: 'pointer',
          }}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e)  => { setFocused(false); onBlur?.(e); }}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {error && <p style={{ fontSize: '11px', color: '#dc2626', margin: 0 }}>{error}</p>}
      </div>
    );
  },
);
Select.displayName = 'Select';
