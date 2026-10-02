// Drop-in use of the founder-supplied NORA-SVG-Kit (exact vector art for the
// approved reference, both themes) instead of the hand-drawn Icon.tsx path
// set, wherever the kit has a matching asset. Both theme variants are always
// rendered and CSS (see .nora-kit-icon in styles.css) shows only the one
// that matches the active theme - same light/dark/system pattern the rest
// of the app's styling already uses, so no JS theme lookup is needed here.
// Only the subfolders actually referenced from components - the kit also
// ships full per-screen mockup composites (screens/, notifications/ etc,
// tens of KB each) that aren't used as live UI and would otherwise bloat
// every page's JS bundle just by being globbed.
const kitFiles = import.meta.glob(
  ['../assets/nora-kit/{dark,light}/icons/*.svg', '../assets/nora-kit/{dark,light}/icons-active/*.svg', '../assets/nora-kit/{dark,light}/branding/*.svg', '../assets/nora-kit/{dark,light}/buttons/*.svg'],
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

function urlFor(path: string): string | undefined {
  return kitFiles[`../assets/nora-kit/${path}`];
}

/** A single fixed-theme glyph from the kit (always the white-on-dark stroke
 * variant), for spots that already paint their own dark background (a
 * coloured badge circle, the always-dark bottom nav, the always-dark header
 * settings button) and need the icon itself to stay light regardless of the
 * app's own theme - the dark/light split in the kit is for which SCREEN
 * background the icon sits on, not which app theme is active, and these
 * spots don't follow the app theme at all. path is relative to dark/,
 * e.g. "icons/calendar.svg" or "buttons/header-gear.svg". */
export function KitGlyph({ path, size = 16, class: cls = '' }: { path: string; size?: number; class?: string }) {
  const src = urlFor(`dark/${path}`);
  if (!src) return null;
  return <img src={src} width={size} height={size} class={cls} alt="" />;
}

/** path is relative to dark/ and light/, e.g. "icons/calendar.svg" or "branding/nora-wordmark.svg". */
export function NoraKitIcon({ path, size, width, height, class: cls = '', alt = '' }: { path: string; size?: number; width?: number; height?: number; class?: string; alt?: string }) {
  const dark = urlFor(`dark/${path}`);
  const light = urlFor(`light/${path}`);
  const w = width ?? size;
  const h = height ?? size;
  if (!dark || !light) return null;
  return (
    <span class={`nora-kit-icon ${cls}`} style={w ? { width: w, height: h ?? w } : undefined}>
      <img src={light} width={w} height={h} alt={alt} class="nki-light" />
      <img src={dark} width={w} height={h} alt={alt} class="nki-dark" />
    </span>
  );
}
