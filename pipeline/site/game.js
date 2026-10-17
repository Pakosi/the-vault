import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// The world is pre-lit: Cycles global illumination is baked into lightmaps (architecture + props)
// and vertex colours (furniture). Reflections come from baked HDR probes plus a planar floor mirror.

// ---------------------------------------------------------------- config
const HALL = { x: 24, z: 16, h: 8 };
const W = 'assets/world/';
const COLORS = ['#d6b26e', '#ff3d7f', '#3de0ff', '#56d68b', '#b388ff', '#ff8a3d', '#f1e9db'];
const QUALITY = {
  high:   { dpr: 1.75, bloom: true,  reflect: 0.5, msaa: 4 },
  medium: { dpr: 1.25, bloom: true,  reflect: 0.35, msaa: 2 },
  low:    { dpr: 1.0,  bloom: false, reflect: 0,   msaa: 0 },
};
const CAR_INFO = {
  bugatti_chiron_profilee: { name: 'Bugatti Chiron Profilée', spec: [['Power', '1,500 hp'], ['0-100', '2.3 s'], ['Top speed', '380 km/h']], by: 'DisneyCars', url: 'https://sketchfab.com/3d-models/2023-bugatti-chiron-profilee-6da5092ee455446cb050e4c6b4a3ac05' },
  porsche_911_turbo_s: { name: 'Porsche 911 Turbo S', spec: [['Power', '650 hp'], ['0-100', '2.7 s'], ['Top speed', '330 km/h']], by: '3d cars studio', url: 'https://sketchfab.com/3d-models/porsche-911-turbo-s-081cf9a708bb4b8b8f14d55b56ffdfe9' },
  aventador: { name: 'Lamborghini Aventador LP700-4', spec: [['Power', '700 hp'], ['0-100', '2.9 s'], ['Top speed', '350 km/h']], by: 'CaptainDavid100k', url: 'https://sketchfab.com/3d-models/lamborghini-aventador-lp700-67796ac0bfa54c5cbe34dffc9847264d' },
  huracan: { name: 'Lamborghini Huracán Super Trofeo EVO2', spec: [['Power', '620 hp'], ['Gearbox', '6-speed sequential'], ['Use', 'Track only']], by: 'kevin (ケビン)', url: 'https://sketchfab.com/3d-models/2022-lamborghini-huracan-super-trofeo-evo2-9b9305754f644509ac7d8913fc5707a3' },
  g900: { name: 'Mercedes-AMG G 63 BRABUS 900', spec: [['Power', '900 hp'], ['0-100', '3.7 s'], ['Top speed', '280 km/h']], by: 'DAS AUTO', url: 'https://sketchfab.com/3d-models/mercedes-benz-brabus-g900-aad90805a0a84381bbee50f569e45d50' },
  ferrari_488: { name: 'Ferrari 488 Pista Widebody', spec: [['Power', '720 hp'], ['0-100', '2.85 s'], ['Top speed', '340 km/h']], by: 'Dev365TH', url: 'https://sketchfab.com/3d-models/ferrari-488-pista-widebody-16c28f5b3ed24991ac3d1208f4a8bc1f' },
  rolls_ghost: { name: 'Rolls-Royce Ghost', spec: [['Power', '571 hp'], ['Engine', '6.75 L V12'], ['Cabin', 'Starlight headliner']], by: 'Jagguz_wrld', url: 'https://sketchfab.com/3d-models/rolls-royce-ghost-a45a10b1225644739475f8dd541f8875' },
};
// Per-material look tweaks the glTF export can't carry (roughness multipliers, mirror floors).
const MATFIX = {
  concrete_garage: { roughness: 0.42, reflect: 0.6, env: 0.15 },
  concrete_lounge: { roughness: 0.75, reflect: 0.15, env: 0.3 },
  parquet: { roughness: 0.75, reflect: 0.22, env: 0.3 },
  stone_tile: { roughness: 0.55, reflect: 0.3, env: 0.3 },
  black_gloss: { reflect: 0.15, env: 0.35 },
  marble_white: { roughness: 0.22, env: 1 },
  marble_black: { roughness: 0.25, env: 1 },
  carpet: { roughness: 1, env: 0.2 },
  brick: { env: 0.25 },
  ceiling: { env: 0.3 },
};
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('vault.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vault.' + k, JSON.stringify(v)); } catch {} },
};
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
} catch (e) {
  $('loadTxt').textContent = 'Your browser turned 3D off for this page. Quit and reopen the browser, then try again.';
  throw e;
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  store.set('quality', 'low');
  $('loading').hidden = false; $('loadTxt').textContent = 'The graphics card ran out of memory. Reload to continue on lighter settings.';
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = +(params.get('exp') || 1.15);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050406);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.06, 140);
const pmrem = new THREE.PMREMGenerator(renderer);

let quality = params.get('q') || store.get('quality', guessQuality());
let Q = QUALITY[quality] || QUALITY.medium;
let composer, bloomPass, reflector = null, dprScale = 1;
const patchedMats = [];

function guessQuality() {
  if (/Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) return 'low';
  return (navigator.hardwareConcurrency || 4) >= 8 ? 'high' : 'medium';
}

function setupPipeline() {
  Q = QUALITY[quality] || QUALITY.medium;
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr) * dprScale);
  renderer.setSize(innerWidth, innerHeight, false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (composer) composer.dispose?.();
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  if (Q.bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), +(params.get('bs') ?? 0.22), 0.4, +(params.get('bt') ?? 3.0));
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());
  setupReflector();
}

function setupReflector() {
  if (reflector) { scene.remove(reflector); reflector.getRenderTarget().dispose(); reflector = null; }
  if (Q.reflect) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    reflector = new Reflector(new THREE.PlaneGeometry(HALL.x * 2, HALL.z * 2), {
      textureWidth: Math.round(s.x * Q.reflect), textureHeight: Math.round(s.y * Q.reflect), clipBias: 0.003,
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = 0.0;
    reflector.material.colorWrite = false;
    reflector.material.depthWrite = false;
    reflector.renderOrder = -10;
    scene.add(reflector);
  }
  patchedMats.forEach(bindReflection);
}

// One onBeforeCompile for every world material. Flags:
//   noEnvDiffuse: lighting comes from the bake, so the probe only adds reflections
//   vertexLight:  baked irradiance lives in the COLOR_0 attribute (scaled down by vScale)
//   reflect:      add the planar floor mirror with roughness blur and fresnel
const LM_MAPS = THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '');
function patchMaterial(mat, flags) {
  mat.userData.flags = flags;
  mat.customProgramCacheKey = () => `vault:${flags.noEnvDiffuse ? 1 : 0}${flags.vertexLight ? 1 : 0}${flags.reflect ? 1 : 0}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tReflect = { value: null };
    sh.uniforms.reflectMatrix = { value: new THREE.Matrix4() };
    sh.uniforms.reflectOn = { value: 0 };
    sh.uniforms.reflectStrength = { value: flags.reflect || 0 };
    sh.uniforms.vLightScale = { value: flags.vScale || 1 };
    let fs = sh.fragmentShader, vs = sh.vertexShader;
    if (flags.noEnvDiffuse || flags.vertexLight) {
      let maps = LM_MAPS;
      if (flags.vertexLight) maps = maps.replace('#if defined( RE_IndirectDiffuse )', '#if defined( RE_IndirectDiffuse )\n\tirradiance += vColor.rgb * vLightScale;');
      fs = fs.replace('#include <lights_fragment_maps>', maps);
    }
    if (flags.vertexLight) fs = fs.replace('#include <color_fragment>', '');
    fs = fs.replace('#include <common>', '#include <common>\nuniform float vLightScale;');
    if (flags.reflect) {
      vs = vs.replace('#include <common>', '#include <common>\nuniform mat4 reflectMatrix;\nvarying vec4 vReflUv;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvReflUv = reflectMatrix * (modelMatrix * vec4(transformed, 1.0));');
      fs = fs.replace('#include <common>', '#include <common>\nuniform sampler2D tReflect;\nuniform float reflectOn;\nuniform float reflectStrength;\nvarying vec4 vReflUv;')
        .replace('#include <opaque_fragment>', `
        if (reflectOn > 0.5) {
          vec2 ruv = vReflUv.xy / vReflUv.w + normal.xz * 0.012;
          float blur = roughnessFactor * roughnessFactor * 0.03;
          vec3 rc = texture2D(tReflect, ruv).rgb * 0.28;
          rc += texture2D(tReflect, ruv + vec2(blur, 0.0)).rgb * 0.18;
          rc += texture2D(tReflect, ruv - vec2(blur, 0.0)).rgb * 0.18;
          rc += texture2D(tReflect, ruv + vec2(0.0, blur)).rgb * 0.18;
          rc += texture2D(tReflect, ruv - vec2(0.0, blur)).rgb * 0.18;
          float ndv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
          float gloss = 1.0 - roughnessFactor;
          outgoingLight += rc * reflectStrength * mix(0.25, 1.0, fres) * gloss * gloss;
        }
        #include <opaque_fragment>`);
    }
    sh.fragmentShader = fs; sh.vertexShader = vs;
    mat.userData.shader = sh;
    bindReflection(mat);
  };
  patchedMats.push(mat);
  return mat;
}
function bindReflection(mat) {
  const sh = mat.userData.shader;
  if (!sh || !mat.userData.flags.reflect) return;
  if (reflector) {
    sh.uniforms.tReflect.value = reflector.getRenderTarget().texture;
    sh.uniforms.reflectMatrix.value = reflector.material.uniforms.textureMatrix.value;
    sh.uniforms.reflectOn.value = 1;
  } else sh.uniforms.reflectOn.value = 0;
}

