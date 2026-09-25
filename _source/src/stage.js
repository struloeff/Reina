// The one WebGL canvas behind all the words.
//
// Two scenes share it:
//   scene   + camera          the 3D world: the sky at infinity, the Earth at the origin
//   overlay + overlay camera  screen space, in CSS pixels, origin top-left, y DOWN.
//                             (y-down flips triangle winding: overlay materials need
//                             side: THREE.DoubleSide)
//
// Both render into one HDR buffer (half float), then bloom, then tone mapping to
// sRGB (OutputPass), then a last grading pass in display space that owns the
// flash, the vignette, a whisper of grain against banding, and fade-to-black.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlash: { value: 0 },
    uFlashAt: { value: new THREE.Vector2(0.5, 0.5) }, // where the light comes from, uv (y up)
    uFlashColor: { value: new THREE.Color(1.0, 0.97, 0.9) },
    uFade: { value: 0 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.018 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uFlash, uFade, uVignette, uGrain, uTime;
    uniform vec3 uFlashColor;
    uniform vec2 uRes, uFlashAt;
    varying vec2 vUv;
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5;
      q.x *= uRes.x / uRes.y;
      col *= mix(1.0, smoothstep(1.05, 0.2, length(q)), uVignette);
      // screen blend, strongest at the source and a soft wash across the rest
      vec2 f = vUv - uFlashAt;
      f.x *= uRes.x / uRes.y;
      float k = uFlash * (0.05 + 0.95 * exp(-length(f) / 0.22));
      col = 1.0 - (1.0 - col) * (1.0 - uFlashColor * k);
      float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime * 7.13) * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export function createStage(canvas, { quality = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 5000);

  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000);

  // HDR (half float) buffers need a colour-buffer-float extension. Every current
  // phone has one; without it, fall back to 8-bit buffers (the bloom is a little
  // weaker, nothing else changes) rather than a black screen.
  const hdr = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const composer = hdr
    ? new EffectComposer(renderer)
    : new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType }));
  const worldPass = new RenderPass(scene, camera);
  const overlayPass = new RenderPass(overlayScene, overlayCamera);
  overlayPass.clear = false;
  overlayPass.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.6, 0.8);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(worldPass);
  composer.addPass(overlayPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  const maxDpr = quality === 'low' ? 1.5 : 2;
  const size = { w: 1, h: 1, dpr: 1 };
  let dprScale = 1;
  const listeners = [];

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, maxDpr) * dprScale);
    if (w === size.w && h === size.h && dpr === size.dpr) return;
    size.w = w;
    size.h = h;
    size.dpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    overlayCamera.left = 0;
    overlayCamera.right = w;
    overlayCamera.top = 0;
    overlayCamera.bottom = h;
    overlayCamera.updateProjectionMatrix();
    grade.uniforms.uRes.value.set(w * dpr, h * dpr);
    for (const fn of listeners) fn(size);
  }

  let resizeQueued = false;
  const queueResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      resize();
    });
  };
  window.addEventListener('resize', queueResize);
  window.visualViewport?.addEventListener('resize', queueResize);
  resize();

  return {
    THREE,
    renderer,
    scene,
    camera,
    overlay: { scene: overlayScene, camera: overlayCamera },
    composer,
    bloom,
    grade: grade.uniforms,
    size,
    quality,
    /** called with the size object whenever the canvas changes size */
    onResize(fn) {
      listeners.push(fn);
    },
    /** 1 = full resolution; lower to trade sharpness for frame rate */
    setDprScale(s) {
      dprScale = s;
      resize();
    },
    resize,
    render(t) {
      grade.uniforms.uTime.value = t;
      composer.render();
    },
  };
}
