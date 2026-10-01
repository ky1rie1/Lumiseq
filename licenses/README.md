# License text sources

`model-runtime-notices.txt` preserves the previously bundled full ONNX Runtime 1.30.0 license, its upstream third-party notices, and the BiRefNet MIT license.

`dependency-texts/` fills gaps where published package archives omit their license text. Files record their upstream URL. Rust repository revisions come from each crate's `.cargo_vcs_info.json`; selectors uses the standard MPL-2.0 text from Mozilla, matching its published Cargo license declaration. guid-typescript declares ISC and author `nicolas` in npm metadata but supplies no separate license file or copyright year; its supplemental notice records that omission and the standard ISC terms.

`npm run release:prepare` combines these texts with installed npm and Rust dependency licenses, the font license, LibRaw notices, and the original Lumiseq MIT license. If a dependency has neither a package license file nor a supplemental text, preparation fails with its name.
