/**
 * Small shared pieces for the public website: the reveal-on-scroll wrapper
 * (off when the visitor prefers reduced motion), the brand row and the
 * section heading.
 */
import type { CSSProperties, ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { BrandMark } from '@/components/brand-logo';

/** Brand teal used for the mark on the website (the app keeps orange). */
export const LP_MARK = '#008F87';

export function Reveal({ children, delay = 0, className, style }: {
  children: ReactNode; delay?: number; className?: string; style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className} style={style}>{children}</div>;
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: 'easeOut', delay }}
    >
      {children}
    </motion.div>
  );
}

export function BrandRow({ size = 30 }: { size?: number }) {
  return (
    <span className="lp-brand" dir="ltr">
      <BrandMark size={size} color={LP_MARK} />
      <span className="lp-brand-word">STOCKBOLT</span>
    </span>
  );
}

export function SectionHead({ kicker, title, lead, center = false, id }: {
  kicker: string; title: string; lead?: string; center?: boolean; id?: string;
}) {
  return (
    <Reveal className={center ? 'lp-head-center' : undefined}>
      <p className="lp-kicker">{kicker}</p>
      <h2 className="lp-h2" id={id}>{title}</h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </Reveal>
  );
}
