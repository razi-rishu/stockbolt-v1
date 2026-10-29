import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isNative } from '@/lib/platform';

/** 210mm at 96 dpi — the width of an A4 print template. */
export const A4_WIDTH_PX = 794;

/** Phones only (the Android app, or a phone-width browser); desktop layouts never shrink. */
function shouldFit(): boolean {
  return isNative() || window.matchMedia('(max-width: 767px)').matches;
}

/**
 * Shrinks a fixed-width document (an A4 invoice template) to fit a phone
 * screen instead of running off the right edge. Uses CSS zoom so the layout
 * box shrinks too (no blank space, no sideways scroll). Printing is
 * unaffected: index.css resets [data-fit-zoom] to zoom 1 under @media print.
 */
export function FitToWidth({ children, contentWidth = A4_WIDTH_PX }: { children: ReactNode; contentWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !shouldFit()) return;
    const update = () => {
      const width = el.clientWidth;
      setZoom(width > 0 && width < contentWidth ? width / contentWidth : 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentWidth]);

  return (
    <div ref={ref} className="fit-to-width" style={{ width: '100%' }}>
      <div data-fit-zoom style={zoom === 1 ? undefined : { zoom }}>
        {children}
      </div>
    </div>
  );
}
