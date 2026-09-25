// The Earth: the planet, its air, the sun coming over its edge, and the pale
// blue dot it shrinks into.
//
// The planet is not a tessellated sphere. A shell a little larger than it is
// rasterised and every pixel intersects the true sphere analytically, so the
// silhouette is a perfect circle at any size with a 1-2 px anti-aliased edge,
// and it lands exactly on the rig's disc (the words behind the planet are
// masked by that same circle).
//
// The same pixel then marches its ray through a thin exponential atmosphere
// (Rayleigh + Mie single scattering, with an analytic Chapman optical depth
// toward the sun). The blue haze thickening to the limb, the warm light along
// the terminator, the gold arc over the limb at sunrise and the planet's shadow
// on its own air all come out of that one model instead of painted rims.
//
// Compositing is premultiplied: alpha is the planet's coverage, rgb is the air
// in front + the surface seen through it (+ the air behind the limb where the
// planet does not cover). Stars show through the air, never through the planet.
//
// The sun (with its starburst) and the pale blue dot are drawn in the overlay,
// in screen space, at the projected sun direction and planet centre.

import * as THREE from 'three';

const TAU = Math.PI * 2;
const SUN_ANG = 0.00465; // the sun's angular radius, radians

// The air, in Earth radii. Scale heights are about six times the real ones so
// the limb reads on a phone; the zenith optical depths (beta * h) stay close to
// the real sky's, so colours and reddening behave like the real thing.
// The air grows a little taller as the camera pulls back (during the lift,
// where nobody can see it change), so the whole globe gets a soft blue edge
// while the sunrise keeps its thin band.
const AIR = {
  hR: 0.0085, // Rayleigh scale height, close up
  hRFar: 0.012, // ...and seen as a whole globe
  hM: 0.0024, // haze (Mie) scale height
  betaR: [5.8, 13.5, 33.1], // per radius: zenith depth ~ (.05, .11, .28)
  betaM: 12,
  top: 8, // the shell ends 8 Rayleigh scale heights up, where the air is gone
};
const RIM = 0.17; // the warm terminator band on the globe's rim, at its peak

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

