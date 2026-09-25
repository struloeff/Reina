# For Reina - design and build spec

A birthday page for Reina, from Will. About a minute of cinema in space - stars,
a real 3D Earth, a shooting star - carrying a handful of short lines, then a
four-question quiz she can't fail. It ends in a grading animation, and a 100%
grade unlocks a letter.

She will most likely open it on her **phone, in portrait, at night, in the dark**.
Design and test for that first (390x844 and 360x740). It must also look right on
a laptop (1440x900, 1920x1080) and survive landscape.

Tone: intimate, cinematic, restrained. The words are lowercase and plain, and the
visuals should sit behind them. Think planetarium or Apple keynote, not a greeting
card. Nothing cheesy, nothing that looks like a template or a default. Motion is
slow and eased, with nothing snapping or popping. Everything is beautiful at 3am on
an OLED phone at full brightness, so keep it dark and never glaring.

---

## 0. Hard rules

1. **Words are fixed.** Act one's words are in `index.html`, act two's in
   `assets/content.js`. Never change, add or invent visible words. (Numerals and
   `%` in the grading animation are fine. Everything else comes from content.js.)
2. **Own only your files** (section 3). Never edit anyone else's. If you need a
   change in a shared file, describe it in your final report instead.
3. **Never run the full build** (`node build.mjs` with no arguments) - other
   agents are working in parallel and their files may be mid-edit. Build only
   your harness: `node build.mjs --entry harness/<you>.js --out harness/out/<you>.js`
   (and a `.css` entry the same way if you have CSS).
4. **Look at what you make.** Screenshot your harness with `tools/shot.cjs`, then
   Read the PNG and judge it with a critical eye. Iterate until it is genuinely
   beautiful at phone size, not merely working. Report the final screenshot paths.
5. Performance budget: 60 fps on a 2020 iPhone at DPR 2. There is one canvas
   and one bloom pass. Bake anything expensive once at startup. No per-frame
   allocation in hot paths.
6. Plain JavaScript ES modules, `import * as THREE from 'three'` and
   `three/addons/...`. No other dependencies. Match the comment style of
   `src/stage.js` and `src/director.js`: comments explain why, briefly.

## 1. The page

```
MYREINA/
  index.html            every word of act one
  assets/content.js     every word of act two (window.REINA)
  assets/show.js/.css   built by _source (do not edit)
  assets/earth/         day.jpg night.jpg clouds.jpg water.jpg relief.jpg (+ textures.js, the same as data: URIs)
_source/
  build.mjs  SPEC.md
  src/   main.js clock.js stage.js textures.js script.js rig.js director.js  <- integrator
         earth.js sky.js meteor.js hearts.js lines.js act2.js           <- module builders
  css/   show.css base.css                                               <- integrator
         lines.css act2.css                                              <- module builders
  harness/kit.js   tools/shot.cjs   tools/make_textures.py
```

Layers, back to front: `<canvas id="sky">` (all WebGL), `#back` (words that go
*behind* the planet - masked by its disc), `#front` (words in front of
everything), `#act2` (quiz, grading, letter), `#loader`.

Fonts (already in base.css): `--font-display` = Instrument Serif (normal +
italic); `--font-text` = Newsreader (variable weight 200-800, normal + italic).
Colour tokens: `--ink #f7f1ea` (warm white, never pure), `--ink-soft`,
`--ink-faint`, `--rose #ff9db5`, `--rose-ink #ff6f8e` (the red pen), `--gold
#ffe2a8`, `--violet #d8c8ff`, glows `--glow-white|violet|gold|rose`.

## 2. Rendering conventions (src/stage.js)

- `stage.scene` + `stage.camera` (PerspectiveCamera): the world. Earth at the
  origin, radius **1**, north = **+Y**. The director moves the camera (it always
  looks at the origin, with a lens shift via `setViewOffset`). Its fov runs 34
  down to 26 degrees.
