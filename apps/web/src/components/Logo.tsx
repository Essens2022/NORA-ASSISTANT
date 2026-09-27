import { brand } from '../config/brand.ts';

/** The NORA logo mark: the real brand-pack "N" artwork (public/logo-mark.png),
 * not a recreation - same source image used for the app icon. */
export function Logo({ size = 32, withWordmark = false, class: cls = '' }: { size?: number; withWordmark?: boolean; class?: string }) {
  return (
    <span class={`logo-lockup ${cls}`}>
      <img src={`${import.meta.env.BASE_URL}logo-mark.png`} width={size} height={size} class="logo-mark" alt="" />
      {withWordmark && <span class="logo-word">{brand.appName}</span>}
    </span>
  );
}