const SHELL_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const SHELL_FRAG = /* glsl */ `
  uniform vec3 uCam;
  uniform vec3 uSun;
  uniform mat3 uToEarth;
  uniform float uCloudOff;
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform sampler2D uWater;
  uniform sampler2D uRelief;
  uniform float uRa;
  uniform float uHR;
  uniform float uHM;
  uniform vec3 uBetaR;
  uniform float uBetaM;
  uniform float uSunE;
  uniform float uAirE;
  uniform float uAir;
  uniform float uLights;
  uniform float uLightsK;
  uniform float uGlint;
  uniform float uSheen;
  uniform float uBump;
  uniform float uCloudH;
  uniform float uNightAmb;
  uniform float uTwilight;
  uniform float uOpacity;
  uniform float uPx;
  uniform float uKnee;
  uniform float uShoulder;
  uniform float uRim;
  uniform vec3 uZen0;
  uniform vec3 uZenC;
  varying vec3 vWorld;

  #define STEPS 8
  const float PI = 3.14159265;
  const float TAU = 6.28318531;
  const float REAL = 6.0; // how much taller than the real air this one is

  // Optical depth from height h (radii) along a ray whose zenith cosine is mu,
  // out to space, for density exp(-h/H), in units of H. Chapman's function,
  // approximated: ~1/mu overhead, sqrt(pi x / 2) grazing. Below the horizon the
  // ray is mirrored through its lowest point, which also casts the planet's
  // (soft) shadow on its own air.
  float chapman(float h, float mu, float H) {
    float c = sqrt(1.5707963 * (1.0 + h) / H);
    float e = exp(-h / H);
    if (mu >= 0.0) return e * c / (c * mu + 1.0);
    float r0 = (1.0 + h) * sqrt(max(1.0 - mu * mu, 0.0));
    float c0 = sqrt(1.5707963 * r0 / H);
    return 2.0 * c0 * exp(min((1.0 - r0) / H, 40.0)) - e * c / (1.0 - c * mu);
  }

  vec3 skyDepth(float h, float mu) {
    return uBetaR * (uHR * chapman(h, mu, uHR)) + uBetaM * (uHM * chapman(h, mu, uHM));
  }

  float phaseR(float c) { return 0.0596831 * (1.0 + c * c); }
  float phaseHG(float c, float g) {
    float g2 = g * g;
    return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-5), 1.5);
  }

  // single scattering along o + d t for t in [ta, tb]; od carries the optical
  // depth (Rayleigh, Mie) from the camera and comes back extended to tb
  vec3 scatter(vec3 o, vec3 d, float ta, float tb, float pR, float pM, inout vec2 od) {
    vec3 sum = vec3(0.0);
    float ds = max(tb - ta, 0.0) / float(STEPS);
    for (int i = 0; i < STEPS; i++) {
      vec3 p = o + d * (ta + (float(i) + 0.5) * ds);
      float r = length(p);
      float h = max(r - 1.0, 0.0);
      vec2 rho = exp(-h / vec2(uHR, uHM));
      vec2 odHere = od + rho * (0.5 * ds);
      od += rho * ds;
      float mu = dot(p, uSun) / r;
      vec3 tau = uBetaR * (odHere.x + uHR * chapman(h, mu, uHR)) + uBetaM * (odHere.y + uHM * chapman(h, mu, uHM));
      // The shadow as a real (six times thinner) atmosphere would cast it: the
      // same point, scaled to real height, and how high its sun ray passes over
      // the ground, in real scale heights. Without this the tall air stays lit
      // far past the terminator and hazes the night side at sunrise. It must be
      // continuous across the terminator plane (mu = 0), or every march sample
      // that crosses it draws a hard, stepped line through the sunrise arc.
      float mn = min(mu, 0.0);
      float hs = ((1.0 + h / REAL) * sqrt(max(1.0 - mn * mn, 0.0)) - 1.0) * (REAL / uHR);
      sum += (uBetaR * (rho.x * pR) + uBetaM * (rho.y * pM)) * exp(-tau) * smoothstep(-1.6, 0.0, hs);
    }
    return sum * ds;
  }

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // value noise with a sin-free hash (stays random at texel-scale inputs in
  // the thousands, where fract(sin()) falls into patterns on phone GPUs)
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // sunlight at height h, relative to the sun overhead there (zen, from JS):
  // white by day, warming into gold and red over the last few degrees before
  // the terminator
  vec3 sunTint(float h, float mu, vec3 zen) {
    return exp(-0.6 * (skyDepth(h, max(mu, 0.0)) - zen));
  }

  vec3 surface(vec3 n, vec3 v, vec2 uv, vec2 dx, vec2 dy, float lat) {
    float mu = dot(n, uSun);
    vec3 east = normalize(vec3(n.z, 0.0, -n.x) + vec3(1e-5, 0.0, 0.0));
    vec3 north = cross(n, east);
    float cosLat = max(cos(lat), 0.12);

    vec3 day = textureGrad(uDay, uv, dx, dy).rgb;
    float water = textureGrad(uWater, uv, dx, dy).r;
    vec2 cuv = vec2(uv.x + uCloudOff, uv.y);
    float cloud = textureGrad(uClouds, cuv, dx, dy).r;
    float lights = textureGrad(uNight, uv, dx, dy).r;

    // relief: finite differences of the elevation map in the sphere's tangent
    // frame. It only shows where the light is low, near the terminator.
    vec2 st = max(vec2(1.0 / 2048.0, 1.0 / 1024.0), abs(dx) + abs(dy));
    float h0 = textureGrad(uRelief, uv, dx, dy).r;
    float hE = textureGrad(uRelief, uv + vec2(st.x, 0.0), dx, dy).r;
    float hN = textureGrad(uRelief, uv + vec2(0.0, st.y), dx, dy).r;
    vec3 grad = (hE - h0) / (st.x * TAU * cosLat) * east + (hN - h0) / (st.y * PI) * north;
    // from orbit relief only shows in low light; under a high sun it flattens
    // out. Up close the 2k map is magnified into soft clay bumps: fade it there.
    float texels = max(abs(dx.x) + abs(dy.x), 0.5 * (abs(dx.y) + abs(dy.y))) * 2048.0;
    float bump = uBump * mix(1.0, 0.3, smoothstep(0.15, 0.55, mu)) * mix(0.3, 1.0, smoothstep(0.15, 0.9, texels));
    vec3 nb = normalize(n - bump * grad);

    // cloud shadow: the cloud between this point and the sun
    vec3 lt = uSun - n * mu;
    vec2 so = vec2(dot(lt, east) / (TAU * cosLat), dot(lt, north) / PI) * (uCloudH / max(mu, 0.15));
    float shadow = textureGrad(uClouds, cuv + so, dx, dy).r;

    // Blue Marble is a little flat and its seas nearly black: a touch of
    // contrast on land, and seas that are deep blue rather than ink
    vec3 land = pow(day, vec3(1.08)) * 1.04;
    land = mix(vec3(luma(land)), land, 0.9);
    vec3 sea = day * vec3(0.9, 1.0, 1.0) + vec3(0.0009, 0.0034, 0.011);
    vec3 alb = mix(land, sea, water);

    // the terminator: soft over a couple of degrees (the sun's disc, refraction).
    // The ground takes only some of the sunset's colour (orange light on dark
    // land just reads as mud); the clouds take all of it.
    float dayK = smoothstep(-0.03, 0.035, mu);
    vec3 tint = sunTint(0.0, mu, uZen0);
    vec3 tintG = pow(tint, vec3(0.6));
    tintG *= luma(tint) / max(luma(tintG), 1e-3);
    vec3 sunG = uSunE * tintG * dayK;
    float lam = max(dot(nb, uSun), 0.0);
    vec3 ground = alb * sunG * lam * (1.0 - 0.5 * shadow);

    // the sea's glint: a silvery core (it just blooms) inside a broad sheen, as
    // wind-roughened water looks from orbit; brighter toward grazing (Fresnel)
    // (guarded: with the sun exactly behind this point the sum is zero, and a
    // NaN in the HDR buffer would bloom into a black square)
    vec3 hs = uSun + v;
    vec3 hv = hs * inversesqrt(max(dot(hs, hs), 1e-8));
    float nh = max(dot(n, hv), 0.0);
    float fr = 1.0 + 49.0 * pow(1.0 - max(dot(v, hv), 0.0), 5.0);
    float spec = fr * (uGlint * pow(nh, 520.0) + uSheen * (0.35 * pow(nh, 60.0) + 0.65 * pow(nh, 14.0)));
    // Fresnel runs to 50x at grazing: capped, and faded right at the limb, or
    // the glint turns into a second sun sliding along the edge during the lift
    spec = min(spec, 2.5) * smoothstep(0.03, 0.3, dot(n, v));
    ground += sunG * (spec * water * (1.0 - cloud) * smoothstep(0.0, 0.12, mu));

    // clouds are lit a little past the ground's terminator (they are higher)
    float muC = mu + 0.02;
    float lamC = pow(clamp((muC + 0.04) / 1.04, 0.0, 1.0), 0.85);
    vec3 cloudLit = vec3(0.93, 0.95, 0.98) * uSunE * sunTint(uCloudH, muC, uZenC) * smoothstep(-0.04, 0.03, muC) * lamC;
    vec3 col = mix(ground, cloudLit, cloud);

    // night: city lights (warm sodium, white-hot cores) fading in across dusk,
    // dimmed under cloud, and a whisper of moonlight so the dark side has form.
    // The map clips to white over the big cities, and up close (the horizon
    // magnifies it ~2.5x) Cairo and the Nile delta became one flat cream
    // plateau. Where it clips, a noise fixed to the ground (cells of a few
    // pixels) mottles it into knots of light, sodium-orange with white-hot
    // centres. Only where the map is magnified, so it cannot alias or shimmer.
    float night = 1.0 - smoothstep(-0.13, 0.02, mu);
    float mag = 1.0 - smoothstep(0.6, 1.2, texels * 2.0);
    // (two rotated lattices, so no grid shows through; one is faintly ridged
    // into the suggestion of lit arteries)
    vec2 q = uv * vec2(4096.0, 2048.0);
    float r1 = 1.0 - abs(2.0 * vnoise(mat2(0.8, -0.6, 0.6, 0.8) * q * 0.4) - 1.0);
    float g = 0.3 * r1 * r1 + 0.7 * vnoise(mat2(0.28, 0.96, -0.96, 0.28) * q * 0.55 + 17.0);
    float plateau = smoothstep(0.5, 0.97, lights) * mag;
    float L = lights * mix(1.0, min(0.45 + 0.8 * g, 1.04), plateau);
    float hot = smoothstep(0.35, 0.95, L) * mix(1.0, smoothstep(0.55, 0.82, g), plateau);
    vec3 cityCol = mix(vec3(1.0, 0.46, 0.14), vec3(1.0, 0.84, 0.6), hot);
    col += cityCol * (L * L * uLights * uLightsK) * night * (1.0 - 0.8 * cloud);
    col += (alb * 0.5 + cloud * 0.8) * vec3(0.55, 0.68, 1.0) * (uNightAmb * night);

    // twilight: a warm band just past the terminator where the sky still glows
    float tw = exp(-pow((mu + 0.035) / 0.06, 2.0));
    col += vec3(1.0, 0.48, 0.3) * (uTwilight * uSunE * tw) * (0.12 + 0.88 * cloud + 0.1 * alb.r);
    return col;
  }

  void main() {
    vec3 o = uCam;
    vec3 d = normalize(vWorld - uCam);
    float tc = -dot(o, d);
    vec3 pc = o + d * tc; // closest approach to the centre; stable at any distance
    float b2 = dot(pc, pc);
    float b = sqrt(b2);

    // how much of this pixel the planet covers: a 1.5 px ramp across the true
    // silhouette. The footprint comes from the camera (uPx), not fwidth: on the
    // shell's own edge-on triangles the derivatives are garbage.
    float cov = clamp((1.0 - b) / (1.5 * uPx) + 0.5, 0.0, 1.0);

    // where the ray meets the ground, or (beyond the silhouette) grazes it.
    // uv and its derivatives are taken here, in uniform control flow; the
    // seam at the date line picks whichever of two u's is continuous.
    float tg = tc - sqrt(max(1.0 - b2, 0.0));
    vec3 n = normalize(o + d * tg);
    vec3 nE = uToEarth * n;
    float lat = asin(clamp(nE.y, -1.0, 1.0));
    vec2 uv = vec2(atan(nE.x, nE.z) / TAU + 0.5, lat / PI + 0.5);
    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);
    float u2 = fract(uv.x + 0.5);
    float dx2 = dFdx(u2);
    float dy2 = dFdy(u2);
    if (abs(dx2) < abs(dx.x)) dx.x = dx2;
    if (abs(dy2) < abs(dy.x)) dy.x = dy2;

    float ra2 = uRa * uRa;
    if (b2 >= ra2) {
      gl_FragColor = vec4(0.0);
      return;
    }
    float ha = sqrt(ra2 - b2);
    float t0 = max(tc - ha, 0.0);
    float t1 = tc + ha;

    float cosT = dot(d, uSun);
    float pR = phaseR(cosT);
    float pM = mix(phaseHG(cosT, 0.72), phaseHG(cosT, 0.94), 0.35);
    float airE = uAirE * uAir;

    vec2 od = vec2(0.0);
    vec3 air = scatter(o, d, t0, tg, pR, pM, od);
    vec3 tv = exp(-(uBetaR * od.x + uBetaM * od.y));
    if (cov < 1.0) air += (1.0 - cov) * scatter(o, d, tg, t1, pR, pM, od);
    air *= airE;
    // Where the terminator meets the rim, the air glows with sunset light that
    // has crossed the whole limb. Single scattering leaves it too faint to read
    // on the globe, so a thin warm band is added there, hugging the limb: red
    // low down, where the light has crossed the most air, gold above it. Only
    // as a whole globe (uRim): at the sunrise the model's own arc is this light.
    if (uRim > 0.0) {
      float muL = dot(pc, uSun) / max(b, 1e-4);
      float alt = (b - 1.0) / uHR;
      float prof = exp(-max(alt, 0.0) / 1.5) * smoothstep(-2.2, 0.2, alt);
      float band = exp(-pow((muL + 0.035) / 0.1, 2.0));
      vec3 warm = mix(vec3(1.0, 0.36, 0.12), vec3(1.0, 0.62, 0.28), smoothstep(-0.5, 2.0, alt));
      air += warm * (uRim * uAir * band * prof);
    }
    // a soft shoulder: forward scattering at the limb runs to ~25x white,
    // which would bloom into a veil over half the screen. A log curve above the
    // knee keeps it intense and still brightest toward the sun (25 -> ~4.4,
    // 5 -> ~2.5), and keeps its hue.
    float peak = max(max(air.r, air.g), air.b);
    if (peak > uKnee) air *= (uKnee + uShoulder * log(1.0 + (peak - uKnee) / uShoulder)) / peak;
    vec3 col = air;
    if (cov > 0.0) col += cov * surface(n, -d, uv, dx, dy, lat) * mix(vec3(1.0), tv, uAir);
    gl_FragColor = vec4(col, cov) * uOpacity;
  }
`;

