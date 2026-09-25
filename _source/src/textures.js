// Loads the five Earth maps.
//
// From a web host they come from assets/earth/*.jpg. Opened as a file, browsers
// refuse to hand local images to WebGL, so the same pictures are read from
// assets/earth/textures.js as data: URIs instead. If the .jpg files fail on a
// host for any reason, the data: copy is the fallback there too.

const NAMES = ['day', 'night', 'clouds', 'water', 'relief'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

function loadAll(THREE, urls, renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return Promise.all(
    NAMES.map(
      (name) =>
        new Promise((resolve, reject) => {
          loader.load(
            urls[name],
            (tex) => {
              tex.colorSpace = name === 'day' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
              // the grey maps are read through .r only: one channel on the GPU
              // instead of four keeps the planet near 70 MB rather than 150
              if (name !== 'day') tex.format = THREE.RedFormat;
              tex.wrapS = THREE.RepeatWrapping;
              tex.wrapT = THREE.ClampToEdgeWrapping;
              tex.anisotropy = aniso;
              tex.minFilter = THREE.LinearMipmapLinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.generateMipmaps = true;
              tex.needsUpdate = true;
              resolve([name, tex]);
            },
            undefined,
            () => reject(new Error('texture ' + name)),
          );
        }),
    ),
  ).then((pairs) => Object.fromEntries(pairs));
}

/** @returns {Promise<{day, night, clouds, water, relief}>} THREE.Texture each; day is sRGB, the rest are data */
export async function loadEarthTextures(THREE, renderer, { base = 'assets/' } = {}) {
  const fromData = async () => {
    if (!window.__EARTH_TEXTURES) await loadScript(base + 'earth/textures.js');
    return loadAll(THREE, window.__EARTH_TEXTURES, renderer);
  };
  if (location.protocol === 'file:') return fromData();
  try {
    return await loadAll(THREE, Object.fromEntries(NAMES.map((n) => [n, `${base}earth/${n}.jpg`])), renderer);
  } catch {
    return fromData();
  }
}
