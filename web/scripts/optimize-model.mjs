// Optimiza los GLB exportados desde Blender para la web conservando la
// jerarquía completa de nodos y sus metadatos (extras):
//   dedup  -> comparte accesores/materiales idénticos
//   prune  -> elimina recursos huérfanos (conserva nodos hoja)
//   quantize + EXT_meshopt_compression -> compresión de geometría
// NO se usan join/flatten/instance: romperían la identidad de cada pieza,
// necesaria para la vista explosionada y la selección individual.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '../../export');
const dst = path.resolve(here, '../public/models');
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const log = { debug(){}, info(){}, warn(){}, error: console.error };
const io = new NodeIO().setLogger(log).registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const only = process.argv.slice(2);
for (const name of (only.length ? only : ['alcion_hx4_exterior', 'alcion_interior_rt'])) {
  const doc = await io.read(path.join(src, name + '.glb'));
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
    reorder({ encoder: MeshoptEncoder }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const out = path.join(dst, name + '.glb');
  await io.write(out, doc);
  const a = fs.statSync(path.join(src, name + '.glb')).size, b = fs.statSync(out).size;
  console.log(`${name}: ${(a / 1048576).toFixed(2)} MiB -> ${(b / 1048576).toFixed(2)} MiB`);
}