// ---------------------------------------------------------------- helpers
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw?.(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.userData.ctx = g; return t;
}
const tickers = [];
const colliders = [];
const interactables = [];
function interact(x, z, r, label, act) { interactables.push({ pos: new THREE.Vector3(x, 0, z), r, label, act }); }

// ---------------------------------------------------------------- loading
// Safari's createImageBitmap path in GLTFLoader can stall on webp; use plain <img> decoding there.
const IS_SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
if (IS_SAFARI) self.createImageBitmap = undefined;
const manager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader(manager);
let loadDone = 0, loadTotal = 1;
function progress(label) { loadDone++; $('bar').firstElementChild.style.width = Math.min(100, (loadDone / loadTotal) * 100) + '%'; if (label) $('loadTxt').textContent = label; }
// Every asset resolves (null on failure/timeout) so one bad file can't freeze the loading screen.
const pending = new Set();
function guard(url, p, ms = 90000) {
  const name = url.split('/').pop().replace(/\.(gltf\.json|json|webp)$/, '');
  pending.add(name); window.__pending = [...pending].join(',');
  return Promise.race([p, new Promise((res) => setTimeout(() => { console.warn('timeout', url); res(null); }, ms))])
    .then((v) => (pending.delete(name), window.__pending = [...pending].join(','), v));
}
setInterval(() => { if (!loadingHidden && pending.size && performance.now() > 25000) $('loadTxt').textContent = 'Still loading: ' + [...pending].join(', '); }, 2000);
const loadGLTF = (url) => guard(url, new Promise((res) => gltfLoader.load(url, res, undefined, (e) => { console.warn('load failed', url, e); res(null); })));
const loadTex = (url) => guard(url, new Promise((res) => texLoader.load(url, res, undefined, () => res(null))));

