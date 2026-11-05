#!/usr/bin/env bun
// Repack the upstream Rapfi web build into the freestyle-only bundle Gomind
// ships. The engine (.wasm) is untouched; only the data package and the
// package metadata embedded in the two Emscripten loaders change.
//
//   bun web/scripts/repack-rapfi.ts <upstream-dir>
//
// <upstream-dir> must hold the unmodified upstream files rapfi.data,
// rapfi-single.js and rapfi-multi-simd128.js, as published by Gomoku
// Calculator at https://www.gomocalc.com/build/ (see web/public/rapfi/NOTICE.md).
//
// Writes into web/public/rapfi/:
//   rapfi-freestyle.<hash>.data     config, classical model, freestyle weights
//   rapfi-single.<hash>.js          loaders pointing at that package
//   rapfi-multi-simd128.<hash>.js
// and the generated names to web/src/lib/rapfiAssets.ts.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// GPL-3.0 section 5(a): modified files carry a notice with a relevant date.
const MODIFIED_ON = '2026-11-06';

// Gomind only plays freestyle (`INFO rule 0`), so the standard and renju
// networks (~30 MB) are never loaded. The classical model backs the search.
const KEEP = ['/config.toml', '/model210901.bin', '/mix9svqfreestyle_bsmix.bin.lz4'];

const OTHER_WEIGHTS = `[[model.evaluator.weights]]
weight_file = "mix9svqstandard_bs15.bin.lz4"
[[model.evaluator.weights]]
weight_file_black = "mix9svqrenju_bs15_black.bin.lz4"
weight_file_white = "mix9svqrenju_bs15_white.bin.lz4"`;

const META_RE = /\{files:\[([\s\S]*?)\],remote_package_size:(\d+)/;
const ENTRY_RE = /filename:"([^"]+)",\s*start:(\d+),\s*end:(\d+)/g;
const GENERATED_RE = /^rapfi-(single|multi-simd128|freestyle)\.[0-9a-f]{8}\.(js|data)$/;

const root = path.resolve(import.meta.dir, '../..');
const outDir = path.join(root, 'web/public/rapfi');
const src = process.argv[2];
if (!src) {
  console.error('usage: bun web/scripts/repack-rapfi.ts <upstream-dir>');
  process.exit(2);
}

const hash8 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex').slice(0, 8);

// --- read the upstream package and its file table
const data = new Uint8Array(readFileSync(path.join(src, 'rapfi.data')));
const multiJs = readFileSync(path.join(src, 'rapfi-multi-simd128.js'), 'utf8');
const singleJs = readFileSync(path.join(src, 'rapfi-single.js'), 'utf8');

const meta = META_RE.exec(multiJs);
if (!meta) throw new Error('package metadata not found in rapfi-multi-simd128.js');
const files = [...meta[1].matchAll(ENTRY_RE)].map((m) => ({
  name: m[1],
  start: Number(m[2]),
  end: Number(m[3]),
}));
if (Number(meta[2]) !== data.length) {
  throw new Error(`rapfi.data is ${data.length} bytes, loader expects ${meta[2]}`);
}
const singleMeta = META_RE.exec(singleJs);
if (!singleMeta || singleMeta[0].replace(/\s/g, '') !== meta[0].replace(/\s/g, '')) {
  throw new Error('the two loaders disagree about the package layout');
}

// --- build the subset package
const parts: { name: string; bytes: Uint8Array }[] = KEEP.map((name) => {
  const f = files.find((x) => x.name === name);
  if (!f) throw new Error(`${name} missing from upstream package`);
  let bytes = data.subarray(f.start, f.end);
  if (name === '/config.toml') {
    // Upstream uses CRLF; keep whatever line ending the file has.
    const text = new TextDecoder().decode(bytes);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const block = OTHER_WEIGHTS.split('\n').join(eol);
    if (!text.includes(block)) throw new Error('unexpected config.toml weight list');
    const commented = OTHER_WEIGHTS.split('\n')
      .map((l) => `# ${l}`)
      .join(eol);
    const note = '# Gomind bundles the freestyle network only; the entries below are not shipped.';
    bytes = new TextEncoder().encode(text.replace(block, `${note}${eol}${commented}`));
  }
  return { name, bytes };
});

const total = parts.reduce((n, p) => n + p.bytes.length, 0);
const pkg = new Uint8Array(total);
const table: string[] = [];
let off = 0;
for (const p of parts) {
  pkg.set(p.bytes, off);
  table.push(`{filename:"${p.name}",start:${off},end:${off + p.bytes.length}}`);
  off += p.bytes.length;
}
const newMeta = `{files:[${table.join(',')}],remote_package_size:${total}`;

const header = `// Modified by Gomind on ${MODIFIED_ON}: the embedded data-package table was
// replaced to match a freestyle-only package. Otherwise identical to the
// upstream Rapfi build. See NOTICE.md in this directory.
`;
const patch = (js: string) => header + js.replace(META_RE, newMeta);

// --- write outputs
for (const f of readdirSync(outDir)) if (GENERATED_RE.test(f)) unlinkSync(path.join(outDir, f));

const out = {
  data: `rapfi-freestyle.${hash8(pkg)}.data`,
  single: '',
  multi: '',
};
const single = patch(singleJs);
const multi = patch(multiJs);
out.single = `rapfi-single.${hash8(single)}.js`;
out.multi = `rapfi-multi-simd128.${hash8(multi)}.js`;
writeFileSync(path.join(outDir, out.data), pkg);
writeFileSync(path.join(outDir, out.single), single);
writeFileSync(path.join(outDir, out.multi), multi);

writeFileSync(
  path.join(root, 'web/src/lib/rapfiAssets.ts'),
  `// Generated by web/scripts/repack-rapfi.ts. Do not edit by hand.
export const RAPFI_ASSETS = {
  single: '${out.single}',
  multi: '${out.multi}',
  data: '${out.data}',
  dataSize: ${total},
} as const;
`,
);

console.log(`upstream package: ${data.length.toLocaleString()} bytes`);
console.log(`freestyle package: ${total.toLocaleString()} bytes`);
for (const p of parts) console.log(`  ${p.name.padEnd(34)} ${p.bytes.length.toLocaleString()}`);
console.log(`wrote ${out.data}, ${out.single}, ${out.multi}`);
