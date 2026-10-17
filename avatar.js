// The Vault: avatar system. Xbot (Mixamo) rig + procedural look-alike skins, locomotion blending, emotes, customizer.
// Coordinates: the Xbot bind pose has identity bone rotations, so every bone frame is aligned with character space
// (Y up, facing +Z, character's right = -X). Attachments are authored in absolute rest-pose meters and re-based on a bone.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PI = Math.PI, TAU = PI * 2;
const P = 'mixamorig';
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { let s = seed | 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// piecewise-smooth keyframe curve: keys = [[t, v], ...]
function curve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, a] = keys[i - 1], [t1, b] = keys[i]; return lerp(a, b, sstep(t0, t1, t)); }
  return keys[keys.length - 1][1];
}

// ------------------------------------------------------------------------------------------------ skins
export const SKINS = [
  { id: 'velvet', name: 'Velvet Don', group: 'Originals' },
  { id: 'tux', name: 'Midnight Tux', group: 'Originals' },
  { id: 'street', name: 'Street King', group: 'Originals' },
  { id: 'gold', name: 'Gold Standard', group: 'Originals' },
  { id: 'track', name: 'Tracksuit Boss', group: 'Originals' },
  { id: 'bomber', name: 'Bomber Ace', group: 'Originals' },
  { id: 'spongebob', name: 'SpongeBob', group: 'Bikini Bottom' },
  { id: 'patrick', name: 'Patrick', group: 'Bikini Bottom' },
  { id: 'squidward', name: 'Squidward', group: 'Bikini Bottom' },
  { id: 'gojo', name: 'Satoru Gojo', group: 'Jujutsu' },
  { id: 'megumi', name: 'Megumi Fushiguro', group: 'Jujutsu' },
  { id: 'yuji', name: 'Yuji Itadori', group: 'Jujutsu' },
  { id: 'rick', name: 'Rick', group: 'Rick & Morty' },
  { id: 'morty', name: 'Morty', group: 'Rick & Morty' },
  { id: 'goku', name: 'Goku', group: 'Legends' },
  { id: 'goku_ssj', name: 'Super Saiyan', group: 'Legends' },
  { id: 'naruto', name: 'Naruto', group: 'Legends' },
  { id: 'saitama', name: 'Saitama', group: 'Legends' },
  { id: 'wick', name: 'John Wick', group: 'Legends' },
  { id: 'heisenberg', name: 'Heisenberg', group: 'Legends' },
];
// swatches shown in the customizer grid
const SWATCH = {
  velvet: ['#5a0f1e', '#0b0b0d'], tux: ['#101014', '#c9a24a'], street: ['#1d2433', '#2a2a2a'], gold: ['#ece4d4', '#c9a24a'],
  track: ['#0f3d2e', '#f1e9db'], bomber: ['#3b2a20', '#e8dcc6'], spongebob: ['#f4dc3a', '#8b5a2b'], patrick: ['#f49ab0', '#7fd35a'],
  squidward: ['#9fd0c4', '#8a6236'], gojo: ['#f4f6fb', '#14161f'], megumi: ['#101218', '#1a2030'], yuji: ['#f0a3a0', '#c3272f'],
  rick: ['#b9dde8', '#f4f4f0'], morty: ['#f5e04b', '#3e6fb5'], goku: ['#f2862d', '#1f4fa8'], goku_ssj: ['#ffd94a', '#f2862d'],
  naruto: ['#ffd23a', '#f57c1f'], saitama: ['#f6cc2e', '#d6262d'], wick: ['#15161a', '#f2f2f2'], heisenberg: ['#2b2b2b', '#6f6a4e'],
};
export const ACCESSORIES = [
  { id: 'sunglasses', name: 'Sunglasses' }, { id: 'chain', name: 'Gold chain' }, { id: 'cap', name: 'Cap' },
  { id: 'crown', name: 'Crown' }, { id: 'cigar', name: 'Cigar' }, { id: 'headphones', name: 'Headphones' },
];
export const EMOTES = ['drink', 'dance', 'wave', 'cheer', 'sit', 'facepalm', 'clap'];
const TONES = ['#f6d7c3', '#eac2a0', '#d29b74', '#a8704a', '#7a4b2f', '#4f3020'];
const HAIRS = ['slick', 'fade', 'curly', 'long', 'buzz', 'bald'];
const ORIGINAL_DEFAULTS = {
  velvet: { c1: '#5a0f1e', c2: '#0b0b0d', hair: 'slick', tone: 1 },
  tux: { c1: '#101014', c2: '#c9a24a', hair: 'fade', tone: 3 },
  street: { c1: '#1d2433', c2: '#2a2a2a', hair: 'fade', tone: 4 },
  gold: { c1: '#ece4d4', c2: '#c9a24a', hair: 'curly', tone: 2 },
  track: { c1: '#0f3d2e', c2: '#f1e9db', hair: 'buzz', tone: 0 },
  bomber: { c1: '#3b2a20', c2: '#e8dcc6', hair: 'long', tone: 1 },
};
export function defaultLook(skin = 'velvet') {
  const d = ORIGINAL_DEFAULTS[skin] || ORIGINAL_DEFAULTS.velvet;
  return { skin, c1: d.c1, c2: d.c2, hair: d.hair, hc: '#1b1410', tone: d.tone, acc: [], h: 1, tag: '#d6b26e' };
}
function normLook(look = {}) {
  const skin = SKINS.some((s) => s.id === look.skin) ? look.skin : 'velvet';
  const base = defaultLook(skin);
  const o = { ...base, ...look, skin };
  o.acc = Array.isArray(look.acc) ? look.acc.filter((a) => ACCESSORIES.some((x) => x.id === a)) : [];
  o.h = clamp(+o.h || 1, 0.9, 1.1);
  o.tone = clamp(Math.round(+o.tone || 0), 0, TONES.length - 1);
  if (!HAIRS.includes(o.hair)) o.hair = base.hair;
  for (const k of ['c1', 'c2', 'hc', 'tag']) if (!/^#[0-9a-f]{6}$/i.test(o[k] || '')) o[k] = base[k];
  return o;
}

// ------------------------------------------------------------------------------------------------ assets
let _assets = null, _loading = null;
export async function loadAvatarAssets(loader, base = 'assets/') {
  if (_assets) return _assets;
  if (_loading) return _loading;
  _loading = (async () => {
    loader = loader || new GLTFLoader();
    const [xb, mi] = await Promise.all([
      loader.loadAsync(base + 'Xbot.gltf.json'),
      loader.loadAsync(base + 'Michelle.gltf.json').catch((e) => { console.warn('avatar: Michelle failed', e); return null; }),
    ]);
    const restHips = xb.scene.getObjectByName(P + 'Hips').position.clone();
    const clips = {};
    for (const c of xb.animations) clips[c.name] = cleanClip(c, restHips, false);
    if (mi) { try { clips.dance = retargetDance(mi, xb, restHips); } catch (e) { console.warn('avatar: retarget failed', e); } }
    // per-vertex painting data
    const vdata = [];
    xb.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const g = o.geometry, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, n = g.attributes.position.count;
      const names = o.skeleton.bones.map((b) => b.name.replace(P, ''));
      const dom = new Uint8Array(n);
      for (let i = 0; i < n; i++) { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; bi = SI.getComponent(i, k); } } dom[i] = bi; }
      vdata.push({ name: o.name, names, zones: names.map(zoneOf), dom, pos: g.attributes.position });
    });
    const phase = {};
    for (const n of ['walk', 'run']) phase[n] = footPhase(xb.scene, clips[n]);
    _assets = { xbot: xb, clips, vdata, phase };
    return _assets;
  })();
  return _loading;
}
function zoneOf(n) {
  if (/^(Head|HeadTop_End|LeftEye|RightEye)$/.test(n)) return 'head';
  if (n === 'Neck') return 'neck';
  if (n === 'Spine') return 'waist';
  if (/^Spine[12]$/.test(n)) return 'chest';
  if (/Shoulder$/.test(n)) return 'shoulder';
  if (n === 'Hips') return 'hips';
  if (/ForeArm$/.test(n)) return 'farm';
  if (/Arm$/.test(n)) return 'uarm';
  if (/Hand/.test(n)) return 'hand';
  if (/UpLeg$/.test(n)) return 'thigh';
  if (/Leg$/.test(n)) return 'shin';
  if (/Foot|Toe/.test(n)) return 'foot';
  return 'chest';
}
// keep rotations + hips position; re-center hips x/z so idle/walk/run don't slide the body.
function cleanClip(clip, restHips, keepSway) {
  const tracks = [];
  for (const t of clip.tracks) {
    if (t.name.endsWith('.quaternion')) { tracks.push(t); continue; }
    if (t.name === P + 'Hips.position') {
      const v = t.values.slice(), n = v.length / 3;
      let mx = 0, mz = 0; for (let i = 0; i < n; i++) { mx += v[i * 3]; mz += v[i * 3 + 2]; } mx /= n; mz /= n;
      for (let i = 0; i < n; i++) {
        v[i * 3] = restHips.x + (keepSway ? clamp(v[i * 3] - mx, -18, 18) : 0);
        v[i * 3 + 2] = restHips.z + (keepSway ? clamp(v[i * 3 + 2] - mz, -18, 18) : 0);
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times, v));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
// World-space delta retarget (Michelle TPose -> Xbot T-pose rest, whose bones are all identity-rotated).
function retargetDance(mi, xb, restHips) {
  const src = mi.scene, tpose = mi.animations.find((c) => c.name === 'TPose'), samba = mi.animations.find((c) => /samba/i.test(c.name));
  if (!samba) return null;
  const sb = {}; src.traverse((o) => { if (o.isBone) sb[o.name] = o; });
  const xbones = []; xb.scene.traverse((o) => { if (o.isBone && sb[o.name]) xbones.push(o); });
  const mixer = new THREE.AnimationMixer(src);
  const ref = {}, q = new THREE.Quaternion();
  let a = tpose ? mixer.clipAction(tpose) : null;
  if (a) { a.play(); mixer.setTime(0); }
  src.updateMatrixWorld(true);
  for (const b of xbones) ref[b.name] = sb[b.name].getWorldQuaternion(new THREE.Quaternion()).invert();
  const hipRef = sb[P + 'Hips'].getWorldPosition(new THREE.Vector3());
  if (a) a.stop();
  a = mixer.clipAction(samba); a.play();
  const fps = 30, N = Math.floor(samba.duration * fps);
  const times = new Float32Array(N), qv = {}, pv = new Float32Array(N * 3);
  for (const b of xbones) qv[b.name] = new Float32Array(N * 4);
  const D = {}; for (const b of xbones) D[b.name] = new THREE.Quaternion();
  const hp = new THREE.Vector3(), k = 1.04 / Math.max(0.5, hipRef.y);
  for (let i = 0; i < N; i++) {
    const t = i / fps; times[i] = t; mixer.setTime(t); src.updateMatrixWorld(true);
    for (const b of xbones) D[b.name].copy(sb[b.name].getWorldQuaternion(q)).multiply(ref[b.name]);
    for (const b of xbones) {
      const par = D[b.parent?.name];
      const l = par ? q.copy(par).invert().multiply(D[b.name]) : q.copy(D[b.name]);
      const arr = qv[b.name];
      if (i > 0) { const j = (i - 1) * 4; if (arr[j] * l.x + arr[j + 1] * l.y + arr[j + 2] * l.z + arr[j + 3] * l.w < 0) { l.x = -l.x; l.y = -l.y; l.z = -l.z; l.w = -l.w; } }
      l.toArray(arr, i * 4);
    }
    sb[P + 'Hips'].getWorldPosition(hp).sub(hipRef).multiplyScalar(k * 100);
    pv[i * 3] = hp.x; pv[i * 3 + 1] = restHips.y + hp.y; pv[i * 3 + 2] = hp.z;
  }
  // remove linear drift so the loop does not wander
  const dx = (pv[(N - 1) * 3] - pv[0]) / (N - 1), dz = (pv[(N - 1) * 3 + 2] - pv[2]) / (N - 1);
  for (let i = 0; i < N; i++) { pv[i * 3] -= dx * i; pv[i * 3 + 2] -= dz * i; }
  const tracks = [new THREE.VectorKeyframeTrack(P + 'Hips.position', times, pv)];
  for (const b of xbones) tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, qv[b.name]));
  mixer.stopAllAction(); mixer.uncacheRoot(src);
  return cleanClip(new THREE.AnimationClip('dance', (N - 1) / fps, tracks), restHips, true);
}
// phase (0..1) at which the left foot is furthest forward, used to phase-lock walk and run.
function footPhase(scene, clip) {
  const s = SkeletonUtils.clone(scene), mixer = new THREE.AnimationMixer(s), foot = s.getObjectByName(P + 'LeftFoot');
  const a = mixer.clipAction(clip); a.play();
  let best = -1e9, bp = 0; const p = new THREE.Vector3();
  for (let i = 0; i < 48; i++) { mixer.setTime((clip.duration * i) / 48); s.updateMatrixWorld(true); foot.getWorldPosition(p); if (p.z > best) { best = p.z; bp = i / 48; } }
  mixer.stopAllAction(); mixer.uncacheRoot(s);
  return bp;
}