const loadEnv = (name) => guard(`env_${name}`, loadEnv0(name), 60000);
async function loadEnv0(name) {
  // HDR probe: float16 RGBA, gzip, base64 (the host can't serve .hdr/.exr)
  try {
    const j = await (await fetch(W + `env_${name}.json`)).json();
    const bin = Uint8Array.from(atob(j.data), (c) => c.charCodeAt(0));
    const raw = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const tex = new THREE.DataTexture(new Uint16Array(raw), j.w, j.h, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.flipY = true; tex.needsUpdate = true;
    const env = pmrem.fromEquirectangular(tex).texture; tex.dispose();
    return env;
  } catch (e) { console.warn('env failed', name, e); return null; }
}

// ---------------------------------------------------------------- world
let layout, envHall, envGarage;
const screens = {};
async function loadWorld() {
  THREE.Cache.enabled = true; // the world and furniture files share texture files; load each image once
  layout = await (await fetch(W + 'layout.json')).json();
  loadTotal = 6 + layout.cars.length;
  for (const c of layout.colliders) colliders.push({ x0: c[0], x1: c[1], z0: c[2], z1: c[3] });
  const parts = await fetch(W + 'parts.json').then((r) => r.json()).catch(() => ({ furniture: 0 }));
  loadTotal += parts.furniture;
  const furnP = Promise.all(Array.from({ length: parts.furniture }, (_, k) => loadGLTF(W + `furniture${k}.gltf.json`).then((g) => (progress('Moving in the furniture'), g))));
  const [gltf, lmA, lmB, eH, eG] = await Promise.all([
    loadGLTF(W + 'world.gltf.json').then((g) => (progress('Laying the floors'), g)),
    loadTex(W + 'lm_A.webp').then((t) => (progress('Switching on the lights'), t)),
    loadTex(W + 'lm_B.webp').then((t) => (progress(), t)),
    loadEnv('hall').then((t) => (progress('Polishing the chrome'), t)),
    loadEnv('garage').then((t) => (progress(), t)),
  ]);
  envHall = eH; envGarage = eG || eH;
  scene.environment = envHall;
  const lm = { A: lmA, B: lmB };
  for (const t of Object.values(lm)) if (t) { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.channel = 1; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; }
  const L = layout.lightmaps || {};
  window.__stage = 'world files loaded';
  if (!gltf) throw new Error('world model failed to load');
  const world = gltf.scene;
  for (const f of await furnP) if (f) world.add(f.scene);
  THREE.Cache.clear(); THREE.Cache.enabled = false;
  // Same image across files -> one shared Source, so the GPU holds each texture once.
  const sources = new Map();
  world.traverse((o) => {
    for (const m of o.isMesh ? [].concat(o.material) : []) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
      const t = m[k], d = t?.source?.data;
      if (!d) continue;
      const s0 = sources.get(d);
      if (s0) t.source = s0; else sources.set(d, t.source);
    }
  });
  const dynamic = [];
  world.traverse((o) => {
    if (!o.isMesh) return;
    const group = (o.name.match(/VAULT_(A|B|F|EMIT|GLASS)/) || [])[1] || (o.parent?.name.match(/VAULT_(A|B|F|EMIT|GLASS)/) || [])[1];
    if (!group) { dynamic.push(o); return; }
    const mats = [].concat(o.material).map((m0) => {
      const m = m0.clone();
      const fix = MATFIX[m.name] || {};
      if (fix.roughness != null) m.roughness = fix.roughness;
      m.envMapIntensity = fix.env ?? 0.5;
      if (group === 'A' || group === 'B') {
        if (lm[group]) { m.lightMap = lm[group]; m.lightMapIntensity = (L[group] || 1) * Math.PI; }
        patchMaterial(m, { noEnvDiffuse: true, reflect: fix.reflect });
      } else if (group === 'F') {
        m.vertexColors = true;
        patchMaterial(m, { vertexLight: true, vScale: (L.F || 8) * Math.PI });
      } else if (group === 'GLASS') {
        m.transparent = true; m.opacity = 0.14; m.roughness = 0.03; m.metalness = 0; m.depthWrite = false; m.envMapIntensity = 1.2;
      } else if (group === 'EMIT') {
        if (m.name === 'backbar_glow') m.emissiveIntensity *= 0.35;
      }
      return m;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
    o.matrixAutoUpdate = false; o.updateMatrix();
  });
  dynamic.forEach((o) => (o.visible = false)); // placeholder screens; replaced by live canvases below
  window.__stage = 'materials set up';
  scene.add(world);
  world.updateMatrixWorld(true);
  buildScreens();
  buildInteractions();
}

// ---------------------------------------------------------------- screens
function screenPlane(key, tex, extra = 0) {
  const s = layout.screens[key];
  const m = new THREE.Mesh(new THREE.PlaneGeometry(s.size[0], s.size[1]), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.material.color.setScalar(1.0 + extra);
  m.position.set(s.center[0], s.center[1], s.center[2]);
  m.rotation.y = s.ry || 0;
  scene.add(m);
  return m;
}
let tvMat, tvCanvasTex, boardTex;
const slotScreens = [], cabinets = [];
const ARCADE = [{ name: 'NEON SNAKE', color: '#56d68b', play: () => openSnake() }, { name: 'ASTRO RUN', color: '#ff3d7f' }, { name: 'TURBO 88', color: '#ff8a3d' }, { name: 'GRID WARS', color: '#3de0ff' }];
function buildScreens() {
  tvCanvasTex = canvasTex(1280, 720);
  tvMat = screenPlane('tv', tvCanvasTex, 0.1).material;
  for (let i = 0; i < 8; i++) {
    if (!layout.screens['slot' + i]) continue;
    const tex = canvasTex(256, 192, (g) => drawSlotScreen(g, ['7️⃣', '💎', '🍒'], i));
    screenPlane('slot' + i, tex); slotScreens[i] = { tex, idx: i };
  }
  for (let i = 0; i < 4; i++) {
    if (!layout.screens['arcade' + i]) continue;
    const tex = canvasTex(256, 200); screenPlane('arcade' + i, tex); cabinets[i] = { tex, gm: ARCADE[i], i };
  }
  boardTex = canvasTex(1024, 576); screenPlane('board', boardTex); drawBoard('Agenda: nothing. Vibes: immaculate.');
}
function drawSlotScreen(g, sym, i) {
  g.fillStyle = '#07060c'; g.fillRect(0, 0, 256, 192);
  g.strokeStyle = i % 2 ? '#ff3d7f' : '#3de0ff'; g.lineWidth = 6; g.strokeRect(6, 6, 244, 180);
  g.font = '64px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  sym.forEach((s, k) => { g.fillStyle = '#f6f1e7'; g.fillRect(18 + k * 76, 36, 68, 120); g.fillStyle = '#111'; g.fillText(s, 52 + k * 76, 98); });
}
function drawCabinets(t) {
  for (const c of cabinets) {
    if (!c || (c.gm.play && snake.running)) continue;
    const g = c.tex.userData.ctx;
    g.fillStyle = '#04050a'; g.fillRect(0, 0, 256, 200);
    g.fillStyle = c.gm.color;
    for (let k = 0; k < 14; k++) { const y = (k * 37 + t * 60 * (1 + c.i * 0.2)) % 200; g.globalAlpha = 0.25; g.fillRect(0, y, 256, 2); }
    g.globalAlpha = 1; g.font = '800 26px Manrope, Arial'; g.textAlign = 'center'; g.fillText(c.gm.name, 128, 90);
    if (Math.floor(t * 2 + c.i) % 2) { g.font = '600 14px Manrope, Arial'; g.fillStyle = '#fff'; g.fillText(c.gm.play ? 'INSERT COIN' : 'OUT OF ORDER', 128, 130); }
    c.tex.needsUpdate = true;
  }
}
function drawBoard(text, who) {
  const g = boardTex.userData.ctx, Wd = 1024, H = 576;
  const grd = g.createLinearGradient(0, 0, Wd, H); grd.addColorStop(0, '#0e0d12'); grd.addColorStop(1, '#17130c');
  g.fillStyle = grd; g.fillRect(0, 0, Wd, H);
  g.fillStyle = '#d6b26e'; g.font = '600 22px Manrope, Arial'; g.fillText('THE VAULT · BOARDROOM', 60, 70);
  g.fillStyle = '#f1e9db'; g.font = '500 54px "Bodoni Moda", Georgia, serif';
  const words = String(text).split(' '); let line = '', y = 170;
  for (const w of words) { if (g.measureText(line + w).width > Wd - 120) { g.fillText(line, 60, y); line = ''; y += 66; } line += w + ' '; }
  g.fillText(line, 60, y);
  if (who) { g.fillStyle = '#a59d90'; g.font = '400 24px Manrope, Arial'; g.fillText('Posted by ' + who, 60, H - 50); }
  boardTex.needsUpdate = true;
}

// ---------------------------------------------------------------- cars
const cars = {};
async function loadCars() {
  const order = [...layout.cars].sort((a, b) => (a.slot === 'hero' ? -1 : b.slot === 'hero' ? 1 : 0));
  for (const c of order) {
    const g = await loadGLTF(`assets/cars/${c.model}.gltf.json`);
    progress('Rolling in the ' + (CAR_INFO[c.model]?.name || 'cars'));
    if (!g) continue;
    const car = g.scene;
    car.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        m.envMap = envGarage; m.envMapIntensity = 1.0;
        if (m.transparent && m.opacity > 0.9) m.opacity = 0.9;
      }
    });
    car.position.set(c.pos[0], c.pos[1], c.pos[2]);
    car.rotation.y = c.ry;
    scene.add(car);
    cars[c.slot] = { obj: car, ...c };
    if (c.slot === 'hero') hideLoading();
  }
}

// ---------------------------------------------------------------- interactions
function buildInteractions() {
  for (const it of layout.interact) {
    const [x, z] = it.pos;
    const k = it.kind;
    if (k === 'car') interact(x, z, it.r, () => 'Check out the ' + (CAR_INFO[layout.cars.find((c) => c.slot === it.slot)?.model]?.name || 'car'), () => openCar(it.slot));
    else if (k === 'tv') interact(x, z, it.r, () => 'Use the big screen', openTV);
    else if (k === 'sofa') interact(x, z, it.r, () => 'Use the big screen', openTV);
    else if (k === 'pool') interact(x, z, it.r, () => 'Rack up a game of pool', () => toast('Pool goes live in a later update. The table is level, though.'));
    else if (k === 'bar') interact(x, z, it.r, () => 'Order a drink', openBar);
    else if (k === 'poker') interact(x, z, it.r, () => "Sit at the poker table", () => toast('Poker needs two of you at the table. Multiplayer poker is next on the list.'));
    else if (k === 'blackjack') interact(x, z, it.r, () => 'Play blackjack', openBlackjack);
    else if (k === 'roulette') interact(x, z, it.r, () => 'Play roulette', openRoulette);
    else if (k === 'slot') interact(x, z, it.r, () => 'Play the slot machine', () => openSlots(slotScreens[it.idx]));
    else if (k === 'arcade') { const gm = ARCADE[it.idx]; interact(x, z, it.r, () => gm.play ? `Play ${gm.name}` : `${gm.name} (out of order)`, () => gm.play ? gm.play() : toast(`${gm.name} gets plugged in during a later update.`)); }
    else if (k === 'airhockey') interact(x, z, it.r, () => 'Air hockey', () => toast('Air hockey needs two players. Coming with multiplayer games.'));
    else if (k === 'board') interact(x, z, it.r, () => 'Put something on the boardroom screen', openBoard);
    else if (k === 'chess') interact(x, z, it.r, () => 'Play chess', () => toast('Chess with a friend arrives in a later update. The pieces are set up.'));
  }
}
function openCar(slot) {
  const c = layout.cars.find((x) => x.slot === slot); const info = CAR_INFO[c?.model]; if (!info) return;
  openPanel(`<div class="eyebrow">The Collection · ${slot === 'hero' ? 'Turntable' : 'Bay ' + slot.toUpperCase()}</div><h2>${info.name.replace(/(\S+)$/, '<em>$1</em>')}</h2>
    <div class="stat">${info.spec.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
    ${slot === 'hero' ? '<div class="row"><button class="primary" id="spinCar">Spin the turntable</button></div>' : ''}
    <p class="note">3D model by ${info.by} on Sketchfab, licensed CC BY 4.0. Display only, the keys are in the safe.</p>
    <div class="row"><button data-close>Close</button></div>`);
  const b = $('spinCar'); if (b) b.onclick = () => { turntable.spin = !turntable.spin; b.textContent = turntable.spin ? 'Stop the turntable' : 'Spin the turntable'; };
}
const turntable = { spin: false };
tickers.push((dt) => { const h = cars.hero; if (h && turntable.spin) h.obj.rotation.y += dt * 0.35; });
function openBar() {
  const drinks = ['an Old Fashioned', 'a Negroni', 'a 25-year single malt, neat', 'an espresso martini', 'a cold one'];
  openPanel(`<div class="eyebrow">The bar</div><h2>What are you <em>having?</em></h2>
    <div class="row">${drinks.map((d, i) => `<button data-d="${i}">${d.replace(/^an? /, '')}</button>`).join('')}</div>
    <div class="row"><button data-close>Never mind</button></div>`);
  $('panelCard').querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { broadcast(`ordered ${drinks[+b.dataset.d]} at the bar`); closePanel(); }));
}
function openBoard() {
  openPanel(`<div class="eyebrow">Boardroom</div><h2>Put it on the <em>screen</em></h2>
    <p>Everyone in the Vault sees it on the boardroom display.</p>
    <div class="row"><input type="text" id="boardIn" maxlength="120" placeholder="Agenda, a bet, a hot take"></div>
    <div class="row"><button class="primary" id="boardGo">Post</button><button data-close>Close</button></div>`);
  $('boardGo').onclick = () => {
    const t = $('boardIn').value.trim().slice(0, 120); if (!t) return;
    drawBoard(t, player.name);
    if (room?.connected()) room.emit('chat', { n: player.name, c: player.color, t, k: 'board' }).catch(() => {});
    closePanel();
  };
}

