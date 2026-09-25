// Harness for the sky, framed exactly as the show frames it: every frame asks the
// rig where the camera is and feeds F.sky to the module, so ?t=26.2&freeze is the
// real frame at 26.2 s.
//
//   ?words     rough stand-ins for act one's lines (composition only)
//   ?bake      show the baked Milky Way texture flat (u across, galactic b up)
//   ?mood=quiz|letter   act-two brightness
//   ?rawrig    use rig.js exactly as it is, without the co-rotation below
//
// Co-rotation: from the meteor dim on, the sky must turn with the camera's orbit,
// or the brightest star (pinned to the screen) slides across the stars. That
// belongs in rig.js (the review's fix, see the sky report); until the rig does it,
// this harness applies the same formula, so these frames are what the show will be.

import * as THREE from 'three';
import { runHarness } from './kit.js';
import { frameAt } from '../src/rig.js';
import { CUES, T } from '../src/script.js';
import { createSky } from '../src/sky.js';

const DEG = Math.PI / 180;
const turn = new THREE.Euler(0, 0, 0, 'YXZ');

// stand-in positions for the words (the real ones belong to lines.css)
const MOCK = {
  'l-greeting': { text: 'Hey Reina', cls: 'hero', y: 0.37 },
  'l-crazy': { text: 'wanna know something crazy?', cls: '', y: 0.47 },
  'l-people': { text: 'out of all the people on earth...', cls: '', y: 0.32 },
  'l-only': { text: "you're the only one for me <3", cls: '', y: 0.66 },
  'l-stars': { text: 'and out of all the stars in the night sky...', cls: '', y: 0.5 },
  'l-brightest': { text: 'you shine the brightest.', cls: 'gold', y: 0.57 },
  'l-birthday': { text: 'happy birthday to the best friend girlfriend ever.', cls: 'gold', y: 0.5 },
  'l-lucky': { text: "i'm truly lucky to have met the amazing, kind, thoughtful, beautiful, caring, funny, genuine, generous, loving, creative, wonderful person that you are.", cls: 'body', y: 0.5 },
  'l-many': { text: "i hope to spend many more birthdays with you (you're still going to outlive me though).", cls: 'body', y: 0.5 },
};

runHarness({
  setup({ stage, q }) {
    const sky = createSky(stage);

    // placeholder planet, for context only: a black disc that hides the sky
    const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true }));
    stage.scene.add(planet);

    let bake = null;
    if (q.has('bake')) {
      // ?bake=u0,u1,b0,b1 shows only that window (u as 0..1 of the width, b in degrees);
      // ?bake alone shows it all. u = 0..0.72 is galactic l = -32..108 deg.
      const win = (q.get('bake') || '0,1,-22.5,22.5').split(',').map(Number);
      bake = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: {
            tex: { value: sky._milkyWay },
            gain: { value: +(q.get('gain') || 0.6) },
            win: { value: new THREE.Vector4(win[0], win[1], (win[2] + 22.5) / 45, (win[3] + 22.5) / 45) },
          },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader:
            'uniform sampler2D tex; uniform float gain; uniform vec4 win; varying vec2 vUv; void main(){ vec2 u = vec2(mix(win.x, win.y, vUv.x), mix(win.z, win.w, 1.0 - vUv.y)); vec4 m = texture2D(tex, u); gl_FragColor = vec4(m.rgb * m.rgb * gain * 2.5, 1.0); }',
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      stage.overlay.scene.add(bake);
    }

    const words = [];
    if (q.has('words')) {
      for (const c of CUES) {
        const m = MOCK[c.id];
        if (!m) continue;
        const el = document.createElement('p');
        el.className = 'mock ' + m.cls;
        el.textContent = m.text;
        el.style.top = m.y * 100 + '%';
        document.body.appendChild(el);
        words.push({ c, el });
      }
    }
    return { sky, planet, bake, words, mood: q.get('mood') || 'show', rawrig: q.has('rawrig') };
  },

  frame({ t, dt, stage, sky, planet, bake, words, mood, rawrig }) {
    const F = frameAt(t, stage.size, stage.camera, { mood });
    const lk = t - T.dim[0];
    if (!rawrig && lk > 0 && F.sky.rotation.y === 0) {
      // the rig does not co-rotate yet: do it here (a copy, never the rig's own Euler)
      turn.copy(F.sky.rotation);
      turn.y = 0.35 * DEG * (lk - 0.3 * (1 - Math.exp(-lk / 0.3)));
      F.sky.rotation = turn;
    }
    sky.update(t, dt, F.sky);
    planet.visible = F.earthVisible;
    planet.material.opacity = F.earth.opacity;
    stage.grade.uFlash.value = F.grade.flash;
    stage.grade.uFade.value = F.grade.fade;
    stage.grade.uVignette.value = F.grade.vignette;
    if (bake) {
      const { w, h } = stage.size;
      bake.position.set(w / 2, h / 2, 0);
      bake.scale.set(w, h, 1);
      sky.object.visible = false;
    }
    for (const { c, el } of words) {
      const a = Math.min(1, Math.max(0, (t - c.at) / c.enterDur)) * (1 - Math.min(1, Math.max(0, (t - c.until) / c.exitDur)));
      el.style.opacity = a;
    }
  },
});
