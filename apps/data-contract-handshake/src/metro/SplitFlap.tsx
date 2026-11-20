/**
 * Split-flap display: each character sits on its own flap and riffles through the drum before it settles, staggered
 * left to right, like a station departures board. Text changes re-run the riffle for the cells that changed only.
 * Reduced motion shows the final text at once. The flaps are decorative; screen readers get the plain text.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { cx, useReducedMotion } from '@x10/shared/ui';

const DRUM = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-+:.';

function fit(text: string, length: number | undefined): string {
  const up = text.toUpperCase();
  if (length === undefined) return up;
  return up.length > length ? `${up.slice(0, length - 1)}…` : up.padEnd(length, ' ');
}

export function SplitFlap({
  text,
  length,
  delay = 0,
  className,
  cellClassName,
  color,
  label,
  align = 'left',
}: {
  text: string;
  /** Fixed number of flaps (pads or truncates). */
  length?: number;
  /** Start delay in ms (stagger rows). */
  delay?: number;
  className?: string;
  cellClassName?: string;
  /** Flap text colour. */
  color?: string;
  /** Accessible text (defaults to `text`). */
  label?: string;
  align?: 'left' | 'right';
}) {
  const reduced = useReducedMotion();
  const target = align === 'right' && length !== undefined ? text.toUpperCase().slice(-length).padStart(length, ' ') : fit(text, length);
  const [shown, setShown] = useState<string>(() => (reduced ? target : ' '.repeat(target.length)));
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (reduced) {
      setShown(target);
      return;
    }
    const from = shownRef.current.padEnd(target.length, ' ').slice(0, target.length);
    const chars = [...target];
    // How many riffles each cell does before landing: a few, more for cells further right, none if unchanged.
    const left = chars.map((c, i) => (from[i] === c ? 0 : 3 + ((i * 7 + c.charCodeAt(0)) % 5)));
    const startAt = chars.map((_, i) => Math.floor(i / 2));
    let tick = 0;
    let id = 0;
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        tick++;
        let busy = false;
        const next = chars.map((c, i) => {
          if (tick < startAt[i]) {
            busy = true;
            return from[i] ?? ' ';
          }
          if (left[i] > 0) {
            left[i]--;
            busy = true;
            return DRUM[(DRUM.indexOf(c) + left[i] * 5 + i + DRUM.length) % DRUM.length] ?? ' ';
          }
          return c;
        });
        setShown(next.join(''));
        if (!busy) window.clearInterval(id);
      }, 55);
    }, delay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(id);
    };
  }, [target, delay, reduced]);

  return (
    <span className={cx('dch-flaps', className)} data-settled={shown === target} style={color ? ({ '--flap-ink': color } as CSSProperties) : undefined}>
      <span className="sr-only">{label ?? text}</span>
      <span aria-hidden="true" className="dch-flaps-row">
        {[...shown].map((c, i) => (
          <span key={i} className={cx('dch-flap', cellClassName)}>
            <span key={c} className="dch-flap-ch">
              {c === ' ' ? ' ' : c}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