// ---------------------------------------------------------------- TV + music
const media = { audio: null, ctx: null, analyser: null, data: null, video: null, videoTex: null, srcNodes: new WeakMap(), playing: false, title: 'Zen Ball Drop' };
function drawTV(t) {
  if (media.video && !media.video.paused) return;
  const g = tvCanvasTex.userData.ctx, Wd = 1280, H = 720;
  const grd = g.createLinearGradient(0, 0, Wd, H); grd.addColorStop(0, '#120a24'); grd.addColorStop(1, '#05040a');
  g.fillStyle = grd; g.fillRect(0, 0, Wd, H);
  let bins = null;
  if (media.analyser && media.playing) { media.analyser.getByteFrequencyData(media.data); bins = media.data; }
  for (let i = 0; i < 64; i++) {
    const v = bins ? bins[Math.floor(i * 1.6) + 2] / 255 : 0.12 + 0.08 * Math.sin(t * 1.5 + i * 0.3);
    const h = v * 420;
    g.fillStyle = `hsl(${280 - i * 2.2},90%,${45 + v * 25}%)`;
    g.fillRect(90 + i * 17.5, 560 - h, 12, h);
    g.globalAlpha = 0.25; g.fillRect(90 + i * 17.5, 566, 12, h * 0.3); g.globalAlpha = 1;
  }
  g.fillStyle = '#d6b26e'; g.font = '600 26px Manrope, Arial'; g.fillText('NOW PLAYING', 90, 110);
  g.fillStyle = '#f1e9db'; g.font = '500 72px "Bodoni Moda", Georgia, serif'; g.fillText(media.playing ? media.title : 'Big screen idle', 90, 190);
  g.fillStyle = '#a59d90'; g.font = '400 26px Manrope, Arial'; g.fillText(media.playing ? 'Walk up and press E to change what is on' : 'Press E by the sofa to play music or a video', 90, 240);
  tvCanvasTex.needsUpdate = true;
}
function ensureAudioGraph(el) {
  if (!media.ctx) { media.ctx = new (window.AudioContext || window.webkitAudioContext)(); media.analyser = media.ctx.createAnalyser(); media.analyser.fftSize = 256; media.data = new Uint8Array(media.analyser.frequencyBinCount); media.analyser.connect(media.ctx.destination); }
  if (!media.srcNodes.has(el)) { const s = media.ctx.createMediaElementSource(el); s.connect(media.analyser); media.srcNodes.set(el, s); }
  media.ctx.resume?.();
}
function playDefaultTrack() {
  stopVideo();
  if (!media.audio) { media.audio = new Audio('assets/zen-ball-drop.mp3'); media.audio.loop = true; media.audio.crossOrigin = 'anonymous'; }
  ensureAudioGraph(media.audio);
  media.audio.play().then(() => { media.playing = true; media.title = 'Zen Ball Drop'; }).catch(() => {});
}
function stopAll() { media.audio?.pause(); stopVideo(); media.playing = false; }
function stopVideo() {
  if (media.video) { media.video.pause(); media.video.src = ''; media.video = null; }
  if (tvMat) { tvMat.map = tvCanvasTex; tvMat.needsUpdate = true; }
}
function playFile(file) {
  media.audio?.pause(); stopVideo();
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video');
  const el = document.createElement(isVideo ? 'video' : 'audio');
  el.src = url; el.loop = true; el.playsInline = true;
  ensureAudioGraph(el);
  el.play().then(() => {
    media.playing = true; media.title = file.name.replace(/\.[^.]+$/, '').slice(0, 34);
    if (isVideo) {
      media.video = el; media.videoTex = new THREE.VideoTexture(el); media.videoTex.colorSpace = THREE.SRGBColorSpace;
      tvMat.map = media.videoTex; tvMat.needsUpdate = true;
    } else { media.audio = el; }
  }).catch(() => toast('That file would not play in this browser.'));
}
function openTV() {
  openPanel(`<div class="eyebrow">Big screen</div><h2>What's <em>on?</em></h2>
    <p>Music plays through the room and gets quieter as you walk away from the lounge.</p>
    <div class="row"><button class="primary" id="tvDefault">Play "Zen Ball Drop"</button><button id="tvStop">Stop</button></div>
    <div class="lbl">From your computer</div>
    <div class="row"><input type="file" id="tvFile" accept="audio/*,video/*"></div>
    <p class="note">YouTube can't be embedded inside this Claude page, so the screen plays music and video files for now. Once the Vault runs on its own web address, the screen can stream YouTube for everyone in sync.</p>
    <div class="row"><button data-close>Close</button></div>`);
  $('tvDefault').onclick = () => { playDefaultTrack(); closePanel(); };
  $('tvStop').onclick = () => { stopAll(); closePanel(); };
  $('tvFile').onchange = (e) => { const f = e.target.files[0]; if (f) { playFile(f); closePanel(); } };
}

