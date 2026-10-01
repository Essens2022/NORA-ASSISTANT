import { useEffect, useRef, useState } from 'preact/hooks';

/** Measures a fixed-position header's real rendered height (title + tabs,
 * and the day strip on Calendario - varies by screen and can reflow with
 * locale/font-size), so the content below it can reserve exactly that much
 * space via padding-top instead of a CSS constant that would either clip
 * under a taller header or leave a gap under a shorter one. */
export function useStickyHeadHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, height] as const;
}
