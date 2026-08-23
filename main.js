import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================================
// Noise primitives (deterministic per seed, so terrain is infinite & stable)
// ============================================================================

function hash3(ix, iy, iz, seed) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) | 0;
  return (h >>> 0) / 4294967296;
}

const sstep = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function valueNoise3(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const tx = sstep(x - x0), ty = sstep(y - y0), tz = sstep(z - z0);
  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x0 + 1, y0, z0, seed);
  const c010 = hash3(x0, y0 + 1, z0, seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const c001 = hash3(x0, y0, z0 + 1, seed);
  const c101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  return lerp(
    lerp(lerp(c000, c100, tx), lerp(c010, c110, tx), ty),
    lerp(lerp(c001, c101, tx), lerp(c011, c111, tx), ty),
    tz
  );
}

function valueNoise2(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = sstep(x - x0), tz = sstep(z - z0);
  const a = hash3(x0, 0, z0, seed);
  const b = hash3(x0 + 1, 0, z0, seed);
  const c = hash3(x0, 0, z0 + 1, seed);
  const d = hash3(x0 + 1, 0, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function fbm2(x, z, seed, octaves) {
  let val = 0, amp = 0.5, freq = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    val += valueNoise2(x * freq, z * freq, seed + i * 1013) * amp;
    sum += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / sum;
}

function fbm3(x, y, z, seed, octaves) {
  let val = 0, amp = 0.5, freq = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    val += valueNoise3(x * freq, y * freq, z * freq, seed + i * 1013) * amp;
    sum += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / sum;
}

function ridgedNoise2(x, z, seed) {
  let val = 0, amp = 0.5, freq = 1, sum = 0;
  for (let i = 0; i < 4; i++) {
    const n = valueNoise2(x * freq, z * freq, seed + i * 37);
    const r = 1 - Math.abs(2 * n - 1);
    val += r * r * amp;
    sum += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / sum;
}

// ============================================================================
// World config
// ============================================================================

const IS_MOBILE =
  (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
  window.innerWidth < 700;

const CHUNK = 16;                                  // columns per chunk (x & z)
let RENDER_RADIUS = IS_MOBILE ? 26 : 36;           // chunks loaded around the camera
let NEAR_RADIUS = IS_MOBILE ? 3 : 4;               // full-detail ring (caves + shadows)
const SEA_LEVEL = 24;
const MAX_HEIGHT = 96;

let SEED = Math.floor(Math.random() * 1e9);

// Terrain elevation in blocks (y). Deterministic for every world column.
function terrainHeight(x, z, seed) {
  const continent = fbm2(x * 0.005, z * 0.005, seed, 4);
  const hills = fbm2(x * 0.03, z * 0.03, seed + 999, 4);
  const mtnMask = fbm2(x * 0.008, z * 0.008, seed + 555, 3);
  const ridge = ridgedNoise2(x * 0.009, z * 0.009, seed + 777);
  const peaks = ridgedNoise2(x * 0.02, z * 0.02, seed + 313);

  let e = (continent - 0.5) * 2.0;       // -1..1  (ocean < 0 < land)
  e += (hills - 0.5) * 0.35;             // gentle hills
  const m = Math.max(0, (mtnMask - 0.46) / 0.54);
  e += Math.pow(m, 1.4) * ridge * 3.4 + m * peaks * 0.9; // mountain ranges

  return Math.max(1, Math.min(MAX_HEIGHT, Math.round(SEA_LEVEL + e * 22)));
}

// Cave system: rare, thin winding tunnels + occasional chambers, mostly in rocky
// highlands (no caves under oceans/beaches). Tunnels grow more common with depth.
function isCave(x, y, z, surfY, seed) {
  if (y > surfY) return false;
  if (surfY <= SEA_LEVEL + 1) return false;

  const n =
    valueNoise3(x * 0.05, y * 0.10, z * 0.05, seed + 111) * 0.75 +
    valueNoise3(x * 0.13, y * 0.22, z * 0.13, seed + 222) * 0.25;
  const tube = Math.abs(n - 0.5);
  const depth = surfY - y;

  if (y === surfY) return tube < 0.008;

  const thresh = depth < 2 ? 0.014 : depth < 4 ? 0.022 : 0.030;
  if (tube < thresh) return true;

  if (depth >= 6) {
    const chamber = fbm3(x * 0.07, y * 0.07, z * 0.07, seed + 333, 2);
    if (chamber < 0.16) return true;
  }
  return false;
}

// Biome-aware colour for a single voxel (THREE-free so it can run in a worker).
function colorFor(wx, y, wz, surfY, seed) {
  let r, g, b;
  const depth = surfY - y;

  if (depth >= 3) { r = 0x6e; g = 0x6e; b = 0x66;       // deep stone
  } else if (depth >= 1) { r = 0x8a; g = 0x6b; b = 0x46;// dirt
  } else if (surfY <= SEA_LEVEL) { r = 0xb5; g = 0x9a; b = 0x63;   // ocean floor
  } else if (surfY <= SEA_LEVEL + 1) { r = 0xd7; g = 0xc9; b = 0x8a; // beach
  } else if (surfY > 58) { r = 0xee; g = 0xf2; b = 0xf5;// snow peaks
  } else if (surfY > 44) { r = 0x9a; g = 0x9a; b = 0xa0;// rock
  } else {
    const moist = fbm2(wx * 0.01, wz * 0.01, seed + 333, 2);
    if (moist > 0.58) { r = 0x2f; g = 0x7a; b = 0x3f;   // lush forest
    } else if (moist < 0.34) { r = 0xb0; g = 0xa0; b = 0x6a; // dry grassland
    } else { r = 0x4d; g = 0x8f; b = 0x4a; }            // grass
  }

  const j = (hash3(wx, y, wz, seed + 444) - 0.5) * 0.08;
  const k = 1 + j;
  return [r / 255 * k, g / 255 * k, b / 255 * k];
}

// Flat clearing around the home campfire (set by buildBeacon, sent to workers)
let HOME_FLAT = null;

function homeFlatten(wx, wz, h) {
  if (!HOME_FLAT) return h;
  const dx = wx - HOME_FLAT.x, dz = wz - HOME_FLAT.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= 3.4) return h;
  const t = sstep(Math.min(1, Math.max(0, (d - 1.4) / 2)));
  return Math.round(lerp(HOME_FLAT.y, h, t));
}

// ============================================================================
// Chunk data builder (shared by workers and the main-thread fallback)
// Emits only faces adjacent to air -> a few hundred tris per chunk instead of
// thousands of full cubes.
// lod 0 = near: caves carved, full detail. lod 1 = far: solid shell only.
// ============================================================================

const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

function buildChunkData(cx, cz, seed, lod) {
  const startX = cx * CHUNK, startZ = cz * CHUNK;
  const W = CHUNK + 2;

  const surf = new Int16Array(W * W);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < W; j++) {
      const wx = startX + i - 1, wz = startZ + j - 1;
      surf[i * W + j] = homeFlatten(wx, wz, terrainHeight(wx, wz, seed));
    }
  }
  const surfAt = (wx, wz) => surf[(wx - startX + 1) * W + (wz - startZ + 1)];

  const caveCache = lod === 0 ? new Map() : null;
  const caveAt = (wx, wy, wz) => {
    const key = wx + ',' + wy + ',' + wz;
    let v = caveCache.get(key);
    if (v === undefined) {
      const s = surfAt(wx, wz);
      v = wy <= s && isCave(wx, wy, wz, s, seed);
      caveCache.set(key, v);
    }
    return v;
  };
  const solidAt = (wx, wy, wz) => {
    if (wy < 1) return true;
    const s = surfAt(wx, wz);
    if (wy > s) return false;
    return caveCache ? !caveAt(wx, wy, wz) : true;
  };

  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let vc = 0;

  for (let lx = 0; lx < CHUNK; lx++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      const wx = startX + lx, wz = startZ + lz;
      const s = surfAt(wx, wz);
      for (let wy = 1; wy <= s; wy++) {
        if (caveCache && caveAt(wx, wy, wz)) continue;
        const col = colorFor(wx, wy, wz, s, seed);
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          if (solidAt(wx + face.n[0], wy + face.n[1], wz + face.n[2])) continue;
          for (let k = 0; k < 4; k++) {
            positions.push(wx + face.v[k][0], wy + face.v[k][1], wz + face.v[k][2]);
          }
          for (let k = 0; k < 4; k++) normals.push(face.n[0], face.n[1], face.n[2]);
          for (let k = 0; k < 4; k++) colors.push(col[0], col[1], col[2]);
          indices.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
          vc += 4;
        }
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
  };
}

// ============================================================================
// Worker pool (chunk generation off the main thread = no frame hitches)
// ============================================================================

const WORKER_SRC = [
  'const CHUNK=' + CHUNK + ',SEA_LEVEL=' + SEA_LEVEL + ',MAX_HEIGHT=' + MAX_HEIGHT + ';',
  'var HOME_FLAT=null;',
  hash3.toString(),
  'const sstep=' + sstep.toString() + ';',
  'const lerp=' + lerp.toString() + ';',
  valueNoise3.toString(),
  valueNoise2.toString(),
  fbm2.toString(),
  fbm3.toString(),
  ridgedNoise2.toString(),
  terrainHeight.toString(),
  isCave.toString(),
  colorFor.toString(),
  homeFlatten.toString(),
  'const FACES=' + JSON.stringify(FACES) + ';',
  buildChunkData.toString(),
  'self.onmessage = function (e) {' +
    'var d = e.data;' +
    'HOME_FLAT = d.home || null;' +
    'var r = buildChunkData(d.cx, d.cz, d.seed, d.lod);' +
    'self.postMessage({' +
      'cx: d.cx, cz: d.cz, lod: d.lod, seed: d.seed,' +
      'positions: r.positions, normals: r.normals,' +
      'colors: r.colors, indices: r.indices' +
    '}, [r.positions.buffer, r.normals.buffer, r.colors.buffer, r.indices.buffer]);' +
  '};',
].join('\n');

const NUM_WORKERS = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1));
const workers = [];
const busy = new Set();
let dbgDispatched = 0, dbgReceived = 0;

try {
  const blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = new Worker(url);
    w.onmessage = (e) => {
      busy.delete(w);
      dbgReceived++;
      const d = e.data;
      applyQueue.push({ cx: d.cx, cz: d.cz, lod: d.lod, seed: d.seed, data: d });
    };
    workers.push(w);
  }
} catch (err) {
  workers.length = 0;
}

// ============================================================================
// Renderer / scene / camera
// ============================================================================

const renderer = new THREE.WebGLRenderer({
  antialias: !IS_MOBILE,
  preserveDrawingBuffer: true, // lets the character panel copy the live view
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 1.25));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb7d9);

let VIEW_DIST = RENDER_RADIUS * CHUNK;
scene.fog = new THREE.Fog(0x8fb7d9, VIEW_DIST * 0.9, VIEW_DIST * 2.6); // soft distance haze

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.35,
  3000
);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, SEA_LEVEL, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 5;
controls.maxDistance = Infinity;
controls.enableZoom = true;
controls.enablePan = false;
controls.minPolarAngle = 0.0;
controls.maxPolarAngle = Math.PI / 2;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.4;
camera.position.set(0, 70, 55);
controls.update();

// --- cinematic zoom: exponential dolly smoothing ---------------------------
// Wheel notches and pinches no longer jump the camera; they glide toward a
// target distance every frame (Google-Earth-style inertia). Works seamlessly
// from nose-to-ground up to deep space.
let desiredDist = camera.position.distanceTo(controls.target);
let lastPinchDist = 0;
const ZOOM_MIN = 6, ZOOM_MAX = 6000;
function clampZoom(d) { return THREE.MathUtils.clamp(d, ZOOM_MIN, ZOOM_MAX); }
controls.enableZoom = false; // radial distance is fully managed below
const pinchPts = new Map();
// touches resting on the virtual joystick must never count as canvas input
function inJoystickZone(x, y) {
  const r = joyBase.getBoundingClientRect();
  const pad = 20;
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  desiredDist = clampZoom(desiredDist * Math.exp(dy * 0.0011));
}, { passive: false });
renderer.domElement.addEventListener('touchstart', (e) => {
  if (boxSelectOn) return; // marquee owns the touch while armed
  for (const t of e.changedTouches) {
    if (!inJoystickZone(t.clientX, t.clientY)) {
      pinchPts.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }
}, { passive: true });
renderer.domElement.addEventListener('touchmove', (e) => {
  if (pinchPts.size < 2) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    const p = pinchPts.get(t.identifier);
    if (p) { p.x = t.clientX; p.y = t.clientY; }
  }
  if (pinchPts.size === 2) {
    const [a, b] = [...pinchPts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (lastPinchDist > 0 && d > 1) {
      desiredDist = clampZoom(desiredDist * (lastPinchDist / d));
    }
    lastPinchDist = d;
  }
}, { passive: false });
function endPinch(e) {
  for (const t of e.changedTouches) pinchPts.delete(t.identifier);
  if (pinchPts.size < 2) lastPinchDist = 0;
}
renderer.domElement.addEventListener('touchend', endPinch);
renderer.domElement.addEventListener('touchcancel', endPinch);
function snapZoom() {
  desiredDist = clampZoom(camera.position.distanceTo(controls.target));
}

// ============================================================================
// Lights
// ============================================================================

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a3340, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(60, 120, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 500;
sun.shadow.camera.left = -130;
sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130;
sun.shadow.camera.bottom = -130;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun);
scene.add(sun.target);
const amb = new THREE.AmbientLight(0x404060, 0.5);
scene.add(amb);

const headLight = new THREE.PointLight(0xfff2cc, 2.5, 90, 0.6);
scene.add(headLight);

// ============================================================================
// Water
// ============================================================================

const waterMat = new THREE.MeshStandardMaterial({
  color: 0x2a6f9e,
  transparent: true,
  opacity: 0.75,
  roughness: 0.25,
  metalness: 0.1,
  depthWrite: false, // no blend-order flicker against the shoreline
});
// gentle swell so the waterline shimmers as motion, not aliasing stutter
waterMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = { value: 0 };
  sh.vertexShader =
    'uniform float uTime;\n' +
    sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.z += sin(position.x * 0.045 + uTime * 1.6) * 0.09
                      + cos(position.y * 0.037 - uTime * 1.1) * 0.07;`
    );
  waterMat.userData.shader = sh;
};
const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = SEA_LEVEL + 0.35;
scene.add(water);

// fullscreen tint + drifting light rays shown while the camera is underwater
const underwaterOverlay = document.createElement('div');
underwaterOverlay.id = 'underwater-overlay';
underwaterOverlay.setAttribute('aria-hidden', 'true');
document.body.appendChild(underwaterOverlay);
const UNDERWATER_FOG = new THREE.Color(0x0b3a6e);
const UNDERWATER_BG = new THREE.Color(0x072a52);
let underwater = false;

// ============================================================================
// Clouds
// ============================================================================

function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const cloudGroup = new THREE.Group();
const clouds = [];
const cloudTex = makeCloudTexture();
const CLOUD_RANGE = 900;
const CLOUD_WIND = new THREE.Vector3(2.5, 0, 1.2);

for (let i = 0; i < 45; i++) {
  const size = 50 + Math.random() * 120;
  const baseOp = 0.45 + Math.random() * 0.35;
  const mat = new THREE.SpriteMaterial({
    map: cloudTex,
    transparent: true,
    opacity: baseOp,
    depthWrite: false,
  });
  mat.userData.baseOp = baseOp;
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size * 0.5, 1);
  s.position.set(
    (Math.random() - 0.5) * CLOUD_RANGE * 2,
    135 + Math.random() * 45,
    (Math.random() - 0.5) * CLOUD_RANGE * 2
  );
  cloudGroup.add(s);
  clouds.push(s);
}
scene.add(cloudGroup);

// ============================================================================
// World time & celestial bodies
// ============================================================================

const worldEpoch = new Date(2026, 7, 20, 8, 0, 0);
let gameMs = worldEpoch.getTime();
let timeSpeed = 1;
let timePaused = false;

// Pre-clock timekeeping: days since the world began, named by the sun's path
const epochDay = Math.floor(worldEpoch.getTime() / 86400000);
function phaseName(h) {
  if (h >= 5 && h < 7) return 'Dawn';
  if (h < 11) return 'Morning';
  if (h < 14) return 'Midday';
  if (h < 17) return 'Afternoon';
  if (h < 19.5) return 'Dusk';
  return 'Night';
}

// ============================================================================
// Seasons, temperature & weather
// ============================================================================

const SEASON_DAYS = 91.25; // game days per season — 4 equal seasons = a 365-day year, like real life
const SEASONS = [
  { name: 'Spring', icon: '\u{1F338}', tempBase: 14, skyTint: new THREE.Color(0xbfe0c8), tintK: 0.16, fogMul: 1.0, lightMul: 1.0 },
  { name: 'Summer', icon: '\u2600\uFE0F', tempBase: 29, skyTint: new THREE.Color(0xffd9a0), tintK: 0.10, fogMul: 1.06, lightMul: 1.05 },
  { name: 'Autumn', icon: '\u{1F342}', tempBase: 12, skyTint: new THREE.Color(0xd9a86c), tintK: 0.20, fogMul: 0.85, lightMul: 0.92 },
  { name: 'Winter', icon: '\u2744\uFE0F', tempBase: -6, skyTint: new THREE.Color(0xcfe0f2), tintK: 0.28, fogMul: 0.62, lightMul: 0.80 },
];
// Continuous season blend: last ~28% of each season eases into the next
function seasonInfo() {
  const f =
    (gameMs - worldEpoch.getTime()) / 86400000 / SEASON_DAYS + 1.55; // world starts mid-Summer
  const fi = Math.floor(f);
  const i = ((fi % 4) + 4) % 4;
  const w = THREE.MathUtils.smoothstep(f - fi, 0.72, 1);
  return { i, next: (i + 1) % 4, w };
}

const WEATHERS = {
  clear: { label: 'Clear skies', icon: '\u{1F319}', tempDelta: 0, wind: 1.0, dim: 1.0, fogMul: 1.0, thick: 1.0, stars: 1.0, weights: [46, 40, 40, 30] },
  rain: { label: 'Rain', icon: '\u{1F327}', tempDelta: -3, wind: 1.7, dim: 0.82, fogMul: 0.74, thick: 1.75, stars: 0.15, weights: [30, 8, 28, 0] },
  storm: { label: 'Storm', icon: '\u26A1', tempDelta: -5, wind: 3.4, dim: 0.55, fogMul: 0.56, thick: 2.1, stars: 0.0, weights: [10, 12, 12, 6] },
  snow: { label: 'Snowfall', icon: '\u2744', tempDelta: 0, wind: 1.2, dim: 0.9, fogMul: 0.6, thick: 1.8, stars: 0.1, weights: [0, 0, 0, 38] },
  dust: { label: 'Dust storm', icon: '\u{1F32A}', tempDelta: 7, wind: 4.2, dim: 0.84, fogMul: 0.44, thick: 0.5, stars: 0.1, weights: [0, 20, 7, 0] },
};
const WEATHER_ALERT_LEAD = 20 * 60000; // warn 20 in-game minutes ahead

const weather = { cur: 'clear', endAt: Infinity };
let nextWeather = null;
let curSeasonIdx = -1;
// zoomed-out tree markers must track the exact seasonal art the in-world
// trees show; the icon atlas is rebuilt whenever the season (or its blend
// weight, quantised) changes
let lastIconSeasonKey = '';

function pickWeatherType(si) {
  const entries = Object.entries(WEATHERS);
  let total = 0;
  for (const [, def] of entries) total += def.weights[si];
  let r = Math.random() * total;
  for (const [type, def] of entries) {
    r -= def.weights[si];
    if (r <= 0) return type;
  }
  return 'clear';
}

function scheduleNextWeather() {
  const inMs = (2 + Math.random() * 6) * 3600000; // next event in 2-8 game hours
  nextWeather = {
    type: pickWeatherType(seasonInfo().i),
    startAt: gameMs + inMs,
    alerted: false,
  };
}
scheduleNextWeather();

// Damped environment state (smoothed every frame toward targets)
let envDim = 1, envFogMul = 1, envWind = 1, cloudThick = 1, starVis = 0;
let tempNow = 20, lastTempStr = '', lastPillSeason = -1;
let lightningAt = 0, flashStart = -9;
let tNow = 0; // animation clock mirrored for event helpers
let animT = 0; // world-speed-scaled animation clock
// ground cover / hydrology state (0..1 scales, floodK up to ~2.2)
let snowDepth = 0, droughtK = 0, floodK = 0;
// prevailing wind: wanders slowly, drives trees + particle drift
let windAng = 0.7, windDirX = Math.cos(windAng), windDirZ = Math.sin(windAng);

function updateEnvDynamics(dt) {
  const w = weather.cur;
  // snow blanket builds while it snows, melts above freezing
  if (w === 'snow') snowDepth += dt * 0.02;
  if (tempNow > 1) {
    const melt = dt * 0.015 * (tempNow / 10 + 0.3);
    snowDepth = Math.max(0, snowDepth - melt);
    if (snowDepth > 0.02) floodK += melt * 0.7; // meltwater feeds rivers
  }
  // heat waves parch the land; rain and cold recover it
  if (tempNow > 26 && (w === 'clear' || w === 'dust')) droughtK += dt * 0.02;
  else if (w === 'rain' || w === 'storm') droughtK = Math.max(0, droughtK - dt * 0.1);
  else if (tempNow < 20) droughtK = Math.max(0, droughtK - dt * 0.03);
  // rising water: downpour floods, dry spells recede
  if (w === 'rain') floodK += dt * 0.004;
  else if (w === 'storm') floodK += dt * 0.007;
  else if (w === 'clear' || w === 'dust') floodK -= dt * 0.002;
  snowDepth = Math.min(1, Math.max(0, snowDepth));
  droughtK = Math.min(1, Math.max(0, droughtK));
  floodK = Math.min(2.2, Math.max(0, floodK));
}
const tmpSeasonColor = new THREE.Color();
let FOG_BASE_NEAR = VIEW_DIST * 0.9; // soft haze only far out
let FOG_BASE_FAR = VIEW_DIST * 2.6;

// live render-distance control: recompute derived ranges + restream chunks
function setRenderRadius(n) {
  RENDER_RADIUS = Math.max(10, Math.min(64, n | 0));
  VIEW_DIST = RENDER_RADIUS * CHUNK;
  FOG_BASE_NEAR = VIEW_DIST * 0.9;
  FOG_BASE_FAR = VIEW_DIST * 2.6;
  const sh = chunkMat.userData.shader;
  if (sh) {
    sh.uniforms.uShadeNear.value = VIEW_DIST * 0.9;
    sh.uniforms.uShadeFar.value = VIEW_DIST * 3.2;
  }
  treeMat.uniforms.uShadeNear.value = VIEW_DIST * 0.9;
  treeMat.uniforms.uShadeFar.value = VIEW_DIST * 3.2;
  syncChunks(true);
}

// FPS governor: if a device can't hold ~25fps at the ambitious radius,
// step down gradually (never below 14) instead of stuttering
let fpsAcc = 0, fpsN = 0, fpsCooldown = 10;
function governRenderRadius(dt) {
  fpsCooldown -= dt;
  if (fpsCooldown > 0) {
    fpsAcc += dt;
    fpsN++;
    return;
  }
  const avg = fpsAcc / Math.max(1, fpsN);
  fpsAcc = 0;
  fpsN = 0;
  fpsCooldown = 8;
  if (avg > 1 / 24 && RENDER_RADIUS > 26) setRenderRadius(RENDER_RADIUS - 2);
}

// Environment UI refs + toasts
const seasonIconEl = document.getElementById('season-icon');
const seasonLabelEl = document.getElementById('season-label');
const tempLabelEl = document.getElementById('temp-label');
const envPill = document.getElementById('envpill');
const toastsEl = document.getElementById('toasts');
const flashEl = document.getElementById('flash');
const cloudFadeEl = document.getElementById('cloudfade');

function toast(msg, cls) {
  const el = document.createElement('div');
  el.className = 'chat-msg' + (cls ? ' ' + cls : '');
  const time = document.createElement('span');
  time.className = 'chat-time';
  time.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const text = document.createElement('span');
  text.className = 'chat-text';
  text.textContent = msg;
  el.appendChild(time);
  el.appendChild(text);
  toastsEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, 6500);
  // keep the stream short, like a chat window
  while (toastsEl.children.length > 5) toastsEl.firstChild.remove();
}

const sunDir = new THREE.Vector3();
const lightDir = new THREE.Vector3();
const daySky = new THREE.Color(0x8fb7d9);
const nightSky = new THREE.Color(0x0d1226);
const duskSky = new THREE.Color(0xd98a4e);
const nightLightCol = new THREE.Color(0x9db4ff);
const duskLightCol = new THREE.Color(0xffb36b);
const skyCol = new THREE.Color();
const waterDay = new THREE.Color(0x2a6f9e);
const waterNight = new THREE.Color(0x0a1622);

function makeDiscTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, inner);
  g.addColorStop(0.5, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeDiscTexture('rgba(255,246,214,1)', 'rgba(255,196,110,0.55)'),
  transparent: true,
  fog: false,
  depthWrite: false,
}));
sunDisc.scale.set(140, 140, 1);
scene.add(sunDisc);

const moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeDiscTexture('rgba(228,236,255,1)', 'rgba(150,175,230,0.45)'),
  transparent: true,
  fog: false,
  depthWrite: false,
}));
moonDisc.scale.set(90, 90, 1);
scene.add(moonDisc);

// Stars — two layers for twinkle, fade with daylight/cloud cover
function makeStars(n, size, color) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.08 + Math.random() * 0.92;
    const rxz = Math.sqrt(Math.max(0, 1 - y * y));
    pos[i * 3] = Math.cos(a) * rxz * 820;
    pos[i * 3 + 1] = y * 820;
    pos[i * 3 + 2] = Math.sin(a) * rxz * 820;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({
    size,
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    sizeAttenuation: false,
  }));
  p.renderOrder = -5;
  p.frustumCulled = false;
  scene.add(p);
  return p;
}
const starsA = makeStars(220, 1.6, 0xdfe8ff);
const starsB = makeStars(140, 2.4, 0xffffff);

// Precipitation particles — one pool each for rain / snow / dust
const FX_BOX = { w: 70, h: 42, d: 70 };
const circleTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const streakTex = (() => {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.45, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(6, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
function makeParticles(n, p) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * FX_BOX.w;
    pos[i * 3 + 1] = Math.random() * FX_BOX.h;
    pos[i * 3 + 2] = (Math.random() - 0.5) * FX_BOX.d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    size: p.size,
    color: p.color,
    map: p.tex || null,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  }));
  pts.visible = false;
  pts.frustumCulled = false;
  scene.add(pts);
  return Object.assign({ pts, pos, n, op: 0, active: false }, p);
}
// rain: short streaks · snow: small circles · dust: tiny circles
const rainFx = makeParticles(1700, { size: 1.15, color: 0xaaccee, tex: streakTex, fall: 36, driftX: 3, driftZ: 1.5, sway: 0, targetOp: 0.55 });
const snowFx = makeParticles(1100, { size: 0.34, color: 0xffffff, tex: circleTex, fall: 3.6, driftX: 1.2, driftZ: 0.6, sway: 1.6, targetOp: 0.9 });
const dustFx = makeParticles(1000, { size: 0.22, color: 0xd9b078, tex: circleTex, fall: 0.4, driftX: 20, driftZ: 9, sway: 2.4, targetOp: 0.5 });
const allFx = [rainFx, snowFx, dustFx];

function updateParticles(sys, dt, t, wind) {
  const hw = FX_BOX.w / 2;
  const hd = FX_BOX.d / 2;
  const pos = sys.pos;
  // drift follows the prevailing wind direction with a light cross-wobble
  const ax = sys.driftX * windDirX - sys.driftZ * windDirZ;
  const az = sys.driftZ * windDirX + sys.driftX * windDirZ;
  for (let i = 0; i < sys.n; i++) {
    let x = pos[i * 3] + ax * dt;
    let y = pos[i * 3 + 1] - sys.fall * dt;
    let z = pos[i * 3 + 2] + az * dt;
    if (sys.sway) x += Math.sin(t * sys.sway + i * 1.7) * dt * sys.sway;
    if (y < 0) y += FX_BOX.h;
    if (x > hw) x -= FX_BOX.w;
    else if (x < -hw) x += FX_BOX.w;
    if (z > hd) z -= FX_BOX.d;
    else if (z < -hd) z += FX_BOX.d;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  }
  sys.pts.geometry.attributes.position.needsUpdate = true;
}

// ============================================================================
// Chunked voxel terrain: streaming, LOD and mesh management
// ============================================================================

const chunkMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  metalness: 0,
});

// Far terrain sinks into shadow, darkest at low ground — depth cueing
chunkMat.onBeforeCompile = (shader) => {
  shader.uniforms.uShadeNear = { value: VIEW_DIST * 0.22 };
  shader.uniforms.uShadeFar = { value: VIEW_DIST * 0.98 };
  shader.uniforms.uSnow = { value: 0 };
  shader.uniforms.uParched = { value: 0 };
  chunkMat.userData.shader = shader;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vWorldY;\nvarying vec3 vNy;')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvWorldY = transformed.y;\nvNy = normal;'
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying float vWorldY;\nvarying vec3 vNy;\nuniform float uShadeNear;\nuniform float uShadeFar;\nuniform float uSnow;\nuniform float uParched;'
    )
    .replace(
      '#include <fog_fragment>',
      [
        'float shadeDistK = smoothstep(uShadeNear, uShadeFar, vFogDepth);',
        'float shadeLowK = clamp(1.0 - (vWorldY - 6.0) / 30.0, 0.0, 1.0);',
        'gl_FragColor.rgb *= mix(1.0, mix(0.72, 0.42, shadeLowK), shadeDistK);',
        // snow settles on up-facing ground; drought scorches flat land
        'float snowK = uSnow * smoothstep(0.35, 0.75, vNy.y);',
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.95, 0.99), snowK * 0.9);',
        'gl_FragColor.rgb *= mix(vec3(1.0), vec3(1.3, 1.05, 0.55), uParched * (1.0 - smoothstep(0.2, 0.5, vNy.y)));',
        '#include <fog_fragment>',
      ].join('\n')
    );
};

const chunks = new Map();     // "cx,cz" -> { mesh, lod }
const pendingQueue = [];      // sorted near-first chunk requests
const requested = new Set();  // keys queued or in flight
let lastChunk = null;

const centerChunk = () => ({
  x: Math.floor(controls.target.x / CHUNK),
  z: Math.floor(controls.target.z / CHUNK),
});

const chebDist = (cx, cz, c) => Math.max(Math.abs(cx - c.x), Math.abs(cz - c.z));

const requiredLod = (cx, cz, c) =>
  chebDist(cx, cz, c) <= NEAR_RADIUS ? 0 : 1;

function disposeChunk(key) {
  const ch = chunks.get(key);
  if (!ch) return;
  if (ch.mesh) {
    scene.remove(ch.mesh);
    ch.mesh.geometry.dispose();
  }
  if (ch.trees) {
    scene.remove(ch.trees);
    if (ch.trees.userData.shadow) scene.remove(ch.trees.userData.shadow);
    ch.trees.geometry.dispose();
  }
  if (ch.icons) {
    scene.remove(ch.icons);
    ch.icons.geometry.dispose();
  }
  markFishIconsDirty(); // global fish-icon layer needs a rebuild
  if (ch.fish) {
    scene.remove(ch.fish);
    ch.fish.geometry.dispose();
  }
  chunks.delete(key);
}

// Chunk application budget: rebuilt geometry lands here and is applied to
// the scene a few per frame to avoid hitching when many arrive at once
const applyQueue = [];
function processApplyQueue() {
  let n = 0;
  while (applyQueue.length && n < 3) {
    const j = applyQueue.shift();
    if (tryApplyChunk(j.cx, j.cz, j.lod, j.seed, j.data)) n++;
  }
}

function tryApplyChunk(cx, cz, lod, seed, data) {
  const key = cx + ',' + cz;
  // release the in-flight mark unconditionally: rejected arrivals (stale,
  // out of range) must be re-requestable or they'd leave permanent holes
  requested.delete(key);
  if (seed !== SEED) return false;
  const c = centerChunk();
  const d = chebDist(cx, cz, c);
  if (d > RENDER_RADIUS) return false;
  const existing = chunks.get(key);
  if (existing) {
    // swap only on a genuine detail upgrade; duplicates and downgrades
    // are dropped
    if (lod >= existing.lod) return false;
    disposeChunk(key);
  }
  if (!data.indices.length) {
    // remember empty chunks (open water) so they aren't rebuilt forever
    chunks.set(key, { mesh: null, lod, trees: null, icons: null, fish: null, cx, cz });
    return true;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, chunkMat);
  mesh.castShadow = lod === 0;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);
  const trees = buildChunkTrees(cx, cz, lod);
  if (trees) {
    scene.add(trees);
    if (trees.userData.shadow) scene.add(trees.userData.shadow);
  }
  const ch = { mesh, lod, trees, icons: null, fish: null, cx, cz };
  // chunks streamed in while zoomed far out appear as icons immediately
  if (trees && iconMode) {
    trees.visible = false;
    if (trees.userData.shadow) trees.userData.shadow.visible = false;
    ensureChunkIcons(ch);
    if (ch.icons) ch.icons.visible = true;
  }
  const fish = buildChunkFish(cx, cz);
  if (fish) scene.add(fish);
  ch.fish = fish;
  if (fish && iconMode) {
    fish.visible = false;
    markFishIconsDirty();
  }
  // planet view active: this piece belongs to the hidden map — park it out
  // of sight so no terrain edges peek around the globe; restoreFromSpace
  // will switch everything back on when the world returns
  if (spaceMode) {
    mesh.visible = false;
    if (trees) {
      trees.visible = false;
      if (trees.userData.shadow) trees.userData.shadow.visible = false;
    }
    if (fish) fish.visible = false;
    if (ch.icons) ch.icons.visible = false;
  }
  chunks.set(key, ch);
  return true;
}

function syncChunks(force = false) {
  if (spaceMode) return; // planet view: no terrain streaming
  const c = centerChunk();
  if (!force && lastChunk && lastChunk.x === c.x && lastChunk.z === c.z) return;
  lastChunk = { x: c.x, z: c.z };

  const needed = new Map();
  for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
    for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
      const cx = c.x + dx, cz = c.z + dz;
      needed.set(cx + ',' + cz, requiredLod(cx, cz, c));
    }
  }

  // only drop chunks that left the radius; LOD upgrades swap in place once
  // the replacement is built, so nearby terrain never blinks out
  for (const key of [...chunks.keys()]) {
    if (!needed.has(key)) disposeChunk(key);
  }

  const reqs = [];
  for (const [key, lod] of needed) {
    const existing = chunks.get(key);
    // build missing chunks; upgrade far->near detail when the camera closes
    // in. Never downgrade: keeping higher detail costs nothing visually
    const wantsBuild =
      !existing || (existing.lod === 1 && lod === 0);
    if (wantsBuild && !requested.has(key)) {
      const [cx, cz] = key.split(',').map(Number);
      reqs.push({ key, cx, cz, lod, d: chebDist(cx, cz, c) });
    }
  }
  for (const r of reqs) {
    requested.add(r.key);
    pendingQueue.push(r);
  }
  // prune jobs that left the radius, refresh distances to the new center,
  // then sort the WHOLE backlog near-first so nearby terrain always builds
  // first while walking
  for (let i = pendingQueue.length - 1; i >= 0; i--) {
    const j = pendingQueue[i];
    const jd = chebDist(j.cx, j.cz, c);
    if (jd > RENDER_RADIUS) {
      pendingQueue.splice(i, 1);
      requested.delete(j.key);
    } else {
      j.d = jd;
    }
  }
  pendingQueue.sort((a, b) => a.d - b.d);
}

function pumpChunks() {
  if (!workers.length) {
    let n = 0;
    while (pendingQueue.length && n < 2) {
      const job = pendingQueue.shift();
      requested.delete(job.key);
      const data = buildChunkData(job.cx, job.cz, SEED, job.lod);
      tryApplyChunk(job.cx, job.cz, job.lod, SEED, data);
      n++;
    }
    return;
  }
  while (pendingQueue.length && busy.size < workers.length) {
    const job = pendingQueue.shift();
    const c = centerChunk();
    if (chebDist(job.cx, job.cz, c) > RENDER_RADIUS) {
      requested.delete(job.key); // dropped stale job
      continue;
    }
    const w = workers.find((wk) => !busy.has(wk));
    busy.add(w);
    dbgDispatched++;
    w.postMessage({ cx: job.cx, cz: job.cz, lod: job.lod, seed: SEED, home: HOME_FLAT });
  }
}

function clearAllChunks() {
  for (const key of [...chunks.keys()]) disposeChunk(key);
  chunks.clear();
  pendingQueue.length = 0;
  applyQueue.length = 0;
  requested.clear();
  lastChunk = null;
}

// ============================================================================
// Home spawn marker: pixel-art campfire on the nearest dry spot to origin
// ============================================================================

let homeFire = null;
let homePos = { x: 0, z: 0 };
let homeLit = false;
let homeFlames = [];

function findDryHome() {
  if (isDry(0, 0)) return { x: 0, z: 0 };
  for (let r = 4; r <= 240; r += 4) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = Math.round(Math.cos(ang) * r);
      const z = Math.round(Math.sin(ang) * r);
      if (isDry(x, z)) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}

// every fresh camp starts with a young couple and their apple tree
// the founding couple sleeps by the fire until the campfire is struck for
// the first time — only then does the tribe wake (tribeAwoken)
let tribeAwoken = false;
function spawnDefaultCamp() {
  tribeAwoken = false;
  // candidate ring around the fire; scored to favour dry, unblocked ground
  // on the DEFAULT-CAMERA side (+z) so both are in frame immediately
  const cands = [];
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    const cx = homePos.x + Math.cos(ang) * 3.4;
    const cz = homePos.z + Math.sin(ang) * 3.4;
    if (!isDry(cx, cz) || treeHit(cx, cz)) continue;
    cands.push({ x: cx, z: cz, score: (cz - homePos.z) * 2 });
  }
  cands.sort((p, q) => q.score - p.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= 2) break;
    if (picked.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 2.2)) continue;
    picked.push(c);
  }
  let mPlaced = false, fPlaced = false;
  for (const s of picked) {
    if (!mPlaced) {
      spawnCaveman(s.x, s.z, false, 15);
      const c = cavemen[cavemen.length - 1];
      c.homebound = true;
      // the founding couple starts asleep by the fire; striking the
      // campfire wakes them with a startled hop
      c.sleeping = true;
      c.energy = 100;
      c.forcedSleep = false;
      c.founder = true;
      c.faceL = true;
      mPlaced = true;
      continue;
    }
    if (!fPlaced) {
      spawnCaveman(s.x, s.z, true, 15);
      const c = cavemen[cavemen.length - 1];
      c.homebound = true;
      c.sleeping = true;
      c.founder = true;
      c.faceL = false;
      fPlaced = true;
    }
  }
  for (const [ox, oz] of [[5.5, 2.5], [6.5, -2.0], [-5.5, 3.0], [4.5, -4.0]]) {
    const x = homePos.x + ox, z = homePos.z + oz;
    if (!isDry(x, z) || treeHit(x, z)) continue;
    // never plant it on top of the couple
    if (picked.some((p) => Math.hypot(p.x - x, p.z - z) < 3)) continue;
    spawnPlacedTree('apple', x, z, 1.55);
    break;
  }
  // hard guarantee: fresh camp villagers are always visible in detail mode
  for (const c of cavemen) c.spr.visible = !iconMode && !spaceMode;
}

// frame the campfire: orbit pivot just above the flames, camera locked at
// a fixed offset from the fire base so the home view always looks the same
function goHome() {
  const fy = homeFire ? homeFire.position.y : groundYAt(homePos.x, homePos.z);
  controls.target.set(homePos.x, fy + 1.5, homePos.z);
  camera.position.set(homePos.x, fy + 44, homePos.z + 55);
  snapZoom();
  controls.update();
}

function buildBeacon() {
  if (homeFire) scene.remove(homeFire);
  if (homeFireIcon) {
    scene.remove(homeFireIcon);
    homeFireIcon.material.dispose();
    homeFireIcon = null;
  }
  for (const f of homeFlames) {
    scene.remove(f);
    f.material.dispose();
  }
  homeFlames = [];
  homeLit = false;
  // mutate in place so every reference to homePos stays live
  const h = findDryHome();
  homePos.x = h.x;
  homePos.z = h.z;
  HOME_FLAT = {
    x: homePos.x,
    z: homePos.z,
    y: terrainHeight(homePos.x, homePos.z, SEED),
  };
  homeFire = makeCampfireSprite(false);
  homeFire.scale.set(HOME_FIRE_W, HOME_FIRE_H, 1);
  homeFire.position.set(homePos.x, groundYAt(homePos.x, homePos.z), homePos.z);
  scene.add(homeFire);
}

function igniteHome() {
  if (homeLit || !homeFire) return;
  homeLit = true;
  for (let i = 0; i < 2; i++) {
    const f = makeFlameSprite();
    f.userData.phase = i * 2.1;
    f.position.set(
      homeFire.position.x + (i === 0 ? -0.22 : 0.22),
      homeFire.position.y + HOME_FIRE_H * 0.45,
      homeFire.position.z
    );
    scene.add(f);
    homeFlames.push(f);
  }
}

// Warm flickering glow that lights up nearby assets
const fireLight = new THREE.PointLight(0xff9a3c, 0, 24, 1.7);
scene.add(fireLight);

function makeGlowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,190,110,0.85)');
  grad.addColorStop(0.35, 'rgba(255,140,60,0.32)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0,
  }));
  scene.add(s);
  return s;
}
const homeGlow = makeGlowSprite();

function updateHomeFlames(t) {
  const flick = homeLit ? 1 + Math.sin(t * 13) * 0.14 + Math.sin(t * 29 + 1.3) * 0.08 : 0;
  if (homeLit) {
    fireLight.position.set(
      homeFire.position.x,
      homeFire.position.y + HOME_FIRE_H * 0.6,
      homeFire.position.z
    );
    fireLight.intensity = 5.5 * flick;
    homeGlow.position.copy(fireLight.position);
    homeGlow.scale.set(3.2 * flick, 2.2 * flick, 1);
    homeGlow.material.opacity = 0.38 * flick;
  } else {
    fireLight.intensity = 0;
    homeGlow.material.opacity = 0;
  }
  const flare = Math.max(0, 1 - (t - campfireFlareT) / 2.2);
  fireLight.intensity += flare * 1.1;
  for (const f of homeFlames) {
    const p = f.userData.phase;
    f.scale.y = FLAME_H * (1 + Math.sin(t * 13 + p) * 0.18) * (1 + flare * 0.35);
    f.scale.x = FLAME_W * (1 + Math.sin(t * 11 + p * 1.7) * 0.1) * (1 + flare * 0.2);
    f.material.opacity = Math.min(1, (0.8 + Math.sin(t * 17 + p) * 0.2) * (1 + flare * 0.4));
    f.position.y =
      homeFire.position.y + HOME_FIRE_H * 0.45 +
      Math.abs(Math.sin(t * 9 + p)) * 0.15;
  }
}

// ============================================================================
// Input: WASD to explore, R/F to fly below ground, plus touch controls
// ============================================================================

const move = { up: false, down: false, left: false, right: false, raise: false, lower: false };

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') move.up = true;
  else if (e.code === 'KeyS') move.down = true;
  else if (e.code === 'KeyA') move.left = true;
  else if (e.code === 'KeyD') move.right = true;
  else if (e.code === 'KeyR') move.lower = true;
  else if (e.code === 'KeyF') move.raise = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') move.up = false;
  else if (e.code === 'KeyS') move.down = false;
  else if (e.code === 'KeyA') move.left = false;
  else if (e.code === 'KeyD') move.right = false;
  else if (e.code === 'KeyR') move.lower = false;
  else if (e.code === 'KeyF') move.raise = false;
});

function bindMoveButton(el, dir) {
  const on = (e) => { e.preventDefault(); move[dir] = true; };
  const off = (e) => { e.preventDefault(); move[dir] = false; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
document.querySelectorAll('.vdir').forEach((b) => bindMoveButton(b, b.dataset.dir));

// --- Virtual joystick (movement) ---
const joy = { x: 0, y: 0 };
const joyBase = document.getElementById('joystick-base');
const joyKnob = document.getElementById('joystick-knob');
let joyPointerId = null;

function updateJoystick(e) {
  const rect = joyBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const max = (rect.width - joyKnob.offsetWidth) / 2;
  const dist = Math.hypot(dx, dy);
  if (dist > max) {
    dx = (dx / dist) * max;
    dy = (dy / dist) * max;
  }
  joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  joy.x = dx / max;
  joy.y = -dy / max;
}

function releaseJoystick(e) {
  if (e.pointerId !== joyPointerId) return;
  joyPointerId = null;
  joy.x = 0;
  joy.y = 0;
  joyKnob.style.transform = 'translate(-50%, -50%)';
}

joyBase.addEventListener('pointerdown', (e) => {
  joyPointerId = e.pointerId;
  joyBase.setPointerCapture(e.pointerId);
  updateJoystick(e);
});
joyBase.addEventListener('pointermove', (e) => {
  if (e.pointerId === joyPointerId) updateJoystick(e);
});
joyBase.addEventListener('pointerup', releaseJoystick);
joyBase.addEventListener('pointercancel', releaseJoystick);

// --- Two-finger swipe: horizontal = orbit (direction), vertical = height ---
const swipePoints = new Map();
let lastMid = null;
const orbitOffset = new THREE.Vector3();
const ORBIT_UP = new THREE.Vector3(0, 1, 0);

function swipeMidpoint() {
  const pts = [...swipePoints.values()];
  if (pts.length < 2) return null;
  return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
}

renderer.domElement.addEventListener('touchstart', (e) => {
  if (boxSelectOn) return; // marquee owns the touch while armed
  for (const t of e.changedTouches) {
    if (inJoystickZone(t.clientX, t.clientY)) continue; // joystick thumb
    swipePoints.set(t.identifier, { x: t.clientX, y: t.clientY });
  }
  if (swipePoints.size === 2) lastMid = swipeMidpoint();
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
  if (swipePoints.size >= 2) e.preventDefault();
  for (const t of e.changedTouches) {
    const p = swipePoints.get(t.identifier);
    if (p) { p.x = t.clientX; p.y = t.clientY; }
  }
  if (swipePoints.size === 2 && lastMid) {
    const m = swipeMidpoint();
    const dx = m.x - lastMid.x;
    const dy = m.y - lastMid.y;
    lastMid = m;

    if (dx) {
      const angle = -(2 * Math.PI * dx) / renderer.domElement.clientHeight;
      orbitOffset.copy(camera.position).sub(controls.target);
      orbitOffset.applyAxisAngle(ORBIT_UP, angle);
      camera.position.copy(controls.target).add(orbitOffset);
    }
    if (dy) {
      const dist = camera.position.distanceTo(controls.target);
      const step = -dy * Math.max(0.15, dist * 0.005);
      camera.position.y += step;
      controls.target.y += step;
    }
  }
}, { passive: false });

function endSwipe(e) {
  for (const t of e.changedTouches) swipePoints.delete(t.identifier);
  if (swipePoints.size < 2) lastMid = null;
}
renderer.domElement.addEventListener('touchend', endSwipe);
renderer.domElement.addEventListener('touchcancel', endSwipe);

// ============================================================================
// UI
// ============================================================================

const readout = document.getElementById('readout');

document.getElementById('regenerate').addEventListener('click', () => {
  SEED = Math.floor(Math.random() * 1e9);
  if (spaceMode) setSpaceMode(false);
  if (iconMode) setIconMode(false);
  clearAllChunks();
  clearCavemen();
  clearCampfires();
  clearPlacedTrees();
  setPlacing(null);
  campStats.births = 0;
  campStats.deaths = 0;
  campStats.foundedGameMs = null;
  buildBeacon();
  goHome();
  spawnDefaultCamp();
  followCm = null;
  syncChunks(true);
});

const autoBtn = document.getElementById('autorotate');
autoBtn.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  autoBtn.textContent = controls.autoRotate ? '⏹' : '🔄';
  autoBtn.classList.toggle('active', controls.autoRotate);
});

document.getElementById('topview').addEventListener('click', () => {
  camera.position.set(controls.target.x, controls.target.y + 90, controls.target.z + 0.01);
  controls.update();
  snapZoom();
});

document.getElementById('home').addEventListener('click', () => {
  followCm = null;
  goHome();
  syncChunks(true);
});

document.getElementById('toggle-ui').addEventListener('click', () => {
  document.body.classList.toggle('hide-ui');
});

// --- Time controls ---
const dayLabelEl = document.getElementById('day-label');
const pauseBtn = document.getElementById('pause-btn');
const spdBtns = Array.from(document.querySelectorAll('.spd'));
let lastDayStr = '';

const celCtx = document.getElementById('celestial-icon').getContext('2d');

function drawCelestialIcon(t, duskF) {
  const c = celCtx;
  c.clearRect(0, 0, 48, 48);
  const sunA = THREE.MathUtils.clamp((sunDir.y + 0.06) * 7, 0, 1);
  const moonA = THREE.MathUtils.clamp((-sunDir.y + 0.06) * 7, 0, 1);

  if (moonA > 0.05) {
    c.fillStyle = '#cfe0ff';
    for (let i = 0; i < 4; i++) {
      const tw = Math.sin(t * 2.2 + i * 2.1) * 0.5 + 0.5;
      c.globalAlpha = moonA * tw * 0.9;
      c.fillRect(9 + i * 8, 10 + (i % 2) * 6, 2, 2);
    }
  }

  if (sunA > 0.02) {
    c.globalAlpha = sunA;
    const warm = Math.round(90 * duskF);
    c.fillStyle = 'rgb(255,' + (215 - warm) + ',' + Math.max(0, 94 - warm) + ')';
    c.beginPath();
    c.arc(24, 25, 7, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(24, 25);
    c.rotate(t * 0.6);
    c.fillRect(-1, -13, 2, 4);
    c.fillRect(-1, 9, 2, 4);
    c.fillRect(-13, -1, 4, 2);
    c.fillRect(9, -1, 4, 2);
    c.rotate(Math.PI / 4);
    c.globalAlpha = sunA * 0.65;
    c.fillRect(-1, -12, 2, 3);
    c.fillRect(-1, 9, 2, 3);
    c.fillRect(-12, -1, 3, 2);
    c.fillRect(9, -1, 3, 2);
    c.restore();
  }

  if (moonA > 0.02) {
    c.globalAlpha = moonA;
    c.fillStyle = '#e8efff';
    c.beginPath();
    c.arc(24, 25, 7, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(28, 22, 6, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = 'source-over';
  }

  c.globalAlpha = 1;
}

function refreshTimeBtns() {
  pauseBtn.textContent = timePaused ? '▶' : '❚❚';
  for (const b of spdBtns) {
    b.classList.toggle('active', !timePaused && Number(b.dataset.spd) === timeSpeed);
  }
}
pauseBtn.addEventListener('click', () => {
  timePaused = !timePaused;
  if (!timePaused) timeSpeed = 1; // resuming always lands back at normal speed
  refreshTimeBtns();
});
for (const b of spdBtns) {
  b.addEventListener('click', () => {
    timeSpeed = Number(b.dataset.spd);
    timePaused = false;
    refreshTimeBtns();
  });
}
refreshTimeBtns();
dayLabelEl.textContent = 'Day 1 · ' + phaseName(worldEpoch.getHours());

// --- Assets panel ---
const CAVEMAN = [
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....HSESSESH....',
  '....HSSSSSSH....',
  '....HSHHHHSH....',
  '.....HHHHH......',
  '......SS........',
  '.....SSSS.......',
  '....SSSSSS......',
  '...SSCCCCSS.....',
  '...SSCCCCSS.....',
  '...SSCCCCSS.....',
  '....CCCCCC......',
  '....SS..SS......',
  '....SS..SS......',
  '....SS..SS......',
  '....SS..SS......',
];
const CAVEMAN_PALETTE = { H: '#3b2b1e', S: '#c78d5a', E: '#1a1a1a', C: '#8a5a33' };

// Cavewoman: long flowing hair + leaf dress, same 16px grid
const CAVEWOMAN = [
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....HSESSESH....',
  '....HSSSSSSH....',
  '....HSHHHHSH....',
  '.....HHHHHH.....',
  '....HH.SS.HH....',
  '....HH.SS.HH....',
  '.....SSSS.......',
  '....SSSSSS......',
  '..SSDDDDDDSS....',
  '...SDDDDDDS.....',
  '...DDDDDDDD.....',
  '....DDDDDD......',
  '....SS..SS......',
  '....SS..SS......',
  '....SS..SS......',
];
const CAVEWOMAN_PALETTE = {
  H: '#5a3a22', S: '#d29a66', E: '#1a1a1a', C: '#9a6a3f', D: '#6b8f3f',
};

const CAVEWOMAN_CHILD = [
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....HSESSESH....',
  '....HSSSSSSH....',
  '.....HHHHHH.....',
  '....HH.SS.HH....',
  '.....SSSS.......',
  '....SDDDDS......',
  '....DDDDDD......',
  '....SS..SS......',
  '....SS..SS......',
];

const CAVEWOMAN_ELDER = [
  '................',
  '....GGGGGG......',
  '...GGGGGGGG.....',
  '...GSSSSSSG.....',
  '...GSESSESG.....',
  '...GSSSSSSG.....',
  '...GSGGGGSG.....',
  '....GGGGGG......',
  '...GG.SS.GG.....',
  '...GG.SS.GG.....',
  '....SSSS........',
  '..SSCCCCCS......',
  '...SCCCCCW......',
  '...CCCCCCSW.....',
  '....CCCCCC......',
  '....SS.SS.......',
  '....SS.SS.......',
  '....SS..SS......',
];
const CAVEWOMAN_ELDER_PALETTE = {
  H: '#5a3a22', S: '#d29a66', E: '#1a1a1a', C: '#9a6a3f',
  G: '#d5d5d5', W: '#7a5230', D: '#7a6a4a',
};

// Child: big head, tiny body
const CAVEMAN_CHILD = [
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....HSESSESH....',
  '....HSSSSSSH....',
  '.....HHHHH......',
  '......SS........',
  '.....SSSS.......',
  '....SCCCCS......',
  '....CCCCCC......',
  '....SS..SS......',
  '....SS..SS......',
];

// Elder: gray hair + beard, hunched, walking staff
const CAVEMAN_ELDER = [
  '................',
  '....GGGGGG......',
  '...GGGGGGGG.....',
  '...GSSSSSSG.....',
  '...GSESSESG.....',
  '...GSSSSSSG.....',
  '...GSGGGGSG.....',
  '....GGGGGG......',
  '.....SSS........',
  '....SSSSS.......',
  '...SSCCCCS......',
  '...SSCCCCCS.....',
  '...SCCCCCCW.....',
  '...CCCCCCSW.....',
  '....CCCCCC......',
  '....SS.SS.......',
  '....SS.SS.......',
  '....SS..SS......',
];
const CAVEMAN_ELDER_PALETTE = {
  H: '#3b2b1e', S: '#c78d5a', E: '#1a1a1a', C: '#8a5a33',
  G: '#c9c9c9', W: '#7a5230',
};

function drawPixelArt(canvas, rows, palette, scale) {
  canvas.width = rows[0].length * scale;
  canvas.height = rows.length * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = palette[rows[y][x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
drawPixelArt(document.getElementById('caveman-canvas'), CAVEMAN, CAVEMAN_PALETTE, 4);
drawPixelArt(document.getElementById('cavewoman-canvas'), CAVEWOMAN, CAVEWOMAN_PALETTE, 4);

const assetsToggle = document.getElementById('assets-toggle');
// escape the sliding panel: a fixed child of the transformed panel anchors
// to it (off-screen) instead of the viewport — reparent to <body>
document.body.appendChild(assetsToggle);
assetsToggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('panel-open');
  assetsToggle.textContent = open ? '«' : '»';
  resizeGame();
  setTimeout(resizeGame, 300);
});

function resizeGame() {
  const el = document.getElementById('app');
  const w = el.clientWidth || window.innerWidth;
  const h = el.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// --- Caveman: placement + free roaming ---
function makeCavemanMats(art, pal) {
  const c = document.createElement('canvas');
  drawPixelArt(c, art, pal, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  const tf = t.clone();
  tf.wrapS = THREE.RepeatWrapping;
  tf.repeat.x = -1;
  tf.offset.x = 1;
  tf.needsUpdate = true;
  // dedicated sleeping pose: eyes shut + tiny lash lines, then the art is
  // baked sideways so every person has their own lying-down pixel art
  const sleepPal = { ...pal, Z: '#141414' };
  const grid = art.map((r) => r.split(''));
  const hasSkin = Object.prototype.hasOwnProperty.call(pal, 'S');
  if (hasSkin) {
    // find every horizontal run of open-eye pixels ('E')
    const runs = [];
    for (let r = 0; r < grid.length; r++) {
      let c0 = -1;
      for (let c = 0; c <= grid[r].length; c++) {
        const eye = grid[r][c] === 'E';
        if (eye && c0 < 0) c0 = c;
        if (!eye && c0 >= 0) { runs.push([r, c0, c - 1]); c0 = -1; }
      }
    }
    for (const [r, a, b] of runs) {
      for (let c = a; c <= b; c++) grid[r][c] = 'S'; // lids closed
      if (!grid[r + 1]) continue;
      for (let c = a; c <= b; c += 2) {
        if (grid[r + 1][c] === 'S') grid[r + 1][c] = 'Z'; // lash pixels
      }
    }
  }
  const sleepArt = grid.map((r) => r.join(''));
  const sc = document.createElement('canvas');
  drawPixelArt(sc, sleepArt, sleepPal, 1);
  const lc = document.createElement('canvas');
  lc.width = sc.height;
  lc.height = sc.width;
  const lx = lc.getContext('2d');
  lx.imageSmoothingEnabled = false;
  lx.translate(lc.width / 2, lc.height / 2);
  lx.rotate(-Math.PI / 2);
  lx.drawImage(sc, -sc.width / 2, -sc.height / 2);
  const st = new THREE.CanvasTexture(lc);
  st.magFilter = THREE.NearestFilter;
  st.minFilter = THREE.NearestFilter;
  st.colorSpace = THREE.SRGBColorSpace;
  return [
    new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.1 }),
    new THREE.SpriteMaterial({ map: tf, transparent: true, alphaTest: 0.1 }),
    new THREE.SpriteMaterial({ map: st, transparent: true, alphaTest: 0.1 }),
  ];
}

const [cavemanMatR, cavemanMatL] = makeCavemanMats(CAVEMAN, CAVEMAN_PALETTE);
const [childMatR, childMatL] = makeCavemanMats(CAVEMAN_CHILD, CAVEMAN_PALETTE);
const [elderMatR, elderMatL] = makeCavemanMats(CAVEMAN_ELDER, CAVEMAN_ELDER_PALETTE);
const [womanMatR, womanMatL] = makeCavemanMats(CAVEWOMAN, CAVEWOMAN_PALETTE);
const [womanChildMatR, womanChildMatL] = makeCavemanMats(CAVEWOMAN_CHILD, CAVEWOMAN_PALETTE);
const [womanElderMatR, womanElderMatL] = makeCavemanMats(CAVEWOMAN_ELDER, CAVEWOMAN_ELDER_PALETTE);

// Age stages: art + size swap as cavemen age (1 game day = 1 year)
const AGE_STAGES = {
  child: { label: 'Child', maxAge: 15, h: 2.1, art: CAVEMAN_CHILD, matR: childMatR, matL: childMatL, pal: CAVEMAN_PALETTE },
  adult: { label: 'Adult', maxAge: 55, h: 3.0, art: CAVEMAN, matR: cavemanMatR, matL: cavemanMatL, pal: CAVEMAN_PALETTE },
  elder: { label: 'Elder', maxAge: Infinity, h: 2.75, art: CAVEMAN_ELDER, matR: elderMatR, matL: elderMatL, pal: CAVEMAN_ELDER_PALETTE },
};

// Female stages mirror the male ones with their own art
const FEMALE_STAGES = {
  child: { label: 'Child', maxAge: 15, h: 2.05, art: CAVEWOMAN_CHILD, matR: womanChildMatR, matL: womanChildMatL, pal: CAVEWOMAN_PALETTE },
  adult: { label: 'Adult', maxAge: 55, h: 2.95, art: CAVEWOMAN, matR: womanMatR, matL: womanMatL, pal: CAVEWOMAN_PALETTE },
  elder: { label: 'Elder', maxAge: Infinity, h: 2.7, art: CAVEWOMAN_ELDER, matR: womanElderMatR, matL: womanElderMatL, pal: CAVEWOMAN_ELDER_PALETTE },
};

function ageStageOf(age) {
  return age < AGE_STAGES.child.maxAge ? 'child' : age < AGE_STAGES.adult.maxAge ? 'adult' : 'elder';
}

function applyStage(cm) {
  const yrs = cm.stats.baseAge + (gameMs - cm.stats.bornGameMs) / 86400000;
  const st = ageStageOf(yrs);
  if (cm.stage === st) return;
  cm.stage = st;
  const cfg = cm.mats[st];
  cm.faceL = cm.faceL || false;
  setCmFace(cm);
  const w = cfg.h * (cfg.art[0].length / cfg.art.length);
  cm.spr.scale.set(w, cfg.h, 1);
  if (cm.sleepApplied) applySleepPose(cm, true); // re-lying in the new stage
}

const cavemen = [];

// ---- camp chronicle: the settlement's life story since its founding -----
const campStats = { births: 0, deaths: 0, foundedGameMs: null };
let placingKind = null;

// --- selection highlight: a 1px stroke hugging the character silhouette ---
// color: idle yellow, or green while the Move command is armed (action mode)
function makeOutlineMat(srcMat, color) {
  const src = srcMat.map.image; // the pixel-art canvas behind the material
  const w = src.width, h = src.height;
  const o = document.createElement('canvas');
  o.width = w + 4;
  o.height = h + 4;
  const ctx = o.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = w + 4;
  tmp.height = h + 4;
  const tc = tmp.getContext('2d');
  // stamp a 3x3 cross: a thin 1px stroke that hugs the art cleanly
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue; // thin cross only
      tc.globalCompositeOperation = 'source-over';
      tc.clearRect(0, 0, w + 4, h + 4);
      tc.drawImage(src, dx + 2, dy + 2);
      tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = color;
      tc.fillRect(0, 0, w + 4, h + 4);
      ctx.drawImage(tmp, 0, 0);
    }
  }
  const t = new THREE.CanvasTexture(o);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
}
const OUTLINE_YELLOW = '#ffe066';
const OUTLINE_GREEN = '#58d95e';
const OUTLINE_CACHE = new Map();
function outlineMatFor(cm, faceL, color) {
  const cfg = cm.mats[cm.stage];
  // sleeping people get the stroke from their baked lying-down art so the
  // highlight hugs the body instead of floating beside a standing ghost
  const sleeping = !!(cm.sleepApplied || cm.sleeping);
  const srcMat = sleeping ? cfg.matSleep : (faceL ? cfg.matL : cfg.matR);
  const col = color || OUTLINE_YELLOW;
  const key = srcMat.uuid + '|' + col;
  if (!OUTLINE_CACHE.has(key)) OUTLINE_CACHE.set(key, makeOutlineMat(srcMat, col));
  return OUTLINE_CACHE.get(key);
}
// keep outline geometry in sync with the current stage art — dims are read
// from whatever art the material uses, so the lying pose lines up too
function syncOutline(cm) {
  if (!cm.outSpr) return;
  // the action-menu target glows white while the options popup is open
  const col = cm === menuTarget ? '#ffffff'
    : actionMode ? OUTLINE_GREEN : OUTLINE_YELLOW;
  cm.outSpr.material = outlineMatFor(cm, cm.faceL, col);
  const img = cm.outSpr.material.map.image;
  const iw = img.width, ih = img.height;
  cm.outSpr.scale.set((iw + 4) / iw, (ih + 4) / ih, 1);
  cm.outSpr.position.y = -2 / ih; // stroke adds two art px below the base
}
// swap a villager between standing art and their baked lying-down pose
function applySleepPose(cm, on) {
  cm.sleepApplied = on;
  const cfg = cm.mats[cm.stage];
  if (!cfg || !cfg.matSleep) return;
  // standing world width (height cfg.h spans the full art height)
  const wWorld = cfg.h * (cfg.art[0].length / cfg.art.length);
  if (on) {
    cm.spr.material = cfg.matSleep;
    // lying down: the body's length runs along the ground
    cm.spr.scale.set(cfg.h, wWorld, 1);
    // the stroke follows the lying pose whenever this human is picked
    if (cm.outSpr) {
      cm.outSpr.visible = cm === selectedCm || squad.has(cm);
      if (cm.outSpr.visible) syncOutline(cm);
    }
  } else {
    cm.spr.scale.set(wWorld, cfg.h, 1);
    setCmFace(cm); // restores facing material + outline sync
  }
}
// single place that flips a character's facing (sprite + outline)
function setCmFace(cm) {
  if (cm.sleeping) return; // sleep pose owns the material while asleep
  cm.spr.material = cm.faceL ? cm.mats[cm.stage].matL : cm.mats[cm.stage].matR;
  syncOutline(cm);
}

// --- Unlit campfire (pixel-art spawn-point indicator) ---
const CAMPFIRE = [
  '.........W.........',
  '....W....l....W....',
  '....L...lWl...L....',
  '.....L..lLl..L.....',
  '.....Ll.lLl.lL.....',
  '......LlLLLlL......',
  '.......lLLLl.......',
  '......lCcCcCl......',
  '.....lCCcCcCCCl....',
  '...Ss..CcCAcC..sS..',
  '..SSs.CAAcAAC.sSS..',
  '.SSss.AcCACcA.ssSS.',
  '.Ss...AAAcAAA...sS.',
];
const CAMPFIRE_PALETTE = {
  W: '#c9a166',
  L: '#8a5a2e',
  l: '#5f3c1e',
  C: '#26201a',
  c: '#3a322a',
  A: '#a29a8c',
  S: '#93938e',
  s: '#63635e',
};

const campfireTex = (() => {
  const c = document.createElement('canvas');
  drawPixelArt(c, CAMPFIRE, CAMPFIRE_PALETTE, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const campfireMatSolid = new THREE.SpriteMaterial({ map: campfireTex, transparent: true, alphaTest: 0.1 });
const campfireMatGhost = new THREE.SpriteMaterial({ map: campfireTex, transparent: true, opacity: 0.5, depthWrite: false });

const FLAME = [
  '....F....',
  '...F.F...',
  '...FFF...',
  '..FFOFF..',
  '..FOYOF..',
  '.FFOYOOF.',
  '.FOYYYOF.',
  'FFOYYYOFF',
  'FFOYYYOFF',
  '.FFOYOFF.',
  '..FFFFF..',
];
const FLAME_PALETTE = { F: '#ff6b1a', O: '#ff9e2c', Y: '#ffe45c' };

const flameTex = (() => {
  const c = document.createElement('canvas');
  drawPixelArt(c, FLAME, FLAME_PALETTE, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const FLAME_H = 0.55;
const FLAME_W = FLAME_H * (FLAME[0].length / FLAME.length);

function makeFlameSprite() {
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flameTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  spr.scale.set(FLAME_W, FLAME_H, 1);
  spr.center.set(0.5, 0);
  spr.renderOrder = 21; // above the water plane
  return spr;
}

const CAMPFIRE_H = 0.8;
const CAMPFIRE_W = CAMPFIRE_H * (CAMPFIRE[0].length / CAMPFIRE.length);
// the home beacon is only slightly larger than a placed fire — never huge
const HOME_FIRE_K = 1.35;
const HOME_FIRE_H = CAMPFIRE_H * HOME_FIRE_K;
const HOME_FIRE_W = CAMPFIRE_W * HOME_FIRE_K;

function makeCampfireSprite(ghost) {
  const spr = new THREE.Sprite(ghost ? campfireMatGhost : campfireMatSolid);
  spr.scale.set(CAMPFIRE_W, CAMPFIRE_H, 1);
  spr.center.set(0.5, 0);
  if (!ghost) spr.renderOrder = 19; // above the water plane
  return spr;
}

function isDry(x, z) {
  return terrainHeight(Math.round(x), Math.round(z), SEED) > SEA_LEVEL;
}

const ghostFire = makeCampfireSprite(true);
ghostFire.visible = false;
scene.add(ghostFire);

const campfires = [];

function placeCampfire(x, z) {
  const f = makeCampfireSprite(false);
  f.position.set(x, groundYAt(x, z), z);
  scene.add(f);
  campfires.push(f);
}

function clearCampfires() {
  for (const f of campfires) scene.remove(f);
  campfires.length = 0;
  for (const ic of extraFireIcons.values()) {
    scene.remove(ic);
    ic.material.dispose();
  }
  extraFireIcons.clear();
}

function groundYAt(x, z) {
  const rx = Math.round(x), rz = Math.round(z);
  const g = homeFlatten(rx, rz, terrainHeight(rx, rz, SEED)) + 1;
  return Math.max(g, SEA_LEVEL - 0.4);
}

// ============================================================================
// Trees: 4 pixel-art species, one per biome, scattered deterministically
// ============================================================================

const ATLAS_CELL = 48;
const ATLAS_COLS = 26;
const ATLAS_ROWS = 4; // rows: 0 Spring, 1 Summer, 2 Autumn, 3 Winter
const COL_FRAC = 1 / ATLAS_COLS;
const ROW_FRAC = 1 / ATLAS_ROWS;
// Species registry. Each kind paints ONE summer base cell; the spring,
// autumn and winter cells are derived programmatically (seasonize below)
// so every kind gets its own unique seasonal look, and the shader
// crossfades between season rows for smooth transitions.
// autumn: foliage target colour, null = evergreen (keeps its green)
const TREE_KINDS = {
  cactus:    { label: 'Cactus',       biome: 'desert', type: 'tree', h: 3.2, r: 0.34, autumn: null },
  agave:     { label: 'Agave',        biome: 'desert', type: 'tree', h: 2.3, r: 0.42, autumn: null },
  acacia:    { label: 'Acacia',       biome: 'desert', type: 'tree', h: 4.6, r: 0.52, autumn: [188, 142, 52] },
  shrub:     { label: 'Desert Shrub', biome: 'desert', type: 'bush', h: 1.6, r: 0.5,  autumn: [168, 120, 44] },
  tumble:    { label: 'Tumble Bush',  biome: 'desert', type: 'bush', h: 1.2, r: 0.44, autumn: null },
  jungle:    { label: 'Jungle Tree',  biome: 'jungle', type: 'tree', h: 7.0, r: 0.55, autumn: null },
  palm:      { label: 'Palm',         biome: 'jungle', type: 'tree', h: 6.0, r: 0.42, autumn: null },
  bamboo:    { label: 'Bamboo',       biome: 'jungle', type: 'tree', h: 5.2, r: 0.3,  autumn: [196, 168, 64] },
  fern:      { label: 'Fern Thicket', biome: 'jungle', type: 'bush', h: 1.8, r: 0.55, autumn: null },
  oak:       { label: 'Oak',          biome: 'forest', type: 'tree', h: 5.5, r: 0.45, autumn: [214, 128, 38], blossom: true },
  pine:      { label: 'Pine',         biome: 'forest', type: 'tree', h: 6.5, r: 0.36, autumn: null },
  birch:     { label: 'Birch',        biome: 'forest', type: 'tree', h: 5.0, r: 0.36, autumn: [224, 178, 58], blossom: true },
  maple:     { label: 'Maple',        biome: 'forest', type: 'tree', h: 5.8, r: 0.46, autumn: [206, 54, 34], blossom: true },
  berry:     { label: 'Berry Bush',   biome: 'forest', type: 'bush', h: 1.5, r: 0.5,  autumn: [150, 110, 40], berries: true },
  apple:     { label: 'Apple Tree',   biome: 'forest', type: 'tree', h: 4.8, r: 0.46, autumn: [214, 128, 38], blossom: true },
  snowpine:  { label: 'Snow Pine',    biome: 'snow',   type: 'tree', h: 6.0, r: 0.38, autumn: null },
  spruce:    { label: 'Spruce',       biome: 'snow',   type: 'tree', h: 5.4, r: 0.36, autumn: null },
  dead:      { label: 'Dead Tree',    biome: 'snow',   type: 'tree', h: 5.0, r: 0.3,  autumn: null },
  frostbush: { label: 'Frost Bush',   biome: 'snow',   type: 'bush', h: 1.3, r: 0.46, autumn: null },
  pebble:    { label: 'Small Rock',   biome: 'forest', type: 'rock', h: 0.5, r: 0.3,  autumn: null },
  rock:      { label: 'Medium Rock',  biome: 'forest', type: 'rock', h: 1.1, r: 0.7,  autumn: null },
  boulder:   { label: 'Big Rock',     biome: 'forest', type: 'rock', h: 2.2, r: 1.15, autumn: null },
  greatbush: { label: 'Great Bush',   biome: 'forest', type: 'bush', h: 2.6, r: 0.9,  autumn: [186, 140, 60] },
  bloom:     { label: 'Blossom Bush', biome: 'forest', type: 'bush', h: 1.7, r: 0.52, autumn: null, blossom: true },
  bramble:   { label: 'Bramble Tangle', biome: 'jungle', type: 'bush', h: 1.9, r: 0.6, autumn: [142, 152, 64] },
};
const KIND_ORDER = Object.keys(TREE_KINDS);
const KIND_COL = {};
KIND_ORDER.forEach((k, i) => { KIND_COL[k] = i / ATLAS_COLS; });
// which species grow wild in each terrain — bushes weighted heavier and
// rocks scattered through every biome
const BIOME_TREES = {
  desert: ['cactus', 'agave', 'acacia', 'shrub', 'tumble', 'pebble', 'rock', 'boulder'],
  jungle: ['jungle', 'palm', 'bamboo', 'fern', 'fern', 'greatbush', 'bramble', 'bramble', 'pebble', 'rock'],
  forest: ['oak', 'pine', 'birch', 'maple', 'berry', 'berry', 'bloom', 'bloom', 'greatbush', 'pebble', 'rock', 'boulder'],
  snow: ['snowpine', 'spruce', 'dead', 'frostbush', 'frostbush', 'rock', 'boulder'],
};
const TREE_DENSITY = { desert: 0.017, jungle: 0.038, forest: 0.028, snow: 0.02 };

function tpx(c, x, y, w, h, col) {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
}

function tblob(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let y = -ry; y <= ry; y++) {
    const tt = 1 - (y * y) / (ry * ry);
    const half = Math.round(rx * Math.sqrt(Math.max(0, tt)));
    c.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}

// --- pro-art helpers: shaded bark + volumetric canopies ---------------------
// trunk with a lit left edge, shaded right edge, bark knots and a root flare
function ttrunk(c, ox, cx, topY, baseY, w, pal) {
  const [L, M, D] = pal;
  for (let y = topY; y <= baseY; y++) {
    const k = (y - topY) / Math.max(1, baseY - topY);
    const ww = w + Math.round(k * 1.6); // gentle flare toward the roots
    tpx(c, ox + cx - ww, y, ww * 2 + 1, 1, M);
    tpx(c, ox + cx - ww, y, 1, 1, L);
    tpx(c, ox + cx + ww, y, 1, 1, D);
    if ((y * 7 + cx) % 11 === 0 && ww > 1) tpx(c, ox + cx - 1, y, 2, 1, D);
  }
  tpx(c, ox + cx - w - 3, baseY, 2, 1, D);
  tpx(c, ox + cx + w + 2, baseY, 2, 1, D);
}

// canopy mass with AO under-layer, lit upper-left cap, dithered shine and
// small depth holes — reads as volume instead of a flat green blob
function tcanopy(c, cx, cy, rx, ry, pal, seed) {
  const [DK, MD, LT, HI] = pal;
  tblob(c, cx, cy + 2, rx, ry, DK);
  tblob(c, cx - 1, cy - 1, rx - 1, ry - 1, MD);
  tblob(c, cx - Math.round(rx * 0.32), cy - Math.round(ry * 0.38),
    Math.max(2, rx - 4), Math.max(2, ry - 3), LT);
  for (let i = 0; i < 14; i++) {
    const a = (i * 2.399963 + seed) % 6.2831853;
    const rr = Math.sqrt(((i % 5) + 1) / 6);
    c.fillStyle = HI;
    c.fillRect(
      cx - Math.round(rx * 0.3) + Math.round(Math.cos(a) * rx * rr * 0.55),
      cy - Math.round(ry * 0.45) + Math.round(Math.sin(a) * ry * rr * 0.4), 2, 1
    );
  }
  for (let i = 0; i < 7; i++) {
    const hx = cx + Math.round(((i * 37 + seed * 13) % Math.max(1, rx)) ) - Math.round(rx * 0.5);
    const hy = cy + Math.round(((i * 23 + seed * 29) % Math.max(1, ry))) - Math.round(ry * 0.35);
    if (((hx + hy) | 0) % 2 === 0) {
      c.fillStyle = DK;
      c.fillRect(hx, hy, 2, 1);
    }
  }
}

function paintCactus(c, ox) {
  const B = '#3e7d3a', H = '#57a04e', D = '#2c5c2a';
  tpx(c, ox + 21, 14, 6, 32, B);
  tpx(c, ox + 21, 14, 2, 32, H);
  tpx(c, ox + 25, 14, 2, 32, D);
  tpx(c, ox + 13, 24, 8, 5, B);
  tpx(c, ox + 13, 13, 5, 12, B);
  tpx(c, ox + 13, 13, 2, 12, H);
  tpx(c, ox + 27, 30, 9, 5, B);
  tpx(c, ox + 31, 19, 5, 12, B);
  tpx(c, ox + 34, 19, 2, 12, D);
  tpx(c, ox + 22, 11, 4, 3, '#e668a0');
  c.fillStyle = '#eaf4e2';
  for (let i = 0; i < 14; i++) {
    c.fillRect(ox + 21 + ((i * 7) % 6), 16 + ((i * 11) % 28), 1, 1);
  }
}

function paintShrub(c, ox) {
  const B = '#7a6a3d', G = '#8f9e4a', D = '#5c5030';
  tblob(c, ox + 24, 36, 12, 7, D);
  tblob(c, ox + 24, 33, 10, 6, B);
  tblob(c, ox + 22, 31, 7, 4, G);
  for (const [sx, sy] of [[12, 30], [20, 26], [28, 27], [35, 31], [16, 34], [31, 35]]) {
    tpx(c, ox + sx, sy, 1, 6, B);
    tpx(c, ox + sx, sy - 2, 1, 2, G);
  }
  c.fillStyle = '#c9a84a';
  for (let i = 0; i < 6; i++) {
    c.fillRect(ox + 15 + ((i * 9) % 18), 29 + ((i * 5) % 8), 1, 1);
  }
}

function paintJungle(c, ox) {
  for (let y = 24; y < 46; y++) {
    const bx = 23 + Math.round(Math.sin((y - 24) / 7) * 2);
    tpx(c, ox + bx, y, 3, 1, '#5d4022');
    tpx(c, ox + bx + 2, y, 1, 1, '#3e2a14');
  }
  tpx(c, ox + 18, 41, 5, 5, '#5d4022');
  tpx(c, ox + 27, 41, 5, 5, '#5d4022');
  tblob(c, ox + 24, 13, 20, 9, '#174a29');
  tblob(c, ox + 24, 11, 16, 7, '#2f8a42');
  tblob(c, ox + 19, 9, 9, 5, '#53b85c');
  for (const [vx, vl] of [[8, 6], [15, 10], [33, 7], [40, 5]]) {
    tpx(c, ox + vx, 20, 1, vl, '#3fae52');
  }
}

function paintApple(c, ox) {
  tpx(c, ox + 22, 30, 4, 16, '#6b4526');
  tpx(c, ox + 24, 30, 2, 16, '#53301a');
  tblob(c, ox + 24, 19, 15, 11, '#1e4d2b');
  tblob(c, ox + 22, 17, 12, 9, '#2f7a3f');
  tblob(c, ox + 21, 15, 8, 6, '#4a9e55');
  c.fillStyle = '#63c06a';
  for (let i = 0; i < 9; i++) {
    c.fillRect(ox + 13 + ((i * 5) % 14), 9 + ((i * 3) % 7), 2, 1);
  }
  c.fillStyle = '#e03a3a';
  for (const [ax, ay] of [[18, 16], [27, 14], [23, 21], [30, 19], [20, 23]]) {
    c.fillRect(ox + ax, ay, 2, 2);
  }
  c.fillStyle = '#ffd54a';
  c.fillRect(ox + 27, 13, 1, 1);
}

function paintOak(c, ox) {
  ttrunk(c, ox, 24, 26, 45, 2, ['#8a5a33', '#6b4526', '#462c16']);
  tcanopy(c, ox + 24, 17, 15, 10, ['#173d22', '#256b35', '#3f9a4c', '#6fd074'], 3);
  tblob(c, ox + 13, 21, 6, 4, '#1c4a29');
  tblob(c, ox + 36, 20, 6, 4, '#1c4a29');
  tblob(c, ox + 12, 19, 4, 3, '#2f7a3f');
  tblob(c, ox + 37, 18, 4, 3, '#2f7a3f');
  c.fillStyle = '#8fe093';
  c.fillRect(ox + 17, 9, 2, 1);
  c.fillRect(ox + 27, 7, 2, 1);
}

function paintPine(c, ox) {
  ttrunk(c, ox, 24, 34, 46, 2, ['#7a5028', '#5a3a1e', '#3a2510']);
  const tiers = [[5, 5], [11, 8], [18, 11], [26, 14]];
  for (const [ty, tw] of tiers) {
    for (let y = 0; y < 12; y++) {
      const half = Math.min(tw, 1 + Math.round((y / 11) * tw));
      tpx(c, ox + 24 - half, ty + y, half * 2 + 1, 1,
        y < 2 ? '#35804a' : y < 7 ? '#256b35' : '#1b5128');
      tpx(c, ox + 24 - half, ty + y, Math.min(2, half * 2 + 1), 1, y < 3 ? '#59b06a' : '#3f8f4f');
    }
    // under-tier shadow gives each skirt separation
    tpx(c, ox + 24 - tw, ty + 11, tw * 2 + 1, 1, '#123420');
  }
}

function paintPalm(c, ox) {
  for (let y = 0; y < 24; y++) {
    const bx = 24 + Math.round(Math.sin(y / 9) * 4);
    tpx(c, ox + bx, 44 - y, 3, 1, '#8a6238');
    tpx(c, ox + bx + 2, 44 - y, 1, 1, '#63431f');
  }
  const cx = 24 + Math.round(Math.sin(23 / 9) * 4);
  for (const [dx, dy, len] of [[-1, -1, 13], [1, -1, 13], [-1.6, 0.2, 11], [1.6, 0.2, 11], [0, -1.7, 12], [-0.6, 1, 9], [0.6, 1, 9]]) {
    for (let s = 2; s < len; s++) {
      const fx = cx + Math.round(dx * s);
      const fy = 20 + Math.round(dy * s + (s * s) / len * 0.9);
      c.fillStyle = s > len - 4 ? '#3f8f4f' : '#57b05e';
      c.fillRect(ox + fx, fy, 2, 2);
    }
  }
  c.fillStyle = '#c98a3f';
  c.fillRect(ox + cx - 1, 21, 3, 3);
}

function paintSnowPine(c, ox) {
  ttrunk(c, ox, 24, 38, 46, 1, ['#6b4526', '#4a3018', '#2e1d0c']);
  const tiers = [[10, 4, 1], [16, 7, 2], [23, 10, 3], [31, 13, 4]];
  c.fillStyle = '#1d4d33';
  for (let y = 0; y < 5; y++) {
    const half = Math.round(y / 2);
    c.fillRect(ox + 24 - half, 5 + y, half * 2 + 1, 1);
  }
  for (const [ty, tw, th] of tiers) {
    for (let y = 0; y < th + 4; y++) {
      const half = Math.min(tw, 1 + Math.round((y / (th + 3)) * tw));
      c.fillStyle = y < 3 ? '#2a6a44' : '#1d4d33';
      c.fillRect(ox + 24 - half, ty + y, half * 2 + 1, 1);
    }
  }
  c.fillStyle = '#eef4f8';
  for (const [ty, tw] of tiers) {
    for (let x = -tw; x <= tw; x++) {
      if (((x * 7 + ty * 13) % 5) < 3) c.fillRect(ox + 24 + x, ty, 1, 1);
    }
    c.fillRect(ox + 24, ty - 1, 1, 1);
  }
  c.fillRect(ox + 24, 5, 1, 1);
}

function paintDead(c, ox) {
  const B = '#5c4632', D = '#43321f';
  tpx(c, ox + 23, 26, 3, 20, B);
  tpx(c, ox + 23, 26, 1, 20, D);
  for (const [bx, by, tx, ty] of [
    [23, 30, 12, 18], [25, 27, 36, 14], [24, 34, 10, 32], [25, 32, 38, 28],
    [23, 40, 15, 38], [25, 38, 33, 40],
  ]) {
    const steps = Math.max(Math.abs(tx - bx), Math.abs(ty - by));
    for (let s = 0; s <= steps; s++) {
      const px = Math.round(bx + ((tx - bx) * s) / steps);
      const py = Math.round(by + ((ty - by) * s) / steps);
      c.fillStyle = s > steps - 3 ? D : B;
      c.fillRect(ox + px, py, 2, 2);
    }
  }
  c.fillStyle = '#6e563e';
  c.fillRect(ox + 22, 44, 5, 2);
}

function paintAgave(c, ox) {
  const G = '#5e9a58', D = '#3f7040', L = '#7cb56b';
  for (const [dx, dy, len] of [[-1, -0.15, 15], [1, -0.15, 15], [-0.55, -0.75, 13], [0.55, -0.75, 13], [0, -1, 14], [-0.2, 0.5, 10], [0.2, 0.5, 10]]) {
    for (let s = 2; s < len; s++) {
      const fx = 24 + Math.round(dx * s);
      const fy = 40 + Math.round(dy * s - s * s * 0.012);
      c.fillStyle = s > len - 5 ? D : (s % 3 ? G : L);
      c.fillRect(ox + fx, fy, 2, 2);
    }
  }
  tpx(c, ox + 23, 40, 3, 5, '#8a6a3a');
  tpx(c, ox + 22, 43, 5, 2, '#a8845a');
}

function paintAcacia(c, ox) {
  tpx(c, ox + 23, 30, 3, 16, '#6e5230');
  tpx(c, ox + 23, 30, 1, 16, '#52381c');
  tpx(c, ox + 12, 26, 8, 2, '#6e5230');
  tpx(c, ox + 29, 24, 8, 2, '#6e5230');
  tblob(c, ox + 24, 18, 18, 5, '#4d7a33');
  tblob(c, ox + 24, 16, 14, 4, '#699a41');
  tblob(c, ox + 21, 15, 7, 3, '#83b356');
  c.fillStyle = '#d8b25a';
  for (let i = 0; i < 6; i++) c.fillRect(ox + 12 + ((i * 11) % 24), 14 + ((i * 7) % 6), 1, 1);
}

function paintTumble(c, ox) {
  tblob(c, ox + 24, 38, 11, 9, '#a08a54');
  tblob(c, ox + 24, 36, 8, 7, '#bda878');
  c.fillStyle = '#8a7444';
  for (let i = 0; i < 5; i++) {
    for (let a = 0; a < 26; a++) {
      const ang = i * 1.3 + (a / 26) * 4.2;
      c.fillRect(ox + 24 + Math.round(Math.cos(ang) * (2 + i * 1.8)), 37 + Math.round(Math.sin(ang) * (1.6 + i * 1.5)), 1, 1);
    }
  }
  tpx(c, ox + 23, 45, 3, 2, '#8a7444');
}

function paintBamboo(c, ox) {
  for (const [bx, hgt, col, dcol] of [[17, 26, '#7fb069', '#5d8a4a'], [24, 34, '#93c47d', '#6da058'], [31, 22, '#7fb069', '#5d8a4a']]) {
    for (let y = 0; y < hgt; y++) {
      if (y % 7 === 6) continue;
      tpx(c, ox + bx, 45 - y, 3, 1, col);
      tpx(c, ox + bx + 2, 45 - y, 1, 1, dcol);
    }
  }
  for (const [lx, ly] of [[14, 18], [28, 12], [34, 24], [20, 8]]) {
    tpx(c, ox + lx, ly, 4, 1, '#a8d48a');
    tpx(c, ox + lx + 1, ly - 1, 3, 1, '#c0e0a0');
  }
}

function paintFern(c, ox) {
  for (const [dx, len] of [[-1.1, 16], [-0.6, 19], [0, 21], [0.6, 19], [1.1, 16]]) {
    for (let s = 1; s <= len; s++) {
      const fx = 24 + Math.round(dx * s);
      const fy = 45 - Math.round(s * 1.15 - (s * s) / (len * 1.6));
      c.fillStyle = s > len - 4 ? '#2f7a3f' : '#4fae5c';
      c.fillRect(ox + fx, fy, 2, 2);
      if (s % 3 === 0) tpx(c, ox + fx - 1, fy + 1, 1, 2, '#3f9e50');
    }
  }
  tpx(c, ox + 22, 44, 5, 2, '#5d4022');
}

function paintBirch(c, ox) {
  ttrunk(c, ox, 24, 24, 45, 1, ['#f4f0e6', '#e8e4da', '#b8b2a2']);
  c.fillStyle = '#3a3a34';
  for (let i = 0; i < 8; i++) {
    c.fillRect(ox + 22 + ((i * 5) % 4), 26 + ((i * 6) % 17), 2, 1);
  }
  tcanopy(c, ox + 23, 15, 13, 9, ['#2c6234', '#3f8a4a', '#5aa85e', '#8ed492'], 7);
  tblob(c, ox + 33, 19, 5, 4, '#35793f');
  tblob(c, ox + 32, 17, 3, 3, '#5aa85e');
}

function paintMaple(c, ox) {
  ttrunk(c, ox, 24, 27, 45, 2, ['#96613a', '#7a4a28', '#4c2c12']);
  tcanopy(c, ox + 24, 16, 16, 11, ['#173d20', '#2f7a3a', '#4a9a48', '#7ac86a'], 5);
  // maple's broad crown spills over the trunk on both sides
  tblob(c, ox + 10, 21, 5, 4, '#256b30');
  tblob(c, ox + 39, 20, 5, 4, '#256b30');
}

function paintBerry(c, ox) {
  tblob(c, ox + 24, 36, 13, 8, '#2c5c2a');
  tblob(c, ox + 24, 33, 11, 7, '#3f7d3a');
  tblob(c, ox + 21, 31, 7, 5, '#57a04e');
  c.fillStyle = '#7ab86a';
  for (let i = 0; i < 8; i++) c.fillRect(ox + 14 + ((i * 7) % 20), 28 + ((i * 5) % 9), 1, 1);
  c.fillStyle = '#8a4a5a';
  for (let i = 0; i < 5; i++) c.fillRect(ox + 16 + ((i * 9) % 16), 30 + ((i * 7) % 7), 2, 2);
}

function paintSpruce(c, ox) {
  ttrunk(c, ox, 24, 36, 46, 1, ['#6b4526', '#4a3018', '#2e1d0c']);
  const tiers = [[8, 3], [14, 5], [21, 8], [29, 11]];
  for (const [ty, tw] of tiers) {
    for (let y = 0; y < 9; y++) {
      const half = Math.min(tw, 1 + Math.round((y / 8) * tw));
      tpx(c, ox + 24 - half, ty + y, half * 2 + 1, 1,
        y < 2 ? '#2a6a3a' : y < 5 ? '#1e5630' : '#143f24');
      tpx(c, ox + 24 - half, ty + y, 1, 1, '#3f8f4f');
    }
    tpx(c, ox + 24 - tw, ty + 8, tw * 2 + 1, 1, '#0e2e1a');
  }
}

function paintFrostbush(c, ox) {
  tblob(c, ox + 24, 37, 12, 7, '#4a5a6a');
  tblob(c, ox + 24, 34, 9, 6, '#5d7285');
  tblob(c, ox + 22, 32, 6, 4, '#7a92a5');
  c.fillStyle = '#dce8f2';
  for (let i = 0; i < 10; i++) c.fillRect(ox + 14 + ((i * 7) % 20), 29 + ((i * 5) % 7), 1, 1);
  tpx(c, ox + 23, 43, 3, 3, '#3a4a56');
}

// --- rocks ------------------------------------------------------------------
function paintPebble(c, ox) {
  tpx(c, ox + 20, 41, 8, 3, '#7d7f83');
  tpx(c, ox + 21, 40, 6, 1, '#8d9094');
  tpx(c, ox + 22, 39, 4, 1, '#a3a6ab');
  tpx(c, ox + 21, 44, 6, 1, '#585a5e');
}
function paintRock(c, ox) {
  tpx(c, ox + 16, 36, 16, 8, '#77797e');
  tpx(c, ox + 18, 32, 12, 4, '#84868c');
  tpx(c, ox + 20, 30, 8, 2, '#96989e');
  tpx(c, ox + 16, 36, 5, 8, '#8f9196');
  tpx(c, ox + 27, 34, 5, 10, '#606267');
  tpx(c, ox + 22, 31, 3, 1, '#b0b3b8');
  tpx(c, ox + 23, 33, 1, 6, '#54565b');
  tpx(c, ox + 20, 38, 1, 4, '#54565b');
  tpx(c, ox + 16, 43, 16, 2, '#4e5054');
}
function paintBoulder(c, ox) {
  tpx(c, ox + 10, 30, 28, 14, '#6e7075');
  tpx(c, ox + 13, 24, 22, 6, '#7c7e84');
  tpx(c, ox + 18, 20, 12, 4, '#8b8d94');
  tpx(c, ox + 10, 30, 8, 14, '#88898f');
  tpx(c, ox + 31, 26, 7, 18, '#565860');
  tpx(c, ox + 20, 21, 5, 2, '#a8abb1');
  tpx(c, ox + 24, 24, 1, 12, '#4c4e53');
  tpx(c, ox + 18, 30, 1, 8, '#4c4e53');
  tpx(c, ox + 14, 27, 6, 2, '#5d8a52'); // moss
  tpx(c, ox + 28, 38, 5, 2, '#5d8a52');
  tpx(c, ox + 10, 43, 28, 2, '#46484d');
}

function paintGreatBush(c, ox) {
  tpx(c, ox + 23, 41, 3, 4, '#5a3a22');
  tblob(c, ox + 24, 33, 14, 8, '#245c2f');
  tblob(c, ox + 20, 28, 11, 6, '#2f7a3a');
  tblob(c, ox + 27, 26, 8, 5, '#3f9e4a');
  c.fillStyle = '#63c06a';
  for (let i = 0; i < 10; i++) {
    c.fillRect(ox + 12 + ((i * 7) % 22), 22 + ((i * 5) % 12), 2, 1);
  }
  c.fillStyle = '#d24a5a';
  for (const [bx, by] of [[17, 30], [26, 25], [31, 33], [21, 36]]) {
    c.fillRect(ox + bx, by, 2, 2);
  }
}

// blossom bush: soft green mound dotted with pink/white spring flowers
function paintBloom(c, ox) {
  tpx(c, ox + 23, 42, 3, 3, '#5a3a22');
  tblob(c, ox + 24, 35, 12, 7, '#2e6e38');
  tblob(c, ox + 20, 31, 9, 5, '#3d8a46');
  tblob(c, ox + 28, 29, 7, 4, '#4da355');
  c.fillStyle = '#f5b8cf';
  for (const [fx, fy] of [[16, 33], [22, 28], [28, 25], [33, 31], [19, 38], [30, 36], [25, 33]]) {
    c.fillRect(ox + fx, fy, 2, 2);
  }
  c.fillStyle = '#fff3f8';
  for (const [fx, fy] of [[23, 30], [31, 27], [18, 35]]) {
    c.fillRect(ox + fx, fy, 1, 1);
  }
}

// bramble tangle: dark wiry thicket with thorn specks and deep greens
function paintBramble(c, ox) {
  tpx(c, ox + 22, 41, 4, 4, '#4a3418');
  tblob(c, ox + 24, 33, 13, 8, '#1c4526');
  tblob(c, ox + 19, 30, 9, 5, '#26592f');
  tblob(c, ox + 29, 28, 8, 5, '#2f6b38');
  c.fillStyle = '#153318';
  for (let i = 0; i < 12; i++) {
    c.fillRect(ox + 13 + ((i * 9) % 20), 26 + ((i * 7) % 14), 2, 1);
  }
  c.fillStyle = '#8fae52';
  for (const [tx, ty] of [[17, 32], [24, 27], [31, 30], [21, 37], [29, 35]]) {
    c.fillRect(ox + tx, ty, 1, 1);
  }
}

const PAINTERS = {
  cactus: paintCactus, agave: paintAgave, acacia: paintAcacia,
  shrub: paintShrub, tumble: paintTumble,
  jungle: paintJungle, palm: paintPalm, bamboo: paintBamboo, fern: paintFern,
  oak: paintOak, pine: paintPine, birch: paintBirch, maple: paintMaple, berry: paintBerry,
  apple: paintApple,
  snowpine: paintSnowPine, spruce: paintSpruce, dead: paintDead, frostbush: paintFrostbush,
  pebble: paintPebble, rock: paintRock, boulder: paintBoulder, greatbush: paintGreatBush,
  bloom: paintBloom, bramble: paintBramble,
};

// --- programmatic seasonal variants --------------------------------------
// Everything works on raw ImageData: canvas->canvas drawImage is unreliable
// during early page load, while fillRect / getImageData / putImageData are
// not. Painters draw straight into the atlas; seasons are derived per pixel.
const isFoliagePx = (r, g, b) => g > r + 8 && g > b + 8;

function mapPixelsData(d, fn) {
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    const out = fn(d[i], d[i + 1], d[i + 2]);
    if (out) {
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
    }
  }
}

function sprinkleData(d, size, r, g, b, n, yMaxFrac) {
  const w = size, h = size;
  let placed = 0, guard = 0;
  while (placed < n && guard++ < n * 40) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h * yMaxFrac);
    const i = (y * w + x) * 4;
    if (d[i + 3] > 10) {
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      placed++;
    }
  }
}

// Derive [spring, autumn, winter] ImageDatas from the painted summer cell.
function deriveSeasons(summer, opts) {
  const mk = () => new ImageData(new Uint8ClampedArray(summer.data), summer.width, summer.height);
  // SPRING: fresh pale-green foliage, blossoms on deciduous kinds
  const spring = mk();
  mapPixelsData(spring.data, (r, g, b) =>
    isFoliagePx(r, g, b)
      ? [Math.min(255, r * 0.82 + 34), Math.min(255, g * 0.98 + 26), Math.min(255, b * 0.75 + 16)]
      : null
  );
  if (opts.blossom) sprinkleData(spring.data, summer.width, 246, 202, 222, 20, 0.62);
  // AUTUMN: foliage lerps toward the kind's own tint; evergreens barely shift
  const autumn = mk();
  if (opts.autumn) {
    const tr = opts.autumn[0], tg = opts.autumn[1], tb = opts.autumn[2];
    mapPixelsData(autumn.data, (r, g, b) =>
      isFoliagePx(r, g, b)
        ? [Math.round(r * 0.25 + tr * 0.75), Math.round(g * 0.25 + tg * 0.75), Math.round(b * 0.25 + tb * 0.75)]
        : [r * 0.9 | 0, g * 0.88 | 0, b * 0.85 | 0]
    );
  } else {
    mapPixelsData(autumn.data, (r, g, b) => [r * 0.92 | 0, g * 0.94 | 0, b * 0.96 | 0]);
  }
  if (opts.berries) sprinkleData(autumn.data, summer.width, 224, 58, 58, 12, 0.7);
  // WINTER: desaturated + darker, snow dust settles on upward-facing pixels
  const winter = mk();
  const d = winter.data;
  const W = winter.width;
  for (let y = 0; y < winter.height; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 10) continue;
      const lum = (d[i] * 0.35 + d[i + 1] * 0.5 + d[i + 2] * 0.15) | 0;
      d[i] = lum * 0.72 | 0;
      d[i + 1] = lum * 0.76 | 0;
      d[i + 2] = lum * 0.86 | 0;
      const above = y === 0 ? 0 : d[((y - 1) * W + x) * 4 + 3];
      if (above < 10 && Math.random() < 0.8) {
        d[i] = 236; d[i + 1] = 242; d[i + 2] = 250;
      }
    }
  }
  return { spring, autumn, winter };
}

const treeAtlasCanvas = document.createElement('canvas');
treeAtlasCanvas.width = ATLAS_CELL * ATLAS_COLS;
treeAtlasCanvas.height = ATLAS_CELL * ATLAS_ROWS;
// Pixel readback is unreliable while the page is still loading (blank
// canvases in some environments), so the atlas is built on the first
// animation frame instead of during module evaluation. Every texture and
// panel preview that snapshots the atlas refreshes afterwards.
let atlasBuilt = false;
// per-kind art bounds [a0, a1, b0, b1] in atlas pixels, measured from the
// painted summer cell. The shader samples exactly this rect, so no tree ever
// bleeds its neighbour's pixels at the cell edges (and all four season rows
// share the same bounds — seasons only recolour or sprinkle onto the base).
const TREE_CELL_BOUNDS = [];
function buildTreeAtlas() {
  const ac = treeAtlasCanvas.getContext('2d');
  KIND_ORDER.forEach((kind, col) => {
    const x0 = col * ATLAS_CELL;
    // paint the summer base straight into the atlas (row 1). Painters use
    // cell-LOCAL coordinates, so translate the context to the cell origin
    // instead of passing an x offset (which would leave the y in row 0!)
    ac.save();
    ac.translate(x0, ATLAS_CELL);
    PAINTERS[kind](ac, 0);
    ac.restore();
    // derive the other three season rows from those exact pixels
    const summer = ac.getImageData(x0, ATLAS_CELL, ATLAS_CELL, ATLAS_CELL);
    const sd = summer.data;
    let a0 = ATLAS_CELL, a1 = -1, b0 = ATLAS_CELL, b1 = -1;
    for (let y = 0; y < ATLAS_CELL; y++) {
      for (let x = 0; x < ATLAS_CELL; x++) {
        if (sd[(y * ATLAS_CELL + x) * 4 + 3] > 10) {
          if (x < a0) a0 = x; if (x > a1) a1 = x;
          if (y < b0) b0 = y; if (y > b1) b1 = y;
        }
      }
    }
    TREE_CELL_BOUNDS[col] =
      a1 >= 0 ? [a0, a1, b0, b1] : [0, ATLAS_CELL - 1, 0, ATLAS_CELL - 1];
    const seaso = deriveSeasons(summer, TREE_KINDS[kind]);
    ac.putImageData(seaso.spring, x0, 0);
    ac.putImageData(seaso.autumn, x0, 2 * ATLAS_CELL);
    ac.putImageData(seaso.winter, x0, 3 * ATLAS_CELL);
  });
  atlasBuilt = true;
  // re-upload every texture that snapshots this canvas
  treeAtlasTex.needsUpdate = true;
  for (const g of ghostTrees) g.material.map.needsUpdate = true;
  for (const p of placedTrees) {
    p.sprA.material.map.needsUpdate = true;
    p.sprB.material.map.needsUpdate = true;
  }
  buildIconAtlas();
}
const treeAtlasTex = new THREE.CanvasTexture(treeAtlasCanvas);
treeAtlasTex.magFilter = THREE.NearestFilter;
treeAtlasTex.minFilter = THREE.NearestFilter;

// Sprites render in the late transparent pass (after all opaque terrain),
// with depth TESTING on but depth WRITING off: the terrain can never
// overwrite a sprite it rendered before, sprites can't wrongly occlude
// each other through their depth bias, and real hills still hide sprites
// behind them. renderOrder 2 = after terrain (0) and blob shadows (1),
// before the water plane and overlays.
const treeMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  renderOrder: 2,
  uniforms: {
    uTex: { value: treeAtlasTex },
    uFogColor: { value: new THREE.Color(0x8fb7d9) },
    uFogNear: { value: 100 },
    uFogFar: { value: 210 },
    uTime: { value: 0 },
    uWindPow: { value: 0 },
    uWindAng: { value: 0.7 },
    uShadeNear: { value: VIEW_DIST * 0.22 },
    uShadeFar: { value: VIEW_DIST * 0.98 },
    uSnow: { value: 0 },
    uParched: { value: 0 },
    uSeasonA: { value: 1 },
    uSeasonB: { value: 2 },
    uBlend: { value: 0 },
    uDay: { value: 1 },
    uDusk: { value: 0 },
    uInvW: { value: 1 / (ATLAS_CELL * ATLAS_COLS) },
    uInvH: { value: 1 / (ATLAS_CELL * ATLAS_ROWS) },
  },
  vertexShader: `
    attribute vec3 iPos;
    attribute float iU;
    attribute float iH;
    attribute float iPhase;
    attribute float aLift;
    attribute vec2 aU;   // art x-bounds [a0, a1] in atlas pixels
    attribute vec2 aV;   // art y-bounds [b0, b1] in atlas pixels
    varying float vU;
    varying vec2 vAU;
    varying vec2 vAV;
    varying vec2 vQuad;
    varying float vDist;
    varying float vWorldY;
    uniform float uTime;
    uniform float uWindPow;
    uniform float uWindAng;
    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 345.45));
      p += dot(p, p + 34.345);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    void main() {
      vU = iU;
      vAU = aU;
      vAV = aV;
      vQuad = position.xy;
      // regional wind field: every part of the map drifts with its own
      // direction and strength on top of the global weather wind
      vec2 wp = iPos.xz * 0.02;
      float gt = uTime * 0.22;
      float regDir = vnoise(wp * 0.07 + vec2(gt * 0.06, -gt * 0.04));
      float regPow = vnoise(wp * 0.11 + vec2(-gt * 0.05, gt * 0.07));
      float lang = uWindAng + (regDir - 0.5) * 6.2831853
                 + (vnoise(wp * 0.6 + vec2(gt * 0.31, gt * 0.11)) - 0.5) * 2.0;
      float lmag = uWindPow * (0.15 + 1.7 * regPow)
                 * (0.3 + 1.4 * vnoise(wp * 1.3 + vec2(gt * 0.43, -gt * 0.19)));
      vec2 wdir = vec2(cos(lang), sin(lang));
      float flutter = sin(uTime * (1.5 + vnoise(wp + 7.3)) + iPhase);
      // bend in WORLD space so orbiting the camera never spins the tree
      vec3 bendWorld = vec3(wdir.x, 0.0, wdir.y) * (flutter * lmag * position.y * iH * 0.14);
      // steep-camera response: viewed from above, a tree rises a little and
      // tilts back away from the viewer instead of sinking into its block
      vec3 toCam = cameraPosition - iPos;
      float distC = max(length(toCam), 0.001);
      float vertK = clamp(toCam.y / distC, 0.0, 1.0);
      float tiltA = vertK * vertK * 0.55;
      vec2 dirXZ = toCam.xz / max(length(toCam.xz), 0.001);
      // anchor every plant to the block edge FACING the camera: hugging the
      // rim grounds it against the block face below (no mid-block floating),
      // while looking straight down eases it back to the centre. Kept small:
      // a big sideways slide walks the sprite into taller neighbour blocks
      // and buries it at grazing angles.
      float edgeAmt = (1.0 - vertK) * 0.16 * (1.0 - aLift * 0.4);
      vec3 basePos = iPos + vec3(dirXZ.x, 0.0, dirXZ.y) * edgeAmt + bendWorld;
      basePos.y += vertK * vertK * (0.10 + iH * 0.02);
      // low sprites (bushes, rocks): tilt/rise toward the camera like the
      // tall trees do, so steep angles never sink them into the block
      basePos.y += aLift * vertK * vertK * (0.75 + iH * 0.16);
      // low sprites also get a small permanent rise (a touch more when the
      // view goes grazing) so their base always clears the block edge
      // they stand on, instead of hiding behind it at eye level
      float horizK = 1.0 - vertK;
      basePos.y += aLift * (0.14 + 0.12 * horizK * horizK);
      float cta = cos(tiltA), sta = sin(tiltA);
      vec3 rightA = vec3(dirXZ.y, 0.0, -dirXZ.x);
      vec3 upA = vec3(-dirXZ.x * sta, cta, -dirXZ.y * sta);
      vec3 wpq = basePos + rightA * (position.x * iH) + upA * (position.y * iH);
      vec4 mv = viewMatrix * vec4(wpq, 1.0);
      // pull toward the camera so slopes/rises can't slice the billboard,
      // but strictly proportional to distance: a fixed minimum would shove
      // close trees behind the near plane and clip them in half
      float safeD = max(-mv.z, 0.001);
      float pull = min(safeD * 0.045, 5.0) * (0.55 + 0.45 * position.y);
      // low sprites (rocks, bushes) get extra proportional clearance so
      // nearby bumps can never swallow them while orbiting the camera
      pull += aLift * min(safeD * 0.07, 7.0);
      mv.z -= pull;
      mv.z = min(mv.z, -0.8); // never cross the near plane
      // depth advantage vs the ground they stand on: strong enough that
      // lower ground in front never swallows them mid-body, but far-away
      // hills still occlude naturally (bias fades with distance)
      mv.z -= (0.55 + aLift * 0.85) * clamp(1.35 - safeD * 0.008, 0.35, 1.0);
      // eye-level guarantee for low sprites (rocks, bushes): at grazing
      // angles the next terrain row over can sit several units closer to
      // the camera and swallow them entirely — subtract view depth that
      // scales with how horizontal the view is (zero when looking down),
      // with a floor so even point-blank ground can never cover them
      mv.z -= aLift * horizK * horizK * max(min(safeD * 0.20, 22.0), 1.1);
      mv.z = min(mv.z, -0.35); // stay in front of the near plane
      vDist = max(-mv.z, 1.0);
      vWorldY = wpq.y;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform sampler2D uTex;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uShadeNear;
    uniform float uShadeFar;
    uniform float uSnow;
    uniform float uParched;
    uniform float uInvW;   // 1 / atlas width in pixels
    uniform float uInvH;   // 1 / atlas height in pixels
    varying float vU;
    varying vec2 vAU;
    varying vec2 vAV;
    varying vec2 vQuad;
    varying float vDist;
    varying float vWorldY;
    uniform float uSeasonA;
    uniform float uSeasonB;
    uniform float uBlend;
    uniform float uDay;
    uniform float uDusk;
    void main() {
      // seasonal crossfade: sample the current season row and the next one,
      // blend by the same smooth weight the sky/terrain use. The quad maps
      // exactly onto this species' painted art rect, so the billboard shows
      // the tree and only the tree — never its neighbour's edge pixels.
      float ra = uSeasonA / 4.0;
      float rb = uSeasonB / 4.0;
      vec2 ab = vAU;
      vec2 cd = vAV;
      float ux = vU + (ab.x + 0.5) * uInvW + (vQuad.x + 0.5) * (ab.y - ab.x) * uInvW;
      float uyA = ra + (cd.x + 0.5) * uInvH + vQuad.y * (cd.y - cd.x) * uInvH;
      float uyB = rb + (cd.x + 0.5) * uInvH + vQuad.y * (cd.y - cd.x) * uInvH;
      vec2 uvA = vec2(ux, uyA);
      vec2 uvB = vec2(ux, uyB);
      vec4 col = mix(texture2D(uTex, uvA), texture2D(uTex, uvB), uBlend);
      if (col.a < 0.5) discard;
      // snow settles on the upper canopy; drought browns the whole tree
      float snowK = uSnow * smoothstep(0.15, 0.75, vQuad.y);
      col.rgb = mix(col.rgb, vec3(0.93, 0.95, 0.99), snowK * 0.85);
      col.rgb *= mix(vec3(1.0), vec3(1.25, 1.02, 0.6), uParched * (0.35 + 0.65 * vQuad.y));
      // sun / night lighting: warm at noon, moonlit blue at night,
      // orange wash at dusk
      col.rgb *= mix(vec3(0.30, 0.34, 0.50), vec3(1.06, 1.02, 0.94), uDay);
      col.rgb *= mix(vec3(1.0), vec3(1.22, 0.84, 0.58), uDusk * 0.6);
      float shadeDistK = smoothstep(uShadeNear, uShadeFar, vDist);
      float shadeLowK = clamp(1.0 - (vWorldY - 6.0) / 30.0, 0.0, 1.0);
      col.rgb *= mix(1.0, mix(0.72, 0.42, shadeLowK), shadeDistK);
      float f = smoothstep(uFogNear, uFogFar, vDist);
      gl_FragColor = vec4(mix(col.rgb, uFogColor, f), 1.0);
    }
  `,
});

// Biome classification mirroring colorFor's moisture/height bands
// (snow treeline sits slightly below the 58+ snow-capped peaks)
function biomeAt(wx, wz) {
  const s = terrainHeight(wx, wz, SEED);
  if (s <= SEA_LEVEL + 1) return null;
  if (s > 50) return 'snow';
  if (s > 44) return null;
  const moist = fbm2(wx * 0.01, wz * 0.01, SEED + 333, 2);
  if (moist > 0.58) return 'jungle';
  if (moist < 0.34) return 'desert';
  return 'forest';
}

// Tree placement: one jittered candidate per 3-unit world cell, kept only if
// no neighbour cell's candidate is closer than MIN_TREE_DIST. Fully
// deterministic and chunk-seam-free; salts differ from the old layout so
// every forest regenerates from scratch.
const TREE_CELL = 3;
const MIN_TREE_DIST = 2.5;
// natural tree growth: every biome grows its own wild species mix
const NATURAL_TREES = true;

function treeCandidate(ix, iz) {
  const jx = ix * TREE_CELL + hash3(ix, 7, iz, SEED + 917) * TREE_CELL;
  const jz = iz * TREE_CELL + hash3(ix, 8, iz, SEED + 918) * TREE_CELL;
  return { jx, jz };
}

function treeForCell(ix, iz) {
  if (!NATURAL_TREES) return null;
  const { jx, jz } = treeCandidate(ix, iz);
  const biome = biomeAt(jx, jz);
  if (!biome) return null;
  // density rescaled: one candidate max per TREE_CELL² area
  if (hash3(ix, 6, iz, SEED + 916) >= TREE_DENSITY[biome] * TREE_CELL * TREE_CELL)
    return null;
  // minimum spacing: reject if any live neighbour candidate is too close
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const nx = ix + dx, nz = iz + dz;
      const nb = treeCandidate(nx, nz);
      const nbiome = biomeAt(nb.jx, nb.jz);
      if (!nbiome) continue;
      if (hash3(nx, 6, nz, SEED + 916) >= TREE_DENSITY[nbiome] * TREE_CELL * TREE_CELL)
        continue;
      const ddx = nb.jx - jx, ddz = nb.jz - jz;
      if (ddx * ddx + ddz * ddz < MIN_TREE_DIST * MIN_TREE_DIST) return null;
    }
  }
  // pick a wild species from this biome's mix
  const list = BIOME_TREES[biome];
  const kind = list[Math.floor(hash3(ix, 5, iz, SEED + 915) * list.length)];
  return {
    kind,
    x: jx,
    z: jz,
    scale: 0.85 + hash3(ix, 3, iz, SEED + 913) * 0.35,
  };
}

function buildChunkTrees(cx, cz, lod = 0) {
  const startX = cx * CHUNK, startZ = cz * CHUNK;
  const items = [];
  const i0 = Math.floor(startX / TREE_CELL);
  const i1 = Math.floor((startX + CHUNK - 1) / TREE_CELL);
  const k0 = Math.floor(startZ / TREE_CELL);
  const k1 = Math.floor((startZ + CHUNK - 1) / TREE_CELL);
  for (let ix = i0; ix <= i1; ix++) {
    for (let iz = k0; iz <= k1; iz++) {
      // single ownership: only the chunk containing the cell's center builds it
      if (Math.floor((ix * TREE_CELL + TREE_CELL / 2) / CHUNK) !== cx) continue;
      if (Math.floor((iz * TREE_CELL + TREE_CELL / 2) / CHUNK) !== cz) continue;
      const tr = treeForCell(ix, iz);
      if (!tr) continue;
      // anchor every tree to the centre of the voxel block it spawned on so
      // its feet always sit exactly on that block's top face
      tr.x = Math.round(tr.x);
      tr.z = Math.round(tr.z);
      const dx = tr.x - homePos.x, dz = tr.z - homePos.z;
      if (dx * dx + dz * dz < 30) continue;
      tr.gy = groundYAt(tr.x, tr.z);
      items.push(tr);
    }
  }
  if (!items.length) return null;
  const sample = items[Math.floor(items.length / 2)];
  const n = items.length;
  const iPos = new Float32Array(n * 3);
  const iU = new Float32Array(n);
  const iH = new Float32Array(n);
  const iPhase = new Float32Array(n);
  const iCol = new Float32Array(n); // species index for the far-zoom icons
  const iLift = new Float32Array(n); // bushes/rocks hug the ground: lift them
  const aU = new Float32Array(n * 2); // art x-bounds per instance (atlas px)
  const aV = new Float32Array(n * 2); // art y-bounds per instance (atlas px)
  const cols = [];
  let maxY = SEA_LEVEL;
  for (let i = 0; i < n; i++) {
    const tr = items[i];
    const gy = groundYAt(tr.x, tr.z);
    iPos[i * 3] = tr.x;
    iPos[i * 3 + 1] = gy + 0.09;
    iPos[i * 3 + 2] = tr.z;
    iU[i] = KIND_COL[tr.kind];
    iCol[i] = KIND_ORDER.indexOf(tr.kind);
    iLift[i] = TREE_KINDS[tr.kind].type === 'tree' ? 0 : 1;
    iH[i] = TREE_KINDS[tr.kind].h * tr.scale;
    iPhase[i] = hash3(tr.x, 4, tr.z, SEED + 914) * Math.PI * 2;
    const b = TREE_CELL_BOUNDS[iCol[i]] || [0, ATLAS_CELL - 1, 0, ATLAS_CELL - 1];
    aU[i * 2] = b[0]; aU[i * 2 + 1] = b[1];
    aV[i * 2] = b[2]; aV[i * 2 + 1] = b[3];
    maxY = Math.max(maxY, gy + iH[i]);
    cols.push({ x: tr.x, z: tr.z, r: TREE_KINDS[tr.kind].r * tr.scale });
  }
  // one quad per tree (instanced): corners in position attr, per-tree data instanced
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0],
      3
    )
  );
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  g.setAttribute('iU', new THREE.InstancedBufferAttribute(iU, 1));
  g.setAttribute('iH', new THREE.InstancedBufferAttribute(iH, 1));
  g.setAttribute('iPhase', new THREE.InstancedBufferAttribute(iPhase, 1));
  g.setAttribute('aLift', new THREE.InstancedBufferAttribute(iLift, 1));
  g.setAttribute('aU', new THREE.InstancedBufferAttribute(aU, 2));
  g.setAttribute('aV', new THREE.InstancedBufferAttribute(aV, 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(startX + CHUNK / 2, (SEA_LEVEL + maxY) / 2, startZ + CHUNK / 2),
    CHUNK + Math.max(14, (maxY - SEA_LEVEL) / 2 + 8)
  );
  const mesh = new THREE.Mesh(g, treeMat);
  mesh.userData.cols = cols;
  mesh.userData.sampleTree = sample;
  // h = per-tree sprite height, so zoomed-out markers can float above
  // the tallest tree in their cluster instead of sitting at ground level
  mesh.userData.iconData = { pos: iPos, col: iCol, h: iH };
  if (lod === 0) mesh.userData.shadow = buildChunkShadows(items, startX, startZ);
  return mesh;
}

// --- soft blob shadows under trees ---------------------------------------
// one shared material: the sun offset / strength uniforms are global, so
// every shadow on the map swings with the sun and fades at night together
const shadowMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uSunOff: { value: new THREE.Vector2(0.3, 0.2) },
    uShadowStr: { value: 0.4 },
  },
  vertexShader: `
    attribute vec3 iPos;
    attribute float iH;
    uniform vec2 uSunOff;
    varying vec2 vQ;
    void main() {
      vQ = position.xy;
      // flat quad on the ground, pushed away from the sun; low sun = longer throw
      vec3 w = vec3(
        iPos.x + uSunOff.x * iH + position.x * iH * 0.42,
        iPos.y + 0.07,
        iPos.z + uSunOff.y * iH + position.y * iH * 0.42
      );
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uShadowStr;
    varying vec2 vQ;
    void main() {
      float a = smoothstep(1.0, 0.25, length(vQ)) * uShadowStr;
      if (a < 0.01) discard;
      gl_FragColor = vec4(0.04, 0.06, 0.10, a);
    }
  `,
});

const shadowUnitQuad = new THREE.Float32BufferAttribute(
  [-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0],
  3
);
const shadowIndex = [0, 1, 2, 2, 1, 3];

function buildChunkShadows(items, startX, startZ) {
  const n = items.length;
  const iPos = new Float32Array(n * 3);
  const iH = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tr = items[i];
    iPos[i * 3] = tr.x;
    iPos[i * 3 + 1] = tr.gy;
    iPos[i * 3 + 2] = tr.z;
    iH[i] = TREE_KINDS[tr.kind].h * tr.scale;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', shadowUnitQuad);
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  g.setAttribute('iH', new THREE.InstancedBufferAttribute(iH, 1));
  g.setIndex(shadowIndex);
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(startX + CHUNK / 2, SEA_LEVEL, startZ + CHUNK / 2),
    CHUNK * 1.5
  );
  return new THREE.Mesh(g, shadowMat);
}

// Ghost previews per placeable kind
const ghosts = { caveman: ghostFire };
const ghostTrees = [];
for (const kind of KIND_ORDER) {
  const gt = treeAtlasTex.clone();
  gt.needsUpdate = true;
  gt.repeat.set(COL_FRAC, ROW_FRAC);
  gt.offset.set(KIND_COL[kind], ROW_FRAC); // summer row
  const gs = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: gt,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    })
  );
  gs.scale.set(TREE_KINDS[kind].h, TREE_KINDS[kind].h, 1);
  gs.center.set(0.5, 0);
  gs.visible = false;
  scene.add(gs);
  ghosts[kind] = gs;
  ghostTrees.push(gs);
}

// soft round shadow decal for user-placed trees
const blobTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, 'rgba(8,14,24,0.85)');
  gr.addColorStop(1, 'rgba(8,14,24,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const blobMatSingle = new THREE.MeshBasicMaterial({
  map: blobTex,
  transparent: true,
  depthWrite: false,
  opacity: 0.4,
});

// User-placed trees: two stacked sprites sample the current and next
// season rows; their opacities follow the global season blend so placed
// trees crossfade between seasonal looks exactly like wild ones.
const placedTrees = [];

function spawnPlacedTree(kind, x, z, scaleMul = 1) {
  // anchor to the block the user pointed at
  x = Math.round(x);
  z = Math.round(z);
  const mk = (row) => {
    const pt = treeAtlasTex.clone();
    pt.needsUpdate = true;
    // sample exactly this species' painted art rect: no neighbour-cell bleed
    // at the sprite edges, and placed trees match the wild ones pixel for pixel
    const b = TREE_CELL_BOUNDS[KIND_ORDER.indexOf(kind)] || [0, ATLAS_CELL - 1, 0, ATLAS_CELL - 1];
    pt.repeat.set(
      (b[1] - b[0] + 1) / (ATLAS_CELL * ATLAS_COLS),
      (b[3] - b[2] + 1) / (ATLAS_CELL * ATLAS_ROWS)
    );
    pt.offset.set(
      (KIND_COL[kind] * ATLAS_CELL * ATLAS_COLS + b[0]) / (ATLAS_CELL * ATLAS_COLS),
      (row * ATLAS_CELL + b[2]) / (ATLAS_CELL * ATLAS_ROWS)
    );
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: pt,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -8,
        polygonOffsetUnits: -8,
      })
    );
    spr.center.set(0.5, 0);
    spr.scale.set(TREE_KINDS[kind].h * scaleMul, TREE_KINDS[kind].h * scaleMul, 1);
    // render above the translucent water plane so sea behind never tints
    // the leaves when the camera looks across a bay
    spr.renderOrder = 20;
    return spr;
  };
  const gy = groundYAt(x, z) + 0.03;
  const sprA = mk(1);
  const sprB = mk(2);
  sprA.position.set(x, gy, z);
  sprB.position.set(x, gy, z);
  sprB.material.opacity = 0;
  scene.add(sprA);
  scene.add(sprB);
  // blob shadow sized to the kind
  const sz = TREE_KINDS[kind].h * 0.84 * scaleMul;
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), blobMatSingle);
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(x, groundYAt(x, z) + 0.06, z);
  blob.renderOrder = 1;
  scene.add(blob);
  placedTrees.push({
    kind,
    sprA,
    sprB,
    blob,
    col: { x, z, r: TREE_KINDS[kind].r * scaleMul },
  });
}

function clearPlacedTrees() {
  for (const s of placedTrees) {
    for (const spr of [s.sprA, s.sprB]) {
      scene.remove(spr);
      spr.material.map.dispose();
      spr.material.dispose();
    }
    scene.remove(s.blob);
    s.blob.geometry.dispose();
    if (s.iconSpr) {
      scene.remove(s.iconSpr);
      s.iconSpr.material.dispose();
      s.iconSpr = null;
    }
  }
  placedTrees.length = 0;
}

// ============================================================================
// Fish: six pixel species cruising the sea in lazy elliptical loops
// ============================================================================

const FISH_CELL = 32;
const FISH_COLS = 6;
const FISH_KINDS = [
  { label: 'Sardine',   body: '#b8c4cc', belly: '#e8eef2', fin: '#93a3ad', stripe: null },
  { label: 'Clownfish', body: '#f4772e', belly: '#ffb066', fin: '#ff9a3c', stripe: '#ffffff' },
  { label: 'Blue Tang', body: '#2e6fd4', belly: '#5aa0f0', fin: '#ffd54a', stripe: '#123c8a' },
  { label: 'Angelfish', body: '#e8d44a', belly: '#fff1a8', fin: '#c9b52e', stripe: '#33383f' },
  { label: 'Puffer',    body: '#c8b46a', belly: '#efe3b0', fin: '#a08a45', stripe: '#5c4f28' },
  { label: 'Tuna',      body: '#4a6a94', belly: '#c8d8e8', fin: '#35516f', stripe: '#22364a' },
];

// one painter, parameterised per species; frame B swings the tail
function paintFish(c, ox, oy, k, frameB) {
  const tailSwing = frameB ? 3 : -2;
  // tail fin
  c.fillStyle = k.fin;
  c.fillRect(ox + 2 + (frameB ? 1 : 0), oy + 14, 5, 4);
  c.fillRect(ox + 2, oy + 13 + tailSwing * 0.5 | 0, 4, 2);
  // body ellipse-ish stack
  c.fillStyle = k.body;
  c.fillRect(ox + 6, oy + 12, 18, 8);
  c.fillRect(ox + 9, oy + 10, 12, 12);
  c.fillRect(ox + 12, oy + 9, 7, 2);
  // belly
  c.fillStyle = k.belly;
  c.fillRect(ox + 10, oy + 17, 13, 4);
  // dorsal fin
  c.fillStyle = k.fin;
  c.fillRect(ox + 13, oy + 6 + (frameB ? -1 : 0), 7, 3);
  // stripes
  if (k.stripe) {
    c.fillStyle = k.stripe;
    c.fillRect(ox + 15, oy + 10, 2, 9);
    c.fillRect(ox + 20, oy + 11, 2, 8);
  }
  // eye
  c.fillStyle = '#14181d';
  c.fillRect(ox + 21, oy + 12, 2, 2);
  c.fillStyle = '#ffffff';
  c.fillRect(ox + 21, oy + 12, 1, 1);
  // gill line
  c.fillStyle = k.fin;
  c.fillRect(ox + 19, oy + 11, 1, 8);
}

const fishAtlasCanvas = document.createElement('canvas');
fishAtlasCanvas.width = FISH_CELL * FISH_COLS;
fishAtlasCanvas.height = FISH_CELL * 2;
const fishAtlasTex = new THREE.CanvasTexture(fishAtlasCanvas);
fishAtlasTex.magFilter = THREE.NearestFilter;
fishAtlasTex.minFilter = THREE.NearestFilter;
fishAtlasTex.colorSpace = THREE.SRGBColorSpace;

let fishAtlasBuilt = false;

function buildFishAtlas() {
  const g = fishAtlasCanvas.getContext('2d');
  g.clearRect(0, 0, fishAtlasCanvas.width, fishAtlasCanvas.height);
  FISH_KINDS.forEach((k, i) => {
    paintFish(g, i * FISH_CELL + 2, 0, k, false);  // row 0: tail left
    paintFish(g, i * FISH_CELL + 2, FISH_CELL, k, true); // row 1: tail right
  });
  fishAtlasTex.needsUpdate = true;
  fishAtlasBuilt = true;
}

// loop-swim shader: every fish cruises a private elliptical circuit, bobs on
// the swell, flips to face its travel direction and flaps between frames
const fishMat = new THREE.ShaderMaterial({
  uniforms: {
    uTex: { value: fishAtlasTex },
    uTime: { value: 0 },
    uDay: { value: 1 },
    uFogColor: { value: new THREE.Color(0x8fb7d9) },
    uFogNear: { value: 100 },
    uFogFar: { value: 210 },
  },
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide, // visible from below the surface too (diving view)
  vertexShader: `
    attribute vec3 iPos;
    attribute float iCol;
    attribute float iPhase;
    attribute float iSpeed;
    attribute float iAng;   // school heading: each shoal cruises its own way
    varying float vU;
    varying float vRowBlend;
    varying vec2 vQuad;
    varying float vDist;
    uniform float uTime;
    void main() {
      vU = iCol / ${FISH_COLS.toFixed(1)};
      vQuad = position.xy;
      float t = uTime * iSpeed + iPhase * 6.2831853;
      // private elliptical loop around the school anchor, rotated by the
      // school's heading — so every shoal swims in its own random direction
      // while each fish keeps its own phase around the loop
      float rx = 2.2 + fract(iPhase * 13.7) * 3.4;
      float rz = 1.6 + fract(iPhase * 7.3) * 2.6;
      float cx = cos(t) * rx;
      float cz = sin(t) * rz;
      float ca = cos(iAng), sa = sin(iAng);
      vec3 p = iPos;
      p.x += cx * ca - cz * sa;
      p.z += cx * sa + cz * ca;
      p.y += sin(uTime * 1.3 + iPhase * 9.0) * 0.12;   // swell bob
      // face the direction of travel relative to the camera
      vec3 toCam = cameraPosition - p;
      vec2 vel = mat2(ca, sa, -sa, ca) * vec2(-sin(t) * rx, cos(t) * rz);
      float rightDot = vel.x * -sin(atan(toCam.z, toCam.x))
                     + vel.y * cos(atan(toCam.z, toCam.x));
      float flip = step(0.0, rightDot);
      vRowBlend = flip;
      vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x));
      vec3 wpq = p + right * position.x * 1.05
                   + vec3(0.0, 1.0, 0.0) * position.y * 1.05;
      vec4 mv = viewMatrix * vec4(wpq, 1.0);
      mv.z += 0.03; // tiny nudge so the plane never z-fights the sprite
      // gentle pull toward the camera only when truly close (never drags the
      // school up out of the water column at distance)
      mv.z -= min(max(-mv.z, 1.0) * 0.015, 0.8);
      vDist = max(-mv.z, 1.0);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform sampler2D uTex;
    uniform float uDay;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    varying float vU;
    varying float vRowBlend;
    varying vec2 vQuad;
    varying float vDist;
    void main() {
      float colW = 1.0 / ${FISH_COLS.toFixed(1)};
      float rowH = 0.5;
      float u = vU + (vQuad.x * 0.5 + 0.5) * colW;
      if (vRowBlend > 0.5) u = vU + (0.5 - vQuad.x * 0.5) * colW;
      float flap = step(0.5, fract(vDist * 0.0 + vRowBlend)); // stable pick
      float y0 = vRowBlend > 0.5 ? rowH : 0.0;
      vec2 uv = vec2(u, y0 + (vQuad.y * 0.5 + 0.5) * rowH);
      vec4 c = texture2D(uTex, uv);
      if (c.a < 0.4) discard;
      // submerged tint + day/night (kept bright so schools read through waves)
      c.rgb *= mix(vec3(0.82, 0.9, 0.98), vec3(1.02), uDay);
      float f = smoothstep(uFogNear, uFogFar, vDist);
      gl_FragColor = vec4(mix(c.rgb, uFogColor, f), 0.95);
    }
  `,
});

// --- scatter & lifecycle -----------------------------------------------------
// sparse schools: one per ~7.5-unit cell, ~45% of cells, so the sea reads as
// occasional passing shoals rather than a constant rain of pixels
const FISH_CELL_WORLD = 7.5;
const SEA_DECOR_COLS = 4; // map chips: rock, seaweed, coral, shell
function buildChunkFish(cx, cz) {
  const startX = cx * CHUNK, startZ = cz * CHUNK;
  const i0 = Math.floor(startX / FISH_CELL_WORLD);
  const i1 = Math.floor((startX + CHUNK - 1) / FISH_CELL_WORLD);
  const k0 = Math.floor(startZ / FISH_CELL_WORLD);
  const k1 = Math.floor((startZ + CHUNK - 1) / FISH_CELL_WORLD);
  const pos = [];
  const col = [];
  const phase = [];
  const speed = [];
  const ang = []; // per-school heading: the shoal cruises in its own direction
  const anchors = []; // one per school: feeds the zoomed-out map icon
  const decorPos = []; // sea-floor rocks / seaweed / coral / shells
  const decorCol = [];
  for (let ix = i0; ix <= i1; ix++) {
    for (let iz = k0; iz <= k1; iz++) {
      if (hash3(ix, 3, iz, SEED + 551) > 0.55) continue;
      const fx = ix * FISH_CELL_WORLD + hash3(ix, 5, iz, SEED + 552) * FISH_CELL_WORLD;
      const fz = iz * FISH_CELL_WORLD + hash3(ix, 6, iz, SEED + 553) * FISH_CELL_WORLD;
      const depth = SEA_LEVEL - terrainHeight(Math.round(fx), Math.round(fz), SEED);
      if (depth < 3.0) continue; // schools only form in deep sea water (3+ blocks)
      // single ownership by cell centre, same trick as trees
      if (Math.floor((ix * FISH_CELL_WORLD + FISH_CELL_WORLD / 2) / CHUNK) !== cx) continue;
      if (Math.floor((iz * FISH_CELL_WORLD + FISH_CELL_WORLD / 2) / CHUNK) !== cz) continue;
      // schools cruise fully submerged — 1.4–4.5 blocks below the surface,
      // never closer than 0.5 to the seabed, so they read as swimming inside
      // the water column instead of drifting on top of it
      const fy = Math.max(
        SEA_LEVEL - depth + 0.5,
        SEA_LEVEL - (1.4 + hash3(ix, 11, iz, SEED + 557) * 3.1)
      );
      pos.push(fx, fy, fz);
      col.push(Math.floor(hash3(ix, 8, iz, SEED + 554) * FISH_COLS));
      phase.push(hash3(ix, 9, iz, SEED + 555));
      speed.push(0.25 + hash3(ix, 10, iz, SEED + 556) * 0.3);
      ang.push(hash3(ix, 12, iz, SEED + 558) * Math.PI * 2);
      // the map icon floats just above the waves so it never drowns
      anchors.push(fx, SEA_LEVEL + 0.6, fz);
    }
  }
  // sea-floor decor for the zoomed-out map: rocks, seaweed, coral, shells
  // scattered across the shallows (1–8 blocks deep), one item per ~7.5u cell
  for (let ix = i0; ix <= i1; ix++) {
    for (let iz = k0; iz <= k1; iz++) {
      if (hash3(ix, 31, iz, SEED + 771) < 0.6) continue;
      const fx = ix * FISH_CELL_WORLD + hash3(ix, 32, iz, SEED + 772) * FISH_CELL_WORLD;
      const fz = iz * FISH_CELL_WORLD + hash3(ix, 33, iz, SEED + 773) * FISH_CELL_WORLD;
      const depth = SEA_LEVEL - terrainHeight(Math.round(fx), Math.round(fz), SEED);
      if (depth < 1.0 || depth > 9) continue;
      const kind = Math.floor(hash3(ix, 34, iz, SEED + 774) * SEA_DECOR_COLS);
      decorPos.push(fx, SEA_LEVEL + 0.6, fz);
      decorCol.push(FISH_COL + FISH_COLS + kind);
    }
  }
  if (!pos.length && !decorPos.length) return null;
  const n = pos.length / 3;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3)
  );
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(col), 1));
  g.setAttribute('iPhase', new THREE.InstancedBufferAttribute(new Float32Array(phase), 1));
  g.setAttribute('iSpeed', new THREE.InstancedBufferAttribute(new Float32Array(speed), 1));
  g.setAttribute('iAng', new THREE.InstancedBufferAttribute(new Float32Array(ang), 1));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(startX + CHUNK / 2, SEA_LEVEL, startZ + CHUNK / 2),
    CHUNK * 1.6
  );
  const mesh = new THREE.Mesh(g, fishMat);
  mesh.renderOrder = 6; // composite after the water plane, never under it
  mesh.frustumCulled = false; // schools swim near chunk borders too
  // school anchors + species for the zoomed-out map
  mesh.userData.iconData = {
    pos: new Float32Array(anchors),
    col: Float32Array.from(col), // species index per school (0..FISH_COLS-1)
    decorPos: new Float32Array(decorPos),
    decorCol: Float32Array.from(decorCol), // map chip column for sea-floor decor
  };
  return mesh;
}

// ============================================================================
// Far-zoom LOD: detailed world → big map icons → pixel planet from space.
// Zooming out past ICON_ENTER swaps every tree/person/fire for a readable
// icon; past GLOBE_ENTER the whole voxel world hides and a stylised planet
// (azimuthal map centred on the camp pole) takes its place. Zooming back in
// dives through the same stages down to the campfire.
// ============================================================================

const FACE_ICON = [
  '..HHHH..',
  '.HHHHHH.',
  'HHFFFFHH',
  'HFeFFeFH',
  'HFFFFFFH',
  'FFmmmmFF',
  '.FFFFFF.',
  '..FFFF..',
];
const FACE_PALETTE = { H: '#4a3020', F: '#f0c090', e: '#26201a', m: '#a05a3c' };

const FIRE_COL = ATLAS_COLS;      // campfire chip column (after all species)
const FACE_COL = ATLAS_COLS + 1;  // human face chip column
const FISH_COL = ATLAS_COLS + 2;  // fish-school chips: one column per species
const SEA_ROCK_COL = FISH_COL + FISH_COLS;     // sea-floor rock chip
const SEAWEED_COL = SEA_ROCK_COL + 1;          // seaweed chip
const CORAL_COL = SEAWEED_COL + 1;             // coral chip
const SHELL_COL = CORAL_COL + 1;               // shell chip
const ICON_COLS = ATLAS_COLS + 2 + FISH_COLS + SEA_DECOR_COLS; // campfire + face + 6 fish + 4 sea-floor items
// icon cells match the tree atlas cell exactly so zoomed-out markers reuse
// the same 48px art 1:1 — a downscaled icon never needs to invent pixels
const ICON_CELL = ATLAS_CELL; // 48, same as the vegetation atlas

const iconAtlasCanvas = document.createElement('canvas');
iconAtlasCanvas.width = ICON_CELL * ICON_COLS;
iconAtlasCanvas.height = ICON_CELL;
let iconAtlasBuilt = false;
let iconAtlasTex = null;

// one shared points material: every wild tree icon renders through this
// Late transparent pass (depth-write off, renderOrder after terrain and
// vegetation) so markers are never hidden by the ground they stand on,
// while depth TESTING keeps real hills occluding markers behind them.
const ICON_MAT = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  renderOrder: 4,
  uniforms: {
    uTex: { value: null },
    uCell: { value: 1 / ICON_COLS },
    uPx: { value: Math.min(window.devicePixelRatio || 1, 2) },
    uInvW: { value: 1 / (ICON_CELL * ICON_COLS) }, // 1 / atlas width in px
    uInvH: { value: 1 / ICON_CELL },               // 1 / atlas height in px
    uDay: { value: 1 },
  },
  vertexShader: `
    attribute float aCol;
    varying float vCol;
    uniform float uPx;
    void main() {
      vCol = aCol;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float d = max(-mv.z, 1.0);
      // depth bias: pull the marker toward the camera so the block it
      // stands on (and the grove it marks) can never swallow it at
      // grazing angles; sizing still uses the true distance
      mv.z -= min(d * 0.085, 40.0);
      mv.z = min(mv.z, -0.5);
      gl_PointSize = clamp(430.0 / d, 44.0, 110.0) * uPx;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform sampler2D uTex;
    uniform float uCell;
    uniform float uInvW;
    uniform float uInvH;
    uniform float uDay;
    varying float vCol;
    void main() {
      // inset by half a texel so the marker samples its own chip's pixels
      // only — the exact boundary texels can otherwise bleed the neighbour
      // tree's art into this one's edges
      vec2 uv = vec2(
        vCol * uCell + (0.5 + gl_PointCoord.x * (48.0 - 1.0)) * uInvW,
        1.0 - (0.5 + gl_PointCoord.y * (48.0 - 1.0)) * uInvH
      );
      vec4 c = texture2D(uTex, uv);
      if (c.a < 0.35) discard;
      c.rgb *= mix(vec3(0.45, 0.50, 0.68), vec3(1.0), uDay);
      gl_FragColor = vec4(c.rgb, 1.0);
    }
  `,
});

// the icon chips must show the EXACT art the in-world trees show right now:
// the same two season rows the wind-shader blends, mixed with the same weight,
// so a zoomed-out marker is pixel-identical to the tree standing there
function paintSeasonalTreeChips(g) {
  const b = seasonInfo();
  KIND_ORDER.forEach((kind, i) => {
    const sx = i * ATLAS_CELL;
    g.drawImage(
      treeAtlasCanvas,
      sx, b.i * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL,
      i * ICON_CELL, 0, ICON_CELL, ICON_CELL
    );
    // blend the next season row over the current one at the same weight the
    // shader uses — source-over reproduces mix(a, b, w) for this pixel art
    if (b.w > 0.001) {
      g.globalAlpha = b.w;
      g.drawImage(
        treeAtlasCanvas,
        sx, b.next * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL,
        i * ICON_CELL, 0, ICON_CELL, ICON_CELL
      );
      g.globalAlpha = 1;
    }
  });
}

function buildIconAtlas() {
  const g = iconAtlasCanvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, iconAtlasCanvas.width, ICON_CELL);
  paintSeasonalTreeChips(g);
  // campfire chip: log teepee + a small flame licking over it (scaled to
  // match the bigger 48px tree chips)
  const fc = document.createElement('canvas');
  drawPixelArt(fc, CAMPFIRE, CAMPFIRE_PALETTE, 2);
  g.drawImage(fc, FIRE_COL * ICON_CELL + 5, 12);
  const flc = document.createElement('canvas');
  drawPixelArt(flc, FLAME, FLAME_PALETTE, 2);
  g.drawImage(flc, FIRE_COL * ICON_CELL + 15, 1);
  // face chip
  const hc = document.createElement('canvas');
  drawPixelArt(hc, FACE_ICON, FACE_PALETTE, 5);
  g.drawImage(hc, FACE_COL * ICON_CELL + 4, 4);
  // fish chips: one swimmer per species, so the zoomed-out map can mark
  // "this body of water holds sardines" vs "...holds tuna"
  FISH_KINDS.forEach((k, i) => {
    const fic = document.createElement('canvas');
    fic.width = ICON_CELL;
    fic.height = ICON_CELL;
    const fig = fic.getContext('2d');
    fig.imageSmoothingEnabled = false;
    fig.save();
    fig.translate(9, 14);
    fig.scale(1.5, 1.5);
    paintFish(fig, 0, 0, k, false);
    fig.restore();
    g.drawImage(fic, (FISH_COL + i) * ICON_CELL, 0);
  });
  // sea-floor decor chips: rocks, seaweed, coral and shells so the zoomed-out
  // sea reads as a living seabed, not just fish dots
  {
    // rock: faceted boulder, lit top-left, moss hint
    const rc = document.createElement('canvas');
    rc.width = rc.height = ICON_CELL;
    const rg = rc.getContext('2d');
    rg.imageSmoothingEnabled = false;
    rg.fillStyle = '#7d8694';
    rg.fillRect(12, 26, 24, 13);
    rg.fillRect(15, 21, 18, 6);
    rg.fillRect(18, 17, 12, 5);
    rg.fillStyle = '#99a3b1';
    rg.fillRect(13, 27, 10, 6);
    rg.fillRect(16, 22, 9, 3);
    rg.fillStyle = '#5c6574';
    rg.fillRect(27, 32, 7, 5);
    rg.fillStyle = '#4a6b4a';
    rg.fillRect(12, 37, 6, 2);
    g.drawImage(rc, SEA_ROCK_COL * ICON_CELL, 0);
  }
  {
    // seaweed: three swaying strands with a darker under-layer
    const sc = document.createElement('canvas');
    sc.width = sc.height = ICON_CELL;
    const sg = sc.getContext('2d');
    sg.imageSmoothingEnabled = false;
    sg.fillStyle = '#2c5c34';
    sg.fillRect(16, 14, 4, 30);
    sg.fillRect(26, 20, 4, 24);
    sg.fillRect(20, 8, 3, 36);
    sg.fillStyle = '#4f9e54';
    sg.fillRect(17, 14, 2, 28);
    sg.fillRect(27, 20, 2, 22);
    sg.fillRect(21, 8, 1, 34);
    sg.fillStyle = '#7cc46a';
    sg.fillRect(17, 10, 1, 4);
    sg.fillRect(27, 16, 1, 4);
    g.drawImage(sc, SEAWEED_COL * ICON_CELL, 0);
  }
  {
    // coral: branched fan in warm pinks and oranges
    const cc = document.createElement('canvas');
    cc.width = cc.height = ICON_CELL;
    const cg = cc.getContext('2d');
    cg.imageSmoothingEnabled = false;
    cg.fillStyle = '#8a4a52';
    cg.fillRect(22, 20, 4, 20);
    cg.fillRect(14, 26, 8, 4);
    cg.fillRect(26, 24, 8, 4);
    cg.fillStyle = '#e0707a';
    cg.fillRect(18, 14, 4, 12);
    cg.fillRect(24, 12, 4, 12);
    cg.fillRect(30, 16, 4, 8);
    cg.fillStyle = '#f2a0a8';
    cg.fillRect(19, 10, 2, 4);
    cg.fillRect(25, 8, 2, 4);
    cg.fillRect(31, 12, 2, 4);
    cg.fillStyle = '#c75a64';
    cg.fillRect(14, 30, 8, 2);
    g.drawImage(cc, CORAL_COL * ICON_CELL, 0);
  }
  {
    // shell: scallop with radiating ridges
    const hc = document.createElement('canvas');
    hc.width = hc.height = ICON_CELL;
    const hg = hc.getContext('2d');
    hg.imageSmoothingEnabled = false;
    hg.fillStyle = '#c98aa4';
    hg.fillRect(18, 20, 12, 12);
    hg.fillRect(15, 26, 18, 8);
    hg.fillRect(12, 30, 24, 6);
    hg.fillStyle = '#f0c8d8';
    hg.fillRect(19, 21, 10, 9);
    hg.fillRect(16, 27, 16, 6);
    hg.fillStyle = '#a05a7a';
    for (let i = 0; i < 7; i++) hg.fillRect(14 + i * 3, 21, 1, 15);
    g.drawImage(hc, SHELL_COL * ICON_CELL, 0);
  }
  if (!iconAtlasTex) {
    iconAtlasTex = new THREE.CanvasTexture(iconAtlasCanvas);
    iconAtlasTex.magFilter = THREE.NearestFilter;
    iconAtlasTex.minFilter = THREE.NearestFilter;
    iconAtlasTex.colorSpace = THREE.SRGBColorSpace;
    ICON_MAT.uniforms.uTex.value = iconAtlasTex;
    ICON_MAT.uniforms.uCell.value = 1 / ICON_COLS;
  } else {
    iconAtlasTex.needsUpdate = true;
  }
  // per-sprite clones (placed trees / fires / people) must re-read the atlas
  for (const t of Object.values(kindIconTexCache)) t.needsUpdate = true;
  iconAtlasBuilt = true;
}

// zoomed-out tree/bush/rock icons: instead of one point per plant, cluster
// them onto a coarse grid and emit a single marker per cell carrying the
// dominant species — "here lives a grove of oaks", not a pixel for every tree
const TREE_ICON_GRID = 64; // world units per marker cell (~1 per 4 chunks)
function ensureChunkIcons(ch) {
  if (ch.icons || !ch.trees || !ch.trees.userData.iconData) return;
  const ud = ch.trees.userData.iconData;
  const pos = ud.pos, col = ud.col;
  const hasH = !!ud.h;
  const cells = new Map();
  for (let i = 0; i < col.length; i++) {
    const x = pos[i * 3], z = pos[i * 3 + 2];
    const key = Math.round(x / TREE_ICON_GRID) + ':' + Math.round(z / TREE_ICON_GRID);
    let cell = cells.get(key);
    const treeTop = pos[i * 3 + 1] + (hasH ? ud.h[i] : 0);
    if (!cell) {
      cell = { x, y: pos[i * 3 + 1], z, top: treeTop, counts: new Map(), best: col[i] };
      cells.set(key, cell);
    } else if (treeTop > cell.top) {
      cell.top = treeTop;
    }
    const k = col[i];
    cell.counts.set(k, (cell.counts.get(k) || 0) + 1);
    if (cell.counts.get(k) > cell.counts.get(cell.best)) cell.best = k;
  }
  const ppos = new Float32Array(cells.size * 3);
  const pcol = new Float32Array(cells.size);
  let w = 0;
  for (const cell of cells.values()) {
    ppos[w * 3] = cell.x;
    // float the marker just above the tallest tree in its cluster so no
    // block face or canopy can hide it from any camera angle
    ppos[w * 3 + 1] = cell.top + 1.6;
    ppos[w * 3 + 2] = cell.z;
    pcol[w] = cell.best;
    w++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(pcol, 1));
  g.boundingSphere = ch.trees.geometry.boundingSphere.clone();
  const pts = new THREE.Points(g, ICON_MAT);
  pts.visible = false;
  scene.add(pts);
  ch.icons = pts;
}

function releaseChunkIcons(ch) {
  if (!ch.icons) return;
  scene.remove(ch.icons);
  ch.icons.geometry.dispose();
  ch.icons = null;
}

// fish schools get map icons too — but computed GLOBALLY, not per chunk:
// the loaded sea floor is flood-filled into connected "water bodies" (deep
// water, 3+ blocks) and ONE marker is emitted per (body, species). A whole
// ocean therefore shows at most six spots — one per fish type — instead of
// a scatter of clone icons.
const FISH_BODY_GRID = 24;    // world units per flood-fill cell (~1.5 chunks)
const FISH_VIS_DIST = 320;    // 3D schools farther than this aren't drawn
let fishIconPts = null;       // single global Points layer for fish markers
let fishIconDirty = false;    // chunks streamed while icon mode is on
let lastFishIconRebuild = 0;

function markFishIconsDirty() { fishIconDirty = true; }

function releaseFishIconLayer() {
  if (!fishIconPts) return;
  scene.remove(fishIconPts);
  fishIconPts.geometry.dispose();
  fishIconPts = null;
}

function rebuildFishIconLayer(force = false) {
  if (!iconMode) return;
  const now = performance.now();
  if (!force && now - lastFishIconRebuild < 500) return; // throttle streaming rebuilds
  lastFishIconRebuild = now;
  fishIconDirty = false;

  // collect every school anchor + species from all loaded chunks
  const schools = [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const ch of chunks.values()) {
    const ud = ch.fish && ch.fish.userData.iconData;
    if (!ud) continue;
    const p = ud.pos, c = ud.col;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], z = p[i + 2];
      schools.push([x, z, c[i / 3]]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  releaseFishIconLayer();
  if (!schools.length) return;

  // flood-fill deep water into connected bodies over the loaded extent.
  // Cells are water if their centre is deep — AND any cell holding a school
  // is forced to water too, because schools only spawn in 3+ blocks of water:
  // a coarse cell centre can sit on a shallow patch while the school's own
  // anchor is out in the deep.
  const PAD = 48;
  const x0 = Math.floor((minX - PAD) / FISH_BODY_GRID);
  const x1 = Math.floor((maxX + PAD) / FISH_BODY_GRID);
  const z0 = Math.floor((minZ - PAD) / FISH_BODY_GRID);
  const z1 = Math.floor((maxZ + PAD) / FISH_BODY_GRID);
  const W = x1 - x0 + 1, H = z1 - z0 + 1;
  const body = new Int32Array(W * H); // -1 land, -2 water unlabelled, >=0 body id
  const isWater = (x, z) => terrainHeight(x, z, SEED) < SEA_LEVEL - 3;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      body[j * W + i] = isWater((x0 + i + 0.5) * FISH_BODY_GRID, (z0 + j + 0.5) * FISH_BODY_GRID) ? -2 : -1;
    }
  }
  for (const [x, z] of schools) {
    const gx = Math.floor(x / FISH_BODY_GRID) - x0;
    const gz = Math.floor(z / FISH_BODY_GRID) - z0;
    if (gx >= 0 && gz >= 0 && gx < W && gz < H && body[gz * W + gx] === -1) {
      body[gz * W + gx] = -2;
    }
  }
  let nextId = 0;
  const stack = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const idx = j * W + i;
      if (body[idx] !== -2) continue;
      body[idx] = nextId;
      stack.push(idx);
      while (stack.length) {
        const c = stack.pop();
        const cx = c % W, cz = (c / W) | 0;
        if (cx > 0 && body[c - 1] === -2) { body[c - 1] = nextId; stack.push(c - 1); }
        if (cx < W - 1 && body[c + 1] === -2) { body[c + 1] = nextId; stack.push(c + 1); }
        if (cz > 0 && body[c - W] === -2) { body[c - W] = nextId; stack.push(c - W); }
        if (cz < H - 1 && body[c + W] === -2) { body[c + W] = nextId; stack.push(c + W); }
      }
      nextId++;
    }
  }
  // a handful of spread markers per water body instead of exactly one: thin
  // the schools onto a coarse grid so a big ocean shows a few fish dots per
  // body, each carrying its species chip, never a single lonely pixel
  const MARKER_GRID = 40; // world units between neighbouring fish markers
  const MAX_PER_BODY = 14;
  const bodies = new Map(); // bid -> array of [x, z, sp]
  for (const [x, z, sp] of schools) {
    const gx = Math.floor(x / FISH_BODY_GRID);
    const gz = Math.floor(z / FISH_BODY_GRID);
    if (gx < x0 || gx > x1 || gz < z0 || gz > z1) continue;
    const bid = body[(gz - z0) * W + (gx - x0)];
    if (bid < 0) continue;
    if (!bodies.has(bid)) bodies.set(bid, []);
    const arr = bodies.get(bid);
    if (arr.length >= MAX_PER_BODY) continue;
    // keep anchors at least MARKER_GRID apart so the dots stay readable
    let ok = true;
    for (const [mx, mz] of arr) {
      if (Math.abs(mx - x) < MARKER_GRID && Math.abs(mz - z) < MARKER_GRID) { ok = false; break; }
    }
    if (ok) arr.push([x, z, sp]);
  }
  // collect spread fish markers + all sea-floor decor markers
  const mk = [];
  for (const arr of bodies.values()) for (const [x, z, sp] of arr) mk.push([x, SEA_LEVEL + 0.6, z, FISH_COL + sp]);
  const DECOR_GRID = 64;
  const decorSeen = new Set();
  for (const ch of chunks.values()) {
    const ud = ch.fish && ch.fish.userData.iconData;
    if (!ud || !ud.decorPos) continue;
    const dp = ud.decorPos, dc = ud.decorCol;
    for (let i = 0; i < dp.length; i += 3) {
      const x = dp[i], z = dp[i + 2];
      const key = Math.round(x / DECOR_GRID) + ':' + Math.round(z / DECOR_GRID);
      if (decorSeen.has(key)) continue;
      decorSeen.add(key);
      mk.push([x, SEA_LEVEL + 0.6, z, dc[i / 3]]);
    }
  }
  if (!mk.length) return;
  const pos = new Float32Array(mk.length * 3);
  const col = new Float32Array(mk.length);
  for (let i = 0; i < mk.length; i++) {
    pos[i * 3] = mk[i][0];
    pos[i * 3 + 1] = mk[i][1];
    pos[i * 3 + 2] = mk[i][2];
    col[i] = mk[i][3];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 1));
  // sea markers always float on top of the water — this layer renders with
  // depth test off so no wave or shoreline can ever swallow a fish or a rock
  const seaIconMat = fishIconMatRef();
  const pts = new THREE.Points(g, seaIconMat);
  pts.visible = true;
  scene.add(pts);
  fishIconPts = pts;
}
// one shared depth-less material for sea markers (fish + decor): a clone of
// the tree-icon shader with depth testing off so markers never drown
let _fishIconMat = null;
function fishIconMatRef() {
  if (!_fishIconMat) {
    _fishIconMat = ICON_MAT.clone();
    _fishIconMat.depthTest = false;
  }
  return _fishIconMat;
}

// --- icon sprites (placed trees / fires / people) -------------------------

const kindIconTexCache = {};
function atlasIconTexture(col) {
  if (!kindIconTexCache[col]) {
    const t = iconAtlasTex.clone();
    t.needsUpdate = true;
    t.repeat.set(1 / ICON_COLS, 1);
    t.offset.set(col / ICON_COLS, 0);
    kindIconTexCache[col] = t;
  }
  return kindIconTexCache[col];
}

function makeIconSprite(col) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: atlasIconTexture(col),
    transparent: true,
    depthWrite: false,
    // the map is an overview: a marker must never be swallowed by the block
    // (or ridge) it stands on, so it renders on top of the terrain it marks
    depthTest: false,
  }));
  s.center.set(0.5, 0);
  s.visible = false;
  s.renderOrder = 30;
  return s;
}

function ensurePlacedIcon(s) {
  if (!iconAtlasBuilt) return null;
  if (!s.iconSpr) {
    const ki = KIND_ORDER.indexOf(s.kind);
    s.iconSpr = makeIconSprite(ki >= 0 ? ki : 0);
    scene.add(s.iconSpr);
  }
  return s.iconSpr;
}

let homeFireIcon = null;
function ensureHomeFireIcon() {
  if (!iconAtlasBuilt || !homeFire) return null;
  if (!homeFireIcon) {
    homeFireIcon = makeIconSprite(FIRE_COL);
    scene.add(homeFireIcon);
  }
  return homeFireIcon;
}

const extraFireIcons = new Map(); // campfires[] sprite -> icon sprite

function ensureCmIcon(cm) {
  if (!iconAtlasBuilt) return null;
  if (!cm.iconSpr) {
    cm.iconSpr = makeIconSprite(FACE_COL);
    cm.iconSpr.userData.cm = cm;
    scene.add(cm.iconSpr);
  }
  return cm.iconSpr;
}

// --- zoom-stage state machine ----------------------------------------------

const ICON_ENTER = 170, ICON_EXIT = 148;
const GLOBE_ENTER = 460, GLOBE_EXIT = 200;
// once the pull-out crosses into space it glides here on its own — the user
// doesn't have to keep scrolling to get the full framed planet
const SPACE_SETTLE_DIST = 820;
let iconMode = false;
let spaceMode = false;
let lodTween = null;

function markerScale(d) {
  // map-pin growth on the way out, then shrink again as the planet takes
  // over — and the same curve keeps easing inside the globe view, so the
  // face/home icons scale smoothly through the whole zoom range
  const fade = 1 - THREE.MathUtils.smoothstep(d, 320, 900);
  return THREE.MathUtils.clamp(d * 0.07 * (0.3 + 0.7 * fade), 1.4, 20);
}

// fires get their own tighter cap so no campfire ever reads as a bonfire
// on the map — people and trees may tower, flames may not
function fireIconScale(d) {
  return Math.min(markerScale(d), 9) * 0.8;
}

function setIconMode(on) {
  if (iconMode === on) return;
  iconMode = on;
  for (const ch of chunks.values()) {
    if (ch.trees) {
      ch.trees.visible = !on;
      const shd = ch.trees.userData.shadow;
      if (shd) shd.visible = !on;
    }
    if (ch.fish) ch.fish.visible = !on;
    if (on) {
      ensureChunkIcons(ch);
      if (ch.icons) ch.icons.visible = true;
    }
    else {
      releaseChunkIcons(ch);
    }
  }
  // fish markers are a single global layer (one per species per water body)
  if (on) {
    rebuildFishIconLayer(true);
  } else {
    releaseFishIconLayer();
  }
  if (homeFire) homeFire.visible = !on;
  if (homeFireIcon) homeFireIcon.visible = on;
  for (const f of homeFlames) f.visible = !on;
  homeGlow.visible = !on;
  for (const s of placedTrees) {
    s.sprA.visible = !on;
    s.sprB.visible = !on;
    s.blob.visible = !on;
    if (s.iconSpr) s.iconSpr.visible = on;
  }
  for (const f of campfires) f.visible = !on;
  for (const ic of extraFireIcons.values()) ic.visible = on;
  for (const cm of cavemen) {
    cm.spr.visible = !on;
    if (cm.react) cm.react.spr.visible = !on;
    if (cm.iconSpr) cm.iconSpr.visible = on;
  }
}

function syncDetailIcons() {
  for (const s of placedTrees) {
    const ic = ensurePlacedIcon(s);
    if (!ic) continue;
    // float the marker just above the tree it marks — same convention as the
    // clustered wild-tree markers — so the block below can never hide it
    ic.position.copy(s.sprA.position);
    ic.position.y += s.sprA.scale.y + 1.6;
    ic.scale.setScalar(markerScale(camera.position.distanceTo(ic.position)));
    ic.scale.z = 1;
    ic.visible = true;
  }
  const fi = ensureHomeFireIcon();
  if (fi && homeFire) {
    fi.position.copy(homeFire.position);
    fi.position.y += 0.9;
    const sc = fireIconScale(camera.position.distanceTo(fi.position));
    fi.scale.set(sc, sc, 1);
    fi.visible = true;
  }
  for (const f of campfires) {
    let ic = extraFireIcons.get(f);
    if (!ic) {
      ic = makeIconSprite(FIRE_COL);
      scene.add(ic);
      extraFireIcons.set(f, ic);
    }
    ic.position.copy(f.position);
    ic.position.y += 0.9;
    const sc = fireIconScale(camera.position.distanceTo(ic.position));
    ic.scale.set(sc, sc, 1);
    ic.visible = true;
  }
  for (const cm of cavemen) {
    const ic = ensureCmIcon(cm);
    if (!ic) continue;
    ic.position.copy(cm.spr.position);
    ic.position.y += 1.7; // float above the head: never hidden by their block
    const sc = markerScale(camera.position.distanceTo(ic.position)) * 0.55;
    ic.scale.set(sc, sc, 1);
    ic.visible = true;
    if (cm.react) cm.react.spr.visible = false;
  }
}

// --- planet view -------------------------------------------------------------

const PLANET_R = 60;
const PLANET_MAP_RANGE = 900;
const SPACE_BG = new THREE.Color(0x04060f);
const globe = { group: null, pin: null, sphere: null, markers: [], builtSeed: null };
const GLOBE_UP = new THREE.Vector3(0, 1, 0);
const _gdDir = new THREE.Vector3();
const _gdQuat = new THREE.Quaternion();
let prevDesired = null;

// --- space dressing: a blazing distant sun + a moon circling the earth -----
const sunSprite = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,244,1)');
  gr.addColorStop(0.25, 'rgba(255,222,130,0.95)');
  gr.addColorStop(0.5, 'rgba(255,165,64,0.32)');
  gr.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: t,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  s.visible = false;
  scene.add(s);
  return s;
})();

let moonPivot = null;
let moonAng = Math.PI * 0.3;
// hand-pixelled moon skin: pale regolith, speckle and a few rimmed craters
function makeMoonTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#c9ccd4';
  g.fillRect(0, 0, 64, 32);
  for (let i = 0; i < 110; i++) {
    const x = Math.random() * 64, y = Math.random() * 32;
    g.fillStyle =
      Math.random() < 0.5 ? 'rgba(118,124,138,0.5)' : 'rgba(236,239,245,0.45)';
    g.beginPath();
    g.arc(x, y, 0.5 + Math.random() * 1.7, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * 64, y = Math.random() * 32;
    const r = 2.2 + Math.random() * 3.2;
    g.fillStyle = 'rgba(102,108,122,0.55)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(242,245,250,0.5)';
    g.beginPath();
    g.arc(x, y, r, -2.6, 0.4);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let moonTex = null;
function ensureMoon() {
  if (moonPivot) return;
  if (!moonTex) moonTex = makeMoonTexture();
  moonPivot = new THREE.Group();
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_R * 0.16, 20, 14),
    new THREE.MeshStandardMaterial({
      map: moonTex,
      roughness: 1,
      metalness: 0,
      fog: false,
    })
  );
  moon.position.set(PLANET_R * 1.75, 0, 0);
  moonPivot.add(moon);
  moonPivot.rotation.z = 0.16; // slight orbital tilt
  moonPivot.visible = false;
  scene.add(moonPivot);
}

// full-sphere starfield for the planet view (the night domes only cover up)
const spaceDome = (() => {
  const n = 460;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.max(0, 1 - u * u));
    pos[i * 3] = Math.cos(a) * rr;
    pos[i * 3 + 1] = u;
    pos[i * 3 + 2] = Math.sin(a) * rr;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({
    size: 1.7,
    color: 0xdfe8ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    sizeAttenuation: false,
  }));
  p.renderOrder = -6;
  p.frustumCulled = false;
  p.visible = false;
  scene.add(p);
  return p;
})();

// the sun hangs motionless in one spot of space, behind-left of the earth
const SUN_SPACE_DIR = new THREE.Vector3(-0.62, 0.28, -0.73).normalize();

let globePopOpen = false;
// soft plateau: rises almost immediately, covers the swap, gentle fall
function cloudEnv(u) {
  const rise = Math.min(1, u / 0.16);
  const fall = Math.min(1, (1 - u) / 0.3);
  return Math.max(0, Math.min(rise, fall)) * 0.9;
}
function setCloudFade(v) {
  if (cloudFadeEl) cloudFadeEl.style.opacity = v.toFixed(3);
}
function toggleGlobePop(on) {
  globePopOpen = !!(on && spaceMode);
  document.getElementById('globe-pop').classList.toggle('open', globePopOpen);
}
function updateGlobePop() {
  if (!globePopOpen) return;
  // camp age: time since the first villager founded the settlement
  const cdays = campStats.foundedGameMs
    ? Math.max(0, Math.floor((gameMs - campStats.foundedGameMs) / 86400000))
    : 0;
  const cyr = Math.floor(cdays / 365) + 1;
  const cdoy = (cdays % 365) + 1;
  const s = SEASONS[((curSeasonIdx % 4) + 4) % 4] || SEASONS[0];
  let kids = 0, adults = 0, elders = 0;
  for (const cm of cavemen) {
    const yrs = cm.stats.baseAge + (gameMs - cm.stats.bornGameMs) / 86400000;
    if (yrs < AGE_STAGES.child.maxAge) kids++;
    else if (yrs < AGE_STAGES.adult.maxAge) adults++;
    else elders++;
  }
  document.getElementById('gp-pop').textContent =
    cavemen.length +
    (cavemen.length
      ? ' \u00B7 ' + kids + '\u{1F476} ' + adults + '\u{1F9D1} ' + elders + '\u{1F9D3}'
      : '');
  document.getElementById('gp-births').textContent = String(campStats.births);
  document.getElementById('gp-deaths').textContent = String(campStats.deaths);
  document.getElementById('gp-season').textContent = s.icon + ' ' + s.name;
  document.getElementById('gp-temp').textContent =
    Math.round(tempNow) + '\u00B0C';
  document.getElementById('gp-age').textContent =
    'Year ' + cyr + ' · Day ' + cdoy;
}

function renderPlanetCanvas() {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const phi = ((y + 0.5) / H) * Math.PI;
    const r = (phi / Math.PI) * PLANET_MAP_RANGE;
    for (let x = 0; x < W; x++) {
      const th = ((x + 0.5) / W) * Math.PI * 2;
      const wx = Math.round(homePos.x + Math.cos(th) * r);
      const wz = Math.round(homePos.z + Math.sin(th) * r);
      const h = terrainHeight(wx, wz, SEED);
      let cr, cg, cb;
      if (h < SEA_LEVEL - 8) { cr = 14; cg = 36; cb = 66; }
      else if (h <= SEA_LEVEL) { cr = 32; cg = 84; cb = 122; }
      else if (h <= SEA_LEVEL + 1.6) { cr = 214; cg = 196; cb = 140; }
      else if (h > 50) { cr = 236; cg = 241; cb = 246; }
      else if (h > 44) { cr = 128; cg = 121; cb = 110; }
      else {
        const moist = fbm2(wx * 0.01, wz * 0.01, SEED + 333, 2);
        if (moist > 0.58) { cr = 38; cg = 104; cb = 56; }
        else if (moist < 0.34) { cr = 198; cg = 172; cb = 118; }
        else { cr = 74; cg = 134; cb = 62; }
      }
      const nz = hash3(wx, 91, wz, SEED + 77) * 16 - 8;
      const i = (y * W + x) * 4;
      d[i] = cr + nz;
      d[i + 1] = cg + nz;
      d[i + 2] = cb + nz;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function disposeGlobe() {
  if (!globe.group) return;
  scene.remove(globe.group);
  globe.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  globe.group = null;
  globe.pin = null;
  globe.markers = [];
  globe.builtSeed = null;
}

function buildGlobe() {
  if (globe.group && globe.builtSeed === SEED) return;
  disposeGlobe();
  const tex = new THREE.CanvasTexture(renderPlanetCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  const sph = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_R, 48, 32),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, fog: false })
  );
  const grp = new THREE.Group();
  grp.add(sph);
  // cheap atmosphere: additive back-face shell hugging the limb
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_R * 1.17, 32, 24),
    new THREE.MeshBasicMaterial({
      color: 0x6fb7ff,
      transparent: true,
      opacity: 0.13,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  );
  grp.add(halo);
  globe.haloMat = halo.material;
  // camp pin: little pixel house floating over the pole
  const pc = document.createElement('canvas');
  pc.width = 32;
  pc.height = 32;
  const pg = pc.getContext('2d');
  pg.fillStyle = '#ffe9a8';
  pg.fillRect(8, 12, 16, 14);
  for (let i = 0; i < 5; i++) pg.fillRect(6 + i * 3, 9 - i * 2, 20 - i * 6, 3);
  pg.fillStyle = '#7a5230';
  pg.fillRect(13, 18, 6, 8);
  const ptex = new THREE.CanvasTexture(pc);
  ptex.magFilter = THREE.NearestFilter;
  ptex.colorSpace = THREE.SRGBColorSpace;
  const pin = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ptex,
    transparent: true,
    depthWrite: false,
    fog: false,
  }));
  pin.center.set(0.5, 0);
  pin.scale.setScalar(11);
  pin.position.set(0, PLANET_R * 1.1, 0);
  grp.add(pin);
  globe.group = grp;
  globe.pin = pin;
  globe.sphere = sph;
  globe.builtSeed = SEED;
}

function syncGlobeMarkers() {
  if (!globe.group) return;
  const gd = Math.max(camera.position.distanceTo(controls.target), 1);
  const gs = globe.group.scale.x;
  // zoomed INTO the globe: keep markers small and dainty; they only swell
  // gradually as you pull away from the planet
  const local = THREE.MathUtils.clamp(2.4 + gd * 0.012, 2.6, 11) / gs;
  let n = 0;
  for (const cm of cavemen) {
    const p = cm.spr.position;
    const dx = p.x - homePos.x, dz = p.z - homePos.z;
    const r = Math.min(Math.hypot(dx, dz), PLANET_MAP_RANGE * 0.85);
    const phi = (r / PLANET_MAP_RANGE) * Math.PI * 0.5 + 0.07;
    const th = Math.atan2(dz, dx);
    let m = globe.markers[n];
    if (!m) {
      if (!iconAtlasBuilt) continue;
      m = makeIconSprite(FACE_COL);
      globe.markers.push(m);
      globe.group.add(m);
    }
    const sr = PLANET_R * 1.05;
    m.position.set(
      Math.sin(phi) * Math.cos(th) * sr,
      Math.cos(phi) * sr,
      Math.sin(phi) * Math.sin(th) * sr
    );
    m.scale.setScalar(local);
    m.scale.z = 1;
    m.visible = true;
    n++;
  }
  for (let i = n; i < globe.markers.length; i++) globe.markers[i].visible = false;
}

// bring the voxel world back after the planet view (also used mid-descent)
function restoreFromSpace() {
  if (globe.group) scene.remove(globe.group);
  // back to the tight far plane the voxel world was tuned for
  if (camera.far !== 3000) {
    camera.far = 3000;
    camera.updateProjectionMatrix();
  }
  sunSprite.visible = false;
  if (moonPivot) moonPivot.visible = false;
  spaceDome.visible = false;
  starsA.visible = true;
  starsB.visible = true;
  starsA.scale.setScalar(1);
  starsB.scale.setScalar(1);
  // hand the sky back to the day/night discs
  sunDisc.visible = true;
  moonDisc.visible = true;
  toggleGlobePop(false);
  water.visible = true;
  cloudGroup.visible = true;
  campLabelSpr.visible = true;
  for (const ch of chunks.values()) {
    if (ch.mesh) ch.mesh.visible = true;
    if (ch.trees) {
      ch.trees.visible = !iconMode;
      const shd = ch.trees.userData.shadow;
      if (shd) shd.visible = !iconMode;
    }
    if (ch.icons) ch.icons.visible = iconMode;
  }
  if (fishIconPts) fishIconPts.visible = iconMode;
  for (const cm of cavemen) cm.spr.visible = true;
  for (const f of campfires) f.visible = !iconMode;
  if (homeFire) homeFire.visible = !iconMode;
  homeGlow.visible = !iconMode;
  for (const f of homeFlames) f.visible = !iconMode;
  for (const s of placedTrees) {
    s.sprA.visible = !iconMode;
    s.sprB.visible = !iconMode;
    s.blob.visible = !iconMode;
    if (s.iconSpr) s.iconSpr.visible = iconMode;
  }
  for (const ic of extraFireIcons.values()) ic.visible = iconMode;
  for (const cm of cavemen) {
    if (cm.iconSpr) cm.iconSpr.visible = iconMode;
  }
}

function setSpaceMode(on) {
  if (spaceMode === on) return;
  // never start a transition while the opposite one is mid-flight
  if (lodTween && lodTween.out) return;
  spaceMode = on;
  if (on) {
    setIconMode(false);
    buildGlobe();
    water.visible = false;
    cloudGroup.visible = false;
    campLabelSpr.visible = false;
    ghostFire.visible = false;
    setPlacing(null);
    for (const g of Object.values(ghosts)) g.visible = false;
    for (const ch of chunks.values()) {
      if (ch.mesh) ch.mesh.visible = false;
      if (ch.trees) {
        ch.trees.visible = false;
        const shd = ch.trees.userData.shadow;
        if (shd) shd.visible = false;
      }
      if (ch.icons) ch.icons.visible = false;
    }
    if (fishIconPts) fishIconPts.visible = false;
    if (homeFire) homeFire.visible = false;
    for (const f of homeFlames) f.visible = false;
    homeGlow.visible = false;
    fireLight.intensity = 0;
    for (const s of placedTrees) {
      s.sprA.visible = false;
      s.sprB.visible = false;
      s.blob.visible = false;
      if (s.iconSpr) s.iconSpr.visible = false;
    }
    for (const f of campfires) f.visible = false;
    for (const ic of extraFireIcons.values()) ic.visible = false;
    for (const cm of cavemen) {
      cm.spr.visible = false;
      if (cm.iconSpr) cm.iconSpr.visible = false;
      if (cm.react) cm.react.spr.visible = false;
    }
    globe.group.position.set(homePos.x, 0, homePos.z);
    globe.group.rotation.y = Math.PI * 0.25;
    scene.add(globe.group);
    // anchor the zoom-out ON the home pin: the orbit pivot snaps to the
    // planet centre so the camp stays centred while the earth shrinks
    controls.target.set(homePos.x, 0, homePos.z);
    snapZoom();
    // complete the zoom-out automatically: the cinematic dolly keeps easing
    // outward until the whole planet sits framed in view
    desiredDist = Math.max(desiredDist, SPACE_SETTLE_DIST);
  } else {
    // smooth dive back: keep the planet/space look until halfway down,
    // then swap the world in while the camera is already moving fast
    const gy0 = groundYAt(homePos.x, homePos.z);
    const dir = camera.position.clone().sub(controls.target);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    lodTween = {
      t: 0,
      out: true,
      fromT: controls.target.clone(),
      toT: new THREE.Vector3(homePos.x, gy0 + 1.5, homePos.z),
      fromC: camera.position.clone(),
      // land at the high camp viewpoint INSIDE the icon band: the zoomed-out
      // camp appears with its large map icons first
      toC: new THREE.Vector3(homePos.x + dir.x * 110, gy0 + 160, homePos.z + dir.z * 110),
    };
    controls.enabled = false;
  }
}

let lastLodDist = 0;
function updateWorldLod(dt) {
  if (!atlasBuilt || !iconAtlasBuilt) return;

  // active camera transition tween — runs across both modes so the ride
  // out to space and the dive back are one smooth continuous move
  if (lodTween) {
    lodTween.t = Math.min(1, lodTween.t + dt / (lodTween.out ? 1.5 : 0.9));
    const k = lodTween.t * lodTween.t * (3 - 2 * lodTween.t);
    // cloud wash: rises fast, covers the world/planet swap, falls away
    setCloudFade(cloudEnv(lodTween.t));
    controls.target.lerpVectors(lodTween.fromT, lodTween.toT, k);
    camera.position.lerpVectors(lodTween.fromC, lodTween.toC, k);
    camera.lookAt(controls.target);
    if (lodTween.out && !lodTween.worldShown && lodTween.t >= 0.3) {
      // under thickening cloud cover: bring the voxel map in early
      lodTween.worldShown = true;
      spaceMode = false;
      restoreFromSpace();
    }
    if (lodTween.t >= 1) {
      const wasOut = !!lodTween.out;
      lodTween = null;
      setCloudFade(0);
      controls.enabled = true;
      controls.update();
      snapZoom();
      if (wasOut) {
        lastChunk = null;
        syncChunks(true);
      }
    }
  }

  if (spaceMode) {
    // shrinking-Earth illusion: the planet's angular size eases with zoom —
    // a readable full disc on entry that gently becomes a marble far out,
    // with the auto-settle glide framing it completely
    const gd = Math.max(camera.position.distanceTo(controls.target), 1);
    // stretch the far plane alongside the camera so deep-space zooms can
    // never clip the planet (or its star domes) out of existence
    const needFar = Math.max(3000, gd * 2.6);
    if (camera.far !== needFar) {
      camera.far = needFar;
      camera.updateProjectionMatrix();
    }
    const gs = THREE.MathUtils.clamp(0.0427 * Math.pow(gd, 0.65), 1.2, 14);
    globe.group.scale.setScalar(gs);
    // fade the atmosphere shell away before the camera can end up inside it
    if (globe.haloMat) {
      const shellR = PLANET_R * 1.17 * gs;
      globe.haloMat.opacity = 0.13 * THREE.MathUtils.clamp((gd - shellR) / 140 + 0.35, 0, 1);
    }
    globe.group.rotation.y += dt * 0.05;
    // home pin rides the same zoom curve as every other icon
    globe.pin.position.y = PLANET_R * 1.1 + Math.sin(tNow * 2) * 1.4;
    globe.pin.scale.setScalar(
      THREE.MathUtils.clamp((2.8 + gd * 0.014) / gs, 3, 13)
    );
    syncGlobeMarkers();
    // stars: the ground-sky domes go dark; instead the full star sphere rides
    // WITH the camera so the sky stays filled at any zoom depth (a dome
    // anchored to the world origin would drift out of every frustum here)
    starsA.visible = false;
    starsB.visible = false;
    spaceDome.visible = true;
    spaceDome.position.copy(camera.position);
    spaceDome.scale.setScalar(Math.min(2400, camera.far * 0.7));
    spaceDome.material.opacity = 1;
    // sun: motionless in deep space behind the earth's shoulder
    sunSprite.visible = true;
    sunSprite.position
      .copy(globe.group.position)
      .addScaledVector(SUN_SPACE_DIR, Math.min(2300, 560 * gs));
    const ss = THREE.MathUtils.clamp(52 * gs, 36, 170);
    sunSprite.scale.set(ss, ss, 1);
    // moon: circles the earth once every ~18s, shrinking with the globe
    ensureMoon();
    moonPivot.visible = true;
    moonPivot.position.copy(globe.group.position);
    moonPivot.scale.setScalar(gs);
    moonAng += dt * 0.35;
    moonPivot.rotation.y = moonAng;
    updateGlobePop();
    // keep the planet centred: glide the orbit pivot onto the globe centre
    // so it stays mid-screen no matter where the user roamed before
    if (!lodTween) {
      const k = 1 - Math.exp(-3 * dt);
      controls.target.x += (homePos.x - controls.target.x) * k;
      controls.target.y += (0 - controls.target.y) * k;
      controls.target.z += (homePos.z - controls.target.z) * k;
    }
    // the planet is static (drag to rotate it yourself). While the user
    // zooms IN, ease it around until the camp pole aims at the camera, so
    // diving back in visibly homes toward the camp
    _gdDir.copy(camera.position).sub(globe.group.position).normalize();
    const zoomingIn = prevDesired !== null && desiredDist < prevDesired - 1e-4;
    prevDesired = desiredDist;
    globe.rotW = THREE.MathUtils.damp(globe.rotW || 0, zoomingIn ? 1 : 0, 4, dt);
    if (globe.rotW > 0.002) {
      _gdQuat.setFromUnitVectors(GLOBE_UP, _gdDir);
      globe.group.quaternion.slerp(_gdQuat, Math.min(1, globe.rotW * dt * 3));
    }
    scene.background.copy(SPACE_BG);
    scene.fog.near = 4000;
    scene.fog.far = 8000;
    starsA.material.opacity = Math.max(starsA.material.opacity, 0.85);
    starsB.material.opacity = Math.max(starsB.material.opacity, 0.75);
    for (const sys of allFx) sys.pts.visible = false;
    campLabelSpr.visible = false;
    fireLight.intensity = 0;
    // the day/night sky discs must not compete with the real space bodies:
    // one sun only, and no flat moon sprite next to the 3D one
    sunDisc.visible = false;
    moonDisc.visible = false;
    if (camera.position.distanceTo(controls.target) < GLOBE_EXIT) {
      setSpaceMode(false);
    } else {
      // pre-dive wash: clouds build well before the camera bears down on
      // the planet, so the dive already starts inside the cloud layer
      const prox = THREE.MathUtils.clamp(
        (GLOBE_EXIT + 320 - camera.position.distanceTo(controls.target)) / 320,
        0, 1
      );
      setCloudFade(prox * 0.85);
    }
    return;
  }

  lastLodDist = camera.position.distanceTo(controls.target);
  if (lastLodDist > GLOBE_ENTER) {
    setSpaceMode(true);
    return;
  }
  if (!iconMode && lastLodDist > ICON_ENTER) setIconMode(true);
  else if (iconMode && lastLodDist < ICON_EXIT) setIconMode(false);
  if (iconMode) syncDetailIcons();
}

// Build the nature section of the assets panel from the species registry:
// grouped by terrain, each card tagged with its biome and carrying an info
// button that expands its properties + all four seasonal variants.
function seasonTintName(k) {
  const [r, g, b] = k.autumn;
  if (r > 180 && g < 90) return 'crimson red';
  if (r > 200 && g > 150) return 'golden yellow';
  if (g > 120 && b < 80) return 'warm ochre';
  return 'autumn colours';
}

function renderAssetPanel() {
  const root = document.getElementById('nature-root');
  if (!root) return;
  root.innerHTML = '';
  const biomes = [
    ['desert', 'Desert'],
    ['jungle', 'Jungle'],
    ['forest', 'Forest'],
    ['snow', 'Snow'],
  ];

  // ---- toolbar: search + type filters -------------------------------------
  const bar = document.createElement('div');
  bar.className = 'ap-bar';
  bar.innerHTML =
    '<input id="ap-search" type="text" placeholder="Search assets" autocomplete="off"/>' +
    '<div class="ap-filters">' +
      '<button type="button" data-t="all" class="on">All</button>' +
      '<button type="button" data-t="tree">Trees</button>' +
      '<button type="button" data-t="bush">Bushes</button>' +
      '<button type="button" data-t="rock">Rocks</button>' +
    '</div>';
  root.appendChild(bar);

  // ---- terrain tabs (segmented control, one grid visible at a time) -------
  const tabs = document.createElement('div');
  tabs.className = 'ap-tabs';
  biomes.forEach(([b, lbl], i) => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'ap-tab' + (i === 0 ? ' on' : '');
    t.dataset.biome = b;
    t.textContent = lbl;
    tabs.appendChild(t);
  });
  root.appendChild(tabs);

  // ---- grids ---------------------------------------------------------------
  const wrap = document.createElement('div');
  wrap.className = 'ap-grid';
  root.appendChild(wrap);
  for (const [biome] of biomes) {
    const arch = document.createElement('div');
    arch.className = 'asset-archive' + (biome === 'desert' ? ' show' : '');
    arch.dataset.biome = biome;
    wrap.appendChild(arch);
    for (const kind of KIND_ORDER) {
      const k = TREE_KINDS[kind];
      if (k.biome !== biome) continue;
      const col = KIND_ORDER.indexOf(kind);
      const card = document.createElement('div');
      card.className = 'asset-card';
      card.dataset.kind = kind;
      card.dataset.asset = 'tree';
      card.dataset.name = k.label;
      card.dataset.type = k.type;

      const thumb = document.createElement('canvas');
      thumb.className = 'tree-thumb';
      thumb.width = thumb.height = ATLAS_CELL;
      thumb.getContext('2d').putImageData(
        treeAtlasCanvas.getContext('2d').getImageData(col * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL, ATLAS_CELL),
        0, 0
      );

      const name = document.createElement('span');
      name.className = 'asset-name';
      name.textContent = k.label;

      const typeChip = document.createElement('span');
      typeChip.className = 'asset-type t-' + k.type;
      typeChip.textContent = k.type;

      card.appendChild(thumb);
      card.appendChild(name);
      card.appendChild(typeChip);
      arch.appendChild(card);
    }
  }

  // ---- sea life: showcase cards with the real fish pixel art -------------
  {
    const arch = document.createElement('div');
    arch.className = 'asset-archive';
    arch.dataset.biome = 'sea';
    wrap.appendChild(arch);
    buildFishAtlas();
    for (let i = 0; i < FISH_KINDS.length; i++) {
      const k = FISH_KINDS[i];
      const card = document.createElement('div');
      card.className = 'asset-card'; // no data-kind: showcase only, not placeable
      card.dataset.name = k.label.toLowerCase();
      card.dataset.type = 'fish';

      const thumb = document.createElement('canvas');
      thumb.className = 'tree-thumb';
      thumb.width = thumb.height = ATLAS_CELL;
      const tg = thumb.getContext('2d');
      tg.imageSmoothingEnabled = false;
      // paint straight onto the thumb so it never depends on atlas state
      tg.save();
      tg.translate(6, 12);
      tg.scale(1.45, 1.45);
      paintFish(tg, 0, 0, k, false);
      tg.restore();

      const name = document.createElement('span');
      name.className = 'asset-name';
      name.textContent = k.label;

      const chip = document.createElement('span');
      chip.className = 'asset-type t-fish';
      chip.textContent = 'fish';

      card.appendChild(thumb);
      card.appendChild(name);
      card.appendChild(chip);
      arch.appendChild(card);
    }
    // a tab so it shows up alongside the biome tabs
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ap-tab';
    tab.dataset.biome = 'sea';
    tab.textContent = 'Sea 🐟';
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.ap-tab').forEach((x) => x.classList.remove('on'));
      tab.classList.add('on');
      wrap.querySelectorAll('.asset-archive').forEach((a) =>
        a.classList.toggle('show', a === arch));
      applyFilters();
    });
    tabs.appendChild(tab);
  }

  // ---- footer: legend + hint ------------------------------------------------
  const foot = document.createElement('div');
  foot.className = 'ap-foot';
  foot.innerHTML =
    '<span><i class="dot d-tree"></i>Tree</span>' +
    '<span><i class="dot d-bush"></i>Bush</span>' +
    '<span><i class="dot d-rock"></i>Rock</span>' +
    '<em>Pick one, then tap the map to place it</em>';
  root.appendChild(foot);

  // ---- interactions ----------------------------------------------------------
  let ftype = 'all';
  let q = '';
  function applyFilters() {
    const act = wrap.querySelector('.asset-archive.show');
    if (!act) return;
    act.querySelectorAll('.asset-card').forEach((c) => {
      const okQ = !q || c.dataset.name.toLowerCase().includes(q);
      const okT = ftype === 'all' || c.dataset.type === ftype;
      c.style.display = okQ && okT ? '' : 'none';
    });
  }
  bar.querySelector('#ap-search').addEventListener('input', (e) => {
    q = e.target.value.trim().toLowerCase();
    applyFilters();
  });
  bar.querySelectorAll('.ap-filters button').forEach((b) =>
    b.addEventListener('click', () => {
      bar.querySelectorAll('.ap-filters button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      ftype = b.dataset.t;
      applyFilters();
    })
  );
  tabs.querySelectorAll('.ap-tab').forEach((t) =>
    t.addEventListener('click', () => {
      tabs.querySelectorAll('.ap-tab').forEach((x) => x.classList.remove('on'));
      t.classList.add('on');
      wrap.querySelectorAll('.asset-archive').forEach((a) =>
        a.classList.toggle('show', a.dataset.biome === t.dataset.biome)
      );
      applyFilters();
    })
  );
}
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    buildTreeAtlas();
    buildFishAtlas();
    renderAssetPanel();
  })
);

const CAVEMAN_NAMES = ['Grok', 'Uga', 'Zog', 'Bruk', 'Tonk', 'Nala', 'Ogg', 'Kru', 'Mog', 'Sara'];
const CAVEWOMAN_NAMES = ['Aya', 'Sula', 'Neya', 'Mara', 'Ika', 'Ona', 'Tia', 'Ula', 'Ena', 'Rya'];
let cavemanNameIdx = 0;
let cavewomanNameIdx = 0;

// --- unique looks: every person gets their own skin / hair / eyes /
// --- hairstyle / facial hair / clothes, kept consistent as they age
const LOOK_POOL = {
  skins: ['#f2c99b', '#e0aa7a', '#c78d5a', '#a9714b', '#8a5a3a', '#6e452c'],
  hairs: ['#191919', '#3b2b1e', '#5a3a22', '#7a5230', '#96613a', '#b8863b', '#a33c2a'],
  greys: ['#c9c9c9', '#d5d5d5', '#b0b0b0'],
  cloths: ['#8a5a33', '#6b8f3f', '#7a5230', '#96613a', '#5e7a46', '#8f6a4a', '#a0522d'],
  dresses: ['#6b8f3f', '#5e7a46', '#7fa04a', '#4f6f3a', '#8a9a4a', '#b07850'],
  eyes: ['#1a1a1a', '#2e3a5e', '#2e4a2e', '#5e3a1e', '#4a2e5e'],
};
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickLook(rnd, female) {
  const P = LOOK_POOL;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  return {
    skin: pick(P.skins),
    hair: pick(P.hairs),
    grey: pick(P.greys),
    cloth: pick(P.cloths),
    dress: female ? pick(P.dresses) : null,
    eyes: pick(P.eyes),
    style: Math.floor(rnd() * (female ? 3 : 4)), // hairstyle id
    beard: female ? -1 : Math.floor(rnd() * 3),  // none / mustache / full
  };
}
// restyle the base pixel art rows for one character's hairstyle + beard
function artVariant(baseArt, female, style, beard) {
  try {
    const g = baseArt.map((r) => r.split(''));
    const W = g[0].length;
    // only paint where the cell is empty ('.') so silhouettes stay intact
    const put = (r, c, ch) => {
      if (r >= 0 && r < g.length && c >= 0 && c < W && g[r][c] === '.') g[r][c] = ch;
    };
    if (!female) {
      if (style === 1) for (let r = 1; r <= 4; r++) put(r, 12, 'H');   // side ponytail
      if (style === 2) for (let r = 7; r <= 9; r++) { put(r, 3, 'H'); put(r, 12, 'H'); } // long strands
      if (style === 3) for (let c = 5; c <= 10; c++) if (g[2] && g[2][c] === 'H') g[2][c] = 'C'; // headband
      if (beard === 1) { put(8, 6, 'H'); put(8, 7, 'H'); }            // full beard tip
      if (beard === 2) put(8, 7, 'H');                                // chin puff
    } else {
      if (style === 1) for (let r = 9; r <= 12; r++) put(r, 12, 'H'); // side tail
      if (style === 2) put(1, 12, 'D');                               // hair flower
    }
    return g.map((r) => r.join(''));
  } catch (err) {
    return baseArt;
  }
}
function lookPal(basePal, look) {
  const p = { ...basePal };
  if (p.S) p.S = look.skin;
  if (p.H) p.H = look.hair;
  if (p.E) p.E = look.eyes;
  if (p.C) p.C = look.cloth;
  if (p.D) p.D = look.dress || p.D;
  if (p.G) p.G = look.grey;
  return p;
}

// people never sink below knee-deep water: on the sea they wade at the
// surface instead of dropping to the seabed
function charGroundY(x, z) {
  return Math.max(groundYAt(x, z), SEA_LEVEL - 0.45);
}

// --- floating name tag + health bar above each villager --------------------
function makeNameSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 68;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  spr.renderOrder = 23; // above the water plane, under flames
  spr.center.set(0.5, 0);
  spr.visible = false;
  spr.userData = { canvas, tex, hp: -1 };
  return spr;
}

function drawNameTag(cm) {
  const ns = cm.nameSpr;
  const c = ns.userData.canvas;
  const g = c.getContext('2d');
  g.font = 'bold 26px monospace';
  const vit = villagerVitals(cm);
  const name = (cm.stats.name || '?') + ' \u00B7 ' + vit.yrs;
  const tw = Math.ceil(g.measureText(name).width);
  const W = Math.max(72, tw + 18);
  c.width = W;
  c.height = 68;
  g.font = 'bold 26px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // health bar
  const f = THREE.MathUtils.clamp(cm.stats.health / 100, 0, 1);
  g.fillStyle = 'rgba(12,16,22,0.82)';
  g.fillRect(3, 3, W - 6, 13);
  g.fillStyle = f > 0.55 ? '#58d95e' : f > 0.28 ? '#f0a63c' : '#e0483c';
  g.fillRect(5, 5, (W - 10) * f, 9);
  // energy bar: the daily battery — amber when rested, red when drained,
  // with a tiny moon glyph while they sleep
  const e = THREE.MathUtils.clamp((cm.energy || 0) / 100, 0, 1);
  g.fillStyle = 'rgba(12,16,22,0.82)';
  g.fillRect(3, 19, W - 6, 13);
  g.fillStyle =
    cm.sleeping ? '#7ea2ff' :
    e > 0.5 ? '#ffc94d' :
    e > 0.25 ? '#ff9a3d' : '#e0483c';
  g.fillRect(5, 21, (W - 10) * e, 9);
  if (cm.sleeping && W > 60) {
    g.font = 'bold 11px monospace';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText('zZ', W - 14, 26);
    g.font = 'bold 26px monospace';
  }
  // outlined name
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(10,10,14,0.9)';
  g.strokeText(name, W / 2, 50);
  g.fillStyle = '#ffe9a8';
  g.fillText(name, W / 2, 50);
  ns.userData.tex.needsUpdate = true;
  const H = 0.78;
  ns.scale.set(H * (W / c.height), H, 1);
}

function spawnCaveman(x, z, female = false, forceAge = null) {
  const STAGES = female ? FEMALE_STAGES : AGE_STAGES;
  const roll = Math.random();
  const baseAge = forceAge != null ? forceAge
    : roll < 0.22 ? 6 + Math.floor(Math.random() * 8)
    : roll < 0.85 ? 18 + Math.floor(Math.random() * 25)
    : 56 + Math.floor(Math.random() * 15);
  const spr = new THREE.Sprite(female ? womanMatR : cavemanMatR);
  spr.center.set(0.5, 0);
  spr.position.set(x, charGroundY(x, z), z);
  spr.visible = !iconMode && !spaceMode; // never spawn mid-LOD as a ghost
  scene.add(spr);
  // every person is drawn with their own palette + hairstyle variants
  const rnd = mulberry32((Math.random() * 0xffffffff) >>> 0);
  const look = pickLook(rnd, female);
  const mats = {};
  for (const [key, cfg] of Object.entries(STAGES)) {
    const vArt = artVariant(cfg.art, female, look.style, look.beard);
    const vp = lookPal(cfg.pal || CAVEMAN_PALETTE, look);
    const [mr, ml, ms] = makeCavemanMats(vArt, vp);
    mats[key] = { matR: mr, matL: ml, matSleep: ms, h: cfg.h, art: vArt, pal: vp };
  }
  const cm = {
    spr,
    target: null,
    wait: Math.random() * 2,
    speed: 1.6 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,
    energy: 55 + Math.random() * 40, // daily battery, 0..100
    forcedSleep: false,
    airH: 0, // blast air-time physics (must exist before first settle pass)
    airV: 0,
    gy: charGroundY(x, z),
    moving: false,
    faceL: false,
    stage: null,
    wet: 0,
    mats,
    female,
    look,
    stats: {
      name: female
        ? CAVEWOMAN_NAMES[cavewomanNameIdx++ % CAVEWOMAN_NAMES.length]
        : CAVEMAN_NAMES[cavemanNameIdx++ % CAVEMAN_NAMES.length],
      baseAge,
      bornGameMs: gameMs,
      health: 100,
      heightCm: Math.round((female ? 151 : 163) + (Math.random() * 8 - 4)),
      weightKg: +((female ? 47 : 56) + (Math.random() * 10 - 5)).toFixed(1),
      iqBase: Math.round(60 + Math.random() * 10), // stone-age minds start low
      power: +(1 + (Math.random() - 0.5) * 0.3).toFixed(2),
      speed: +(1 + (Math.random() - 0.5) * 0.3).toFixed(2),
      stamina: +(1 + (Math.random() - 0.5) * 0.3).toFixed(2),
      // stone-age lifespans were short: elders pass away between 72 and 86
      lifespanYears: 72 + Math.floor(Math.random() * 15),
    },
  };
  ensureAnatomy(cm);
  applyStage(cm);
  const outSpr = new THREE.Sprite(outlineMatFor(cm, false));
  outSpr.center.set(0.5, 0);
  outSpr.renderOrder = -1; // draw before everything at the same depth
  outSpr.visible = false;
  spr.add(outSpr);
  cm.outSpr = outSpr;
  syncOutline(cm);
  spr.userData.cm = cm;
  cm.nameSpr = makeNameSprite();
  drawNameTag(cm);
  scene.add(cm.nameSpr);
  cavemen.push(cm);
  campStats.foundedGameMs ??= gameMs;
  campStats.births++;
}

// elders who live past their lifespan pass away peacefully in camp
function reapElders() {
  let buried = false;
  for (let i = cavemen.length - 1; i >= 0; i--) {
    const cm = cavemen[i];
    const yrs = cm.stats.baseAge + (gameMs - cm.stats.bornGameMs) / 86400000;
    if (yrs < cm.stats.lifespanYears) continue;
    buried = true;
    campStats.deaths++;
    toast('🪦 ' + cm.stats.name + ' passed away at ' + Math.floor(yrs));
    if (cm.carrying) putDownVillager(cm.carrying);
    else if (cm.carriedBy) putDownVillager(cm);
    if (menuTarget === cm || cm.pickUpTarget || (menuTarget && menuTarget.pickUpTarget === cm)) closeActionMenu(true);
    if (selectedCm === cm) selectCaveman(null);
    else if (followCm === cm) followCm = null;
    squad.delete(cm);
    scene.remove(cm.spr);
    if (cm.nameSpr) {
      scene.remove(cm.nameSpr);
      cm.nameSpr.material.map.dispose();
      cm.nameSpr.material.dispose();
    }
    if (cm.iconSpr) {
      scene.remove(cm.iconSpr);
      cm.iconSpr.material.dispose();
    }
    disposeZzz(cm);
    for (const st of Object.values(cm.mats || {})) {
      OUTLINE_CACHE.delete(st.matR);
      OUTLINE_CACHE.delete(st.matL);
    }
    cavemen.splice(i, 1);
  }
  if (buried) {
    renderSquadList();
    renderRoster();
  }
}

function clearCavemen() {
  for (const cm of cavemen) {
    scene.remove(cm.spr);
    if (cm.nameSpr) {
      scene.remove(cm.nameSpr);
      cm.nameSpr.material.map.dispose();
      cm.nameSpr.material.dispose();
      cm.nameSpr = null;
    }
    disposeZzz(cm);
    for (const st of Object.values(cm.mats || {})) {
      OUTLINE_CACHE.delete(st.matR);
      OUTLINE_CACHE.delete(st.matL);
    }
  }
  cavemen.length = 0;
  selectCaveman(null);
}

const CAMP_LEASH = 13; // homebound villagers never stray past this
function waterDepthAt(x, z) {
  return SEA_LEVEL - groundYAt(x, z); // >0 means water
}
function pickWanderTarget(cm) {
  // villagers are afraid of water — until the tribe learns the Water
  // knowledge, then shallow wading becomes an acceptable stroll
  const wLim = KNOW.water ? 0.18 : -0.2;
  for (let tries = 0; tries < 7; tries++) {
    const a = Math.random() * Math.PI * 2;
    const rr = 8 + Math.random() * 24;
    let tx = cm.spr.position.x + Math.cos(a) * rr;
    let tz = cm.spr.position.z + Math.sin(a) * rr;
    if (!KNOW.water) {
      const midx = (cm.spr.position.x + tx) / 2;
      const midz = (cm.spr.position.z + tz) / 2;
      if (waterDepthAt(tx, tz) > wLim || waterDepthAt(midx, midz) > wLim) continue;
    } else if (waterDepthAt(tx, tz) > wLim) {
      continue;
    }
    if (cm.homebound) {
      const dx = tx - homePos.x, dz = tz - homePos.z;
      const d = Math.hypot(dx, dz);
      if (d > CAMP_LEASH) {
        tx = homePos.x + (dx / d) * CAMP_LEASH;
        tz = homePos.z + (dz / d) * CAMP_LEASH;
      }
    }
    cm.target = { x: tx, z: tz };
    return;
  }
  // everything nearby is wet or blocked — stay put this round
  cm.target = null;
}

const CAVEMAN_MIN_DIST = 1.0;
const CAVEMAN_STEP_UP = 1.2;

function treeHit(x, z) {
  const ci = Math.floor(x / CHUNK), cj = Math.floor(z / CHUNK);
  for (const ch of chunks.values()) {
    if (!ch.trees || Math.abs(ch.cx - ci) > 1 || Math.abs(ch.cz - cj) > 1) continue;
    const cols = ch.trees.userData.cols;
    for (let k = 0; k < cols.length; k++) {
      const dx = x - cols[k].x, dz = z - cols[k].z;
      if (dx * dx + dz * dz < cols[k].r * cols[k].r) return true;
    }
  }
  for (let k = 0; k < placedTrees.length; k++) {
    const c = placedTrees[k].col;
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) return true;
  }
  // the campfire itself is solid
  {
    const dx = x - homePos.x, dz = z - homePos.z;
    if (dx * dx + dz * dz < 1.44) return true;
  }
  return false;
}

// --- Lightning events: shockwave push + campfire gathering circle ---
const gather = { active: false, until: 0 };
const shockwaves = [];

// Lightning strikes by the campfire: flash, shockwave, scatter, and
// everyone comes running. Used by storms AND by clicking the campfire.
// --- Lightning bolts: jagged glowing channel from the sky to the fire ---
const bolts = [];
let grabRT = null;
const BOLT_UP = new THREE.Vector3(0, 1, 0);
function spawnBolt(x, z) {
  const gy = groundYAt(x, z);
  const topY = gy + 46;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xeaf6ff,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // main channel: wander toward the target, snapping onto it at the base
  const pts = [[x + (Math.random() - 0.5) * 10, topY, z + (Math.random() - 0.5) * 10]];
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    let px = pts[i - 1][0] + (x - pts[i - 1][0]) * 0.45 + (Math.random() - 0.5) * (1 - f) * 7;
    let pz = pts[i - 1][2] + (z - pts[i - 1][2]) * 0.45 + (Math.random() - 0.5) * (1 - f) * 7;
    if (i === steps) { px = x; pz = z; }
    pts.push([px, topY - (topY - (gy + 0.5)) * f, pz]);
  }
  const chains = [pts];
  // two short forked branches off random mid points
  for (let b = 0; b < 2; b++) {
    const i0 = 3 + Math.floor(Math.random() * 4);
    const bp = [pts[i0].slice()];
    let bx = pts[i0][0], by = pts[i0][1], bz = pts[i0][2];
    for (let s = 0; s < 3; s++) {
      bx += (Math.random() - 0.5) * 6;
      by -= 2 + Math.random() * 3;
      bz += (Math.random() - 0.5) * 6;
      bp.push([bx, by, bz]);
    }
    chains.push(bp);
  }
  for (const chain of chains) {
    const w = chain === pts ? 0.28 : 0.12;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = new THREE.Vector3(chain[i][0], chain[i][1], chain[i][2]);
      const b = new THREE.Vector3(chain[i + 1][0], chain[i + 1][1], chain[i + 1][2]);
      const len = a.distanceTo(b);
      if (len < 0.01) continue;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(BOLT_UP, b.sub(a).normalize());
      group.add(seg);
    }
  }
  // hot glow at the impact point
  const glowTex = blobTex; // radial gradient, reused
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xcfe8ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  glow.scale.set(3.2, 3.2, 1);
  glow.position.set(x, gy + 1.2, z);
  group.add(glow);
  scene.add(group);
  bolts.push({ group, mat, t0: tNow });
}

let pendingFlash = false;
let campfireFlareT = -99; // last strike time, drives the ignition flare-up
// smooth cinematic fly-to: glides target + camera onto a point of interest
let camTween = null;
function tweenCameraTo(tx, ty, tz, dist, dur = 1.15) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (dir.lengthSq() < 0.01) dir.set(0.6, 0.8, 0.6);
  dir.normalize();
  const toT = new THREE.Vector3(tx, ty, tz);
  const toP = toT.clone().addScaledVector(dir, dist);
  toP.y = Math.max(toP.y, ty + dist * 0.45); // pleasant downward angle
  camTween = {
    t0: performance.now(),
    dur: dur * 1000,
    fromT: controls.target.clone(),
    toT,
    fromP: camera.position.clone(),
    toP,
  };
}
// pure translation: keeps the current orbit angle/distance, glides the view
// onto a new pivot (used when switching between selected villagers)
function tweenCameraTranslate(dx, dy, dz, dur = 0.85) {
  camTween = {
    t0: performance.now(),
    dur: dur * 1000,
    fromT: controls.target.clone(),
    toT: controls.target.clone().add(new THREE.Vector3(dx, dy, dz)),
    fromP: camera.position.clone(),
    toP: camera.position.clone().add(new THREE.Vector3(dx, dy, dz)),
  };
}
// glide pivot AND camera to exact poses (used for home-style framing)
function tweenCameraPose(toT, toP, dur = 1.15) {
  camTween = {
    t0: performance.now(),
    dur: dur * 1000,
    fromT: controls.target.clone(),
    toT,
    fromP: camera.position.clone(),
    toP,
  };
}
function stepCamTween() {
  if (!camTween) return;
  const k = Math.min(1, (performance.now() - camTween.t0) / camTween.dur);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  controls.target.lerpVectors(camTween.fromT, camTween.toT, e);
  camera.position.lerpVectors(camTween.fromP, camTween.toP, e);
  if (k >= 1) camTween = null;
}
// any direct camera input from the user takes over and cancels the fly-to
window.addEventListener('pointerdown', () => { camTween = null; }, true);
window.addEventListener('wheel', () => { camTween = null; }, { passive: true, capture: true });

function wakeCaveman(cm) {
  if (!cm || !cm.sleeping) return;
  // the founding couple stays asleep until the first campfire strike;
  // no dawn, selection or steering may rouse them before that moment
  if (cm.founder && !tribeAwoken) return;
  cm.sleeping = false;
  cm.hold = false;
  cm.wait = 0;
  cm.target = null;
  applySleepPose(cm, false); // back on their feet
  // startled little hop, reusing the shockwave air-time physics
  cm.airH = 0.01;
  cm.airV = 6.5;
}

// ============================================================================
// Knowledge book: a discovery tree of humanity's ideas. Nodes unlock through
// play (clicking the campfire teaches Fire; wading into the sea with a
// commanded villager teaches Water) and persist across sessions.
// ============================================================================
const KNOW_META = [
  {
    key: 'fire', icon: '🔥', title: 'Fire',
    lore:
      'Lightning kissed the dry wood and the tribe did not flee — they watched. ' +
      'Fire gives warmth through the long nights, cooks the harvest, keeps the ' +
      'predators at bay, and gathers every villager around its glow.',
    hint: 'Strike the campfire to discover Fire.',
  },
  {
    key: 'water', icon: '💧', title: 'Water',
    lore:
      'One brave villager stepped past the fear of their ancestors and waded into ' +
      'the singing blue. Water hides fish and salt and travel routes — and no ' +
      'longer frightens those who understand it.',
    hint: 'Command a villager and walk into the sea to discover Water.',
  },
  // future chapters of the tree — shown locked until they are built
  { key: 'tools', icon: '🔨', title: 'Toolmaking', lore: '', hint: 'Yet to be discovered…' },
  { key: 'farming', icon: '🌾', title: 'Farming', lore: '', hint: 'Yet to be discovered…' },
  { key: 'writing', icon: ['📜'][0], title: 'Writing', lore: '', hint: 'Yet to be discovered…' },
  { key: 'wheel', icon: '☸️', title: 'The Wheel', lore: '', hint: 'Yet to be discovered…' },
];
const KNOW = { fire: false, water: false };
try {
  const savedKnow = JSON.parse(localStorage.getItem('pw-knowledge') || '{}');
  for (const k of ['fire', 'water']) if (savedKnow[k]) KNOW[k] = true;
} catch (_) { /* private mode etc. */ }

function unlockKnowledge(key) {
  if (KNOW[key]) return false;
  const meta = KNOW_META.find((m) => m.key === key);
  if (!meta) return false;
  KNOW[key] = true;
  try {
    localStorage.setItem('pw-knowledge', JSON.stringify(KNOW));
  } catch (_) {}
  toast(`📖 Knowledge unlocked: ${meta.icon} ${meta.title}!`, 'know');
  refreshKnowTree();
  return true;
}

// daylight factor mirrored every frame from the sky update (0 = deep night)
let daylightK = 1;

function refreshKnowTree() {
  const tree = document.getElementById('know-tree');
  if (!tree) return;
  tree.querySelectorAll('.know-node').forEach((n) => {
    const meta = KNOW_META.find((m) => m.key === n.dataset.key);
    const open = KNOW[meta.key];
    n.classList.toggle('unlocked', open);
    n.querySelector('.know-ico').textContent = open ? meta.icon : '🔒';
    n.title = open ? meta.title : meta.hint;
  });
}

function buildBookPanel() {
  const tree = document.getElementById('know-tree');
  KNOW_META.forEach((meta, i) => {
    const n = document.createElement('button');
    n.type = 'button';
    n.className = 'know-node';
    n.dataset.key = meta.key;
    n.style.setProperty('--i', i);
    n.innerHTML =
      `<span class="know-branch"></span><span class="know-ico">🔒</span>` +
      `<span class="know-tt">${meta.title}</span>`;
    n.addEventListener('click', () => {
      const d = document.getElementById('know-detail');
      const open = KNOW[meta.key];
      d.innerHTML = open
        ? `<h3>${meta.icon} ${meta.title}</h3><p>${meta.lore}</p>`
        : `<h3>🔒 ${meta.title}</h3><p class="know-hint">${meta.hint}</p>`;
      tree.querySelectorAll('.know-node').forEach((x) => x.classList.remove('sel'));
      n.classList.add('sel');
    });
    tree.appendChild(n);
  });
  refreshKnowTree();
}
buildBookPanel();

const bookToggle = document.getElementById('book-toggle');
const bookPanel = document.getElementById('book-panel');
bookToggle.addEventListener('click', () => {
  const open = !bookPanel.classList.contains('open');
  bookPanel.classList.toggle('open', open);
});
document.getElementById('book-close').addEventListener('click', () =>
  bookPanel.classList.remove('open')
);

// --- energy: villagers run on a daily battery ------------------------------
// Drain while awake, recharge while asleep; hitting zero forces sleep until
// partly rested, and dark evenings send tired folk to bed automatically.
function putToSleep(cm) {
  if (cm.sleeping) return;
  cm.sleeping = true;
  cm.moving = false;
  cm.target = null;
  cm.gatherSlot = null;
  cm.velX = cm.velZ = 0;
  applySleepPose(cm, true);
}

function updateCmEnergy(cm, dt) {
  const gH = timePaused ? 0 : (dt * timeSpeed) / 60; // game-hours elapsed
  if (!gH) return;
  if (cm.sleeping) {
    cm.energy = Math.min(100, cm.energy + gH * 26); // full night ≈ full bar
    if (cm.forcedSleep && cm.energy >= 42) cm.forcedSleep = false;
    else if (
      !cm.forcedSleep && daylightK > 0.55 && cm.energy > 72 &&
      !inSquadCmd(cm) && !(cm.gatherIgnoreUntil > gameMs)
    ) wakeCaveman(cm); // rested villagers rise with the sun
    return;
  }
  cm.energy = Math.max(0, cm.energy - gH * 4.6);
  if (cm.energy <= 0.01) {
    cm.forcedSleep = true;
    putToSleep(cm); // collapse where they stand
    return;
  }
  // bedtime: once it is properly dark, tired humans curl up and sleep
  if (daylightK < 0.22 && cm.energy < 86 && !cm.hold && !inSquadCmd(cm)) {
    putToSleep(cm);
  }
}

function strikeCampfire() {
  window.__strikeCount = (window.__strikeCount || 0) + 1;
  // clicking the fire drops any selected villager and reframes the view
  // exactly like the home button: wide shot, never zoomed in on the flames
  selectCaveman(null);
  followCm = null;
  if (!spaceMode && !iconMode) {
    const fy = homeFire ? homeFire.position.y : groundYAt(homePos.x, homePos.z);
    tweenCameraPose(
      new THREE.Vector3(homePos.x, fy + 1.5, homePos.z),
      new THREE.Vector3(homePos.x, fy + 44, homePos.z + 55),
      1.25
    );
    desiredDist = clampZoom(Math.hypot(44, 55)); // match the home-button zoom
  }
  // the blast wakes every sleeping villager: they hop up startled
  tribeAwoken = true; // first strike rouses the founding couple for good
  for (const c of cavemen) wakeCaveman(c);
  const sx = homePos.x + (Math.random() - 0.5) * 2;
  const sz = homePos.z + (Math.random() - 0.5) * 2;
  spawnBolt(sx, sz);
  spawnShockwave(sx, sz);
  pushCavemen(sx, sz);
  startGather();
  pendingFlash = true;
  // the bolt ignites the campfire: flames burst up like the original lighting
  igniteHome();
  campfireFlareT = tNow;
  unlockKnowledge('fire'); // witnessing the strike teaches the tribe Fire
}

function startGather() {
  gather.active = true;
  // a short burst of interest: ~6 game-minutes (~6 real seconds at 1x),
  // scaled by timeSpeed so the event stays visible at any speed
  gather.rate = Math.max(1, timeSpeed);
  gather.until = gameMs + 6 * 60000 * gather.rate;
  // EVERY caveman is called; they rush over excited and scared, and some
  // show a little ascii reaction above their head
  cavemen.forEach((c, i) => {
    if (inSquadCmd(c) || c.hold) return; // never draft the player's villagers
    c.slotIdx = i;
    c.gatherSlot = null;
    c.leaveAt = gameMs + (7 + Math.random() * 3) * 60000 * gather.rate;
    c.excited = true;
    if (Math.random() < 0.45) spawnReaction(c);
  });
  toast('⚡ Lightning struck the campfire!', 'warn');
}

// small ascii reaction bubble above a startled caveman
const REACT_CHARS = ['!', '!!', '?!', '‼', '✦'];
function spawnReaction(cm, chOverride) {
  if (cm.react) return;
  const ch = chOverride || REACT_CHARS[Math.floor(Math.random() * REACT_CHARS.length)];
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.font = 'bold 22px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 4;
  g.strokeStyle = '#2a1c08';
  g.strokeText(ch, 16, 17);
  g.fillStyle = '#ffd54a';
  g.fillText(ch, 16, 17);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  spr.scale.set(0.9, 0.9, 1);
  scene.add(spr);
  cm.react = { spr, born: tNow, dur: 3.5 + Math.random() * 1.5 };
}

// --- sleeper zzz: three little z's drifting up and fading on a loop ------
function ensureZzz(cm) {
  if (cm.zzzSpr) return;
  const cv = document.createElement('canvas');
  cv.width = 40;
  cv.height = 26;
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  );
  spr.renderOrder = 998; // above the world, under nothing important
  spr.center.set(0.5, 0);
  spr.scale.set(0.85, 0.55, 1);
  spr.visible = false;
  scene.add(spr);
  cm.zzzSpr = spr;
  cm.zzzTex = tex;
  cm.zzzCv = cv;
}
function disposeZzz(cm) {
  if (!cm.zzzSpr) return;
  scene.remove(cm.zzzSpr);
  cm.zzzSpr.material.map.dispose();
  cm.zzzSpr.material.dispose();
  cm.zzzSpr = null;
  cm.zzzTex = null;
  cm.zzzCv = null;
}
function drawZzz(cm, tNow) {
  const c = cm.zzzCv.getContext('2d');
  c.clearRect(0, 0, 40, 26);
  c.textAlign = 'center';
  // small -> large z's rising toward the head end, each on its own cycle
  const zs = [
    { x: 7, y: 21, size: 10, ph: 0 },
    { x: 19, y: 13, size: 13, ph: 0.37 },
    { x: 32, y: 6, size: 16, ph: 0.74 },
  ];
  for (const z of zs) {
    const k = (tNow * 0.5 + z.ph) % 1; // cycle position
    c.font = `bold ${z.size}px monospace`;
    c.globalAlpha = 0.95 * Math.sin(Math.PI * k); // fade in and out
    const yy = z.y - k * 5;
    c.lineWidth = 3;
    c.strokeStyle = '#20180c';
    c.strokeText('z', z.x, yy);
    c.fillStyle = '#e8f1ff';
    c.fillText('z', z.x, yy);
  }
  c.globalAlpha = 1;
  cm.zzzTex.needsUpdate = true;
}

function spawnShockwave(x, z) {
  // ultrasonic pulse: two nested translucent ellipsoids swelling outward,
  // like a 3D sound wave rippling through the air
  const group = new THREE.Group();
  group.position.set(x, groundYAt(x, z) + 0.5, z);
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 28, 18),
      new THREE.MeshBasicMaterial({
        color: 0xbfe4ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    m.userData.off = i * 0.16;
    m.visible = false;
    group.add(m);
    rings.push(m);
  }
  scene.add(group);
  shockwaves.push({ mesh: group, rings, t0: tNow });
}

function pushCavemen(sx, sz) {
  for (const cm of cavemen) {
    const p = cm.spr.position;
    const dx = p.x - sx, dz = p.z - sz;
    const d = Math.hypot(dx, dz);
    if (d > 15 || d < 1e-3) continue;
    const k = 1 - d / 15;
    // the shock wave shoves everyone, but those standing near the fire
    // get blasted much harder and tossed into the air
    const mag = 5 + 34 * k * k;
    cm.push = { x: (dx / d) * mag, z: (dz / d) * mag };
    cm.airV = 2 + 9 * k;
    cm.airH = Math.max(cm.airH || 0, 0.01);
    cm.target = null;
    cm.wait = 0.8 + Math.random();
    cm.gatherIgnoreUntil = gameMs + 4000; // stumble before re-gathering
  }
}

// --- Footprints: fading trails stamped into snow, sand and grass ---
const FP_MAX = 240;
const FP_LIFE = 30;
const footprintPool = [];
let fpIdx = 0;
{
  const pc = document.createElement('canvas');
  pc.width = 16; pc.height = 24;
  const pg = pc.getContext('2d');
  pg.fillStyle = '#000';
  pg.beginPath();
  pg.ellipse(8, 9, 5, 7, 0, 0, Math.PI * 2);
  pg.fill();
  pg.fillRect(6, 17, 4, 6);
  const printTex = new THREE.CanvasTexture(pc);
  const fpGeo = new THREE.PlaneGeometry(0.55, 0.8);
  for (let i = 0; i < FP_MAX; i++) {
    const m = new THREE.Mesh(fpGeo, new THREE.MeshBasicMaterial({
      map: printTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.order = 'YXZ';
    m.visible = false;
    scene.add(m);
    footprintPool.push({ mesh: m, born: 0, base: 0 });
  }
}

function dropFootprint(x, z, vx, vz) {
  const gy = groundYAt(x, z);
  const wl = SEA_LEVEL + 0.35 + floodK - droughtK * 1.4;
  if (gy < wl + 0.05) return; // don't print underwater
  const e = footprintPool[fpIdx++ % FP_MAX];
  const len = Math.hypot(vx, vz) || 1;
  e.mesh.position.set(x, gy + 0.07, z);
  e.mesh.rotation.y = Math.atan2(-vx / len, -vz / len);
  let col = 0x2f4d2a, op = 0.22; // faint grass scuff
  if (snowDepth > 0.15 || biomeAt(x, z) === 'snow') {
    col = 0x51688a; op = 0.5; // blue shadow in the snow
  } else if (biomeAt(x, z) === 'desert' || Math.abs(gy - (SEA_LEVEL + 1)) < 1.6) {
    col = 0x7a5630; op = 0.45; // pressed sand
  }
  e.mesh.material.color.setHex(col);
  e.base = op;
  e.born = tNow;
  e.mesh.visible = true;
}

function updateFootprints() {
  for (const e of footprintPool) {
    if (!e.mesh.visible) continue;
    const age = tNow - e.born;
    if (age > FP_LIFE) {
      e.mesh.visible = false;
      continue;
    }
    e.mesh.material.opacity = e.base * (1 - age / FP_LIFE);
  }
}

function updateCavemen(dt, t) {
  for (const cm of cavemen) {
    applyStage(cm);

    // energy ticks for EVERYONE — sleeping or awake, held or free
    updateCmEnergy(cm, dt);

    // while the player steers this villager NOTHING else may move them:
    // no shockwaves, no swim autopilot, no AI — only the stick
    // only the picked lead human obeys the stick directly; squad mates
    // trail behind them at their own random offsets (see followLead below)
    const steered = steerInputActive() && cm === selectedCm;

    // clicked-but-not-yet-steered: total freeze (gathering, wandering,
    // swimming — everything waits for the player's first stick input)
    if (cm.hold && !steered) {
      cm.moving = false;
      cm.target = null;
      cm.gatherSlot = null;
      continue;
    }

    // sleeping villagers stay lying down until something wakes them:
    // steering them or picking them does the trick (see wakeCaveman).
    // Waking an exhausted sleeper grants a small grace burst so they
    // don't instantly collapse again under the player's command.
    if (cm.sleeping && steered) {
      if (cm.energy < 8) cm.energy = 8;
      cm.forcedSleep = false;
      wakeCaveman(cm);
    }
    if (cm.sleeping) {
      cm.moving = false;
      continue;
    }

    // COMMANDED VILLAGERS HOLD POSITION: a selected human never wanders,
    // gathers or drifts on their own — they stand where they are until
    // the player moves the stick. Deep water is the one exception: even
    // a commanded villager paddles back toward land rather than drown.
    // An active Move command or a follow order walks them instead.
    if (!steered && inSquadCmd(cm) && !cm.actionMove && !cm.followLead) {
      cm.moving = false;
      cm.target = null;
      cm.gatherSlot = null;
      const p = cm.spr.position;
      if (waterDepthAt(p.x, p.z) > 0.25) {
        cm.swimming = true;
        let best = null;
        for (let i = 0; i < 10; i++) {
          const sa = (i / 10) * Math.PI * 2 + cm.phase;
          const sx = p.x + Math.cos(sa) * 7;
          const sz = p.z + Math.sin(sa) * 7;
          if (waterDepthAt(sx, sz) <= 0 && !treeHit(sx, sz)) { best = { x: sx, z: sz }; break; }
        }
        if (best) {
          const ddx = best.x - p.x, ddz = best.z - p.z;
          const dd = Math.hypot(ddx, ddz) || 1;
          const sp = 2.8 * dt;
          p.x += (ddx / dd) * sp;
          p.z += (ddz / dd) * sp;
        }
      } else {
        cm.swimming = false;
      }
      cm.gy = charGroundY(p.x, p.z);
      continue;
    }

    // shockwave impulse (shoves even idle or gathered cavemen)
    if (cm.push && !steered) {
      const p = cm.spr.position;
      p.x += cm.push.x * dt;
      p.z += cm.push.z * dt;
      const decay = Math.pow(0.002, dt);
      cm.push.x *= decay;
      cm.push.z *= decay;
      cm.gy = charGroundY(p.x, p.z);
      if (Math.hypot(cm.push.x, cm.push.z) < 0.2) cm.push = null;
    }

    // campfire gathering: walk to a ring slot, stand facing the fire,
    // then lose interest one by one once the excitement fades
    let gathering = false;
    if (
      gather.active && cavemen.length &&
      cavemen.every((c) => c.leaveAt && gameMs >= c.leaveAt)
    ) {
      gather.active = false; // everyone wandered off
    }
    if (gather.active && !cm.hold && !inSquadCmd(cm) && !(cm.gatherIgnoreUntil > gameMs)) {
      if (!cm.leaveAt && gameMs >= gather.until) {
        cm.leaveAt = gameMs + (2 + Math.random() * 9) * 60000 * (gather.rate || 1);
      }
      if (cm.leaveAt && gameMs >= cm.leaveAt) {
        cm.gatherSlot = null;
        cm.target = null;
        cm.wait = 0.3;
      } else {
        gathering = true;
        if (!cm.gatherSlot) {
          const a = (cm.slotIdx || 0) * 2.399963; // golden-angle ring spread
          const rr = 3.6 + ((cm.slotIdx || 0) % 3) * 0.9;
          cm.gatherSlot = {
            x: homePos.x + Math.cos(a) * rr,
            z: homePos.z + Math.sin(a) * rr,
          };
        }
        cm.target = cm.gatherSlot;
      }
    } else if (cm.gatherSlot || cm.leaveAt) {
      cm.gatherSlot = null;
      cm.leaveAt = 0;
    }

    // squad followers trail the lead human at a personal random offset:
    // while the leader walks they fan out BEHIND it in a loose line; when
    // it stands still they spread around it. The offset re-rolls only when
    // the follower catches up to its spot or gets left far behind, so they
    // trail smoothly instead of zig-zagging.
    if (!steered && cm.followLead && !gathering) {
      const ppos = cm.spr.position;
      const lp = cm.followLead.spr.position;
      const distToLeader = Math.hypot(lp.x - ppos.x, lp.z - ppos.z);
      const nearTarget = !cm.target ||
        Math.hypot(cm.target.x - ppos.x, cm.target.z - ppos.z) < 1.1;
      const leaderMoved = !cm.followLastLead ||
        Math.hypot(lp.x - cm.followLastLead.x, lp.z - cm.followLastLead.z) > 1.5;
      // which way is the leader heading right now?
      let dir = null;
      if (cm.followLead.actionMove) {
        const adx = cm.followLead.actionMove.x - lp.x;
        const adz = cm.followLead.actionMove.z - lp.z;
        const add = Math.hypot(adx, adz);
        if (add > 0.5) dir = { x: adx / add, z: adz / add };
      } else if (cm.followLead === selectedCm && charJoy.active) {
        const jl = Math.hypot(charJoy.x, charJoy.z);
        if (jl > 0.05) dir = { x: charJoy.x / jl, z: charJoy.z / jl };
      }
      if ((nearTarget && (leaderMoved || !dir)) || distToLeader > 6.5) {
        let off;
        if (dir && distToLeader <= 6.5) {
          // walking leader, close enough: trail behind it, fanning sideways
          const back = 2.2 + Math.random() * 2.4;
          const side = (Math.random() - 0.5) * 5.0;
          off = { x: lp.x - dir.x * back - dir.z * side, z: lp.z - dir.z * back + dir.x * side };
        } else if (distToLeader > 6.5) {
          // lost the pack (or blocked by terrain): converge on the leader
          // itself instead of a spot behind it, so it can rejoin the trail
          off = { x: lp.x + (Math.random() - 0.5) * 0.6, z: lp.z + (Math.random() - 0.5) * 0.6 };
        } else {
          // standing leader: spread around it
          const a = Math.random() * Math.PI * 2;
          const r = 1.6 + Math.random() * 2.6;
          off = { x: lp.x + Math.cos(a) * r, z: lp.z + Math.sin(a) * r };
        }
        cm.target = off;
        cm.followOff = off;
        cm.followLastLead = { x: lp.x, z: lp.z };
      }
      cm.wait = 0;
      cm.gatherSlot = null;
      cm.leaveAt = 0;
    }

    cm.moving = false;
    // steered villagers obey the stick unconditionally: never queued behind
    // idle waits or wander picks, so you can move them at any time
    if (!gathering && !steered) {
      if (cm.wait > 0) {
        cm.wait -= dt;
        continue;
      }
      if (!cm.target) {
        // a commanded human with no reachable path gives up and holds
        // position rather than drifting back into idle wandering
        if (cm.actionMove || cm.followLead) {
          if (cm.actionMove) { cm.actionMove = null; hideMoveFlag(); }
          continue;
        }
        // Move mode armed, or the options menu open on them: nobody strolls
        // off randomly — the pick, the party and the target all hold still
        if (inFreezeHold(cm)) {
          cm.moving = false;
          continue;
        }
        pickWanderTarget(cm);
        continue;
      }
    }
    const pos = cm.spr.position;

    // swimming: anyone in deep water paddles to the nearest shore,
    // slower and half-submerged (the steered villager picks their own way)
    const depHere = waterDepthAt(pos.x, pos.z);
    cm.swimming = depHere > 0.25;
    if (cm.swimming && !steered && (!cm.shoreT || t > cm.shoreT)) {
      for (let i = 0; i < 10; i++) {
        const sa = (i / 10) * Math.PI * 2 + cm.phase;
        const swx = pos.x + Math.cos(sa) * 7;
        const swz = pos.z + Math.sin(sa) * 7;
        if (waterDepthAt(swx, swz) <= 0) { cm.target = { x: swx, z: swz }; break; }
      }
      cm.shoreT = t + 1.5;
      cm.wait = 0;
    }

    // player steering: the selected villager obeys the joystick / WASD
    // (kept alive while the eased stick decays to zero after release)
    if (steered) {
      cm.hold = false; // first input takes ownership
      cm.target = null;
      cm.gatherSlot = null;
      cm.leaveAt = 0; // fire interest fully dropped while commanded
      cm.excited = false;
      cm.gatherIgnoreUntil = gameMs + 60000;
      // smooth walking: the eased stick commands a pace, and a per-villager
      // VELOCITY ramps toward it — starts, stops and turns glide instead of
      // snapping. Free roam: no tree snagging while the player is in control
      const js = (cm.swimming ? 3.1 : 5.2) * anatMobility(cm);
      cm.velX = THREE.MathUtils.damp(cm.velX || 0, charJoy.x * js, 10, dt);
      cm.velZ = THREE.MathUtils.damp(cm.velZ || 0, charJoy.z * js, 10, dt);
      pos.x += cm.velX * dt;
      pos.z += cm.velZ * dt;
      // first commanded villager to brave the sea discovers Water
      if (!KNOW.water && waterDepthAt(pos.x, pos.z) > 0.14) {
        unlockKnowledge('water');
        spawnReaction(cm, '✨');
      }
      if (Math.abs(cm.velX) > 0.45) cm.faceL = cm.velX < 0;
      setCmFace(cm);
      cm.moving = Math.hypot(cm.velX, cm.velZ) > 0.25; // walk bob eases out
      cm.gy = charGroundY(pos.x, pos.z);
      continue;
    }

    const dx = cm.target.x - pos.x;
    const dz = cm.target.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) {
      if (gathering) {
        // stand in the circle and watch the fire — excitedly trembling
        cm.faceL =
          (homePos.x - pos.x) * rigRight.x + (homePos.z - pos.z) * rigRight.z < 0;
        setCmFace(cm);
        pos.x += (cm.gatherSlot.x - pos.x) * 0.2 + (Math.random() - 0.5) * 0.12;
        pos.z += (cm.gatherSlot.z - pos.z) * 0.2 + (Math.random() - 0.5) * 0.12;
        continue;
      }
      cm.target = null;
      cm.wait = 0.8 + Math.random() * 2.5;
      if (cm.actionMove) { cm.actionMove = null; hideMoveFlag(); }
      continue;
    }
    // excited cavemen rush to the fire; squad followers hustle up to +65%
    // the further they lag, so the pack never strings out behind the leader
    const spd = cm.speed * (gathering ? 2.2 : 1) * (cm.swimming ? 0.45 : 1) *
      anatMobility(cm) * (cm.followLead ? 1 + Math.min(0.65, d * 0.09) : 1);
    const step = Math.min(spd * dt, d);
    const vx = dx / d, vz = dz / d;
    const nx = pos.x + vx * step;
    const nz = pos.z + vz * step;

    // ground collision: block movement onto ledges higher than one step
    const gyNext = groundYAt(nx, nz);
    if (gyNext - cm.gy > CAVEMAN_STEP_UP) {
      if (gathering) {
        // nudge the slot sideways so they find a way around
        cm.gatherSlot.x += (Math.random() - 0.5) * 1.6;
        cm.gatherSlot.z += (Math.random() - 0.5) * 1.6;
      } else {
        cm.target = null;
        cm.wait = 0.4 + Math.random() * 1.2;
      }
      continue;
    }

    // nobody walks into the fireplace: people keep a polite distance
    const fdx = nx - homePos.x, fdz = nz - homePos.z;
    const tooClose = gathering ? false : fdx * fdx + fdz * fdz < 5.29; // 2.3u
    // tree trunk collision: full move, then slide along a single axis
    if (!tooClose && !treeHit(nx, nz)) {
      pos.x = nx;
      pos.z = nz;
    } else if (!treeHit(nx, pos.z)) {
      pos.x = nx;
    } else if (!treeHit(pos.x, nz)) {
      pos.z = nz;
    } else {
      if (gathering) {
        cm.gatherSlot.x += (Math.random() - 0.5) * 1.6;
        cm.gatherSlot.z += (Math.random() - 0.5) * 1.6;
      } else {
        cm.target = null;
        cm.wait = 0.4 + Math.random() * 1.2;
      }
      continue;
    }
    cm.gy = charGroundY(pos.x, pos.z);
    cm.moving = true;
    cm.faceL = (vx * rigRight.x + vz * rigRight.z) < 0;
    setCmFace(cm);
    // stamp footprints every ~1.1 units, alternating left/right
    cm.printAcc = (cm.printAcc || 0) + step;
    if (cm.printAcc > 1.1) {
      cm.printAcc = 0;
      cm.fpSide = -(cm.fpSide || 1);
      dropFootprint(
        pos.x - vz * 0.18 * cm.fpSide,
        pos.z + vx * 0.18 * cm.fpSide,
        vx, vz
      );
    }
  }

  // caveman-vs-caveman separation — steered villagers are never shoved:
  // crowd members yield around them instead
  const steerA = steerInputActive();
  for (let i = 0; i < cavemen.length; i++) {
    for (let j = i + 1; j < cavemen.length; j++) {
      const ca = cavemen[i], cb = cavemen[j];
      const a = ca.spr.position;
      const b = cb.spr.position;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d > CAVEMAN_MIN_DIST) continue;
      let d2;
      if (d < 1e-4) { dx = 1; dz = 0; d2 = 1; } else { d2 = d; }
      const pushAmt = CAVEMAN_MIN_DIST - d;
      const aS = steerA && inSquadCmd(ca);
      const bS = steerA && inSquadCmd(cb);
      if (aS && bS) continue; // two squad mates moving together: no fight
      if (aS || bS) {
        // the steered one holds course; the other gives way completely
        const full = pushAmt / d2;
        if (aS) { b.x += dx * full; b.z += dz * full; cb.gy = groundYAt(b.x, b.z); }
        else { a.x -= dx * full; a.z -= dz * full; ca.gy = groundYAt(a.x, a.z); }
      } else {
        const half = pushAmt / 2 / d2;
        a.x -= dx * half; a.z -= dz * half;
        b.x += dx * half; b.z += dz * half;
        ca.gy = groundYAt(a.x, a.z);
        cb.gy = groundYAt(b.x, b.z);
      }
    }
  }

  // settle on the ground after all movement/collision (with blast air time)
  for (const cm of cavemen) {
    // walk-to-pickup: the carrier reaches the highlighted human and hoists
    // them — the white highlight lifts into the carry
    if (cm.pickUpTarget) {
      const tgt = cm.pickUpTarget;
      const d = Math.hypot(
        cm.spr.position.x - tgt.spr.position.x,
        cm.spr.position.z - tgt.spr.position.z
      );
      if (d < 1.7) {
        cm.pickUpTarget = null;
        pickUpVillager(cm, tgt);
        closeActionMenu(true);
      }
    }
    // hoisted: dangle over the carrier's head and ride along wherever they go
    if (cm.carriedBy) {
      const ca = cm.carriedBy;
      cm.spr.position.x = ca.spr.position.x + Math.sin(t * 4 + cm.phase) * 0.16;
      cm.spr.position.z = ca.spr.position.z + Math.cos(t * 3.4 + cm.phase) * 0.12;
      cm.gy = ca.spr.position.y + ca.spr.scale.y * 0.55 + 0.5;
      cm.moving = false;
      cm.swimming = false;
      cm.spr.position.y = cm.gy;
      if (cm.sleeping && !cm.sleepApplied) applySleepPose(cm, true);
      else if (!cm.sleeping && cm.sleepApplied) applySleepPose(cm, false);
      continue;
    }
    if (cm.airH > 0 || cm.airV) {
      cm.airV -= 30 * dt;
      cm.airH += cm.airV * dt;
      if (cm.airH <= 0) { cm.airH = 0; cm.airV = 0; }
    }
    const depS = cm.swimming ? SEA_LEVEL - cm.gy : 0;
    const airH = cm.airH || 0;
    cm.spr.position.y =
      cm.gy + airH -
      Math.min(0.9, Math.max(0, depS) * 0.5) +
      (cm.moving ? Math.abs(Math.sin(t * 9 + cm.phase)) * (cm.swimming ? 0.2 : 0.12) : 0);
    // dedicated sleeping sprite: each villager's own lying-down pixel art
    if (cm.sleeping && !cm.sleepApplied) applySleepPose(cm, true);
    else if (!cm.sleeping && cm.sleepApplied) applySleepPose(cm, false);
  }
}

// --- floating CAMP marker: name + human count, visible from any distance ---
const campLabelCanvas = document.createElement('canvas');
campLabelCanvas.width = 256;
campLabelCanvas.height = 72;
const campLabelTex = new THREE.CanvasTexture(campLabelCanvas);
campLabelTex.magFilter = THREE.LinearFilter;
const campLabelSpr = new THREE.Sprite(new THREE.SpriteMaterial({
  map: campLabelTex,
  transparent: true,
  depthTest: false, // never hidden by terrain
  depthWrite: false,
}));
campLabelSpr.renderOrder = 999;
scene.add(campLabelSpr);
let campCountShown = -1;
function drawCampLabel() {
  const c = campLabelCanvas.getContext('2d');
  c.clearRect(0, 0, 256, 72);
  // little pixel house icon
  c.fillStyle = '#ffe9a8';
  c.fillRect(14, 30, 20, 16);          // body
  for (let i = 0; i < 5; i++) {        // roof
    c.fillRect(12 + i * 3, 26 - i * 4, 22 - i * 6, 4);
  }
  c.fillStyle = '#7a5230';
  c.fillRect(21, 36, 6, 10);           // door
  // text
  c.font = 'bold 34px monospace';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  const txt = 'CAMP';
  c.lineWidth = 7;
  c.strokeStyle = 'rgba(10, 10, 14, 0.9)';
  c.strokeText(txt, 44, 38);
  c.fillText(txt, 44, 38);
  // pixel person icon + live human count
  c.fillStyle = '#ffe9a8';
  c.fillRect(146, 22, 10, 10);         // head
  c.fillRect(144, 34, 14, 16);         // body
  const count = String(cavemen.length);
  c.strokeText(count, 164, 38);
  c.fillText(count, 164, 38);
  campLabelTex.needsUpdate = true;
}

const placeHint = document.getElementById('place-hint');

function setPlacing(kind) {
  placingKind = kind;
  document.querySelectorAll('.asset-card').forEach((c) =>
    c.classList.toggle('selected', c.dataset.kind === kind)
  );
  placeHint.classList.toggle('show', !!kind);
  renderer.domElement.style.cursor = kind ? 'crosshair' : '';
  for (const g of Object.values(ghosts)) g.visible = false;
  ghostHasPos = false;
}

document.getElementById('assets-body').addEventListener('click', (e) => {
  const btn = e.target.closest('.asset-info-btn');
  if (btn) {
    e.stopPropagation();
    btn.closest('.asset-card').classList.toggle('expanded');
    return;
  }
  const card = e.target.closest('.asset-card');
  if (!card || !card.dataset.kind) return;
  setPlacing(placingKind === card.dataset.kind ? null : card.dataset.kind);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') setPlacing(null);
});

const raycaster = new THREE.Raycaster();
const placeNdc = new THREE.Vector2();
let placeDownX = 0, placeDownY = 0;
let ghostHasPos = false;

// --- Character preview panel ---
const charPanel = document.getElementById('char-panel');
const charCanvas = document.getElementById('char-canvas');
const charCtx = charCanvas.getContext('2d');
const CHAR_SCALE = 5;

// live 3D backdrop for the character window: a small camera circles the
// selected character and the scene is drawn into the panel's window using
// the MAIN renderer (scissored picture-in-picture, no second GL context)
const charBgCanvas = document.getElementById('char-bg');
let previewCamera = new THREE.PerspectiveCamera(50, 134 / 104, 0.1, 80);
let prevOrbitAng = 0;
let prevRT = null;      // offscreen target for the live portrait
let prevBuf = null;     // raw RGBA readback
let prevImg = null;     // flipped ImageData for the panel canvas
let prevRect = null;
let prevFrameN = 0;

function makePreviewPair(art, pal) {
  const R = document.createElement('canvas');
  drawPixelArt(R, art, pal, CHAR_SCALE);
  const L = document.createElement('canvas');
  L.width = R.width;
  L.height = R.height;
  const c = L.getContext('2d');
  c.translate(L.width, 0);
  c.scale(-1, 1);
  c.drawImage(R, 0, 0);
  return [R, L];
}

const PREVIEWS = {
  child: makePreviewPair(CAVEMAN_CHILD, CAVEMAN_PALETTE),
  adult: makePreviewPair(CAVEMAN, CAVEMAN_PALETTE),
  elder: makePreviewPair(CAVEMAN_ELDER, CAVEMAN_ELDER_PALETTE),
};
const FEMALE_PREVIEWS = {
  child: makePreviewPair(CAVEWOMAN_CHILD, CAVEWOMAN_PALETTE),
  adult: makePreviewPair(CAVEWOMAN, CAVEWOMAN_PALETTE),
  elder: makePreviewPair(CAVEWOMAN_ELDER, CAVEWOMAN_ELDER_PALETTE),
};
const charSexEl = document.getElementById('char-sex');
charCanvas.width = 16 * CHAR_SCALE;
charCanvas.height = 19 * CHAR_SCALE;
charCtx.imageSmoothingEnabled = false;

let selectedCm = null;
let lastPanelFace = null;
let lastAgeStr = '';
let lastVitalsStr = '';

const charJoy = { x: 0, z: 0, tx: 0, tz: 0, active: false }; // villager steering
let followCm = null; // camera tracks this villager while selected
const followPrev = new THREE.Vector3();
function selectCaveman(cm) {
  if (selectedCm && selectedCm.outSpr) selectedCm.outSpr.visible = false;
  const prev = selectedCm;
  selectedCm = cm;
  followCm = cm || null;
  if (cm) {
    followPrev.copy(cm.spr.position);
    if (cm.sleeping) wakeCaveman(cm); // picking someone wakes them up
    if (cm.carriedBy) putDownVillager(cm); // can't steer while dangling
    // squad members keep trailing whoever is now the lead human
    if (squad.size > 1) {
      for (const c of squad) {
        if (c !== cm) { c.followLead = cm; c.followLastLead = null; }
      }
    }
    // centre the camera on them: glide BOTH target and camera by the same
    // offset so the view translates onto the villager without spinning
    const p = cm.spr.position;
    const dx = p.x - controls.target.x;
    const dy = p.y + 1.5 - controls.target.y;
    const dz = p.z - controls.target.z;
    tweenCameraTranslate(dx, dy, dz, 0.85);
    snapZoom();
    // selected, not frozen: they keep living and wander randomly until
    // your stick takes over (steering always outranks their AI)
    cm.target = null;
    cm.gatherSlot = null;
    cm.hold = false; // selected humans keep living: they wander randomly
    cm.wait = 0.3;
  }
  if (!cm && prev) {
    prev.hold = false; // thaw on deselect
    prev.wait = 0;     // …and let normal life resume immediately
    prev.followLead = null;
    clearSquad();      // closing the panel ends group command
    setActionMode(false); // the Move command only makes sense with a pick
    hideMoveFlag();
    dropAllCarried();  // everything being hoisted comes back down too
    closeActionMenu(true); // …and any options popup / white highlight
  }
  // selecting never opens the sheet by itself: the panel only expands from
  // the Villager button. Tapping villagers just highlights + follows them.
  if (!cm) collapseSheet();
  else if (charPanel.classList.contains('open')) syncSheetHeight();
  lastPanelFace = null;
  if (!cm) {
    charSexEl.textContent = '';
    renderRoster();
    return;
  }
  if (cm.outSpr) {
    cm.outSpr.visible = true;
    syncOutline(cm); // correct color + hugging the lying pose if asleep
  }
  // little badge: who is who at a glance
  charSexEl.textContent = cm.female ? '\u2640' : '\u2642';
  charSexEl.className = cm.female ? 'female' : 'male';
  document.getElementById('char-name').textContent = cm.stats.name;
  const vit = villagerVitals(cm);
  document.getElementById('st-cond').textContent = vit.cond;
  document.getElementById('st-hp').textContent = cm.stats.health + ' / 100';
  document.getElementById('hp-fill').style.width = cm.stats.health + '%';
  document.getElementById('st-weight').textContent = vit.weight;
  document.getElementById('st-height').textContent = vit.height;
  document.getElementById('st-iq').textContent = vit.iq;
  lastAgeStr = '';
  anatOnSelect();
  renderRoster();
}

// realistic derived vitals: children are smaller & lighter, minds sharpen
// slowly over a lifetime, and condition reads out from health
function villagerVitals(cm) {
  const yrs = Math.floor(
    cm.stats.baseAge + (gameMs - cm.stats.bornGameMs) / 86400000
  );
  const grow = Math.min(1, 0.5 + (yrs / 16) * 0.5);
  const h = Math.round(cm.stats.heightCm * (yrs < 16 ? grow : 1));
  const w = (cm.stats.weightKg * (yrs < 16 ? grow : 1)).toFixed(1);
  const iq = Math.round(Math.min(95, cm.stats.iqBase + yrs * 0.4));
  const hp = cm.stats.health;
  const cond =
    hp > 85 ? 'Healthy' :
    hp > 65 ? 'Good' :
    hp > 40 ? 'Weak' :
    hp > 20 ? 'Bad' : 'Critical';
  return { yrs, height: h + ' cm', weight: w + ' kg', iq, cond };
}

// ============================================================================
// Anatomy view: pixel-art organs, bones and limbs with per-part health bars,
// wound states (bleeding / scratches / bruises / fractures / organ damage),
// slow healing and a canvas body diagram that replaces the live preview.
// ============================================================================

const ANAT_PAL = {
  R: '#b3202a', r: '#e04848', L: '#ff8a7a', // heart + blood reds
  P: '#f2a0b4', p: '#cf7290',               // brain / gut pinks
  S: '#ef93a8', s: '#c96f88',               // lungs
  O: '#e09a48', o: '#b5793a',               // stomach
  V: '#8f4636', v: '#6d3327',               // liver
  W: '#efe7d2', w: '#c9bfa4',               // bone
  K: '#241416',                             // outline
};

function anatSprite(rows) {
  const c = renderAnatRows(rows, 1);
  c.rows = rows; // keep source rows: the GPU quirk wipes canvases created at
  // load, so docs/export re-render organs from these rows instead
  return c;
}

// deterministic pixel renderer for anatomy art (scale=1 is the original)
function renderAnatRows(rows, scale) {
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = rows.length * scale;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      g.fillStyle = ANAT_PAL[ch] || '#fff';
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return c;
}

const ANAT_ART = {
  heart: anatSprite([
    '.KK...KK...',
    'KRRK.KRRK..',
    'KRrRKRRRRK.',
    'KLRRRRRRrK.',
    'KRRRRRRRrK.',
    '.KRRRRRrK..',
    '..KRRRrK...',
    '...KRrK....',
    '....KK.....',
  ]),
  brain: anatSprite([
    '...KKKKK....',
    '..KPPPPPK...',
    '.KPpPPpPPK..',
    'KPPPPPPPPPK.',
    'KPpPPpPPPPK.',
    'KPPPPPPpPPK.',
    '.KPPpPPPPK..',
    '..KPPPPPK...',
    '...KKKKK....',
  ]),
  lungs: anatSprite([
    '.....KwK.....',
    '.....KsK.....',
    '..KKK.s.KKK..',
    '.KSsK...KsSK.',
    'KSsK.....KsSK',
    'KSsK.....KsSK',
    '.KsK.....KsK.',
    '..KsK...KsK..',
    '...KK...KK...',
  ]),
  stomach: anatSprite([
    '...KKKK....',
    '..KOOOOK...',
    '.KOoOOOKK..',
    '.KOOOOOOK..',
    '.KOOOOOOOK.',
    '..KOOOOOK..',
    '...KKKKK...',
  ]),
  liver: anatSprite([
    '..KKKKKKKK...',
    '.KVVVVVVVVVK.',
    'KVVvVVVVVVVVK',
    'KVVVVVVVVVVVK',
    '.KVVVVVVVVVK.',
    '..KVvVVVVVK..',
    '....KKVVK....',
  ]),
  guts: anatSprite([
    '.KKKKKKKK....',
    '.KpppppppK...',
    '.KKppppppppK.',
    '..KpppppppK..',
    '..KppppppppK.',
    '.KKpppppppK..',
    '.KppppppKK...',
    '.KKKKKKKK....',
  ]),
  skull: anatSprite([
    '..KKKKKK..',
    '.KWWWWWWK.',
    'KWWWWWWWWK',
    'KWKKWWKKWK',
    'KWKKWWKKWK',
    'KWWWKKWWWK',
    '.KWWWWWWK.',
    '.KWKWKKWK.',
    '.KWKWKKWK.',
    '..KKKKKK..',
  ]),
  spine: anatSprite([
    '.....w.....',
    '....KwK....',
    '.KKKKwKKK..',
    'KKKKKwKKKKK',
    'KKKK.w.KKKK',
    '.KKK.w.KKK.',
    '..KK.w.KK..',
    'KKK..w..KKK',
    '.KK..w..KK.',
    '..K..w..K..',
    '.....w.....',
    '....KwK....',
    '....KwK....',
    '...KwwwK...',
    '....KKK....',
  ]),
  pelvis: anatSprite([
    '.KK.......KK.',
    'KWWK.....KWWK',
    'KWWWKKKKKWWWK',
    '.KWWWKWKWWWK.',
    '..KWWWKWWWK..',
    '...KWK.KWK...',
    '....K...K....',
  ]),
  armbone: anatSprite([
    '.KKK.',
    'KWWWK',
    'KWWWK',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    'KWWWK',
    'KWWWK',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    'KWWWK',
    '.KKK.',
  ]),
  legbone: anatSprite([
    'KWWWK',
    'KWWWK',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    'KWWWK',
    'KWWWK',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    '.KWK.',
    'KWWWK',
    '.KKK.',
  ]),
};

const FIG_W = 26, FIG_H = 46;
const BODY_MAP = (() => {
  const g = Array.from({ length: FIG_H }, () => new Array(FIG_W).fill('.'));
  const rect = (x, y, w, h, ch) => {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) g[j][i] = ch;
  };
  // real proportions (~7.5 heads tall):
  //   head ends ~14% · shoulders widest torso point · waist narrowest
  //   crotch at ~46% · knees at ~72% · fingertips reach mid-thigh
  rect(10, 0, 6, 1, 'h');            // crown
  rect(9, 1, 8, 4, 'h');             // cranium
  rect(10, 5, 6, 2, 'h');            // jaw + chin
  rect(11, 7, 4, 2, 'n');            // neck
  rect(7, 9, 12, 1, 't');            // shoulder line (traps)
  rect(7, 10, 12, 3, 't');           // chest / deltoid root
  rect(8, 13, 10, 2, 't');           // lower chest taper
  rect(9, 15, 8, 2, 't');            // waist (narrowest)
  rect(8, 17, 10, 4, 't');           // hips
  rect(5, 9, 3, 3, 'a');             // left deltoid
  rect(18, 9, 3, 3, 'b');            // right deltoid
  rect(5, 12, 2, 8, 'a');            // left upper arm -> elbow r19
  rect(19, 12, 2, 8, 'b');           // right upper arm
  rect(5, 20, 2, 4, 'a');            // left forearm -> wrist r23
  rect(19, 20, 2, 4, 'b');           // right forearm
  rect(5, 24, 2, 2, 'a');            // left hand (mid-thigh)
  rect(19, 24, 2, 2, 'b');           // right hand
  rect(8, 21, 4, 12, 'l');           // left thigh (crotch at ~46%)
  rect(14, 21, 4, 12, 'r');          // right thigh
  rect(9, 33, 3, 2, 'l');            // left knee (~72%)
  rect(14, 33, 3, 2, 'r');           // right knee
  rect(9, 35, 3, 6, 'l');            // left calf
  rect(14, 35, 3, 6, 'r');           // right calf
  rect(9, 41, 2, 3, 'l');            // left ankle
  rect(14, 41, 2, 3, 'r');           // right ankle
  rect(8, 44, 4, 2, 'l');            // left foot
  rect(14, 44, 4, 2, 'r');           // right foot
  return g;
})();

const REGION_PART = { h: 'head', n: 'torso', t: 'torso', a: 'armL', b: 'armR', l: 'legL', r: 'legR' };

const BODY_BOXES = (() => {
  const boxes = {};
  BODY_MAP.forEach((row, y) => row.forEach((ch, x) => {
    const id = REGION_PART[ch];
    if (!id) return;
    const b = boxes[id] || (boxes[id] = { x0: 99, y0: 99, x1: -1, y1: -1 });
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
    if (x > b.x1) b.x1 = x;
    if (y > b.y1) b.y1 = y;
  }));
  return boxes;
})();

const ANAT_PARTS = {
  head: { label: 'Head', grp: 'body' },
  torso: { label: 'Torso', grp: 'body' },
  armL: { label: 'Left arm', grp: 'body' },
  armR: { label: 'Right arm', grp: 'body' },
  legL: { label: 'Left leg', grp: 'body' },
  legR: { label: 'Right leg', grp: 'body' },
  brain: { label: 'Brain', grp: 'organs', art: 'brain', spot: [9, 1, 8] },
  heart: { label: 'Heart', grp: 'organs', art: 'heart', spot: [11, 12, 4] },
  lungs: { label: 'Lungs', grp: 'organs', art: 'lungs', spot: [8.5, 10, 9] },
  liver: { label: 'Liver', grp: 'organs', art: 'liver', spot: [13, 15, 5] },
  stomach: { label: 'Stomach', grp: 'organs', art: 'stomach', spot: [8, 15, 4] },
  guts: { label: 'Intestines', grp: 'organs', art: 'guts', spot: [9, 16, 8] },
  skull: { label: 'Skull', grp: 'bones', art: 'skull', spot: [9, 0, 8] },
  spine: { label: 'Spine & ribs', grp: 'bones', art: 'spine', spot: [8, 7, 10] },
  pelvis: { label: 'Pelvis', grp: 'bones', art: 'pelvis', spot: [8.5, 18, 9] },
  humL: { label: 'Left arm bones', grp: 'bones', art: 'armbone', spot: [4.2, 10, 3, 14], tall: true },
  humR: { label: 'Right arm bones', grp: 'bones', art: 'armbone', spot: [18.8, 10, 3, 14], tall: true },
  femL: { label: 'Left leg bones', grp: 'bones', art: 'legbone', spot: [8.6, 22, 3, 21], tall: true },
  femR: { label: 'Right leg bones', grp: 'bones', art: 'legbone', spot: [14.4, 22, 3, 21], tall: true },
};
const ANAT_ORDER = Object.keys(ANAT_PARTS);
const WOUND_LABEL = {
  cut: 'bleeding', scratch: 'scratched', bruise: 'bruised',
  fracture: 'fractured', damage: 'damaged',
};
const WOUND_HEAL_DAYS = {
  cut: 0.08, scratch: 0.05, bruise: 0.25, fracture: 2.5, damage: 4,
};

function initAnatomy(cm) {
  const parts = {};
  for (const id of ANAT_ORDER) parts[id] = { hp: 100, wounds: [] };
  // elders carry a bit of wear so the default view has some history
  if (cm.stats.baseAge >= 58) {
    const limb = ['legL', 'legR', 'armL', 'armR'][Math.floor(Math.random() * 4)];
    parts[limb].hp = 82 + Math.floor(Math.random() * 12);
    parts[limb].wounds.push({ t: 'bruise', sv: 1, age: 0 });
  }
  cm.anat = { parts };
}

function ensureAnatomy(cm) {
  if (!cm.anat) initAnatomy(cm);
  return cm.anat;
}

function addWound(cm, id, type, sv) {
  ensureAnatomy(cm).parts[id].wounds.push({
    t: type, sv: sv || 1, age: 0, heal: WOUND_HEAL_DAYS[type],
  });
}

function partHas(pt, types) {
  return pt.wounds.some((w) => types.includes(w.t));
}

// fractures and heart damage actually slow a person down
function anatMobility(cm) {
  const A = cm.anat;
  if (!A) return 1;
  let m = 1;
  for (const id of ['femL', 'femR']) {
    if (partHas(A.parts[id], ['fracture'])) m *= 0.6;
  }
  if (partHas(A.parts.heart, ['damage'])) m *= 0.75;
  return m;
}

let anatLastMs = -1;
function anatTick(rdt) {
  if (anatLastMs < 0) anatLastMs = gameMs;
  const dDays = Math.max(0, gameMs - anatLastMs) / 86400000;
  anatLastMs = gameMs;
  for (const cm of cavemen) {
    const A = ensureAnatomy(cm);
    let anyBleed = 0;
    let wounded = false;
    for (const id of ANAT_ORDER) {
      const pt = A.parts[id];
      let bleed = 0;
      for (let i = pt.wounds.length - 1; i >= 0; i--) {
        const w = pt.wounds[i];
        w.age += dDays;
        if (w.t === 'cut') { bleed += w.sv; wounded = true; }
        else if (w.age < w.heal) wounded = true;
        if (w.age >= w.heal) pt.wounds.splice(i, 1);
      }
      if (bleed) {
        pt.hp -= bleed * dDays * 40;
        anyBleed += bleed;
      } else if (!pt.wounds.length && pt.hp < 100) {
        pt.hp = Math.min(100, pt.hp + dDays * 22);
      } else if (pt.hp < 100 && !bleed) {
        pt.hp = Math.min(100, pt.hp + dDays * 6);
      }
      if (pt.hp <= 0) {
        pt.hp = 0;
        // catastrophic failure: heart or brain at zero drains life fast
        if (id === 'heart' || id === 'brain') cm.stats.health -= dDays * 4000;
        else addWound(cm, id, 'cut', 1); // deep open would keeps bleeding
      }
    }
    // random stone-age mishaps keep the chart alive (rate is per real second)
    if (Math.random() < rdt * 0.0009) {
      const limb = ANAT_ORDER[Math.floor(Math.random() * 6)];
      addWound(cm, limb, Math.random() < 0.75 ? 'scratch' : 'bruise', 1);
    } else if (Math.random() < rdt * 0.00012) {
      const spot = ['armL', 'armR', 'legL', 'legR', 'torso'][Math.floor(Math.random() * 5)];
      addWound(cm, spot, 'cut', 1 + Math.floor(Math.random() * 2));
    }
    if (anyBleed) {
      cm.stats.health = Math.max(3, cm.stats.health - anyBleed * dDays * 26);
    } else if (!wounded && cm.stats.health < 100) {
      cm.stats.health = Math.min(100, cm.stats.health + dDays * 30);
    }
  }
}

// --- anatomy UI ---------------------------------------------------------------

let anatOpen = false;
let anatTab = 'body';
let anatSel = null;
let anatHits = [];
let anatSig = '';
let anatTimer = 0;

const anatBtn = document.getElementById('anat-btn');
const anatViewEl = document.getElementById('anat-view');
const anatCanvas = document.getElementById('anat-canvas');
const anatListEl = document.getElementById('anat-list');
const anatTitleEl = document.getElementById('anat-title');
const anatCtx = anatCanvas.getContext('2d');

const TINT_CACHE = new Map();
function tintedArt(id, hp) {
  const def = ANAT_PARTS[id];
  const src = ANAT_ART[def.art];
  const bucket = hp > 75 ? 0 : hp > 50 ? 1 : hp > 25 ? 2 : 3;
  const key = id + bucket;
  let c = TINT_CACHE.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(179,32,42,${bucket * 0.18})`;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  TINT_CACHE.set(key, c);
  return c;
}

const ICON_CACHE = new Map();
function partIconURL(id) {
  let url = ICON_CACHE.get(id);
  if (url) return url;
  const def = ANAT_PARTS[id];
  const c = document.createElement('canvas');
  if (def.art) {
    const src = ANAT_ART[def.art];
    c.width = src.width * 4;
    c.height = src.height * 4;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
  } else {
    // body part icon: crop the region out of the silhouette map
    const b = BODY_BOXES[id];
    c.width = (b.x1 - b.x0 + 3) * 4;
    c.height = (b.y1 - b.y0 + 3) * 4;
    const g = c.getContext('2d');
    g.fillStyle = '#d99a6c';
    BODY_MAP.forEach((row, y) => row.forEach((ch, x) => {
      if (REGION_PART[ch] === id && x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1)
        g.fillRect((x - b.x0 + 1) * 4, (y - b.y0 + 1) * 4, 4, 4);
    }));
  }
  url = c.toDataURL();
  ICON_CACHE.set(id, url);
  return url;
}

function hpColor(hp) {
  return hp > 60 ? '#58c470' : hp > 30 ? '#e0a33c' : '#d84a3a';
}

function anatWoundSig(A) {
  let s = '';
  for (const id of ANAT_ORDER) {
    const pt = A.parts[id];
    s += id + Math.round(pt.hp) + ':' +
      pt.wounds.map((w) => w.t + w.sv).join(',') + '|';
  }
  return s;
}

function buildAnatList() {
  const cm = selectedCm;
  if (!cm || !anatOpen) return;
  const A = ensureAnatomy(cm);
  const sig = anatTab + '|' + anatWoundSig(A);
  if (sig === anatSig) return;
  anatSig = sig;
  let html = '';
  for (const id of ANAT_ORDER) {
    const def = ANAT_PARTS[id];
    if (def.grp !== anatTab) continue;
    const pt = A.parts[id];
    const chips = pt.wounds.map((w) =>
      `<i class="chip c-${w.t}">${WOUND_LABEL[w.t]}${w.sv > 1 ? '!' : ''}</i>`).join('');
    html +=
      `<div class="arow${id === anatSel ? ' sel' : ''}" data-part="${id}">` +
      `<img class="pix" src="${partIconURL(id)}" alt="">` +
      `<div class="amid"><div class="atop"><b>${def.label}</b><span>${Math.round(pt.hp)}%</span></div>` +
      `<div class="abar"><i style="width:${pt.hp}%;background:${hpColor(pt.hp)}"></i></div>` +
      (chips ? `<div class="achips">${chips}</div>` : '') +
      '</div></div>';
  }
  anatListEl.innerHTML = html || '<div class="anone">—</div>';
}

function drawAnat() {
  const cm = selectedCm;
  if (!cm || !anatOpen) return;
  const A = ensureAnatomy(cm);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cw = anatCanvas.clientWidth || 280;
  const chh = anatCanvas.clientHeight || 150;
  if (anatCanvas.width !== cw * dpr || anatCanvas.height !== chh * dpr) {
    anatCanvas.width = cw * dpr;
    anatCanvas.height = chh * dpr;
  }
  const g = anatCtx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, chh);
  g.imageSmoothingEnabled = false;
  const cell = Math.min(cw / FIG_W, chh / FIG_H);
  const ox = Math.floor((cw - cell * FIG_W) / 2);
  const oy = Math.floor((chh - cell * FIG_H) / 2);
  anatHits = [];
  const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 240);

  // silhouette underlay
  const sil = anatTab === 'body' ? 0.9 : 0.14;
  for (let y = 0; y < FIG_H; y++) {
    for (let x = 0; x < FIG_W; x++) {
      const id = REGION_PART[BODY_MAP[y][x]];
      if (!id) continue;
      const pt = A.parts[id];
      if (anatTab === 'body') {
        const dmg = 1 - pt.hp / 100;
        g.fillStyle = `rgb(${217 - dmg * 90},${154 - dmg * 110},${108 - dmg * 80})`;
        g.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      } else {
        g.fillStyle = `rgba(120,140,170,${sil})`;
        g.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      }
    }
  }

  if (anatTab !== 'body') {
    for (const id of ANAT_ORDER) {
      const def = ANAT_PARTS[id];
      if (def.grp !== anatTab) continue;
      const art = tintedArt(id, A.parts[id].hp);
      const [sx, sy, sw, shCells] = def.spot;
      let dw, dh;
      if (def.tall) {
        // limb bones: explicit cell width keeps them inside the limb
        dh = shCells * cell;
        dw = (sw ? sw * cell : dh * (art.width / art.height));
      } else {
        dw = sw * cell;
        dh = dw * (art.height / art.width);
      }
      const dx = ox + sx * cell;
      const dy = oy + sy * cell;
      g.drawImage(art, dx, dy, dw, dh);
      anatHits.push({ id, x: dx, y: dy, w: dw, h: dh });
      const pt = A.parts[id];
      if (pt.hp < 35 || partHas(pt, ['fracture', 'damage'])) {
        g.strokeStyle = `rgba(224,72,72,${pulse})`;
        g.lineWidth = 1.5;
        g.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4);
      }
      if (partHas(pt, ['fracture'])) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(dx + dw * 0.2, dy + dh * 0.35);
        g.lineTo(dx + dw * 0.45, dy + dh * 0.55);
        g.lineTo(dx + dw * 0.3, dy + dh * 0.7);
        g.stroke();
      }
    }
  }

  // wound marks on the body layer
  if (anatTab === 'body') {
    for (const id of ANAT_ORDER) {
      const def = ANAT_PARTS[id];
      if (def.grp !== 'body') continue;
      const pt = A.parts[id];
      if (!pt.wounds.length) continue;
      const b = BODY_BOXES[id];
      const bx = ox + b.x0 * cell, by = oy + b.y0 * cell;
      const bw = (b.x1 - b.x0 + 1) * cell, bh = (b.y1 - b.y0 + 1) * cell;
      pt.wounds.forEach((w, wi) => {
        const px = bx + bw * (0.25 + 0.5 * ((wi * 37 % 100) / 100));
        const py = by + bh * (0.25 + 0.5 * ((wi * 61 % 100) / 100));
        if (w.t === 'scratch') {
          g.strokeStyle = '#c84438';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px - cell * 0.8, py - cell * 0.4);
          g.lineTo(px + cell * 0.8, py + cell * 0.4);
          g.stroke();
        } else if (w.t === 'cut') {
          g.fillStyle = `rgba(224,67,67,${pulse})`;
          g.beginPath();
          g.arc(px, py, cell * 0.7, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#ff5f52';
          g.fillRect(px - 0.8, py, 1.6, cell * 1.4);
        } else if (w.t === 'bruise') {
          g.fillStyle = 'rgba(120,70,160,0.55)';
          g.beginPath();
          g.arc(px, py, cell * 0.9, 0, Math.PI * 2);
          g.fill();
        }
      });
    }
  }

  // selection outline
  if (anatSel) {
    const hit = anatHits.find((hh) => hh.id === anatSel);
    const box = hit || (() => {
      const b = BODY_BOXES[anatSel];
      return b ? { x: ox + b.x0 * cell, y: oy + b.y0 * cell, w: (b.x1 - b.x0 + 1) * cell, h: (b.y1 - b.y0 + 1) * cell } : null;
    })();
    if (box) {
      g.strokeStyle = '#ffd76a';
      g.lineWidth = 1.5;
      g.strokeRect(box.x - 2.5, box.y - 2.5, box.w + 5, box.h + 5);
    }
  }
}

function anatRefreshUI() {
  buildAnatList();
  drawAnat();
}

function setAnatTab(tab) {
  anatTab = tab;
  anatSel = null;
  anatTitleEl.textContent =
    tab === 'body' ? 'Body & limbs' : tab === 'organs' ? 'Organs' : 'Bones';
  document.querySelectorAll('.atab').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tab));
  buildAnatList();
  drawAnat();
}

function setAnatOpen(v) {
  if (v === anatOpen) return;
  anatOpen = v;
  charPanel.classList.toggle('anat-open', v);
  anatBtn.textContent = v ? '👤' : '🫀';
  anatSig = '';
  if (v) anatRefreshUI();
  syncSheetHeight(); // panel height changes -> re-measure the sheet
}

anatBtn.addEventListener('click', () => setAnatOpen(!anatOpen));
document.getElementById('anat-back').addEventListener('click', () =>
  setAnatOpen(false));
document.querySelectorAll('.atab').forEach((b) =>
  b.addEventListener('click', () => setAnatTab(b.dataset.tab)));
anatListEl.addEventListener('click', (e) => {
  const row = e.target.closest('.arow');
  if (!row) return;
  anatSel = anatSel === row.dataset.part ? null : row.dataset.part;
  buildAnatList();
  drawAnat();
});
anatCanvas.addEventListener('click', (e) => {
  if (anatSel) { anatSel = null; buildAnatList(); drawAnat(); return; }
  const r = anatCanvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const hit = anatHits.find((hh) =>
    px >= hh.x && px <= hh.x + hh.w && py >= hh.y && py <= hh.y + hh.h);
  if (hit) { anatSel = hit.id; buildAnatList(); drawAnat(); }
});

setInterval(() => {
  if (anatOpen && selectedCm && !document.hidden) anatRefreshUI();
}, 450);

// called from selectCaveman: swap to the new villager's chart instantly
function anatOnSelect() {
  if (!anatOpen) return;
  anatSel = null;
  anatSig = '';
  anatRefreshUI();
}

// expanding the sheet is reserved for the Villager button
function expandSheet() {
  if (!selectedCm) return;
  charPanel.classList.add('open');
  document.body.classList.add('sheet-open');
  syncSheetHeight();
}

// collapsing the sheet only hides the panel — the villager stays selected,
// highlighted and under your control until you explicitly let them go
function collapseSheet() {
  charPanel.classList.remove('open');
  document.body.classList.remove('sheet-open');
  syncSheetHeight();
}

document.getElementById('char-close').addEventListener('click', () => {
  collapseSheet();
});

// --- bottom-sheet plumbing ---------------------------------------------------
// The villager panel expands up from a pill button on the bottom edge. While
// it is open the game stage's box shrinks by exactly the sheet height, so
// the canvas renders smaller (renderer resized live below) and every
// bottom-anchored control rides up above the sheet.
const rootStyle = document.documentElement.style;
// keep calling resizeGame() through the CSS transition so the WebGL view
// tracks the animated stage height frame by frame
let sheetResizeStop = 0;
function pumpSheetResize() {
  sheetResizeStop = performance.now() + 520;
  let first = true;
  const step = () => {
    if (!first && performance.now() >= sheetResizeStop) return;
    first = false;
    resizeGame();
    requestAnimationFrame(step);
  };
  step();
}
function syncSheetHeight() {
  const open = charPanel.classList.contains('open');
  if (open) {
    const h = Math.ceil(charPanel.getBoundingClientRect().height) + 6;
    rootStyle.setProperty('--sheet-h', h + 'px');
  }
  pumpSheetResize();
}
window.addEventListener('resize', syncSheetHeight);
// re-measure whenever the sheet's contents change size (squad roster etc.)
if (window.ResizeObserver) new ResizeObserver(syncSheetHeight).observe(charPanel);

document.getElementById('char-toggle').addEventListener('click', () => {
  if (selectedCm) {
    // toggle the panel around the current selection: collapsing never
    // releases the villager — they stay highlighted and controllable
    if (charPanel.classList.contains('open')) collapseSheet();
    else expandSheet();
    return;
  }
  // nothing picked yet: select the villager nearest the view centre
  let best = null, bestD = Infinity;
  for (const cm of cavemen) {
    const d = cm.spr.position.distanceToSquared(controls.target);
    if (d < bestD) { bestD = d; best = cm; }
  }
  if (best) {
    selectCaveman(best);
    expandSheet();
  }
});

// ============================================================================
// Squad: box-select villagers, drive them together, roster under the panel
// ============================================================================

const squad = new Set();
let boxSelectOn = false;
let marqueeId = null;
let marqueeStart = null;
const marqueeEl = document.getElementById('marquee');
const squadListEl = document.getElementById('squad-list');
const boxBtn = document.getElementById('box-select');
let lastThumbT = 0;

// --- Move command: arm it and a tap on the world sends the picked human ---
let actionMode = false;
const actionBtn = document.getElementById('action-btn');
const actionLbl = actionBtn.querySelector('.action-lbl');
function setActionMode(on) {
  if (actionMode === on) return;
  actionMode = on;
  actionBtn.classList.toggle('active', on);
  if (actionLbl) actionLbl.textContent = on ? 'Go…' : 'Move';
  if (!on) {
    hideMoveFlag();
    // disarming cancels any active command: no green stroke, no flag, no walk
    for (const c of cavemen) {
      if (c.actionMove) { c.actionMove = null; c.target = null; }
      if (c.followLead) c.followLead = null;
    }
    dropAllCarried(); // and whoever was being hoisted comes back down
    closeActionMenu(true); // …and the options popup / white highlight closes
  }
  // idle yellow vs command green strokes on every picked human
  for (const c of cavemen) {
    if (c === selectedCm || squad.has(c)) syncOutline(c);
  }
}
actionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setActionMode(!actionMode);
});

// small pixel flag marking where the picked human was told to walk
const moveFlag = (() => {
  const c = document.createElement('canvas');
  const paint = () => {
    c.width = 30; c.height = 42;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#5d4123';
    g.fillRect(13, 2, 4, 38); // pole
    g.fillStyle = '#3a2a14';
    g.fillRect(13, 36, 4, 4); // base
    g.fillStyle = '#58d95e';
    g.beginPath();
    g.moveTo(16, 3); g.lineTo(29, 7); g.lineTo(16, 12); g.closePath();
    g.fill();
    g.fillStyle = '#2f9e44';
    g.fillRect(16, 7, 11, 2);
  };
  paint();
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })
  );
  spr.renderOrder = 22; // above the water plane, below name tags
  spr.center.set(0.5, 0);
  spr.scale.set(0.85, 1.2, 1);
  spr.visible = false;
  scene.add(spr);
  return spr;
})();
function showMoveFlag(x, z) {
  moveFlag.position.set(x, groundYAt(x, z) + 0.08, z);
  moveFlag.visible = !iconMode && !spaceMode;
}
function hideMoveFlag() {
  moveFlag.visible = false;
}

// --- carrying: in Move mode, tap another human to hoist them over your head ---
// and walk with them. The carried one rides along above the carrier until you
// tap them again (or disarm Move / deselect), then they're set back down.
function pickUpVillager(carrier, target) {
  if (!carrier || !target || target === carrier) return;
  if (target.carriedBy) return; // already in someone's arms
  if (carrier.carrying) putDownVillager(carrier.carrying); // one at a time
  if (target.carrying) return; // busy hands
  if (target.sleeping) wakeCaveman(target);
  target.carriedBy = carrier;
  carrier.carrying = target;
  // they stop being their own person for a moment: no AI, no trail, no command
  target.target = null;
  target.actionMove = null;
  target.followLead = null;
  target.hold = false;
  target.wait = 0;
  target.moving = false;
  target.gatherSlot = null;
  if (target.outSpr) target.outSpr.visible = true;
  syncOutline(target);
  toast('🫳 ' + carrier.stats.name + ' hoists ' + target.stats.name + ' up!');
  renderRoster();
}
function putDownVillager(target) {
  if (!target || !target.carriedBy) return;
  const carrier = target.carriedBy;
  target.carriedBy = null;
  carrier.carrying = null;
  target.gy = charGroundY(target.spr.position.x, target.spr.position.z);
  target.spr.position.y = target.gy;
  if (target.outSpr) {
    target.outSpr.visible = target === selectedCm || squad.has(target);
    syncOutline(target);
  }
  toast('🫳 ' + carrier.stats.name + ' sets ' + target.stats.name + ' down');
  renderRoster();
}
function dropAllCarried() {
  for (const cm of cavemen) if (cm.carrying) putDownVillager(cm.carrying);
}

// --- action menu: in Move mode, tapping another human highlights them in
// white and opens a small options popup (pick up & carry, add to party).
// The chosen action makes the selected human WALK to them first.
let menuTarget = null; // the highlighted human the menu is about
const actionMenuEl = (() => {
  const el = document.createElement('div');
  el.id = 'action-menu';
  el.className = 'hidden';
  el.setAttribute('role', 'menu');
  document.body.appendChild(el);
  return el;
})();

function openActionMenu(cm, clientX, clientY) {
  if (!cm) return;
  closeActionMenu(true);
  menuTarget = cm;
  // white highlight + freeze: they stand still while you decide
  cm.target = null;
  cm.actionMove = null;
  cm.followLead = null;
  if (cm.outSpr) {
    cm.outSpr.visible = true;
    syncOutline(cm);
  }
  const w = 176;
  const x = Math.round(Math.min(Math.max(clientX, 8), innerWidth - w - 8));
  const y = Math.round(Math.min(Math.max(clientY - 34, 8), innerHeight - 150));
  actionMenuEl.style.left = x + 'px';
  actionMenuEl.style.top = y + 'px';
  actionMenuEl.innerHTML = '<div class="am-title">👤 ' + cm.stats.name + '</div>';
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'am-btn' + (cls ? ' ' + cls : '');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    actionMenuEl.appendChild(b);
  };
  mk('🫳 Pick up & carry', '', () => pickUpWalk(selectedCm, cm));
  if (!squad.has(cm)) mk('➕ Add to party', '', () => addToParty(cm));
  mk('🚫 Cancel', 'danger', () => closeActionMenu(true));
  actionMenuEl.classList.remove('hidden');
}
function closeActionMenu(clearTarget) {
  actionMenuEl.classList.add('hidden');
  actionMenuEl.innerHTML = '';
  if (clearTarget) {
    for (const cm of cavemen) cm.pickUpTarget = null;
    if (menuTarget) {
      if (menuTarget.outSpr) syncOutline(menuTarget);
      if (menuTarget.outSpr && !(menuTarget === selectedCm || squad.has(menuTarget))) {
        menuTarget.outSpr.visible = false;
      }
      menuTarget = null;
    }
  }
}

// the selected human walks over to the highlighted human, then hoists them
function pickUpWalk(carrier, target) {
  if (!carrier || !target || target === carrier) { closeActionMenu(true); return; }
  carrier.pickUpTarget = target;
  commandMoveTo(target.spr.position.x, target.spr.position.z);
  toast('🚶 ' + carrier.stats.name + ' heads over to ' + target.stats.name);
  // keep the white highlight while they walk over; the popup just hides
  actionMenuEl.classList.add('hidden');
  actionMenuEl.innerHTML = '';
}

function addToParty(cm) {
  if (!cm) return;
  squad.add(cm);
  cm.hold = false;
  cm.followLead = null;
  cm.actionMove = null;
  if (cm.outSpr) {
    cm.outSpr.visible = true;
    syncOutline(cm);
  }
  toast('👥 ' + cm.stats.name + ' joins the party');
  renderSquadList();
  renderRoster();
  closeActionMenu(true);
}

// nobody moves on their own while Move mode is armed (or the options menu is
// open on them): no random wandering for the selected human, the squad or the
// highlighted target — everyone holds until the player decides
function inFreezeHold(cm) {
  return (actionMode && (cm === selectedCm || squad.has(cm))) || cm === menuTarget;
}

// send the picked human (and the whole squad) walking to a spot on the map
function commandMoveTo(x, z) {
  const lead = selectedCm;
  if (!lead) return;
  const cmd = squad.size ? [...squad] : [lead];
  for (const cm of cmd) {
    if (cm.sleeping) wakeCaveman(cm); // a command rouses the sleeper
    cm.hold = false;
    cm.wait = 0;
    cm.gatherSlot = null;
    cm.leaveAt = 0;
  }
  lead.actionMove = { x, z };
  lead.target = { x, z };
  lead.followLead = null;
  // squad mates trail the leader instead of stacking on the same spot
  if (squad.size > 1) {
    for (const cm of squad) {
      if (cm === lead) continue;
      cm.followLead = lead;
      cm.followLastLead = null;
      cm.followOff = { x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 };
    }
  }
  showMoveFlag(x, z);
}

// who obeys the stick: the whole squad when one exists, else the solo pick
function inSquadCmd(cm) {
  return squad.size ? squad.has(cm) : cm === selectedCm;
}
function steerInputActive() {
  return charJoy.active || Math.hypot(charJoy.x, charJoy.z) > 0.04;
}

function clearSquad() {
  for (const c of squad) {
    c.hold = false; // release them back to AI life
    c.followLead = null;
    c.actionMove = null;
    if (c !== selectedCm && c.outSpr) c.outSpr.visible = false;
  }
  squad.clear();
  renderSquadList();
  renderRoster();
}

function beginBoxSelect(on) {
  boxSelectOn = on;
  boxBtn.classList.toggle('active', on);
  renderer.domElement.style.cursor = on ? 'crosshair' : '';
  if (!on) {
    if (marqueeEl) marqueeEl.style.display = 'none';
    marqueeStart = null;
    marqueeId = null;
  }
}

function startMarquee(e) {
  marqueeId = e.pointerId;
  marqueeStart = { x: e.clientX, y: e.clientY };
  // freeze the camera while drawing the rectangle: no orbit, no zoom
  controls.enabled = false;
  Object.assign(marqueeEl.style, {
    display: 'block',
    left: e.clientX + 'px',
    top: e.clientY + 'px',
    width: '0px',
    height: '0px',
  });
}

function moveMarquee(e) {
  if (!boxSelectOn || e.pointerId !== marqueeId || !marqueeStart) return;
  const x = Math.min(marqueeStart.x, e.clientX);
  const y = Math.min(marqueeStart.y, e.clientY);
  const w = Math.abs(e.clientX - marqueeStart.x);
  const h = Math.abs(e.clientY - marqueeStart.y);
  Object.assign(marqueeEl.style, {
    left: x + 'px', top: y + 'px',
    width: w + 'px', height: h + 'px',
  });
}

const _sqv = new THREE.Vector3();
function finishMarquee(e) {
  if (e.pointerId !== marqueeId) return;
  marqueeId = null;
  marqueeEl.style.display = 'none';
  controls.enabled = true; // hand the camera back
  controls.update();
  const x0 = Math.min(marqueeStart.x, e.clientX);
  const x1 = Math.max(marqueeStart.x, e.clientX);
  const y0 = Math.min(marqueeStart.y, e.clientY);
  const y1 = Math.max(marqueeStart.y, e.clientY);
  beginBoxSelect(false); // one drag per arm; button re-arms
  if (x1 - x0 < 8 && y1 - y0 < 8) return; // a tap, not a drag

  for (const c of squad) {
    c.hold = false;
    c.followLead = null;
    c.actionMove = null;
    if (c.outSpr && c !== selectedCm) c.outSpr.visible = false;
  }
  squad.clear();
  for (const cm of cavemen) {
    _sqv.copy(cm.spr.position).project(camera);
    if (_sqv.z > 1) continue;
    const sx = (_sqv.x * 0.5 + 0.5) * innerWidth;
    const sy = (-_sqv.y * 0.5 + 0.5) * innerHeight;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) squad.add(cm);
  }
  for (const cm of squad) {
    cm.hold = false;
    cm.target = null;
    cm.actionMove = null;
    if (cm.outSpr) cm.outSpr.visible = true;
  }
  // camera jumps to a random member and the panel shows them
  const arr = [...squad];
  selectCaveman(arr.length ? arr[(Math.random() * arr.length) | 0] : null);
  for (const cm of squad) if (cm.outSpr) cm.outSpr.visible = true;
  renderSquadList();
  renderRoster();
}

renderer.domElement.addEventListener('pointermove', moveMarquee);
renderer.domElement.addEventListener('pointerup', finishMarquee);
renderer.domElement.addEventListener('pointercancel', finishMarquee);

boxBtn.addEventListener('click', () => {
  if (boxSelectOn) { beginBoxSelect(false); clearSquad(); }
  else beginBoxSelect(true);
});

function refreshSquadThumbs() {
  for (const cm of squad) {
    const th = cm._sqThumb;
    if (!th) continue;
    const g = th.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, th.width, th.height);
    const img = cm.spr.material.map && cm.spr.material.map.image;
    if (img) g.drawImage(img, 0, 0, th.width, th.height);
    if (cm._sqName) {
      const vit = villagerVitals(cm);
      cm._sqName.textContent = cm.stats.name + ' · ' + vit.yrs + ' · ' + vit.cond;
    }
  }
}

function renderSquadList() {
  if (!squadListEl) return;
  squadListEl.innerHTML =
    '<div class="sq-head">Party \u00B7 ' + squad.size + '</div>';
  squadListEl.classList.toggle('has', squad.size > 0);
  for (const cm of squad) {
    const row = document.createElement('div');
    row.className = 'sq-row' + (cm === selectedCm ? ' lead' : '');
    const th = document.createElement('canvas');
    th.width = th.height = 30;
    th.className = 'sq-face';
    const nm = document.createElement('span');
    nm.className = 'sq-name';
    cm._sqThumb = th;
    cm._sqName = nm;
    row.appendChild(th);
    row.appendChild(nm);
    row.addEventListener('click', () => {
      selectCaveman(cm); // focuses camera + opens their live preview
      for (const c of squad) if (c.outSpr) c.outSpr.visible = true;
      renderSquadList();
      renderRoster();
    });
    squadListEl.appendChild(row);
  }
  refreshSquadThumbs();
}

// --- floating party roster (bottom-right): the humans you've picked, with a
// tap-to-switch lead. Shows the squad when one exists, else the solo pick. ---
const rosterEl = document.getElementById('roster');
function rosterMembers() {
  return squad.size ? [...squad] : selectedCm ? [selectedCm] : [];
}
function renderRoster() {
  if (!rosterEl) return;
  const mems = rosterMembers();
  rosterEl.classList.toggle('visible', mems.length > 0);
  rosterEl.innerHTML =
    '<div class="roster-head">👥 Party \u00B7 ' + mems.length + '</div>';
  const list = document.createElement('div');
  list.className = 'roster-list';
  for (const cm of mems) {
    const row = document.createElement('div');
    row.className = 'roster-row' + (cm === selectedCm ? ' lead' : '');
    const th = document.createElement('canvas');
    th.width = th.height = 26;
    th.className = 'roster-face';
    const meta = document.createElement('div');
    meta.className = 'roster-meta';
    const nm = document.createElement('span');
    nm.className = 'roster-name';
    const age = document.createElement('span');
    age.className = 'roster-age';
    const hp = document.createElement('div');
    hp.className = 'roster-bar hp';
    const hpI = document.createElement('i');
    hp.appendChild(hpI);
    const en = document.createElement('div');
    en.className = 'roster-bar en';
    const enI = document.createElement('i');
    en.appendChild(enI);
    cm._roThumb = th;
    cm._roName = nm;
    cm._roAge = age;
    cm._roHp = hpI;
    cm._roEn = enI;
    meta.appendChild(nm);
    meta.appendChild(age);
    meta.appendChild(hp);
    meta.appendChild(en);
    row.appendChild(th);
    row.appendChild(meta);
    row.addEventListener('click', () => {
      selectCaveman(cm); // make them the one you steer
      for (const c of squad) if (c.outSpr) c.outSpr.visible = true;
      renderSquadList();
      renderRoster();
    });
    list.appendChild(row);
  }
  rosterEl.appendChild(list);
  // classic party window footer: cycle to the next human
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'roster-next';
  next.textContent = 'Next ▸';
  next.title = 'Control the next party member';
  next.addEventListener('click', () => {
    const m = rosterMembers();
    if (!m.length) return;
    const i = m.indexOf(selectedCm);
    selectCaveman(m[(i + 1) % m.length]);
    for (const c of squad) if (c.outSpr) c.outSpr.visible = true;
    renderSquadList();
    renderRoster();
  });
  rosterEl.appendChild(next);
  refreshRosterThumbs();
}
function refreshRosterThumbs() {
  for (const cm of cavemen) {
    const th = cm._roThumb;
    if (!th) continue;
    const g = th.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, th.width, th.height);
    const img = cm.spr.material.map && cm.spr.material.map.image;
    if (img) g.drawImage(img, 0, 0, th.width, th.height);
    if (cm._roName) {
      const vit = villagerVitals(cm);
      cm._roName.textContent = cm.stats.name;
      cm._roAge.textContent = vit.yrs + ' yrs' + (cm.sleeping ? ' \u00B7 \uD83D\uDCA4' : '');
      cm._roHp.style.width = Math.max(0, Math.min(100, cm.stats.health)) + '%';
      cm._roEn.style.width = Math.max(0, Math.min(100, cm.energy || 0)) + '%';
    }
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  // box-select mode: drag a rectangle instead of clicking things
  if (boxSelectOn && e.button !== 2) {
    startMarquee(e);
    return;
  }
  // planet view: tapping the earth (or the camp pin) opens the camp card
  if (spaceMode && globe.group && globe.sphere) {
    placeNdcFromEvent(e);
    raycaster.setFromCamera(placeNdc, camera);
    const targets = [globe.sphere, globe.pin].filter(Boolean);
    const hit = raycaster.intersectObjects(targets, false).length > 0;
    toggleGlobePop(hit ? !globePopOpen : false);
    return;
  }
  placeDownX = e.clientX;
  placeDownY = e.clientY;
});

function placeNdcFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  placeNdc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
}

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!placingKind) return;
  placeNdcFromEvent(e);
  ghostHasPos = true;
});

function updatePlaceGhost() {
  if (!placingKind || !ghostHasPos) return;
  const ghost = ghosts[placingKind];
  if (!ghost) return;
  raycaster.setFromCamera(placeNdc, camera);
  const meshes = [];
  for (const ch of chunks.values()) meshes.push(ch.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length && isDry(hits[0].point.x, hits[0].point.z)) {
    const p = hits[0].point;
    ghost.visible = true;
    ghost.position.set(p.x, groundYAt(p.x, p.z) + 0.02, p.z);
  } else {
    ghost.visible = false;
  }
}

renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - placeDownX, e.clientY - placeDownY) > 6) return;

  if (placingKind) {
    const ghost = ghosts[placingKind];
    let firePoint = null;
    if (ghost && ghost.visible) {
      firePoint = { x: ghost.position.x, z: ghost.position.z };
    } else {
      placeNdcFromEvent(e);
      raycaster.setFromCamera(placeNdc, camera);
      const meshes = [];
      for (const ch of chunks.values()) meshes.push(ch.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length) firePoint = { x: hits[0].point.x, z: hits[0].point.z };
    }
    if (!firePoint) return;
    const isPerson = placingKind === 'caveman' || placingKind === 'cavewoman';
    // trees need dry land; people can be placed on the sea as well
    if (!isPerson && !isDry(firePoint.x, firePoint.z)) return;
    if (isPerson) {
      const away = new THREE.Vector3(
        firePoint.x - camera.position.x,
        0,
        firePoint.z - camera.position.z
      ).normalize().multiplyScalar(0.8);
      let sx = firePoint.x + away.x;
      let sz = firePoint.z + away.z;
      if (!isDry(sx, sz)) {
        sx = firePoint.x;
        sz = firePoint.z;
      }
      spawnCaveman(sx, sz, placingKind === 'cavewoman');
      {
        const cm = cavemen[cavemen.length - 1];
        const dx = cm.spr.position.x - homePos.x;
        const dz = cm.spr.position.z - homePos.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < 2.6) {
          const px = homePos.x + (dx / d) * 2.8;
          const pz = homePos.z + (dz / d) * 2.8;
          cm.spr.position.x = px;
          cm.spr.position.z = pz;
          cm.gy = charGroundY(px, pz);
          cm.spr.position.y = cm.gy;
        }
      }
    } else {
      spawnPlacedTree(placingKind, firePoint.x, firePoint.z);
    }
    return;
  }

  placeNdcFromEvent(e);
  raycaster.setFromCamera(placeNdc, camera);

  // villagers are picked FIRST: they stand right next to the fire, and the
  // generous campfire tap-radius below would otherwise swallow their clicks
  const pickObjs = [];
  for (const c of cavemen) {
    pickObjs.push(c.spr);
    if (c.iconSpr && c.iconSpr.visible) pickObjs.push(c.iconSpr);
  }
  closeActionMenu(true); // any tap away closes the options popup
  const sprHits = raycaster.intersectObjects(pickObjs, false);
  if (sprHits.length) {
    const hitCm = sprHits[0].object.userData.cm || null;
    // Move mode: tapping another human highlights them in white and opens
    // the options popup (pick up & carry / add to party). Tap the one you're
    // carrying to set them back down; tap a party member to lead them.
    if (actionMode && selectedCm && hitCm && hitCm !== selectedCm) {
      if (hitCm.carriedBy === selectedCm) putDownVillager(hitCm);
      else if (squad.has(hitCm)) selectCaveman(hitCm);
      else openActionMenu(hitCm, e.clientX, e.clientY);
      return;
    }
    selectCaveman(hitCm);
    return;
  }

  // Move command: while armed, a tap on the ground sends the picked human
  // (and any squad) walking there — raycaster lands on the terrain below
  if (actionMode && selectedCm) {
    placeNdcFromEvent(e);
    raycaster.setFromCamera(placeNdc, camera);
    const meshes = [];
    for (const ch of chunks.values()) meshes.push(ch.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      commandMoveTo(hits[0].point.x, hits[0].point.z);
      return;
    }
  }

  // pressing the campfire calls lightning down on it: the fire is small on
  // screen, so accept any tap whose view ray passes close to it — but only
  // when no villager was under the pointer (checked above)
  {
    const fy = homeFire ? homeFire.position.y : groundYAt(homePos.x, homePos.z);
    const dHigh = raycaster.ray.distanceToPoint(
      new THREE.Vector3(homePos.x, fy + 1.4, homePos.z)
    );
    const dLow = raycaster.ray.distanceToPoint(
      new THREE.Vector3(homePos.x, groundYAt(homePos.x, homePos.z) + 1, homePos.z)
    );
    if (
      Math.min(dHigh, dLow) < 2 ||
      (homeFire && raycaster.intersectObject(homeFire, false).length)
    ) {
      strikeCampfire();
      return;
    }
  }

  selectCaveman(null);
});

window.addEventListener('resize', () => {
  resizeGame();
});

// ============================================================================
// Lightning strike effect
// ============================================================================

const effects = [];

function spawnLightning(pos) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 1 });
  const top = pos.y + 60;
  const steps = 14;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const y = top - (top - pos.y) * k;
    const j = i === steps ? 0 : (1 - k) * 2.4;
    pts.push(
      new THREE.Vector3(
        pos.x + (Math.random() - 0.5) * j,
        y,
        pos.z + (Math.random() - 0.5) * j
      )
    );
  }
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.24, len, 0.24), mat);
    dir.subVectors(b, a).normalize();
    seg.quaternion.setFromUnitVectors(up, dir);
    seg.position.copy(a).addScaledVector(dir, len / 2);
    group.add(seg);
  }
  const flash = new THREE.PointLight(0xbfe0ff, 0, 90, 0.8);
  flash.position.set(pos.x, pos.y + 3, pos.z);
  group.add(flash);
  scene.add(group);

  let age = 0;
  effects.push({
    update(dt) {
      age += dt;
      group.visible = Math.random() > 0.22;
      mat.opacity = Math.max(0, 1 - age / 0.38);
      flash.intensity = Math.max(0, 26 * (1 - age / 0.35));
      if (age >= 0.38) {
        scene.remove(group);
        group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
        });
        mat.dispose();
        return false;
      }
      return true;
    },
  });
}

// ============================================================================
// Main loop
// ============================================================================

buildBeacon();
goHome(); // spawn on the home view, fixed height above the campfire
spawnDefaultCamp();
syncChunks(true);
resizeGame();

// debug/test hooks
window.__pw = {
  spawnCaveman,
  selectCaveman,
  cavemen,
  homePos,
  PREVIEWS,
  AGE_STAGES,
  env: () => ({
    season: SEASONS[curSeasonIdx] ? SEASONS[curSeasonIdx].name : '?',
    temp: Math.round(tempNow),
    dbg: (() => {
      const bb = seasonInfo();
      const hh = new Date(gameMs).getHours() + new Date(gameMs).getMinutes() / 60;
      return {
        f: +((gameMs - worldEpoch.getTime()) / 86400000 / SEASON_DAYS + 1.55).toFixed(3),
        hrs: +hh.toFixed(2),
        bi: bb.i,
        bw: +bb.w.toFixed(3),
        baseBlend: +(THREE.MathUtils.lerp(SEASONS[bb.i].tempBase, SEASONS[bb.next].tempBase, bb.w)).toFixed(2),
        diurnal: +(6 * Math.cos(((hh - 15) / 24) * Math.PI * 2)).toFixed(2),
        wDelta: WEATHERS[weather.cur].tempDelta,
        tempNowRaw: +tempNow.toFixed(2),
      };
    })(),
    weather: weather.cur,
    wind: +envWind.toFixed(2),
    fogFar: Math.round(scene.fog.far),
    starOp: +starsA.material.opacity.toFixed(2),
    snowDepth: +snowDepth.toFixed(3),
    droughtK: +droughtK.toFixed(3),
    floodK: +floodK.toFixed(3),
    waterY: +water.position.y.toFixed(2),
    gather: { active: gather.active, untilIn: Math.round((gather.until - gameMs) / 60000) },
    animT: +animT.toFixed(2),
    fx: { rain: rainFx.pts.visible, snow: snowFx.pts.visible, dust: dustFx.pts.visible },
    next: nextWeather
      ? {
          type: nextWeather.type,
          minsToStart: Math.round((nextWeather.startAt - gameMs) / 60000),
          alerted: nextWeather.alerted,
        }
      : null,
  }),
  forceWeatherSoon() {
    if (nextWeather)
      nextWeather.startAt = gameMs + WEATHER_ALERT_LEAD + 10 * 60000;
  },
  forceWeather(type) {
    nextWeather = {
      type,
      startAt: gameMs + WEATHER_ALERT_LEAD + 10 * 60000,
      alerted: false,
    };
  },
  strike(nearFire = true) {
    if (nearFire) {
      strikeCampfire();
      return { x: homePos.x, z: homePos.z };
    }
    const sx = controls.target.x + (Math.random() - 0.5) * 90;
    const sz = controls.target.z + (Math.random() - 0.5) * 90;
    spawnShockwave(sx, sz);
    pushCavemen(sx, sz);
    return { x: sx, z: sz };
  },
  gatherState: () => ({
    active: gather.active,
    untilIn: Math.round((gather.until - gameMs) / 60000),
    slotted: cavemen.filter((c) => c.gatherSlot).length,
    leaving: cavemen.filter((c) => c.leaveAt > 0).length,
    shockwaves: shockwaves.length,
  }),
  kindStats: () => {
    const counts = {};
    for (const ch of chunks.values()) {
      if (!ch.trees) continue;
      const iu = ch.trees.geometry.getAttribute('iU');
      for (let i = 0; i < iu.count; i++) {
        const u = iu.getX(i);
        const hit = KIND_ORDER.find((k) => Math.abs(KIND_COL[k] - u) < 0.001);
        const k = hit || 'u' + u.toFixed(3);
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    return counts;
  },
  season: () => seasonInfo(),
  atlasInfo: () => ({ cols: ATLAS_COLS, rows: ATLAS_ROWS, w: treeAtlasCanvas.width, h: treeAtlasCanvas.height }),
  atlasCanvas: () => treeAtlasCanvas,
  rebuildAtlas: () => { buildTreeAtlas(); renderAssetPanel(); },
  atlasSelfTest: () => {
    const c = document.createElement('canvas');
    c.width = ATLAS_CELL * ATLAS_COLS;
    c.height = ATLAS_CELL * ATLAS_ROWS;
    const ac = c.getContext('2d');
    KIND_ORDER.forEach((kind, col) => {
      const x0 = col * ATLAS_CELL;
      ac.save();
      ac.translate(x0, ATLAS_CELL);
      PAINTERS[kind](ac, 0);
      ac.restore();
      const summer = ac.getImageData(x0, ATLAS_CELL, ATLAS_CELL, ATLAS_CELL);
      const seaso = deriveSeasons(summer, TREE_KINDS[kind]);
      ac.putImageData(seaso.spring, x0, 0);
      ac.putImageData(seaso.autumn, x0, 2 * ATLAS_CELL);
      ac.putImageData(seaso.winter, x0, 3 * ATLAS_CELL);
    });
    const cnt = (col, row) => {
      const d = ac.getImageData(col * ATLAS_CELL, row * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL).data;
      let n = 0, rs = 0, gs = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 10) { n++; rs += d[i]; gs += d[i + 1]; }
      return { n, r: Math.round(rs / Math.max(n, 1)), g: Math.round(gs / Math.max(n, 1)) };
    };
    const ms = cnt(12, 1), ma = cnt(12, 2);
    return {
      cactusSummer: cnt(0, 1).n,
      oakSummer: cnt(9, 1).n,
      mapleSpring: cnt(12, 0).n,
      mapleAutumn: ma.n,
      mapleWinter: cnt(12, 3).n,
      mapleSummerGreen: ms.g - ms.r,
      mapleAutumnRed: ma.r - ma.g,
    };
  },
  camera,
  fireRayProbe(cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect();
    placeNdc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(placeNdc, camera);
    const fp = new THREE.Vector3(homePos.x, homeFire ? homeFire.position.y + 1.4 : 1.4, homePos.z);
    const d = raycaster.ray.distanceToPoint(fp);
    const tgt = raycaster.ray.distanceToPoint(new THREE.Vector3(homePos.x, 1.6, homePos.z));
    return { dist: +d.toFixed(2), distLow: +tgt.toFixed(2), target: fp.y };
  },
  fireHitTest() {
    const ndc = new THREE.Vector2(0, 0);
    placeNdc.copy(ndc);
    raycaster.setFromCamera(placeNdc, camera);
    const hits = homeFire ? raycaster.intersectObject(homeFire, false) : [];
    return {
      hasFire: !!homeFire,
      visible: homeFire ? homeFire.visible : null,
      pos: homeFire ? { x: +homeFire.position.x.toFixed(1), y: +homeFire.position.y.toFixed(1), z: +homeFire.position.z.toFixed(1) } : null,
      scale: homeFire ? homeFire.scale.x : null,
      center: homeFire && homeFire.center ? { x: homeFire.center.x, y: homeFire.center.y } : null,
      hits: hits.length,
      camAtHome: Math.hypot(camera.position.x - homePos.x, camera.position.z - homePos.z).toFixed(1),
    };
  },
  projectHome() {
    const fy = homeFire ? homeFire.position.y + 1.4 : 2;
    const v = new THREE.Vector3(homePos.x, fy, homePos.z);
    v.project(camera);
    return {
      x: Math.round((v.x * 0.5 + 0.5) * innerWidth),
      y: Math.round((-v.y * 0.5 + 0.5) * innerHeight),
      visible: v.z < 1,
    };
  },
  atlasDebug: () => {
    const countOpaque = (cv) => {
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
      return n;
    };
    try {
      const out = {};
      const base = document.createElement('canvas');
      base.width = base.height = ATLAS_CELL;
      PAINTERS.cactus(base.getContext('2d'), 0);
      out.basePainted = countOpaque(base);
      const cells = seasonize(base, TREE_KINDS.cactus);
      out.cellsOpaque = cells.map(countOpaque).join(',');
      // now try drawing one cell straight into the real atlas corner
      const ac = treeAtlasCanvas.getContext('2d');
      ac.fillStyle = '#ff00ff';
      ac.fillRect(19 * ATLAS_CELL, 3 * ATLAS_CELL, 20, 20);
      out.directFill = countOpaque((() => {
        const p = document.createElement('canvas');
        p.width = p.height = 8;
        p.getContext('2d').drawImage(treeAtlasCanvas, 19 * ATLAS_CELL, 3 * ATLAS_CELL, 8, 8, 0, 0, 8, 8);
        return p;
      })());
      return JSON.stringify(out);
    } catch (e) {
      return 'ERR ' + e.message;
    }
  },
  placeTree: (kind, x, z) => spawnPlacedTree(kind, x, z),
  placedInfo: () =>
    placedTrees.map((p) => ({
      x: p.sprA.position.x,
      y: +p.sprA.position.y.toFixed(2),
      z: p.sprA.position.z,
    })),
  boltInfo: () => bolts.length,
  hitTest: (x, z) => treeHit(x, z),
  groundAt: (x, z) => groundYAt(x, z),
  isDry: (x, z) => isDry(x, z),
  terrainH: (x, z) => terrainHeight(Math.round(x), Math.round(z), SEED),
  seaLevel: SEA_LEVEL,
  renderProbe: (mat) => {
    const R2 = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    R2.setSize(64, 64);
    const S2 = new THREE.Scene();
    S2.background = new THREE.Color(0xff00ff);
    const C2 = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
    C2.position.set(0, 1.5, 4);
    C2.lookAt(0, 1.5, 0);
    const s = new THREE.Sprite(mat.clone());
    s.material.alphaTest = 0;
    s.center.set(0.5, 0);
    s.scale.set(3, 3.5, 1);
    S2.add(s);
    R2.render(S2, C2);
    const gl = R2.getContext();
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let fg = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (!(px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200)) fg++;
    }
    R2.dispose();
    return fg;
  },
  campLabel: () => ({
    x: +campLabelSpr.position.x.toFixed(1),
    y: +campLabelSpr.position.y.toFixed(1),
    scale: +campLabelSpr.scale.x.toFixed(1),
    visible: campLabelSpr.visible,
  }),
  placedKinds: () => placedTrees.map((p) => p.kind),
  selOutline: () => (selectedCm ? !!selectedCm.outSpr.visible : false),
  flameScale: () =>
    homeFlames.length
      ? { y: +homeFlames[0].scale.y.toFixed(2), x: +homeFlames[0].scale.x.toFixed(2) }
      : null,
  camTarget: () => ({
    x: +controls.target.x.toFixed(1),
    y: +controls.target.y.toFixed(1),
    z: +controls.target.z.toFixed(1),
  }),
  camPos: () => ({
    x: +camera.position.x.toFixed(1),
    y: +camera.position.y.toFixed(1),
    z: +camera.position.z.toFixed(1),
  }),
  previewInfo: () => ({
    frames: prevFrameN,
    ready: !!charBgCanvas,
  }),
  windUniforms: () => ({
    ang: +treeMat.uniforms.uWindAng.value.toFixed(3),
    pow: +treeMat.uniforms.uWindPow.value.toFixed(4),
  }),
  topView(x, z, h) {
    camera.position.set(x, h, z);
    controls.target.set(x, groundYAt(x, z), z);
    controls.update();
  },
  grabFrame(w = 220, hgt = 160) {
    if (!grabRT || grabRT.width !== w) {
      if (grabRT) grabRT.dispose();
      grabRT = new THREE.WebGLRenderTarget(w, hgt);
    }
    renderer.setRenderTarget(grabRT);
    renderer.render(scene, camera);
    const buf = new Uint8Array(w * hgt * 4);
    renderer.readRenderTargetPixels(grabRT, 0, 0, w, hgt, buf);
    renderer.setRenderTarget(null);
    let green = 0, blue = 0, brown = 0, other = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      if (g > 55 && g > r * 1.12 && g > b * 1.12) green++;
      else if (b > r * 1.15 && b > g * 1.05) blue++;
      else if (r > 90 && r > b * 1.3 && g < r) brown++;
      else other++;
    }
    const uniq = {};
    for (let i = 0; i < buf.length; i += 4) {
      const k = buf[i] + ',' + buf[i + 1] + ',' + buf[i + 2];
      uniq[k] = (uniq[k] || 0) + 1;
    }
    const samples = Object.entries(uniq).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { green, blue, brown, other, total: w * hgt, samples };
  },
  firstTree() {
    for (const ch of chunks.values()) {
      if (ch.trees && ch.trees.userData.sampleTree) {
        const s = ch.trees.userData.sampleTree;
        return { x: s.x, y: s.gy, z: s.z, kind: s.kind, h: TREE_KINDS[s.kind].h };
      }
    }
    return null;
  },
  lookAt: (x, y, z, dist, polar) => {
    camera.position.set(
      x + dist * Math.cos(polar),
      y + dist * 0.55,
      z + dist * Math.sin(polar)
    );
    controls.target.set(x, y, z);
    controls.update();
  },
  shockInfo: () =>
    shockwaves.map((s) => ({
      rings: s.rings.length,
      visible: s.rings.filter((r) => r.visible).length,
    })),
  placedCount: () => placedTrees.length,
  reactions: () => cavemen.filter((c) => c.react).length,
  shadowProbe: () => ({
    str: +shadowMat.uniforms.uShadowStr.value.toFixed(3),
    ox: +shadowMat.uniforms.uSunOff.value.x.toFixed(3),
    oy: +shadowMat.uniforms.uSunOff.value.y.toFixed(3),
  }),
  treePositions: () => {
    const out = [];
    for (const ch of chunks.values()) {
      if (!ch.trees) continue;
      for (const c of ch.trees.userData.cols) out.push({ x: +c.x.toFixed(2), z: +c.z.toFixed(2) });
    }
    return out;
  },
  nearHoles: () => {
    const c = centerChunk();
    let missing = 0;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        if (!chunks.has(c.x + dx + ',' + (c.z + dz))) missing++;
    return missing;
  },
  streamDebug: () => ({
    pending: pendingQueue.length,
    applying: applyQueue.length,
    requested: requested.size,
    chunks: chunks.size,
    busy: busy.size,
    workers: workers.length,
    dispatched: dbgDispatched,
    received: dbgReceived,
    radius: RENDER_RADIUS,
    center: centerChunk(),
  }),
  fpCount: () => footprintPool.reduce((n, e) => n + (e.mesh.visible ? 1 : 0), 0),
  fxInfo: () => ({
    rain: { size: rainFx.size, mapW: rainFx.tex ? rainFx.tex.image.width : 0, mapH: rainFx.tex ? rainFx.tex.image.height : 0, vis: rainFx.pts.visible },
    snow: { size: snowFx.size, mapW: snowFx.tex ? snowFx.tex.image.width : 0, vis: snowFx.pts.visible },
    dust: { size: dustFx.size, mapW: dustFx.tex ? dustFx.tex.image.width : 0, vis: dustFx.pts.visible },
    windAng: +windAng.toFixed(3),
  }),
  uniformProbe: () => {
    const sh = chunkMat.userData.shader;
    return {
      groundSnow: sh ? +sh.uniforms.uSnow.value.toFixed(3) : null,
      groundParched: sh ? +sh.uniforms.uParched.value.toFixed(3) : null,
      treeSnow: +treeMat.uniforms.uSnow.value.toFixed(3),
      treeParched: +treeMat.uniforms.uParched.value.toFixed(3),
      treeWindPow: +treeMat.uniforms.uWindPow.value.toFixed(4),
      treeWindAng: +treeMat.uniforms.uWindAng.value.toFixed(3),
      atlasW: treeAtlasCanvas.width,
    };
  },
  treeStats: () => {
    let meshes = 0, instances = 0;
    for (const ch of chunks.values()) {
      meshes++;
      if (ch.trees) instances += ch.trees.geometry.instanceCount;
    }
    return { chunks: meshes, treeInstances: instances };
  },
  setWeather(type) {
    weather.cur = type;
    weather.endAt = gameMs + 5 * 3600000;
    nextWeather = null;
  },
  setHours(h) {
    const nowD = new Date(gameMs);
    const cur =
      nowD.getHours() + nowD.getMinutes() / 60 + nowD.getSeconds() / 3600;
    gameMs += (((h - cur) % 24) + 24) % 24 * 3600000;
  },
  debugAdvance(mins) {
    gameMs += mins * 60000;
  },
  setRadius: (n) => setRenderRadius(n),
  // diagnostics: ascii-render the atlas cells / a live framebuffer grab
  atlasAscii: () => {
    const c = treeAtlasCanvas;
    const g = c.getContext('2d');
    const out = [];
    for (let cell = 0; cell < 8; cell++) {
      const rows = [];
      for (let y = 0; y < 48; y += 2) {
        let row = '';
        for (let x = 0; x < 48; x += 1) {
          const d = g.getImageData(cell * 48 + x, y, 1, 1).data;
          row += d[3] > 100 ? '#' : '.';
        }
        rows.push(row);
      }
      out.push(rows.join('\n'));
    }
    return out;
  },
  frameAscii: () => {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const step = 8;
    const lines = [];
    for (let y = h - 1; y >= 0; y -= step * 2) {
      let row = '';
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const r = px[i], g2 = px[i + 1], b = px[i + 2];
        row +=
          g2 > r + 12 && g2 > b + 12 ? 'T'   // tree greens
          : b > r + 20 && b > g2 ? '~'       // sky/water blues
          : r > 180 && g2 > 150 ? '^'        // bright ground/sand
          : r + g2 + b < 150 ? '@'           // dark
          : '.';
      }
      lines.push(row);
    }
    return lines.join('\n');
  },
  setSeason(idx) {
    const f =
      (gameMs - worldEpoch.getTime()) / 86400000 / SEASON_DAYS + 1.55;
    const diff = ((idx + 0.5 - f) % 4 + 4) % 4;
    gameMs += diff * SEASON_DAYS * 86400000;
  },
};

const clock = new THREE.Clock();
const rigFwd = new THREE.Vector3();
const rigRight = new THREE.Vector3();
const rigUp = new THREE.Vector3(0, 1, 0);

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.getElapsedTime();

  const dist = camera.position.distanceTo(controls.target);
  const speed = Math.max(30, Math.min(IS_MOBILE ? 300 : 480, dist * 1.4)) * dt;

  camera.getWorldDirection(rigFwd);
  rigFwd.y = 0;
  if (rigFwd.lengthSq() < 1e-6) rigFwd.set(0, 0, -1);
  rigFwd.normalize();
  rigRight.crossVectors(rigFwd, rigUp).normalize();

  // with a villager selected, the joystick/WASD steers THEM instead of the
  // camera. Hysteresis (engage 0.07 / release 0.03) so analog jitter can't
  // flicker control on and off mid-walk
  const joyMag = Math.hypot(joy.x, joy.y);
  const joyOn = charJoy.active ? joyMag > 0.03 : joyMag > 0.07;
  if (selectedCm && (joyOn || move.up || move.down || move.left || move.right)) {
    let jx = rigFwd.x * joy.y + rigRight.x * joy.x;
    let jz = rigFwd.z * joy.y + rigRight.z * joy.x;
    if (move.up) { jx += rigFwd.x; jz += rigFwd.z; }
    if (move.down) { jx -= rigFwd.x; jz -= rigFwd.z; }
    if (move.left) { jx -= rigRight.x; jz -= rigRight.z; }
    if (move.right) { jx += rigRight.x; jz += rigRight.z; }
    const jl = Math.hypot(jx, jz);
    if (jl > 0.01) {
      // keep the analog magnitude (clamped to 1): a gentle stick tilt walks,
      // a full push runs — WASD diagonals clamp to full speed
      const k = jl > 1 ? 1 / jl : 1;
      charJoy.tx = jx * k;
      charJoy.tz = jz * k;
      charJoy.active = true;
    } else {
      charJoy.active = false;
    }
  } else {
    if (charJoy.active) {
      charJoy.active = false;
      if (selectedCm) {
        // released the stick: they resume wandering randomly on their own
        selectedCm.hold = false;
        selectedCm.target = null;
        selectedCm.wait = 0.2;
      }
    }
  }
  // eased stick: the steered human ramps velocity in/out smoothly instead
  // of snapping to full speed the instant the stick tilts
  charJoy.x = THREE.MathUtils.damp(charJoy.x, charJoy.active ? (charJoy.tx || 0) : 0, 9, dt);
  charJoy.z = THREE.MathUtils.damp(charJoy.z, charJoy.active ? (charJoy.tz || 0) : 0, 9, dt);

  let mx = 0, mz = 0;
  if (!charJoy.active) {
    if (move.up) { mx += rigFwd.x; mz += rigFwd.z; }
    if (move.down) { mx -= rigFwd.x; mz -= rigFwd.z; }
    if (move.left) { mx -= rigRight.x; mz -= rigRight.z; }
    if (move.right) { mx += rigRight.x; mz += rigRight.z; }
    if (move.right) { mx += rigRight.x; mz += rigRight.z; }
    // camera stick: ignored while a villager is selected unless pushed hard
    if (!selectedCm || joyMag > 0.12) {
      mx += rigFwd.x * joy.y + rigRight.x * joy.x;
      mz += rigFwd.z * joy.y + rigRight.z * joy.x;
    }
  }

  const len = Math.hypot(mx, mz);
  if (len > 0) {
    const mag = Math.min(1, len);
    mx = (mx / len) * speed * mag;
    mz = (mz / len) * speed * mag;
  }
  const dy = (move.lower ? -speed : 0) + (move.raise ? speed : 0);

  controls.target.x += mx;
  controls.target.z += mz;
  controls.target.y += dy;
  camera.position.x += mx;
  camera.position.z += mz;
  camera.position.y += dy;

  stepCamTween();
  controls.update();

  // apply the smoothed cinematic dolly: glide the radial distance toward
  // the user's zoom intent every frame (paused during mode tweens)
  if (!lodTween) {
    const zOff = camera.position.clone().sub(controls.target);
    const zCur = Math.max(zOff.length(), 0.001);
    const zWant = THREE.MathUtils.damp(zCur, desiredDist, 6, dt);
    if (Math.abs(zWant - zCur) > 1e-4) {
      camera.position.copy(controls.target).addScaledVector(zOff.multiplyScalar(1 / zCur), zWant);
    }
    if (Math.abs(desiredDist - camera.position.distanceTo(controls.target)) > Math.max(10, desiredDist * 0.6)) {
      snapZoom(); // an external system teleported the camera — resync intent
    }
  }

  syncChunks();
  processApplyQueue();
  governRenderRadius(dt);
  pumpChunks();

  if (!timePaused) gameMs += dt * 60000 * timeSpeed;
  // animation clocks: world speed drives how fast assets move & animate
  const worldRate = timePaused ? 0 : Math.min(timeSpeed, 12);
  const fxRate = timePaused ? 0 : Math.min(1 + (timeSpeed - 1) * 0.2, 2.2);
  const cloudRate = timePaused ? 0 : Math.min(timeSpeed, 3);
  animT += dt * worldRate;
  tNow = t;
  const nowD = new Date(gameMs);
  const hrs = nowD.getHours() + nowD.getMinutes() / 60 + nowD.getSeconds() / 3600;
  const sunAng = ((hrs - 6) / 24) * Math.PI * 2;
  sunDir.set(Math.cos(sunAng), Math.sin(sunAng), 0.38).normalize();
  const dayF = THREE.MathUtils.smoothstep(sunDir.y, -0.04, 0.16);
  daylightK = dayF; // mirrored for AI (bedtime / dawn wake)
  const nightF = 1 - dayF;
  const dusk = Math.max(0, 1 - Math.abs(sunDir.y) * 3.2);

  // --- Seasons / weather / temperature ---
  const b = seasonInfo();
  if (curSeasonIdx !== b.i) {
    const first = curSeasonIdx === -1;
    curSeasonIdx = b.i;
    if (!first) {
      toast(SEASONS[b.i].icon + ' ' + SEASONS[b.i].name + ' begins', 'season');
      envPill.classList.remove('pulse');
      void envPill.offsetWidth;
      envPill.classList.add('pulse');
      scheduleNextWeather();
    }
  }
  // keep the zoomed-out tree chips on the same seasonal art as the real
  // trees: rebuild the icon atlas when the season or its blend changes
  const iconSeasonKey = b.i + ':' + Math.round(b.w * 8);
  if (iconSeasonKey !== lastIconSeasonKey) {
    lastIconSeasonKey = iconSeasonKey;
    buildIconAtlas();
  }

  if (nextWeather) {
    if (
      !nextWeather.alerted &&
      nextWeather.type !== 'clear' &&
      gameMs >= nextWeather.startAt - WEATHER_ALERT_LEAD
    ) {
      nextWeather.alerted = true;
      toast('\u26A0 ' + WEATHERS[nextWeather.type].label + ' approaching\u2026', 'warn');
    }
    if (gameMs >= nextWeather.startAt) {
      weather.cur = nextWeather.type;
      weather.endAt = gameMs + (2 + Math.random() * 4) * 3600000;
      if (nextWeather.type !== 'clear')
        toast(WEATHERS[weather.cur].icon + ' ' + WEATHERS[weather.cur].label + '!', 'info');
      if (weather.cur === 'storm') lightningAt = t + 1.2;
      nextWeather = null;
    }
  } else if (gameMs >= weather.endAt) {
    weather.cur = 'clear';
    weather.endAt = Infinity;
    scheduleNextWeather();
  }

  const sd = WEATHERS[weather.cur];
  const lerp = THREE.MathUtils.lerp;
  const seasonLight = lerp(SEASONS[b.i].lightMul, SEASONS[b.next].lightMul, b.w);
  const seasonFog = lerp(SEASONS[b.i].fogMul, SEASONS[b.next].fogMul, b.w);
  const targetTemp =
    lerp(SEASONS[b.i].tempBase, SEASONS[b.next].tempBase, b.w) +
    6 * Math.cos(((hrs - 15) / 24) * Math.PI * 2) +
    sd.tempDelta;
  tempNow = THREE.MathUtils.damp(tempNow, targetTemp, 0.8, dt);
  envDim = THREE.MathUtils.damp(envDim, sd.dim, 1.2, dt);
  envFogMul = THREE.MathUtils.damp(envFogMul, sd.fogMul * seasonFog, 1.2, dt);
  envWind = THREE.MathUtils.damp(envWind, sd.wind, 1.0, dt);
  cloudThick = THREE.MathUtils.damp(cloudThick, sd.thick, 1.2, dt);
  starVis = THREE.MathUtils.damp(starVis, sd.stars, 1.5, dt);
  const lightGrade = seasonLight * (0.55 + 0.45 * envDim);

  // snow blanket / drought / water level evolve with the weather
  updateEnvDynamics(dt);
  const sh = chunkMat.userData.shader;
  if (sh) {
    sh.uniforms.uSnow.value = snowDepth;
    sh.uniforms.uParched.value = droughtK;
  }
  treeMat.uniforms.uSnow.value = snowDepth;
  treeMat.uniforms.uParched.value = droughtK;
  water.position.y = SEA_LEVEL + 0.35 + floodK - droughtK * 1.4;

  // Lightning
  let flashK = 0;
  if (pendingFlash) {
    pendingFlash = false;
    flashStart = t;
  }
  if (weather.cur === 'storm') {
    if (!timePaused && t >= lightningAt) {
      lightningAt = t + 2.5 + Math.random() * 5.5;
      // ambient sky flash only — the campfire is struck solely by user press
    }
    flashK = Math.max(0, 1 - (t - flashStart) / 0.22);
  }
  flashEl.style.opacity = (flashK * 0.75).toFixed(3);

  // camp marker floats over the fire, scaled by distance so it stays legible
  {
    const fy = homeFire ? homeFire.position.y : groundYAt(homePos.x, homePos.z);
    campLabelSpr.position.set(homePos.x, fy + 10, homePos.z);
    const dl = camera.position.distanceTo(campLabelSpr.position);
    const s = Math.max(2, dl * 0.05);
    campLabelSpr.scale.set(s * 3.55, s, 1);
    if (cavemen.length !== campCountShown) {
      campCountShown = cavemen.length;
      drawCampLabel();
    }
  }

  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    const k = (t - b.t0) / 0.34;
    if (k >= 1) {
      scene.remove(b.group);
      for (const c of b.group.children) {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
      bolts.splice(i, 1);
      continue;
    }
    b.mat.opacity = (1 - k) * (k < 0.12 ? 1 : 0.55 + 0.45 * Math.sin(t * 90));
  }

  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    const k = (t - s.t0) / 1.15;
    if (k >= 1) {
      scene.remove(s.mesh);
      for (const r of s.rings) {
        r.geometry.dispose();
        r.material.dispose();
      }
      shockwaves.splice(i, 1);
      continue;
    }
    for (const r of s.rings) {
      const raw = (t - s.t0 - r.userData.off) / 0.95;
      if (raw <= 0) {
        r.visible = false;
        continue;
      }
      r.visible = true;
      const kk = Math.min(raw, 1);
      const ease = 1 - (1 - kk) * (1 - kk);
      const w = 0.6 + ease * 13;
      r.scale.set(w, w * 0.55, w);
      r.material.opacity = 0.26 * (1 - kk);
    }
  }

  // Environment pill: season icon+name · temperature
  const tempStr = Math.round(tempNow) + '\u00B0C';
  const bucket = tempNow < 0 ? 'freeze' : tempNow < 10 ? 'cold' : tempNow >= 28 ? 'hot' : '';
  if (tempStr !== lastTempStr) {
    tempLabelEl.textContent = tempStr;
    tempLabelEl.className = bucket;
    lastTempStr = tempStr;
  }
  if (curSeasonIdx !== lastPillSeason) {
    seasonIconEl.textContent = SEASONS[curSeasonIdx].icon;
    seasonLabelEl.textContent = SEASONS[curSeasonIdx].name;
    lastPillSeason = curSeasonIdx;
  }

  lightDir.copy(sunDir);
  if (sunDir.y < 0) lightDir.negate();
  sun.position.set(
    controls.target.x + lightDir.x * 160,
    controls.target.y + lightDir.y * 160,
    controls.target.z + lightDir.z * 160
  );
  sun.target.position.set(controls.target.x, controls.target.y, controls.target.z);
  sun.intensity = Math.max(2.2 * dayF, 0.35 * nightF) * lightGrade;
  sun.color.setRGB(1, 1, 1).lerp(nightLightCol, nightF).lerp(duskLightCol, dusk * 0.6);

  hemi.intensity = (0.28 + 0.72 * dayF) * lightGrade;
  amb.intensity = (0.3 + 0.4 * dayF) * lightGrade + flashK * 1.6;

  skyCol.copy(nightSky).lerp(daySky, dayF).lerp(duskSky, dusk * 0.5);
  tmpSeasonColor.copy(SEASONS[b.i].skyTint).lerp(SEASONS[b.next].skyTint, b.w);
  skyCol.lerp(tmpSeasonColor, lerp(SEASONS[b.i].tintK, SEASONS[b.next].tintK, b.w));
  skyCol.multiplyScalar(envDim);
  scene.background.copy(skyCol);
  scene.fog.color.copy(skyCol);
  scene.fog.near = FOG_BASE_NEAR * envFogMul;
  scene.fog.far = FOG_BASE_FAR * envFogMul;
  treeMat.uniforms.uFogColor.value.copy(scene.fog.color);
  // seasons + sun on every tree
  treeMat.uniforms.uSeasonA.value = b.i;
  treeMat.uniforms.uSeasonB.value = b.next;
  treeMat.uniforms.uBlend.value = b.w;
  treeMat.uniforms.uDay.value = dayF;
  treeMat.uniforms.uDusk.value = dusk;
  // shadows swing away from the sun and fade out at night
  const shLen = THREE.MathUtils.clamp(0.35 + (1 - Math.max(sunDir.y, 0)) * 0.55, 0.35, 0.95);
  shadowMat.uniforms.uSunOff.value.set(-sunDir.x, -sunDir.z).normalize().multiplyScalar(shLen * 0.5);
  shadowMat.uniforms.uShadowStr.value = 0.1 + dayF * 0.32;
  blobMatSingle.opacity = 0.12 + dayF * 0.3;
  treeMat.uniforms.uFogNear.value = scene.fog.near;
  treeMat.uniforms.uFogFar.value = scene.fog.far;
  fishMat.uniforms.uTime.value = animT;
  fishMat.uniforms.uDay.value = dayF;
  fishMat.uniforms.uFogColor.value.copy(scene.fog.color);
  fishMat.uniforms.uFogNear.value = scene.fog.near;
  fishMat.uniforms.uFogFar.value = scene.fog.far;
  // fish: skip drawing schools too far from the camera (they'd be sub-pixel
  // blobs anyway), and rebuild the zoomed-out marker layer as chunks stream.
  // The visible radius shrinks with zoom: close-up you only see the fish near
  // you (small lively radius); pulling back spreads the whole sea's schools.
  const zoomD = camera.position.distanceTo(controls.target);
  const fishRad = THREE.MathUtils.clamp(zoomD * 0.55, 42, FISH_VIS_DIST);
  const fishVis2 = fishRad * fishRad;
  for (const ch of chunks.values()) {
    if (!ch.fish) continue;
    const dx = ch.cx * CHUNK + CHUNK / 2 - camera.position.x;
    const dz = ch.cz * CHUNK + CHUNK / 2 - camera.position.z;
    ch.fish.visible = !iconMode && !spaceMode && (dx * dx + dz * dz) < fishVis2;
  }
  if (iconMode && fishIconDirty) rebuildFishIconLayer();
  treeMat.uniforms.uTime.value = animT;
  // wind: power only above the calm baseline, direction wanders over time
  windAng += dt * 0.06 * Math.sin(t * 0.021 + 2.3);
  treeMat.uniforms.uWindAng.value = windAng;
  treeMat.uniforms.uWindPow.value = Math.max(0, envWind - 1) * 0.055;
  windDirX = Math.cos(windAng);
  windDirZ = Math.sin(windAng);
  water.material.color.copy(waterNight).lerp(waterDay, dayF);

  sunDisc.position.set(
    controls.target.x + sunDir.x * 900,
    controls.target.y + sunDir.y * 900,
    controls.target.z + sunDir.z * 900
  );
  sunDisc.material.opacity = THREE.MathUtils.clamp((sunDir.y - 0.02) * 6, 0, 1);
  moonDisc.position.set(
    controls.target.x - sunDir.x * 900,
    controls.target.y - sunDir.y * 900,
    controls.target.z - sunDir.z * 900
  );
  moonDisc.material.opacity = THREE.MathUtils.clamp((-sunDir.y - 0.02) * 6, 0, 1);

  const cloudBright = (0.3 + 0.7 * dayF) * (0.45 + 0.55 * envDim);
  for (const c of clouds) {
    c.material.color.setScalar(cloudBright);
    c.material.opacity = Math.min(1, c.material.userData.baseOp * cloudThick);
  }

  starsA.position.copy(controls.target);
  starsB.position.copy(controls.target);
  const sBase = nightF * starVis;
  starsA.material.opacity = sBase * (0.55 + 0.3 * Math.sin(t * 1.7));
  starsB.material.opacity = sBase * (0.55 + 0.3 * Math.sin(t * 2.3 + 2));

  // --- underwater camera: submerge the view when diving below the surface ---
  {
    const uW =
      !spaceMode && camera.position.y < water.position.y - 0.15;
    if (uW !== underwater) {
      underwater = uW;
      underwaterOverlay.style.opacity = underwater ? '1' : '0';
    }
    if (underwater) {
      // murky blue fog, tight enough that light dies a few blocks down
      scene.fog.color.copy(UNDERWATER_FOG);
      scene.fog.near = 2;
      scene.fog.far = 30;
      scene.background.copy(UNDERWATER_BG);
      // keep the vegetation / fish shaders fogged to the same blue
      treeMat.uniforms.uFogColor.value.copy(UNDERWATER_FOG);
      treeMat.uniforms.uFogNear.value = 2;
      treeMat.uniforms.uFogFar.value = 30;
      fishMat.uniforms.uFogColor.value.copy(UNDERWATER_FOG);
      fishMat.uniforms.uFogNear.value = 2;
      fishMat.uniforms.uFogFar.value = 30;
      // dim the sky, sun and starlight — you're under the sea now
      sun.intensity *= 0.18;
      hemi.intensity *= 0.25;
      amb.intensity *= 0.3;
      sunDisc.material.opacity *= 0.12;
      moonDisc.material.opacity *= 0.12;
      starsA.material.opacity *= 0.08;
      starsB.material.opacity *= 0.08;
    }
  }

  const dstr = 'Day ' + (Math.floor(gameMs / 86400000) - epochDay + 1) + ' · ' + phaseName(hrs);
  if (dstr !== lastDayStr) {
    dayLabelEl.textContent = dstr;
    lastDayStr = dstr;
  }
  drawCelestialIcon(animT, dusk);

  // Precipitation particles
  rainFx.active = weather.cur === 'rain' || weather.cur === 'storm';
  snowFx.active = weather.cur === 'snow';
  dustFx.active = weather.cur === 'dust';
  for (const sys of allFx) {
    sys.op = THREE.MathUtils.damp(sys.op, sys.active ? sys.targetOp : 0, 2.2, dt);
    sys.pts.visible = sys.op > 0.03;
    if (!sys.pts.visible) continue;
    sys.pts.material.opacity = sys.op;
    sys.pts.position.set(controls.target.x, controls.target.y - 8, controls.target.z);
    updateParticles(sys, dt * fxRate, animT, envWind);
  }

  // Placed trees: far shading + day/night light + live season crossfade
  {
    const sb = seasonInfo();
    for (const s of placedTrees) {
      const d = camera.position.distanceTo(s.sprA.position);
      const k = THREE.MathUtils.smoothstep(d, VIEW_DIST * 0.22, VIEW_DIST * 0.98);
      const shade = (1 - 0.5 * k) * (0.36 + 0.64 * dayF);
      s.sprA.material.map.offset.y = sb.i * ROW_FRAC;
      s.sprB.material.map.offset.y = sb.next * ROW_FRAC;
      s.sprA.material.opacity = 1 - sb.w;
      s.sprB.material.opacity = sb.w;
      s.sprA.material.color.setScalar(shade);
      s.sprB.material.color.setScalar(shade);
    }
    // ghosts preview the dominant season
    const grow = sb.w < 0.5 ? sb.i : sb.next;
    for (const gs of ghostTrees) gs.material.map.offset.y = grow * ROW_FRAC;
  }

  water.position.x = Math.round(controls.target.x / 4) * 4;
  water.position.z = Math.round(controls.target.z / 4) * 4;
  if (waterMat.userData.shader) {
    waterMat.userData.shader.uniforms.uTime.value = animT;
  }
  headLight.position.copy(camera.position);

  updateCavemen(dt * worldRate, animT);
  reapElders();
  anatTick(dt);
  // hard visibility rule: in detail mode no villager may stay hidden
  if (!iconMode && !spaceMode) {
    for (const cm of cavemen) cm.spr.visible = true;
  }
  // live roster thumbs: real sprite faces + ages, refreshed twice a second
  if ((squad.size || selectedCm) && t - lastThumbT > 0.5) {
    lastThumbT = t;
    refreshSquadThumbs();
    refreshRosterThumbs();
  }
  updateFootprints();
  updatePlaceGhost();

  // name tags + health bars bob above heads; redraw only when hp changes
  for (const cm of cavemen) {
    const ns = cm.nameSpr;
    if (!ns) continue;
    ns.visible = !iconMode && !spaceMode;
    if (!ns.visible) continue;
    const p = cm.spr.position;
    ns.position.set(p.x, p.y + cm.spr.scale.y + 0.32, p.z);
    const vit = villagerVitals(cm);
    const hp = Math.round(cm.stats.health);
    const enB = Math.round((cm.energy || 0) / 8); // redraw per ~8% energy
    if (hp !== ns.userData.hp || vit.yrs !== ns.userData.yr ||
        enB !== ns.userData.en || !!cm.sleeping !== !!ns.userData.sl) {
      ns.userData.hp = hp;
      ns.userData.yr = vit.yrs;
      ns.userData.en = enB;
      ns.userData.sl = !!cm.sleeping;
      drawNameTag(cm);
    }
  }

  // floating Move button rides above the selected human's head
  if (selectedCm && !iconMode && !spaceMode) {
    const sp = selectedCm.spr.position;
    _sqv.set(sp.x, sp.y + selectedCm.spr.scale.y + 1.15, sp.z).project(camera);
    if (_sqv.z > 1) {
      actionBtn.classList.add('hidden');
    } else {
      actionBtn.classList.remove('hidden');
      actionBtn.style.left = ((_sqv.x * 0.5 + 0.5) * innerWidth) + 'px';
      actionBtn.style.top = ((-_sqv.y * 0.5 + 0.5) * innerHeight) + 'px';
    }
  } else {
    actionBtn.classList.add('hidden');
  }
  if (moveFlag.visible && (iconMode || spaceMode)) moveFlag.visible = false;

  // sleeper zzz: keep each sleeping villager's z-stream above their head
  for (const cm of cavemen) {
    if (!cm.sleeping || iconMode || spaceMode) {
      if (cm.zzzSpr) cm.zzzSpr.visible = false;
      continue;
    }
    ensureZzz(cm);
    cm.zzzSpr.visible = true;
    drawZzz(cm, tNow);
    // head end of the lying body (art is baked head-to-the-left)
    const hx = cm.spr.position.x - cm.spr.scale.x * 0.3;
    const hy = cm.spr.position.y + cm.spr.scale.y * 0.7;
    cm.zzzSpr.position.set(hx, hy, cm.spr.position.z);
  }

  // ascii reaction bubbles bob above heads and fade out
  for (const cm of cavemen) {
    if (!cm.react) continue;
    const age = tNow - cm.react.born;
    if (age >= cm.react.dur) {
      scene.remove(cm.react.spr);
      cm.react.spr.material.map.dispose();
      cm.react.spr.material.dispose();
      cm.react = null;
      continue;
    }
    const hgt = cm.spr.scale.y;
    cm.react.spr.position.set(
      cm.spr.position.x,
      cm.spr.position.y + hgt + 1.15 + Math.sin(tNow * 6 + (cm.slotIdx || 0)) * 0.08,
      cm.spr.position.z
    );
    cm.react.spr.material.opacity = THREE.MathUtils.clamp(
      (cm.react.dur - age) / 1.2, 0, 1
    );
  }

  // wet look: soaked in the rain, dries out under the sun
  const raining = weather.cur === 'rain' || weather.cur === 'storm';
  for (const cm of cavemen) {
    if (raining) cm.wet = Math.min(1, cm.wet + dt * 0.5);
    else cm.wet = Math.max(0, cm.wet - dt * 0.08);
    const k = cm.wet * 0.45;
    const r = 1 - 0.45 * k, g = 1 - 0.38 * k, b = 1 - 0.25 * k;
    for (const st of Object.values(cm.mats)) {
      st.matR.color.setRGB(r, g, b);
      st.matL.color.setRGB(r, g, b);
    }
  }
  updateHomeFlames(animT);

  // follow cam: while a villager is selected the camera glides along with
  // them (orbiting/zooming still work — only the pivot travels). Paused
  // during camera tweens so it never fights a fly-to or switch transition.
  if (followCm && selectedCm === followCm && !camTween) {
    const fp = followCm.spr.position;
    const dx = fp.x - followPrev.x;
    const dz = fp.z - followPrev.z;
    camera.position.x += dx;
    camera.position.z += dz;
    controls.target.set(fp.x, fp.y + 1.5, fp.z);
    followPrev.copy(fp);
  }

  if (selectedCm) {
    // stats panel text only — the portrait itself is a live 3D orbit now
    charCtx.clearRect(0, 0, charCanvas.width, charCanvas.height);
    const yrs = Math.floor(
      selectedCm.stats.baseAge +
        (gameMs - selectedCm.stats.bornGameMs) / 86400000
    );
    const stLabel = AGE_STAGES[selectedCm.stage]
      ? AGE_STAGES[selectedCm.stage].label
      : 'Adult';
    const ageStr = yrs + ' yrs · ' + stLabel;
    const vit = villagerVitals(selectedCm);
    const vitalsStr = vit.weight + '|' + vit.height + '|' + vit.iq + '|' + vit.cond;
    if (ageStr !== lastAgeStr || vitalsStr !== lastVitalsStr) {
      document.getElementById('st-age').textContent = ageStr;
      document.getElementById('st-weight').textContent = vit.weight;
      document.getElementById('st-height').textContent = vit.height;
      document.getElementById('st-iq').textContent = vit.iq;
      document.getElementById('st-cond').textContent = vit.cond;
      lastAgeStr = ageStr;
      lastVitalsStr = vitalsStr;
    }
  }

  for (let i = effects.length - 1; i >= 0; i--) {
    if (!effects[i].update(dt)) effects.splice(i, 1);
  }

  for (const c of clouds) {
    c.position.x += CLOUD_WIND.x * dt * cloudRate;
    c.position.z += CLOUD_WIND.z * dt * cloudRate;
    const rx = c.position.x - controls.target.x;
    const rz = c.position.z - controls.target.z;
    if (rx > CLOUD_RANGE) c.position.x -= CLOUD_RANGE * 2;
    else if (rx < -CLOUD_RANGE) c.position.x += CLOUD_RANGE * 2;
    if (rz > CLOUD_RANGE) c.position.z -= CLOUD_RANGE * 2;
    else if (rz < -CLOUD_RANGE) c.position.z += CLOUD_RANGE * 2;
  }

  if (readout) {
    readout.textContent =
      'pos ' +
      Math.round(controls.target.x) + ', ' +
      Math.round(controls.target.y) + ', ' +
      Math.round(controls.target.z) +
      '  ·  chunks ' + chunks.size +
      '  ·  seed ' + SEED;
  }

  updateWorldLod(dt);
  renderer.render(scene, camera);

  // live character window: a small camera locked in front of the selected
  // villager slowly orbits them; the frame renders offscreen into a render
  // target and is blitted into the panel canvas (immune to DOM overlays).
  // The portrait is LOD-independent: subject + nearby ground are forced to
  // full detail no matter how far out the world view is zoomed, and the
  // short camera far-plane keeps the extra pass cheap via frustum culling.
  if (selectedCm && charPanel.classList.contains('open') && charBgCanvas) {
    prevOrbitAng += dt * 0.22;
    prevFrameN++;
    if (prevFrameN % 2 === 0) { // half-rate portrait — saves GPU + readback
      const pp = selectedCm.spr.position;
      const ph = Math.max(selectedCm.spr.scale.y, 0.5);
      const pr3 = ph * 2.6;
      const PW = 160, PH = 120;
      if (!prevRT || prevRT.width !== PW || prevRT.height !== PH) {
        if (prevRT) prevRT.dispose();
        prevRT = new THREE.WebGLRenderTarget(PW, PH, { colorSpace: THREE.SRGBColorSpace });
        prevBuf = new Uint8Array(PW * PH * 4);
        prevImg = null;
      }
      previewCamera.aspect = PW / PH;
      previewCamera.updateProjectionMatrix();
      previewCamera.position.set(
        pp.x + Math.cos(prevOrbitAng) * pr3,
        pp.y + ph * 0.78,
        pp.z + Math.sin(prevOrbitAng) * pr3
      );
      previewCamera.lookAt(pp.x, pp.y + ph * 0.45, pp.z);
      // temporary visibility overrides, restored right after the pass.
      // The portrait NEVER shows LOD substitutes: everything near the
      // subject renders at full detail regardless of world zoom
      const shown = [];
      const force = (o, v) => {
        if (!o || o.visible === v) return;
        shown.push([o, o.visible]);
        o.visible = v;
      };
      force(selectedCm.spr, true);       // the human themselves
      force(selectedCm.iconSpr, false);  // never their map icon
      const R2 = 34 * 34;
      const near = (x, z) => {
        const dx = x - pp.x, dz = z - pp.z;
        return dx * dx + dz * dz < R2;
      };
      for (const ch of chunks.values()) {
        const cdx = ch.cx * CHUNK + CHUNK / 2 - pp.x;
        const cdz = ch.cz * CHUNK + CHUNK / 2 - pp.z;
        if (cdx * cdx + cdz * cdz > R2) continue;
        force(ch.mesh, true);   // real terrain, not void
        force(ch.trees, true);  // real trees, not point icons
        force(ch.icons, false);
        force(fishIconPts, false);
      }
      for (const s of placedTrees) {
        if (!near(s.sprA.position.x, s.sprA.position.z)) continue;
        force(s.sprA, true);
        force(s.sprB, true);
        force(s.blob, true);
        force(s.iconSpr, false);
      }
      for (const [fspr, ic] of extraFireIcons) {
        if (near(fspr.position.x, fspr.position.z)) force(ic, false);
      }
      for (const f of campfires) {
        if (near(f.position.x, f.position.z)) force(f, true);
      }
      if (homeFire && near(homeFire.position.x, homeFire.position.z)) {
        force(homeFire, true);
        force(homeFireIcon, false);
        for (const fl of homeFlames) force(fl, true);
        force(homeGlow, true);
      }
      for (const cm of cavemen) {
        if (cm === selectedCm) continue;
        if (!near(cm.spr.position.x, cm.spr.position.z)) continue;
        force(cm.spr, true);
        force(cm.iconSpr, false);
      }
      if (spaceMode) force(water, true);
      renderer.setRenderTarget(prevRT);
      renderer.render(scene, previewCamera);
      renderer.setRenderTarget(null);
      for (let i = shown.length - 1; i >= 0; i--) shown[i][0].visible = shown[i][1];
      renderer.readRenderTargetPixels(prevRT, 0, 0, PW, PH, prevBuf);
      if (!charBgCanvas.width || charBgCanvas.width !== PW) {
        charBgCanvas.width = PW;
        charBgCanvas.height = PH;
      }
      if (!prevImg) prevImg = new ImageData(PW, PH);
      const d8 = prevImg.data;
      for (let y = 0; y < PH; y++) { // GL is bottom-up — flip rows
        const src = (PH - 1 - y) * PW * 4;
        d8.set(prevBuf.subarray(src, src + PW * 4), y * PW * 4);
      }
      charBgCanvas.getContext('2d').putImageData(prevImg, 0, 0);
    }
  }
}
// headless doc-capture mode: ?capture=1 skips the render loop so the page
// boots without a GPU — SPRITESHEET.md's PNGs are captured this way
if (!new URLSearchParams(location.search).has('capture')) animate();

// debug/testing hook (read-only)
window.__DBG = {
  get cavemen() { return cavemen; },
  get homePos() { return homePos; },
  get selectedCm() { return selectedCm; },
  get cameraPos() { return camera.position; },
  get camTarget() { return controls.target; },
  get chunks() { return chunks; },
  get fishIconLayer() { return fishIconPts; },
  get iconMode() { return iconMode; },
  seasonNow: () => seasonInfo(),
  chunkList: () => [...chunks.values()],
  iconAtlasCvs: () => iconAtlasCanvas,
  treeAtlasCvs: () => treeAtlasCanvas,
  rebuildIconAtlas: () => { buildTreeAtlas(); buildIconAtlas(); return iconAtlasCanvas; },
  fishShaderSrc: () => fishMat.vertexShader,
  state: () => ({ iconMode, spaceMode, fishVisDist: FISH_VIS_DIST }),
  version: 24,
  selectCaveman: (cm) => selectCaveman(cm),
  action: (on) => setActionMode(on),
  move: (x, z) => commandMoveTo(x, z),
  pickUp: (i) => {
    const c = cavemen[i || 0];
    if (c && selectedCm && c !== selectedCm) pickUpVillager(selectedCm, c);
    return !!(selectedCm && selectedCm.carrying);
  },
  putDown: (i) => {
    const c = cavemen[i || 0];
    if (c && c.carriedBy) putDownVillager(c);
    return !!(c && c.carriedBy);
  },
  openMenu: (i) => {
    const cm = cavemen[i || 0];
    if (cm && selectedCm && selectedCm !== cm) {
      openActionMenu(cm, innerWidth / 2, innerHeight / 2);
      return menuTarget ? menuTarget.stats.name : null;
    }
    return null;
  },
  menuClose: () => closeActionMenu(true),
  get menuTarget() { return menuTarget ? menuTarget.stats.name : null; },
  get actionMode() { return actionMode; },
  get flagVisible() { return moveFlag.visible; },
  squadAdd: (cm) => {
    squad.add(cm);
    cm.hold = false;
    cm.followLead = null;
    cm.actionMove = null;
    if (cm.outSpr) cm.outSpr.visible = true;
    renderSquadList();
    renderRoster();
  },
  strike: () => strikeCampfire(),
  know: () => ({ ...KNOW }),
  unlock: (k) => unlockKnowledge(k),
  pop: () => cavemen.length,
  sleepCount: () => cavemen.filter((c) => c.sleeping).length,
  energy: (i) => {
    const cm = cavemen[i || 0];
    return cm ? { e: Math.round(cm.energy), sl: !!cm.sleeping, fs: !!cm.forcedSleep } : null;
  },
  setHour: (h) => {
    const d = new Date(gameMs);
    const cur = d.getHours() + d.getMinutes() / 60;
    gameMs += (((h - cur) % 24) + 24) % 24 * 3600000;
  },
  day: () => Math.round(daylightK * 100) / 100,
  tpVillager: (i, x, z) => {
    const cm = cavemen[i || 0];
    if (!cm) return null;
    cm.spr.position.set(x, charGroundY(x, z), z);
    cm.gy = charGroundY(x, z);
    wakeCaveman(cm);
    selectCaveman(cm);
    return true;
  },
  setStick: (x, z) => {
    charJoy.x = x; charJoy.z = z;
    charJoy.active = x !== 0 || z !== 0;
  },
  depthAt: (x, z) => waterDepthAt(x, z),
  camPose: (tx, ty, tz, dx, dy, dz) => {
    followCm = null;
    camTween = null;
    controls.target.set(tx, ty, tz);
    camera.position.set(dx, dy, dz);
    controls.update();
    desiredDist = clampZoom(camera.position.distanceTo(controls.target));
    return true;
  },
  fishCount: () => {
    let n = 0, vis = 0;
    for (const ch of chunks.values()) {
      if (!ch.fish) continue;
      n += ch.fish.geometry.instanceCount || 0;
      if (ch.fish.visible) vis += ch.fish.geometry.instanceCount || 0;
    }
    return { total: n, visible: vis };
  },
  findSea: () => {
    for (let rad = 12; rad < 600; rad += 6) {
      for (let a = 0; a < 6.28; a += 0.22) {
        const x = homePos.x + Math.cos(a) * rad;
        const z = homePos.z + Math.sin(a) * rad;
        if (waterDepthAt(x, z) > 0.16) return { x: Math.round(x), z: Math.round(z) };
      }
    }
    return null;
  },
  setIconMode: (on) => setIconMode(on),
  fishState: () => {
    const g = fishAtlasCanvas.getContext('2d');
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    let nz = 0;
    const d = g.getImageData(0, 0, 192, 64).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) nz++;
    return { nonZeroPx: nz, body: px(14, 16) };
  },
  fishProbe: () => {
    buildFishAtlas();
    const g = fishAtlasCanvas.getContext('2d');
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 3, 3);
    return {
      kinds: FISH_KINDS.length,
      k0: FISH_KINDS[0],
      afterManual: px(1, 1),
      body: px(14, 16),
      tail: px(5, 15),
    };
  },
  fishAtlasInfo: () => ({
    built: fishAtlasBuilt,
    w: fishAtlasCanvas.width,
    h: fishAtlasCanvas.height,
    sample: (() => {
      const d = fishAtlasCanvas.getContext('2d').getImageData(14, 16, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    })(),
  }),
  // deterministic sprite captures for the docs (SPRITESHEET.md): re-runs the
  // painters into fresh canvases so every PNG is pixel-exact with the game
  captureArt: () => {
    const out = {};
    const draw = (art, pal, scale) => {
      const c = document.createElement('canvas');
      drawPixelArt(c, art, pal, scale);
      return c.toDataURL();
    };
    // villagers: base adult man/woman, child, elders
    out.caveman = draw(CAVEMAN, CAVEMAN_PALETTE, 4);
    out.cavewoman = draw(CAVEWOMAN, CAVEWOMAN_PALETTE, 4);
    out.child = draw(CAVEMAN_CHILD, CAVEMAN_PALETTE, 4);
    out.elder = draw(CAVEMAN_ELDER, CAVEMAN_ELDER_PALETTE, 4);
    out.womanElder = draw(CAVEWOMAN_ELDER, CAVEWOMAN_ELDER_PALETTE, 4);
    // a row of unique looks: same base art, per-person hairstyle + colours
    const rows = [
      [CAVEMAN, false, 1, 0],   // plain man
      [CAVEMAN, false, 1, 1],   // side ponytail + full beard
      [CAVEMAN, false, 3, 2],   // headband + chin puff
      [CAVEMAN, false, 2, 0],   // long strands
      [CAVEWOMAN, true, 1, -1], // side tail
      [CAVEWOMAN, true, 2, -1], // hair flower
    ];
    const cellW = 20, cellH = 26, S = 4, GAP = 4;
    const strip = document.createElement('canvas');
    strip.width = (cellW + GAP) * rows.length;
    strip.height = cellH * S;
    const sg = strip.getContext('2d');
    sg.imageSmoothingEnabled = false;
    rows.forEach(([art, female, style, beard], i) => {
      const vArt = artVariant(art, female, style, beard);
      const look = pickLook(mulberry32(1000 + i * 77), female);
      look.style = style; look.beard = beard;
      const vp = lookPal(art === CAVEWOMAN ? CAVEWOMAN_PALETTE : CAVEMAN_PALETTE, look);
      const c = document.createElement('canvas');
      drawPixelArt(c, vArt, vp, 1);
      sg.drawImage(c, i * (cellW + GAP), 0);
    });
    out.variants = strip.toDataURL();
    // the baked lying-down sleep pose (same canvas the game displays)
    out.sleep = makeCavemanMats(CAVEMAN, CAVEMAN_PALETTE)[2].map.image.toDataURL();
    // effects & UI sprites
    out.flame = draw(FLAME, FLAME_PALETTE, 5);
    out.moon = makeMoonTexture().image.toDataURL();
    const zzz = document.createElement('canvas');
    zzz.width = 40; zzz.height = 26;
    drawZzz({ zzzCv: zzz, zzzTex: { needsUpdate: false } }, 1.3);
    out.zzz = zzz.toDataURL();
    drawCampLabel();
    out.campLabel = campLabelCanvas.toDataURL();
    out.moveFlag = moveFlag.material.map.image.toDataURL();
    // sample name tag: name · age, health bar, daily energy bar
    const ns = makeNameSprite();
    drawNameTag({
      nameSpr: ns,
      stats: {
        name: 'Krag', baseAge: 30, bornGameMs: gameMs - 30 * 86400000,
        health: 88, heightCm: 174, weightKg: 76, iqBase: 80,
      },
      energy: 64, sleeping: false,
    });
    out.nameTag = ns.userData.canvas.toDataURL();
    drawCelestialIcon(0, 0);
    out.celestial = document.getElementById('celestial-icon').toDataURL();
    return out;
  },
  // animated caveman+cavewoman variant pairs for the README GIF: 8 frames,
  // one (man, woman) combo each, painted with the same variant logic the
  // tribe uses, so the animation shows real spawnable looks
  captureVillagerFrames: () => {
    const S = 4, GAP = 8;
    const build = (art, female, style, beard, seed) => {
      const vArt = artVariant(art, female, style, beard);
      const look = pickLook(mulberry32(seed), female);
      look.style = style; look.beard = beard;
      const pal = lookPal(art === CAVEWOMAN ? CAVEWOMAN_PALETTE : CAVEMAN_PALETTE, look);
      const c = document.createElement('canvas');
      drawPixelArt(c, vArt, pal, S);
      return c;
    };
    const men = [[1, 0], [1, 1], [3, 2], [2, 0]];  // [style, beard] male looks
    const women = [[1], [2]];                      // female looks: side tail / flower
    const frames = [];
    for (let i = 0; i < 8; i++) {
      const [ms, mb] = men[i % 4];
      const [ws] = women[i % 2];
      const m = build(CAVEMAN, false, ms, mb, 1000 + i * 77);
      const w = build(CAVEWOMAN, true, ws, -1, 2000 + i * 91);
      const cv = document.createElement('canvas');
      cv.width = m.width + GAP + w.width;
      cv.height = Math.max(m.height, w.height);
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(m, 0, 0);
      g.drawImage(w, m.width + GAP, 0);
      frames.push(cv.toDataURL());
    }
    return JSON.stringify(frames);
  },
  // animated forest seasons for the docs: the same two atlas rows the wind
  // shader blends (mix(a, b, w) via source-over), morphed through a full year
  // for a strip of species — "watch the forest change colour"
  captureSeasonCycle: (frames, speciesIdx) => {
    const smooth = (e0, e1, x) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const S = 2, GAP = 8;
    const out = [];
    for (let k = 0; k < frames; k++) {
      const f = (k / frames) * 4;               // a full year → 4 seasons
      const i = ((Math.floor(f) % 4) + 4) % 4;
      const w = smooth(0.72, 1, f - Math.floor(f)); // last 28% of each season eases into the next
      const cv = document.createElement('canvas');
      cv.width = speciesIdx.length * ATLAS_CELL * S + (speciesIdx.length - 1) * GAP;
      cv.height = ATLAS_CELL * S;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      speciesIdx.forEach((si, col) => {
        const sx = si * ATLAS_CELL;
        const tmp = document.createElement('canvas');
        tmp.width = ATLAS_CELL; tmp.height = ATLAS_CELL;
        const tg = tmp.getContext('2d');
        tg.imageSmoothingEnabled = false;
        tg.drawImage(treeAtlasCanvas, sx, i * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL, 0, 0, ATLAS_CELL, ATLAS_CELL);
        if (w > 0.001) {
          tg.globalAlpha = w;
          tg.drawImage(treeAtlasCanvas, sx, ((i + 1) % 4) * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL, 0, 0, ATLAS_CELL, ATLAS_CELL);
          tg.globalAlpha = 1;
        }
        g.drawImage(tmp, col * (ATLAS_CELL * S + GAP), 0, ATLAS_CELL * S, ATLAS_CELL * S);
      });
      out.push(cv.toDataURL());
    }
    return JSON.stringify(out);
  },
  // day/night cycle for the docs: re-derives sunDir exactly like the game's
  // update loop (hour of day → sun angle) and captures the live sky-pill
  // canvas through a full 24h
  captureSkyCycle: (frames) => {
    const out = [];
    for (let k = 0; k < frames; k++) {
      const hrs = (k / frames) * 24;
      const sunAng = ((hrs - 6) / 24) * Math.PI * 2;
      sunDir.set(Math.cos(sunAng), Math.sin(sunAng), 0.38).normalize();
      const duskF = Math.max(0, 1 - Math.abs(sunDir.y) * 3.2);
      drawCelestialIcon(k * 0.7, duskF);
      const cv = document.createElement('canvas');
      cv.width = 96; cv.height = 96;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(document.getElementById('celestial-icon'), 0, 0, 96, 96);
      out.push(cv.toDataURL());
    }
    return JSON.stringify(out);
  },
  // fish swim frames for the docs: 'swim' is a tight-cropped clownfish doing
  // the exact two-pose tail flap the shader flips, plus a swell bob; 'school'
  // is all six species in a row, flapping in sync — both straight from the
  // same paintFish the atlas uses
  captureFishFrames: (mode) => {
    const cell = document.createElement('canvas');
    cell.width = 32; cell.height = 32;
    const cg = cell.getContext('2d');
    const bboxOf = (k, oy) => {
      cg.clearRect(0, 0, 32, 32);
      paintFish(cg, 2, oy, k, false);
      const d = cg.getImageData(0, 0, 32, 32).data;
      let x0 = 32, y0 = 32, x1 = 0, y1 = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        if (d[(y * 32 + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      return [x0, y0, x1, y1];
    };
    const paint = (k, frameB, oy) => {
      cg.clearRect(0, 0, 32, 32);
      paintFish(cg, 2, oy, k, frameB);
      return cell;
    };
    const toDataUrl = (cv) => cv.toDataURL();
    if (mode === 'swim') {
      // clownfish: tail left → tail right (+1px bob) → tail left
      const k = FISH_KINDS[1];
      const [x0, y0, x1, y1] = bboxOf(k, 0);
      const S = 4, PAD = 5;
      const w = (x1 - x0 + 1 + PAD * 2) * S;
      const h = (y1 - y0 + 1 + PAD * 2) * S;
      const out = [];
      for (const [frameB, dy] of [[false, 0], [true, 1], [false, 0]]) {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(paint(k, frameB, dy), x0, y0, x1 - x0 + 1, y1 - y0 + 1, PAD * S, PAD * S, (x1 - x0 + 1) * S, (y1 - y0 + 1) * S);
        out.push(toDataUrl(cv));
      }
      return JSON.stringify(out);
    }
    // school: all six species in uniform cells, two poses in sync
    const S = 3, GAP = 8;
    const CELL = 32 * S;
    const out = [];
    for (const frameB of [false, true]) {
      const cv = document.createElement('canvas');
      cv.width = FISH_KINDS.length * CELL + (FISH_KINDS.length - 1) * GAP;
      cv.height = CELL;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      FISH_KINDS.forEach((k, i) => {
        g.drawImage(paint(k, frameB, 0), 0, 0, 32, 32, i * (CELL + GAP), 0, CELL, CELL);
      });
      out.push(toDataUrl(cv));
    }
    return JSON.stringify(out);
  },
  // sleeping villager with rising ZZZ for the docs: the exact baked sleep
  // pose the game shows, with the same animated ZZZ sprite cycling above it
  captureSleepZzz: (frames) => {
    const sleepImg = makeCavemanMats(CAVEMAN, CAVEMAN_PALETTE)[2].map.image;
    const zzzCv = document.createElement('canvas');
    zzzCv.width = 40; zzzCv.height = 26;
    const zzzTex = { needsUpdate: false };
    const S = 2, PAD = 6;
    const out = [];
    for (let k = 0; k < frames; k++) {
      drawZzz({ zzzCv, zzzTex }, k * 0.18);
      const cv = document.createElement('canvas');
      cv.width = Math.max(sleepImg.width, zzzCv.width) * S;
      cv.height = (zzzCv.height + PAD + sleepImg.height) * S;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(zzzCv, 0, 0, zzzCv.width, zzzCv.height, 0, 0, zzzCv.width * S, zzzCv.height * S);
      g.drawImage(sleepImg, 0, 0, sleepImg.width, sleepImg.height, 0, (zzzCv.height + PAD) * S, sleepImg.width * S, sleepImg.height * S);
      out.push(cv.toDataURL());
    }
    return JSON.stringify(out);
  },
};
