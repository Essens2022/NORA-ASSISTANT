/** Circular percentage indicator, drawn with a plain SVG stroke-dasharray (no chart lib). */
export function ProgressRing({ percent, size = 96, stroke = 10 }: { percent: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = c - (clamped / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} class="progress-ring" role="img" aria-label={`${clamped}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" stroke-width={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#progress-ring-gradient)"
        stroke-width={stroke}
        stroke-linecap="round"
        stroke-dasharray={c}
        stroke-dashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id="progress-ring-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="var(--blue)" />
          <stop offset="100%" stop-color="var(--cyan)" />
        </linearGradient>
      </defs>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="progress-ring-text">
        {clamped}%
      </text>
    </svg>
  );
}