// ---------------------------------------------------------------- player + avatars
const player = { pos: new THREE.Vector3(-2, 0, 6), vel: new THREE.Vector3(), ry: Math.PI * 0.5, anim: 0, name: 'Guest', color: COLORS[0] };
let avatarSrc = null, me = null, AV_FWD = 0;
const remotes = new Map();
const blobTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(0,0,0,0.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
function makeAvatar(color, name) {
  const root = new THREE.Group();
  let mixer = null; const actions = {};
  if (avatarSrc) {
    const m = SkeletonUtils.clone(avatarSrc.scene);
    m.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.material = o.material.clone(); o.material.envMapIntensity = 0.9; } });
    root.add(m);
    mixer = new THREE.AnimationMixer(m);
    for (const clip of avatarSrc.animations) actions[clip.name] = mixer.clipAction(clip);
    ['Idle', 'Walk', 'Run'].forEach((n) => { if (actions[n]) { actions[n].play(); actions[n].setEffectiveWeight(n === 'Idle' ? 1 : 0); } });
  } else {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 6, 12), new THREE.MeshStandardMaterial({ color })); b.position.y = 0.85; root.add(b);
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; root.add(blob);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.46, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, opacity: 0.7, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.016; root.add(ring);
  const tag = makeTag(name, color); tag.position.y = 2.1; root.add(tag);
  scene.add(root);
  return { root, mixer, actions, ring, tag, weights: [1, 0, 0], setName(n, c) { root.remove(this.tag); this.tag = makeTag(n, c); this.tag.position.y = 2.1; root.add(this.tag); this.ring.material.color.set(c).multiplyScalar(1.4); } };
}
function makeTag(name, color) {
  const t = canvasTex(256, 64, (g, Wd) => {
    g.font = '700 30px Manrope, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(name).width + 34; g.fillStyle = 'rgba(10,9,8,0.72)'; g.fillRect((Wd - w) / 2, 8, w, 48);
    g.fillStyle = color; g.fillRect((Wd - w) / 2, 8, 4, 48); g.fillStyle = '#f1e9db'; g.fillText(name, Wd / 2 + 2, 33);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true, toneMapped: false }));
  s.scale.set(1.2, 0.3, 1); return s;
}
function animateAvatar(av, anim, dt) {
  if (!av.mixer) return;
  const target = [anim === 0 ? 1 : 0, anim === 1 ? 1 : 0, anim === 2 ? 1 : 0];
  ['Idle', 'Walk', 'Run'].forEach((n, i) => { av.weights[i] += (target[i] - av.weights[i]) * Math.min(1, dt * 8); av.actions[n]?.setEffectiveWeight(av.weights[i]); });
  av.mixer.update(dt);
}

// ---------------------------------------------------------------- input + camera
const keys = {};
let yaw = Math.PI * 0.5, pitch = 0.2, camDist = 3.4, locked = false, dragging = false, panelOpen = false, chatOpen = false, entered = false;
addEventListener('keydown', (e) => {
  if (chatOpen) { if (e.key === 'Escape') closeChat(); return; }
  if (panelOpen) { if (e.key === 'Escape') closePanel(); snake.key(e); return; }
  if (!entered) return;
  keys[e.code] = true;
  if (e.code === 'KeyE' && nearest) { e.preventDefault(); nearest.act(); }
  if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); openChat(); }
  if (e.code === 'Escape' && !locked) openMenu();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('click', () => { if (!panelOpen && entered && canvas.requestPointerLock) { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch {} } });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; $('crosshair').hidden = !locked; });
canvas.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!entered || panelOpen) return;
  if (locked || dragging) { yaw -= e.movementX * 0.0026; pitch = Math.max(-0.35, Math.min(1.15, pitch + e.movementY * 0.002)); }
});
canvas.addEventListener('wheel', (e) => { camDist = Math.max(1.4, Math.min(7, camDist + e.deltaY * 0.003)); }, { passive: true });
const touch = { move: null, look: null };
canvas.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) { if (t.clientX < innerWidth / 2) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 }; else touch.look = { id: t.identifier, x: t.clientX, y: t.clientY }; } }, { passive: true });
canvas.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) {
  if (touch.move?.id === t.identifier) { touch.move.dx = (t.clientX - touch.move.x) / 50; touch.move.dy = (t.clientY - touch.move.y) / 50; }
  if (touch.look?.id === t.identifier) { yaw -= (t.clientX - touch.look.x) * 0.005; pitch = Math.max(-0.35, Math.min(1.15, pitch + (t.clientY - touch.look.y) * 0.004)); touch.look.x = t.clientX; touch.look.y = t.clientY; }
} }, { passive: true });
canvas.addEventListener('touchend', (e) => { for (const t of e.changedTouches) { if (touch.move?.id === t.identifier) { if (Math.hypot(touch.move.dx, touch.move.dy) < 0.1 && nearest) nearest.act(); touch.move = null; } if (touch.look?.id === t.identifier) touch.look = null; } });

function collide(p, r = 0.33) {
  for (const c of colliders) {
    const cx = Math.max(c.x0, Math.min(p.x, c.x1)), cz = Math.max(c.z0, Math.min(p.z, c.z1));
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
      else {
        const o = [[p.x - c.x0, -1, 0], [c.x1 - p.x, 1, 0], [p.z - c.z0, 0, -1], [c.z1 - p.z, 0, 1]].sort((a, b) => a[0] - b[0])[0];
        p.x += o[1] * (o[0] + r); p.z += o[2] * (o[0] + r);
      }
    }
  }
}

let nearest = null;
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _want = new THREE.Vector3(), _cam = new THREE.Vector3(), _tgt = new THREE.Vector3();
function updatePlayer(dt) {
  let mx = 0, mz = 0;
  if (!panelOpen && !chatOpen) {
    if (keys.KeyW || keys.ArrowUp) mz += 1; if (keys.KeyS || keys.ArrowDown) mz -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (touch.move) { mx += Math.max(-1, Math.min(1, touch.move.dx)); mz -= Math.max(-1, Math.min(1, touch.move.dy)); }
  }
  const run = keys.ShiftLeft || keys.ShiftRight || (touch.move && Math.hypot(touch.move.dx, touch.move.dy) > 1.4);
  const len = Math.hypot(mx, mz);
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  const speed = run ? 5.0 : 1.8;
  _want.set(0, 0, 0);
  if (len > 0.05) _want.addScaledVector(_fwd, mz / Math.max(1, len)).addScaledVector(_right, mx / Math.max(1, len)).multiplyScalar(speed);
  player.vel.lerp(_want, Math.min(1, dt * 10));
  player.pos.addScaledVector(player.vel, dt);
  collide(player.pos);
  const sp = player.vel.length();
  if (sp > 0.2) { const target = Math.atan2(player.vel.x, player.vel.z); let d = target - player.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); player.ry += d * Math.min(1, dt * 12); }
  player.anim = sp < 0.3 ? 0 : sp < 3.0 ? 1 : 2;
  if (me) { me.root.position.copy(player.pos); me.root.rotation.y = player.ry + AV_FWD; animateAvatar(me, player.anim, dt); if (me.mixer && player.anim === 1) me.actions.Walk.timeScale = sp / 1.6; }

  _tgt.copy(player.pos).y += 1.55;
  _cam.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(camDist).add(_tgt).addScaledVector(_right, 0.42);
  _cam.x = Math.max(-HALL.x + 0.35, Math.min(HALL.x - 0.35, _cam.x)); _cam.z = Math.max(-HALL.z + 0.35, Math.min(HALL.z - 0.35, _cam.z)); _cam.y = Math.max(0.35, Math.min(HALL.h - 0.5, _cam.y));
  camera.position.lerp(_cam, Math.min(1, dt * 14));
  camera.lookAt(_tgt.addScaledVector(_right, 0.42));

  nearest = null; let best = 1e9;
  for (const it of interactables) { const d = Math.hypot(it.pos.x - player.pos.x, it.pos.z - player.pos.z); if (d < it.r && d < best) { best = d; nearest = it; } }
  const pr = $('prompt');
  if (nearest && !panelOpen && entered) { pr.innerHTML = `<kbd>E</kbd>${nearest.label()}`; pr.hidden = false; } else pr.hidden = true;
  $('zone').textContent = zoneAt(player.pos);
}
function zoneAt(p) {
  if (p.x < -8.5) return 'Garage';
  if (p.x > 16.5 && p.z < -4.5) return 'Boardroom';
  if (p.x > 8 && p.z < -2) return 'Arcade';
  if (p.x > 8) return 'Casino';
  if (p.z > 11) return 'Bar';
  return 'Lounge';
}

