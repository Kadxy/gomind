# Third-party components

The files in this directory are not covered by the repository's MIT license.
They are redistributed unmodified under their own licenses.

## Rapfi engine (GPL-3.0)

- `rapfi-single.js`, `rapfi-single.wasm`
- `rapfi-multi-simd128.js`, `rapfi-multi-simd128.wasm`

WebAssembly builds of [Rapfi](https://github.com/dhbloo/rapfi), copyright the
Rapfi developers, licensed under the GNU General Public License version 3. The
full license text is in [`COPYING`](COPYING).

These are byte-identical copies of the builds distributed by Gomoku Calculator,
the Rapfi authors' web frontend, at <https://www.gomocalc.com/build/> (files
dated 2025-07-27). They were compiled with Emscripten from the Rapfi source
code, which is available at <https://github.com/dhbloo/rapfi>. Build
instructions are in the Gomoku Calculator README:
<https://github.com/dhbloo/gomoku-calculator#build-engine-from-source>.

| File | SHA-256 |
| --- | --- |
| `rapfi-single.js` | `d5991f22fe6b2442c76eb0637e5eae5595c858930f3f4585e8a8d86c8b3771c1` |
| `rapfi-single.wasm` | `20bb495aff65ff3e7ebc46e70890e9d1f98bf5023ee0e2c7378651f5f36a5820` |
| `rapfi-multi-simd128.js` | `413b60028342b8940540b48d4636d99083fe78b42b1a15f2f379c2b79a21d2c7` |
| `rapfi-multi-simd128.wasm` | `642c79f0fd929a3679053e1b52701e82f9c1749c797e177e1b14bb025fd5a166` |

## Network weights and configuration (CC0-1.0)

- `rapfi.data`

An Emscripten preload package holding Rapfi's neural network weights and
engine configuration files from
[rapfi-networks](https://github.com/dhbloo/rapfi-networks), dedicated to the
public domain under CC0 1.0 Universal. The full text is in
[`LICENSE-networks`](LICENSE-networks). Obtained from the same distribution
as the engine builds above.

| File | SHA-256 |
| --- | --- |
| `rapfi.data` | `2fa58b1c9e005a7b39bbddb798097a8f1ff9ceaba4c9339d87ba7d324b9d846d` |

## Other files

`package.json` is part of Gomind (MIT). It marks the Emscripten loaders as
CommonJS for tooling.
