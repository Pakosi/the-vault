// world.glb -> assets/world/world.gltf.json (geometry embedded as base64) + tex/*.webp (served as separate files)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, dedup, prune, textureCompress, quantize, weld, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const [,, src, outDir] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await MeshoptSimplifier.ready;
// dense furniture (vertex-lit) gets decimated; baked vertex light interpolates fine
let before = 0, after = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  if (mesh.getName() !== 'VAULT_F') continue;
  for (const prim of mesh.listPrimitives()) {
    const tris = (prim.getIndices()?.getCount() || 0) / 3; before += tris;
    if (tris > 6000) {
      weldPrimitive(prim);
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.max(0.12, 6000 / tris), error: 0.02, lockBorder: false });
    }
    after += (prim.getIndices()?.getCount() || 0) / 3;
  }
}
console.log('furniture tris', before, '->', after);
for (const p of doc.getRoot().listMeshes().find((m) => m.getName() === 'VAULT_F').listPrimitives().map((p) => [p.getMaterial()?.getName(), p.getIndices().getCount() / 3, p.getAttribute('POSITION').getCount(), p.listSemantics().join('+')]).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log('  ', p.join(' '));
const big = /concrete|parquet|brick|cartago|carpet|walnut|marble|wool/i;
await doc.transform(
  dedup(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 84, pattern: big }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82, pattern: /^(?!.*(concrete|parquet|brick|cartago|carpet|walnut|marble|wool)).*/i }),
  quantize({ quantizeTexcoord: 16, quantizeColor: 16, pattern: /^(POSITION|NORMAL|TEXCOORD_1|COLOR_0)$/ }),
);
fs.mkdirSync(path.join(outDir, 'tex'), { recursive: true });
let texIndex = 0;
async function emit(d, file) {
  const root = d.getRoot();
  root.listTextures().forEach((t) => t.setURI(`tex/${String(texIndex++).padStart(3, '0')}_${(t.getName() || 'tex').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)}.webp`));
  const { json, resources } = await io.writeJSON(d, { format: 'gltf', basename: file });
  let texBytes = 0;
  for (const b of json.buffers || []) if (b.uri && resources[b.uri]) b.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[b.uri]).toString('base64');
  for (const im of json.images || []) if (im.uri && resources[im.uri]) {
    const data = resources[im.uri];
    im.uri = 'tex/' + crypto.createHash('sha1').update(data).digest('hex').slice(0, 16) + '.webp';
    if (!fs.existsSync(path.join(outDir, im.uri))) { fs.writeFileSync(path.join(outDir, im.uri), data); texBytes += data.length; }
  }
  fs.writeFileSync(path.join(outDir, file + '.gltf.json'), JSON.stringify(json));
  console.log(file, (fs.statSync(path.join(outDir, file + '.gltf.json')).size / 1e6).toFixed(2), 'MB; textures', (texBytes / 1e6).toFixed(2), 'MB in', (json.images || []).length, 'files;', 'meshes', (json.meshes || []).map((m) => `${m.name}:${m.primitives.length}`).join(' '));
}
// split: furniture (vertex-lit, heavy) into several files so each stays under the host's 16 MB text limit
const primBytes = (p) => p.listAttributes().reduce((a, x) => a + x.getArray().byteLength, 0) + (p.getIndices()?.getArray().byteLength || 0);
const fprims = doc.getRoot().listMeshes().find((m) => m.getName() === 'VAULT_F').listPrimitives();
const total = fprims.reduce((a, p) => a + primBytes(p), 0);
const NB = Math.max(1, Math.ceil(total / 9.0e6));
const bins = Array.from({ length: NB }, () => ({ bytes: 0, idx: new Set() }));
fprims.map((p, i) => [i, primBytes(p)]).sort((a, b) => b[1] - a[1]).forEach(([i, b]) => { const bin = bins.reduce((m, x) => (x.bytes < m.bytes ? x : m)); bin.bytes += b; bin.idx.add(i); });
const furnDocs = bins.map((bin) => {
  const d = cloneDocument(doc);
  for (const n of d.getRoot().listNodes()) if (n.getMesh() && n.getMesh().getName() !== 'VAULT_F') n.dispose();
  const mesh = d.getRoot().listMeshes().find((m) => m.getName() === 'VAULT_F');
  mesh.listPrimitives().forEach((p, i) => { if (!bin.idx.has(i)) p.dispose(); });
  return d;
});
for (const n of doc.getRoot().listNodes()) if (n.getMesh()?.getName() === 'VAULT_F') n.dispose();
await doc.transform(prune());
await emit(doc, 'world');
for (let k = 0; k < furnDocs.length; k++) { await furnDocs[k].transform(prune()); await emit(furnDocs[k], 'furniture' + k); }
fs.writeFileSync(path.join(outDir, 'parts.json'), JSON.stringify({ furniture: furnDocs.length }));
