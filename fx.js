// The Vault: set pieces, ambient effects and extra activities.
// Everything here is procedural (geometry, shaders, canvas textures, WebAudio). No external assets.
// Contract: export default async function installFX(ctx); also exports celebrate(pos) for confetti bursts.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let FX = null;
/** Confetti + gold spark burst at a world position ({x,y,z} or Vector3). Defaults to the local player. */
export function celebrate(pos) { (FX || window.__vaultFX)?.celebrate?.(pos); }

export default async function installFX(ctx) {
  const { THREE, scene, camera, renderer, tickers, interact, colliders, toast, broadcast, player, launchGame, gameApi, media, envHall, envGarage, cars } = ctx;
  const root = new THREE.Group(); root.name = 'FX'; scene.add(root);
  const T = { value: 0 }; // shared time uniform
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const store = { get(k, d) { try { const v = localStorage.getItem('vault.fx.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('vault.fx.' + k, JSON.stringify(v)); } catch {} } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await Promise.race([Promise.all([
    document.fonts?.load('500 80px "Bodoni Moda"'), document.fonts?.load('italic 500 80px "Bodoni Moda"'),
    document.fonts?.load('700 40px Manrope'), document.fonts?.load('500 40px "JetBrains Mono"'),
  ]).catch(() => {}), sleep(2500)]);

  // ------------------------------------------------------------ helpers
  const add = (o, x = 0, y = 0, z = 0, parent = root) => { o.position.set(x, y, z); parent.add(o); return o; };
  const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z, parent);
  const std = (color, roughness = 0.5, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const glow = (r, g, b, k = 1, extra = {}) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r * k, g * k, b * k), ...extra });
  const addGlow = (r, g, b, k = 1, extra = {}) => glow(r, g, b, k, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...extra });
  const collider = (x0, x1, z0, z1) => { const c = { x0, x1, z0, z1 }; colliders.push(c); return c; };
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw?.(g, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    t.userData.g = g; return t;
  }
  // Clear glass: env reflection added on top, background attenuated by fresnel alpha.
  function glassMat({ a0 = 0.05, a1 = 0.55, rough = 0.03, env = 1.6, side = THREE.FrontSide } = {}) {
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: rough, metalness: 0, envMapIntensity: env, transparent: true, depthWrite: false, side });
    m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
        `float frG = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 4.0);
         gl_FragColor = vec4(outgoingLight * (0.45 + 0.55 * frG), mix(${a0.toFixed(3)}, ${a1.toFixed(3)}, frG));`);
    };
    m.customProgramCacheKey = () => `fxglass${a0}${a1}`;
    return m;
  }
  const OUT = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
  const NOISE = `
    float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
    float caustic(vec2 p, float t){
      vec2 i = p; float c = 1.0; float inten = 0.005;
      for (int n = 0; n < 5; n++) { float tt = t * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten))); }
      c /= 5.0; c = 1.17 - pow(c, 1.4); return clamp(pow(abs(c), 8.0), 0.0, 1.0);
    }`;
  const quality = () => { try { return JSON.parse(localStorage.getItem('vault.quality')) || 'medium'; } catch { return 'medium'; } };
  const safe = (name, fn) => { try { fn(); } catch (e) { console.warn('fx: ' + name + ' failed', e); } };
  const DBG = {};
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector2();

  // Writes a basis (forward = +z of the model) straight into an InstancedMesh matrix.
  function setInst(arr, i, px, py, pz, fx, fy, fz, s) {
    let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let xx = fz, xz = -fx; l = Math.hypot(xx, xz) || 1; xx /= l; xz /= l; // right = up x f
    const yx = fy * xz, yy = fz * xx - fx * xz, yz = -fy * xx; // up' = f x right
    const o = i * 16;
    arr[o] = xx * s; arr[o + 1] = 0; arr[o + 2] = xz * s; arr[o + 3] = 0;
    arr[o + 4] = yx * s; arr[o + 5] = yy * s; arr[o + 6] = yz * s; arr[o + 7] = 0;
    arr[o + 8] = fx * s; arr[o + 9] = fy * s; arr[o + 10] = fz * s; arr[o + 11] = 0;
    arr[o + 12] = px; arr[o + 13] = py; arr[o + 14] = pz; arr[o + 15] = 1;
  }

  // ------------------------------------------------------------ music analysis (drives the light shows)
  const PALETTES = [
    { name: 'Gold', a: [1.0, 0.62, 0.28], b: [1.0, 0.86, 0.66] },
    { name: 'Neon', a: [1.0, 0.12, 0.5], b: [0.15, 0.8, 1.0] },
    { name: 'Ocean', a: [0.08, 0.45, 1.0], b: [0.25, 1.0, 0.8] },
    { name: 'Sunset', a: [1.0, 0.3, 0.06], b: [0.9, 0.15, 0.7] },
  ];
  const M = { bass: 0, mid: 0, high: 0, beat: 0, on: false, party: store.get('party', false), show: 0, strobe: 0, pal: store.get('palette', 0), bands: new Float32Array(16), beats: 0 };
  const palA = new THREE.Color(), palB = new THREE.Color();
  let bassAvg = 0.2, lastBeat = 0;
  tickers.push((dt, t) => {
    T.value = t;
    let b = 0, m = 0, h = 0;
    const live = !!(media.analyser && media.playing && media.data);
    if (live) {
      const d = media.data; media.analyser.getByteFrequencyData(d);
      for (let i = 0; i < 3; i++) b += d[i]; b /= 3 * 255;
      for (let i = 4; i < 24; i++) m += d[i]; m /= 20 * 255;
      for (let i = 24; i < 90; i++) h += d[i]; h /= 66 * 255;
      for (let k = 0; k < 16; k++) {
        const i0 = Math.floor(Math.pow(1.32, k)) - 1, i1 = Math.max(i0 + 1, Math.floor(Math.pow(1.32, k + 1)) - 1);
        let s = 0; for (let i = i0; i < i1 && i < d.length; i++) s += d[i];
        const v = s / ((i1 - i0) * 255);
        M.bands[k] = Math.max(v, M.bands[k] - dt * 1.6);
      }
    } else if (M.party) {
      const ph = (t * 124 / 60) % 1, ph2 = (t * 248 / 60) % 1;
      b = Math.exp(-ph * 5) * 0.9; m = 0.4 + 0.15 * Math.sin(t * 2.1); h = 0.35 * Math.exp(-ph2 * 7);
      for (let k = 0; k < 16; k++) M.bands[k] = Math.max(clamp((k < 4 ? b : k < 10 ? m * (0.8 + 0.4 * Math.sin(t * 3 + k)) : h * 1.6) * (1 - k / 30), 0, 1), M.bands[k] - dt * 1.6);
    } else for (let k = 0; k < 16; k++) M.bands[k] = Math.max(0, M.bands[k] - dt * 1.2);
    const kk = Math.min(1, dt * 16);
    M.bass += (b - M.bass) * kk; M.mid += (m - M.mid) * kk; M.high += (h - M.high) * kk;
    bassAvg += (b - bassAvg) * Math.min(1, dt * 1.5);
    if (b > bassAvg * 1.25 && b > 0.32 && t - lastBeat > 0.28) { M.beat = 1; lastBeat = t; M.beats++; }
    M.beat *= Math.exp(-dt * 7);
    M.strobe = Math.max(0, M.strobe - dt);
    M.on = live || M.party;
    M.show += ((M.on ? (M.party ? 1 : 0.55) : 0) - M.show) * Math.min(1, dt * 0.8);
    const P = PALETTES[M.pal] || PALETTES[0];
    palA.setRGB(...P.a); palB.setRGB(...P.b);
  });

  // ============================================================ GARAGE
  safe('hero hologram', () => {
    const C = new THREE.Vector3(-16, 0, 0);
    // scanner: a ring + translucent slicing sheet that sweeps up through the car
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.012, 6, 160), addGlow(0.35, 0.85, 1.0, 5)), C.x, 0.2, C.z);
    ring.rotation.x = PI / 2;
    const sheetMat = new THREE.ShaderMaterial({
      uniforms: { time: T, op: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float time, op; varying vec2 vP;
        void main(){ float r = length(vP) / 3.05;
          float grid = max(1.0 - smoothstep(0.0, 0.02, abs(fract(vP.x * 2.5) - 0.5) * 2.0 - 0.96), 1.0 - smoothstep(0.0, 0.02, abs(fract(vP.y * 2.5) - 0.5) * 2.0 - 0.96));
          float a = (pow(r, 8.0) * 0.7 + grid * 0.07 * r + 0.01) * smoothstep(1.0, 0.97, r);
          gl_FragColor = vec4(vec3(0.3, 0.8, 1.0) * a * op, 1.0); ${OUT} }`,
    });
    const sheet = add(new THREE.Mesh(new THREE.CircleGeometry(3.05, 96), sheetMat), C.x, 0.2, C.z);
    sheet.rotation.x = -PI / 2;
    // data ring on the floor around the turntable
    const dataRing = add(new THREE.Mesh(new THREE.RingGeometry(3.32, 3.46, 192, 1), new THREE.ShaderMaterial({
      uniforms: { time: T }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float time; varying vec2 vP;
        void main(){ float a = atan(vP.y, vP.x); float r = length(vP);
          float ticks = step(0.82, fract(a * 180.0 / 3.14159 / 2.0));
          float dash = step(0.5, fract(a * 6.0 / 3.14159 + time * 0.08));
          float inner = 1.0 - smoothstep(0.0, 0.012, abs(r - 3.35));
          float outer = 1.0 - smoothstep(0.0, 0.01, abs(r - 3.44));
          float v = inner * (0.35 + 0.65 * dash) + outer * 0.5 + ticks * step(3.37, r) * step(r, 3.42) * 0.5;
          gl_FragColor = vec4(vec3(0.35, 0.8, 1.0) * v * 1.4, 1.0); ${OUT} }`,
    })), C.x, 0.006, C.z);
    dataRing.rotation.x = -PI / 2;
    // floating spec panels orbiting the car
    const specs = [['HYPERCAR', 'Chiron Profilée'], ['POWER', '1,500 hp'], ['TOP SPEED', '380 km/h'], ['0 – 100', '2.3 s'], ['ENGINE', 'W16 · 8.0 L'], ['BUILT', '1 of 1']];
    const panels = specs.map(([k, v], i) => {
      const tex = canvasTex(512, 256, (g) => {
        g.clearRect(0, 0, 512, 256);
        const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(60,200,255,0.10)'); gr.addColorStop(1, 'rgba(60,200,255,0.02)');
        g.fillStyle = gr; g.fillRect(8, 8, 496, 240);
        g.strokeStyle = 'rgba(140,230,255,0.9)'; g.lineWidth = 3;
        for (const [x, y, dx, dy] of [[8, 8, 1, 1], [504, 8, -1, 1], [8, 248, 1, -1], [504, 248, -1, -1]]) { g.beginPath(); g.moveTo(x + dx * 40, y); g.lineTo(x, y); g.lineTo(x, y + dy * 40); g.stroke(); }
        g.fillStyle = 'rgba(140,230,255,0.08)'; for (let y = 10; y < 248; y += 4) g.fillRect(8, y, 496, 1);
        g.fillStyle = '#9fe9ff'; g.font = '700 26px Manrope, Arial'; g.letterSpacing = '6px'; g.fillText(k, 40, 70);
        g.fillStyle = '#ffffff'; g.font = '500 76px "Bodoni Moda", Georgia, serif'; g.letterSpacing = '0px';
        let fs = 76; while (g.measureText(v).width > 440 && fs > 30) { fs -= 4; g.font = `500 ${fs}px "Bodoni Moda", Georgia, serif`; }
        g.fillText(v, 38, 170);
        g.fillStyle = 'rgba(140,230,255,0.7)'; g.fillRect(40, 196, 120 + i * 40, 4);
      });
      const m = add(new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.625), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.8, 2.0) })), 0, 0, 0);
      return m;
    });
    // spotlight beam from the hero light
    tickers.push((dt, t) => {
      const cyc = (t % 9) / 9; // sweep up for 4.5s, then rest
      const up = cyc < 0.5 ? smooth(0, 1, cyc * 2) : 1 - smooth(0.5, 0.62, cyc);
      const y = 0.18 + (cyc < 0.5 ? up * 1.45 : 1.63 - (cyc - 0.5) * 2 * 1.45);
      const vis = cyc < 0.5 ? Math.sin(cyc * 2 * PI) : 0;
      ring.position.y = sheet.position.y = y;
      ring.material.opacity = 0.25 + 0.75 * vis; ring.visible = vis > 0.01 || cyc < 0.5;
      sheetMat.uniforms.op.value = vis * 0.9; sheet.visible = vis > 0.01;
      panels.forEach((p, i) => {
        const a = t * 0.12 + (i / panels.length) * TAU;
        p.position.set(C.x + Math.cos(a) * 3.55, 2.75 + Math.sin(t * 0.8 + i) * 0.06, C.z + Math.sin(a) * 3.55);
        p.rotation.y = -a + PI / 2;
        p.material.opacity = 0.85 + 0.15 * Math.sin(t * 13 + i * 3) * Math.sin(t * 1.7 + i);
      });
    });
  });

  // Soft volumetric light cones (additive) with dust motes drifting inside.
  const coneMat = (color, strength) => new THREE.ShaderMaterial({
    uniforms: { col: { value: new THREE.Color(...color) }, k: { value: strength } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN, vV; varying float vY; void main(){ vY = uv.y; vec4 w = modelMatrix * vec4(position,1.0);
      vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 col; uniform float k; varying vec3 vN, vV; varying float vY;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2); float v = f * smoothstep(0.0, 0.5, vY) * mix(0.35, 1.0, vY);
        gl_FragColor = vec4(col * v * k, 1.0); ${OUT} }`,
  });
  const motes = [];
  function lightCone(x, z, yTop, yBot, rTop, rBot, color, k, nMotes) {
    const h = yTop - yBot;
    const m = add(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 48, 1, true), coneMat(color, k)), x, yBot + h / 2, z);
    for (let i = 0; i < nMotes; i++) {
      const y = Math.random(), r = lerp(rBot, rTop, y) * Math.sqrt(Math.random()) * 0.9, a = Math.random() * TAU;
      motes.push(x + Math.cos(a) * r, yBot + y * h, z + Math.sin(a) * r, Math.random());
    }
    return m;
  }
  safe('light cones', () => {
    lightCone(-16, 0, 7.5, 0.1, 0.3, 3.1, [0.75, 0.85, 1.0], 0.06, 160);
    for (const [x, z] of [[12.5, 6], [19.5, 6], [16, 12]]) lightCone(x, z, 6.75, 0.95, 0.35, 1.9, [1.0, 0.75, 0.45], 0.05, 90);
    lightCone(0, 4, 2.22, 0.8, 0.85, 1.25, [1.0, 0.78, 0.5], 0.05, 40);
    const n = motes.length / 4, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = motes[i * 4]; pos[i * 3 + 1] = motes[i * 4 + 1]; pos[i * 3 + 2] = motes[i * 4 + 2]; seed[i] = motes[i * 4 + 3]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { time: T, scale: { value: 400 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float time, scale; attribute float aSeed; varying float vA;
        void main(){ vec3 p = position; float s = aSeed * 40.0;
          p += vec3(sin(time * 0.13 + s), sin(time * 0.09 + s * 1.7) * 1.4, cos(time * 0.11 + s * 0.6)) * 0.18;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          vA = 0.5 + 0.5 * sin(time * (0.6 + aSeed) + s);
          gl_PointSize = scale * (0.010 + 0.012 * aSeed) / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.75) * a * 0.9, 1.0); ${OUT} }`,
    }));
    pts.frustumCulled = false; root.add(pts);
    tickers.push(() => { pts.material.uniforms.scale.value = renderer.getDrawingBufferSize(_v2).y * 0.6; });
  });

  // ---- floor markings: pit-box corner brackets + bay numbers
  safe('bay markings', () => {
    const bays = [['n1', -21, -11, '01', 'PORSCHE 911 TURBO S'], ['n2', -16, -11, '02', 'LAMBORGHINI AVENTADOR'], ['n3', -11, -11, '03', 'HURACÁN SUPER TROFEO'],
      ['s1', -21, 11, '04', 'BRABUS G 900'], ['s2', -16, 11, '05', 'FERRARI 488 PISTA'], ['s3', -11, 11, '06', 'ROLLS-ROYCE GHOST']];
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-PI / 2);
    const mat = glow(1.0, 0.82, 0.55, 1.5, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const im = new THREE.InstancedMesh(geo, mat, bays.length * 8); let k = 0;
    const o = new THREE.Object3D();
    for (const [, x, z] of bays) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = x + sx * 1.6, cz = z + sz * 2.95;
      o.position.set(cx - sx * 0.22, 0.004, cz); o.scale.set(0.46, 1, 0.04); o.updateMatrix(); im.setMatrixAt(k++, o.matrix);
      o.position.set(cx, 0.004, cz - sz * 0.22); o.scale.set(0.04, 1, 0.46); o.updateMatrix(); im.setMatrixAt(k++, o.matrix);
    }
    root.add(im);
    for (const [, x, z, num, name] of bays) {
      const tex = canvasTex(512, 160, (g) => {
        g.fillStyle = 'rgba(255,240,220,0.9)'; g.font = '700 92px Manrope, Arial'; g.textBaseline = 'middle'; g.fillText(num, 12, 82);
        g.fillStyle = 'rgba(255,240,220,0.55)'; g.fillRect(150, 50, 3, 64);
        g.font = '700 24px Manrope, Arial'; g.letterSpacing = '4px'; g.fillText('BAY', 176, 62); g.fillStyle = 'rgba(255,240,220,0.75)';
        let fs = 26; g.font = `600 ${fs}px Manrope, Arial`; while (g.measureText(name).width > 320 && fs > 14) g.font = `600 ${--fs}px Manrope, Arial`;
        g.fillText(name, 176, 102);
      });
      const pg = new THREE.PlaneGeometry(1.6, 0.5); pg.rotateX(-PI / 2); if (z > 0) pg.rotateY(PI);
      add(new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1.2, 1.1, 1.0), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), x - 0.55, 0.004, z + (z < 0 ? 3.35 : -3.35));
    }
  });

  // ---- two-post lift under the Huracán race car (bay 03)
  safe('car lift', () => {
    const X = -11, Z = -11, D = 1.62;
    const post = std(0x2a2c30, 0.45, 0.6), dark = std(0x111214, 0.5, 0.4), steel = std(0x8b8f96, 0.35, 0.9), pad = std(0x1a1a1a, 0.9, 0);
    const amber = glow(1.0, 0.55, 0.15, 4);
    const g = new THREE.Group(); add(g, X, 0, Z);
    for (const s of [-1, 1]) {
      box(0.24, 3.9, 0.3, post, s * D, 1.95, 0, g);
      box(0.5, 0.02, 0.6, dark, s * D, 0.01, 0, g);
      box(0.02, 3.4, 0.04, amber, s * (D - 0.125), 1.95, 0.0, g);
      collider(X + s * D - 0.15, X + s * D + 0.15, Z - 0.2, Z + 0.2);
    }
    box(D * 2 + 0.24, 0.2, 0.26, post, 0, 3.95, 0, g);
    box(D * 2 - 0.3, 0.02, 0.05, amber, 0, 3.84, 0.0, g);
    // control box on the aisle-side post
    box(0.08, 0.32, 0.22, dark, D + 0.16, 1.25, 0.0, g);
    const led = box(0.01, 0.05, 0.05, glow(0.2, 1, 0.4, 4), D + 0.205, 1.33, 0.05, g);
    const carriages = [], arms = [];
    for (const s of [-1, 1]) {
      const c = box(0.34, 0.45, 0.36, steel, s * (D - 0.02), 0.3, 0, g); carriages.push(c);
      for (const sz of [-1, 1]) {
        const ax = s * (D - 0.12), az = 0, bx = s * 0.62, bz = sz * 1.3;
        const len = Math.hypot(bx - ax, bz - az);
        const arm = new THREE.Group(); arm.position.set(ax, 0, az); arm.rotation.y = Math.atan2(bx - ax, bz - az); g.add(arm);
        box(0.09, 0.07, len, steel, 0, 0, len / 2, arm);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 20), pad), 0, 0.06, len - 0.05, arm);
        arms.push(arm);
      }
    }
    const lift = { y: store.get('liftUp', true) ? 1.55 : 0, target: store.get('liftUp', true) ? 1.55 : 0 };
    interact(X + D + 0.75, Z + 0.4, 0.95, () => (lift.target > 0 ? 'Lower the lift' : 'Raise the lift'), () => {
      lift.target = lift.target > 0 ? 0 : 1.55; store.set('liftUp', lift.target > 0);
      toast(lift.target > 0 ? 'Hydraulics up. Mind your head under the Huracán.' : 'Lowering the Huracán.');
    });
    tickers.push((dt, t) => {
      const d = lift.target - lift.y; const moving = Math.abs(d) > 0.002;
      lift.y += clamp(d, -dt * 0.32, dt * 0.32);
      for (const c of carriages) c.position.y = lift.y + 0.16;
      for (const a of arms) a.position.y = lift.y + 0.06;
      const car = cars.n3?.obj; if (car) car.position.y = lift.y + (lift.y > 0.01 ? 0.1 : 0);
      led.material.color.setRGB(moving ? (Math.sin(t * 12) > 0 ? 4 : 0.2) : 0.6, moving ? 2.4 : 4, moving ? 0.3 : 1.5);
    });
  });

  // ---- wheel gallery on the north garage wall, plus tyre stacks in the corners
  safe('wheel wall', () => {
    const plateMat = std(0x16171a, 0.38, 0.75);
    const plates = [[-18.2, 3.6], [-13.6, 3.4]];
    const wheels = [];
    for (const [cx, w] of plates) {
      box(w, 3.5, 0.04, plateMat, cx, 3.0, -15.91);
      box(w, 0.015, 0.02, glow(1, 0.8, 0.55, 3), cx, 4.76, -15.88);
      for (const dx of [-1.1, 0, 1.1]) for (const y of [1.9, 3.0, 4.1]) wheels.push([cx + dx, y]);
    }
    const n = wheels.length;
    const tireGeo = new THREE.TorusGeometry(0.27, 0.085, 14, 48); tireGeo.scale(1, 1, 1.3);
    const rimParts = [];
    const barrel = new THREE.CylinderGeometry(0.205, 0.205, 0.2, 40, 1, true); barrel.rotateX(PI / 2); rimParts.push(barrel);
    const lip = new THREE.RingGeometry(0.19, 0.215, 40); lip.translate(0, 0, 0.1); rimParts.push(lip);
    const hub = new THREE.CylinderGeometry(0.055, 0.07, 0.07, 20); hub.rotateX(PI / 2); hub.translate(0, 0, 0.07); rimParts.push(hub);
    for (let s = 0; s < 10; s++) {
      const sp = new THREE.BoxGeometry(0.026, 0.15, 0.03); sp.translate(0, 0.125, 0.06); sp.rotateZ(s * TAU / 10 + (s % 2 ? 0.1 : -0.1) + Math.floor(s / 2) * 0); rimParts.push(sp);
    }
    const rimGeo = mergeGeometries(rimParts, false);
    const tires = new THREE.InstancedMesh(tireGeo, std(0x0d0d0e, 0.72, 0), n);
    const rims = new THREE.InstancedMesh(rimGeo, std(0xffffff, 0.22, 1.0, { side: THREE.DoubleSide }), n);
    const haloTex = canvasTex(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,220,170,0)'); gr.addColorStop(0.62, 'rgba(255,220,170,0)'); gr.addColorStop(0.7, 'rgba(255,225,180,1)'); gr.addColorStop(0.78, 'rgba(255,200,140,0.35)'); gr.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
    const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 1.9, 1.6) }), n);
    const finishes = [0xd9dce0, 0x222326, 0xd4a64e, 0x6b6e73, 0xd9dce0, 0x8a6a3a];
    const o = new THREE.Object3D(), col = new THREE.Color();
    wheels.forEach(([x, y], i) => {
      o.position.set(x, y, -15.74); o.rotation.set(0, 0, i * 0.7); o.scale.setScalar(1); o.updateMatrix();
      tires.setMatrixAt(i, o.matrix); rims.setMatrixAt(i, o.matrix);
      rims.setColorAt(i, col.set(finishes[i % finishes.length]));
      o.position.z = -15.885; o.rotation.set(0, 0, 0); o.updateMatrix(); halos.setMatrixAt(i, o.matrix);
    });
    root.add(tires, rims, halos);
    // tyre stacks (slicks with coloured compound stripes)
    const stacks = [[-23.2, 15.15, 4], [-22.45, 15.3, 3], [-23.25, -15.2, 5]];
    const nT = stacks.reduce((s, x) => s + x[2], 0);
    const flat = new THREE.TorusGeometry(0.3, 0.115, 14, 48); flat.rotateX(PI / 2); flat.scale(1, 1.15, 1);
    const stripe = new THREE.TorusGeometry(0.33, 0.006, 4, 64); stripe.rotateX(PI / 2);
    const st = new THREE.InstancedMesh(flat, std(0x111112, 0.8, 0), nT);
    const sp = new THREE.InstancedMesh(stripe, new THREE.MeshBasicMaterial({ color: 0xffffff }), nT * 2);
    const comp = [[1.4, 1.1, 0.1], [1.5, 0.12, 0.08], [1.4, 1.4, 1.4]];
    let k = 0;
    stacks.forEach(([x, z, cnt], si) => {
      for (let j = 0; j < cnt; j++) {
        const y = 0.133 + j * 0.265;
        o.position.set(x, y, z); o.rotation.set(0, j * 0.6, 0); o.updateMatrix(); st.setMatrixAt(k, o.matrix);
        for (const dy of [-0.06, 0.06]) { o.position.set(x, y + dy * 1.4, z); o.updateMatrix(); sp.setMatrixAt(k * 2 + (dy > 0 ? 1 : 0), o.matrix); sp.setColorAt(k * 2 + (dy > 0 ? 1 : 0), col.setRGB(...comp[si % 3])); }
        k++;
      }
      collider(x - 0.42, x + 0.42, z - 0.42, z + 0.42);
    });
    root.add(st, sp);
  });

  // ============================================================ LOUNGE
  // ---- kinetic light sculpture: 132 orbs on cables, rippling over the TV lounge, driven by the music
  safe('kinetic orbs', () => {
    const NX = 12, NZ = 11, n = NX * NZ;
    const orbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    const cg = new THREE.CylinderGeometry(0.004, 0.004, 1, 4, 1, true); cg.translate(0, -0.5, 0);
    const cables = new THREE.InstancedMesh(cg, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.15, 0.14) }), n);
    const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), std(0x1a1a1a, 0.4, 0.8), n);
    const P = [];
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) P.push(-4.4 + i * 0.8, -12.5 + j * 0.9);
    const o = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < n; i++) { o.position.set(P[i * 2], 7.975, P[i * 2 + 1]); o.updateMatrix(); caps.setMatrixAt(i, o.matrix); orbs.setColorAt(i, c.setRGB(1, 1, 1)); }
    orbs.frustumCulled = cables.frustumCulled = false;
    root.add(orbs, cables, caps);
    const om = orbs.instanceMatrix.array, cm = cables.instanceMatrix.array, oc = orbs.instanceColor.array;
    for (let i = 0; i < n; i++) { om[i * 16] = om[i * 16 + 5] = om[i * 16 + 10] = om[i * 16 + 15] = 1; cm[i * 16] = cm[i * 16 + 10] = cm[i * 16 + 15] = 1; }
    let mode = 0;
    tickers.push((dt, t) => {
      const phase = (t / 24) % 3, m0 = Math.floor(phase), mix = smooth(0.85, 1, phase - m0); mode = m0;
      const S = M.show, amp = 0.55 + S * 0.25 + M.bass * 0.35 * S, strobe = M.strobe > 0 && (t * 16) % 1 < 0.5;
      for (let i = 0; i < n; i++) {
        const x = P[i * 2], z = P[i * 2 + 1], zc = z + 8;
        const r = Math.hypot(x, zc);
        const p0 = Math.sin(x * 0.75 + t * 0.7) * Math.cos(zc * 0.55 + t * 0.5);
        const p1 = Math.sin(r * 1.25 - t * 1.4);
        const p2 = Math.sin((x + zc) * 0.6 + t * 0.9) * 0.8 + Math.sin(x * 1.3 - t * 0.6) * 0.2;
        const pats = [p0, p1, p2];
        const w = lerp(pats[m0], pats[(m0 + 1) % 3], mix);
        const y = 5.95 + w * amp;
        const o16 = i * 16;
        om[o16 + 12] = x; om[o16 + 13] = y; om[o16 + 14] = z;
        cm[o16 + 5] = 7.95 - y; cm[o16 + 12] = x; cm[o16 + 13] = 7.95; cm[o16 + 14] = z;
        const k = 0.5 + 0.5 * w;
        let br = 2.4 + 1.4 * k * (0.4 + S) + M.beat * S * 3.5 * (0.6 + 0.4 * Math.sin(r * 2 - t * 4));
        let cr = lerp(1.0, lerp(palA.r, palB.r, k), S), cgv = lerp(0.78, lerp(palA.g, palB.g, k), S), cb = lerp(0.52, lerp(palA.b, palB.b, k), S);
        if (strobe) { br = 9; cr = cgv = cb = 1; }
        oc[i * 3] = cr * br; oc[i * 3 + 1] = cgv * br; oc[i * 3 + 2] = cb * br;
      }
      orbs.instanceMatrix.needsUpdate = true; cables.instanceMatrix.needsUpdate = true; orbs.instanceColor.needsUpdate = true;
    });
  });

  // ---- LED strips under the lounge roof beams, pulses travel with the beat
  safe('beam strips', () => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: T, A: { value: palA }, B: { value: palB }, show: { value: 0 }, beat: { value: 0 } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float time, show, beat; uniform vec3 A, B; varying vec3 vW;
        void main(){ float z = vW.z, x = vW.x;
          float pulse = pow(0.5 + 0.5 * sin(z * 0.45 - time * (1.2 + show * 3.0) + x * 0.3), 10.0);
          vec3 warm = vec3(1.0, 0.72, 0.42);
          vec3 c = mix(A, B, 0.5 + 0.5 * sin(z * 0.12 + time * 0.3 + x));
          vec3 col = mix(warm * (0.9 + 0.5 * pulse), c * (0.7 + pulse * 4.5 + beat * 3.0), show);
          gl_FragColor = vec4(col * 1.6, 1.0); ${OUT} }`,
    });
    const geo = new THREE.PlaneGeometry(0.05, 26.8); geo.rotateX(PI / 2);
    for (const x of [-5.25, 0, 5.25]) add(new THREE.Mesh(geo, mat), x, 7.195, -2.2);
    tickers.push(() => { mat.uniforms.show.value = M.show; mat.uniforms.beat.value = M.beat * M.show; });
  });

  // ---- DJ booth with spinning decks, a live EQ wall and lasers
  let djFlash = 0;
  safe('dj booth', () => {
    const g = new THREE.Group(); add(g, 6.4, 0, -1.0); g.rotation.y = -PI / 2; // front faces -x (the lounge)
    const black = std(0x0b0b0c, 0.18, 0.2), satin = std(0x1b1c1f, 0.4, 0.7), brass = std(0xc9a25a, 0.3, 1.0);
    box(2.5, 1.0, 0.8, black, 0, 0.5, 0, g);
    box(2.62, 0.05, 0.92, satin, 0, 1.025, 0, g);
    box(2.62, 0.012, 0.012, glow(1, 0.75, 0.4, 5), 0, 1.0, 0.465, g);
    box(2.5, 0.012, 0.012, glow(1, 0.75, 0.4, 3), 0, 0.02, 0.405, g);
    // EQ wall on the front
    const eq = new THREE.ShaderMaterial({
      uniforms: { bands: { value: M.bands }, A: { value: palA }, B: { value: palB }, time: T, idle: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float bands[16]; uniform vec3 A, B; uniform float time, idle; varying vec2 vUv;
        void main(){ float fx = vUv.x * 16.0; int ci = int(floor(fx)); float cx = fract(fx);
          float lvl = 0.0; for (int i = 0; i < 16; i++) if (i == ci) lvl = bands[i];
          lvl = max(lvl, idle * (0.12 + 0.1 * sin(time * 1.3 + float(ci) * 0.6)));
          float fy = vUv.y * 14.0; float row = floor(fy); float cy = fract(fy);
          float cell = step(0.12, cx) * step(cx, 0.88) * step(0.15, cy) * step(cy, 0.85);
          float on = step(row / 14.0, lvl * 1.05);
          vec3 c = mix(A, B, vUv.y); c = mix(c, vec3(1.0, 0.95, 0.9), step(13.0, row) * 0.6);
          vec3 col = c * cell * (on * 3.2 + 0.05);
          gl_FragColor = vec4(col, 1.0); ${OUT} }`,
    });
    add(new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.78), eq), 0, 0.52, 0.402, g);
    // decks
    const vinylTex = canvasTex(256, 256, (c) => {
      c.fillStyle = '#060606'; c.beginPath(); c.arc(128, 128, 128, 0, TAU); c.fill();
      for (let r = 40; r < 126; r += 2) { c.strokeStyle = r % 6 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(128, 128, r, 0, TAU); c.stroke(); }
      c.fillStyle = '#d6b26e'; c.beginPath(); c.arc(128, 128, 38, 0, TAU); c.fill();
      c.fillStyle = '#17120a'; c.font = '700 13px Manrope, Arial'; c.textAlign = 'center'; c.fillText('THE VAULT', 128, 122); c.font = '500 10px Manrope, Arial'; c.fillText('33⅓ · SIDE A', 128, 140);
      c.fillStyle = '#111'; c.beginPath(); c.arc(128, 128, 4, 0, TAU); c.fill();
    });
    const platters = [];
    for (const sx of [-0.78, 0.78]) {
      box(0.62, 0.05, 0.5, satin, sx, 1.075, -0.02, g);
      const pl = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 48), [std(0x777777, 0.3, 1), new THREE.MeshStandardMaterial({ map: vinylTex, roughness: 0.35, metalness: 0.2 }), black]), sx - 0.05, 1.11, -0.02, g);
      platters.push(pl);
      const arm = new THREE.Group(); add(arm, sx + 0.22, 1.13, -0.2, g); arm.rotation.y = 0.5;
      box(0.012, 0.012, 0.3, brass, 0, 0.02, 0.15, arm);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.04, 16), satin), 0, 0, 0, arm);
      box(0.03, 0.006, 0.006, glow(0.3, 1, 0.5, 3), sx + 0.22, 1.105, 0.2, g);
    }
    // mixer
    box(0.36, 0.06, 0.48, satin, 0, 1.08, -0.02, g);
    const knobs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.016, 0.022, 12), brass, 12);
    const faders = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.02, 0.016), glow(1, 0.85, 0.6, 3), 3);
    const o = new THREE.Object3D(); let k = 0;
    for (let r = 0; r < 4; r++) for (let cI = 0; cI < 3; cI++) { o.position.set(-0.1 + cI * 0.1, 1.12, -0.2 + r * 0.07); o.updateMatrix(); knobs.setMatrixAt(k++, o.matrix); }
    g.add(knobs, faders);
    // laser heads on the rear corners
    const heads = [];
    const beamGeo = new THREE.CylinderGeometry(0.003, 0.009, 1, 5, 1, true); beamGeo.translate(0, 0.5, 0);
    const beams = [];
    for (const sx of [-1.12, 1.12]) {
      box(0.18, 0.12, 0.18, satin, sx, 1.11, -0.3, g);
      const lens = box(0.08, 0.06, 0.012, glow(0.4, 1, 0.6, 3), sx, 1.12, -0.207, g); heads.push(lens);
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        b.frustumCulled = false; b.visible = false; root.add(b); beams.push({ b, side: sx, i });
      }
    }
    collider(6.0, 6.85, -2.3, 0.3);
    g.updateMatrixWorld(true);
    const origin = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
    const beamCol = new THREE.Color();
    tickers.push((dt, t) => {
      const spin = M.on ? 3.49 : 0.0;
      for (const p of platters) p.rotation.y -= dt * spin;
      eq.uniforms.idle.value = M.on ? 0.25 : 1;
      for (let i = 0; i < 3; i++) { o.position.set(-0.1 + i * 0.1, 1.115, 0.12 + 0.06 * Math.sin(t * (0.3 + i * 0.17) + i)); o.updateMatrix(); faders.setMatrixAt(i, o.matrix); }
      faders.instanceMatrix.needsUpdate = true;
      djFlash = Math.max(0, djFlash - dt);
      const vis = M.party ? 0.8 : M.show * 0.35;
      const strength = vis * (0.45 + 0.55 * M.beat) + (M.strobe > 0 ? 0.8 : 0) + djFlash;
      for (const B of beams) {
        if (strength < 0.02) { B.b.visible = false; continue; }
        B.b.visible = true;
        origin.set(6.7, 1.12, -1.0 + B.side);
        const s = B.side > 0 ? 1 : -1, ph = t * 0.55 + B.i * 0.45 + (s > 0 ? 0 : 1.7);
        const tx = 6.4 - 3 - 8.5 * (0.5 + 0.5 * Math.sin(ph * 0.8));
        const tz = -1 + s * (1.5 + B.i * 1.6) * (0.8 + 0.2 * Math.sin(ph * 1.3)) - (B.i - 2) * 0.6;
        dir.set(tx - origin.x, 7.15 - origin.y, tz - origin.z);
        const len = dir.length(); dir.divideScalar(len);
        B.b.position.copy(origin); q.setFromUnitVectors(up, dir); B.b.quaternion.copy(q); B.b.scale.set(1, len, 1);
        const pal = (B.i + (s > 0 ? 0 : 2)) % 2 ? palA : palB;
        beamCol.copy(pal).multiplyScalar(1.6 * strength);
        B.b.material.color.copy(beamCol); B.b.material.opacity = 1;
      }
      for (const h of heads) h.material.color.setRGB(0.4 + strength * 2, 1 + strength * 3, 0.6 + strength);
    });
    interact(7.45, -1.0, 1.15, () => 'Step up to the decks', openDJ);
  });

  // ---- floor-to-ceiling aquarium column
  const fishMatBase = (waterCol, fogK) => new THREE.ShaderMaterial({
    uniforms: { time: T, waterCol: { value: new THREE.Color(...waterCol) }, fogK: { value: fogK } }, side: THREE.DoubleSide,
    vertexShader: `uniform float time; attribute float aPhase; attribute float aKind; attribute float aFreq;
      varying vec3 vLocal, vN, vW, vCol; varying float vKind;
      void main(){ vec3 p = position;
        float tw = pow(clamp(0.5 - p.z, 0.0, 1.5), 1.5);
        p.x += sin(time * aFreq + aPhase - p.z * 5.0) * 0.075 * tw;
        vLocal = position; vKind = aKind;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec4 w = modelMatrix * im * vec4(p, 1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float time, fogK; uniform vec3 waterCol; varying vec3 vLocal, vN, vW, vCol; varying float vKind;
      ${NOISE}
      void main(){ vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        float u = vLocal.z + 0.5, y = vLocal.y; vec3 c = vCol;
        if (vKind < 0.5) { // clownfish
          float b1 = abs(u - 0.8), b2 = abs(u - 0.5), b3 = abs(u - 0.18); float b = min(min(b1, b2), b3);
          c = mix(c, vec3(0.02), 1.0 - smoothstep(0.045, 0.06, b)); c = mix(c, vec3(1.0), 1.0 - smoothstep(0.03, 0.045, b));
          c = mix(c, vec3(0.03), step(u, -0.12) * 0.6);
        } else if (vKind < 1.5) { // blue tang
          float pal = smoothstep(0.02, 0.12, y + 0.07 * sin(u * 6.0)) * step(0.25, u) * step(u, 0.88);
          c = mix(c, vec3(0.01, 0.015, 0.05), pal * 0.9); c = mix(c, vec3(1.0, 0.78, 0.05), step(u, 0.04));
        } else if (vKind < 2.5) { // yellow tang
          c = mix(c, vec3(1.0, 1.0, 0.85), step(u, 0.05) * step(-0.02, u) * 0.6);
        } else if (vKind < 3.5) { // tetra
          float lat = 1.0 - smoothstep(0.006, 0.02, abs(y - 0.015));
          c = mix(c, vec3(0.6, 2.2, 3.0), lat * step(0.35, u));
          c = mix(c, vec3(0.9, 0.06, 0.05), step(y, -0.005) * step(u, 0.55) * step(0.0, u));
        } else { // reef shark: countershading and dark fin tips
          c = mix(vec3(0.92, 0.92, 0.9), vec3(0.36, 0.4, 0.44), smoothstep(-0.05, 0.03, y));
          c = mix(c, vec3(0.04), smoothstep(0.17, 0.21, abs(y)) * step(u, 0.75));
        }
        float diff = 0.3 + 0.7 * clamp(N.y * 0.6 + 0.5, 0.0, 1.0);
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - abs(dot(N, V)), 3.0);
        float spec = pow(max(dot(reflect(-V, N), vec3(0.0, 1.0, 0.0)), 0.0), 24.0);
        float caus = caustic(vW.xz * 1.7 + vW.y * 0.4, time * 0.5);
        vec3 col = c * diff * 0.9 + c * caus * 0.5 + rim * waterCol * 0.5 + spec * 0.35;
        float d = length(cameraPosition - vW);
        col = mix(col, waterCol * 0.8, clamp(fogK * smoothstep(1.0, 12.0, d), 0.0, 0.75));
        gl_FragColor = vec4(col, 1.0); ${OUT} }`,
  });
  const waterMat = (deep, shallow, yBot, yTop, side = THREE.BackSide) => new THREE.ShaderMaterial({
    uniforms: { time: T, deep: { value: new THREE.Color(...deep) }, shallow: { value: new THREE.Color(...shallow) }, yb: { value: yBot }, yt: { value: yTop } }, side,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float time, yb, yt; uniform vec3 deep, shallow; varying vec3 vW; ${NOISE}
      void main(){ float h = clamp((vW.y - yb) / (yt - yb), 0.0, 1.0);
        vec3 col = mix(deep, shallow, pow(h, 1.6));
        vec2 p = vec2(vW.x * 0.8 + vW.z * 0.8, vW.y * 0.9 + (vW.x - vW.z) * 0.25) * 2.2;
        float c = caustic(p, time * 0.45);
        col += shallow * c * (0.12 + 0.4 * h);
        float rays = pow(vnoise(vec2((vW.x + vW.z) * 3.0 + time * 0.12, 0.0)), 3.0) * smoothstep(0.1, 1.0, h);
        col += shallow * rays * 0.35;
        col *= 0.75 + 0.25 * fbm(vec2(vW.x + vW.z, vW.y) * 1.5 + time * 0.03);
        gl_FragColor = vec4(col, 1.0); ${OUT} }`,
  });
  const aquaSolidMat = (color, waterCol) => new THREE.ShaderMaterial({
    uniforms: { time: T, col: { value: new THREE.Color(color) }, waterCol: { value: new THREE.Color(...waterCol) } },
    vertexShader: 'varying vec3 vW, vN; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float time; uniform vec3 col, waterCol; varying vec3 vW, vN; ${NOISE}
      void main(){ vec3 N = normalize(vN); float diff = 0.25 + 0.75 * clamp(N.y * 0.6 + 0.45, 0.0, 1.0);
        float n = fbm(vW.xz * 9.0 + vW.y * 3.0);
        vec3 c = col * (0.7 + 0.5 * n) * diff + waterCol * caustic(vW.xz * 2.2, time * 0.5) * 0.7 * max(N.y, 0.0);
        c = mix(c, waterCol * 0.6, 0.25);
        gl_FragColor = vec4(c, 1.0); ${OUT} }`,
  });
  function fishGeo({ h = 0.34, w = 0.11, tailLen = 0.3, tailH = 0.24, dorsal = 0.05, pect = 0, rings = 14, seg = 10, shark = false }) {
    const pos = [], nor = [], idx = [];
    const prof = (u) => u < 0.62 ? 0.14 + 0.86 * Math.pow(Math.sin((u / 0.62) * PI / 2), 1.1) : Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.62) / 0.38, shark ? 1.6 : 2)));
    for (let i = 0; i <= rings; i++) {
      const u = i / rings, z = -0.5 + u, f = Math.max(prof(u), i === rings ? 0.0 : 0.02);
      const hy = h * f * 0.5, wx = w * f * 0.5;
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        pos.push(wx * ca, hy * sa - (shark ? (1 - u) * 0.0 : 0), z);
        const nx = ca / Math.max(wx, 1e-3), ny = sa / Math.max(hy, 1e-3), l = Math.hypot(nx, ny);
        nor.push(nx / l, ny / l, 0);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const tri = (p1, p2, p3) => { const s = pos.length / 3; pos.push(...p1, ...p2, ...p3); nor.push(1, 0, 0, 1, 0, 0, 1, 0, 0); idx.push(s, s + 1, s + 2); };
    const r0 = h * 0.5 * 0.16;
    const notch = shark ? 0.35 : 0.55;
    tri([0, r0, -0.47], [0, tailH * (shark ? 1.15 : 1), -0.5 - tailLen], [0, 0, -0.5 - tailLen * notch]);
    tri([0, -r0, -0.47], [0, 0, -0.5 - tailLen * notch], [0, -tailH * (shark ? 0.7 : 1), -0.5 - tailLen * (shark ? 0.8 : 1)]);
    tri([0, r0, -0.47], [0, 0, -0.5 - tailLen * notch], [0, -r0, -0.47]);
    if (dorsal) { const zt = shark ? 0.05 : -0.05, hb = h * 0.5 * 0.92; tri([0, hb, zt + 0.16], [0, hb + dorsal, zt - (shark ? 0.06 : 0.12)], [0, hb * 0.85, zt - 0.2]); }
    if (pect) for (const s of [-1, 1]) { const wb = w * 0.45; tri([s * wb, -h * 0.12, 0.2], [s * (wb + pect), -h * 0.38, 0.0], [s * wb, -h * 0.14, 0.06]); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
    return g;
  }
  function fishInstances(geo, mat, specs) {
    const n = specs.length;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const ph = new Float32Array(n), kind = new Float32Array(n), fr = new Float32Array(n);
    const c = new THREE.Color();
    specs.forEach((s, i) => { ph[i] = Math.random() * TAU; kind[i] = s.kind; fr[i] = s.freq; im.setColorAt(i, c.setRGB(...s.color)); });
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
    geo.setAttribute('aFreq', new THREE.InstancedBufferAttribute(fr, 1));
    im.frustumCulled = false;
    return im;
  }
  function kelpField(cx, cz, place, n, yBot, water) {
    const geo = new THREE.PlaneGeometry(0.07, 1, 1, 10); geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: T, waterCol: { value: new THREE.Color(...water) } }, side: THREE.DoubleSide,
      vertexShader: `uniform float time; varying float vY; varying vec3 vW;
        void main(){ vec3 p = position; vY = p.y; vec4 w0 = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float ph = w0.x * 3.1 + w0.z * 2.3;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          float s = p.y * p.y; w.x += sin(time * 0.9 + ph + p.y * 2.0) * 0.09 * s; w.z += cos(time * 0.7 + ph + p.y * 1.6) * 0.07 * s;
          p.x *= 1.0; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 waterCol; varying float vY; varying vec3 vW;
        void main(){ vec3 c = mix(vec3(0.02, 0.07, 0.03), vec3(0.16, 0.34, 0.1), vY); c = mix(c, waterCol * 0.5, 0.35);
          gl_FragColor = vec4(c, 1.0); ${OUT} }`,
    });
    const im = new THREE.InstancedMesh(geo, mat, n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) { const [x, z, hgt] = place(i); o.position.set(x, yBot, z); o.rotation.set(0, Math.random() * PI, 0); o.scale.set(0.8 + Math.random() * 0.6, hgt, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
    im.frustumCulled = false;
    return im;
  }
  function rocks(list, waterCol) {
    const geos = list.map(([x, y, z, r, sy]) => { const g = new THREE.IcosahedronGeometry(r, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.8 + 0.4 * Math.abs(Math.sin(p.getX(i) * 13 + p.getY(i) * 7 + p.getZ(i) * 5)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * sy, p.getZ(i) * k); } g.computeVertexNormals(); g.translate(x, y, z); return g; });
    return new THREE.Mesh(mergeGeometries(geos), aquaSolidMat(0x6b6458, waterCol));
  }
  function bubbles(emitters, yBot, yTop, n, wobble = 0.05) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { const e = emitters[i % emitters.length]; pos[i * 3] = e[0]; pos[i * 3 + 1] = yBot; pos[i * 3 + 2] = e[1]; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const p = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { time: T, scale: { value: 400 }, yb: { value: yBot }, yt: { value: yTop } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float time, scale, yb, yt; attribute float aSeed; varying float vA;
        void main(){ vec3 p = position; float H = yt - yb; float sp = 0.35 + aSeed * 0.35;
          float y = mod(aSeed * 31.0 + time * sp, H); p.y = yb + y;
          p.x += sin(time * 3.0 + aSeed * 50.0) * ${wobble.toFixed(3)} * (0.3 + y / H); p.z += cos(time * 2.6 + aSeed * 70.0) * ${wobble.toFixed(3)} * (0.3 + y / H);
          vA = smoothstep(0.0, 0.3, y) * smoothstep(H, H - 0.2, y);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = scale * (0.012 + 0.014 * aSeed) / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q);
        float ring = smoothstep(0.5, 0.42, d) * (0.35 + 0.65 * smoothstep(0.2, 0.45, d)) + smoothstep(0.16, 0.0, length(q - vec2(-0.14, -0.14))) * 0.8;
        gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * ring * vA * 0.9, 1.0); ${OUT} }`,
    }));
    p.frustumCulled = false; p.renderOrder = 1;
    tickers.push(() => { p.material.uniforms.scale.value = renderer.getDrawingBufferSize(_v2).y * 0.6; });
    return p;
  }

  safe('aquarium column', () => {
    const CX = 5.25, CZ = 7.6, R = 1.05, Y0 = 0.6, Y1 = 6.95;
    const WATER = [0.02, 0.32, 0.42];
    const black = std(0x0a0a0b, 0.2, 0.3), brass = std(0xc9a25a, 0.28, 1.0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.17, R + 0.22, Y0, 64), black), CX, Y0 / 2, CZ);
    add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.06, R + 0.06, 0.05, 64), brass), CX, Y0 + 0.02, CZ);
    add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.2, 0.008, 6, 128), glow(1, 0.75, 0.4, 4)), CX, 0.03, CZ).rotation.x = PI / 2;
    add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.17, R + 0.17, 7.2 - Y1, 64), black), CX, (Y1 + 7.2) / 2, CZ);
    add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.06, R + 0.06, 0.05, 64), brass), CX, Y1 - 0.02, CZ);
    add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, Y1 - Y0, 64, 1, true), waterMat([0.0, 0.025, 0.06], [0.05, 0.36, 0.5], Y0, Y1)), CX, (Y0 + Y1) / 2, CZ);
    const sand = add(new THREE.Mesh(new THREE.CircleGeometry(R, 48), aquaSolidMat(0xc8b48a, WATER)), CX, Y0 + 0.05, CZ); sand.rotation.x = -PI / 2;
    const surf = add(new THREE.Mesh(new THREE.CircleGeometry(R, 48), waterMat([0.15, 0.6, 0.75], [0.6, 0.95, 1.0], Y1 - 1, Y1 + 0.2, THREE.DoubleSide)), CX, Y1 - 0.12, CZ); surf.rotation.x = PI / 2;
    root.add(rocks([[CX + 0.3, Y0 + 0.1, CZ - 0.2, 0.28, 0.8], [CX - 0.35, Y0 + 0.08, CZ + 0.25, 0.22, 0.9], [CX - 0.1, Y0 + 0.05, CZ - 0.5, 0.16, 1], [CX + 0.45, Y0 + 0.05, CZ + 0.45, 0.14, 1.2], [CX - 0.6, Y0 + 0.05, CZ - 0.25, 0.12, 1.5]], WATER));
    root.add(kelpField(CX, CZ, (i) => { const a = i * 2.4, r = 0.35 + 0.55 * ((i * 0.37) % 1); return [CX + Math.cos(a) * r, CZ + Math.sin(a) * r, 1.0 + ((i * 0.61) % 1) * 2.2]; }, 22, Y0 + 0.04, WATER));
    root.add(bubbles([[CX + 0.3, CZ - 0.2], [CX - 0.5, CZ + 0.1], [CX + 0.05, CZ + 0.55]], Y0 + 0.1, Y1 - 0.15, 120));
    const glass = add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, Y1 - Y0, 72, 1, true), glassMat({ a0: 0.04, a1: 0.5 })), CX, (Y0 + Y1) / 2, CZ);
    glass.renderOrder = 2;
    collider(CX - R - 0.22, CX + R + 0.22, CZ - R - 0.22, CZ + R + 0.22);
    // fish schools
    const specs = [];
    const S = (kind, color, size, freq, count, band) => { for (let i = 0; i < count; i++) specs.push({ kind, color, size: size * (0.85 + Math.random() * 0.3), freq, band, i, count }); };
    S(0, [1.0, 0.35, 0.04], 0.11, 9, 8, [1.0, 2.2]);
    S(1, [0.05, 0.25, 1.0], 0.2, 6, 10, [2.0, 4.4]);
    S(2, [1.0, 0.85, 0.05], 0.18, 6.5, 12, [3.0, 6.0]);
    S(3, [0.7, 0.75, 0.8], 0.075, 14, 36, [1.5, 5.5]);
    const geo = fishGeo({ h: 0.42, w: 0.13, tailLen: 0.32, tailH: 0.22, dorsal: 0.08 });
    const mat = fishMatBase(WATER, 0.5);
    const fish = fishInstances(geo, mat, specs); root.add(fish);
    const data = specs.map((s, i) => ({
      r: s.kind === 3 ? 0.62 : 0.3 + Math.random() * 0.5, w: (s.kind === 3 ? 0.42 : 0.18 + Math.random() * 0.18) * (s.kind === 1 ? -1 : 1),
      y0: lerp(Y0 + s.band[0], Y0 + s.band[1], Math.random()), a0: s.kind === 3 ? (s.i / s.count) * 0.9 : Math.random() * TAU,
      bob: 0.1 + Math.random() * 0.3, bw: 0.2 + Math.random() * 0.3, ro: Math.random() * TAU, dr: (Math.random() - 0.5) * 0.25, dy: (Math.random() - 0.5) * 0.4,
    }));
    const arr = fish.instanceMatrix.array;
    tickers.push((dt, t) => {
      for (let i = 0; i < data.length; i++) {
        const d = data[i], s = specs[i];
        const a = d.a0 + t * d.w;
        let r = d.r + Math.sin(t * 0.3 + d.ro) * 0.12, y = d.y0 + Math.sin(t * d.bw + d.ro) * d.bob;
        if (s.kind === 3) { const sa = t * 0.05; y = Y0 + 3.2 + Math.sin(t * 0.21) * 1.6 + d.dy; r = 0.55 + d.dr + Math.sin(sa) * 0.08; }
        r = clamp(r, 0.15, R - 0.25);
        const x = CX + Math.cos(a) * r, z = CZ + Math.sin(a) * r;
        const dy = s.kind === 3 ? Math.cos(t * 0.21) * 1.6 * 0.21 : Math.cos(t * d.bw + d.ro) * d.bob * d.bw;
        const sg = Math.sign(d.w), sp = Math.abs(d.w) * r;
        setInst(arr, i, x, y, z, -Math.sin(a) * sg * sp, dy * 0.6, Math.cos(a) * sg * sp, s.size);
      }
      fish.instanceMatrix.needsUpdate = true;
    });
  });

  // ---- fire table in the lounge
  safe('fire table', () => {
    const X = -5.2, Z = 6.6;
    const stone = std(0x26231f, 0.62, 0.05), brass = std(0xc9a25a, 0.3, 1.0);
    box(2.5, 0.38, 0.95, stone, X, 0.19, Z);
    box(2.54, 0.02, 0.99, brass, X, 0.39, Z);
    box(2.3, 0.02, 0.75, std(0x0c0b0a, 0.35, 0.2), X, 0.401, Z);
    const bed = add(new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.22), new THREE.ShaderMaterial({
      uniforms: { time: T },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float time; varying vec2 vUv; ${NOISE}
        void main(){ vec2 p = vUv * vec2(40.0, 5.0); float cell = vnoise(floor(p) + 0.5); vec2 f = fract(p) - 0.5;
          float pebble = smoothstep(0.5, 0.25, length(f)); float e = fbm(vUv * vec2(12.0, 2.0) + vec2(time * 0.2, time * 0.1));
          vec3 c = mix(vec3(0.03, 0.025, 0.02), vec3(1.6, 0.35, 0.05) * e * e * 2.0, pebble * smoothstep(0.3, 0.8, cell + e * 0.4));
          gl_FragColor = vec4(c, 1.0); ${OUT} }`,
    })), X, 0.415, Z);
    bed.rotation.x = -PI / 2;
    const flameMat = (seed) => new THREE.ShaderMaterial({
      uniforms: { time: T, seed: { value: seed } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float time, seed; varying vec2 vUv; ${NOISE}
        void main(){ vec2 uv = vUv;
          float n = fbm(vec2(uv.x * 7.0 + seed, uv.y * 2.6 - time * 2.4));
          float n2 = fbm(vec2(uv.x * 16.0 - seed * 2.0, uv.y * 4.0 - time * 3.6));
          float edge = smoothstep(0.0, 0.07, uv.x) * smoothstep(1.0, 0.93, uv.x);
          float hgt = (0.35 + 0.55 * fbm(vec2(uv.x * 4.0 + seed, time * 0.8))) * edge;
          float f = (hgt - uv.y) * 1.6 + (n - 0.5) * 0.7 + (n2 - 0.5) * 0.3;
          float a = smoothstep(0.0, 0.3, f) * smoothstep(0.0, 0.06, uv.y + 0.02);
          vec3 c = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.5, 0.08), smoothstep(0.1, 0.45, f));
          c = mix(c, vec3(1.0, 0.85, 0.55), smoothstep(0.45, 0.85, f));
          gl_FragColor = vec4(c * a * (0.55 + 1.3 * smoothstep(0.3, 0.9, f)), 1.0); ${OUT} }`,
    });
    for (let i = 0; i < 3; i++) {
      const f = add(new THREE.Mesh(new THREE.PlaneGeometry(1.95, 0.6), flameMat(i * 3.7)), X, 0.41 + 0.3, Z + (i - 1) * 0.05);
      f.rotation.y = (i - 1) * 0.08; f.renderOrder = 3;
    }
    const gm = glassMat({ a0: 0.05, a1: 0.45 });
    for (const s of [-1, 1]) { add(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.26), gm), X, 0.53, Z + s * 0.34).renderOrder = 4; add(new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.26), gm), X + s * 1.1, 0.53, Z).rotation.y = PI / 2; }
    // warm light spill on the floor
    const spillTex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,150,60,0.9)'); gr.addColorStop(0.5, 'rgba(255,110,30,0.25)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    const spill = add(new THREE.Mesh(new THREE.PlaneGeometry(5.5, 4.5), new THREE.MeshBasicMaterial({ map: spillTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.5, 0.45, 0.4), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), X, 0.006, Z);
    spill.rotation.x = -PI / 2;
    tickers.push((dt, t) => { const k = 0.8 + 0.12 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.3); spill.material.color.setRGB(0.5 * k, 0.45 * k, 0.4 * k); });
    collider(X - 1.3, X + 1.3, Z - 0.52, Z + 0.52);
    interact(X, Z - 1.25, 1.1, () => 'Warm your hands by the fire', () => toast(['Crackle. Pop. Nothing like real gas flames indoors.', 'You stare into the fire and briefly reconsider every bet you made tonight.', 'Toasty. The bar is right behind you, by the way.'][Math.floor(Math.random() * 3)]));
  });

  // ============================================================ BAR: robot bartender
  safe('robot bartender', () => {
    const BX = -5.6, BZ = 14.6;
    const white = std(0xe8e5de, 0.28, 0.05), graphite = std(0x1d1e21, 0.35, 0.6), gold = std(0xc9a25a, 0.28, 1.0), chrome = std(0xdddddd, 0.12, 1.0);
    const base = add(new THREE.Group(), BX, 0, BZ);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.82, 32), graphite), 0, 0.41, 0, base);
    add(new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.01, 6, 48), gold), 0, 0.82, 0, base).rotation.x = PI / 2;
    const turret = add(new THREE.Group(), 0, 0.84, 0, base);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.16, 32), white), 0, 0.08, 0, turret);
    const ringLed = add(new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.008, 6, 48), glow(0.3, 0.9, 1, 4)), 0, 0.02, 0, turret); ringLed.rotation.x = PI / 2;
    const shoulder = add(new THREE.Group(), 0, 0.24, 0, turret);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), graphite), 0, 0, 0, shoulder);
    const L1 = 0.68, L2 = 0.62;
    const seg = (len, r, parent) => { const m = add(new THREE.Mesh(new THREE.CapsuleGeometry(r, len - r * 2, 6, 20), white), 0, 0, len / 2, parent); m.rotation.x = PI / 2; return m; };
    seg(L1, 0.075, shoulder);
    const elbow = add(new THREE.Group(), 0, 0, L1, shoulder);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), graphite), 0, 0, 0, elbow);
    add(new THREE.Mesh(new THREE.TorusGeometry(0.087, 0.006, 6, 32), gold), 0, 0, 0, elbow).rotation.y = PI / 2;
    seg(L2, 0.058, elbow);
    const wrist = add(new THREE.Group(), 0, 0, L2, elbow);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 20), graphite), 0, 0, 0.03, wrist).rotation.x = PI / 2;
    add(new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.006, 6, 32), glow(0.3, 0.9, 1, 4)), 0, 0, 0.075, wrist);
    for (const s of [-1, 1]) box(0.018, 0.03, 0.09, graphite, s * 0.06, 0, 0.12, wrist);
    const shaker = add(new THREE.Group(), 0, 0, 0.12, wrist);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.036, 0.2, 24), chrome), 0, 0, 0, shaker).rotation.x = PI / 2;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.06, 24), chrome), 0, 0, 0.13, shaker).rotation.x = PI / 2;
    // the cocktail it makes
    const glassG = add(new THREE.Group(), -5.25, 1.135, 13.42);
    const coupe = new THREE.LatheGeometry([[0, 0], [0.04, 0], [0.04, 0.006], [0.006, 0.012], [0.005, 0.09], [0.02, 0.1], [0.055, 0.12], [0.065, 0.16], [0.062, 0.162]].map(([x, y]) => new THREE.Vector2(x, y)), 32);
    add(new THREE.Mesh(coupe, glassMat({ a0: 0.12, a1: 0.7, side: THREE.DoubleSide })), 0, 0, 0, glassG).renderOrder = 3;
    const liquid = add(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.025, 0.04, 24), new THREE.MeshStandardMaterial({ color: 0xffa53a, roughness: 0.1, emissive: new THREE.Color(0.35, 0.12, 0.0), transparent: true, opacity: 0.88 })), 0, 0.14, 0, glassG);
    // IK
    const shoulderW = new THREE.Vector3(BX, 1.08, BZ);
    const tgt = new THREE.Vector3(BX + 0.1, 1.7, BZ - 0.5), want = new THREE.Vector3(), wp = { pitch: 0, roll: 0 };
    const keys = [
      [0.0, [BX + 0.05, 1.75, BZ - 0.55], 0.0], [1.5, [BX + 0.05, 1.75, BZ - 0.55], 0.0],
      [3.0, [BX + 0.55, 1.62, BZ + 0.55], 0.1], [3.8, [BX + 0.55, 1.62, BZ + 0.55], 0.1],
      [5.0, [BX + 0.1, 1.95, BZ - 0.45], 0.4], [8.0, [BX + 0.1, 1.95, BZ - 0.45], 0.4, 'shake'],
      [9.6, [BX + 0.3, 1.45, BZ - 1.0], -1.9], [11.4, [BX + 0.3, 1.45, BZ - 1.0], -1.9, 'pour'],
      [12.8, [BX + 0.05, 1.75, BZ - 0.55], 0.0], [18.0, [BX + 0.05, 1.75, BZ - 0.55], 0.0],
    ];
    const SEQ = 18;
    let seqT = 6 + Math.random() * 6, serving = false, fill = 0;
    tickers.push((dt, t) => {
      seqT += dt; if (seqT > SEQ) { seqT -= SEQ; fill = 0; if (serving) { serving = false; toast('The robot slides a Vault Sour across the marble. Smooth.'); broadcast('got a Vault Sour from the robot bartender'); } }
      let a = keys[0], b = keys[0];
      for (let i = 0; i < keys.length - 1; i++) if (seqT >= keys[i][0] && seqT <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
      const k = smooth(0, 1, (seqT - a[0]) / Math.max(1e-3, b[0] - a[0]));
      want.set(lerp(a[1][0], b[1][0], k), lerp(a[1][1], b[1][1], k), lerp(a[1][2], b[1][2], k));
      let pitch = lerp(a[2], b[2], k);
      if (a[3] === 'shake') { want.y += Math.sin(seqT * 42) * 0.07; want.x += Math.sin(seqT * 21) * 0.02; pitch += Math.sin(seqT * 42) * 0.25; }
      if (a[3] === 'pour') fill = Math.min(1, fill + dt * 0.7);
      if (seqT < 9) fill = Math.max(0, fill - dt * 2);
      want.x += Math.sin(t * 0.7) * 0.02; want.y += Math.sin(t * 1.1) * 0.015;
      tgt.lerp(want, Math.min(1, dt * 8));
      const dx = tgt.x - shoulderW.x, dz = tgt.z - shoulderW.z, dy = tgt.y - shoulderW.y;
      turret.rotation.y = Math.atan2(dx, dz);
      const d = Math.hypot(dx, dz), D = clamp(Math.hypot(d, dy), 0.2, L1 + L2 - 0.01);
      const al = Math.atan2(dy, d), be = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
      const ga = Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
      const p1 = al + be, p2 = -(PI - ga);
      shoulder.rotation.x = -p1; elbow.rotation.x = -p2; wrist.rotation.x = -(pitch - p1 - p2);
      wrist.rotation.z = a[3] === 'pour' ? Math.sin(seqT * 2) * 0.2 : 0;
      liquid.scale.set(0.3 + 0.7 * fill, Math.max(0.01, fill), 0.3 + 0.7 * fill); liquid.position.y = 0.12 + 0.02 * fill; liquid.visible = fill > 0.02;
      ringLed.material.color.setRGB(serving ? 1 : 0.3, serving ? 0.8 : 0.9, serving ? 0.3 : 1).multiplyScalar(3 + Math.sin(t * 3));
    });
    interact(-5.3, 12.1, 1.0, () => 'Ask the robot for its signature', () => {
      if (serving) { toast('It is already on it. Patience, the shake is the art.'); return; }
      serving = true; seqT = 1.4; fill = 0; toast('The robot bartender winks a cyan LED at you and starts shaking.');
    });
  });

  // ============================================================ CASINO: the vault door
  safe('vault door', () => {
    const CX = 12, CY = 1.75, WZ = 15.96;
    const steel = std(0xb9bcc2, 0.26, 1.0), steelD = std(0x6f737a, 0.32, 1.0), gun = std(0x2a2c30, 0.4, 0.85), velvet = std(0x120d0b, 0.95, 0);
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc35a, roughness: 0.22, metalness: 1, emissive: new THREE.Color(0.22, 0.12, 0.02), envMapIntensity: 1.6 });
    box(4.6, 4.05, 0.04, gun, CX, 2.025, WZ - 0.02);
    // rivets
    const rv = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 8, 6), steelD, 36); const o = new THREE.Object3D(); let k = 0;
    for (let i = 0; i < 9; i++) for (const [x, y] of [[-2.15 + i * 0.5375, 0.15], [-2.15 + i * 0.5375, 3.9]]) { o.position.set(CX + x, y, WZ - 0.04); o.updateMatrix(); rv.setMatrixAt(k++, o.matrix); }
    for (let i = 0; i < 9; i++) for (const x of [-2.15, 2.15]) { o.position.set(CX + x, 0.15 + (i + 0.5) * (3.75 / 9), WZ - 0.04); o.updateMatrix(); rv.setMatrixAt(k++, o.matrix); }
    rv.count = k; root.add(rv);
    // frame ring
    const shape = new THREE.Shape(); shape.absarc(0, 0, 1.95, 0, TAU, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, 1.48, 0, TAU, true); shape.holes.push(hole);
    const fg = new THREE.ExtrudeGeometry(shape, { depth: 0.46, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 96 });
    const frame = add(new THREE.Mesh(fg, steelD), CX, CY, WZ - 0.5);
    add(new THREE.Mesh(new THREE.TorusGeometry(1.99, 0.012, 6, 160), glow(1, 0.75, 0.38, 4)), CX, CY, WZ - 0.53);
    // interior: steel tube, velvet back, shelves of gold bars, warm cove light
    const tube = add(new THREE.Mesh(new THREE.CylinderGeometry(1.48, 1.48, 0.5, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.35, metalness: 1, side: THREE.BackSide })), CX, CY, WZ - 0.27);
    tube.rotation.x = PI / 2;
    add(new THREE.Mesh(new THREE.CircleGeometry(1.48, 64), velvet), CX, CY, WZ - 0.045);
    add(new THREE.Mesh(new THREE.TorusGeometry(1.46, 0.015, 6, 96, PI * 0.8), glow(1, 0.72, 0.35, 5)), CX, CY, WZ - 0.1).rotation.z = PI * 0.1;
    const barGeo = new THREE.BoxGeometry(0.25, 0.075, 0.11); { const p = barGeo.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * 0.8, p.getY(i), p.getZ(i) * 0.75); barGeo.computeVertexNormals(); }
    const bars = []; const shelfY = [-0.72, -0.05, 0.62];
    for (const sy of shelfY) {
      const half = Math.sqrt(1.46 * 1.46 - (sy + (sy < 0 ? 0 : 0.3)) ** 2) - 0.12;
      box(half * 2 + 0.1, 0.025, 0.36, std(0x0c0c0d, 0.25, 0.5), CX, CY + sy, WZ - 0.22);
      const cols = Math.floor((half * 2) / 0.27);
      for (let layer = 0; layer < 3; layer++) for (let c = 0; c < cols - layer; c++) for (const dz of [-0.07, 0.07]) {
        bars.push([CX - ((cols - layer - 1) * 0.27) / 2 + c * 0.27, CY + sy + 0.05 + layer * 0.077, WZ - 0.22 + dz]);
      }
    }
    const goldIM = new THREE.InstancedMesh(barGeo, gold, bars.length);
    bars.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.rotation.set(0, 0, 0); o.updateMatrix(); goldIM.setMatrixAt(i, o.matrix); });
    root.add(goldIM);
    // door (lathe profile revolved and turned to face the room)
    const prof = [[0, 0.42], [0.34, 0.42], [0.37, 0.395], [0.72, 0.395], [0.75, 0.415], [1.0, 0.415], [1.02, 0.39], [1.22, 0.39], [1.25, 0.41], [1.38, 0.41], [1.45, 0.36], [1.45, 0.02], [1.4, 0.0], [0, 0.0]];
    const dg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 96); dg.rotateX(-PI / 2);
    const HX = CX - 2.0, HZ = WZ - 0.62; // hinge axis, in front of the frame
    const pivot = add(new THREE.Group(), HX, 0, HZ);
    const door = add(new THREE.Group(), CX - HX, CY, WZ - 0.04 - HZ, pivot);
    add(new THREE.Mesh(dg, std(0xb9bcc2, 0.26, 1.0, { side: THREE.DoubleSide })), 0, 0, 0, door);
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 16), std(0xd8dade, 0.2, 1), 12);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; o.position.set(Math.cos(a) * 1.55, Math.sin(a) * 1.55, -0.21); o.rotation.set(0, 0, a - PI / 2); o.updateMatrix(); bolts.setMatrixAt(i, o.matrix); }
    door.add(bolts);
    const wheel = add(new THREE.Group(), 0, 0, -0.5, door);
    add(new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.038, 12, 64), steel), 0, 0, 0, wheel);
    for (let i = 0; i < 3; i++) { const s = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.04, 12), steel), 0, 0, 0, wheel); s.rotation.z = (i / 3) * PI; }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), steel), Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0, wheel); }
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.12, 32), steelD), 0, 0, 0.04, wheel).rotation.x = PI / 2;
    const dial = add(new THREE.Group(), -0.82, 0.78, -0.45, door);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.05, 48), std(0x111214, 0.3, 0.7)), 0, 0, 0, dial).rotation.x = PI / 2;
    for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; box(0.006, i % 5 ? 0.02 : 0.035, 0.01, std(0xd6b26e, 0.3, 1), Math.cos(a) * 0.13, Math.sin(a) * 0.13, -0.03, dial).rotation.z = a - PI / 2; }
    // hinge arms + barrels
    for (const y of [CY - 0.75, CY + 0.75]) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 24), steelD), HX, y, HZ);
      box(0.95, 0.16, 0.07, steelD, 0.47, y, 0.045, pivot);
      box(0.1, 0.16, 0.12, steelD, 0.9, y, 0.12, pivot);
    }
    // status LED + balance display
    const status = add(new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), glow(1, 0.1, 0.05, 4)), CX + 1.65, CY + 1.62, WZ - 0.05); status.rotation.y = PI;
    const disp = canvasTex(1024, 160);
    const dispMesh = add(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.406), new THREE.MeshBasicMaterial({ map: disp, color: new THREE.Color(1.5, 1.5, 1.5) })), CX, 4.32, WZ - 0.05); dispMesh.rotation.y = PI;
    box(2.7, 0.5, 0.04, std(0x0a0a0b, 0.2, 0.3), CX, 4.32, WZ - 0.02);
    let shown = -1;
    const drawDisp = (chips) => {
      const g = disp.userData.g; g.fillStyle = '#050507'; g.fillRect(0, 0, 1024, 160);
      g.fillStyle = '#d6b26e'; g.font = '700 30px Manrope, Arial'; g.letterSpacing = '10px'; g.textBaseline = 'middle'; g.fillText('VAULT BALANCE', 40, 80);
      g.letterSpacing = '0px'; g.font = '500 76px "JetBrains Mono", monospace'; g.textAlign = 'right';
      g.shadowColor = 'rgba(255,170,60,0.9)'; g.shadowBlur = 18; g.fillStyle = '#ffcf7a'; g.fillText('◆ ' + chips.toLocaleString('en-US'), 990, 84); g.shadowBlur = 0; g.textAlign = 'left';
      disp.needsUpdate = true;
    };
    // floor glow when open
    const spillTex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,190,90,0.8)'); gr.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    const spill = add(new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshBasicMaterial({ map: spillTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0, 0, 0), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), CX, 0.006, WZ - 1.2);
    spill.rotation.x = -PI / 2;
    collider(CX - 2.1, CX + 2.1, WZ - 0.62, 16);
    const doorCol = collider(0, 0, 0, 0);
    const V = { open: store.get('vaultOpen', false), t: 0, spin: 0, phase: 'idle', p: 0 };
    V.p = V.open ? 1 : 0; DBG.vault = V;
    const today = () => new Date().toDateString();
    interact(CX, WZ - 1.75, 1.35, () => {
      if (V.phase !== 'idle') return V.open ? 'The vault is opening…' : 'The vault is closing…';
      if (!V.open) return 'Open the vault';
      return store.get('dividend', '') !== today() ? "Collect today's vault dividend" : 'Close the vault';
    }, () => {
      if (V.phase !== 'idle') return;
      if (!V.open) { V.open = true; V.phase = 'unlock'; V.t = 0; store.set('vaultOpen', true); toast('Combination accepted. Bolts retracting.'); return; }
      if (store.get('dividend', '') !== today()) {
        store.set('dividend', today()); gameApi.addChips(2500); celebrateAt(CX, 1.6, WZ - 1.4);
        toast('The vault pays a dividend: +2,500 chips. Come back tomorrow.'); broadcast('collected the daily vault dividend');
        return;
      }
      V.open = false; V.phase = 'close'; V.t = 0; store.set('vaultOpen', false);
    });
    tickers.push((dt) => {
      V.t += dt;
      if (V.phase === 'unlock') { V.spin += dt * 4 * smooth(0, 0.3, V.t); if (V.t > 1.6) { V.phase = 'swing'; V.t = 0; } }
      else if (V.phase === 'swing') { V.p = smooth(0, 1, V.t / 2.8); if (V.t >= 2.8) V.phase = 'idle'; }
      else if (V.phase === 'close') { V.p = 1 - smooth(0, 1, V.t / 2.4); if (V.t >= 2.4) { V.phase = 'lock'; V.t = 0; } }
      else if (V.phase === 'lock') { V.spin -= dt * 4 * (1 - smooth(1.0, 1.4, V.t)); if (V.t > 1.4) V.phase = 'idle'; }
      wheel.rotation.z = V.spin; dial.rotation.z = V.spin * 1.7;
      const ang = V.p * 1.72; pivot.rotation.y = ang;
      // door collider: a slab from the hinge along the door's face direction
      if (V.p > 0.9) { doorCol.x0 = HX - 0.1; doorCol.x1 = HX + 0.7; doorCol.z0 = HZ - 3.5; doorCol.z1 = HZ; }
      else doorCol.x0 = doorCol.x1 = doorCol.z0 = doorCol.z1 = 0;
      status.material.color.setRGB(V.open ? 0.15 : 4, V.open ? 4 : 0.2, V.open ? 0.6 : 0.1);
      spill.material.color.setRGB(0.6 * V.p, 0.5 * V.p, 0.35 * V.p);
      const ch = gameApi.chips(); if (ch !== shown) { shown = ch; drawDisp(ch); }
    });
  });

  // ---- neon sign wall
  function neon(text, { font, w, h, color, core = '#fff4f8', px = 1024 }) {
    const H = Math.round(px * h / w);
    const fit = (g) => { // shrink the font until the text fits with a margin for the glow
      let size = parseFloat(font.match(/(\d+)px/)[1]);
      const f = (sz) => font.replace(/\d+px/, sz + 'px');
      g.font = f(size); while (g.measureText(text).width > px * 0.88 && size > 8) g.font = f(--size);
    };
    const draw = (g, blur) => {
      g.clearRect(0, 0, px, H); fit(g); g.textAlign = 'center'; g.textBaseline = 'middle';
      if (blur) { g.shadowColor = color; g.fillStyle = color; for (const b of [H * 0.32, H * 0.16, H * 0.06]) { g.shadowBlur = b; g.fillText(text, px / 2, H / 2); } }
      else { g.shadowColor = color; g.shadowBlur = H * 0.03; g.fillStyle = color; g.fillText(text, px / 2, H / 2); g.shadowBlur = 0; g.fillStyle = core; g.globalAlpha = 0.85; g.fillText(text, px / 2, H / 2); g.globalAlpha = 1; }
    };
    const glowTex = canvasTex(px, H, (g) => draw(g, true)), tubeTex = canvasTex(px, H, (g) => draw(g, false));
    const grp = new THREE.Group();
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.0, h), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.5, 0.5, 0.5) }));
    const tm = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tubeTex, transparent: true, depthWrite: false, color: new THREE.Color(3.2, 3.2, 3.2) }));
    tm.position.z = 0.02; tm.renderOrder = 1; grp.add(gm, tm);
    grp.userData.tube = tm; grp.userData.glow = gm;
    return grp;
  }
  safe('neon wall', () => {
    const s = neon('No bad days.', { font: 'italic 500 210px "Bodoni Moda", Georgia, serif', w: 5.2, h: 1.3, color: '#ff3d7f' });
    s.position.set(19.3, 4.55, 15.9); s.rotation.y = PI; root.add(s);
    const s2 = neon('THE VAULT · EST. 2026', { font: '700 74px Manrope, Arial', w: 3.2, h: 0.36, color: '#ffb547', px: 1400 });
    s2.position.set(19.3, 3.65, 15.9); s2.rotation.y = PI; root.add(s2);
    s2.userData.tube.material.color.setRGB(2.2, 2.0, 1.8);
    let flick = 0;
    tickers.push((dt, t) => {
      flick -= dt; const tube = s.userData.tube.material, gl = s.userData.glow.material;
      if (flick < -6 - Math.random() * 10) flick = 0.5;
      const on = flick > 0 ? (Math.sin(t * 60) > 0.2 ? 1 : 0.15) : 1;
      const k = on * (1 + M.beat * M.show * 0.5);
      tube.color.setRGB(3.2 * k, 3.2 * k, 3.2 * k); gl.color.setRGB(0.5 * k, 0.5 * k, 0.5 * k);
    });
  });

  // ============================================================ ARCADE: hoops machine + darts
  const hoops = { best: store.get('hoopsBest', 0), bestBy: store.get('hoopsBestBy', ''), shots: [] };
  safe('hoops machine', () => {
    const X = 15.55, Z = -9.0; // front edge, machine runs toward -z
    const g = add(new THREE.Group(), X, 0, Z);
    const black = std(0x0c0c0e, 0.25, 0.3), satin = std(0x1d1e22, 0.4, 0.6);
    const pink = glow(1, 0.24, 0.5, 4), cyan = glow(0.24, 0.88, 1, 4);
    box(1.04, 0.9, 0.7, black, 0, 0.45, -0.35, g); // control cabinet
    box(1.06, 0.03, 0.72, satin, 0, 0.91, -0.35, g);
    const ramp = box(1.0, 0.06, 2.2, satin, 0, 0.95, -1.75, g); ramp.rotation.x = -0.06;
    box(1.0, 0.95, 2.2, black, 0, 0.47, -1.8, g);
    for (const s of [-1, 1]) {
      box(0.012, 0.012, 2.9, s < 0 ? pink : cyan, s * 0.52, 0.93, -1.45, g);
      box(0.06, 2.95, 0.06, satin, s * 0.5, 1.475, -2.88, g);
      box(0.04, 0.04, 2.1, satin, s * 0.5, 2.05, -1.85, g);
    }
    // nets on the sides
    const netMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; void main(){ vec2 p = vUv * vec2(40.0, 20.0); vec2 d = abs(fract(vec2(p.x + p.y, p.x - p.y) * 0.5) - 0.5);
        float l = 1.0 - smoothstep(0.0, 0.07, min(d.x, d.y)); gl_FragColor = vec4(vec3(0.6), l * 0.35); ${OUT} }`,
    });
    for (const s of [-1, 1]) { const n = add(new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.05), netMat), s * 0.5, 1.52, -1.85, g); n.rotation.y = PI / 2; }
    // backboard + hoop
    add(new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.72), glassMat({ a0: 0.12, a1: 0.5 })), 0, 2.3, -2.84, g);
    const frameMat = glow(1, 1, 1, 2.2);
    for (const [w, h, x, y] of [[0.98, 0.02, 0, 2.66], [0.98, 0.02, 0, 1.94], [0.02, 0.72, -0.49, 2.3], [0.02, 0.72, 0.49, 2.3], [0.34, 0.012, 0, 2.38], [0.34, 0.012, 0, 2.12], [0.012, 0.27, -0.17, 2.25], [0.012, 0.27, 0.17, 2.25]]) box(w, h, 0.01, frameMat, x, y, -2.835, g);
    const rim = add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.011, 8, 40), new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.4, metalness: 0.6, emissive: new THREE.Color(0.6, 0.12, 0.02) })), 0, 2.08, -2.63, g); rim.rotation.x = PI / 2;
    box(0.06, 0.02, 0.06, satin, 0, 2.08, -2.8, g);
    const net = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.28, 16, 4, true), netMat), 0, 1.94, -2.63, g);
    // header scoreboard
    box(1.1, 0.5, 0.12, black, 0, 3.05, -2.88, g);
    const sb = canvasTex(512, 220);
    const sbMesh = add(new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.43), new THREE.MeshBasicMaterial({ map: sb, color: new THREE.Color(1.6, 1.6, 1.6) })), 0, 3.05, -2.815, g);
    hoops.draw = (score, time, msg) => {
      const c = sb.userData.g; c.fillStyle = '#040406'; c.fillRect(0, 0, 512, 220);
      c.strokeStyle = '#ff3d7f'; c.lineWidth = 4; c.strokeRect(6, 6, 500, 208);
      c.fillStyle = '#ff3d7f'; c.font = '800 44px Manrope, Arial'; c.textAlign = 'center'; c.fillText('VAULT HOOPS', 256, 58);
      c.font = '500 64px "JetBrains Mono", monospace'; c.fillStyle = '#ffcf7a';
      if (score != null) { c.fillText(String(score).padStart(2, '0'), 150, 150); c.fillStyle = '#3de0ff'; c.fillText(String(Math.ceil(time)).padStart(2, '0'), 370, 150); c.font = '600 18px Manrope, Arial'; c.fillStyle = '#a59d90'; c.fillText('SCORE', 150, 190); c.fillText('TIME', 370, 190); }
      else { c.fillText('HI ' + String(hoops.best).padStart(2, '0'), 256, 145); c.font = '600 22px Manrope, Arial'; c.fillStyle = '#a59d90'; c.fillText(msg || (hoops.bestBy ? 'BY ' + hoops.bestBy.toUpperCase() : 'PRESS E TO PLAY'), 256, 190); }
      sb.needsUpdate = true;
    };
    hoops.draw();
    // balls in the tray + one that flies on every basket made in the mini game
    const ballTex = canvasTex(256, 128, (c) => {
      c.fillStyle = '#d4581c'; c.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 1400; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.fillRect(Math.random() * 256, Math.random() * 128, 2, 2); }
      c.strokeStyle = '#1a0c05'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 64); c.lineTo(256, 64); c.stroke();
      for (const x of [64, 192]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 128); c.stroke(); }
      c.beginPath(); for (let x = 0; x <= 256; x += 4) c.lineTo(x, 64 + Math.sin(x / 256 * TAU * 2) * 38); c.stroke();
    });
    const ballMat = new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.6 });
    const ballGeo = new THREE.SphereGeometry(0.12, 24, 16);
    for (let i = 0; i < 5; i++) add(new THREE.Mesh(ballGeo, ballMat), -0.36 + i * 0.18, 1.05, -0.3 - (i % 2) * 0.05, g);
    const flyer = add(new THREE.Mesh(ballGeo, ballMat), 0, -5, 0, g); flyer.visible = false;
    hoops.fly = () => hoops.shots.push(0);
    tickers.push((dt) => {
      if (!hoops.shots.length) { flyer.visible = false; return; }
      hoops.shots[0] += dt; const s = hoops.shots[0] / 0.9;
      if (s >= 1.25) { hoops.shots.shift(); return; }
      flyer.visible = true;
      if (s < 1) flyer.position.set(0, lerp(1.2, 2.12, s) + Math.sin(s * PI) * 0.75, lerp(-0.4, -2.63, s));
      else flyer.position.set(0, 2.1 - (s - 1) * 4 * 0.9, -2.63);
      flyer.rotation.x -= dt * 9;
      net.scale.set(1, s > 1 ? 1.15 : 1, 1);
    });
    // marquee
    const mq = neon('HOOPS', { font: '800 150px Manrope, Arial', w: 1.1, h: 0.3, color: '#3de0ff', px: 700 });
    mq.position.set(0, 3.5, -2.86); g.add(mq);
    collider(X - 0.55, X + 0.55, Z - 2.95, Z);
    interact(X, Z + 0.7, 1.0, () => 'Shoot some hoops', openHoops);
  });

  safe('dartboard', () => {
    const WX = 23.96, Y = 1.73, Z = -2.25;
    const g = add(new THREE.Group(), WX, 0, Z); g.rotation.y = -PI / 2; // local +z faces -x
    const walnut = std(0x3b2414, 0.5, 0.0), black = std(0x0b0b0c, 0.3, 0.2);
    box(1.0, 1.0, 0.06, walnut, 0, Y, -0.06, g);
    box(1.04, 0.05, 0.12, walnut, 0, Y + 0.52, -0.02, g);
    box(1.04, 0.05, 0.12, walnut, 0, Y - 0.52, -0.02, g);
    // open doors with chalk scoreboards
    const chalk = canvasTex(256, 512, (c) => {
      c.fillStyle = '#1b2420'; c.fillRect(0, 0, 256, 512); c.strokeStyle = 'rgba(255,255,255,0.65)'; c.fillStyle = 'rgba(255,255,255,0.75)';
      c.font = '600 34px Manrope, Arial'; c.textAlign = 'center'; c.fillText('501', 128, 60); c.lineWidth = 2; c.beginPath(); c.moveTo(128, 80); c.lineTo(128, 480); c.moveTo(20, 80); c.lineTo(236, 80); c.stroke();
      c.font = '400 26px Manrope, Arial'; [441, 381, 300, 240, 180].forEach((v, i) => c.fillText(String(v), 70, 130 + i * 60)); [461, 401, 341, 266].forEach((v, i) => c.fillText(String(v), 190, 130 + i * 60));
    });
    for (const s of [-1, 1]) {
      const hinge = add(new THREE.Group(), s * 0.5, Y, -0.04, g); hinge.rotation.y = -s * 0.35;
      box(0.5, 1.0, 0.04, walnut, s * 0.25, 0, 0, hinge);
      const cb = add(new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.9), new THREE.MeshBasicMaterial({ map: chalk, color: new THREE.Color(0.55, 0.55, 0.55) })), s * 0.25, 0, 0.021, hinge);
    }
    const boardTex = canvasTex(1024, 1024, (c) => {
      const C = 512, S = 512 / 0.3, order = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
      c.fillStyle = '#0d0d0d'; c.beginPath(); c.arc(C, C, 512, 0, TAU); c.fill();
      const ring = (r0, r1, a0, a1, col) => { c.fillStyle = col; c.beginPath(); c.arc(C, C, r1 * S, a0, a1); c.arc(C, C, r0 * S, a1, a0, true); c.closePath(); c.fill(); };
      for (let i = 0; i < 20; i++) {
        const a0 = (-90 - 9 + i * 18) * PI / 180, a1 = a0 + 18 * PI / 180, even = i % 2 === 0;
        ring(0.0159, 0.099, a0, a1, even ? '#141414' : '#efe3c8'); ring(0.099, 0.107, a0, a1, even ? '#c8232c' : '#1d8a4a');
        ring(0.107, 0.162, a0, a1, even ? '#141414' : '#efe3c8'); ring(0.162, 0.17, a0, a1, even ? '#c8232c' : '#1d8a4a');
        const am = (a0 + a1) / 2; c.save(); c.translate(C + Math.cos(am) * 0.197 * S, C + Math.sin(am) * 0.197 * S); c.rotate(am + PI / 2);
        c.fillStyle = '#f2f2f2'; c.font = '600 58px Manrope, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(order[i]), 0, 0); c.restore();
        c.strokeStyle = '#b8bcc2'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(C + Math.cos(a0) * 0.0159 * S, C + Math.sin(a0) * 0.0159 * S); c.lineTo(C + Math.cos(a0) * 0.17 * S, C + Math.sin(a0) * 0.17 * S); c.stroke();
      }
      ring(0.00635, 0.0159, 0, TAU, '#1d8a4a'); ring(0, 0.00635, 0, TAU, '#c8232c');
      c.strokeStyle = '#b8bcc2'; c.lineWidth = 2.5; for (const r of [0.00635, 0.0159, 0.099, 0.107, 0.162, 0.17]) { c.beginPath(); c.arc(C, C, r * S, 0, TAU); c.stroke(); }
    });
    const board = add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 64), [black, new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.85 }), black]), 0, Y, 0.0, g);
    board.rotation.x = PI / 2; board.rotation.y = PI;
    const ringL = add(new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.014, 8, 64), glow(1, 0.95, 0.85, 4)), 0, Y, 0.12, g);
    // three darts stuck in the board
    const dartMat = std(0xc9a25a, 0.3, 1), flightMat = std(0x1a1a1a, 0.6, 0);
    [[0.02, 0.11], [-0.05, 0.13], [0.0, 0.03]].forEach(([x, y]) => {
      const d = add(new THREE.Group(), x, Y + y, 0.02, g); d.rotation.x = 0.12; d.rotation.y = x * 2;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.002, 0.14, 8), dartMat), 0, 0, 0.07, d).rotation.x = PI / 2;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 6), flightMat), 0, 0, 0.16, d).rotation.x = PI / 2;
      for (const r of [0, PI / 2]) { const f = box(0.045, 0.002, 0.04, std(0xff3d7f, 0.5, 0), 0, 0, 0.185, d); f.rotation.z = r; }
    });
    // oche
    const oche = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 1.1), std(0xc9a25a, 0.3, 1)), 24 - 2.37, 0.006, Z);
    const lbl = neon('DARTS', { font: '700 150px Manrope, Arial', w: 1.05, h: 0.3, color: '#ff3d7f', px: 700 });
    lbl.position.set(0, Y + 0.85, -0.04); g.add(lbl);
    interact(21.25, Z, 1.15, () => 'Throw some darts', () => launchGame('darts'));
  });

  // ============================================================ BOARDROOM: shark tank, holo globe, ticker
  safe('shark tank', () => {
    const X0 = 22.95, X1 = 23.96, Y0 = 0.38, Y1 = 3.02, Z0 = -15.4, Z1 = -6.2, WATER = [0.01, 0.14, 0.26];
    const black = std(0x0a0a0b, 0.18, 0.3), brass = std(0xc9a25a, 0.28, 1.0);
    box(X1 - X0 + 0.06, Y0, Z1 - Z0, std(0x2a1a10, 0.5, 0), (X0 + X1) / 2 - 0.03, Y0 / 2, (Z0 + Z1) / 2);
    box(X1 - X0 + 0.06, 3.25 - Y1, Z1 - Z0, black, (X0 + X1) / 2 - 0.03, (Y1 + 3.25) / 2, (Z0 + Z1) / 2);
    box(0.012, 0.012, Z1 - Z0 - 2.0, glow(0.4, 0.85, 1, 3), X0 - 0.035, Y1 + 0.02, (Z0 + Z1) / 2);
    const water = add(new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, Y1 - Y0, Z1 - Z0), waterMat([0.0, 0.01, 0.035], [0.03, 0.24, 0.4], Y0, Y1)), (X0 + X1) / 2, (Y0 + Y1) / 2, (Z0 + Z1) / 2);
    const sand = add(new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), aquaSolidMat(0xb8a47c, WATER)), (X0 + X1) / 2, Y0 + 0.02, (Z0 + Z1) / 2); sand.rotation.x = -PI / 2;
    const rl = []; for (let i = 0; i < 14; i++) rl.push([23.55 + Math.random() * 0.3, Y0 + 0.05, -14.2 + i * 0.55 + Math.random() * 0.3, 0.12 + Math.random() * 0.22, 0.6 + Math.random() * 0.8]);
    root.add(rocks(rl, WATER));
    root.add(kelpField(0, 0, (i) => [23.4 + Math.random() * 0.5, -14.3 + i * 0.42 + Math.random() * 0.2, 0.6 + Math.random() * 1.6], 18, Y0 + 0.02, WATER));
    root.add(bubbles([[23.7, -13.5], [23.6, -10.2], [23.75, -8.0]], Y0 + 0.05, Y1 - 0.05, 70, 0.03));
    // front: glass window between two structural pillars that hide the sharks' turns
    for (const [za, zb] of [[Z0, -14.2], [-7.4, Z1]]) {
      box(0.06, Y1 - Y0, zb - za, black, X0 - 0.03, (Y0 + Y1) / 2, (za + zb) / 2);
      box(0.012, Y1 - Y0, 0.012, brass, X0 - 0.065, (Y0 + Y1) / 2, za === Z0 ? zb : za);
    }
    const gl = add(new THREE.Mesh(new THREE.PlaneGeometry(6.8, Y1 - Y0), glassMat({ a0: 0.03, a1: 0.35, env: 0.8 })), X0 - 0.01, (Y0 + Y1) / 2, -10.8); gl.rotation.y = -PI / 2; gl.renderOrder = 2;
    collider(X0 - 0.1, 24, Z0, Z1);
    const sharkGeo = fishGeo({ h: 0.2, w: 0.16, tailLen: 0.32, tailH: 0.28, dorsal: 0.17, pect: 0.2, rings: 18, seg: 12, shark: true });
    const sharkSpecs = [{ kind: 4, color: [1, 1, 1], freq: 3.2 }, { kind: 4, color: [1, 1, 1], freq: 3.0 }];
    const sharks = fishInstances(sharkGeo, fishMatBase(WATER, 0.6), sharkSpecs); root.add(sharks);
    const school = []; for (let i = 0; i < 26; i++) school.push({ kind: i % 3 ? 2 : 3, color: i % 3 ? [1.0, 0.85, 0.05] : [0.7, 0.75, 0.8], freq: 9 + Math.random() * 4 });
    const fishG = fishGeo({ h: 0.42, w: 0.13, tailLen: 0.32, tailH: 0.22, dorsal: 0.08 });
    const fish = fishInstances(fishG, fishMatBase(WATER, 0.6), school); root.add(fish);
    const fd = school.map(() => ({ ph: Math.random() * TAU, sp: 0.18 + Math.random() * 0.12, y: 0.9 + Math.random() * 1.6, xo: Math.random() * TAU, s: 0.1 + Math.random() * 0.06, a: 2.6 + Math.random() * 0.8 }));
    // stadium path: front lane x=23.25 (+z), back lane x=23.68 (-z), turns hidden behind the pillars
    const ZA = -14.75, ZB = -6.85, XF = 23.25, XB = 23.68, RT = (XB - XF) / 2, LEN = 2 * (ZB - ZA) + 2 * PI * RT;
    const stadium = (s) => {
      s = ((s % LEN) + LEN) % LEN;
      if (s < ZB - ZA) return [XF, ZA + s, 0, 1];
      s -= ZB - ZA;
      if (s < PI * RT) { const a = s / RT; return [XF + RT - Math.cos(a) * RT, ZB + Math.sin(a) * RT, Math.sin(a), Math.cos(a)]; }
      s -= PI * RT;
      if (s < ZB - ZA) return [XB, ZB - s, 0, -1];
      s -= ZB - ZA; const a = s / RT; return [XB - RT + Math.cos(a) * RT, ZA - Math.sin(a) * RT, -Math.sin(a), -Math.cos(a)];
    };
    const sArr = sharks.instanceMatrix.array, fArr = fish.instanceMatrix.array;
    tickers.push((dt, t) => {
      for (let i = 0; i < 2; i++) {
        const [x, z, dx, dz] = stadium(t * 0.55 + i * LEN * 0.5);
        const y = (i ? 2.05 : 1.25) + Math.sin(t * 0.3 + i * 2) * 0.25, dy = Math.cos(t * 0.3 + i * 2) * 0.25 * 0.3;
        setInst(sArr, i, x, y, z, dx, dy * 0.4, dz, 0.85 - i * 0.1);
      }
      sharks.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < fd.length; i++) {
        const d = fd[i], s = t * d.sp + d.ph;
        const z = -10.8 + d.a * Math.sin(s), x = 23.45 + 0.27 * Math.sin(2 * s + d.xo), y = d.y + 0.25 * Math.sin(s * 0.7 + d.xo);
        setInst(fArr, i, x, y, z, 0.54 * Math.cos(2 * s + d.xo), 0.17 * Math.cos(s * 0.7 + d.xo) * 0.5, d.a * Math.cos(s), d.s);
      }
      fish.instanceMatrix.needsUpdate = true;
    });
  });

  safe('holo globe', () => {
    const C = new THREE.Vector3(20.75, 1.58, -10.5), R = 0.42;
    const grp = add(new THREE.Group(), C.x, C.y, C.z);
    const lp = [];
    for (let la = -60; la <= 60; la += 30) { const y = Math.sin(la * PI / 180) * R, r = Math.cos(la * PI / 180) * R; for (let i = 0; i < 64; i++) { const a0 = (i / 64) * TAU, a1 = ((i + 1) / 64) * TAU; lp.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r); } }
    for (let lo = 0; lo < 180; lo += 30) { const a = lo * PI / 180; for (let i = 0; i < 48; i++) { const b0 = (i / 48) * TAU, b1 = ((i + 1) / 48) * TAU; lp.push(Math.cos(b0) * R * Math.cos(a), Math.sin(b0) * R, Math.cos(b0) * R * Math.sin(a), Math.cos(b1) * R * Math.cos(a), Math.sin(b1) * R, Math.cos(b1) * R * Math.sin(a)); } }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    grp.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.25, 0.7, 1.0).multiplyScalar(0.9), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })));
    // dot "continents" from smooth 3D noise on a fibonacci sphere
    const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
    const noise3 = (x, y, z) => { const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz; const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
      let r = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) r += hash(ix + a, iy + b, iz + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w); return r; };
    const dots = [], N = 1400;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      const n = noise3(x * 2.2 + 5, y * 2.2, z * 2.2) * 0.65 + noise3(x * 5 + 1, y * 5, z * 5) * 0.35;
      if (n > 0.52 && Math.abs(y) < 0.92) dots.push(x * R * 1.003, y * R * 1.003, z * R * 1.003);
    }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
    const dm = new THREE.PointsMaterial({ color: new THREE.Color(1.0, 0.78, 0.4).multiplyScalar(2.2), size: 0.012, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    grp.add(new THREE.Points(dg, dm));
    // flight arcs with travelling pulses
    const arcs = [], ap = [], au = [];
    const pick = () => { const k = Math.floor(Math.random() * (dots.length / 3)) * 3; return new THREE.Vector3(dots[k], dots[k + 1], dots[k + 2]); };
    for (let i = 0; i < 9; i++) {
      const a = pick(), b = pick(); if (a.distanceTo(b) < 0.25) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5); mid.setLength(R * (1.25 + a.distanceTo(b) * 0.6));
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b), pts = curve.getPoints(40);
      for (let j = 0; j < 40; j++) { ap.push(pts[j].x, pts[j].y, pts[j].z, pts[j + 1].x, pts[j + 1].y, pts[j + 1].z); au.push(j / 40 + i * 7.13, (j + 1) / 40 + i * 7.13); }
      arcs.push(curve);
    }
    const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.Float32BufferAttribute(ap, 3)); ag.setAttribute('aU', new THREE.Float32BufferAttribute(au, 1));
    grp.add(new THREE.LineSegments(ag, new THREE.ShaderMaterial({
      uniforms: { time: T }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aU; varying float vU; void main(){ vU = aU; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float time; varying float vU; void main(){ float u = fract(vU); float off = floor(vU);
        float p = fract(time * 0.35 + off * 0.37); float d = u - p; float head = exp(-d * d * 400.0) * step(-0.01, -d + 0.01);
        float trail = smoothstep(-0.3, 0.0, d) * step(d, 0.0);
        vec3 c = vec3(1.0, 0.75, 0.35) * (0.18 + trail * 1.4 + head * 4.0); gl_FragColor = vec4(c, 1.0); ${OUT} }`,
    })));
    // projector puck + beam
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.035, 48), std(0x0c0c0d, 0.25, 0.6)), C.x, 0.795, C.z);
    add(new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.006, 6, 64), glow(0.3, 0.8, 1, 4)), C.x, 0.814, C.z).rotation.x = PI / 2;
    const cone = add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, 0.12, C.y - 0.82, 48, 1, true), coneMat([0.35, 0.8, 1.0], 0.18)), C.x, (C.y + 0.82) / 2 - 0.05, C.z);
    tickers.push((dt, t) => { grp.rotation.y = t * 0.12; grp.position.y = C.y + Math.sin(t * 0.8) * 0.015; });
  });

  safe('ticker', () => {
    const items = () => [['VAULT INDEX', '▲ 4.21%', '#56d68b'], ['GOLD', '▲ 0.82%', '#56d68b'], ['CHIPS', '◆ ' + gameApi.chips().toLocaleString('en-US'), '#ffcf7a'], ['BTC', '▲ 2.10%', '#56d68b'], ['HOUSE EDGE', '▼ 0.30%', '#ff3d7f'],
      ['NO BAD DAYS', '▲ 100%', '#56d68b'], ['HOOPS HI', String(hoops.best), '#3de0ff'], ['OIL', '▼ 0.44%', '#ff3d7f'], ['TOP SPEED', '380 KM/H', '#ffcf7a']];
    const tex = canvasTex(2048, 64);
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = 1;
    const draw = () => {
      const g = tex.userData.g; g.fillStyle = '#030304'; g.fillRect(0, 0, 2048, 64);
      g.font = '500 30px "JetBrains Mono", monospace'; g.textBaseline = 'middle'; let x = 20;
      for (const [k, v, c] of items()) { g.fillStyle = '#a59d90'; g.fillText(k, x, 33); x += g.measureText(k).width + 14; g.fillStyle = c; g.fillText(v, x, 33); x += g.measureText(v).width + 60; if (x > 2000) break; }
      tex.needsUpdate = true;
    };
    draw();
    const len = 11.3;
    const m = add(new THREE.Mesh(new THREE.PlaneGeometry(len, 0.2), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.8, 1.8, 1.8) })), 16.47, 3.06, -10.25);
    m.rotation.y = -PI / 2;
    tex.repeat.x = len / (2048 / 64 * 0.2);
    let acc = 0;
    tickers.push((dt) => { tex.offset.x = (tex.offset.x + dt * 0.035) % 1; acc += dt; if (acc > 4) { acc = 0; draw(); } });
  });

  // ============================================================ celebrations (confetti + gold sparks)
  const confetti = (() => {
    const N = 500, geo = new THREE.PlaneGeometry(0.035, 0.06);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), N);
    im.frustumCulled = false; im.count = 0;
    const cols = [[1.6, 1.2, 0.5], [1.4, 1.35, 1.25], [1.6, 0.3, 0.6], [0.3, 1.2, 1.6], [1.5, 0.95, 0.35]];
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) im.setColorAt(i, c.setRGB(...cols[i % cols.length]));
    root.add(im);
    const P = Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
    // spark shell
    const SN = 240, sp = new Float32Array(SN * 3), sv = new Float32Array(SN * 3);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const sm = new THREE.PointsMaterial({ color: new THREE.Color(3, 2.2, 1.0), size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const sparks = new THREE.Points(sg, sm); sparks.frustumCulled = false; root.add(sparks);
    let sparkT = 9, next = 0;
    const o = new THREE.Object3D();
    const burst = (x, y, z) => {
      for (let k = 0; k < 170; k++) {
        const q = P[next]; next = (next + 1) % N;
        q.life = 3.5 + Math.random() * 2.5; q.p.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
        const a = Math.random() * TAU, s = 1.2 + Math.random() * 2.2; q.v.set(Math.cos(a) * s, 4 + Math.random() * 3.5, Math.sin(a) * s);
        q.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); q.w.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      }
      for (let i = 0; i < SN; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - u * u), s = 2.5 + Math.random() * 1.2;
        sp[i * 3] = x; sp[i * 3 + 1] = y + 2.6; sp[i * 3 + 2] = z; sv[i * 3] = Math.cos(a) * r * s; sv[i * 3 + 1] = u * s; sv[i * 3 + 2] = Math.sin(a) * r * s;
      }
      sparkT = 0;
    };
    tickers.push((dt) => {
      let alive = 0;
      for (let i = 0; i < N; i++) {
        const q = P[i];
        if (q.life <= 0) { o.scale.setScalar(0); o.position.set(0, -50, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); continue; }
        alive++; q.life -= dt;
        q.v.y -= 9.8 * dt; q.v.multiplyScalar(Math.exp(-dt * 2.6)); q.p.addScaledVector(q.v, dt);
        q.p.x += Math.sin(q.life * 5 + i) * dt * 0.3;
        if (q.p.y < 0.01) { q.p.y = 0.01; q.v.set(0, 0, 0); q.w.multiplyScalar(0.9); }
        q.r.x += q.w.x * dt; q.r.y += q.w.y * dt; q.r.z += q.w.z * dt;
        o.position.copy(q.p); o.rotation.copy(q.r); o.scale.setScalar(Math.min(1, q.life * 2)); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
      }
      DBG.confetti = alive; im.count = alive ? N : 0; if (alive) im.instanceMatrix.needsUpdate = true;
      if (sparkT < 2.2) {
        sparkT += dt; sparks.visible = true;
        for (let i = 0; i < SN; i++) { sv[i * 3 + 1] -= 2.2 * dt; for (let k = 0; k < 3; k++) { sv[i * 3 + k] *= Math.exp(-dt * 1.8); sp[i * 3 + k] += sv[i * 3 + k] * dt; } }
        sg.attributes.position.needsUpdate = true; sm.opacity = Math.max(0, 1 - sparkT / 2.2) * (0.7 + 0.3 * Math.sin(sparkT * 40));
      } else sparks.visible = false;
    });
    return burst;
  })();
  function celebrateAt(x, y, z) { confetti(x, y, z); }
  FX = {
    celebrate(pos) { const p = pos || player.pos; confetti(p.x, (pos ? p.y : 0) + (pos ? 0 : 1.2), p.z); },
    music: M, dbg: DBG,
    info: () => `${renderer.info.render.calls} calls, ${renderer.info.render.triangles} tris`,
  };
  window.__vaultFX = FX; window.__fx = FX;
  // big wins anywhere rain confetti on the winner
  let lastChips = gameApi.chips(), chipT = 0;
  tickers.push((dt) => {
    chipT += dt; if (chipT < 0.3) return; chipT = 0;
    const c = gameApi.chips(); if (c - lastChips >= 1500) confetti(player.pos.x, 1.4, player.pos.z); lastChips = c;
  });

  // ============================================================ panels: DJ + hoops
  let hornCtx = null;
  function airhorn() {
    try {
      hornCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const ac = hornCtx, now = ac.currentTime, out = ac.createGain(); out.gain.value = 0.18; out.connect(ac.destination);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.connect(out);
      [[0, 0.16], [0.2, 0.16], [0.42, 0.75]].forEach(([t0, d]) => {
        const env = ac.createGain(); env.gain.setValueAtTime(0, now + t0); env.gain.linearRampToValueAtTime(1, now + t0 + 0.02); env.gain.setValueAtTime(1, now + t0 + d - 0.05); env.gain.linearRampToValueAtTime(0, now + t0 + d); env.connect(lp);
        for (const f of [415, 418, 622, 830]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.94, now + t0); o.frequency.linearRampToValueAtTime(f, now + t0 + 0.06); o.connect(env); o.start(now + t0); o.stop(now + t0 + d + 0.05); }
      });
    } catch (e) { console.warn(e); }
  }
  function openDJ() {
    const card = gameApi.open(`<div class="eyebrow">Lounge · DJ booth</div><h2>Run the <em>room</em></h2>
      <p>The ceiling orbs, roof-beam LEDs, EQ wall and lasers follow whatever is playing on the big screen. Party mode turns everything up, even with the music off.</p>
      <div class="row"><button class="primary" id="djParty"></button><button id="djDrop">Drop it</button><button id="djHorn">Air horn</button></div>
      <div class="row" id="djPal">${PALETTES.map((p, i) => `<button data-pal="${i}">${p.name}</button>`).join('')}</div>
      <div class="result" id="djRes"></div>
      <div class="row"><button data-close>Step away</button></div>`);
    const $ = (id) => card.querySelector('#' + id);
    const sync = () => {
      $('djParty').textContent = M.party ? 'Party mode: on' : 'Party mode: off';
      card.querySelectorAll('[data-pal]').forEach((b) => { b.classList.toggle('primary', +b.dataset.pal === M.pal); });
      $('djRes').textContent = `${media.playing ? 'Live: ' + (media.title || 'music') : 'No music on'} · lights ${PALETTES[M.pal].name.toLowerCase()}`;
    };
    $('djParty').onclick = () => { M.party = !M.party; store.set('party', M.party); if (M.party) broadcast('switched on party mode in the lounge'); sync(); };
    $('djDrop').onclick = () => { M.strobe = 1.4; djFlash = 1.5; confetti(0, 1.2, -8); confetti(-2.5, 1.2, -6); confetti(2.5, 1.2, -6); };
    $('djHorn').onclick = airhorn;
    card.querySelectorAll('[data-pal]').forEach((b) => (b.onclick = () => { M.pal = +b.dataset.pal; store.set('palette', M.pal); sync(); }));
    sync();
  }

  function openHoops() {
    const card = gameApi.open(`<div class="eyebrow">Arcade · Vault Hoops</div><h2>Vault <em>Hoops</em></h2>
      <canvas class="game" width="800" height="500"></canvas>
      <div class="result" id="hpRes">Aim with the mouse or A/D. Hold the button or Space to power up, release to shoot. 45 seconds.</div>
      <div class="row"><button class="primary" id="hpGo">Start</button><button data-close>Leave</button></div>`, { wide: true });
    const cv = card.querySelector('canvas'), g = cv.getContext('2d'), res = card.querySelector('#hpRes'), go = card.querySelector('#hpGo');
    const W = 800, H = 500, RIM = { y: 168, w: 76 }, IDEAL = 0.66;
    const S = { run: false, time: 45, score: 0, streak: 0, made: 0, shots: 0, aim: 400, power: 0, charging: false, chargeT: 0, cool: 0, balls: [], hoopX: 400, msg: '', msgT: 0, t: 0, keys: {} };
    let raf = 0, last = performance.now();
    const hoopAt = (t) => S.time < 25 ? 400 + Math.sin(t * 1.3) * 120 * smooth(25, 20, S.time) : 400;
    const start = () => { Object.assign(S, { run: true, time: 45, score: 0, streak: 0, made: 0, shots: 0, balls: [], msg: 'GO', msgT: 1 }); go.disabled = true; res.textContent = 'Swish = 2 points, 3 in the last 10 seconds. Three in a row puts you on fire (double points).'; };
    const shoot = () => {
      if (!S.run || S.cool > 0) return;
      S.cool = 0.35; S.shots++;
      const p = S.power, T = 0.85;
      const hx = hoopAt(S.t + T), dx = S.aim - hx, dp = p - IDEAL;
      let out;
      if (Math.abs(dp) < 0.045 && Math.abs(dx) < 15) out = 'swish';
      else if (Math.abs(dp) < 0.09 && Math.abs(dx) < 30) out = Math.random() < 0.5 ? 'rimin' : 'rimout';
      else out = dp > 0.09 ? 'long' : dp < -0.09 ? 'short' : 'wide';
      S.balls.push({ x0: S.aim, x1: S.aim, d1: out === 'short' ? 0.55 + p * 0.4 : out === 'long' ? 1.15 : 1.0, t: 0, T, out, hx, s: 0, vx: (Math.random() - 0.5) * 120, scored: false });
    };
    const ballPos = (b) => {
      const s = Math.min(1, b.t / b.T), d = b.d1 * s;
      const y0 = 450 - d * (450 - RIM.y), arc = Math.sin(s * PI) * (170 + b.d1 * 60) * (1 - d * 0.35);
      return { x: lerp(b.x0, b.x1, s), y: y0 - arc, r: 24 - d * 11, d };
    };
    const onKey = (e) => {
      const k = e.code; if (!['Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Enter'].includes(k)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.type === 'keydown') { if (k === 'Enter' && !S.run) start(); if (k === 'Space' && !e.repeat) { if (!S.run) start(); else { S.charging = true; S.chargeT = 0; } } S.keys[k] = true; }
      else { S.keys[k] = false; if (k === 'Space' && S.charging) { S.charging = false; shoot(); } }
    };
    const pt = (e) => { const r = cv.getBoundingClientRect(); return (e.clientX - r.left) * (W / r.width); };
    const onMove = (e) => { S.aim = clamp(pt(e), 180, 620); };
    const onDown = (e) => { e.preventDefault(); if (!S.run) { start(); return; } S.aim = clamp(pt(e), 180, 620); S.charging = true; S.chargeT = 0; cv.setPointerCapture?.(e.pointerId); };
    const onUp = () => { if (S.charging) { S.charging = false; shoot(); } };
    addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true);
    cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointerup', onUp);
    go.onclick = start;
    gameApi.onClose(() => { cancelAnimationFrame(raf); removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true); hoops.draw(); });
    const finish = () => {
      S.run = false; go.disabled = false; go.textContent = 'Play again';
      const award = S.score * 12;
      if (award > 0) gameApi.addChips(award);
      let line = `${S.score} points, ${S.made}/${S.shots} shots. +${award.toLocaleString('en-US')} chips.`;
      if (S.score > hoops.best) { hoops.best = S.score; hoops.bestBy = gameApi.playerName(); store.set('hoopsBest', hoops.best); store.set('hoopsBestBy', hoops.bestBy); line += ' New machine record!'; broadcast(`set a new Vault Hoops record: ${S.score} points`); confetti(15.55, 1.4, -8.6); }
      res.textContent = line; hoops.draw(null, 0, 'LAST ' + S.score);
    };
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; S.t += dt;
      if (S.keys.ArrowLeft || S.keys.KeyA) S.aim = clamp(S.aim - dt * 320, 180, 620);
      if (S.keys.ArrowRight || S.keys.KeyD) S.aim = clamp(S.aim + dt * 320, 180, 620);
      if (S.charging) { S.chargeT += dt; const c = (S.chargeT / 1.1) % 2; S.power = c < 1 ? c : 2 - c; }
      S.cool -= dt; S.msgT -= dt;
      if (S.run) { S.time -= dt; if (S.time <= 0) { S.time = 0; finish(); } }
      S.hoopX = hoopAt(S.t);
      for (const b of S.balls) {
        b.t += dt;
        if (b.t >= b.T && !b.scored) {
          b.scored = true;
          const inn = b.out === 'swish' || b.out === 'rimin';
          if (inn && S.run) {
            S.streak++; S.made++;
            const pts = (S.time <= 10 ? 3 : 2) * (S.streak >= 3 ? 2 : 1); S.score += pts;
            S.msg = b.out === 'swish' ? (S.streak >= 3 ? 'ON FIRE +' + pts : 'SWISH +' + pts) : 'IN +' + pts; S.msgT = 0.9; hoops.fly?.();
          } else if (S.run) { S.streak = 0; S.msg = { rimout: 'RIMMED OUT', long: 'OFF THE BOARD', short: 'AIRBALL', wide: 'WIDE' }[b.out] || 'MISS'; S.msgT = 0.7; }
        }
      }
      S.balls = S.balls.filter((b) => b.t < b.T + 1.2);
      // draw
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0b0a12'); bg.addColorStop(1, '#030305'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,61,127,0.35)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(120, 500); g.lineTo(300, 110); g.moveTo(680, 500); g.lineTo(500, 110); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 14; i++) { const y = 110 + Math.pow(i / 13, 1.6) * 390, x0 = lerp(300, 120, (y - 110) / 390); g.beginPath(); g.moveTo(x0, y); g.lineTo(W - x0, y); g.stroke(); }
      const hx = S.hoopX;
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.fillRect(hx - 120, 50, 240, 140); g.strokeRect(hx - 120, 50, 240, 140); g.strokeRect(hx - 42, 105, 84, 62);
      const drawNet = () => { g.strokeStyle = 'rgba(240,240,240,0.7)'; g.lineWidth = 1.5; for (let i = 0; i <= 8; i++) { const x = hx - RIM.w / 2 + (i / 8) * RIM.w; g.beginPath(); g.moveTo(x, RIM.y); g.lineTo(hx + (x - hx) * 0.6, RIM.y + 52); g.stroke(); } for (let j = 1; j < 4; j++) { const y = RIM.y + j * 13, w = RIM.w / 2 * (1 - j * 0.1); g.beginPath(); g.moveTo(hx - w, y); g.lineTo(hx + w, y); g.stroke(); } };
      g.strokeStyle = '#ff5a14'; g.lineWidth = 5; g.beginPath(); g.ellipse(hx, RIM.y, RIM.w / 2, 9, 0, PI, TAU); g.stroke();
      const drawBall = (b) => {
        const p = ballPos(b); let { x, y, r } = p;
        if (b.t > b.T) {
          const k = b.t - b.T, inn = b.out === 'swish' || b.out === 'rimin';
          if (inn) { x = b.hx + (b.x1 - b.hx) * 0.2; y = RIM.y + k * 380; }
          else if (b.out === 'long') { y = RIM.y - 60 + k * k * 600; x = b.x1 + b.vx * k; }
          else if (b.out === 'rimout') { x = b.x1 + (b.x1 > b.hx ? 1 : -1) * 160 * k; y = RIM.y - 20 + (k * k * 700 - k * 160); }
          else { x = b.x1 + b.vx * k * 0.5; y = p.y + k * k * 500; }
        }
        const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r); gr.addColorStop(0, '#ff9a4a'); gr.addColorStop(1, '#a8400f');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(20,8,2,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.stroke(); g.beginPath(); g.arc(x, y, r, -0.6 + b.t * 6, 0.6 + b.t * 6); g.stroke();
      };
      const behind = S.balls.filter((b) => b.t > b.T && (b.out === 'swish' || b.out === 'rimin'));
      for (const b of behind) drawBall(b);
      drawNet();
      g.strokeStyle = '#ff6a24'; g.lineWidth = 5; g.beginPath(); g.ellipse(hx, RIM.y, RIM.w / 2, 9, 0, 0, PI); g.stroke();
      for (const b of S.balls) if (!behind.includes(b)) drawBall(b);
      // shooter + meters
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.ellipse(S.aim, 470, 30, 8, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(61,224,255,0.6)'; g.setLineDash([6, 8]); g.beginPath(); g.moveTo(S.aim, 440); g.lineTo(lerp(S.aim, 400, 0.15), 300); g.stroke(); g.setLineDash([]);
      if (S.run && S.cool <= 0) { const gr = g.createRadialGradient(S.aim - 8, 440, 3, S.aim, 448, 24); gr.addColorStop(0, '#ff9a4a'); gr.addColorStop(1, '#a8400f'); g.fillStyle = gr; g.beginPath(); g.arc(S.aim, 448, 24, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(36, 150, 22, 300);
      g.fillStyle = 'rgba(86,214,139,0.35)'; g.fillRect(36, 450 - (IDEAL + 0.045) * 300, 22, 0.09 * 300);
      const pc = S.power; g.fillStyle = pc > IDEAL + 0.09 ? '#ff3d7f' : pc > IDEAL - 0.09 ? '#56d68b' : '#d6b26e'; g.fillRect(36, 450 - pc * 300, 22, pc * 300);
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.strokeRect(36, 150, 22, 300);
      g.fillStyle = '#a59d90'; g.font = '600 12px Manrope, Arial'; g.textAlign = 'center'; g.fillText('POWER', 47, 470);
      g.textAlign = 'left'; g.font = '500 34px "JetBrains Mono", monospace'; g.fillStyle = '#ffcf7a'; g.fillText(String(S.score).padStart(2, '0'), 640, 60);
      g.fillStyle = S.time <= 10 && S.run ? '#ff3d7f' : '#3de0ff'; g.fillText(String(Math.ceil(S.time)).padStart(2, '0'), 720, 60);
      g.font = '600 11px Manrope, Arial'; g.fillStyle = '#a59d90'; g.fillText('SCORE', 640, 80); g.fillText('TIME', 720, 80); g.fillText('BEST ' + hoops.best, 640, 100);
      if (S.streak >= 3 && S.run) { g.fillStyle = '#ff8a3d'; g.font = '800 16px Manrope, Arial'; g.fillText('ON FIRE ×2', 640, 124); }
      if (S.msgT > 0) { g.globalAlpha = clamp(S.msgT * 2, 0, 1); g.textAlign = 'center'; g.font = '800 44px Manrope, Arial'; g.fillStyle = S.msg.includes('+') || S.msg === 'GO' ? '#56d68b' : '#ff3d7f'; g.fillText(S.msg, 400, 290); g.globalAlpha = 1; g.textAlign = 'left'; }
      if (!S.run) { g.textAlign = 'center'; g.fillStyle = 'rgba(241,233,219,0.9)'; g.font = '500 36px "Bodoni Moda", Georgia, serif'; g.fillText(S.shots ? 'Final score ' + S.score : 'Click or press Space to start', 400, 330); g.textAlign = 'left'; }
      if (S.run) hoops.draw(S.score, S.time);
    };
    raf = requestAnimationFrame(frame);
  }

  console.info('fx: installed', FX.info());
}
