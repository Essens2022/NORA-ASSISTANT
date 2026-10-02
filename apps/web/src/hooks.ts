import { useEffect, useRef, useState } from 'preact/hooks';

/** Measures a fixed-position element's real rendered height (border-box,
 * padding included), so other content can reserve exactly that much space
 * instead of a CSS constant that would either clip under a taller element
 * or leave a gap under a shorter one. Used for both the fixed header above
 * content and a fixed action bar below it. */
export function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, height] as const;
}

/** Same as useMeasuredHeight, plus a little breathing room so content right
 * below the fixed header doesn't sit flush against it - a <section class="group">
 * with its own heading has that spacing built in, but a bare <ul class="task-list">
 * (e.g. Attività's Oggi/Completate filters) doesn't, and would otherwise touch
 * the header exactly. */
export function useStickyHeadHeight() {
  const [ref, height] = useMeasuredHeight();
  return [ref, height ? height + 16 : 0] as const;
}