// ---------------------------------------------------------------- chips + UI panels
let chips = store.get('chips', 10000);
function setChips(v) { chips = Math.max(0, Math.round(v)); store.set('chips', chips); $('chips').textContent = chips.toLocaleString(); presence({ ch: chips }); if (chips === 0) { setTimeout(() => { toast('The house spots you 5,000 chips. Pace yourself.'); setChips(5000); }, 1500); } }
function openPanel(html) {
  $('panelCard').innerHTML = html; $('mPanel').hidden = false; panelOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
  $('panelCard').querySelectorAll('[data-close]').forEach((b) => (b.onclick = closePanel));
  for (const k in keys) keys[k] = false;
}
function closePanel() { $('mPanel').hidden = true; panelOpen = false; snake.stop(); canvas.focus(); }
$('mPanel').addEventListener('mousedown', (e) => { if (e.target.id === 'mPanel') closePanel(); });
function toast(msg) { addChat(null, msg, true); }
let masterVol = store.get('vol', 0.8);
function openMenu() {
  openPanel(`<div class="eyebrow">Paused</div><h2>The <em>Vault</em></h2>
    <div class="lbl">Graphics</div>
    <div class="row"><select id="qSel2">${Object.keys(QUALITY).map((q) => `<option value="${q}" ${q === quality ? 'selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}</select></div>
    <div class="lbl">Music volume</div><div class="row"><input id="vol" type="range" min="0" max="1" step="0.05" value="${masterVol}" style="flex:1"></div>
    <p class="note">Chips live in this browser only. Everyone online right now is listed top left.</p>
    <div class="row"><button class="primary" data-close>Back inside</button><button id="credBtn">Credits</button></div>`);
  $('qSel2').onchange = (e) => { quality = e.target.value; store.set('quality', quality); dprScale = 1; setupPipeline(); };
  $('vol').oninput = (e) => { masterVol = +e.target.value; store.set('vol', masterVol); };
  $('credBtn').onclick = openCredits;
}
function openCredits() {
  const rows = Object.values(CAR_INFO).map((c) => `<div>${c.name}: <a href="${c.url}" target="_blank" rel="noopener" style="color:var(--gold)">${c.by}</a>, CC BY 4.0</div>`).join('');
  openPanel(`<div class="eyebrow">Credits</div><h2>Made <em>with</em></h2>
    <p style="font-size:13px;line-height:1.7">${rows}</p>
    <p class="note">Furniture, textures: Poly Haven and ambientCG (CC0). Character: Mixamo via three.js. Lighting baked in Blender Cycles.</p>
    <div class="row"><button data-close>Close</button></div>`);
}

// slots
const SYMS = [['🍒', 30, 3], ['🍋', 24, 5], ['🔔', 16, 10], ['🃏', 10, 15], ['7️⃣', 6, 25], ['💎', 4, 50]];
function spinSym() { const tot = SYMS.reduce((a, s) => a + s[1], 0); let r = Math.random() * tot; for (const s of SYMS) { if ((r -= s[1]) < 0) return s; } return SYMS[0]; }
function openSlots(machine) {
  openPanel(`<div class="eyebrow">Slot machine</div><h2>Diamond <em>Deluxe</em></h2>
    <div class="reels"><div class="reel" id="r0">7️⃣</div><div class="reel" id="r1">💎</div><div class="reel" id="r2">🍒</div></div>
    <div class="result" id="slotRes">Three of a kind pays up to 50x</div>
    <div class="row"><select id="slotBet"><option>100</option><option>250</option><option selected>500</option><option>1000</option><option>5000</option></select><button class="primary" id="spin">Spin</button><button data-close>Leave</button></div>
    <p class="note">💎 50x · 7️⃣ 25x · 🃏 15x · 🔔 10x · 🍋 5x · 🍒 3x · any two 🍒 gets your bet back</p>`);
  let busy = false;
  $('spin').onclick = () => {
    if (busy) return; const bet = +$('slotBet').value; if (bet > chips) { $('slotRes').textContent = 'Not enough chips for that bet'; return; }
    busy = true; setChips(chips - bet); $('spin').disabled = true;
    const res = [spinSym(), spinSym(), spinSym()]; let ticks = 0;
    const iv = setInterval(() => {
      ticks++;
      const shown = [0, 1, 2].map((k) => (ticks > 8 + k * 5 ? res[k][0] : SYMS[Math.floor(Math.random() * SYMS.length)][0]));
      shown.forEach((s, k) => { const el = $('r' + k); if (el) el.textContent = s; });
      if (machine) { drawSlotScreen(machine.tex.userData.ctx, shown, machine.idx); machine.tex.needsUpdate = true; }
      if (ticks > 18) {
        clearInterval(iv); busy = false; if ($('spin')) $('spin').disabled = false;
        let win = 0;
        if (res[0][0] === res[1][0] && res[1][0] === res[2][0]) win = bet * res[0][2];
        else if (res.filter((s) => s[0] === '🍒').length === 2) win = bet;
        if (win) setChips(chips + win);
        if ($('slotRes')) $('slotRes').textContent = win ? `Won ${win.toLocaleString()} chips` : 'No luck. Again?';
        if (win >= bet * 10) broadcast(`hit ${res[0][0]}${res[0][0]}${res[0][0]} on the slots for ${win.toLocaleString()} chips`);
      }
    }, 70);
  };
}

// blackjack
function openBlackjack() {
  const suits = ['♠', '♥', '♦', '♣'], ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let deck = [], P = [], D = [], bet = 500, state = 'bet';
  const newDeck = () => { deck = []; for (let k = 0; k < 4; k++) for (const s of suits) for (const r of ranks) deck.push({ r, s }); for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } };
  const val = (h) => { let v = 0, a = 0; for (const c of h) { if (c.r === 'A') { a++; v += 11; } else v += ['J', 'Q', 'K'].includes(c.r) ? 10 : +c.r; } while (v > 21 && a) { v -= 10; a--; } return v; };
  const card = (c, hide) => hide ? '<div class="pc back"></div>' : `<div class="pc ${c.s === '♥' || c.s === '♦' ? 'red' : ''}"><span>${c.r}${c.s}</span><span>${c.r}${c.s}</span></div>`;
  const render = (msg = '') => {
    $('panelCard').innerHTML = `<div class="eyebrow">Blackjack · dealer stands on 17</div><h2>Twenty <em>One</em></h2>
      <div class="lbl">Dealer ${state === 'play' ? '' : D.length ? '· ' + val(D) : ''}</div><div class="hand">${D.map((c, i) => card(c, state === 'play' && i === 1)).join('')}</div>
      <div class="lbl">You ${P.length ? '· ' + val(P) : ''}</div><div class="hand">${P.map((c) => card(c)).join('')}</div>
      <div class="result">${msg}</div>
      <div class="row">${state === 'play' ? '<button class="primary" id="hit">Hit</button><button id="stand">Stand</button><button id="dbl">Double</button>' :
        `<select id="bjBet">${[100, 500, 1000, 2500, 5000].map((b) => `<option ${b === bet ? 'selected' : ''}>${b}</option>`).join('')}</select><button class="primary" id="deal">Deal</button>`}<button data-close>Leave table</button></div>`;
    $('panelCard').querySelectorAll('[data-close]').forEach((b) => (b.onclick = closePanel));
    if (state === 'play') { $('hit').onclick = hit; $('stand').onclick = stand; $('dbl').onclick = dbl; $('dbl').disabled = P.length !== 2 || chips < bet; }
    else $('deal').onclick = deal;
  };
  const deal = () => {
    bet = +$('bjBet').value; if (bet > chips) return render('Not enough chips for that bet');
    if (deck.length < 30) newDeck(); setChips(chips - bet);
    P = [deck.pop(), deck.pop()]; D = [deck.pop(), deck.pop()]; state = 'play';
    if (val(P) === 21) return finish(); render();
  };
  const hit = () => { P.push(deck.pop()); if (val(P) > 21) return finish(); render(); };
  const dbl = () => { setChips(chips - bet); bet *= 2; P.push(deck.pop()); finish(); };
  const stand = () => finish();
  const finish = () => {
    state = 'done';
    const pv = val(P); let msg, win = 0;
    if (pv > 21) msg = 'Bust. House takes it.';
    else if (pv === 21 && P.length === 2) { win = Math.round(bet * 2.5); msg = `Blackjack! +${(win - bet).toLocaleString()}`; }
    else {
      while (val(D) < 17) D.push(deck.pop());
      const dv = val(D);
      if (dv > 21 || pv > dv) { win = bet * 2; msg = `You win ${bet.toLocaleString()}`; } else if (pv === dv) { win = bet; msg = 'Push. Bet returned.'; } else msg = 'Dealer wins.';
    }
    if (win) setChips(chips + win);
    if (win - bet >= 5000) broadcast(`took the blackjack table for ${(win - bet).toLocaleString()} chips`);
    render(msg);
  };
  newDeck(); openPanel('<div></div>'); render('Place a bet');
}

// roulette
function openRoulette() {
  const reds = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  let pick = 'red';
  const opts = [['red', 'Red'], ['black', 'Black'], ['odd', 'Odd'], ['even', 'Even'], ['low', '1-18'], ['high', '19-36']];
  openPanel(`<div class="eyebrow">European roulette · single zero</div><h2>Rou<em>lette</em></h2>
    <div id="rwheel">--</div><div class="result" id="rRes">Pick a bet. Numbers pay 35 to 1.</div>
    <div class="row">${opts.map(([k, l]) => `<button data-b="${k}" class="${k === 'red' ? 'sel' : ''}">${l}</button>`).join('')}</div>
    <div class="rgrid">${Array.from({ length: 37 }, (_, n) => `<button data-b="${n}" class="${n === 0 ? 'g' : reds.has(n) ? 'r' : 'k'}">${n}</button>`).join('')}</div>
    <div class="row"><select id="rBet"><option>100</option><option selected>500</option><option>1000</option><option>5000</option></select><button class="primary" id="rSpin">Spin</button><button data-close>Leave</button></div>`);
  $('panelCard').querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => { pick = b.dataset.b; $('panelCard').querySelectorAll('[data-b]').forEach((x) => x.classList.toggle('sel', x === b)); }));
  $('rSpin').onclick = () => {
    const bet = +$('rBet').value; if (bet > chips) { $('rRes').textContent = 'Not enough chips'; return; }
    setChips(chips - bet); $('rSpin').disabled = true;
    const n = Math.floor(Math.random() * 37); let t = 0;
    const iv = setInterval(() => {
      t++; if ($('rwheel')) $('rwheel').textContent = t < 25 ? Math.floor(Math.random() * 37) : n;
      if (t >= 25) {
        clearInterval(iv);
        const col = n === 0 ? 'green' : reds.has(n) ? 'red' : 'black';
        let mult = 0;
        if (/^\d+$/.test(pick)) mult = +pick === n ? 36 : 0;
        else if (n !== 0) mult = ({ red: col === 'red', black: col === 'black', odd: n % 2 === 1, even: n % 2 === 0, low: n <= 18, high: n >= 19 })[pick] ? 2 : 0;
        if (mult) setChips(chips + bet * mult);
        if ($('rRes')) { $('rRes').textContent = `${n} ${col}. ${mult ? 'You win ' + (bet * (mult - 1)).toLocaleString() : 'House wins.'}`; $('rSpin').disabled = false; }
        if (mult === 36) broadcast(`hit ${n} straight up on roulette for ${(bet * 35).toLocaleString()}`);
      }
    }, 80);
  };
}

// snake
const snake = {
  running: false, iv: null, dir: [1, 0], next: [1, 0],
  key(e) {
    if (!this.running) return;
    const m = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] }[e.code];
    if (m && (m[0] !== -this.dir[0] || m[1] !== -this.dir[1])) { this.next = m; e.preventDefault(); }
  },
  stop() { clearInterval(this.iv); this.running = false; },
};
function openSnake() {
  openPanel(`<div class="eyebrow">Arcade · Neon Snake</div><h2>Neon <em>Snake</em></h2>
    <canvas id="snakeCv" width="384" height="288"></canvas>
    <div class="result" id="snRes">Arrows or WASD. Every apple is worth 25 chips.</div>
    <div class="row"><button class="primary" id="snGo">Start</button><button data-close>Leave</button></div>`);
  const cv = $('snakeCv'), g = cv.getContext('2d'), C = 16, GW = 24, GH = 18;
  let body, apple, score;
  const cab = cabinets.find((c) => c?.gm.play);
  const placeApple = () => { do { apple = [Math.floor(Math.random() * GW), Math.floor(Math.random() * GH)]; } while (body.some((b) => b[0] === apple[0] && b[1] === apple[1])); };
  const draw = () => {
    g.fillStyle = '#05060a'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#ff3d7f'; g.fillRect(apple[0] * C + 3, apple[1] * C + 3, C - 6, C - 6);
    g.fillStyle = '#56d68b'; body.forEach((b, i) => { g.globalAlpha = 1 - i / (body.length + 6); g.fillRect(b[0] * C + 1, b[1] * C + 1, C - 2, C - 2); }); g.globalAlpha = 1;
    if (cab) { cab.tex.userData.ctx.drawImage(cv, 0, 0, 256, 200); cab.tex.needsUpdate = true; }
  };
  const start = () => {
    body = [[6, 9], [5, 9], [4, 9]]; snake.dir = [1, 0]; snake.next = [1, 0]; score = 0; placeApple(); snake.running = true; $('snGo').disabled = true;
    clearInterval(snake.iv);
    snake.iv = setInterval(() => {
      snake.dir = snake.next; const h = [body[0][0] + snake.dir[0], body[0][1] + snake.dir[1]];
      if (h[0] < 0 || h[1] < 0 || h[0] >= GW || h[1] >= GH || body.some((b) => b[0] === h[0] && b[1] === h[1])) {
        snake.stop(); const won = score * 25; if (won) setChips(chips + won);
        if ($('snRes')) { $('snRes').textContent = `Game over. ${score} apples, +${won} chips`; $('snGo').disabled = false; }
        if (score >= 20) broadcast(`ate ${score} apples on Neon Snake`);
        return;
      }
      body.unshift(h);
      if (h[0] === apple[0] && h[1] === apple[1]) { score++; placeApple(); if ($('snRes')) $('snRes').textContent = `Apples: ${score}`; } else body.pop();
      draw();
    }, 95);
    draw();
  };
  $('snGo').onclick = start;
}

// ---------------------------------------------------------------- chat + multiplayer
let room = null;
function addChat(name, text, sys, color) {
  const d = document.createElement('div');
  if (sys) { d.style.color = 'var(--gold)'; d.textContent = name ? `${name} ${text}` : text; }
  else { const b = document.createElement('b'); b.textContent = name + ': '; b.style.color = color || 'var(--gold)'; d.append(b, document.createTextNode(text)); }
  $('chatLog').append(d);
  while ($('chatLog').children.length > 8) $('chatLog').firstChild.remove();
  setTimeout(() => d.classList.add('old'), 12000);
}
function openChat() { chatOpen = true; const i = $('chatInput'); i.style.display = 'block'; i.focus(); if (document.pointerLockElement) document.exitPointerLock(); for (const k in keys) keys[k] = false; }
function closeChat() { chatOpen = false; const i = $('chatInput'); i.value = ''; i.style.display = 'none'; i.blur(); canvas.focus(); }
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const t = e.target.value.trim().slice(0, 160);
    if (t) { if (room?.connected()) room.emit('chat', { n: player.name, c: player.color, t }).catch(() => addChat(player.name, t, false, player.color)); else addChat(player.name, t, false, player.color); }
    closeChat(); e.stopPropagation();
  }
});
function broadcast(text) { if (room?.connected()) room.emit('chat', { n: player.name, c: player.color, t: text, sys: true }).catch(() => {}); else addChat(player.name, text, true); }
const presenceState = {};
let presTimer = 0;
function presence(patch) { Object.assign(presenceState, patch); if (room) room.presence(patch).catch(() => {}); }
async function connectRoom() {
  try { room = await window.claude?.use?.('room'); } catch { room = null; }
  if (!room) { renderPlayers(); return; }
  room.on('chat', (m) => {
    const d = m.data || {}; const n = String(d.n || 'Someone').slice(0, 18), t = String(d.t || '').slice(0, 160), c = /^#[0-9a-f]{6}$/i.test(d.c) ? d.c : null;
    if (d.k === 'board') { drawBoard(t, n); addChat(n, 'put something on the boardroom screen', true); return; }
    addChat(n, t, !!d.sys, c);
  });
  room.onPeers(() => syncRemotes());
  room.presence(presenceState).catch(() => {});
}
function syncRemotes() {
  if (!room) return;
  const seen = new Set();
  for (const p of room.peers()) {
    if (p.sameTab || p.kind !== 'viewer') continue;
    const s = p.presence || {}; if (!Array.isArray(s.p)) continue;
    seen.add(p.peer);
    const name = String(s.n || 'Guest').slice(0, 18), color = /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#f1e9db';
    let r = remotes.get(p.peer);
    if (!r) { r = { av: makeAvatar(color, name), name, color, target: new THREE.Vector3(), ry: 0, anim: 0, chips: 0 }; remotes.set(p.peer, r); r.av.root.position.set(+s.p[0] || 0, 0, +s.p[1] || 0); addChat(name, 'walked in', true); }
    if (r.name !== name || r.color !== color) { r.name = name; r.color = color; r.av.setName(name, color); }
    r.target.set(+s.p[0] || 0, 0, +s.p[1] || 0); r.ry = +s.p[2] || 0; r.anim = s.a | 0; r.chips = +s.ch || 0;
  }
  for (const [k, r] of remotes) if (!seen.has(k)) { scene.remove(r.av.root); remotes.delete(k); addChat(r.name, 'left', true); }
  renderPlayers();
}
function renderPlayers() {
  const rows = [[player.name + ' (you)', player.color, chips], ...[...remotes.values()].map((r) => [r.name, r.color, r.chips])].sort((a, b) => b[2] - a[2]);
  const el = $('players'); el.innerHTML = '';
  rows.forEach(([n, c, ch]) => { const d = document.createElement('div'); const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = c; const b = document.createElement('b'); b.textContent = n; d.append(dot, b, document.createTextNode(' · ' + Number(ch).toLocaleString())); el.append(d); });
}
function updateRemotes(dt) {
  for (const r of remotes.values()) {
    r.av.root.position.lerp(r.target, Math.min(1, dt * 8));
    let d = r.ry + AV_FWD - r.av.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); r.av.root.rotation.y += d * Math.min(1, dt * 10);
    animateAvatar(r.av, r.anim, dt);
  }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let frames = 0, fpsT = 0, slowFrames = 0, tvT = 0, cabT = 0;
let frameErr = 0;
function frame() {
  try { frame0(); } catch (e) { if (!frameErr++) { console.error(e); if (!loadingHidden) $('loadTxt').textContent = 'Render error: ' + (e?.message || e); } requestAnimationFrame(frame); }
}
function frame0() {
  window.__frames = (window.__frames || 0) + 1;
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  updatePlayer(dt); updateRemotes(dt);
  for (const f of tickers) f(dt, t);
  tvT += dt; if (tvT > 1 / 30) { tvT = 0; drawTV(t); }
  cabT += dt; if (cabT > 0.12) { cabT = 0; drawCabinets(t); }
  const el = media.video || media.audio;
  if (el) { const dist = Math.hypot(player.pos.x, player.pos.z + 9); el.volume = masterVol * Math.max(0.12, Math.min(1, 1.25 - dist / 30)); }
  presTimer += dt;
  if (presTimer > 1 / 15 && entered) { presTimer = 0; presence({ p: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2), +player.ry.toFixed(2)], a: player.anim }); }
  if (Q.bloom || Q.msaa) composer.render(); else renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 1) {
    const fps = frames / fpsT; $('fps').textContent = `${Math.round(fps)} fps · ${quality}`;
    if (fps < 42 && dprScale > 0.6 && !params.has('shot')) { if (++slowFrames >= 3) { dprScale -= 0.12; slowFrames = 0; resize(); } } else slowFrames = 0;
    frames = 0; fpsT = 0;
    renderPlayers();
  }
  requestAnimationFrame(frame);
}
function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr) * dprScale);
  renderer.setSize(innerWidth, innerHeight, false);
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  composer.setSize(s.x, s.y);
  if (reflector) reflector.getRenderTarget().setSize(Math.round(s.x * Q.reflect), Math.round(s.y * Q.reflect));
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- boot
let loadingHidden = false, started = false;
function hideLoading() {
  if (loadingHidden) return; loadingHidden = true;
  $('loading').hidden = true;
  showStart();
}
async function boot() {
  window.__vaultStarted = true; $('loadTxt').textContent = 'Starting engine';
  setupPipeline();
  $('loadTxt').textContent = 'Reading the floor plan';
  await loadWorld();
  window.__stage = 'loading avatar';
  const av = await loadGLTF('assets/Soldier.gltf.json');
  window.__stage = 'avatar loaded';
  if (av) { avatarSrc = av; AV_FWD = Math.PI; }
  me = makeAvatar(player.color, player.name); me.tag.visible = false;
  const sp = layout.spawn; player.pos.set(sp[0], 0, sp[2]); yaw = sp[3];
  drawTV(0);
  requestAnimationFrame(frame);
  connectRoom();
  window.__stage = 'showing start';
  hideLoading();
  await loadCars();
  hideLoading();
}
function showStart() {
  const sw = $('swatches'); sw.innerHTML = '';
  player.name = store.get('name', ''); player.color = store.get('color', COLORS[Math.floor(Math.random() * COLORS.length)]);
  $('nameIn').value = player.name; $('qualitySel').value = quality;
  COLORS.forEach((c) => { const b = document.createElement('button'); b.className = 'sw' + (c === player.color ? ' on' : ''); b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c); b.onclick = () => { player.color = c; sw.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === b)); }; sw.append(b); });
  $('mStart').hidden = false; panelOpen = true;
  $('enterBtn').onclick = () => {
    player.name = ($('nameIn').value.trim() || 'Guest').slice(0, 18); store.set('name', player.name); store.set('color', player.color);
    if ($('qualitySel').value !== quality) { quality = $('qualitySel').value; store.set('quality', quality); setupPipeline(); }
    me.setName(player.name, player.color); me.tag.visible = false;
    $('mStart').hidden = true; panelOpen = false; entered = true;
    presence({ n: player.name, c: player.color, ch: chips });
    setChips(chips);
    playDefaultTrack();
    addChat(null, 'Click to look around with the mouse. Walk up to anything glowing and press E.', true);
    canvas.focus();
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {}
  };
}
window.addEventListener('error', (e) => { if (!loadingHidden) $('loadTxt').textContent = 'Error: ' + e.message; });
window.addEventListener('unhandledrejection', (e) => { if (!loadingHidden) $('loadTxt').textContent = 'Error: ' + (e.reason?.message || e.reason); });
boot().catch((e) => { console.error(e); $('loadTxt').textContent = 'Load error: ' + (e?.message || e); });

// test hook for automated screenshots
window.__vault = { player, setView(x, z, y, p, d) { player.pos.set(x, 0, z); yaw = y; pitch = p; camDist = d ?? camDist; }, enter() { $('enterBtn').click(); }, get fps() { return $('fps').textContent; }, get ready() { return Object.keys(cars).length; } };