// ------------------------------------------------------------------------------------------------ shared textures
const _tex = {};
function canvasTex(key, w, h, draw) {
  if (_tex[key]) return _tex[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (_tex[key] = t);
}
const spongeTex = () => canvasTex('sponge', 512, 512, (g, w, h) => {
  g.fillStyle = '#f3dc3a'; g.fillRect(0, 0, w, h);
  const r = rng(7);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${200 + r() * 55 | 0},${170 + r() * 50 | 0},20,${0.08 + r() * 0.08})`; g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3); }
  const holes = [];
  for (let i = 0; i < 34; i++) {
    const rr = 10 + r() * 26, x = r() * w, y = r() * h;
    if (holes.some((o) => Math.hypot(o[0] - x, o[1] - y) < o[2] + rr + 8)) continue; holes.push([x, y, rr]);
    const ry = rr * (0.7 + r() * 0.35);
    g.save(); g.translate(x, y); g.rotate(r() * PI);
    g.fillStyle = '#c9b51d'; g.beginPath(); g.ellipse(2, 3, rr + 3, ry + 3, 0, 0, TAU); g.fill();
    const gr = g.createRadialGradient(-rr * 0.25, -ry * 0.3, 1, 0, 0, rr);
    gr.addColorStop(0, '#6d6a10'); gr.addColorStop(0.75, '#9a9416'); gr.addColorStop(1, '#b4a91a');
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, rr, ry, 0, 0, TAU); g.fill(); g.restore();
  }
});
const flowerTex = () => canvasTex('flowers', 512, 512, (g, w, h) => {
  g.fillStyle = '#86d35f'; g.fillRect(0, 0, w, h);
  const r = rng(3);
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, s = 18 + r() * 14;
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      g.save(); g.translate(x + ox, y + oy); g.rotate(r() * TAU); g.fillStyle = '#a66bd6';
      for (let k = 0; k < 5; k++) { g.rotate(TAU / 5); g.beginPath(); g.ellipse(0, s * 0.55, s * 0.32, s * 0.55, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#d9b8f2'; g.beginPath(); g.arc(0, 0, s * 0.25, 0, TAU); g.fill(); g.restore();
    }
  }
});
const leafTex = () => canvasTex('leaf', 256, 128, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e8ecf0'); gr.addColorStop(0.5, '#aeb6be'); gr.addColorStop(1, '#d6dce2');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#2b3036'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); for (let a = 0; a < TAU * 1.6; a += 0.1) { const rr = 4 + a * 7.5; const x = w / 2 + Math.cos(a) * rr, y = h / 2 + Math.sin(a) * rr; if (a === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke();
  g.beginPath(); g.moveTo(w / 2 + 58, h / 2 + 10); g.lineTo(w / 2 + 92, h / 2 - 34); g.lineTo(w / 2 + 60, h / 2 - 24); g.stroke();
  for (const x of [16, w - 16]) for (const y of [16, h - 16]) { g.fillStyle = '#6f777f'; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); }
});
const kameTex = () => canvasTex('kame', 128, 128, (g, w, h) => {
  g.fillStyle = '#f5efe2'; g.beginPath(); g.arc(64, 64, 62, 0, TAU); g.fill();
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 57, 0, TAU); g.stroke();
  g.fillStyle = '#111'; g.font = '700 78px "Hiragino Sans","Noto Sans CJK JP","Yu Gothic","MS Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('亀', 64, 68);
});
const glassTex = () => canvasTex('label', 256, 128, (g, w, h) => {
  g.fillStyle = '#f1e6c8'; g.fillRect(0, 0, w, h); g.fillStyle = '#8c1d1d'; g.fillRect(0, 18, w, 22); g.fillRect(0, h - 40, w, 22);
  g.fillStyle = '#2a1a10'; g.font = '700 34px Georgia,serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('VAULT', w / 2, h / 2);
});

// ------------------------------------------------------------------------------------------------ geometry helpers
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function place(g, { p = [0, 0, 0], r = null, s = null, q = null } = {}) {
  const quat = q ? q.clone() : r ? new THREE.Quaternion().setFromEuler(_e.set(r[0], r[1], r[2])) : new THREE.Quaternion();
  const sc = s == null ? v3(1, 1, 1) : typeof s === 'number' ? v3(s, s, s) : v3(s[0], s[1], s[2]);
  g.applyMatrix4(_m4.compose(v3(p[0], p[1], p[2]), quat, sc));
  return g;
}
// quaternion mapping local +Y to dir, local +X towards side (projected)
function basisQ(dir, side = v3(1, 0, 0)) {
  const y = dir.clone().normalize();
  let x = side.clone().sub(y.clone().multiplyScalar(side.dot(y)));
  if (x.lengthSq() < 1e-6) x = Math.abs(y.x) < 0.9 ? v3(1, 0, 0) : v3(0, 0, 1);
  x.normalize(); const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const sphere = (r = 1, ws = 32, hs = 24) => new THREE.SphereGeometry(r, ws, hs);
function ellipsoid(c, rad, seg = 32) { return place(sphere(1, seg, Math.round(seg * 0.75)), { p: c, s: rad }); }
// tapered spike along +Y from 0 to len, optional bend (+X) and flattening (Z)
function spikeGeo(len, r, { bend = 0, flat = 1, seg = 10, rings = 7, pow = 1.1 } = {}) {
  const pts = [new THREE.Vector2(0.0001, -r * 0.6)];
  pts.push(new THREE.Vector2(r * 0.85, -r * 0.3));
  for (let i = 0; i <= rings; i++) { const t = i / rings; pts.push(new THREE.Vector2(Math.max(0.0006, r * Math.pow(1 - t, pow) * (1 + 0.15 * Math.sin(t * PI))), t * len)); }
  const g = new THREE.LatheGeometry(pts, seg);
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) { const y = a.getY(i), t = clamp(y / len, 0, 1); a.setX(i, a.getX(i) + bend * len * t * t); a.setZ(i, a.getZ(i) * flat); }
  g.computeVertexNormals();
  return g;
}
function capsuleBetween(a, b, r, seg = 12) {
  const A = v3(...a), B = v3(...b), d = B.clone().sub(A), L = d.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, L), 6, seg);
  return place(g, { p: A.clone().add(B).multiplyScalar(0.5).toArray(), q: basisQ(d) });
}
function taperBetween(a, b, r0, r1, seg = 16) {
  const A = v3(...a), B = v3(...b), d = B.clone().sub(A), L = d.length();
  const pts = [new THREE.Vector2(0.0001, -r0 * 0.9)];
  for (let i = 0; i <= 6; i++) { const t = i / 6, ang = -PI / 2 + (t * PI) / 2; pts.push(new THREE.Vector2(r0 * Math.cos(ang), r0 * Math.sin(ang) * 0.9)); }
  for (let i = 1; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector2(lerp(r0, r1, t), t * L)); }
  for (let i = 1; i <= 6; i++) { const ang = (i / 6) * (PI / 2); pts.push(new THREE.Vector2(Math.max(0.0001, r1 * Math.cos(ang)), L + r1 * Math.sin(ang) * 0.9)); }
  const g = new THREE.LatheGeometry(pts, seg); g.computeVertexNormals();
  return place(g, { p: a, q: basisQ(d) });
}
function tube(points, r, seg = 24, rs = 8, closed = false) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => v3(...p)), closed);
  return new THREE.TubeGeometry(c, seg, r, rs, closed);
}
// flat ribbon (double sided) along a polyline with per-point half width, normal ~ +Z
function ribbon(pts, widths, dz = 0.0035) {
  const pos = [], idx = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = pts[i], w = widths[i];
    pos.push(x - w, y, z, x + w, y, z, x - w, y, z - dz, x + w, y, z - dz);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 4, b = (i + 1) * 4;
    idx.push(a, b, a + 1, a + 1, b, b + 1); // front
    idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // back
    idx.push(a, a + 2, b, b, a + 2, b + 2, a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); // edges
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function bandGeo(rTop, rBot, h, thick = 0.008, seg = 40, thetaStart = 0, thetaLen = TAU) {
  const outer = new THREE.CylinderGeometry(rTop + thick, rBot + thick, h, seg, 1, true, thetaStart, thetaLen);
  const inner = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, true, thetaStart, thetaLen);
  const ia = inner.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i]; ia[i] = ia[i + 2]; ia[i + 2] = t; }
  const na = inner.attributes.normal; for (let i = 0; i < na.count; i++) na.setXYZ(i, -na.getX(i), -na.getY(i), -na.getZ(i));
  return mergeGeometries([outer, inner]);
}
function roundBox(w, h, d, r = 0.02, seg = 3) { return new RoundedBoxGeometry(w, h, d, seg, r); }
function extrudeShape(shape, depth, bevel = 0.003) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 16 });
  g.translate(0, 0, -depth / 2); return g;
}

// ---- stylised body: skinned garment shells (rest pose, meters). Torso profile rows: [y, halfWidth, frontZ, backZ]
const TP = [[0.88, 0.168, 0.1, -0.125], [0.94, 0.176, 0.11, -0.132], [1.0, 0.174, 0.112, -0.132], [1.07, 0.162, 0.108, -0.122], [1.14, 0.152, 0.113, -0.113],
  [1.22, 0.158, 0.128, -0.112], [1.3, 0.168, 0.142, -0.118], [1.38, 0.178, 0.134, -0.128], [1.44, 0.185, 0.112, -0.134], [1.49, 0.18, 0.082, -0.126],
  [1.525, 0.13, 0.055, -0.098], [1.55, 0.075, 0.035, -0.07], [1.565, 0.05, 0.022, -0.055]];
// arm rows (left side; mirrored): [x, cy, cz, ry, rz]
const AP = [[0.1, 1.44, -0.05, 0.07, 0.068], [0.16, 1.44, -0.053, 0.066, 0.063], [0.22, 1.437, -0.055, 0.06, 0.058], [0.3, 1.437, -0.055, 0.052, 0.052], [0.36, 1.437, -0.055, 0.047, 0.048],
  [0.43, 1.438, -0.053, 0.051, 0.051], [0.5, 1.441, -0.05, 0.049, 0.049], [0.58, 1.445, -0.047, 0.041, 0.046], [0.65, 1.445, -0.047, 0.037, 0.043], [0.705, 1.443, -0.05, 0.036, 0.042]];
// leg rows (left side; mirrored): [y, cx, cz, rx, rz]
const LP = [[1.03, 0.09, 0, 0.092, 0.105], [0.95, 0.095, 0.005, 0.093, 0.102], [0.86, 0.097, 0.01, 0.088, 0.094], [0.76, 0.095, 0.015, 0.079, 0.084], [0.66, 0.09, 0.018, 0.068, 0.072],
  [0.56, 0.087, 0.012, 0.062, 0.068], [0.5, 0.086, 0.006, 0.06, 0.066], [0.42, 0.084, -0.006, 0.062, 0.07], [0.34, 0.081, -0.013, 0.054, 0.06], [0.26, 0.078, -0.018, 0.045, 0.05],
  [0.18, 0.077, -0.022, 0.041, 0.045], [0.1, 0.077, -0.025, 0.042, 0.046]];
const SE = 2.6; // torso superellipse exponent
function prof(table, key) { // Catmull-Rom interpolation over rows sorted by row[0] (asc or desc)
  const asc = table[0][0] < table[table.length - 1][0];
  const T = asc ? table : [...table].reverse();
  key = clamp(key, T[0][0], T[T.length - 1][0]);
  let i = 0; while (i < T.length - 2 && T[i + 1][0] < key) i++;
  const p0 = T[Math.max(0, i - 1)], p1 = T[i], p2 = T[i + 1], p3 = T[Math.min(T.length - 1, i + 2)];
  const t = (key - p1[0]) / (p2[0] - p1[0] || 1), out = [key];
  for (let k = 1; k < p1.length; k++) {
    const m1 = (p2[k] - p0[k]) / ((p2[0] - p0[0]) || 1) * (p2[0] - p1[0]), m2 = (p3[k] - p1[k]) / ((p3[0] - p1[0]) || 1) * (p2[0] - p1[0]);
    const t2 = t * t, t3 = t2 * t;
    out.push((2 * t3 - 3 * t2 + 1) * p1[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[k] + (t3 - t2) * m2);
  }
  return out;
}
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
function chestZ(x, y, off = 0.006) {
  const [, W, F, B] = prof(TP, y), zc = (F + B) / 2, D = (F - B) / 2, u = Math.min(1, Math.abs(x) / W);
  return zc + D * Math.pow(Math.max(0, 1 - Math.pow(u, SE)), 1 / SE) + off;
}
function backZ(x, y, off = 0.006) {
  const [, W, F, B] = prof(TP, y), zc = (F + B) / 2, D = (F - B) / 2, u = Math.min(1, Math.abs(x) / W);
  return zc - D * Math.pow(Math.max(0, 1 - Math.pow(u, SE)), 1 / SE) - off;
}
// band around an elliptic cross-section that changes from (rx0,rz0)@y0 to (rx1,rz1)@y1, centred at z=zc
function ellipBand(rx0, rz0, rx1, rz1, y0, y1, zc = 0, thick = 0.006, seg = 48) {
  const mk = (k) => gridGeo(4, seg, (t, s) => { const th = s * TAU, y = lerp(y0, y1, t); return [Math.sin(th) * (lerp(rx0, rx1, t) + k), y, zc + Math.cos(th) * (lerp(rz0, rz1, t) + k)]; });
  const o = fixWinding(mk(thick), (p, d) => d.set(p.x, 0, p.z - zc)), i = fixWinding(mk(0), (p, d) => d.set(-p.x, 0, -(p.z - zc)));
  const rim = gridGeo(1, seg, (t, s) => { const th = s * TAU, k = t * thick; return [Math.sin(th) * (rx1 + k), y1, zc + Math.cos(th) * (rz1 + k)]; });
  rim.computeVertexNormals();
  return mergeGeometries([o, i, fixWinding(rim, (p, d) => d.set(0, 1, 0))]);
}
function gridGeo(rows, cols, fn) { // fn(i,j) -> [x,y,z]; cols wrap (seam duplicated)
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) { pos.push(...fn(i / rows, (j % cols) / cols)); uv.push(j / cols, i / rows); }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = i * (cols + 1) + j, b = a + cols + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
function fixWinding(g, outward) { // flip triangles whose normal points inward (relative to outward(p) direction)
  const p = g.attributes.position, ix = g.index.array, a = v3(), b = v3(), c = v3(), n = v3(), o = v3();
  let flip = 0, tot = 0;
  for (let i = 0; i < ix.length; i += 3) { a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]); n.subVectors(b, a).cross(c.sub(a)); outward(a, o); if (n.dot(o) < 0) flip++; tot++; }
  if (flip > tot / 2) for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; }
  g.computeVertexNormals();
  return g;
}
function torsoGeo(y0 = 0.88, y1 = 1.565) {
  const g = gridGeo(72, 96, (t, s) => {
    const y = lerp(y0, y1, t), [, W, F, B] = prof(TP, y), th = s * TAU, zc = (F + B) / 2, D = (F - B) / 2;
    const x = W * spow(Math.sin(th), 2 / SE); let yy = y;
    if (y < 0.955) yy += (1 - sstep(0, 0.075, Math.abs(x))) * (0.955 - y) * 0.95; // crotch notch
    return [x, yy, zc + D * spow(Math.cos(th), 2 / SE)];
  });
  return fixWinding(g, (p, o) => o.set(p.x, 0, p.z + 0.01));
}
function armGeo(side) {
  const x0 = AP[0][0], x1 = AP[AP.length - 1][0];
  const g = gridGeo(40, 24, (t, s) => { const [x, cy, cz, ry, rz] = prof(AP, lerp(x0, x1, t)), th = s * TAU; return [side * x, cy + ry * Math.cos(th), cz + rz * Math.sin(th)]; });
  return fixWinding(g, (p, o) => { const r = prof(AP, Math.abs(p.x)); o.set(0, p.y - r[1], p.z - r[2]); });
}
function legGeo(side) {
  const y0 = LP[0][0], y1 = LP[LP.length - 1][0];
  const g = gridGeo(50, 24, (t, s) => { const [y, cx, cz, rx, rz] = prof(LP, lerp(y0, y1, t)), th = s * TAU; return [side * (cx + rx * Math.sin(th)), y, cz + rz * Math.cos(th)]; });
  return fixWinding(g, (p, o) => { const r = prof(LP, p.y); o.set(p.x - side * r[1], 0, p.z - r[2]); });
}
const SPINE_H = [['Hips', 1.04], ['Spine', 1.142], ['Spine1', 1.243], ['Spine2', 1.334], ['Neck', 1.5]];
function spineW(y, w, k = 1) {
  if (y <= SPINE_H[0][1]) { w[SPINE_H[0][0]] = (w[SPINE_H[0][0]] || 0) + k; return; }
  for (let i = 0; i < SPINE_H.length - 1; i++) {
    const [a, ya] = SPINE_H[i], [b, yb] = SPINE_H[i + 1];
    if (y <= yb) { const t = (y - ya) / (yb - ya); w[a] = (w[a] || 0) + k * (1 - t); w[b] = (w[b] || 0) + k * t; return; }
  }
  w.Neck = (w.Neck || 0) + k;
}
const WEIGHTS = {
  torso(x, y) {
    const w = {}, sd = x > 0 ? 'Left' : 'Right';
    const sh = sstep(0.08, 0.17, Math.abs(x)) * sstep(1.37, 1.47, y) * 0.75;
    const lg = sstep(0.985, 0.885, y) * 0.6 * sstep(0.015, 0.08, Math.abs(x));
    spineW(y, w, 1 - sh - lg);
    if (sh > 0) w[sd + 'Shoulder'] = sh;
    if (lg > 0) w[sd + 'UpLeg'] = lg;
    return w;
  },
  arm(x) {
    const sd = x > 0 ? 'Left' : 'Right', ax = Math.abs(x), w = {};
    const sh = 1 - sstep(0.11, 0.21, ax), fa = sstep(0.39, 0.47, ax), hd = sstep(0.67, 0.72, ax) * 0.6;
    if (sh > 0) w[sd + 'Shoulder'] = sh * 0.8;
    w[sd + 'Arm'] = (1 - sh * 0.8) * (1 - fa);
    w[sd + 'ForeArm'] = (1 - sh * 0.8) * fa * (1 - hd);
    if (hd > 0) w[sd + 'Hand'] = (1 - sh * 0.8) * fa * hd;
    return w;
  },
  leg(x, y) {
    const sd = x > 0 ? 'Left' : 'Right', w = {};
    const hp = sstep(0.93, 1.03, y) * 0.7, kn = sstep(0.56, 0.48, y), ft = sstep(0.14, 0.09, y) * 0.8;
    if (hp > 0) w.Hips = hp;
    w[sd + 'UpLeg'] = (1 - hp) * (1 - kn);
    w[sd + 'Leg'] = (1 - hp) * kn * (1 - ft);
    if (ft > 0) w[sd + 'Foot'] = (1 - hp) * kn * ft;
    return w;
  },
};

// ------------------------------------------------------------------------------------------------ avatar
const AX = { x: v3(1, 0, 0), y: v3(0, 1, 0), z: v3(0, 0, 1) };

export function createAvatar(assets, look) {
  assets = assets || _assets;
  if (!assets) throw new Error('createAvatar: call loadAvatarAssets first');
  const root = new THREE.Group(); root.name = 'avatar';
  const body = new THREE.Group(); root.add(body);
  const model = SkeletonUtils.clone(assets.xbot.scene); body.add(model);
  const bones = {}; model.traverse((o) => { if (o.isBone) bones[o.name.replace(P, '')] = o; });
  const restLocal = {}; for (const k in bones) restLocal[k] = bones[k].position.clone();
  const armature = bones.Hips.parent; const armScale = armature.scale.x; // 0.01

  // body meshes: own color attribute (rgba: a=0 hides), shared position/skin attributes
  const skinned = [];
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, alphaTest: 0.5, envMapIntensity: 1 });
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const src = o.geometry, g = new THREE.BufferGeometry();
    for (const k in src.attributes) g.setAttribute(k, src.attributes[k]);
    g.setIndex(src.index); g.boundingSphere = src.boundingSphere; g.boundingBox = src.boundingBox;
    const col = new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 4), 4);
    g.setAttribute('color', col);
    o.geometry = g; o.material = bodyMat; o.frustumCulled = false;
    skinned.push({ mesh: o, col, vd: assets.vdata.find((v) => v.name === o.name) });
  });

  const skeleton = skinned[0].mesh.skeleton, boneIndex = {};
  skeleton.bones.forEach((b, i) => (boneIndex[b.name.replace(P, '')] = i));
  // animation
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const n of ['idle', 'walk', 'run', 'dance']) {
    const c = assets.clips[n]; if (!c) continue;
    const a = mixer.clipAction(c); a.enabled = true; a.setEffectiveWeight(n === 'idle' ? 1 : 0); a.play(); act[n] = a;
  }
  if (act.walk) act.walk.timeScale = 0; if (act.run) act.run.timeScale = 0;
  if (act.dance) act.dance.setEffectiveWeight(0);

  // per-look state
  let built = null; // { anchors, geos, mats, skin, H, ... }
  const st = { w: [1, 0, 0], phase: 0, pose: null, poseW: 0, poseName: null, g: null, gW: 0, t: 0, drunkT: 0, idleT: Math.random() * 10 };
  const av = {
    root, drunk: 0, look: null, height: 1.85,
    update, setLook, emote, dispose,
    get busy() { return !!(st.g || st.pose); },
    get emoting() { return st.g?.name || st.pose || null; },
  };

  // ---------------- skin build
  function setLook(lk) {
    const L = normLook(lk || av.look || {});
    av.look = L;
    teardown();
    for (const k in restLocal) bones[k].position.copy(restLocal[k]);
    const ctx = makeCtx(L);
    BUILD[L.skin](ctx, L);
    for (const id of L.acc) ACC[id]?.(ctx, L);
    ctx.finish();
    built = ctx.out;
    body.scale.setScalar((ctx.scale || 1) * L.h);
    av.height = (ctx.top + ctx.yOff) * (ctx.scale || 1) * L.h + 0.05;
    makeVessel(ctx.vessel || 'tumbler');
    return av;
  }
  function teardown() {
    if (!built) return;
    for (const a of built.anchors) a.parent?.remove(a);
    for (const g of built.garments) g.mesh.parent?.remove(g.mesh);
    for (const g of built.geos) g.dispose();
    for (const m of built.mats) m.dispose();
    built = null;
  }
  function restPos(name) { // rest-pose position of a bone in model space (meters), honoring per-skin bone edits
    const p = v3(); let b = bones[name];
    while (b && b !== armature) { p.add(b.position); b = b.parent; }
    return p.multiplyScalar(armScale);
  }
  function makeCtx(L) {
    const mats = new Map(), buckets = new Map(), out = { anchors: [], geos: [], mats: [], garments: [] };
    const restCache = {};
    const ctx = {
      L, bones, out, scale: 1, yOff: 0, top: 1.81, legScale: 1, vessel: 'tumbler', posture: null,
      H: { bone: 'Head', c: [0, 1.672, 0.012], r: [0.1, 0.122, 0.112], eyeY: 1.675, eyeX: 0.04, mouthY: 1.608, hatY: 1.79, hatR: 0.112, face: null },
      chest: { bone: '@torso', fy: 1.37, fz: 0.14, ny: 1.548, w: 0.085, bz: -0.075 },
      mat(color, o = {}) {
        const key = JSON.stringify([color, o]);
        if (mats.has(key)) return mats.get(key);
        const phys = o.clearcoat || o.sheen || o.transmission || o.iridescence;
        const p = { color: new THREE.Color(color), roughness: o.rough ?? 0.55, metalness: o.metal ?? 0, envMapIntensity: o.env ?? 1 };
        if (o.map) p.map = o.map;
        if (o.emissive) { p.emissive = new THREE.Color(o.emissive); p.emissiveIntensity = o.ei ?? 1; }
        if (o.opacity != null) { p.transparent = true; p.opacity = o.opacity; p.depthWrite = o.depthWrite ?? false; }
        if (o.side) p.side = o.side;
        if (o.flat) p.flatShading = true;
        if (o.vc) p.vertexColors = true;
        let m;
        if (phys) { m = new THREE.MeshPhysicalMaterial(p); if (o.clearcoat) { m.clearcoat = o.clearcoat; m.clearcoatRoughness = o.ccr ?? 0.1; } if (o.sheen) { m.sheen = o.sheen; m.sheenColor = new THREE.Color(o.sheenColor || color); m.sheenRoughness = 0.5; } }
        else m = new THREE.MeshStandardMaterial(p);
        mats.set(key, m); out.mats.push(m);
        return m;
      },
      rest(name) { return restCache[name] || (restCache[name] = restPos(name)); },
      // add geometry authored in absolute rest coordinates, rigidly bound to bone
      add(bone, geo, mat) {
        if (bone[0] !== '@' && !bones[bone]) { geo.dispose(); return; }
        const key = bone + '|' + mat.uuid;
        let b = buckets.get(key); if (!b) buckets.set(key, (b = { bone, mat, list: [] }));
        b.list.push(geo);
      },
      setBone(name, x, y, z) { // local offset in armature units (cm)
        const b = bones[name]; if (!b) return; if (x != null) b.position.x = x; if (y != null) b.position.y = y; if (z != null) b.position.z = z;
        for (const k in restCache) delete restCache[k];
      },
      shortLegs(f) { for (const s of ['Left', 'Right']) { ctx.setBone(s + 'Leg', null, restLocal[s + 'Leg'].y * f); ctx.setBone(s + 'Foot', null, restLocal[s + 'Foot'].y * f); } ctx.legScale = f; ctx.yOff = -(0.888 * (1 - f)); },
      hideBody() { ctx.paint(() => null); },
      // smooth skinned clothing body (torso + arms + legs); Xbot keeps only hands and feet
      body(o) {
        ctx.paint(outfit(o));
        const gm = ctx.mat('#ffffff', { rough: o.rough ?? 0.72, sheen: o.sheen ?? 0, sheenColor: o.sheenColor ?? '#555555', vc: true, metal: o.metal ?? 0 });
        const pieces = [['torso', torsoGeo(o.y0 ?? 0.88), (p) => WEIGHTS.torso(p.x, p.y)]];
        for (const sd of [1, -1]) { pieces.push(['arm', armGeo(sd), (p) => WEIGHTS.arm(p.x)]); pieces.push(['leg', legGeo(sd), (p) => WEIGHTS.leg(p.x, p.y)]); }
        for (const [zone, g, wf] of pieces) ctx.garment(zone, g, gm, wf);
      },
      garment(zone, g, mat, wf) {
        const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), p = v3();
        for (let i = 0; i < n; i++) {
          p.fromBufferAttribute(g.attributes.position, i);
          const w = Object.entries(wf(p)).filter(([b, x]) => x > 1e-4 && boneIndex[b] != null).sort((a, b) => b[1] - a[1]).slice(0, 4);
          let sum = 0; for (const [, x] of w) sum += x;
          w.forEach(([b, x], k) => { si[i * 4 + k] = boneIndex[b]; sw[i * 4 + k] = x / (sum || 1); });
          if (!w.length) { si[i * 4] = boneIndex.Hips; sw[i * 4] = 1; }
        }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        const col = new THREE.BufferAttribute(new Float32Array(n * 4), 4); g.setAttribute('color', col);
        const m = new THREE.SkinnedMesh(g, mat); m.frustumCulled = false;
        m.bind(skeleton, new THREE.Matrix4());
        armature.add(m);
        out.garments.push({ mesh: m, zone, col, paint: zone !== 'decal' });
        out.geos.push(g);
      },
      paint(fn) { ctx._paint = fn; },
      finish() {
        const off = v3();
        for (const b of buckets.values()) {
          const skinnedDecal = b.bone[0] === '@';
          const rp = skinnedDecal ? v3() : ctx.rest(b.bone);
          let list = b.list; const anyNon = list.some((g) => !g.index);
          if (anyNon) list = list.map((g) => (g.index ? g.toNonIndexed() : g));
          for (const g of list) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.translate(-rp.x, -rp.y, -rp.z); }
          const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
          if (list.length > 1) for (const g of list) g.dispose();
          for (const g of b.list) if (!list.includes(g)) g.dispose();
          if (!merged) continue;
          if (skinnedDecal) { const wk = WEIGHTS[b.bone.slice(1)]; ctx.garment('decal', merged, b.mat, (p) => wk(p.x, p.y)); continue; }
          const anchor = new THREE.Group(); anchor.scale.setScalar(1 / armScale);
          const mesh = new THREE.Mesh(merged, b.mat); mesh.frustumCulled = false; anchor.add(mesh);
          bones[b.bone].add(anchor); out.anchors.push(anchor); out.geos.push(merged);
        }
        repaint(ctx._paint || outfit({}), out.garments);
        out.H = ctx.H; out.chest = ctx.chest; out.posture = ctx.posture; out.legScale = ctx.legScale; out.yOff = ctx.yOff;
        out.thigh = ctx.rest('LeftUpLeg').distanceTo(ctx.rest('LeftLeg'));
      },
    };
    return ctx;
  }
  function repaint(fn, garments = []) {
    const c = new THREE.Color(), v = { x: 0, y: 0, z: 0, u: 0, zone: '', bone: '', joint: false, src: 'xbot' };
    const put = (arr, i, r) => { if (r == null) { arr[i * 4 + 3] = 0; return; } c.set(r); arr[i * 4] = c.r; arr[i * 4 + 1] = c.g; arr[i * 4 + 2] = c.b; arr[i * 4 + 3] = 1; };
    for (const s of skinned) {
      const { dom, zones, names, pos } = s.vd, arr = s.col.array, joint = /Joints/.test(s.vd.name);
      v.src = 'xbot'; v.joint = joint;
      for (let i = 0; i < pos.count; i++) {
        v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i); v.zone = zones[dom[i]]; v.bone = names[dom[i]];
        put(arr, i, fn(v));
      }
      s.col.needsUpdate = true;
      let vis = false; for (let i = 3; i < arr.length; i += 4) if (arr[i] > 0) { vis = true; break; }
      s.mesh.visible = vis;
    }
    v.src = 'g'; v.joint = false; v.bone = '';
    for (const g of garments) {
      if (!g.paint) continue;
      const pos = g.mesh.geometry.attributes.position, arr = g.col.array;
      v.zone = g.zone;
      for (let i = 0; i < pos.count; i++) {
        v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i);
        v.u = g.zone === 'arm' ? (Math.abs(v.x) - 0.1) / 0.605 : 0;
        put(arr, i, fn(v));
      }
      g.col.needsUpdate = true;
    }
  }

  // ---------------- drink vessel (lives in model space, positioned at the right hand each frame)
  let vessel = null, vesselLiquid = null, vesselMats = [], vesselGeos = [];
  function makeVessel(kind) {
    if (vessel) { model.remove(vessel); vesselMats.forEach((m) => m.dispose()); vesselGeos.forEach((g) => g.dispose()); vesselMats = []; vesselGeos = []; }
    vessel = new THREE.Group(); vessel.visible = false; vesselLiquid = null;
    const M = (p, phys) => { const m = phys ? new THREE.MeshPhysicalMaterial(p) : new THREE.MeshStandardMaterial(p); vesselMats.push(m); return m; };
    const add = (g, m, parent = vessel) => { vesselGeos.push(g); const me = new THREE.Mesh(g, m); parent.add(me); return me; };
    if (kind === 'flask') {
      const metal = M({ color: 0xd9dde2, metalness: 1, roughness: 0.22 });
      const b = add(roundBox(0.075, 0.105, 0.026, 0.012, 4), metal); b.position.y = 0.05;
      const cap = add(new THREE.CylinderGeometry(0.011, 0.011, 0.016, 20), M({ color: 0x9aa0a6, metalness: 1, roughness: 0.3 })); cap.position.set(0, 0.11, 0);
      const lab = add(new THREE.PlaneGeometry(0.05, 0.045), M({ color: 0x5b3a1f, roughness: 0.8 })); lab.position.set(0, 0.05, 0.0135);
    } else if (kind === 'bottle') {
      const pts = [[0, 0], [0.03, 0], [0.032, 0.006], [0.032, 0.11], [0.026, 0.13], [0.012, 0.16], [0.011, 0.2], [0.013, 0.205], [0, 0.205]].map(([x, y]) => new THREE.Vector2(x, y));
      add(new THREE.LatheGeometry(pts, 28), M({ color: 0x5a2f0c, roughness: 0.12, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.92 }, true));
      const lab = add(new THREE.CylinderGeometry(0.0325, 0.0325, 0.05, 28, 1, true), M({ color: 0xffffff, map: glassTex(), roughness: 0.6 })); lab.position.y = 0.065;
      vessel.position.y = -0.02;
    } else {
      const glassM = M({ color: 0xe8f2ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false, side: THREE.DoubleSide }, true);
      add(new THREE.CylinderGeometry(0.036, 0.032, 0.088, 32, 1, true), glassM).position.y = 0.044;
      add(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 32), glassM).position.y = 0.006;
      const liq = new THREE.Group(); vessel.add(liq); liq.position.y = 0.012;
      const lm = add(new THREE.CylinderGeometry(0.0335, 0.031, 0.045, 32), M({ color: 0xb8661c, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.86, emissive: 0x3a1600, emissiveIntensity: 0.6 }), liq); lm.position.y = 0.0225;
      const ice = add(roundBox(0.028, 0.026, 0.028, 0.006, 2), M({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.5, clearcoat: 1 }, true), liq); ice.position.set(0.004, 0.04, 0.002); ice.rotation.set(0.4, 0.6, 0.2);
      vesselLiquid = liq;
    }
    vessel.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 2; } });
    model.add(vessel);
  }

  // ---------------- runtime helpers (model-space math)
  const invModel = new THREE.Matrix4(), mQi = new THREE.Quaternion();
  const _a = v3(), _b = v3(), _c = v3(), _d = v3(), _p = v3(), _s = v3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _ident = new THREE.Quaternion();
  function beginPost() { model.updateMatrixWorld(true); invModel.copy(model.matrixWorld).invert(); model.matrixWorld.decompose(_p, mQi, _s); mQi.invert(); }
  function mpos(o, out) { return out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(invModel); }
  function mquat(o, out) { o.matrixWorld.decompose(_p, out, _s); return out.premultiply(mQi); }
  function rotModel(bone, q, w = 1) {
    if (!bone || w <= 0) return;
    const qq = _q1.copy(_ident).slerp(q, clamp(w, 0, 1));
    const qp = mquat(bone.parent, _q2);
    _q3.copy(qp).invert().multiply(qq).multiply(qp);
    bone.quaternion.premultiply(_q3);
    bone.updateMatrixWorld(true);
  }
  function rotAxis(bone, axis, ang, w = 1) { if (Math.abs(ang * w) < 1e-5) return; rotModel(bone, new THREE.Quaternion().setFromAxisAngle(axis, ang), w); }
  function aim(bone, child, dir, w = 1) {
    if (!bone || !child) return;
    const cur = mpos(child, _a).sub(mpos(bone, _b)).normalize();
    rotModel(bone, new THREE.Quaternion().setFromUnitVectors(cur, _c.copy(dir).normalize()), w);
  }
  // two-bone IK on an arm. target = where the hand point (wrist + forearm*extra) should go
  function armIK(side, target, pole, w = 1, extra = 0) {
    const A = bones[side + 'Arm'], F = bones[side + 'ForeArm'], Hd = bones[side + 'Hand'];
    const S = mpos(A, v3()), E0 = mpos(F, v3()), H0 = mpos(Hd, v3());
    const a = S.distanceTo(E0), b = E0.distanceTo(H0) + extra;
    const T = target.clone(), dv = T.clone().sub(S); let d = dv.length();
    d = clamp(d, Math.abs(a - b) + 1e-3, (a + b) * 0.995); const dir = dv.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const pp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().add(dir.clone().multiplyScalar(a * cosA)).add(pp.multiplyScalar(a * sinA));
    aim(A, F, E.sub(S), w);
    const E1 = mpos(F, v3());
    aim(F, Hd, T.sub(E1), w);
  }
  // twist hand about the forearm so the palm (rest: -Y) faces `want`
  function palm(side, want, w = 1) {
    const F = bones[side + 'ForeArm'], Hd = bones[side + 'Hand'];
    const fd = mpos(Hd, v3()).sub(mpos(F, v3())).normalize();
    const hq = mquat(Hd, new THREE.Quaternion());
    const cur = v3(0, -1, 0).applyQuaternion(hq); cur.sub(fd.clone().multiplyScalar(cur.dot(fd))).normalize();
    const wv = want.clone(); wv.sub(fd.clone().multiplyScalar(wv.dot(fd))).normalize();
    if (cur.lengthSq() < 0.5 || wv.lengthSq() < 0.5) return;
    rotModel(Hd, new THREE.Quaternion().setFromUnitVectors(cur, wv), w);
  }
  function headPoint(off, out) { // point in the head frame (rest coords) -> model space now
    const H = built.H, bone = bones[H.bone], rp = restPos(H.bone);
    out.set(off[0] - rp.x, off[1] - rp.y, off[2] - rp.z).multiplyScalar(1 / armScale);
    out.applyMatrix4(bone.matrixWorld).applyMatrix4(invModel);
    return out;
  }

  // ---------------- emotes
  const GEST = { drink: 3.6, wave: 2.8, cheer: 2.6, clap: 2.6, facepalm: 2.8 };
  function emote(name) {
    if (name === 'dance' || name === 'sit') {
      if (st.pose === name) return av;
      st.pose = name; st.poseName = name; st.g = null;
      if (name === 'dance' && act.dance) act.dance.reset().play();
      return av;
    }
    if (!GEST[name]) return av;
    if (st.pose === 'dance') st.pose = null;
    st.g = { name, t: 0, dur: GEST[name] };
    return av;
  }

  function update(dt, s = {}) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const speed = Math.max(0, s.speed || 0);
    if (speed > 0.5) { if (st.pose) st.pose = null; if (st.g && !st.g.out) st.g.out = 0; }
    const k = 1 - Math.exp(-dt * 9);
    // locomotion weights
    const r = s.run ? clamp((speed - 1.1) / 1.6, 0, 1) : clamp((speed - 1.8) / 1.6, 0, 1);
    const m = clamp(speed / 0.45, 0, 1);
    const tw = [1 - m, m * (1 - r), m * r];
    for (let i = 0; i < 3; i++) st.w[i] += (tw[i] - st.w[i]) * k;
    // pose layer
    const pTarget = st.pose ? 1 : 0;
    st.poseW += (pTarget - st.poseW) * (1 - Math.exp(-dt * (st.pose ? 4 : 6)));
    if (!st.pose && st.poseW < 0.01) { st.poseW = 0; st.poseName = null; }
    const danceW = st.poseName === 'dance' ? st.poseW : 0;
    const ls = built?.legScale || 1;
    const wTS = clamp(speed / (1.5 * ls), 0.55, 2.2), rTS = clamp(speed / (3.5 * ls), 0.65, 1.7);
    const rate = (1 - st.w[2] / Math.max(1e-3, st.w[1] + st.w[2])) * (wTS / (act.walk?.getClip().duration || 1)) + (st.w[2] / Math.max(1e-3, st.w[1] + st.w[2])) * (rTS / (act.run?.getClip().duration || 1));
    st.phase = (st.phase + dt * rate) % 1;
    const ph = assets.phase;
    if (act.walk) act.walk.time = ((st.phase + (ph.walk || 0)) % 1) * act.walk.getClip().duration;
    if (act.run) act.run.time = ((st.phase + (ph.run || 0)) % 1) * act.run.getClip().duration;
    const sum = st.w[0] + st.w[1] + st.w[2] || 1, nd = 1 - danceW;
    act.idle?.setEffectiveWeight((st.w[0] / sum) * nd);
    act.walk?.setEffectiveWeight((st.w[1] / sum) * nd);
    act.run?.setEffectiveWeight((st.w[2] / sum) * nd);
    act.dance?.setEffectiveWeight(danceW);
    mixer.update(dt);

    if (!built) return;
    st.t += dt; st.idleT += dt;
    // model offset (skin, sit drop, hop, stagger)
    const sitW = st.poseName === 'sit' ? st.poseW : 0;
    let hop = 0, stagger = 0;
    const drunk = clamp(av.drunk || 0, 0, 1);
    if (drunk > 0) { st.drunkT += dt * (1 + m * 0.6); stagger = (Math.sin(st.drunkT * 0.9) * 0.06 + Math.sin(st.drunkT * 2.1) * 0.02) * drunk; }
    // gesture timing
    let g = st.g, gw = 0;
    if (g) {
      g.t += dt;
      gw = sstep(0, 0.35, g.t) * (1 - sstep(g.dur - 0.4, g.dur, g.t));
      if (g.out != null) { g.out += dt; gw *= 1 - sstep(0, 0.25, g.out); if (g.out > 0.25) g = st.g = null; }
      if (g && g.t >= g.dur) g = st.g = null;
    }
    if (g?.name === 'cheer') hop = Math.abs(Math.sin(g.t * 2.6 * PI)) * 0.035 * gw;
    model.position.set(stagger, (built.yOff || 0) - sitW * ((built.thigh || 0.44) + 0.01) + hop, 0);

    beginPost();
    // posture (per skin)
    const pst = built.posture;
    if (pst) {
      if (pst.hunch) { rotAxis(bones.Spine1, AX.x, pst.hunch * 0.5); rotAxis(bones.Spine2, AX.x, pst.hunch * 0.5); rotAxis(bones.Neck, AX.x, pst.hunch * 0.4); rotAxis(bones.Head, AX.x, -pst.hunch * 0.9); }
      if (pst.armsOut) { const wo = 1 - danceW * 0.6; rotAxis(bones.LeftArm, AX.z, pst.armsOut * wo); rotAxis(bones.RightArm, AX.z, -pst.armsOut * wo); }
    }
    // drunk sway
    if (drunk > 0) {
      const t = st.drunkT, sway = (Math.sin(t * 1.7) * 0.09 + Math.sin(t * 0.63 + 1) * 0.06) * drunk;
      rotAxis(bones.Spine, AX.z, sway); rotAxis(bones.Spine1, AX.z, sway * 0.6); rotAxis(bones.Spine, AX.x, 0.07 * drunk);
      rotAxis(bones.Neck, AX.z, -sway * 0.5); rotAxis(bones.Head, AX.z, -sway * 0.9 + Math.sin(t * 2.3) * 0.07 * drunk); rotAxis(bones.Head, AX.x, (0.14 + Math.sin(t * 1.1) * 0.08) * drunk);
      rotAxis(bones.LeftArm, AX.z, (0.12 + sway) * drunk); rotAxis(bones.RightArm, AX.z, (-0.12 + sway) * drunk);
    }
    // sit
    if (sitW > 0) {
      rotAxis(bones.Spine, AX.x, -0.1, sitW);
      for (const sd of ['Left', 'Right']) {
        const sx = sd === 'Left' ? 1 : -1;
        aim(bones[sd + 'UpLeg'], bones[sd + 'Leg'], v3(0.06 * sx, -0.08, 1), sitW);
        aim(bones[sd + 'Leg'], bones[sd + 'Foot'], v3(0.02 * sx, -1, 0.08), sitW);
        aim(bones[sd + 'Foot'], bones[sd + 'ToeBase'], v3(0, -0.35, 1), sitW);
      }
      if (!g || !['clap', 'cheer'].includes(g.name)) {
        for (const sd of ['Left', 'Right']) {
          if (g && sd === 'Right') continue;
          const sx = sd === 'Left' ? 1 : -1; const knee = mpos(bones[sd + 'Leg'], v3());
          armIK(sd, knee.add(v3(-0.02 * sx, 0.075, -0.1)), v3(sx, -0.2, -0.6), sitW, 0.06);
          palm(sd, v3(0, -1, 0), sitW);
        }
      }
    }
    // gestures
    if (g && gw > 0) GESTURE[g.name](g.t, gw);
    if (vessel && !(g && g.name === 'drink')) vessel.visible = false;
  }

  const GESTURE = {
    drink(t, w) {
      const R = curve([[0, 0], [0.45, 0], [0.95, 1], [1.6, 1], [1.85, 0.45], [2.1, 1], [2.65, 1], [3.1, 0]], t);
      const K = curve([[0, 0], [0.9, 0.1], [1.15, 1], [1.5, 1], [1.75, 0.05], [2.1, 0.12], [2.3, 1], [2.6, 1], [2.85, 0]], t);
      // head tips back while sipping
      rotAxis(bones.Neck, AX.x, -0.16 * K, w); rotAxis(bones.Head, AX.x, -0.26 * K, w);
      const S = mpos(bones.RightArm, v3());
      const hold = S.clone().add(v3(0.14, -0.3, 0.3));
      const tilt = (0.1 + 1.15 * K);
      const axis = v3(0, Math.cos(tilt), -Math.sin(tilt)); // vessel up axis, tipping towards the face
      const lip = headPoint(built.H.mouth, v3()).add(v3(0, -0.004, 0.012));
      const atMouth = lip.clone().sub(axis.clone().multiplyScalar(0.05)).add(v3(0.008, 0, 0.012 + 0.03 * (1 - K)));
      const C = hold.lerp(atMouth, R);
      // vessel
      const vis = sstep(0.05, 0.35, t) * (1 - sstep(3.15, 3.45, t));
      vessel.visible = vis > 0.01 && w > 0.05;
      vessel.quaternion.setFromUnitVectors(AX.y, axis);
      vessel.position.copy(C).sub(axis.clone().multiplyScalar(0.045));
      vessel.scale.setScalar(Math.max(0.001, vis));
      if (vesselLiquid) vesselLiquid.scale.y = clamp(1 - sstep(1.1, 1.5, t) * 0.35 - sstep(2.25, 2.6, t) * 0.35, 0.05, 1);
      // hand wraps the vessel from the right side
      armIK('Right', C.clone().add(v3(-0.055 - 0.015 * R, -0.01 - 0.01 * R, -0.008 * R)), v3(-1, -0.5 + 0.3 * R, -0.1), w, 0.07);
      palm('Right', v3(1, 0, 0.1), w);
    },
    wave(t, w) {
      const S = mpos(bones.RightArm, v3());
      const sw = Math.sin(t * TAU * 1.6);
      armIK('Right', S.clone().add(v3(-0.26 + sw * 0.1, 0.38, 0.12)), v3(-1, -0.8, 0), w, 0.06);
      palm('Right', v3(-0.3 * sw, 0, 1), w);
      rotAxis(bones.Head, AX.z, -0.12, w); rotAxis(bones.Spine1, AX.z, 0.05, w);
    },
    cheer(t, w) {
      const b = Math.sin(t * 2.6 * TAU) * 0.06;
      for (const sd of ['Left', 'Right']) {
        const sx = sd === 'Left' ? 1 : -1, S = mpos(bones[sd + 'Arm'], v3());
        armIK(sd, S.clone().add(v3(0.16 * sx, 0.46 + b, 0.08)), v3(sx, -0.4, -0.3), w, 0.05);
        palm(sd, v3(0, 0, 1), w);
      }
      rotAxis(bones.Spine1, AX.x, -0.08, w); rotAxis(bones.Head, AX.x, -0.22, w);
    },
    clap(t, w) {
      const o = 0.5 + 0.5 * Math.cos(t * TAU * 2.6), c = mpos(bones.Spine2, v3()).add(v3(0, 0.02, 0.34));
      for (const sd of ['Left', 'Right']) {
        const sx = sd === 'Left' ? 1 : -1;
        armIK(sd, c.clone().add(v3(sx * (0.028 + 0.075 * o), 0, 0)), v3(sx, -1, -0.4), w, 0.07);
        palm(sd, v3(-sx, 0.25, 0), w);
      }
      rotAxis(bones.Head, AX.x, 0.08, w);
    },
    facepalm(t, w) {
      rotAxis(bones.Spine2, AX.x, 0.08, w); rotAxis(bones.Neck, AX.x, 0.2, w); rotAxis(bones.Head, AX.x, 0.28, w);
      rotAxis(bones.Head, AX.y, Math.sin(t * TAU * 1.1) * 0.12 * sstep(0.6, 1, t), w);
      const H = built.H, eye = headPoint([0, H.eyeY + 0.01, H.faceZ ? H.faceZ(0, H.eyeY) : H.c[2] + H.r[2]], v3());
      armIK('Right', eye.add(v3(-0.01, -0.01, 0.03)), v3(-0.9, -1, 0.1), w, 0.085);
      palm('Right', v3(0, 0, -1), w);
    },
  };

  function dispose() {
    teardown();
    if (vessel) { vesselMats.forEach((m) => m.dispose()); vesselGeos.forEach((g) => g.dispose()); }
    for (const s of skinned) s.mesh.geometry.dispose();
    bodyMat.dispose();
    mixer.stopAllAction(); mixer.uncacheRoot(model);
    root.parent?.remove(root);
  }

  setLook(look || {});
  update(0, { speed: 0 });
  return av;
}

// ------------------------------------------------------------------------------------------------ painting (body zones)
// o: { skin, top, pants, shoe, hand, sleeve, farm, sleeveU (0..1 arm coverage), bare, waist (y), belt, shin, shinY, bootY, shortsY, extra(v,c) }
// v.zone: torso | arm (v.u 0 shoulder..1 wrist) | leg | hand | foot (+ hidden xbot zones)
function outfit(o) {
  const skin = o.skin ?? '#e9c2a2', top = o.top ?? '#222', pants = o.pants ?? '#1a1a1a', shoe = o.shoe ?? '#111', hand = o.hand ?? skin;
  const waist = o.waist ?? 1.075, sleeveU = o.sleeveU ?? 1, sleeve = o.sleeve ?? top, farm = o.farm ?? sleeve;
  return (v) => {
    let c = null;
    switch (v.zone) {
      case 'torso': c = v.y > waist ? top : pants; if (o.belt && Math.abs(v.y - waist) < 0.016) c = o.belt; break;
      case 'arm': c = v.u > sleeveU ? (o.bare ?? skin) : v.u > 0.545 ? farm : sleeve; if (o.cuff && v.u <= sleeveU && v.u > sleeveU - 0.07) c = o.cuff; break;
      case 'leg': c = pants; if (o.shinY && v.y < o.shinY) c = o.shin ?? pants; if (o.bootY && v.y < o.bootY) c = shoe; if (o.shortsY && v.y < o.shortsY) c = skin; break;
      case 'hand': c = hand; break;
      case 'foot': c = shoe; if (o.sole && v.y < 0.022) c = o.sole; break;
      default: c = null;
    }
    if (o.extra) { const e = o.extra(v, c); if (e !== undefined) c = e; }
    return c;
  };
}

// ------------------------------------------------------------------------------------------------ face + hair kit
function headFrame(ctx, c, r, extra = {}) {
  const H = ctx.H;
  H.c = c; H.r = r; Object.assign(H, extra);
  H.faceZ = (x, y) => c[2] + r[2] * Math.sqrt(Math.max(0, 1 - ((x - c[0]) / r[0]) ** 2 - ((y - c[1]) / r[1]) ** 2));
  H.mouth = [0, H.mouthY, H.faceZ(0, H.mouthY)];
  return H;
}
function humanHead(ctx, o = {}) {
  const H = headFrame(ctx, o.c || [0, 1.678, 0.016], o.r || [0.104, 0.128, 0.116], { eyeY: o.eyeY ?? 1.678, eyeX: o.eyeX ?? 0.041, mouthY: o.mouthY ?? 1.61 });
  const skinM = ctx.mat(o.skin, { rough: 0.5, sheen: 0.25, sheenColor: '#ff9a7a' });
  const g = ellipsoid([0, 0, 0], [1, 1, 1], 48);
  const a = g.attributes.position;
  const jaw = o.jaw ?? 0.2, chin = o.chin ?? 0.12;
  for (let i = 0; i < a.count; i++) {
    let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    if (y < 0) { const t = -y; x *= 1 - jaw * t * t; z *= 1 - chin * t * t * (z < 0 ? 1.2 : 0.4); }
    if (z < 0) z *= 0.97;
    a.setXYZ(i, x * H.r[0] + H.c[0], y * H.r[1] + H.c[1], z * H.r[2] + H.c[2]);
  }
  g.computeVertexNormals();
  ctx.add('Head', g, skinM);
  // neck
  ctx.add('Neck', capsuleBetween([0, 1.47, -0.02], [0, 1.6, -0.005], o.neckR ?? 0.047), skinM);
  // ears
  if (o.ears !== false) for (const s of [-1, 1]) ctx.add('Head', ellipsoid([s * (H.r[0] * 0.97), H.eyeY - 0.012, H.c[2] - 0.012], [0.014, 0.027, 0.02], 16), skinM);
  // nose
  const ny = o.noseY ?? (H.eyeY + H.mouthY) / 2 + 0.002;
  if (o.nose !== false) ctx.add('Head', ellipsoid([0, ny, H.faceZ(0, ny) + 0.004], o.noseR || [0.012, 0.016, 0.014], 16), skinM);
  if (o.eyes !== false) eyes(ctx, o.eye || {});
  if (o.brow !== false) brows(ctx, { color: o.browColor || '#2a1d14', ...(o.brows || {}) });
  if (o.mouth !== false) mouth(ctx, o.mouthStyle || {});
  return H;
}
function eyes(ctx, o = {}) {
  const H = ctx.H, er = o.r ?? 0.018, y = H.eyeY, gap = H.eyeX;
  const white = ctx.mat(o.white || '#f7f4ee', { rough: 0.2, clearcoat: 1 });
  const iris = ctx.mat(o.iris || '#4a3020', { rough: 0.25, clearcoat: 1, emissive: o.glow || undefined, ei: o.glow ? 0.9 : undefined });
  const pupil = ctx.mat('#050505', { rough: 0.2, clearcoat: 1 });
  const hi = ctx.mat('#ffffff', { emissive: '#ffffff', ei: 1.2 });
  const ir = er * (o.irisK ?? 0.68);
  for (const s of [-1, 1]) {
    const x = s * gap, z = H.faceZ(x, y) - er * (o.inset ?? 0.55);
    ctx.add('Head', ellipsoid([x, y, z], [er * (o.wide ?? 1.05), er * (o.tall ?? 1), er * 0.85], 24), white);
    const fz = z + er * 0.83;
    if (o.iris !== null) ctx.add('Head', ellipsoid([x + (o.look ?? 0) * s, y - (o.down ?? 0), fz], [ir, ir * (o.irisTall ?? 1), ir * 0.32], 20), iris);
    ctx.add('Head', ellipsoid([x + (o.look ?? 0) * s, y - (o.down ?? 0), fz + ir * 0.22], [ir * (o.pupil ?? 0.5), ir * (o.pupil ?? 0.5) * (o.irisTall ?? 1), ir * 0.15], 16), pupil);
    if (o.hi !== false) ctx.add('Head', ellipsoid([x + ir * 0.4, y + ir * 0.45, fz + ir * 0.3], [ir * 0.22, ir * 0.22, ir * 0.1], 8), hi);
    if (o.lid) { // upper lid (half-closed look)
      const lid = ctx.mat(o.lid, { rough: 0.5 });
      ctx.add('Head', place(new THREE.SphereGeometry(er * 1.12, 24, 12, 0, TAU, 0, PI * (o.lidAmt ?? 0.42)), { p: [x, y, z], r: [o.lidTilt ?? 0.25, 0, 0] }), lid);
    }
    if (o.lash) {
      const lm = ctx.mat('#111', { rough: 0.5 });
      for (let k = 0; k < 3; k++) { const ang = -0.5 + k * 0.5; const bx = x + Math.sin(ang) * er * 0.8 * (k - 1 === 0 ? 0 : 1), by = y + er * 0.95; ctx.add('Head', capsuleBetween([bx + (k - 1) * er * 0.5, by, z + er * 0.4], [bx + (k - 1) * er * 0.9, by + er * 0.55, z + er * 0.5], er * 0.07, 6), lm); }
    }
  }
}
function brows(ctx, o = {}) {
  const H = ctx.H, y = H.eyeY + (o.dy ?? 0.03), w = o.w ?? 0.022, th = o.t ?? 0.0045, tilt = o.tilt ?? 0.15;
  const m = ctx.mat(o.color || '#222', { rough: 0.6 });
  if (o.uni) {
    const pts = []; for (let i = 0; i <= 10; i++) { const x = -H.eyeX * 1.9 + (i / 10) * H.eyeX * 3.8; const yy = y + Math.sin(i * 1.3) * 0.003 + (Math.abs(x) < 0.01 ? -0.002 : 0); pts.push([x, yy, H.faceZ(x, yy) + 0.003]); }
    ctx.add('Head', tube(pts, th * 1.4, 40, 8), m); return;
  }
  for (const s of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6 - 0.5; const x = s * (H.eyeX + t * w * 2); const yy = y + Math.cos(t * PI) * 0.004 - t * s * tilt * 0.03 * -1 + (s * t > 0 ? 0 : 0); pts.push([x, yy + s * t * (o.slope ?? -0.012), H.faceZ(x, yy) + 0.002]); }
    ctx.add('Head', tube(pts, th, 16, 6), m);
  }
}
function mouth(ctx, o = {}) {
  const H = ctx.H, y = H.mouthY, w = o.w ?? 0.022, cv = o.curve ?? 0.004, th = o.t ?? 0.0028;
  const m = ctx.mat(o.color || '#7a3b33', { rough: 0.4 });
  const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8 * 2 - 1; const x = t * w + (o.skew ?? 0) * (t + 1) * 0.5; const yy = y - cv * (1 - t * t) + (o.smirk ?? 0) * Math.max(0, t) ; pts.push([x, yy, H.faceZ(x, yy) + 0.0015]); }
  ctx.add('Head', tube(pts, th, 16, 6), m);
}
// hair cap: sphere cap slightly larger than head, tilted back so the hairline sits high in front
function hairCap(ctx, color, o = {}) {
  const H = ctx.H, m = ctx.mat(color, { rough: o.rough ?? 0.5, sheen: 0.6, sheenColor: o.sheen || '#ffffff' });
  const k = o.k ?? 1.06;
  const g = new THREE.SphereGeometry(1, 40, 24, 0, TAU, 0, o.theta ?? 1.75);
  place(g, { r: [o.tilt ?? -0.55, 0, 0] });
  place(g, { p: [H.c[0], H.c[1] + (o.dy ?? 0.008), H.c[2] + (o.dz ?? -0.006)], s: [H.r[0] * k * (o.kx ?? 1), H.r[1] * k * (o.ky ?? 1), H.r[2] * k * (o.kz ?? 1)] });
  ctx.add('Head', g, m);
  return m;
}
// spikes rooted on the head ellipsoid. list items: {th (azimuth, 0=front, +=left), ph (polar from top), len, r, dir:[x,y,z] or null(normal), bend, up}
function spikes(ctx, color, list, o = {}) {
  const H = ctx.H, m = o.mat || ctx.mat(color, { rough: o.rough ?? 0.45, sheen: 0.6, sheenColor: o.sheen || '#ffffff', emissive: o.emissive, ei: o.ei });
  for (const s of list) {
    const th = s.th, ph = s.ph;
    const n = v3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th));
    const base = v3(H.c[0] + n.x * H.r[0] * (s.k ?? 0.92), H.c[1] + n.y * H.r[1] * (s.k ?? 0.92) + (o.dy ?? 0), H.c[2] + n.z * H.r[2] * (s.k ?? 0.92));
    const dir = s.dir ? v3(...s.dir).normalize() : n.clone().add(v3(0, s.up ?? 0, s.back ? -s.back : 0)).normalize();
    const side = s.bendDir ? v3(...s.bendDir) : v3(0, 1, 0);
    const g = spikeGeo(s.len, s.r, { bend: s.bend ?? 0, flat: s.flat ?? 0.65, seg: 10 });
    place(g, { p: base.toArray(), q: basisQ(dir, side) });
    ctx.add('Head', g, m);
  }
  return m;
}
function fanSpikes(seed, n, { th0 = -PI, th1 = PI, ph0 = 0.2, ph1 = 1.4, len = [0.08, 0.14], r = [0.025, 0.04], up = 0.3, back = 0, bend = 0.15, flat = 0.6 } = {}) {
  const R = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const th = lerp(th0, th1, (i + R() * 0.8) / n), ph = lerp(ph0, ph1, R());
    out.push({ th, ph, len: lerp(len[0], len[1], R()), r: lerp(r[0], r[1], R()), up: up * (0.6 + R() * 0.8), back, bend: bend * (R() * 2 - 0.4), flat });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ outfit pieces
function addTie(ctx, color, { y0 = 1.51, y1 = 1.17, w = 0.018, bow = false } = {}) {
  const m = ctx.mat(color, { rough: 0.35, sheen: 0.5 });
  if (bow) {
    const y = y0 - 0.005, z = chestZ(0, y, 0.012);
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(0.02, 0.018, 0.04, 0.02, 0.042, 0); sh.bezierCurveTo(0.04, -0.02, 0.02, -0.018, 0, 0);
    for (const s of [-1, 1]) ctx.add('@torso', place(extrudeShape(sh, 0.008, 0.002), { p: [0, y, z], s: [s, 1, 1] }), m);
    ctx.add('@torso', ellipsoid([0, y, z + 0.004], [0.009, 0.011, 0.007], 12), m);
    return;
  }
  const pts = [], ws = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14, y = lerp(y0, y1, t); pts.push([0, y, chestZ(0, y, 0.009)]); ws.push(t < 0.08 ? w * 0.75 : t > 0.9 ? w * 1.25 * (1 - (t - 0.9) / 0.1 * 0.95) : w * lerp(0.55, 1.25, t)); }
  ctx.add('@torso', ribbon(pts, ws, 0.004), m);
  ctx.add('@torso', ellipsoid([0, y0 - 0.008, chestZ(0, y0 - 0.008, 0.012)], [0.011, 0.012, 0.008], 12), m);
}
// shirt "V" seen inside an open jacket, plus lapels
function addShirtV(ctx, shirt, lapel, { y0 = 1.525, y1 = 1.2, w0 = 0.06, lapelW = 0.02, collar = true } = {}) {
  const sm = ctx.mat(shirt, { rough: 0.55 }), lm = ctx.mat(lapel, { rough: 0.3, sheen: 0.6 });
  const pts = [], ws = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12, y = lerp(y0, y1, t); pts.push([0, y, chestZ(0, y, 0.004)]); ws.push(Math.max(0.002, w0 * (1 - t))); }
  ctx.add('@torso', ribbon(pts, ws, 0.003), sm);
  if (lapelW > 0) for (const s of [-1, 1]) {
    const lp = [], lw = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, y = lerp(y0 + 0.01, y1 - 0.01, t), x = s * (w0 * (1 - t) + lapelW * 0.9 * (1 - t * 0.6)); lp.push([x, y, chestZ(x, y, 0.007)]); lw.push(lapelW * (0.6 + 0.6 * Math.sin(t * PI))); }
    ctx.add('@torso', ribbon(lp, lw, 0.004), lm);
  }
  if (collar) for (const s of [-1, 1]) ctx.add('@torso', place(new THREE.ConeGeometry(0.02, 0.05, 3), { p: [s * 0.03, y0 - 0.01, chestZ(s * 0.03, y0 - 0.01, 0.006)], r: [0.2, 0, s * 2.6], s: [1, 1, 0.25] }), sm);
}
function highCollar(ctx, color, { h = 0.075, button = '#c9a24a', open = false } = {}) {
  const m = ctx.mat(color, { rough: 0.6 });
  const y0 = 1.528, y1 = y0 + h;
  ctx.add('@torso', ellipBand(0.128, 0.082, 0.064, 0.06, y0, y1, -0.022, 0.007, 56), m);
  if (button) ctx.add('@torso', place(new THREE.CylinderGeometry(0.0085, 0.0085, 0.005, 20), { p: [0, y0 + 0.012, chestZ(0, y0 + 0.012, 0.012)], r: [PI / 2 - 0.5, 0, 0] }), ctx.mat(button, { metal: 1, rough: 0.25 }));
}
function coatTails(ctx, color, { y0 = 1.02, y1 = 0.56, r0 = 0.1, r1 = 0.125, gap = 0.62 } = {}) {
  const m = ctx.mat(color, { rough: 0.6, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const leg = ctx.rest(s > 0 ? 'LeftUpLeg' : 'RightUpLeg');
    const len = TAU - gap * PI, start = s > 0 ? -PI / 2 + (gap * PI) / 2 : PI / 2 + (gap * PI) / 2;
    const g = new THREE.CylinderGeometry(r0, r1, y0 - y1, 36, 4, true, start, len);
    ctx.add(s > 0 ? 'LeftUpLeg' : 'RightUpLeg', place(g, { p: [leg.x + s * 0.012, (y0 + y1) / 2, leg.z - 0.004] }), m);
  }
}
function cape(ctx, color, { y0 = 1.47, y1 = 0.62 } = {}) {
  const m = ctx.mat(color, { rough: 0.7, side: THREE.DoubleSide, sheen: 0.4 });
  const g = new THREE.CylinderGeometry(0.17, 0.3, y0 - y1, 40, 8, true, PI * 0.42, PI * 1.16);
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) { const y = a.getY(i), t = 0.5 - y / (y0 - y1); a.setZ(i, a.getZ(i) * 0.75 - t * 0.05); a.setX(i, a.getX(i) * (1 + Math.sin(a.getX(i) * 40) * 0.02 * t)); }
  g.computeVertexNormals();
  ctx.add('@torso', place(g, { p: [0, (y0 + y1) / 2, -0.03] }), m);
  const btn = ctx.mat('#151515', { rough: 0.3, clearcoat: 1 });
  for (const s of [-1, 1]) ctx.add('@torso', place(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 24), { p: [s * 0.13, 1.43, chestZ(s * 0.13, 1.43, 0.012)], r: [PI / 2 - 0.5, 0, 0] }), btn);
}
function hood(ctx, color, { r = 0.044 } = {}) {
  const m = ctx.mat(color, { rough: 0.85 });
  const pts = []; for (let i = 0; i <= 24; i++) { const a = -PI * 0.62 + (i / 24) * PI * 1.24, x = Math.sin(a) * 0.125, z = -0.03 - Math.cos(a) * 0.095, y = 1.535 + Math.cos(a) * 0.012; pts.push([x, y, z]); }
  ctx.add('@torso', tube(pts, r, 48, 14), m);
  ctx.add('@torso', ellipsoid([0, 1.44, -0.165], [0.12, 0.09, 0.045], 24), m);
}

// ------------------------------------------------------------------------------------------------ originals hair
function originalHair(ctx, style, color) {
  const H = ctx.H;
  if (style === 'bald') { ctx.top = H.c[1] + H.r[1]; return; }
  if (style === 'buzz') { hairCap(ctx, color, { k: 1.015, theta: 1.6, rough: 0.9, tilt: -0.6 }); ctx.top = H.c[1] + H.r[1] + 0.005; return; }
  if (style === 'fade') {
    hairCap(ctx, color, { k: 1.02, theta: 1.75, rough: 0.85, tilt: -0.6 });
    const g = ellipsoid([0, H.c[1] + 0.045, H.c[2] - 0.004], [H.r[0] * 0.98, H.r[1] * 0.72, H.r[2] * 1.0], 32); ctx.add('Head', g, ctx.mat(color, { rough: 0.6, sheen: 0.5 }));
    ctx.top = H.c[1] + H.r[1] + 0.02; return;
  }
  if (style === 'slick') {
    hairCap(ctx, color, { k: 1.05, theta: 1.7, rough: 0.28, tilt: -0.5 });
    const m = ctx.mat(color, { rough: 0.25, clearcoat: 0.6 });
    ctx.add('Head', ellipsoid([0, H.c[1] + 0.055, H.c[2] - 0.01], [H.r[0] * 1.0, H.r[1] * 0.68, H.r[2] * 1.06], 32), m);
    ctx.add('Head', ellipsoid([0, H.c[1] + 0.08, H.c[2] + 0.04], [H.r[0] * 0.75, H.r[1] * 0.45, H.r[2] * 0.75], 24), m);
    ctx.top = H.c[1] + H.r[1] + 0.03; return;
  }
  if (style === 'curly') {
    hairCap(ctx, color, { k: 1.04, theta: 1.75, rough: 0.9, tilt: -0.55 });
    const m = ctx.mat(color, { rough: 0.95, sheen: 0.4 }), R = rng(11);
    for (let i = 0; i < 46; i++) {
      const th = R() * TAU, ph = Math.acos(1 - R() * 1.15);
      if (Math.cos(th) > 0.5 && ph > 0.95) continue;
      const n = v3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th));
      ctx.add('Head', ellipsoid([H.c[0] + n.x * H.r[0] * 1.1, H.c[1] + 0.012 + n.y * H.r[1] * 1.08, H.c[2] + n.z * H.r[2] * 1.06], [0.03, 0.028, 0.03], 12), m);
    }
    ctx.top = H.c[1] + H.r[1] + 0.045; return;
  }
  if (style === 'long') {
    const m = hairCap(ctx, color, { k: 1.06, theta: 1.85, rough: 0.45, tilt: -0.45 });
    const g = new THREE.CylinderGeometry(H.r[0] * 1.08, H.r[0] * 1.25, 0.17, 36, 4, true, PI * 0.36, PI * 1.28);
    ctx.add('Head', place(g, { p: [0, H.c[1] - 0.07, H.c[2] - 0.012], s: [1, 1, 1.1] }), ctx.mat(color, { rough: 0.45, side: THREE.DoubleSide, sheen: 0.6 }));
    // side part sweep
    ctx.add('Head', ellipsoid([0.02, H.c[1] + 0.07, H.c[2] + 0.035], [H.r[0] * 0.9, H.r[1] * 0.4, H.r[2] * 0.8], 24), m);
    ctx.top = H.c[1] + H.r[1] + 0.02;
  }
}

// ------------------------------------------------------------------------------------------------ skin builders
const tone = (L) => TONES[L.tone] || TONES[1];
const BUILD = {
  // ---------- originals
  velvet(ctx, L) {
    const sk = tone(L);
    ctx.body({ skin: sk, top: L.c1, pants: '#141416', shoe: '#0b0b0c', cuff: L.c2, waist: 0.99, rough: 0.8, sheen: 0.6, sheenColor: '#' + new THREE.Color(L.c1).lerp(new THREE.Color('#ffffff'), 0.25).getHexString() });
    humanHead(ctx, { skin: sk, eye: { iris: '#3b2416' }, browColor: L.hc, mouthStyle: { curve: 0.003, smirk: 0.004 } });
    originalHair(ctx, L.hair, L.hc);
    addShirtV(ctx, '#f3efe6', L.c2, { w0: 0.06, lapelW: 0.03 });
    addTie(ctx, L.c2, { bow: true });
    ctx.add('@torso', place(roundBox(0.035, 0.012, 0.004, 0.002), { p: [0.085, 1.37, chestZ(0.085, 1.37, 0.008)], r: [-0.3, 0.3, 0] }), ctx.mat('#f3efe6'));
  },
  tux(ctx, L) {
    const sk = tone(L);
    ctx.body({ skin: sk, top: L.c1, pants: '#0c0c0e', shoe: '#050505', waist: 0.99, rough: 0.6,
      extra: (v, c) => { if (v.zone === 'leg') { const r = prof(LP, v.y); if (Math.abs(v.x) - r[1] > r[3] * 0.93) return '#000000'; } } });
    humanHead(ctx, { skin: sk, eye: { iris: '#2a1a10' }, browColor: L.hc, mouthStyle: { curve: 0.004 } });
    originalHair(ctx, L.hair, L.hc);
    addShirtV(ctx, '#f6f4ef', '#050507', { w0: 0.058, lapelW: 0.026 });
    addTie(ctx, L.c2, { bow: true });
  },
  street(ctx, L) {
    const sk = tone(L);
    const dk = '#' + new THREE.Color(L.c1).multiplyScalar(0.72).getHexString();
    ctx.body({ skin: sk, top: L.c1, pants: L.c2, shoe: '#f2f2f2', sole: '#c9c9c9', waist: 0.99, cuff: dk, rough: 0.9,
      extra: (v, c) => {
        if (v.zone === 'torso' && v.z > 0.05 && v.y > 1.03 && v.y < 1.2 && Math.abs(v.x) < 0.1 - (v.y - 1.03) * 0.25) return dk;
        if (v.zone === 'torso' && v.y < 1.03 && v.y > 0.99) return dk;
        if (v.zone === 'leg' && v.y < 0.16) return dk;
      } });
    humanHead(ctx, { skin: sk, eye: { iris: '#2a1a10' }, browColor: L.hc });
    originalHair(ctx, L.hair, L.hc);
    hood(ctx, L.c1);
    const sm = ctx.mat('#f2f2f2', { rough: 0.5 });
    for (const s of [-1, 1]) ctx.add('@torso', capsuleBetween([s * 0.035, 1.45, chestZ(s * 0.035, 1.45, 0.01)], [s * 0.04, 1.34, chestZ(s * 0.04, 1.34, 0.012)], 0.003, 6), sm);
  },
  gold(ctx, L) {
    const sk = tone(L);
    ctx.body({ skin: sk, top: L.c1, pants: L.c1, shoe: '#c9a24a', waist: 0.99, rough: 0.6 });
    humanHead(ctx, { skin: sk, eye: { iris: '#2a1a10' }, browColor: L.hc, mouthStyle: { curve: 0.005 } });
    originalHair(ctx, L.hair, L.hc);
    addShirtV(ctx, '#121212', L.c1, { w0: 0.065, lapelW: 0.03, y1: 1.24 });
    const gm = ctx.mat('#d4ae55', { metal: 1, rough: 0.25 });
    for (const y of [1.2, 1.14]) ctx.add('@torso', place(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 16), { p: [0.035, y + 0.04, chestZ(0.035, y + 0.04, 0.006)], r: [PI / 2, 0, 0] }), gm);
    ctx.add('@torso', place(roundBox(0.04, 0.014, 0.004, 0.002), { p: [0.085, 1.37, chestZ(0.085, 1.37, 0.008)], r: [-0.3, 0.3, 0] }), ctx.mat(L.c2, { metal: 0.6, rough: 0.3 }));
  },
  track(ctx, L) {
    const sk = tone(L), stripe = L.c2;
    ctx.body({ skin: sk, top: L.c1, pants: L.c1, shoe: '#f4f4f4', sole: '#cfcfcf', waist: 1.04, rough: 0.5, sheen: 0.5, sheenColor: '#888888',
      extra: (v, c) => {
        if (v.zone === 'arm') { const r = prof(AP, Math.abs(v.x)); const d = v.y - r[1]; if (d > r[4] * 0.62 && d < r[4] * 0.9 || d > r[4] * 0.95) return d > r[4] * 0.95 ? c : stripe; }
        if (v.zone === 'leg') { const r = prof(LP, v.y), d = Math.abs(v.x) - r[1]; if ((d > r[3] * 0.72 && d < r[3] * 0.84) || d > r[3] * 0.9) return stripe; }
        if (v.zone === 'torso' && Math.abs(v.x) < 0.005 && v.z > 0 && v.y > 1.04) return '#c9a24a';
      } });
    humanHead(ctx, { skin: sk, eye: { iris: '#4a6a8a' }, browColor: L.hc });
    originalHair(ctx, L.hair, L.hc);
    highCollar(ctx, L.c1, { h: 0.045, y: 1.5, button: null });
  },
  bomber(ctx, L) {
    const sk = tone(L);
    const dk = '#' + new THREE.Color(L.c1).multiplyScalar(0.7).getHexString();
    ctx.body({ skin: sk, top: L.c1, pants: '#1f2a3d', shoe: '#2a1d14', waist: 1.03, cuff: dk, rough: 0.42, sheen: 0.2,
      extra: (v, c) => {
        if (v.zone === 'torso' && v.y < 1.075 && v.y > 1.03) return dk;
      } });
    humanHead(ctx, { skin: sk, eye: { iris: '#5a7a4a' }, browColor: L.hc, mouthStyle: { smirk: 0.004 } });
    originalHair(ctx, L.hair, L.hc);
    const fur = ctx.mat(L.c2, { rough: 1, sheen: 1, sheenColor: '#ffffff' });
    const pts = []; for (let i = 0; i <= 28; i++) { const a = -PI * 0.78 + (i / 28) * PI * 1.56; pts.push([Math.sin(a) * 0.118, 1.545 + Math.cos(a) * 0.01 - Math.max(0, -Math.cos(a)) * 0.0, -0.025 - Math.cos(a) * 0.088]); }
    ctx.add('@torso', tube(pts, 0.032, 56, 14), fur);
    addShirtV(ctx, '#e9e4da', L.c1, { w0: 0.06, lapelW: 0.0, y1: 1.18, collar: false });
  },

  // ---------- Bikini Bottom
  spongebob(ctx, L) {
    ctx.hideBody();
    ctx.shortLegs(0.42);
    ctx.vessel = 'bottle';
    for (const s of ['Left', 'Right']) { const sx = s === 'Left' ? 1 : -1; ctx.setBone(s + 'Arm', sx * 25, null, 2); ctx.setBone(s + 'UpLeg', sx * 11); }
    ctx.posture = { armsOut: 0.18 };
    const Y = ctx.mat('#f6e04a', { rough: 0.75, map: spongeTex() });
    const yel = ctx.mat('#f4dc3a', { rough: 0.7 });
    const white = ctx.mat('#f7f7f2', { rough: 0.55 }), brown = ctx.mat('#93602d', { rough: 0.7 }), black = ctx.mat('#121212', { rough: 0.2, clearcoat: 1 });
    const bw = 0.6, bd = 0.26;
    // sponge body (bound to Spine1 so it sways with the dance)
    const g = roundBox(bw, 0.66, bd, 0.035, 4);
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) { const x = a.getX(i), y = a.getY(i); a.setX(i, x * (1 + 0.025 * Math.sin(y * 22))); a.setY(i, y + (Math.abs(y) > 0.3 ? 0.008 * Math.sin(x * 30) : 0)); }
    g.computeVertexNormals();
    ctx.add('Spine1', place(g, { p: [0, 1.5, 0.02] }), Y);
    // shirt band + pants
    ctx.add('Spine', place(roundBox(bw - 0.01, 0.075, bd - 0.01, 0.025, 3), { p: [0, 1.14, 0.02] }), white);
    ctx.add('Hips', place(roundBox(bw - 0.005, 0.15, bd, 0.03, 3), { p: [0, 1.03, 0.02] }), brown);
    const belt = ctx.mat('#151515', { rough: 0.5 });
    for (let i = 0; i < 5; i++) ctx.add('Hips', place(roundBox(0.075, 0.016, 0.006, 0.003, 2), { p: [-0.22 + i * 0.11, 1.07, 0.02 + bd / 2 + 0.002] }), belt);
    // collar + tie
    for (const s of [-1, 1]) ctx.add('Spine', place(new THREE.ConeGeometry(0.04, 0.07, 3), { p: [s * 0.04, 1.165, 0.02 + bd / 2 + 0.004], r: [0, 0, s * (PI / 2 + 0.6)], s: [1, 1, 0.12] }), white);
    const red = ctx.mat('#d4232b', { rough: 0.45 });
    const tie = new THREE.Shape(); tie.moveTo(-0.012, 0); tie.lineTo(0.012, 0); tie.lineTo(0.022, -0.075); tie.lineTo(0, -0.1); tie.lineTo(-0.022, -0.075); tie.closePath();
    ctx.add('Spine', place(extrudeShape(tie, 0.006, 0.002), { p: [0, 1.16, 0.02 + bd / 2 + 0.008] }), red);
    // face on the sponge front
    const fz = 0.02 + bd / 2;
    headFrameBox(ctx, { bone: 'Spine1', c: [0, 1.6, 0.02], r: [bw / 2, 0.2, bd / 2], eyeY: 1.64, eyeX: 0.085, mouthY: 1.47, fz, top: 1.83 });
    const ew = ctx.mat('#ffffff', { rough: 0.15, clearcoat: 1 }), blue = ctx.mat('#3f9fe0', { rough: 0.2, clearcoat: 1 }), pup = ctx.mat('#050505', { rough: 0.2, clearcoat: 1 });
    for (const s of [-1, 1]) {
      const x = s * 0.085, y = 1.645;
      ctx.add('Spine1', ellipsoid([x, y, fz + 0.012], [0.075, 0.08, 0.04], 32), ew);
      ctx.add('Spine1', ellipsoid([x - s * 0.006, y - 0.006, fz + 0.048], [0.033, 0.033, 0.008], 24), blue);
      ctx.add('Spine1', ellipsoid([x - s * 0.006, y - 0.006, fz + 0.053], [0.016, 0.016, 0.005], 16), pup);
      ctx.add('Spine1', ellipsoid([x - s * 0.0 + 0.01, y + 0.008, fz + 0.056], [0.006, 0.006, 0.003], 8), ctx.mat('#fff', { emissive: '#fff' }));
      for (let k = -1; k <= 1; k++) ctx.add('Spine1', capsuleBetween([x + k * 0.03, y + 0.07 - Math.abs(k) * 0.012, fz + 0.02], [x + k * 0.045, y + 0.115 - Math.abs(k) * 0.015, fz + 0.022], 0.0045, 6), black);
      // cheeks with freckles
      ctx.add('Spine1', ellipsoid([s * 0.15, 1.53, fz + 0.005], [0.04, 0.033, 0.016], 20), ctx.mat('#f0a85a', { rough: 0.7 }));
      for (let k = 0; k < 3; k++) ctx.add('Spine1', ellipsoid([s * 0.15 + (k - 1) * 0.013, 1.535 + (k === 1 ? 0.008 : 0), fz + 0.02], [0.004, 0.004, 0.002], 8), ctx.mat('#c0392b', { rough: 0.6 }));
    }
    // nose
    ctx.add('Spine1', capsuleBetween([0, 1.58, fz], [0, 1.6, fz + 0.075], 0.017, 12), yel);
    // big smile + buck teeth
    const sm = []; for (let i = 0; i <= 12; i++) { const t = i / 12 * 2 - 1; sm.push([t * 0.13, 1.5 - 0.035 * (1 - t * t) + (Math.abs(t) > 0.9 ? 0.012 * (Math.abs(t) - 0.9) * 10 : 0), fz + 0.004]); }
    ctx.add('Spine1', tube(sm, 0.0055, 40, 8), ctx.mat('#7a1d1d', { rough: 0.4 }));
    ctx.add('Spine1', ellipsoid([0, 1.475, fz + 0.002], [0.08, 0.022, 0.006], 24), ctx.mat('#7a1d1d', { rough: 0.5 }));
    for (const s of [-1, 1]) ctx.add('Spine1', place(roundBox(0.026, 0.03, 0.008, 0.004, 2), { p: [s * 0.016, 1.452, fz + 0.007] }), white);
    // limbs
    for (const s of [-1, 1]) {
      const pre = s > 0 ? 'Left' : 'Right', S = ctx.rest(pre + 'Arm').toArray(), E = ctx.rest(pre + 'ForeArm').toArray(), W = ctx.rest(pre + 'Hand').toArray();
      ctx.add(pre + 'Arm', capsuleBetween(S, E, 0.022), yel);
      ctx.add(pre + 'Arm', place(new THREE.CylinderGeometry(0.035, 0.055, 0.08, 20, 1), { p: [S[0] + s * 0.05, S[1], S[2]], r: [0, 0, s * PI / 2] }), white);
      ctx.add(pre + 'ForeArm', capsuleBetween(E, W, 0.022), yel);
      ctx.add(pre + 'Hand', ellipsoid([W[0] + s * 0.04, W[1], W[2]], [0.042, 0.022, 0.04], 20), yel);
      for (let k = 0; k < 3; k++) ctx.add(pre + 'Hand', capsuleBetween([W[0] + s * 0.07, W[1], W[2] + (k - 1) * 0.022], [W[0] + s * 0.105, W[1] - 0.004, W[2] + (k - 1) * 0.026], 0.011, 8), yel);
      ctx.add(pre + 'Hand', capsuleBetween([W[0] + s * 0.04, W[1], W[2] + 0.035], [W[0] + s * 0.06, W[1] - 0.002, W[2] + 0.065], 0.011, 8), yel);
      const hip = ctx.rest(pre + 'UpLeg').toArray(), kn = ctx.rest(pre + 'Leg').toArray(), an = ctx.rest(pre + 'Foot').toArray(), toe = ctx.rest(pre + 'ToeBase').toArray();
      ctx.add(pre + 'UpLeg', place(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 20), { p: [hip[0], hip[1] - 0.03, hip[2]] }), brown);
      ctx.add(pre + 'UpLeg', capsuleBetween([hip[0], hip[1] - 0.05, hip[2]], kn, 0.02), yel);
      ctx.add(pre + 'Leg', capsuleBetween(kn, an, 0.02), yel);
      ctx.add(pre + 'Leg', place(new THREE.CylinderGeometry(0.03, 0.027, 0.13, 20), { p: [an[0], an[1] + 0.09, an[2]] }), white);
      for (const [yy, col] of [[0.135, '#d4232b'], [0.115, '#2a6fd0']]) ctx.add('' + pre + 'Leg', place(new THREE.CylinderGeometry(0.0305, 0.0305, 0.012, 20), { p: [an[0], an[1] + yy, an[2]] }), ctx.mat(col, { rough: 0.6 }));
      ctx.add(pre + 'Foot', ellipsoid([an[0], an[1] - 0.04, an[2] + 0.05], [0.055, 0.045, 0.1], 24), black);
    }
    ctx.top = 1.84;
  },
  patrick(ctx, L) {
    ctx.hideBody();
    ctx.shortLegs(0.45);
    ctx.vessel = 'bottle';
    for (const s of ['Left', 'Right']) { const sx = s === 'Left' ? 1 : -1; ctx.setBone(s + 'Arm', sx * 14, -3, 0); ctx.setBone(s + 'UpLeg', sx * 12); }
    ctx.posture = { armsOut: 0.32 };
    const pink = ctx.mat('#ff94b4', { rough: 0.55, sheen: 0.4, sheenColor: '#ffd0dc' });
    const shorts = ctx.mat('#ffffff', { rough: 0.75, map: flowerTex() });
    // torso + belly
    ctx.add('Spine1', ellipsoid([0, 1.36, 0.03], [0.26, 0.3, 0.2], 40), pink);
    ctx.add('Spine', ellipsoid([0, 1.22, 0.06], [0.24, 0.2, 0.19], 32), pink);
    // head = top point of the star
    ctx.add('Neck', taperBetween([0, 1.5, 0.02], [0, 1.9, -0.0], 0.2, 0.055, 32), pink);
    // shorts
    const sg = new THREE.CylinderGeometry(0.26, 0.29, 0.2, 40, 2); ctx.add('Hips', place(sg, { p: [0, 1.02, 0.04], s: [1, 1, 0.8] }), shorts);
    for (const s of [-1, 1]) {
      const pre = s > 0 ? 'Left' : 'Right';
      const S = ctx.rest(pre + 'Arm'), W = ctx.rest(pre + 'Hand');
      ctx.add(pre + 'Arm', taperBetween([S.x - s * 0.08, S.y - 0.02, S.z + 0.03], ctx.rest(pre + 'ForeArm').toArray(), 0.12, 0.07, 24), pink);
      ctx.add(pre + 'ForeArm', taperBetween(ctx.rest(pre + 'ForeArm').toArray(), [W.x + s * 0.03, W.y, W.z], 0.07, 0.04, 24), pink);
      const hip = ctx.rest(pre + 'UpLeg'), kn = ctx.rest(pre + 'Leg'), an = ctx.rest(pre + 'Foot');
      ctx.add(pre + 'UpLeg', place(new THREE.CylinderGeometry(0.115, 0.12, 0.13, 28), { p: [hip.x, hip.y - 0.02, hip.z + 0.03] }), shorts);
      ctx.add(pre + 'UpLeg', taperBetween([hip.x, hip.y - 0.06, hip.z + 0.03], kn.toArray(), 0.1, 0.085, 24), pink);
      ctx.add(pre + 'Leg', taperBetween(kn.toArray(), [an.x, an.y - 0.06, an.z + 0.02], 0.085, 0.05, 24), pink);
    }
    // face
    headFrame(ctx, [0, 1.64, 0.02], [0.13, 0.16, 0.135], { bone: 'Neck', eyeY: 1.665, eyeX: 0.03, mouthY: 1.585 });
    ctx.H.bone = 'Neck';
    const ew = ctx.mat('#ffffff', { rough: 0.15, clearcoat: 1 }), pup = ctx.mat('#050505', { rough: 0.2, clearcoat: 1 }), black = ctx.mat('#181010', { rough: 0.5 });
    const fz = (x, y) => 0.02 + 0.165 * Math.sqrt(Math.max(0, 1 - (x / 0.165) ** 2 - ((y - 1.6) / 0.25) ** 2));
    for (const s of [-1, 1]) {
      const x = s * 0.03, y = 1.67;
      ctx.add('Neck', ellipsoid([x, y, fz(x, y) - 0.01], [0.03, 0.04, 0.022], 24), ew);
      ctx.add('Neck', ellipsoid([x - s * 0.006, y - 0.004, fz(x, y) + 0.009], [0.011, 0.013, 0.005], 16), pup);
      const bp = []; for (let i = 0; i <= 6; i++) { const t = i / 6; const bx = s * (0.012 + t * 0.05); bp.push([bx, 1.725 + 0.012 * Math.sin(t * PI) - t * 0.012, fz(bx, 1.73) + 0.003]); }
      ctx.add('Neck', tube(bp, 0.0065, 16, 6), black);
    }
    const mp = []; for (let i = 0; i <= 12; i++) { const t = i / 12 * 2 - 1, x = t * 0.075, y = 1.59 - 0.012 * (1 - t * t); mp.push([x, y, fz(x, y) + 0.002]); }
    ctx.add('Neck', tube(mp, 0.0045, 30, 6), ctx.mat('#6e1a2a', { rough: 0.4 }));
    ctx.add('Neck', ellipsoid([0, 1.582, fz(0, 1.58) - 0.002], [0.05, 0.012, 0.006], 20), ctx.mat('#3a0d16', { rough: 0.5 }));
    ctx.H.faceZ = fz; ctx.H.mouth = [0, 1.585, fz(0, 1.585)];
    ctx.H.hatY = 1.86; ctx.H.hatR = 0.075; ctx.H.r = [0.15, 0.16, 0.14]; ctx.H.c = [0, 1.66, 0.02];
    ctx.chest = { bone: 'Spine2', fy: 1.42, fz: 0.2, ny: 1.52, w: 0.17, bz: -0.12 };
    ctx.top = 1.92;
  },
  squidward(ctx, L) {
    const sk = '#9fd8c8';
    ctx.body({ skin: sk, top: '#8a5a2c', pants: sk, shoe: sk, waist: 0.86, sleeveU: 0.4, rough: 0.75 });
    ctx.posture = { hunch: 0.12 };
    // light-bulb head (lathe)
    const prof2 = [[0.0001, 1.555], [0.05, 1.56], [0.075, 1.6], [0.098, 1.66], [0.118, 1.73], [0.132, 1.8], [0.133, 1.86], [0.118, 1.91], [0.08, 1.95], [0.0001, 1.965]];
    const rAt = (y) => { for (let i = 1; i < prof2.length; i++) if (y <= prof2[i][1]) { const [r0, y0] = prof2[i - 1], [r1, y1] = prof2[i]; return lerp(r0, r1, (y - y0) / (y1 - y0)); } return 0; };
    const H = headFrame(ctx, [0, 1.76, -0.01], [0.13, 0.2, 0.13], { eyeY: 1.715, eyeX: 0.047, mouthY: 1.6 });
    H.faceZ = (x, y) => -0.01 + Math.sqrt(Math.max(0, rAt(y) ** 2 - x * x)) * 1.0;
    const skinM = ctx.mat(sk, { rough: 0.5, sheen: 0.3, sheenColor: '#e0fff5' });
    const hg = new THREE.LatheGeometry(prof2.map(([r, y]) => new THREE.Vector2(r, y)), 48); hg.translate(0, 0, -0.01);
    ctx.add('Head', hg, skinM);
    ctx.add('Neck', capsuleBetween([0, 1.47, -0.02], [0, 1.6, -0.008], 0.045), skinM);
    // droopy nose from between the eyes
    const nose = []; for (let i = 0; i <= 10; i++) { const t = i / 10; nose.push([0, 1.705 - t * 0.135, H.faceZ(0, 1.705) - 0.005 + Math.sin(t * PI * 0.75) * 0.06]); }
    const c3 = new THREE.CatmullRomCurve3(nose.map((p) => v3(...p))), frames = c3.computeFrenetFrames(24);
    const ng = new THREE.TubeGeometry(c3, 24, 1, 16), na = ng.attributes.position;
    for (let i = 0; i <= 24; i++) for (let j = 0; j <= 16; j++) {
      const t = i / 24, P0 = c3.getPointAt(t), rr = 0.024 + 0.008 * Math.sin(t * PI), ang = (j / 16) * TAU, N = frames.normals[i], B = frames.binormals[i];
      na.setXYZ(i * 17 + j, P0.x + rr * (Math.cos(ang) * N.x + Math.sin(ang) * B.x), P0.y + rr * (Math.cos(ang) * N.y + Math.sin(ang) * B.y), P0.z + rr * (Math.cos(ang) * N.z + Math.sin(ang) * B.z));
    }
    ng.computeVertexNormals(); ctx.add('Head', ng, skinM);
    ctx.add('Head', ellipsoid(nose[10].map((v, i) => v + [0, -0.004, 0.002][i]), [0.03, 0.032, 0.03], 20), skinM);
    eyes(ctx, { r: 0.031, white: '#f3eec4', iris: '#c8402a', irisK: 0.36, pupil: 0.5, lid: sk, lidAmt: 0.5, lidTilt: 0.12, inset: 0.25, hi: false });
    mouth(ctx, { w: 0.018, curve: -0.005, t: 0.003, color: '#3d5a52' });
    H.mouth = [0, 1.6, H.faceZ(0, 1.6) + 0.02];
    H.hatY = 1.94; H.hatR = 0.12; H.c = [0, 1.77, -0.01]; H.r = [0.133, 0.19, 0.133];
    ctx.top = 1.97;
  },

  // ---------- Jujutsu
  gojo(ctx, L) {
    const sk = '#f6e1d3', navy = '#151823';
    ctx.scale = 1.05;
    ctx.body({ skin: sk, top: navy, pants: navy, shoe: '#0a0a0a', waist: 0.99, rough: 0.7, extra: (v) => (v.zone === 'torso' && Math.abs(v.x) < 0.004 && v.z > 0 && v.y > 0.99 ? '#07080c' : undefined) });
    const H = humanHead(ctx, { skin: sk, eyes: false, brow: false, jaw: 0.25, mouthStyle: { curve: 0.003, smirk: 0.005, w: 0.02 } });
    highCollar(ctx, navy, { h: 0.075, button: '#d8d8d8' });
    // blindfold
    const bf = ctx.mat('#0b0b0e', { rough: 0.8, sheen: 0.3 });
    ctx.add('Head', place(bandGeo(1, 1, 1, 0.08, 48), { p: [0, H.eyeY + 0.004, H.c[2] - 0.002], s: [H.r[0] * 1.02, 0.042, H.r[2] * 1.04], r: [-0.06, 0, 0] }), bf);
    // white hair: cap + big upward spikes
    const white = '#f4f6fc';
    const hm = hairCap(ctx, white, { k: 1.06, theta: 1.6, tilt: -0.35, dy: 0.012, sheen: '#cfe3ff' });
    ctx.add('Head', ellipsoid([0, H.c[1] + 0.075, H.c[2] - 0.01], [H.r[0] * 1.05, H.r[1] * 0.62, H.r[2] * 1.02], 32), hm);
    const list = [];
    const R = rng(21);
    for (let i = 0; i < 26; i++) {
      const th = (i / 26) * TAU + R() * 0.2, ph = 0.3 + R() * 0.8;
      list.push({ th, ph, len: 0.12 + R() * 0.09, r: 0.045 + R() * 0.015, up: 1.2 + R() * 0.8, back: 0.2, bend: (R() - 0.5) * 0.35, flat: 0.6, k: 0.85 });
    }
    for (let i = 0; i < 7; i++) list.push({ th: (i / 7) * TAU, ph: 0.12, len: 0.17 + R() * 0.05, r: 0.05, up: 1.0, back: 0.15, flat: 0.62, k: 0.85, bend: (R() - 0.5) * 0.3 });
    // bangs falling over the blindfold
    for (let i = 0; i < 6; i++) list.push({ th: -0.75 + i * 0.3, ph: 0.95, len: 0.085, r: 0.026, dir: [Math.sin(-0.75 + i * 0.3) * 0.35, -1, 0.45], flat: 0.5, bend: 0.15 });
    spikes(ctx, white, list, { mat: hm });
    H.hatY = 1.93; H.hatR = H.r[0] * 1.25;
    ctx.top = 1.99;
  },
  megumi(ctx, L) {
    const sk = '#f2dccd', navy = '#141824';
    ctx.body({ skin: sk, top: navy, pants: navy, shoe: '#0a0a0a', waist: 0.99, rough: 0.7, extra: (v) => (v.zone === 'torso' && Math.abs(v.x) < 0.004 && v.z > 0 && v.y > 0.99 ? '#07080c' : undefined) });
    const H = humanHead(ctx, { skin: sk, eye: { iris: '#1f4a5e', r: 0.017, tall: 0.85, irisTall: 1.15 }, browColor: '#101218', brows: { slope: 0.014, t: 0.004 }, mouthStyle: { curve: -0.001, w: 0.016 }, jaw: 0.25 });
    highCollar(ctx, navy, { h: 0.075, button: '#c9a24a' });
    const hc = '#12141c';
    hairCap(ctx, hc, { k: 1.06, theta: 1.8, tilt: -0.45, sheen: '#6f86b8' });
    const list = [];
    const R = rng(5);
    for (let i = 0; i < 40; i++) {
      const th = (i / 40) * TAU + R() * 0.15, ph = 0.35 + R() * 1.1;
      const front = Math.cos(th);
      if (front > 0.7 && ph > 1.15) continue;
      list.push({ th, ph, len: 0.09 + R() * 0.08, r: 0.026 + R() * 0.012, up: 0.4 + R() * 0.5 - (ph > 1.1 ? 0.6 : 0), back: 0.25 + R() * 0.3, bend: (R() - 0.5) * 0.5, flat: 0.5 });
    }
    for (let i = 0; i < 6; i++) list.push({ th: (i / 6) * TAU, ph: 0.1, len: 0.11, r: 0.03, up: 0.8, back: 0.4, flat: 0.55 });
    for (let i = 0; i < 4; i++) list.push({ th: -0.5 + i * 0.33, ph: 1.0, len: 0.065, r: 0.02, dir: [Math.sin(-0.5 + i * 0.33) * 0.4, -1, 0.5], flat: 0.5 });
    spikes(ctx, hc, list, { sheen: '#6f86b8' });
    H.hatY = H.c[1] + H.r[1] + 0.05; H.hatR = H.r[0] * 1.2;
    ctx.top = 1.93;
  },
  yuji(ctx, L) {
    const sk = '#f2d3be', navy = '#1a2033', red = '#c3272f';
    ctx.body({ skin: sk, top: navy, pants: navy, shoe: red, sole: '#f2f2f2', cuff: red, waist: 0.99, rough: 0.7, extra: (v) => (v.zone === 'torso' && Math.abs(v.x) < 0.004 && v.z > 0 && v.y > 0.99 ? '#0b0e18' : undefined) });
    const H = humanHead(ctx, { skin: sk, eye: { iris: '#8a4a1b', r: 0.0175, tall: 0.9 }, browColor: '#3b2318', brows: { slope: 0.01 }, mouthStyle: { curve: 0.006, w: 0.02 } });
    // marks under the eyes
    const mk = ctx.mat('#a33b3b', { rough: 0.5 });
    for (const s of [-1, 1]) { const x = s * (H.eyeX + 0.004); ctx.add('Head', tube([[x - s * 0.012, H.eyeY - 0.022, H.faceZ(x, H.eyeY - 0.022) + 0.001], [x + s * 0.012, H.eyeY - 0.026, H.faceZ(x, H.eyeY - 0.026) + 0.001]], 0.0018, 6, 5), mk); }
    // red hood around shoulders
    hood(ctx, red, { r: 0.04 });
    highCollar(ctx, navy, { h: 0.05, button: '#c9a24a' });
    // hair: dark undercut + pink spiky top
    hairCap(ctx, '#3a2620', { k: 1.02, theta: 1.9, tilt: -0.5, rough: 0.95 });
    const pink = '#ff9c9c';
    const pm = hairCap(ctx, pink, { k: 1.075, theta: 1.32, tilt: -0.2, dy: 0.016, sheen: '#ffe0e0' });
    ctx.add('Head', ellipsoid([0, H.c[1] + 0.06, H.c[2] + 0.01], [H.r[0] * 0.98, H.r[1] * 0.6, H.r[2] * 1.02], 32), pm);
    const list = []; const R = rng(9);
    for (let i = 0; i < 30; i++) { const th = (i / 30) * TAU + R() * 0.2, ph = 0.15 + R() * 0.85; list.push({ th, ph, len: 0.05 + R() * 0.035, r: 0.032, up: 0.7, back: 0.25, flat: 0.62, bend: (R() - 0.5) * 0.4, k: 0.95 }); }
    for (let i = 0; i < 6; i++) list.push({ th: -0.6 + i * 0.24, ph: 0.7, len: 0.065, r: 0.026, dir: [Math.sin(-0.6 + i * 0.24) * 0.3, 0.6, 1], flat: 0.55, bend: 0.2, k: 0.95 });
    spikes(ctx, pink, list, { mat: pm });
    H.hatY = H.c[1] + H.r[1] + 0.035;
    ctx.top = 1.87;
  },

  // ---------- Rick & Morty
  rick(ctx, L) {
    const sk = '#f1d7c5', coat = '#f3f3ef', shirt = '#9fd0e3', pants = '#6b4a2f';
    ctx.scale = 1.03;
    ctx.vessel = 'flask';
    ctx.posture = { hunch: 0.16 };
    ctx.body({ skin: sk, top: coat, pants, shoe: '#2a1c12', waist: 0.7, rough: 0.75, extra: (v) => (v.zone === 'leg' && v.y > 0.8 ? coat : undefined) });
    addShirtV(ctx, shirt, coat, { y1: 1.1, w0: 0.062, lapelW: 0.024, collar: false });
    coatTails(ctx, coat, { y0: 1.02, y1: 0.58 });
    const H = humanHead(ctx, { skin: sk, c: [0, 1.672, 0.016], r: [0.1, 0.13, 0.112], eye: { r: 0.022, iris: null, pupil: 0.18, irisK: 1, white: '#ffffff', hi: false, inset: 0.4 }, brow: false, jaw: 0.1, chin: 0.05,
      mouthStyle: { w: 0.032, curve: -0.004, t: 0.003, color: '#5a3a33', skew: 0.004 }, noseR: [0.013, 0.02, 0.016] });
    brows(ctx, { uni: true, color: '#9fc6d2', t: 0.0045, dy: 0.032 });
    // drool
    ctx.add('Head', ellipsoid([0.03, H.mouthY - 0.012, H.faceZ(0.03, H.mouthY - 0.012) + 0.002], [0.005, 0.01, 0.004], 10), ctx.mat('#cfe8c8', { rough: 0.05, clearcoat: 1, opacity: 0.8 }));
    // wrinkles under eyes
    const wm = ctx.mat('#c9a898', { rough: 0.6 });
    for (const s of [-1, 1]) { const x = s * H.eyeX; ctx.add('Head', tube([[x - 0.012, H.eyeY - 0.026, H.faceZ(x - 0.012, H.eyeY - 0.026) + 0.001], [x, H.eyeY - 0.03, H.faceZ(x, H.eyeY - 0.03) + 0.001], [x + 0.012, H.eyeY - 0.026, H.faceZ(x + 0.012, H.eyeY - 0.026) + 0.001]], 0.0014, 8, 4), wm); }
    // spiky blue-grey hair pointing back
    const hc = '#b6dbe6';
    hairCap(ctx, hc, { k: 1.03, theta: 1.25, tilt: -1.0, dz: -0.01, sheen: '#ffffff', rough: 0.6 });
    const list = []; const R = rng(33);
    for (let i = 0; i < 22; i++) {
      const th = PI * 0.25 + (i / 22) * PI * 1.5, ph = 0.6 + R() * 0.75;
      list.push({ th, ph, len: 0.09 + R() * 0.06, r: 0.028 + R() * 0.012, up: 0.1, back: 0.9, bend: (R() - 0.5) * 0.3, flat: 0.55 });
    }
    for (let i = 0; i < 7; i++) list.push({ th: PI + (i - 3) * 0.3, ph: 0.25 + R() * 0.3, len: 0.1, r: 0.034, up: 0.5, back: 0.9, flat: 0.55 });
    spikes(ctx, hc, list, { rough: 0.6 });
    H.hatY = H.c[1] + H.r[1] + 0.01;
    ctx.top = 1.84;
  },
  morty(ctx, L) {
    const sk = '#f6dac6', shirt = '#ffe12e', pants = '#2f6fd0';
    ctx.scale = 0.9;
    ctx.body({ skin: sk, top: shirt, pants, shoe: '#f0f0f0', sole: '#bdbdbd', sleeveU: 0.36, waist: 1.0, rough: 0.8 });
    const H = humanHead(ctx, { skin: sk, c: [0, 1.685, 0.02], r: [0.112, 0.13, 0.12], eye: { r: 0.025, iris: null, pupil: 0.16, irisK: 1, white: '#ffffff', hi: false, inset: 0.45 }, eyeX: 0.045, eyeY: 1.69,
      browColor: '#5a3418', brows: { slope: -0.008, t: 0.0035, w: 0.018, dy: 0.036 }, mouthStyle: { w: 0.02, curve: -0.002, t: 0.0028, color: '#5a3a33' }, jaw: 0.15 });
    // wavy nervous mouth already; hair: brown rounded cap
    const hc = '#6d3f1d';
    hairCap(ctx, hc, { k: 1.06, theta: 1.55, tilt: -0.45, dy: 0.012, rough: 0.7 });
    const m = ctx.mat(hc, { rough: 0.7, sheen: 0.4 });
    ctx.add('Head', ellipsoid([0, H.c[1] + 0.07, H.c[2] - 0.005], [H.r[0] * 1.02, H.r[1] * 0.55, H.r[2] * 1.02], 32), m);
    H.hatY = H.c[1] + H.r[1] + 0.02;
    ctx.top = 1.84;
  },

  // ---------- Legends
  goku(ctx, L) { gokuBuild(ctx, false); },
  goku_ssj(ctx, L) { gokuBuild(ctx, true); },
  naruto(ctx, L) {
    const sk = '#f4d2b3', orange = '#ff7414', black = '#1c1c22';
    ctx.body({ skin: sk, top: orange, pants: orange, shoe: '#24324a', waist: 0.99, rough: 0.75,
      extra: (v, c) => {
        if (v.zone === 'torso' && v.y > 1.37 - (v.z < 0 ? 0.05 : 0)) return black;
        if (v.zone === 'arm' && v.u < 0.22) return black;
        if (v.zone === 'leg' && v.y < 0.24 && v.y > 0.12) return '#e8e2d6';
        if (v.zone === 'torso' && Math.abs(v.x) < 0.005 && v.z > 0 && v.y > 0.99) return '#c4c4c4';
      } });
    const H = humanHead(ctx, { skin: sk, eye: { iris: '#2f7fd6', r: 0.0175, tall: 0.92, irisK: 0.7 }, browColor: '#c9971f', mouthStyle: { curve: 0.007, w: 0.024 } });
    // whiskers
    const wm = ctx.mat('#4a2d1c', { rough: 0.6 });
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const y = H.eyeY - 0.028 - k * 0.009, x0 = s * 0.045, x1 = s * 0.075; ctx.add('Head', tube([[x0, y, H.faceZ(x0, y) + 0.001], [x1, y - 0.002 + (k - 1) * 0.003, H.faceZ(x1, y) + 0.001]], 0.0014, 6, 4), wm); }
    highCollar(ctx, orange, { h: 0.05, r: [0.072, 0.07], y: 1.5, button: null });
    // headband
    const band = ctx.mat('#1e2a4a', { rough: 0.8, sheen: 0.4 });
    const by = H.eyeY + 0.052;
    ctx.add('Head', place(bandGeo(1, 1, 1, 0.07, 48), { p: [0, by, H.c[2] - 0.004], s: [H.r[0] * 1.04, 0.034, H.r[2] * 1.06], r: [-0.12, 0, 0] }), band);
    ctx.add('Head', place(roundBox(0.1, 0.04, 0.006, 0.003, 2), { p: [0, by + 0.002, H.faceZ(0, by) + 0.012], r: [-0.15, 0, 0] }), ctx.mat('#ffffff', { map: leafTex(), metal: 0.9, rough: 0.25 }));
    for (const s of [-1, 1]) ctx.add('Head', place(roundBox(0.024, 0.11, 0.004, 0.002, 2), { p: [s * 0.022, by - 0.06, H.c[2] - H.r[2] - 0.012], r: [0.25, 0, s * 0.25] }), band);
    // spiky yellow hair
    const hc = '#ffd23a';
    hairCap(ctx, hc, { k: 1.05, theta: 1.65, tilt: -0.4, dy: 0.01, sheen: '#fff5c0' });
    const list = []; const R = rng(14);
    for (let i = 0; i < 34; i++) { const th = (i / 34) * TAU + R() * 0.12, ph = 0.3 + R() * 1.0; if (Math.cos(th) > 0.75 && ph > 0.95) continue; list.push({ th, ph, len: 0.075 + R() * 0.06, r: 0.03 + R() * 0.01, up: 0.5 + R() * 0.5, back: 0.15, bend: (R() - 0.5) * 0.4, flat: 0.55 }); }
    for (let i = 0; i < 6; i++) list.push({ th: (i / 6) * TAU, ph: 0.1, len: 0.09, r: 0.032, up: 0.6, flat: 0.6 });
    for (let i = 0; i < 5; i++) list.push({ th: -0.6 + i * 0.3, ph: 0.95, len: 0.06, r: 0.022, dir: [Math.sin(-0.6 + i * 0.3) * 0.5, -0.6, 1], flat: 0.5 });
    spikes(ctx, hc, list, { sheen: '#fff5c0' });
    H.hatY = H.c[1] + H.r[1] + 0.04;
    ctx.top = 1.9;
  },
  saitama(ctx, L) {
    const sk = '#f6d6b9', yel = '#ffd02a', red = '#e0242c';
    ctx.body({ skin: sk, top: yel, pants: yel, shoe: red, hand: red, belt: '#161616', waist: 1.06, bootY: 0.25, rough: 0.55,
      extra: (v) => { if (v.zone === 'arm' && v.u > 0.8) return red; if (v.zone === 'torso' && Math.abs(v.x) < 0.004 && v.z > 0 && v.y > 1.08) return '#c9a826'; } });
    const H = humanHead(ctx, { skin: sk, eye: { r: 0.012, iris: null, pupil: 0.3, irisK: 1, white: '#ffffff', hi: false, wide: 1.3, tall: 0.55 }, browColor: '#7a5a40', brows: { t: 0.0025, slope: 0, w: 0.016 }, mouthStyle: { w: 0.012, curve: 0, t: 0.0022 } });
    // shiny bald head: glossy overlay
    ctx.add('Head', place(new THREE.SphereGeometry(1, 40, 20, 0, TAU, 0, 1.2), { p: [H.c[0], H.c[1] + 0.002, H.c[2] - 0.003], s: [H.r[0] * 1.012, H.r[1] * 1.012, H.r[2] * 1.012], r: [-0.4, 0, 0] }), ctx.mat(sk, { rough: 0.22, clearcoat: 1, ccr: 0.05 }));
    highCollar(ctx, yel, { h: 0.04, r: [0.07, 0.068], y: 1.5, button: null });
    cape(ctx, '#f7f5ef');
    H.hatY = H.c[1] + H.r[1] + 0.005;
    ctx.top = 1.81;
  },
  wick(ctx, L) {
    const sk = '#e4bc9c', suit = '#141519';
    ctx.body({ skin: sk, top: suit, pants: suit, shoe: '#050505', waist: 0.99, rough: 0.62 });
    const H = humanHead(ctx, { skin: sk, eye: { iris: '#3a2214', r: 0.0158, tall: 0.85 }, browColor: '#1b1612', brows: { t: 0.005, slope: 0.006 }, mouthStyle: { curve: -0.0005, w: 0.02 }, jaw: 0.16 });
    // beard: shell around lower face
    const bm = ctx.mat('#4a3a30', { rough: 1 });
    // jaw stubble: shell segment below the mouth, wrapping to the ears
    const bg = new THREE.SphereGeometry(1, 48, 10, PI * 0.5 - PI * 0.36, PI * 0.72, PI * 0.68, PI * 0.22);
    ctx.add('Head', place(bg, { p: [H.c[0], H.c[1] - 0.004, H.c[2] + 0.002], s: [H.r[0] * 1.015, H.r[1] * 1.0, H.r[2] * 1.02] }), bm);
    ctx.add('Head', tube([[-0.024, H.mouthY + 0.006, H.faceZ(-0.024, H.mouthY + 0.006) + 0.001], [0, H.mouthY + 0.013, H.faceZ(0, H.mouthY + 0.013) + 0.003], [0.024, H.mouthY + 0.006, H.faceZ(0.024, H.mouthY + 0.006) + 0.001]], 0.0035, 10, 6), bm);
    addShirtV(ctx, '#f4f4f2', '#0b0b0e', { w0: 0.055, lapelW: 0.024 });
    addTie(ctx, '#0b0b0d', {});
    // long hair
    const hc = '#1b1612';
    const m = hairCap(ctx, hc, { k: 1.07, theta: 1.9, tilt: -0.35, dy: 0.012, rough: 0.4, sheen: '#a08870' });
    const R = rng(4); const strands = [];
    ctx.add('Head', ellipsoid([0, H.c[1] + 0.05, H.c[2] - 0.01], [H.r[0] * 1.06, H.r[1] * 0.7, H.r[2] * 1.06], 32), m);
    for (let i = 0; i < 30; i++) { const th = PI * 0.42 + (i / 30) * PI * 1.16; strands.push({ th, ph: 0.9 + R() * 0.3, len: 0.16 + R() * 0.05, r: 0.04, dir: [Math.sin(th) * 0.18, -1, Math.cos(th) * 0.18 - 0.05], flat: 0.5, bend: 0.06, k: 0.98 }); }
    for (const s2 of [-1, 1]) strands.push({ th: s2 * 0.62, ph: 0.6, len: 0.13, r: 0.028, dir: [s2 * 0.12, -1, 0.25], flat: 0.45, k: 1.0, bend: 0.05 });
    spikes(ctx, hc, strands, { mat: m });
    H.hatY = H.c[1] + H.r[1] + 0.02;
    ctx.top = 1.83;
  },
  heisenberg(ctx, L) {
    const sk = '#efc9a8', jacket = '#3d4031';
    ctx.body({ skin: sk, top: jacket, pants: '#6f6a4e', shoe: '#2a1d14', waist: 1.0, rough: 0.8 });
    addShirtV(ctx, '#2b2b2b', jacket, { y1: 1.22, w0: 0.05, lapelW: 0.022 });
    const H = humanHead(ctx, { skin: sk, eye: { iris: '#5a6b3a' }, browColor: '#6a5a4a', mouthStyle: { curve: -0.002, w: 0.019 }, jaw: 0.18 });
    const gm = ctx.mat('#4a3b2a', { rough: 0.9, sheen: 0.4 });
    // goatee + moustache
    ctx.add('Head', ellipsoid([0, H.mouthY - 0.03, H.faceZ(0, H.mouthY - 0.03) - 0.006], [0.025, 0.022, 0.014], 20), gm);
    ctx.add('Head', tube([[-0.024, H.mouthY - 0.004, H.faceZ(-0.024, H.mouthY) + 0.001], [0, H.mouthY + 0.01, H.faceZ(0, H.mouthY + 0.01) + 0.004], [0.024, H.mouthY - 0.004, H.faceZ(0.024, H.mouthY) + 0.001]], 0.0055, 12, 6), gm);
    // glasses (rectangular, thin frame)
    const fm = ctx.mat('#2a2018', { rough: 0.3, clearcoat: 1 });
    for (const s of [-1, 1]) { const x = s * H.eyeX, z = H.faceZ(x, H.eyeY) + 0.012; ctx.add('Head', place(bandGeo(1, 1, 1, 0.12, 4, PI / 4), { p: [x, H.eyeY, z], s: [0.03, 0.022, 0.026], r: [PI / 2, 0, 0] }), fm); }
    ctx.add('Head', capsuleBetween([-0.015, H.eyeY + 0.005, H.faceZ(0, H.eyeY) + 0.012], [0.015, H.eyeY + 0.005, H.faceZ(0, H.eyeY) + 0.012], 0.002, 6), fm);
    for (const s of [-1, 1]) ctx.add('Head', capsuleBetween([s * (H.eyeX + 0.03), H.eyeY + 0.004, H.faceZ(H.eyeX, H.eyeY) + 0.008], [s * H.r[0] * 1.0, H.eyeY + 0.0, H.c[2] - 0.02], 0.002, 6), fm);
    // pork pie hat
    const hm = ctx.mat('#141414', { rough: 0.7, sheen: 0.4 });
    const hy = H.c[1] + H.r[1] * 0.55;
    ctx.add('Head', place(new THREE.CylinderGeometry(1, 1, 1, 40), { p: [0, hy - 0.002, H.c[2] - 0.004], s: [H.r[0] * 1.75, 0.008, H.r[2] * 1.65] }), hm);
    ctx.add('Head', place(new THREE.CylinderGeometry(0.98, 1.0, 1, 40), { p: [0, hy + 0.04, H.c[2] - 0.004], s: [H.r[0] * 1.05, 0.08, H.r[2] * 1.03] }), hm);
    ctx.add('Head', place(new THREE.CylinderGeometry(1.0, 1.0, 1, 40, 1, true), { p: [0, hy + 0.012, H.c[2] - 0.004], s: [H.r[0] * 1.065, 0.016, H.r[2] * 1.045] }), ctx.mat('#2c2c2c', { rough: 0.5, side: THREE.DoubleSide }));
    H.hatY = hy + 0.085; H.noHat = true;
    ctx.top = hy + 0.085;
  },
};
function gokuBuild(ctx, ssj) {
  const sk = '#f4cfae', orange = '#ff6f12', blue = '#1d4fc8';
  ctx.body({ skin: sk, top: orange, pants: orange, shoe: blue, sole: '#c7342c', belt: blue, waist: 1.04, sleeve: blue, sleeveU: 0.3, bootY: 0.22, rough: 0.8,
    extra: (v) => {
      if (v.zone === 'arm' && v.u > 0.84) return blue;
    } });
  const H = humanHead(ctx, { skin: sk, eye: { iris: ssj ? '#1fb5a8' : '#111111', r: 0.0168, tall: 0.88, glow: ssj ? '#0a5a54' : undefined }, browColor: ssj ? '#e0b030' : '#111', brows: { t: 0.005, slope: 0.016 }, mouthStyle: { curve: 0.004, smirk: 0.004 }, jaw: 0.22 });
  addShirtV(ctx, blue, '#ff8a30', { y1: 1.27, w0: 0.085, lapelW: 0.016, collar: false });
  ctx.add('@torso', place(new THREE.CircleGeometry(0.035, 32), { p: [0.075, 1.35, chestZ(0.075, 1.35, 0.008)], r: [-0.25, 0.35, 0] }), ctx.mat('#ffffff', { map: kameTex(), rough: 0.6 }));
  const hc = ssj ? '#ffd94a' : '#111216';
  const ho = ssj ? { sheen: '#fff2a0', emissive: '#7a5a00', ei: 0.35 } : { sheen: '#5a6a8a' };
  hairCap(ctx, hc, { k: 1.05, theta: 1.7, tilt: -0.45, dy: 0.01, ...ho });
  const list = [];
  if (ssj) {
    const R = rng(77);
    for (let i = 0; i < 24; i++) { const th = (i / 24) * TAU, ph = 0.2 + R() * 0.8; list.push({ th, ph, len: 0.16 + R() * 0.1, r: 0.04, up: 2.2, back: 0.35, bend: (R() - 0.5) * 0.25, flat: 0.55 }); }
    list.push({ th: 0.1, ph: 0.95, len: 0.09, r: 0.012, dir: [0.1, -1, 0.5], flat: 0.6, bend: 0.4 });
  } else {
    const big = [[0.0, 0.15, [0.15, 1, 0.1], 0.2], [0.9, 0.35, [0.7, 0.9, -0.1], 0.19], [-0.9, 0.35, [-0.7, 0.9, -0.1], 0.19], [1.8, 0.6, [0.9, 0.4, -0.5], 0.17], [-1.8, 0.6, [-0.9, 0.4, -0.5], 0.17],
      [PI, 0.5, [0, 0.6, -1], 0.16], [2.6, 0.9, [0.6, 0.1, -0.9], 0.14], [-2.6, 0.9, [-0.6, 0.1, -0.9], 0.14], [0.5, 0.2, [0.4, 1, 0.3], 0.18], [-0.5, 0.2, [-0.4, 1, 0.3], 0.18]];
    for (const [th, ph, d, len] of big) list.push({ th, ph, len, r: 0.045, dir: d, flat: 0.55, bend: 0.12 });
    for (let i = 0; i < 5; i++) list.push({ th: -0.55 + i * 0.27, ph: 0.85, len: 0.075, r: 0.026, dir: [(-0.55 + i * 0.27) * 0.8, -0.5, 1], flat: 0.5, bend: -0.2 });
  }
  spikes(ctx, hc, list, ho);
  H.hatY = H.c[1] + H.r[1] + (ssj ? 0.1 : 0.07); H.hatR = H.r[0] * 1.25;
  ctx.top = ssj ? 2.02 : 1.97;
}
function headFrameBox(ctx, o) {
  const H = ctx.H;
  Object.assign(H, { bone: o.bone, c: o.c, r: o.r, eyeY: o.eyeY, eyeX: o.eyeX, mouthY: o.mouthY, hatY: o.top, hatR: 0.11, box: true });
  H.faceZ = () => o.fz; H.mouth = [0, o.mouthY, o.fz];
  ctx.chest = { bone: 'Spine1', fy: 1.3, fz: o.fz + 0.004, ny: 1.42, w: 0.12, bz: o.fz - 0.06, box: true };
}

// ------------------------------------------------------------------------------------------------ accessories
const ACC = {
  sunglasses(ctx) {
    const H = ctx.H, bone = H.bone;
    const lens = ctx.mat('#0c0d10', { rough: 0.05, metal: 0.3, clearcoat: 1, ccr: 0.02, env: 1.6 }), frame = ctx.mat('#d4ae55', { metal: 1, rough: 0.25 });
    const big = H.box ? 1.9 : 1;
    const lw = (H.box ? 0.075 : 0.026) * (H.box ? 1 : 1), lh = H.box ? 0.06 : 0.019;
    const sh = new THREE.Shape(); sh.absellipse(0, 0, lw, lh, 0, TAU, false, 0);
    for (const s of [-1, 1]) {
      const x = s * H.eyeX * (H.box ? 1 : 1.02), z = H.faceZ(x, H.eyeY) + (H.box ? 0.06 : 0.012) + (H.box ? 0 : 0.006);
      ctx.add(bone, place(extrudeShape(sh, 0.004, 0.0015), { p: [x, H.eyeY - 0.002, z], r: [0, s * 0.12, 0] }), lens);
      ctx.add(bone, place(new THREE.TorusGeometry(1, 0.08, 6, 40), { p: [x, H.eyeY - 0.002, z + 0.001], s: [lw * 1.02, lh * 1.04, lw], r: [0, s * 0.12, 0] }), frame);
      if (!H.box) ctx.add(bone, capsuleBetween([s * (H.eyeX + lw * 0.95), H.eyeY + 0.005, z - 0.004], [s * H.r[0] * 0.99, H.eyeY + 0.006, H.c[2] - 0.015], 0.0018, 6), frame);
    }
    const z0 = H.faceZ(0, H.eyeY) + (H.box ? 0.06 : 0.018);
    ctx.add(bone, tube([[-H.eyeX + lw * 0.7, H.eyeY + lh * 0.6, z0], [0, H.eyeY + lh * 0.8, z0 + 0.002], [H.eyeX - lw * 0.7, H.eyeY + lh * 0.6, z0]], 0.0018 * big, 10, 5), frame);
  },
  chain(ctx) {
    const C = ctx.chest, gold = ctx.mat('#e0b84f', { metal: 1, rough: 0.18 });
    const pts = [], N = 48;
    const zc = (C.fz + C.bz) / 2, rz = (C.fz - C.bz) / 2;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, f = ((1 + Math.cos(a)) / 2) ** 2;
      const x = C.w * Math.sin(a) * (1 + 0.25 * f), y = C.ny - (C.ny - C.fy) * f;
      let z = zc + rz * Math.cos(a);
      if (!C.box) z = Math.cos(a) > 0 ? Math.max(z, chestZ(x, y, 0.009)) : Math.min(z, backZ(x, y, 0.009));
      pts.push([x, y, z]);
    }
    // twisted rope: two helices
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => v3(...p)), true);
    const fr = curve.computeFrenetFrames(240, true);
    for (const ph of [0, PI]) {
      const hp = [];
      for (let i = 0; i < 240; i++) { const t = i / 240, p = curve.getPointAt(t), a = t * 120 * PI + ph; const n = fr.normals[i], b = fr.binormals[i]; hp.push([p.x + 0.0028 * (Math.cos(a) * n.x + Math.sin(a) * b.x), p.y + 0.0028 * (Math.cos(a) * n.y + Math.sin(a) * b.y), p.z + 0.0028 * (Math.cos(a) * n.z + Math.sin(a) * b.z)]); }
      ctx.add(C.bone, tube(hp, 0.0026, 480, 5, true), gold);
    }
    const pz = C.box ? C.fz + 0.012 : chestZ(0, C.fy - 0.03, 0.012);
    ctx.add(C.bone, place(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 32), { p: [0, C.fy - 0.03, pz], r: [PI / 2 - 0.25, 0, 0] }), gold);
    ctx.add(C.bone, place(new THREE.TorusGeometry(0.019, 0.003, 8, 32), { p: [0, C.fy - 0.03, pz + 0.004], r: [-0.25, 0, 0] }), gold);
    ctx.add(C.bone, place(new THREE.OctahedronGeometry(0.009, 0), { p: [0, C.fy - 0.03, pz + 0.006], s: [1, 1, 0.5] }), ctx.mat('#ffffff', { rough: 0.02, metal: 0.2, clearcoat: 1, env: 2 }));
  },
  cap(ctx, L) {
    const H = ctx.H; if (H.noHat) return;
    const col = ctx.L.skin in ORIGINAL_DEFAULTS ? ctx.L.c2 : '#141414';
    const m = ctx.mat(col, { rough: 0.75, sheen: 0.5 });
    const R = H.box ? 0.13 : Math.max(H.hatR || 0, H.r[0] * 1.12);
    const y = (H.box ? H.hatY - 0.005 : H.hatY - R * 0.62);
    const cz = H.box ? 0.0 : H.c[2] - 0.004;
    ctx.add(H.bone, place(new THREE.SphereGeometry(1, 36, 18, 0, TAU, 0, PI / 2), { p: [0, y, cz], s: [R, R * 0.78, R * 1.08] }), m);
    const brim = new THREE.Shape(); brim.absellipse(0, 0, R * 0.95, R * 0.95, 0, PI, false, 0);
    const bg = extrudeShape(brim, 0.006, 0.002); place(bg, { r: [PI / 2 + 0.12, 0, 0] });
    ctx.add(H.bone, place(bg, { p: [0, y + 0.004, cz + R * 1.0] }), m);
    ctx.add(H.bone, place(new THREE.SphereGeometry(0.008, 12, 8), { p: [0, y + R * 0.78, cz] }), m);
    ctx.add(H.bone, place(new THREE.CircleGeometry(0.016, 24), { p: [0, y + R * 0.4, cz + R * 0.98], r: [-0.45, 0, 0] }), ctx.mat('#d4ae55', { metal: 1, rough: 0.3 }));
    if (ctx.top < y + R * 0.8) ctx.top = y + R * 0.8;
  },
  crown(ctx) {
    const H = ctx.H; if (H.noHat) return;
    const R = H.box ? 0.1 : Math.max(0.075, (H.hatR || H.r[0]) * 0.75);
    const y = H.box ? H.hatY : H.hatY - 0.01;
    const gold = ctx.mat('#e2b84a', { metal: 1, rough: 0.2 });
    const g = new THREE.CylinderGeometry(R, R * 0.92, 0.06, 64, 1, true), a = g.attributes.position;
    for (let i = 0; i < a.count; i++) if (a.getY(i) > 0) { const ang = Math.atan2(a.getX(i), a.getZ(i)); a.setY(i, a.getY(i) + 0.035 * Math.pow(Math.abs(Math.cos(ang * 4)), 3)); }
    g.computeVertexNormals();
    ctx.add(H.bone, place(bandGeo(R, R * 0.92, 0.05, 0.004, 64), { p: [0, y + 0.005, H.box ? 0 : H.c[2]] }), gold);
    ctx.add(H.bone, place(g, { p: [0, y + 0.01, H.box ? 0 : H.c[2]] }), ctx.mat('#e2b84a', { metal: 1, rough: 0.2, side: THREE.DoubleSide }));
    const gems = [ctx.mat('#c4102a', { rough: 0.05, clearcoat: 1, env: 2 }), ctx.mat('#1f4fd1', { rough: 0.05, clearcoat: 1, env: 2 })];
    for (let i = 0; i < 8; i++) { const ang = (i / 8) * TAU; ctx.add(H.bone, ellipsoid([Math.sin(ang) * R * 1.03, y - 0.003, (H.box ? 0 : H.c[2]) + Math.cos(ang) * R * 1.03], [0.008, 0.008, 0.008], 12), gems[i % 2]); }
    for (let i = 0; i < 8; i++) { const ang = (i / 8) * TAU + PI / 8; ctx.add(H.bone, ellipsoid([Math.sin(ang) * R * 1.0, y + 0.065, (H.box ? 0 : H.c[2]) + Math.cos(ang) * R * 1.0], [0.006, 0.006, 0.006], 10), gold); }
    if (ctx.top < y + 0.08) ctx.top = y + 0.08;
  },
  cigar(ctx) {
    const H = ctx.H, m = H.mouth, x = m[0] - (H.box ? 0.08 : 0.014), y = m[1] - 0.004, z = m[2] + 0.004;
    const dir = v3(-0.35, -0.22, 1).normalize(), len = H.box ? 0.15 : 0.11;
    const q = basisQ(dir);
    const mid = v3(x, y, z).add(dir.clone().multiplyScalar(len / 2));
    const r = H.box ? 0.012 : 0.0085;
    ctx.add(H.bone, place(new THREE.CylinderGeometry(r, r, len, 16), { p: mid.toArray(), q }), ctx.mat('#6b3f1f', { rough: 0.85 }));
    const band = v3(x, y, z).add(dir.clone().multiplyScalar(len * 0.2));
    ctx.add(H.bone, place(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.012, 16), { p: band.toArray(), q }), ctx.mat('#d4ae55', { metal: 0.8, rough: 0.3 }));
    const tip = v3(x, y, z).add(dir.clone().multiplyScalar(len + 0.004));
    ctx.add(H.bone, place(new THREE.CylinderGeometry(r * 0.95, r, 0.01, 16), { p: tip.toArray(), q }), ctx.mat('#8d8a86', { rough: 1 }));
    ctx.add(H.bone, place(new THREE.CircleGeometry(r * 0.8, 16), { p: tip.clone().add(dir.clone().multiplyScalar(0.0052)).toArray(), q: q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-PI / 2, 0, 0))) }), ctx.mat('#ff5a1a', { emissive: '#ff4a10', ei: 2.5 }));
  },
  headphones(ctx) {
    const H = ctx.H; if (H.noHat && !H.box) { /* hat: still fine */ }
    const black = ctx.mat('#151517', { rough: 0.35, clearcoat: 0.6 }), gold = ctx.mat('#d4ae55', { metal: 1, rough: 0.25 }), pad = ctx.mat('#2a2a2c', { rough: 0.9 });
    const rx = H.box ? 0.33 : H.r[0] * 1.13, cy = H.box ? 1.62 : H.eyeY - 0.005, cz = H.box ? 0.02 : H.c[2] - 0.01;
    const top = H.box ? 1.85 : Math.max(H.hatY - 0.01, H.c[1] + H.r[1] * 1.05);
    const band = new THREE.TorusGeometry(1, 0.06, 10, 48, PI); place(band, { s: [rx, top - cy, 0.2] });
    ctx.add(H.bone, place(band, { p: [0, cy, cz] }), black);
    for (const s of [-1, 1]) {
      ctx.add(H.bone, place(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 32), { p: [s * (rx + 0.004), cy, cz], r: [0, 0, PI / 2] }), black);
      ctx.add(H.bone, place(new THREE.TorusGeometry(0.036, 0.012, 10, 32), { p: [s * (rx - 0.012), cy, cz], r: [0, PI / 2, 0] }), pad);
      ctx.add(H.bone, place(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 32), { p: [s * (rx + 0.021), cy, cz], r: [0, 0, PI / 2] }), gold);
    }
  },
};

// ------------------------------------------------------------------------------------------------ customizer
export function openCustomizer(api, look, onSave) {
  let L = normLook(look || {});
  const card = api.open(`
    <style>
      .avc{display:grid;grid-template-columns:360px 1fr;gap:22px;align-items:start}
      .avc .pv{position:relative;width:360px;max-width:100%}
      .avc canvas.av{display:block;width:100%;aspect-ratio:360/460;height:auto;background:radial-gradient(ellipse at 50% 35%,#2a241c 0%,#0c0b0a 70%);border:1px solid var(--line);cursor:grab;touch-action:none}
      .avc .em{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .avc .em button{padding:6px 9px;font-size:11px}
      .avc .grp{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin:12px 0 6px}
      .avc .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px}
      .avc .sk{display:flex;align-items:center;gap:8px;text-align:left;padding:8px 9px;font-size:12px;letter-spacing:.02em}
      .avc .sk i{flex:none;width:14px;height:14px;border-radius:50%;box-shadow:inset -4px -4px 0 rgba(0,0,0,.0)}
      .avc .sk.on{border-color:var(--gold);color:var(--gold);background:rgba(214,178,110,.08)}
      .avc .opt{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
      .avc .opt button{padding:7px 10px;font-size:11px}
      .avc .opt button.on{border-color:var(--gold);color:var(--gold);background:rgba(214,178,110,.08)}
      .avc label.col{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--cream)}
      .avc input[type=color]{width:34px;height:26px;border:1px solid var(--line);background:none;padding:0;cursor:pointer}
      .avc .tone{width:24px;height:24px;border-radius:50%;padding:0;border:2px solid transparent}
      .avc .tone.on{border-color:var(--gold)}
      .avc input[type=range]{width:180px;accent-color:#d6b26e}
      .avc .note{font-size:12px;color:var(--muted)}
      .avc .ctl{max-height:min(72vh,640px);overflow:auto;padding-right:4px}
      @media (max-width:760px){.avc{grid-template-columns:1fr}.avc .pv{margin:0 auto}}
    </style>
    <h2>Your <em>look</em></h2>
    <div class="avc">
      <div class="pv"><canvas class="av" width="360" height="460"></canvas>
        <div class="em">${EMOTES.map((e) => `<button data-em="${e}">${e[0].toUpperCase() + e.slice(1)}</button>`).join('')}</div>
      </div>
      <div class="ctl">
        <div data-skins></div>
        <div data-orig>
          <div class="grp">Outfit</div>
          <div class="opt"><label class="col"><input type="color" data-c="c1"> Primary</label><label class="col"><input type="color" data-c="c2"> Accent</label></div>
          <div class="grp">Skin tone</div><div class="opt" data-tones></div>
          <div class="grp">Hair</div><div class="opt" data-hair></div>
          <div class="opt" style="margin-top:8px"><label class="col"><input type="color" data-c="hc"> Hair colour</label></div>
        </div>
        <div data-sig class="note" style="margin-top:12px" hidden>Signature character: outfit colours are fixed. Accessories, height and tag colour still apply.</div>
        <div class="grp">Accessories</div><div class="opt" data-acc></div>
        <div class="grp">Height</div><div class="opt"><input type="range" min="0.9" max="1.1" step="0.01" data-h><span class="note" data-hv></span></div>
        <div class="grp">Name tag</div><div class="opt"><label class="col"><input type="color" data-c="tag"> Tag colour</label></div>
        <div class="row"><button class="primary" data-save>Save look</button><button data-close>Cancel</button></div>
      </div>
    </div>`, { wide: true });
  const $ = (s) => card.querySelector(s), $$ = (s) => [...card.querySelectorAll(s)];
  const canvas = $('canvas.av');

  // preview renderer
  let renderer = null, scene = null, cam = null, avatar = null, envRT = null, raf = 0, alive = true, yaw = 0.5, drag = null, last = performance.now();
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(360, 460, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.2;
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(30, 360 / 460, 0.1, 30);
    import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      if (!alive) return;
      const pm = new THREE.PMREMGenerator(renderer); const room = new RoomEnvironment();
      envRT = pm.fromScene(room, 0.04); scene.environment = envRT.texture; room.dispose?.(); pm.dispose();
    }).catch(() => {});
    scene.add(new THREE.HemisphereLight(0xfff0dd, 0x221a12, 0.8));
    const key = new THREE.DirectionalLight(0xffe2b8, 2.2); key.position.set(2, 3, 2.5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.4); rim.position.set(-2.5, 2, -2); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshStandardMaterial({ color: 0x0d0b09, roughness: 0.55, metalness: 0, envMapIntensity: 0.25 }));
    floor.rotation.x = -PI / 2; scene.add(floor);
  } catch (e) { console.warn('customizer preview unavailable', e); renderer = null; }

  const rebuild = () => {
    if (!scene || !_assets) return;
    if (!avatar) { avatar = createAvatar(_assets, L); scene.add(avatar.root); } else avatar.setLook(L);
    const h = avatar.height;
    cam.position.set(0, h * 0.6, 1.3 + h * 1.25); cam.lookAt(0, h * 0.5, 0);
  };
  loadAvatarAssets(null).then(() => { if (alive) rebuild(); }).catch((e) => console.warn(e));

  const loop = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!drag) yaw += dt * 0.35;
    if (avatar) { avatar.root.rotation.y = yaw; avatar.update(dt, { speed: 0 }); }
    if (renderer) renderer.render(scene, cam);
  };
  raf = requestAnimationFrame(loop);
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, yaw }; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (drag) yaw = drag.yaw + (e.clientX - drag.x) * 0.012; });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

  // controls
  const groups = [...new Set(SKINS.map((s) => s.group))];
  $('[data-skins]').innerHTML = groups.map((g) => `<div class="grp">${g}</div><div class="grid">${SKINS.filter((s) => s.group === g).map((s) =>
    `<button class="sk" data-skin="${s.id}"><i style="background:linear-gradient(135deg,${SWATCH[s.id][0]} 50%,${SWATCH[s.id][1]} 50%)"></i>${s.name}</button>`).join('')}</div>`).join('');
  $('[data-tones]').innerHTML = TONES.map((t, i) => `<button class="tone" data-tone="${i}" style="background:${t}" aria-label="Skin tone ${i + 1}"></button>`).join('');
  $('[data-hair]').innerHTML = HAIRS.map((h) => `<button data-hairs="${h}">${h[0].toUpperCase() + h.slice(1)}</button>`).join('');
  $('[data-acc]').innerHTML = ACCESSORIES.map((a) => `<button data-a="${a.id}">${a.name}</button>`).join('');
  const sync = () => {
    $$('[data-skin]').forEach((b) => b.classList.toggle('on', b.dataset.skin === L.skin));
    const orig = L.skin in ORIGINAL_DEFAULTS;
    $('[data-orig]').hidden = !orig; $('[data-sig]').hidden = orig;
    $$('[data-c]').forEach((i) => (i.value = L[i.dataset.c]));
    $$('[data-tone]').forEach((b) => b.classList.toggle('on', +b.dataset.tone === L.tone));
    $$('[data-hairs]').forEach((b) => b.classList.toggle('on', b.dataset.hairs === L.hair));
    $$('[data-a]').forEach((b) => b.classList.toggle('on', L.acc.includes(b.dataset.a)));
    $('[data-h]').value = L.h; $('[data-hv]').textContent = `${Math.round(L.h * 100)}%`;
  };
  const changed = () => { L = normLook(L); sync(); rebuild(); };
  card.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !card.contains(b)) return;
    if (b.dataset.skin) {
      const id = b.dataset.skin;
      if (id in ORIGINAL_DEFAULTS && !(L.skin in ORIGINAL_DEFAULTS)) { const d = ORIGINAL_DEFAULTS[id]; L = { ...L, c1: d.c1, c2: d.c2 }; }
      else if (id in ORIGINAL_DEFAULTS && L.skin in ORIGINAL_DEFAULTS && id !== L.skin) { const d = ORIGINAL_DEFAULTS[id]; L = { ...L, c1: d.c1, c2: d.c2 }; }
      L.skin = id; changed();
    } else if (b.dataset.tone != null) { L.tone = +b.dataset.tone; changed(); }
    else if (b.dataset.hairs) { L.hair = b.dataset.hairs; changed(); }
    else if (b.dataset.a) { const a = b.dataset.a; L.acc = L.acc.includes(a) ? L.acc.filter((x) => x !== a) : [...L.acc, a]; changed(); }
    else if (b.dataset.em) { avatar?.emote(b.dataset.em); }
    else if (b.hasAttribute('data-save')) { const out = normLook(L); cleanup(); onSave?.(out); api.close?.(); }
  });
  let colT = 0;
  $$('[data-c]').forEach((i) => i.addEventListener('input', () => {
    L[i.dataset.c] = i.value;
    if (i.dataset.c === 'tag') return;
    clearTimeout(colT); colT = setTimeout(changed, 120);
  }));
  $('[data-h]').addEventListener('input', (e) => { L.h = +e.target.value; $('[data-hv]').textContent = `${Math.round(L.h * 100)}%`; if (avatar) avatar.root.children[0].scale.setScalar(avatar.root.children[0].scale.x / (avatar.look.h || 1) * L.h), (avatar.look.h = L.h); });
  $('[data-h]').addEventListener('change', changed);
  sync();

  let cleaned = false;
  function cleanup() {
    if (cleaned) return; cleaned = true; alive = false;
    cancelAnimationFrame(raf); clearTimeout(colT);
    if (avatar) avatar.dispose();
    if (envRT) envRT.dispose();
    if (scene) scene.traverse((o) => { if (o.isMesh && o.parent === scene) { o.geometry.dispose(); o.material.dispose(); } });
    if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); }
    renderer = null; scene = null; avatar = null;
  }
  api.onClose?.(cleanup);
  return { close: cleanup };
}
