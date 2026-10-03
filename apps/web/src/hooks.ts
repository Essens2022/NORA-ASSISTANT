import { useLayoutEffect, useRef, useState } from 'preact/hooks';

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
 * becomes available again, but a plain mount-only measurement would only
 * have measured it once, back when it first mounted still hidden behind
 * another tab, and gotten 0 - then rendered that wrong 0 for one frame
 * before ResizeObserver's own (always-async) callback caught up and
 * corrected it. That's the "tick"/flash reported on every tab switch and
 * every app restart (the very first tab shown hits the same gap), and it's
 * most visible on Profilo/Ricordi: they're the two screens locked out of
 * scrolling entirely, so their content is centered to fit the viewport
 * exactly - a late padding change there visibly shifts the whole block,
 * where a scrollable screen just loses a few px off the top, unnoticed.
 *
 * `active`: true whenever THIS screen's own tab is the current one - pass
 * `tab === 'profile'` (etc.), not the raw `tab` string itself. Catching up
 * synchronously (useLayoutEffect, after DOM mutations but before paint)
 * the instant this flips to true gets the real height the same frame this
 * screen's `display: none` lifts, before anything is ever painted at the
 * wrong 0. It has to be this boolean and not the raw tab value: a caller
 * selecting the raw `tab` via useStore re-renders on literally every nav
 * tap anywhere in the app, for all five screens that use this hook at
 * once, not just the one actually becoming visible - on a quick string of
 * taps that's four wasted full-screen re-renders for every one that
 * matters, competing with the real work for the same frame budget and
 * showing up as exactly the kind of "catches up a beat late" jank this was
 * meant to fix in the first place. A boolean selector only flips (and only
 * then re-renders) for the one screen whose own visibility actually
 * changed. */
export function useMeasuredHeight(active = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0) setHeight((prev) => (prev === h ? prev : h));
  }, [active]);
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
export function useStickyHeadHeight(gap = 16, active = true) {
  const [ref, height] = useMeasuredHeight(active);
  return [ref, height ? height + gap : 0] as const;
}
