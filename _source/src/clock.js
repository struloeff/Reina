// One clock for the whole show. Everything that moves reads `t` from here, so
// nothing can drift out of step with anything else: the words, the Earth, the
// meteor and the hearts are all functions of the same number.
//
// It only advances while the page is visible. Lock the phone halfway through and
// the show waits for her; it does not carry on without her and dump her
// mid-sentence on return. A long frame is clamped, so nothing ever jumps.

export function createClock({ start = 0, speed = 1, frozen = false } = {}) {
  let t = start;
  let dt = 0;
  let last = null;
  let paused = false;

  return {
    get t() {
      return t;
    },
    get dt() {
      return dt;
    },
    get frozen() {
      return frozen;
    },
    tick(nowMs) {
      let d = last === null ? 0 : (nowMs - last) / 1000;
      last = nowMs;
      if (paused || frozen || document.hidden) d = 0;
      dt = Math.min(Math.max(d, 0), 1 / 15) * speed;
      t += dt;
      return t;
    },
    seek(v) {
      t = v;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = null;
    },
  };
}