- `stage.overlay.scene` + `stage.overlay.camera`: **screen space in CSS pixels,
  origin top-left, y DOWN**. Because y is flipped, overlay materials must use
  `side: THREE.DoubleSide`. `stage.size = {w, h, dpr}` is live.
- Pipeline: world pass -> overlay pass (same buffer, depth cleared) ->
  `UnrealBloomPass` (strength .85, radius .6, threshold .8) -> OutputPass (ACES
  filmic, sRGB) -> grade pass (flash, vignette, grain, fade). The buffer is **HDR
  half-float**: values above ~1 bloom. Keep ordinary surfaces under 1. Push
  deliberate highlights (sun, meteor head, hero star core) to 4-20.
- ShaderMaterials write **linear** colour. Do not add `colorspace_fragment`, and
  do not tone map yourself. The day texture is sRGB (three decodes it); the others
  are raw data.
- The sky must never hide the Earth: sky materials use `depthWrite: false,
  depthTest: false`, a negative `renderOrder`, and follow the camera position.
- Point sizes: `gl_PointSize` is in device pixels, so multiply by `stage.size.dpr`.
- Modules add their own objects to the scenes in `create*()`; the director only
  calls `update()`.

## 3. Ownership and contracts

Each module exports one `create*` function. `update(t, dt, p)` is called every
frame with the show time `t` (seconds, may jump when seeking, **is frozen at a
fixed value for screenshots**), `dt` (0 when frozen) and a params object `p`.
**Anything that animates must be a function of `t`, never of accumulated `dt`,**
so `?t=26` lands on exactly the frame a viewer would see at 26s. Randomness is
seeded (hash functions of index), never `Math.random()` per frame.

### earth.js  (owner: Earth builder)   files: src/earth.js, harness/earth.*

`createEarth(stage, tex) -> { object, update(t, dt, p) }`, with `tex = {day,
night, clouds, water, relief}` (THREE.Texture, RepeatWrapping on S, mipmapped;
day is sRGB 4096x2048; night lights 4096x2048 grey; clouds 4096x2048 grey,
0 = clear; water mask 2048x1024, 255 = water; relief 2048x1024 grey, land
elevation, 0 = sea level).

Orientation (verified against the director): with `spin = 0`, **longitude 0
faces +Z and 90°E faces +X**. Three's SphereGeometry with its default UVs puts
lon 0 on +X, so rotate the mesh -PI/2 about Y (the stub does exactly this).
`object.rotation.y = p.spin`.

p = {
  spin        radians, Earth's rotation about +Y
  cloudSpin   radians, the cloud layer's own rotation (slightly ahead of spin)
  sunDir      THREE.Vector3, world, unit, from the Earth toward the sun (director owns it; do not keep a reference past the call)
  opacity     0..1  the whole planet, atmosphere, glare and dot fade together
  lights      0..1  city lights multiplier (1 in the show)
  atmosphere  0..1  multiplier (1 in the show)
  glare       0..1  the sunrise starburst allowance (see below)
  dot         0..1  "pale blue dot" glow allowance while the planet is a few px wide
  discR       the planet's current on-screen radius in CSS px (for LOD / dot / AA)
}

