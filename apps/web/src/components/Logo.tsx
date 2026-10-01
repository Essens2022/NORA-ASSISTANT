import { NoraKitIcon } from './NoraKitIcon.tsx';

/** The NORA logo mark + wordmark, straight from the founder-supplied brand
 * kit (branding/nora-logo.svg, branding/nora-wordmark.svg) - the real
 * approved artwork, not a recreation. */
export function Logo({ size = 32, withWordmark = false, class: cls = '' }: { size?: number; withWordmark?: boolean; class?: string }) {
  return (
    <span class={`logo-lockup ${cls}`}>
      <NoraKitIcon path="branding/nora-logo.svg" size={size} class="logo-mark" alt="" />
      {withWordmark && <NoraKitIcon path="branding/nora-wordmark.svg" width={size * 3.1} height={size} class="logo-word-svg" alt="" />}
    </span>
  );
}
