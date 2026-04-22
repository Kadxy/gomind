import { useEffect, useState } from 'react';

interface ProgressRingProps {
  /// Wall-clock timestamp (performance.now()) at which the run started.
  /// When null, the ring is idle.
  startedAt: number | null;
  /// Total time budget (ms). The ring fills linearly across this window.
  /// Pass 0 for unlimited — the ring will render an indeterminate spinner
  /// instead of a progress fill.
  budgetMs: number;
  /// When true, the ring renders at 100% instead of animating — use this
  /// for the brief window between "work completed" and the parent clearing
  /// `startedAt`, so the UI doesn't snap back to 0%.
  completed?: boolean;
  size?: number;
  className?: string;
}

/**
 * Circular progress indicator that fills smoothly from 0% to 100% over the
 * given budget. Driven by requestAnimationFrame so it keeps advancing even
 * while the main thread is busy posting messages to the engine worker.
 *
 * When `budgetMs === 0`, the component switches to an indeterminate mode:
 * a small rotating arc, since we don't know when the work will finish.
 */
export function ProgressRing({
  startedAt,
  budgetMs,
  completed = false,
  size = 18,
  className,
}: ProgressRingProps) {
  const [progress, setProgress] = useState(0);
  const [spin, setSpin] = useState(0);

  const indeterminate = budgetMs === 0 && startedAt !== null && !completed;

  useEffect(() => {
    if (completed) {
      setProgress(1);
      return;
    }
    if (startedAt === null) {
      setProgress(0);
      return;
    }
    if (indeterminate) {
      // Rotate a fixed-length arc around the ring at a steady speed. No
      // target to hit; just a visual "still thinking" signal.
      let frame = 0;
      const tick = () => {
        const elapsed = performance.now() - startedAt;
        setSpin((elapsed / 800) % 1); // 800ms per revolution
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }

    let frame = 0;
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const p = Math.min(1, elapsed / Math.max(1, budgetMs));
      setProgress(p);
      if (p < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAt, budgetMs, completed, indeterminate]);

  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  if (indeterminate) {
    // Render a 1/4-circumference arc, rotate it.
    const arcLen = c / 4;
    const gap = c - arcLen;
    const angle = spin * 360 - 90;
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={className}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${gap}`}
          transform={`rotate(${angle} ${size / 2} ${size / 2})`}
        />
      </svg>
    );
  }

  const offset = c * (1 - progress);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