// screen-space quads in the overlay (CSS px, y down)
const OVERLAY_VERT = /* glsl */ `
  varying vec2 vPx;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPx = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// The sun over the limb: a white-hot disc (hidden behind the planet's edge
// until it clears it), a warm halo, and a sunstar of thin rays like a real lens
// stopped down. Rays and halo are in the lens, so they spill over the planet.
const SUN_FRAG = /* glsl */ `
  uniform vec2 uC;
  uniform vec3 uDisc;
  uniform float uR;
  uniform float uCore;
  uniform float uGlow;
  uniform vec3 uTint;
  uniform float uTime;
  uniform float uHalf;
  uniform float uHard;
  varying vec2 vPx;
  const float PI = 3.14159265;
  const float TAU = 6.28318531;
  float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
  void main() {
    vec2 q = vPx - uC;
    float r = length(q);
    float a = atan(q.y, q.x + 1e-4); // (atan(0, 0) is undefined)
    float outside = smoothstep(-0.7, 0.7, length(vPx - uDisc.xy) - uDisc.z);
    // a hard disc while it blooms; as it fades out it softens to a glow, or a
    // dim hard disc would read as a grey moon
    float core = mix(exp(-r * r / (0.8 * uR * uR)), smoothstep(uR + 0.7, uR - 0.7, r), uHard) * outside;

    float halo = 0.55 * exp(-r / (uR * 1.1)) + 0.1 * exp(-r / (uR * 3.5)) + 0.022 * exp(-r / (uR * 11.0));

    // six fine rays and six fainter, shorter ones between them, a little uneven
    // like a real aperture, breathing very slightly
    float rays = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float major = mod(fi, 2.0) < 0.5 ? 1.0 : 0.0;
      float ang = 0.3 + fi * (TAU / 12.0) + (hash(fi + 3.0) - 0.5) * 0.06;
      float da = abs(mod(a - ang + PI, TAU) - PI);
      float len = uR * mix(1.8, 4.8, major) * (0.75 + 0.5 * hash(fi)) * (1.0 + 0.05 * sin(uTime * 1.3 + fi * 2.1));
      float width = 0.45 + r * 0.004;
      rays += exp(-pow(da * r / width, 2.0)) * exp(-r / len) * mix(0.35, 1.0, major);
    }
    rays *= smoothstep(uR * 0.5, uR * 1.6, r);

    float fade = smoothstep(uHalf, uHalf * 0.6, r);
    vec3 warm = mix(uTint, vec3(1.0, 0.8, 0.56), 0.35);
    vec3 col = uTint * (core * uCore)
      + warm * (halo * uGlow)
      + mix(uTint, vec3(1.0, 0.92, 0.8), 0.5) * (rays * uGlow * 0.7);
    gl_FragColor = vec4(col * fade, 1.0);
  }
