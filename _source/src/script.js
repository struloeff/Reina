// The running order. Every time in the show is in this file, in seconds from
// the moment the stars start to appear. Move a number here and everything that
// depends on it moves with it; nothing is chained off anything else.
//
// The words themselves are in index.html (act one) and assets/content.js (the
// quiz and the letter).

export const T = {
  skyReveal: [0.0, 4.8], // the sky grows out of the loading star: brightest stars first, rippling outward
  settle: [0.0, 5.6], // the view eases in from a little wide while it does
  milkyWay: [1.2, 6.8], // then the milky way develops, like a long exposure

  earthrise: [5.4, 8.9], // the planet rises from below the frame and stops as a horizon
  sunrise: [7.4, 10.2], // the sun comes over its edge
  lift: [12.0, 14.9], // it lifts off into a whole globe, above centre
  recede: [20.2, 21.9], // it falls away to a pale blue dot...
  dotOut: [21.5, 22.5], // ...and goes out
  zoom: [20.2, 24.6], // the sky zooms in while it goes

  dim: [24.8, 25.3], // stars sink back to make room for the meteor
  meteor: [25.2, 26.1], // shooting star, from top left to where the brightest star will be
  flash: 26.1, // it bursts
  skyBack: [26.5, 28.8], // the sky comes back, softer

  hearts: 49.0, // hearts start drifting up
  act2: 56.8, // "complete this quiz for a reward"
};

// One entry per line of act one. `at` is when it starts to arrive, `until` when
// it starts to leave. The line styles are described in SPEC.md.
export const CUES = [
  { id: 'l-greeting', at: 1.6, until: 7.3, enter: 'rise', enterDur: 1.8, exit: 'fade', exitDur: 1.2, idle: 'drift' },
  { id: 'l-crazy', at: 3.6, until: 7.3, enter: 'rise', enterDur: 1.6, exit: 'fade', exitDur: 1.2, idle: 'drift' },
  { id: 'l-people', at: 8.4, until: 12.3, enter: 'lift', enterDur: 1.8, exit: 'sink', exitDur: 1.6, idle: 'drift' },
  // (enterDur 2.6 keeps the reveal inside the globe's lift, so the rising planet
  // uncovers the line; longer, it drifts out slowly after the planet has stopped)
  { id: 'l-only', at: 12.6, until: 19.2, enter: 'emerge', enterDur: 2.6, exit: 'fade', exitDur: 1.0, idle: 'orbit' },
  { id: 'l-stars', at: 20.9, until: 24.8, enter: 'focus', enterDur: 3.2, exit: 'fade', exitDur: 0.5, idle: 'none' },
  { id: 'l-brightest', at: 26.15, until: 30.0, enter: 'flare', enterDur: 0.6, exit: 'fade', exitDur: 1.0, idle: 'drift' },
  {
    id: 'l-birthday', at: 31.0, until: 37.4, enter: 'fade', enterDur: 1.2, exit: 'fade', exitDur: 1.0, idle: 'drift',
    strike: { at: 32.6, dur: 0.7 },
  },
  { id: 'l-lucky', at: 38.4, until: 47.4, enter: 'words', enterDur: 3.4, exit: 'fade', exitDur: 1.0, idle: 'drift' },
  {
    id: 'l-many', at: 48.4, until: 55.2, enter: 'rise', enterDur: 1.6, exit: 'fade', exitDur: 1.2, idle: 'drift',
    parts: [{ sel: '.aside', at: 50.2, enter: 'fade', enterDur: 1.2 }],
  },
];

// Where the planet sits on screen, as a function of the viewport. The director
// places the camera so the Earth's disc lands exactly here.
export function layout(w, h) {
  const domeR = h * 1.0; // earthrise: a horizon, gently curved on a phone, a broad dome on a laptop
  const domeTop = h * 0.54;
  const globeR = Math.min(w * 0.4, h * 0.25);
  const globeCy = h * 0.4;
  return {
    dome: { cx: w / 2, cy: domeTop + domeR, r: domeR },
    below: { cx: w / 2, cy: h * 1.04 + domeR, r: domeR }, // before it rises: just out of frame
    globe: { cx: w / 2, cy: globeCy, r: globeR },
    hero: w > h ? { x: 0.6, y: 0.27 } : { x: 0.66, y: 0.3 }, // the brightest star, as viewport fractions
  };
}