The shots that matter:
1. **Horizon / sunrise (t 5.4-12)**: the camera is close (distance ~1.9). The
   planet fills the lower half of the phone as a broad curved horizon (disc radius =
   screen height). The sun is **behind** the planet, just below its top edge,
   and rises over it at t 8-10. We see the **night side**: Europe and the
   Mediterranean in city lights ("out of all the people on earth..."). The limb
   is lit by forward-scattered sunlight: a thin, intense gold-white arc
   brightest near the sun, cooling to blue and fading along the curve. As the
   sun clears the edge a starburst blooms (visible only when the sun is actually
   past the limb from the camera's view: compute it from the angle between the
   sun direction and the Earth's centre as seen from the camera, against the
   Earth's angular radius asin(1/dist)). Keep it gorgeous but not blinding.
   There are words above it.
2. **Globe (t 13-20)**: the whole planet, radius about 156 px on a phone and 270 on
   a laptop, above centre, Africa and Europe facing us (the Apollo 17 view),
   lit from the upper left: a bright gibbous with the terminator on the right,
   where Arabia, India and Asia's city lights show on the night side. It needs
   blue Rayleigh haze thickening to the limb, a thin soft atmosphere glow around
   the whole rim (blue on the day side, a warm band where the terminator meets
   the rim), clouds with soft shadows, a sun glint on the oceans (water mask),
   subtle relief at the terminator, and a warm twilight band along the
   terminator. Nothing oversaturated or cartoonish: the target is the real
   photographs.
3. **Recede (t 20.2-22.5)**: it falls away to a few pixels, becomes a tiny
   luminous blue-white dot (`dot`, a soft point glow a few px across, with no
   aliased speck or shimmering sub-pixel sphere) and fades out (`opacity`).

Silhouette must be smooth at radius ~1000 px (enough segments; soft 1-2 px
anti-aliased edge where the atmosphere meets space).

### sky.js  (owner: sky builder)   files: src/sky.js, harness/sky.*

`createSky(stage) -> { object, update(t, dt, p) }`. `object` stays at the
camera position (you set it each frame). Its rotation is `p.rotation` (a
THREE.Euler the director may set - copy it, do not replace the object).

p = {
  reveal      0..1 over t 0-4.8: THE OPENING. The sky grows out of the loading
              star (a breathing dot at screen centre = revealOrigin) like eyes
              adjusting to the dark: brightest stars first, fainter ones filling in
              by the hundreds, each one's moment also rippling outward from
              revealOrigin (screen distance, soft jittered front, never a hard
              ring or a left-to-right wipe). Each star IGNITES: a brief twinkle
              overshoot (~0.35s) as it appears, then settles. The first few stars
              must appear right at/near the centre within the first ~0.3s so the
              loading dot hands off seamlessly. Meanwhile the rig eases the fov
              from 40 to 34 over 0-5.6s (a slow drift in), and milkyWay develops
              over 1.2-6.8s like a long exposure (core first, lanes after).
  revealOrigin [x, y] viewport fractions (0.5, 0.5)
  brightness  0..1 multiplies stars, milky way, meteors (dips to .12 for the meteor beat, sits at .6-.75 later)
  milkyWay    0..1 the band's visibility (fades in over the first 6s)
  twinkle     0..1
  warp        0..1 (peaks ~.55 at t 21.5): stars stretch into short streaks radially from screen centre, as if flying forward
  meteors     0|1 ambient shooting stars allowed
  hero        { x, y, intensity, size }  THE BRIGHTEST STAR, at viewport fractions (x,y).
              intensity 0 = off, ~1 = resting, spikes to ~6.5 at the burst (t 26.1) and decays
  rotation    THREE.Euler
}

- Stars: 7-9k, with a realistic magnitude distribution (mostly faint, few
  bright), real colours (blackbody: blue-white to warm orange, mostly white),
  denser along the galactic plane, crisp at any DPR, the bright ones with a
  tiny soft halo. Scintillation should be subtle, with the brighter stars twinkling more.
- Milky Way: a soft band, realistic rather than airbrushed: a brighter warm
  core region, dust lanes, clumpy star clouds, faint colour variation, plus one
  or two very faint nebula wisps (violet or teal). Bake it once into a texture
  (render target or canvas) and map it on a sphere around the camera, rather
  than computing noise per pixel per frame.
- Ambient meteors: small, quick, realistic streaks (head and fading tail, about
  0.4-0.9s), one every ~6-12s while `meteors` = 1, seeded from `t`. Keep them
  in the upper part of the screen and away from centre, where the words are.
- Hero star: drawn in the **overlay** (screen space). A tight white-hot core,
  soft halo, 4 thin diffraction spikes (plus 2 fainter), and a gentle scintillating
  shimmer. At intensity ~6 it is dazzling (bloom), and at 1 it is simply the
  brightest star in the sky. It must read as a star, not a lens flare sticker.

### meteor.js  (owner: effects builder)   files: src/meteor.js, src/hearts.js, harness/fx.*

`createMeteor(stage) -> { update(t, dt, p) }`, drawn in the overlay.

p = {
  progress   (t - 25.2) / 0.9 : <0 hidden; 0..1 the head travels from->to (a touch of acceleration); 1..1.35 the tail drains away behind the head's end point; >1.35 gone
  from, to   [x, y] viewport fractions (from may be off-screen, top-left). to = the hero star's position
  burst      0..1 envelope peaking at t 26.1 (progress = 1): the head bursts - a starburst flare with a quick expanding soft ring
  intensity  1
}

This is THE shooting star of the show: the old page tried a CSS one and it
was flat. Make it cinematic. It needs a white-hot head, a long tapered tail (about
a third of the screen diagonal) shading white to pale gold to faint blue-violet,
a few sparks shed from the head that drift and fade, and a slight flicker. It
crosses a nearly black sky (brightness .12) and ends in a burst. At the burst
the director also flashes the whole screen (grade `uFlash` peaks ~.8 and decays
over ~1.2s) and the hero star takes over at the same point, so the burst must
hand off to a star at `to`.

### hearts.js  (owner: effects builder)

`createHearts(stage) -> { update(t, dt, p) }`, drawn in the overlay.

p = {
  streams  [{ start, end, every, opacity, band: [fx0, fx1] }]  heart i of a stream is born at start + i*every (while < end), at a seeded x within the band, below the bottom edge
  bursts   [{ at, count, x, y, spread }]  count hearts pop outward from (x,y) viewport fractions at time `at`, then float up and fade
}

The old page had black emoji hearts on a black background, which you couldn't
see. Make them lovely: soft glowing hearts (an SDF heart shape, crisp at any DPR,
with a gentle glow) in rose and pink with a few warm white and gold, 10-34 CSS px,
with depth (smaller means dimmer, softer and slower), a gentle sway and slow tilt.
They rise over ~7-9s, fading in at the bottom and out before the top. Purely a
function of t and the params. Cap at ~150 alive. They pass behind the words.

### lines.js + css/lines.css  (owner: words builder)   files: src/lines.js, css/lines.css, harness/lines.*

`createLines(doc, cues, opts) -> { update(t, dt, env) }`.
`cues` come from `src/script.js` (read it). Each: `{ id, at, until, enter,
enterDur, exit, exitDur, idle, strike?, parts? }` - the line arrives from `at`
(over enterDur), holds, and leaves from `until` (over exitDur). Before and
after, it is hidden (`visibility: hidden`).

env = { earthDisc: {x, y, r} | null   (CSS px; the planet's disc, live)
        globe: {cx, cy, r}            (where the whole globe settles; also on :root as --globe-cx/--globe-cy/--globe-r)
        reducedMotion }

Enter styles:
- `rise`: from ~5vh lower, blur 8px to 0, scale .96 to 1, opacity 0 to 1. The
  easing is soft with a hint of overshoot.
- `lift`: the same from further down (~18vh), for the line above the horizon.
- `emerge`: for `l-only`, which starts **at the globe's centre** (so it is hidden
  behind the planet by the mask) and glides down to its slot below the globe while
  un-blurring. It looks like it comes out from behind the Earth.
- `focus`: zoom into focus, from scale .9, blur 6px and letter-spacing +.04em to
  crisp, with a violet glow.
- `flare`: appears with the screen flash, starting over-bright (a strong
  text-shadow bloom) and settling to its gold glow over ~1.5s.
- `fade`: opacity only, softly eased.
- `words`: word by word, each word rising and un-blurring in sequence across
  enterDur (for the long `l-lucky`).

Exit styles: `fade`, `sink` (drift down ~6vh while fading; for `l-people`,
which the rising globe covers).

Idle: `drift` is a very gentle float of a few px with a tiny rotation, using
slow incommensurate sines per line. `orbit` is a slow elliptical float with a
slight 3D tilt. `none` is still.

`strike` (`l-birthday`): at `strike.at`, over `strike.dur`, a **hand-drawn marker
stroke** crosses out **friend** (`.strike`). It's an SVG path with a slight
wobble and taper, overshooting the word a little, drawn left to right, in warm
white or rose ink. Then "friend" dims to about .5 and "girlfriend" gains a warm
glow. The joke is the inversion, so it must read instantly: ~~friend~~ girlfriend.

`parts` (`l-many`): `.aside` "(you're still going to outlive me though)."
arrives later (its own `at`), a touch smaller and softer, on its own line on
phones.

Mask: `#back` gets `mask-image` and `-webkit-mask-image`, a radial gradient
that is transparent inside the disc and opaque just outside, with a soft edge of
~max(6px, 1.5% of r) so words slide *behind* the planet's limb and atmosphere.
Set it only when it changes (rounded), and use `none` when earthDisc is null.

Layout (phone first; nothing may overflow 360 px): Instrument Serif. "Hey
Reina" is roman and large (~clamp(52px, 14vw, 104px)); everything else is
italic. Main lines clamp(26px, 6.6vw, 50px); `line--body` lines clamp(21px,
5.4vw, 36px) with max-width ~24ch on phones and text-wrap: balance. Positions:
greeting stack centred ~40%, `l-people` ~32% (above a horizon whose top is at
54%), `l-only` just below the globe (`calc(var(--globe-cy) + var(--globe-r) +
gap)`), front lines around 50%, and `l-brightest` a little lower (~57%) so the
hero star (`--hero-x/--hero-y`, ~66%/30%) sits above it. Glow classes:
`line--hero`, `line--sub`, `line--rose`, `line--violet`, `line--gold`,
`line--body`. Reduced motion: fades only, no blur and no travel.

Every frame is computed from `t`; seeking must land on a clean frame. Write
styles only when they change. Use `will-change` only while animating.

### act2.js + css/act2.css  (owner: act two builder)   files: src/act2.js, css/act2.css, harness/act2.*

`createAct2(root, content, hooks) -> { start(from) }`. `root` is the empty
`<section id="act2" hidden>`, and you build everything inside it. `content` is
`window.REINA` (read `assets/content.js`). `from` is 'quiz' | 'grade' | 'letter'
(the last two are previews: 'grade' assumes four right answers). hooks =
`{ onStep(name), celebrate(x, y, count), reducedMotion }`. Call `onStep` on
entering 'quiz', 'grade' and 'letter'. Call `celebrate(x, y, count)` at the
100% moment (x, y as viewport fractions; the director turns it into a heart
burst). Act two is event-driven (taps), not a function of t. It sits
transparent over the live sky.

1. **Quiz**: `quiz.intro` ("just checking it's you.") arrives first,
   large and italic. About 1.2s later the question area fades in beneath it. There
   are four small star-dots for progress, then the question, then the options.
   - Wrong tap: the button gives a small shake (no layout shift) and dims a
     little but stays tappable. The reply appears below (`say`, or a random
     `wrong` line, never the same random line twice in a row), aria-live.
   - Right tap: the button glows, a tiny check draws in it, and the progress dot
     lights. About 0.8s later the question lifts away and the next arrives.
   - Question 4 (all "Reina"): any tap lights up **all four** together.
   - Two options sit side by side and four make a 2x2. Buttons are at least 48px tall with
     text at least 17px (iOS zooms below 16). The style is glassy and restrained: a hairline
     border, a faint fill, backdrop blur. The question is Instrument Serif italic
     and the options are Newsreader.
2. **Grading** (the "little grading animation", ~4-5s): a report slip listing the
   four questions compactly with her (correct) answers. A red-pen check
   (`--rose-ink`, a hand-drawn stroke with a faint glow) is drawn beside each in
   turn, and a big score counts up 0%, 25, 50, 75, 100% as each check lands.
   Then "100%" gets **circled** with a hand-drawn loop, `celebrate()` fires,
   and `quiz.opened` ("it's you.") fades in. After about 1.8s the slip gives way to
   the letter. Make it charming and precise, like a teacher's red pen on a
   starry night.
3. **Letter**: a readable column (Newsreader 18-20px, line-height ~1.65,
   max-width ~34rem, generous margins) that arrives with the greeting. The
   paragraphs follow one after another (~0.8s apart, fade and rise), and the
   ones below the fold reveal as she scrolls. Then `signoff`, and `signature`
   in Instrument Serif italic, larger. If `letter.again` is non-empty, a small
   quiet link at the very end restarts the show (`location.href =
   location.pathname`). The letter is the only thing on the whole page that
   scrolls: overflow-y auto, momentum scrolling, soft fade masks at top and
   bottom, safe-area padding.

Respect reduced motion. Keyboard works (real `<button>`s, visible focus).

### minigame.js + css/minigame.css  (owner: minigame builder)   files: src/minigame.js, css/minigame.css, harness/minigame.*

The secret. On the quiz's third question ("how many other bitches do you
have?"), tapping "0" `content.minigame.taps` (10) times opens it. It's a 30-second game in
the real sky: **catch the shooting stars**. When it ends she goes back to that
question and still has to pick 67.

`createMinigame(stage | null, root, content, hooks) -> { start(onDone), update(t, dt), get active }`
- `root` is `<section id="minigame" hidden>` (z-index 4, above act two). Build
  the UI inside it. Words come from `content.minigame` (`found`, `title`, `hint`,
  `start`, `seconds`, `result` with `{n}`, `best` with `{n}`, `again`, `back`). Invent no others (numerals are fine).
- `start(onDone)` is called by the director when act two asks for the secret.
  It un-hides root and shows a small card: `found` (a beat), then `title`, `hint`
  and a `start` button. Starting runs a `seconds`-long round, then a result card:
  `result`, `best` (the best score is kept in localStorage, wrapped in try/catch),
  an `again` link and a `back` button. `back` hides root and calls `onDone(score)`.
- `update(t, dt)` is called every frame by the director with the show clock. It
  drives the round (a game is event-driven, so it can use accumulated time; it
  is never screenshotted with ?t=). Do nothing when not active.
- Shooting stars are drawn in `stage.overlay.scene` (CSS px, y down, DoubleSide,
  HDR heads for bloom), in the same visual family as the show's meteor: a
  white-hot head and a tapered tail fading from white through gold to faint
  violet. They streak across the screen from varied edges at varied angles,
  each crossing in ~1.3-2.6s, a few at a time, getting quicker and more frequent
  over the round. A tap within ~48 CSS px of a head (use pointerdown on root,
  generous for thumbs) **catches** it: a small burst of sparkle, a "+1" that
  floats up and fades, the score ticks, and `hooks.celebrate(x, y, 3)` pops
  three hearts there. Missed stars just burn out.
- HUD: the score in big Instrument Serif numerals at the top (safe area), and a
  thin timer line that drains, glowing warmer in the last 5 seconds. Minimal.
- `hooks = { celebrate(x, y, count), onMood(name) }`: call `onMood('game')` when
  the round starts and `onMood('quiz')` on `back`. The director brightens the
  sky for the game.
- With `stage` null (no WebGL), draw the stars as DOM/CSS elements instead, so the
  secret still works.
- Everything is touch-first (390x844), and also works with a mouse. No page
  scroll or zoom while playing (`touch-action: none` on the play area).

## 4. The running order (from src/script.js - that file is the truth)

| t | what happens |
|---|---|
| 0-3.6 | stars come up in a wave, left to right; the milky way fades in until 6.5 |
| 1.6 | **Hey Reina** rises in |
| 3.6 | *wanna know something crazy?* rises in beneath |
| 5.4-8.9 | the planet rises from below the frame and stops as a horizon (top at 54%) - night side, Europe's lights |
| 7.3 | the greeting fades |
| 7.4-10.2 | the sun comes over the planet's edge: limb arc brightens, starburst |
| 8.4 | *out of all the people on earth...* lifts in above the horizon |
| 12.0-14.9 | the planet lifts into a whole globe above centre (camera pulls back and swings, sun comes round to the upper left); the line above sinks behind it |
| 12.6 | *you're the only one for me <3* emerges from behind the globe and settles below it |
| 19.2 | it fades |
| 20.2-22.5 | the globe falls away to a pale blue dot and goes out; the sky zooms (fov 34 to 26) with a brief star-streak warp |
| 20.9 | *and out of all the stars in the night sky...* zooms into focus |
| 24.8-25.3 | words fade, stars sink to .12 |
| 25.2-26.1 | THE shooting star crosses from top left to the hero point |
| 26.1 | it bursts, the screen flashes, the brightest star is born there |
| 26.15 | *you shine the brightest.* flares in |
| 26.5-28.8 | the sky comes back, softer |
| 31.0 | *happy birthday to the best friend girlfriend ever.* - at 32.6 "friend" is crossed out |
| 39.2 | *i'm truly lucky to have met ...* arrives word by word |
| 49.2 | *i hope to spend many more birthdays with you* ... 51.0 *(you're still going to outlive me though).* |
| 49.8 | hearts start rising |
| 57.6 | act two: *just checking it's you.* |

## 5. Testing

**Render the real show frames.** `src/rig.js` exports `frameAt(t, size, camera,
{mood})`: it places the camera exactly as the show does at time `t` and returns
`{ layout, disc, earthVisible, earth, sky, meteor, grade }`, the exact params your
module will receive in the show. In your harness `frame()`, call
`const F = frameAt(t, stage.size, stage.camera)`, then `yourModule.update(t, dt,
F.<yours>)` (and apply `F.grade` to `stage.grade.uFlash/uFade/uVignette`), and
your screenshots at `?t=9`, `?t=16`, `?t=26.2` are what she will see. Do NOT
import other builders' modules into your harness (they are being rewritten in
parallel and may not compile mid-edit). If you need context - the sky harness
wanting a planet in frame, say - put a tiny throwaway placeholder inside your
own harness file.

Harness pages live in `_source/harness/`: `<you>.html` loads a css bundle and
`out/<you>.js`, and your `<you>.js` uses `runHarness()` from `kit.js` (read it).
Build with `node build.mjs --entry harness/<you>.js --out harness/out/<you>.js`,
run from `_source/`.

Screenshot with `node tools/shot.cjs harness/<you>.html --times 0,1,2 --phone
--out <SHOTS>/<you>/name` (read the header of tools/shot.cjs for options:
`--q`, `--phone|--small|--landscape|--desktop|--wide`, `--wait`). Frames load
with `?t=<time>&freeze`. `<SHOTS>` is the scratchpad folder given in your task,
and nothing gets written into `MYREINA/` except your owned files. The browser
runs WebGL in software (SwiftShader), which is slow but faithful. Page console
errors are printed; a frame with errors is not done. For interaction (act two),
write a small Playwright script next to your harness (same require path as
shot.cjs) that taps through and screenshots each step.

Done means: it works, it is beautiful at 390x844 in a screenshot you
have actually looked at, it holds up at 360x740 and 1440x900, there are no console
errors, it follows the contract exactly, and your final report lists the API,
anything the integrator must know, and the screenshot paths.
