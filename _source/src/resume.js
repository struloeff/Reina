// Where to pick the show up when the page loads again in the same tab: after
// iOS takes the WebGL context away (main.js reloads into that moment), and
// after she follows the link on her name in the letter and comes back (act2.js
// sends her straight back to the letter instead of the top of the show).

import { T } from './script.js';

const KEY = 'reina.resume';

const MIN = 60 * 1000;

export function saveResume(t, mood, keepFor = 15 * MIN) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ t, mood, at: Date.now(), keep: keepFor }));
  } catch {
    /* private mode: it restarts from the top instead */
  }
}

// leaving for another page from the letter: come back to the letter, however
// long she spends over there
export const rememberLetter = () => saveResume(T.act2 + 1, 'letter', 12 * 60 * MIN);

export function forgetResume() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing was stored */
  }
}

export function takeResume() {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const r = raw && JSON.parse(raw);
    return r && Date.now() - r.at < (r.keep || 15 * MIN) && isFinite(r.t) ? r : null;
  } catch {
    return null;
  }
}