`;

// The pale blue dot: a soft point of light a few px across, never a speck
const DOT_FRAG = /* glsl */ `
  uniform vec2 uC;
  uniform float uS;
  uniform float uI;
  varying vec2 vPx;
  void main() {
    float r = length(vPx - uC);
    float g = exp(-r * r / (2.0 * uS * uS)) + 0.05 * exp(-r / (uS * 2.5));
    gl_FragColor = vec4(vec3(0.66, 0.8, 1.0) * (g * uI), 1.0);
  }
`;

function overlayQuad(frag, uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: OVERLAY_VERT,
    fragmentShader: frag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

// optical depth of a ray passing the planet at height h above the ground, the
// whole way through, for scale height H (units of H)
function grazing(h, H) {
  return 2 * Math.sqrt((Math.PI * (1 + h)) / (2 * H)) * Math.exp(-h / H);
}

// the air's optical depth straight up from height h (the shader's chapman at mu = 1)
function upDepth(h, H) {
  const c = Math.sqrt((1.5707963 * (1 + h)) / H);
  return (H * Math.exp(-h / H) * c) / (c + 1);
}
function zenithDepth(out, h, U) {
  const m = U.uBetaM.value * upDepth(h, U.uHM.value);
  const r = upDepth(h, U.uHR.value);
  const b = U.uBetaR.value;
  return out.set(b.x * r + m, b.y * r + m, b.z * r + m);
}

/**
 * createEarth(stage, tex) -> { object, update(t, dt, p) }  (+ uniforms, tuned, parts: for the harness only)
 * tex = { day, night, clouds, water, relief } (THREE.Texture)
 * p = { spin, cloudSpin, sunDir, opacity, lights, atmosphere, glare, dot, discR }
 * Reads stage.camera (already placed by the rig for this frame) and stage.size.
 */
export function createEarth(stage, tex) {
  const group = new THREE.Group();

  const U = {
    uCam: { value: new THREE.Vector3() },
    uSun: { value: new THREE.Vector3(0, 0, 1) },
    uToEarth: { value: new THREE.Matrix3() },
    uCloudOff: { value: 0 },
    uDay: { value: tex.day },
    uNight: { value: tex.night },
    uClouds: { value: tex.clouds },
    uWater: { value: tex.water },
    uRelief: { value: tex.relief },
    uRa: { value: 1 + AIR.top * AIR.hR },
    uHR: { value: AIR.hR },
    uHM: { value: AIR.hM },
    uBetaR: { value: new THREE.Vector3(...AIR.betaR) },
    uBetaM: { value: AIR.betaM },
    uSunE: { value: 0.8 }, // sunlight on a white surface, overhead: under the bloom threshold
    uAirE: { value: 2.6 }, // sunlight scattered by the air (about pi x the above, plus a little)
    uAir: { value: 1 },
    uLights: { value: 0.62 },
    uLightsK: { value: 1 },
    uGlint: { value: 1.2 }, // the glint's core, x sunlight (just blooms)
    uSheen: { value: 0.2 }, // the broad silvery sheen around it
    uBump: { value: 0.03 },
    uCloudH: { value: 0.004 },
    uNightAmb: { value: 0.006 },
    uTwilight: { value: 0.035 },
    uOpacity: { value: 1 },
    uPx: { value: 0.001 },
    uKnee: { value: 0.7 }, // the air's radiance is compressed above this,
    uShoulder: { value: 1.2 }, // logarithmically, with this scale
    uRim: { value: 0 }, // the warm band where the terminator meets the rim (set per frame)
    uZen0: { value: new THREE.Vector3() }, // the air's optical depth straight up, from the ground
    uZenC: { value: new THREE.Vector3() }, // ...and from the cloud tops
  };

  const shellMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  // the silhouette is analytic, so the shell only has to contain the air
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), shellMat);
  group.add(shell);
  stage.scene.add(group);

  const sunU = {
    uC: { value: new THREE.Vector2() },
    uDisc: { value: new THREE.Vector3() },
    uR: { value: 8 },
    uCore: { value: 0 },
    uGlow: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uTime: { value: 0 },
    uHalf: { value: 300 },
    uHard: { value: 1 },
  };
  const sun = overlayQuad(SUN_FRAG, sunU);
  const dotU = { uC: { value: new THREE.Vector2() }, uS: { value: 1.5 }, uI: { value: 0 } };
  const dot = overlayQuad(DOT_FRAG, dotU);
  stage.overlay.scene.add(sun, dot);

  const v = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const tuned = new Set(); // uniforms the harness pinned by hand; update() leaves them alone

  function update(t, dt, p) {
    const cam = stage.camera;
    const size = stage.size;

    group.rotation.y = p.spin;
    group.updateMatrixWorld();
    U.uToEarth.value.setFromMatrix4(group.matrixWorld).invert();
    U.uCloudOff.value = (p.spin - p.cloudSpin) / TAU;
    U.uCam.value.copy(cam.position);
    U.uSun.value.copy(p.sunDir).normalize();
    U.uAir.value = p.atmosphere;
    U.uLightsK.value = p.lights;
    const distC = cam.position.length();
    const far = smoothstep(2.6, 6, distC);
    if (!tuned.has('uHR')) U.uHR.value = AIR.hR + (AIR.hRFar - AIR.hR) * far;
    U.uRim.value = RIM * far;
    U.uRa.value = 1 + AIR.top * U.uHR.value;
    shell.scale.setScalar(U.uRa.value);
    zenithDepth(U.uZen0.value, 0, U);
    zenithDepth(U.uZenC.value, U.uCloudH.value, U);

    // one device pixel, in units of the ray's miss distance, at the limb:
    // b = dist sin(theta), and theta changes by cos^2(theta) / f per pixel
    const fDev = (size.h * size.dpr) / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const cosL = Math.sqrt(Math.max(0, 1 - 1 / (distC * distC)));
    U.uPx.value = (distC * cosL * cosL * cosL) / fDev;

    // the planet's centre on screen
    v.set(0, 0, 0).project(cam);
    const cx = (v.x * 0.5 + 0.5) * size.w;
    const cy = (0.5 - v.y * 0.5) * size.h;

    // Before it rises the planet waits just below the frame, close enough for
    // the top of its air to show as a faint line along the bottom edge. Keep it
    // dark until the disc itself is within ~4% of the edge.
    const waiting = smoothstep(size.h * 1.035, size.h * 1.0, cy - p.discR);

    // the sphere hands over to the dot as it shrinks to a few px
    const planet = p.opacity * (1 - p.dot) * waiting;
    U.uOpacity.value = planet;
    shell.visible = planet > 0.002;

    // --- the sun, when it is in front of the camera and allowed
    const sunDir = U.uSun.value;
    const dist = distC;
    cam.getWorldDirection(fwd);
    const glare = p.glare * p.opacity;
    const facing = fwd.dot(sunDir);
    if (glare > 0.001 && facing > 0.3) {
      // angle between the sun and the planet's centre, seen from the camera,
      // against the planet's angular radius: how far over the limb the sun is
      const cosSep = -cam.position.dot(sunDir) / dist;
      const sep = Math.acos(Math.max(-1, Math.min(1, cosSep)));
      const earthAng = Math.asin(Math.min(1, 1 / dist));
      const over = (sep - earthAng) / SUN_ANG; // in sun radii
      const vis = smoothstep(-1, 1, over);
      // reddened and dimmed while it is still low in the air along the limb
      const h = Math.max(0, dist * Math.sin(sep) - 1);
      const gR = grazing(h, U.uHR.value) * U.uHR.value;
      const gM = grazing(h, U.uHM.value) * U.uHM.value * U.uBetaM.value;
      const bR = U.uBetaR.value;
      const tr = Math.exp(-(bR.x * gR + gM));
      const tg = Math.exp(-(bR.y * gR + gM));
      const tb = Math.exp(-(bR.z * gR + gM));
      const lum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;

      v.copy(cam.position).addScaledVector(sunDir, 50).project(cam);
      const sx = (v.x * 0.5 + 0.5) * size.w;
      const sy = (0.5 - v.y * 0.5) * size.h;
      const f = size.h / 2 / Math.tan((cam.fov * Math.PI) / 360);
      const cos2 = Math.cos(sep) ** 2;
      // drawn a little smaller than true: the bloom gives it back its size
      const rPx = (0.7 * SUN_ANG * f) / Math.max(cos2, 0.1);

      // When the lift begins the sun swings round fast (it has to end up at
      // the upper left, in front) and would streak up through the words. It
      // belongs to the horizon: once it is more than ~7% of the screen clear of
      // the limb it fades where it is, before it has moved far.
      const edge = Math.hypot(sx - cx, sy - cy) - p.discR;
      const keep = smoothstep(size.h * 0.12, size.h * 0.07, edge);

      const half = Math.min(260, Math.max(120, rPx * 22));
      sun.position.set(sx, sy, 0);
      sun.scale.set(half * 2, half * 2, 1);
      sunU.uC.value.set(sx, sy);
      sunU.uDisc.value.set(cx, cy, p.discR);
      sunU.uR.value = rPx;
      sunU.uHalf.value = half;
      sunU.uTint.value.set(tr, tg, tb).divideScalar(Math.max(lum, 1e-3));
      sunU.uCore.value = 5 * glare * keep * keep * lum;
      sunU.uHard.value = smoothstep(0.7, 2.0, sunU.uCore.value);
      sunU.uGlow.value = 1.0 * glare * keep * vis * Math.pow(lum, 0.7);
      sunU.uTime.value = t;
      sun.visible = sunU.uCore.value * vis > 0.002 || sunU.uGlow.value > 0.002;
    } else {
      sun.visible = false;
    }

    // --- the pale blue dot
    const di = p.dot * p.opacity;
    dot.visible = di > 0.002;
    if (dot.visible) {
      // no wider than the lit crescent it replaces, so the flux keeps falling
      // through the hand-over instead of puffing up into a hazy ball
      const s = Math.max(1.1, p.discR * 0.4);
      // centred on the gibbous's light, which sits toward the sun, not on the
      // disc's centre, so the light does not slide sideways as it hands over
      v.copy(U.uSun.value).transformDirection(cam.matrixWorldInverse);
      const ox = cx + v.x * 0.35 * p.discR;
      const oy = cy - v.y * 0.35 * p.discR;
      dot.position.set(ox, oy, 0);
      dot.scale.set(s * 16, s * 16, 1);
      dotU.uC.value.set(ox, oy);
      dotU.uS.value = s;
      dotU.uI.value = 1.05 * di;
    }
  }

  // uniforms and parts are for the harness (tuning, toggling); the show only needs update
  return { object: group, update, uniforms: U, tuned, parts: { shell, sun, dot, sunUniforms: sunU } };
}
