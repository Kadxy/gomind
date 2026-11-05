# Third-party components

The engine files in this directory are not covered by the repository's MIT
license. They keep their own licenses, listed below.

## Rapfi engine (GPL-3.0)

WebAssembly builds of [Rapfi](https://github.com/dhbloo/rapfi), copyright the
Rapfi developers, licensed under the GNU General Public License version 3. The
full license text is in [`COPYING`](COPYING). Rapfi's source code is
available at <https://github.com/dhbloo/rapfi>.

The builds come from Gomoku Calculator, the Rapfi authors' web frontend, at
<https://www.gomocalc.com/build/> (files dated 2025-07-27). They were compiled
with Emscripten from the Rapfi source; see
<https://github.com/dhbloo/gomoku-calculator#build-engine-from-source>.

| File | Status | SHA-256 |
| --- | --- | --- |
| `rapfi-single.wasm` | unmodified | `20bb495aff65ff3e7ebc46e70890e9d1f98bf5023ee0e2c7378651f5f36a5820` |
| `rapfi-multi-simd128.wasm` | unmodified | `642c79f0fd929a3679053e1b52701e82f9c1749c797e177e1b14bb025fd5a166` |
| `rapfi-single.4961390d.js` | modified 2026-11-06 | `4961390d4170f5563300cb02bc80458ac37bcec1abeea4eeed0a537f0d6ce4f8` |
| `rapfi-multi-simd128.16d6bad4.js` | modified 2026-11-06 | `16d6bad4ca9b753c73f499bf365314a3cb23ca7c7ad771723c43879354da3410` |

The two loaders are the upstream `rapfi-single.js` and
`rapfi-multi-simd128.js` with one change: the table describing the data
package (file names, offsets, total size) is replaced to match the smaller
package below, and a comment at the top says so. Upstream originals:

| Upstream file | SHA-256 |
| --- | --- |
| `rapfi-single.js` | `d5991f22fe6b2442c76eb0637e5eae5595c858930f3f4585e8a8d86c8b3771c1` |
| `rapfi-multi-simd128.js` | `413b60028342b8940540b48d4636d99083fe78b42b1a15f2f379c2b79a21d2c7` |

## Network weights and configuration (CC0-1.0)

`rapfi-freestyle.92be317f.data` is an Emscripten data package holding Rapfi's network weights
and engine configuration from
[rapfi-networks](https://github.com/dhbloo/rapfi-networks), dedicated to the
public domain under CC0 1.0 Universal. The full text is in
[`LICENSE-networks`](LICENSE-networks).

Gomind only plays freestyle, so the package is a subset of the upstream
`rapfi.data` (40.3 MB, SHA-256 `2fa58b1c9e005a7b39bbddb798097a8f1ff9ceaba4c9339d87ba7d324b9d846d`). It
keeps `config.toml`, with the standard and renju weight entries commented
out, `model210901.bin`, and `mix9svqfreestyle_bsmix.bin.lz4`.

| File | SHA-256 |
| --- | --- |
| `rapfi-freestyle.92be317f.data` | `92be317f0e9168a1f862d8f5af2115e207b6563dbb01b907073300d0d48477b4` |

## Reproducing

Download `rapfi.data`, `rapfi-single.js` and `rapfi-multi-simd128.js` from
<https://www.gomocalc.com/build/> into a directory, then run:

```bash
bun web/scripts/repack-rapfi.ts <that-directory>
```

The script writes the files above and `web/src/lib/rapfiAssets.ts`.

## Other files

`package.json` is part of Gomind (MIT). It marks the loaders as CommonJS for
tooling.
