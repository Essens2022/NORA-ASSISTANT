import { brand } from '../config/brand.ts';

/** The NORA logo mark: a gradient rounded-square badge with an "N" monogram,
 * drawn as SVG (no image asset) so it stays crisp at any size and themes cleanly. */
export function Logo({ size = 32, withWordmark = false, class: cls = '' }: { size?: number; withWordmark?: boolean; class?: string }) {
  return (
    <span class={`logo-lockup ${cls}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" class="logo-mark" aria-hidden="true">
        <defs>
          <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--blue)" />
            <stop offset="100%" stop-color="var(--cyan)" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="12" fill="url(#logo-grad)" />
        <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" class="logo-letter">
          N
        </text>
      </svg>
      {withWordmark && <span class="logo-word">{brand.appName}</span>}
    </span>
  );
}
