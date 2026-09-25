# For Reina

Open `index.html`. That's it. It works double-clicked from this folder (no
server, no internet) and from any static web host.

About a minute of show, then the quiz, then the letter:

| | |
|---|---|
| 0-7s | the sky grows out of the loading star, brightest first; **Hey Reina** / *wanna know something crazy?* |
| 5-12s | the Earth rises over the bottom of the screen at night, the sun comes up over its edge; *out of all the people on earth...* |
| 12-20s | it lifts into a whole globe; *you're the only one for me <3* comes out from behind it |
| 20-25s | it falls away to a pale blue dot; *and out of all the stars in the night sky...* |
| 25-30s | a shooting star crosses and bursts into the brightest star in the sky; *you shine the brightest.* |
| 31-37s | *happy birthday to the best ~~friend~~ girlfriend ever.* |
| 38-47s | *i'm truly lucky to have met ...*, word by word |
| 48-55s | *i hope to spend many more birthdays with you (you're still going to outlive me though).* - hearts |
| 57s+ | *complete this quiz for a reward* - four questions, a red-pen grading animation, *passed <3*, then the letter, with a countdown under it (*until i see you again*, to 9pm Pacific on Oct 23) |

**The secret:** on *how many other bitches do you have?*, tapping **0** ten times
opens a 30-second game, catch the shooting stars. *now answer honestly* takes her
back to the question. The number of taps, the game's words and the countdown's
date are all in `assets/content.js`.

Every time in the show lives in one place, `_source/src/script.js`.

**Her Wikipedia page:** tapping *Reina* at the top of the letter opens
`reina.html` (nothing marks the word as tappable: no underline, no hand
cursor, no link preview), a fake Wikipedia article about her (the desktop layout on a
laptop, the mobile-site layout on a phone). Its words are all in that one file
(anything in [square brackets] is still filler) and her photo goes at
`assets/wiki/reina.jpg`. The Wikipedia logo, the "Reina, (letter)" links and
the browser's Back button all return her to the letter, not the top of the
show. To remove the link, set `nameLink` in `assets/content.js` to `null`.

---

## Changing the words

- **The show's lines** are in `index.html`, in plain text. Edit, save, reload.
- **The quiz, the secret game, the letter and the countdown** are in
  `assets/content.js`. Edit, save, reload. (The "I love you sooo..." at the
  end of the letter is `"o​".repeat(2400)`: change the number for more or
  fewer o's.) The countdown's time is written with its UTC offset:
  `2026-10-23T21:00:00-07:00` is 9pm Pacific; for 9pm Eastern use `-04:00`.

Neither needs a rebuild.

## Previewing without waiting

Add these to the address bar:

```
?t=26          start 26 seconds in (any moment)
?act=quiz      straight to the quiz
?act=grade     straight to the grading animation
?act=letter    straight to the letter
?speed=3       run the show at 3x
?debug         a clock in the corner: time, fps, which line is up
?reduced       what it looks like with "reduce motion" switched on
```

Whenever any of these is in the address, an orange strip along the bottom says
so. That strip is your warning that you are **not** seeing what she will see.

## Changing anything else

The look and the motion are built from `_source/`. Needs Node 18+.

```
cd _source
npm install        # once
npm run build      # writes assets/show.js, assets/show.css, assets/earth/textures.js
```

`_source/SPEC.md` describes how it all fits together. `node tools/e2e.cjs` (from
`_source/`) plays the whole thing in a headless browser and checks every line's
timing, the pause while the phone is locked, the quiz with wrong answers, the
secret game, the grading, the letter and the countdown.

## Hosting

Upload everything except `_source/`. (GitHub Pages skips folders starting with
`_` on its own; on other hosts just leave it out.) The build stamps each file
in `index.html` with `?v=<hash>`, so phones can't keep showing an old copy.
If you edit `assets/content.js` by hand after building, run the build once more
before uploading so its stamp changes too.

The page is marked `noindex`, so search engines won't list it.

## Credits

Earth imagery from NASA's Visible Earth (public domain): Blue Marble Next
Generation, Black Marble 2016, Blue Marble clouds, and GEBCO elevation and
bathymetry. Fonts: Instrument Serif and Newsreader (SIL Open Font License).
Rendering with three.js (MIT).
