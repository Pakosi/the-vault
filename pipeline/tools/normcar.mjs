// Normalize a car model: drop junk geometry, front -> +Z, real-world length, centered on origin, floor at y=0.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, prune, dedup, weld, simplify, quantize, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const [,, src, out, lenStr, rotStr, maxTrisStr, texStr] = process.argv;
const targetLen = +lenStr, rotDeg = +rotStr || 0, maxTris = +maxTrisStr || 250000, texSize = +texStr || 1024;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
const triCount = n => n.getMesh().listPrimitives().reduce((a, p) => a + ((p.getIndices()?.getCount()) ?? p.getAttribute('POSITION').getCount()) / 3, 0);

const meshNodes = [];
scene.traverse(n => { if (n.getMesh()) meshNodes.push({ n, b: getBounds(n), t: triCount(n) }); });
const junkMat = /shadow|invisible|ground|floor|backdrop/i;
// reference box = union of the 3 densest meshes (body shell, interior, etc.)
const ref = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
[...meshNodes].sort((a, b) => b.t - a.t).filter(m => !m.n.getMesh().listPrimitives().some(p => junkMat.test(p.getMaterial()?.getName() || ''))).slice(0, 3)
  .forEach(m => { for (let i = 0; i < 3; i++) { ref.min[i] = Math.min(ref.min[i], m.b.min[i]); ref.max[i] = Math.max(ref.max[i], m.b.max[i]); } });
const pad = ref.max.map((v, i) => (v - ref.min[i]) * 0.15);
let dropped = 0;
for (const m of meshNodes) {
  const inside = m.b.min.every((v, i) => v >= ref.min[i] - pad[i]) && m.b.max.every((v, i) => v <= ref.max[i] + pad[i]);
  const junk = m.n.getMesh().listPrimitives().every(p => junkMat.test(p.getMaterial()?.getName() || ''));
  if (!inside || junk) { m.n.setMesh(null); dropped++; }
}
await doc.transform(prune());

// wrap scene roots so we can place the whole car with one transform
const wrap = doc.createNode('car');
for (const c of scene.listChildren()) { scene.removeChild(c); wrap.addChild(c); }
scene.addChild(wrap);
const r = rotDeg * Math.PI / 180;
wrap.setRotation([0, Math.sin(r / 2), 0, Math.cos(r / 2)]);
let b = getBounds(scene);
let ext = b.max.map((v, i) => v - b.min[i]);
const s = targetLen / ext[2];
wrap.setScale([s, s, s]);
b = getBounds(scene);
const t = wrap.getTranslation();
wrap.setTranslation([t[0] - (b.min[0] + b.max[0]) / 2, t[1] - b.min[1], t[2] - (b.min[2] + b.max[2]) / 2]);
b = getBounds(scene); ext = b.max.map((v, i) => v - b.min[i]);

let tris = 0; scene.traverse(n => { if (n.getMesh()) tris += triCount(n); });
const ops = [dedup(), weld()];
if (tris > maxTris) { await MeshoptSimplifier.ready; ops.push(simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / tris, error: 0.0008, lockBorder: true })); }
ops.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }), quantize(), prune());
await doc.transform(...ops);
let tris2 = 0; scene.traverse(n => { if (n.getMesh()) tris2 += triCount(n); });
// drop extensions three can't use without decoders
for (const e of root.listExtensionsUsed()) if (/draco|meshopt/i.test(e.extensionName)) e.dispose();
await io.write(out, doc);
console.log(JSON.stringify({ out, dropped, size: ext.map(v => +v.toFixed(2)), tris: Math.round(tris), tris2: Math.round(tris2) }));
