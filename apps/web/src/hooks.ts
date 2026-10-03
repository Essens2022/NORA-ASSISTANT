import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore } from './state/store.ts';

/** Measures a fixed-position element's real rendered height (border-box,
 * padding included), so other content can reserve exactly that much space
 * instead of a CSS constant that would either clip under a taller element
 * or leave a gap under a shorter one. Used for both the fixed header above
 * content and a fixed action bar below it.
 *
 * Every tab stays mounted at all times (see App.tsx) and the inactive ones
 * are hidden with plain `display: none` - which means their offsetHeight is
 * 0 the whole time they're hidden, ResizeObserver included (there's no box
 * to observe). The moment you switch to a hidden tab, its real height
 * becomes available again, but without the `tab` dependency below this
 * hook would only have measured it once, back when it first mounted still
 * hidden behind another tab, and gotten 0 - then rendered that wrong 0 for
 * one frame before ResizeObserver's own (always-async) callback caught up
 * and corrected it. That's the "tick"/flash reported on every tab switch
 * and every app restart (the very first tab shown hits the same gap), and
 * it's most visible on Profilo/Ricordi: they're the two screens locked out
 * of scrolling entirely, so their content is centered to fit the viewport
 * exactly - a late padding change there visibly shifts the whole block,
 * where a scrollable screen just loses a few px off the top, unnoticed.
 * Re-running this measurement in useLayoutEffect (after DOM mutations,
 * before paint) every time `tab` changes catches the real height the same
 * instant this screen's `display: none` lifts, before anything is ever
 * painted at the wrong 0. ResizeObserver stays on top for changes that
 * aren't a tab switch (language switch changing header text length, font
 * swap, orientation). */
export function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const tab = useStore((s) => s.tab);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);
  return [ref, height] as const;
}

/** Same as useMeasuredHeight, plus a little breathing room so content right
 * below the fixed header doesn't sit flush against it - a <section class="group">
 * with its own heading has that spacing built in, but a bare <ul class="task-list">
 * (e.g. Attività's Oggi/Completate filters) doesn't, and would otherwise touch
 * the header exactly. Profilo asked for this trimmed to the minimum (not
 * flush, but close) - it's the one screen that's locked out of scrolling at
 * all costs, so every px reclaimed here is a px less likely to push its last
 * row ("Versione…") under the nav bar on a real device's taller real-font
 * rendering. */
export function useStickyHeadHeight(gap = 16) {
  const [ref, height] = useMeasuredHeight();
  return [ref, height ? height + gap : 0] as const;
}
