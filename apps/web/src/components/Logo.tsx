import { brand } from '../config/brand.ts';
// imported (not a plain /public file) so Vite gives it a content hash - a future
// logo change ships under a brand-new URL instead of relying on the browser's
// HTTP cache to notice the old one changed
import logoMark from '../assets/logo-mark.png';

/** The NORA logo mark: the real brand-pack "N" artwork, not a recreation - same
 * source image used for the app icon. */
export function Logo({ size = 32, withWordmark = false, class: cls = '' }: { size?: number; withWordmark?: boolean; class?: string }) {
  return (
    <span class={`logo-lockup ${cls}`}>
      <img src={logoMark} width={size} height={size} class="logo-mark" alt="" />
      {withWordmark && <span class="logo-word">{brand.appName}</span>}
    </span>
  );
}
