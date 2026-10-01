# Third-party notices

The root [MIT license](LICENSE) covers original Lumiseq code. It does not replace the licenses of the components below. Preserve this file and the referenced license texts when distributing source or the Windows executable.

| Component | Source / version | License and notices |
| --- | --- | --- |
| LibRaw | Vendored source in `src-tauri/native/libraw/`; [upstream](https://github.com/LibRaw/LibRaw) | Dual LGPL-2.1 / CDDL-1.0. Lumiseq distributes it under the CDDL option. Preserve [COPYRIGHT](src-tauri/native/libraw/COPYRIGHT), [CDDL](src-tauri/native/libraw/LICENSE.CDDL), and [LGPL](src-tauri/native/libraw/LICENSE.LGPL), plus individual source notices. The corresponding source is included in this repository. |
| Noto Sans SC | `public/fonts/NotoSansSC-VF.woff2` | [SIL OFL 1.1, with its copyright notice](public/fonts/OFL-NotoSansSC.txt). |
| BiRefNet | [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | MIT; copyright 2024 ZhengPeng. Full text is included in [model/runtime notices](licenses/model-runtime-notices.txt). |
| BiRefNet Lite 512 ONNX export | [studioludens/birefnet-lite-512](https://huggingface.co/studioludens/birefnet-lite-512), revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7` | MIT metadata declared by the export publisher. The source URL, exact size, and SHA-256 are pinned in [model.json](resources/cutout/model.json). Weights are downloaded explicitly for builds and embedded in release executables. |
| ONNX Runtime Web | 1.30.0, [upstream](https://github.com/microsoft/onnxruntime) | MIT and upstream third-party notices, preserved in [model/runtime notices](licenses/model-runtime-notices.txt). That upstream list may describe components outside this WASM build. |
| npm dependencies | Versions in `package-lock.json` | Individual package licenses. Release notices include installed production dependency license texts. |
| Rust dependencies | Versions in `src-tauri/Cargo.lock` | Individual crate licenses. Release notices include local Cargo dependency license texts. |

## Editor interaction references

The editor passes copied no source code, icons, logos, artwork, or assets from Pinta, Graphite, Krita, GIMP, darktable, or RawTherapee. Public documentation informed independently written interactions. Details: [open-source reference matrix](docs/technical/OPEN_SOURCE_REFERENCES.md).

The original Lumiseq `libraw_wrapper` is outside the vendored LibRaw source tree. Upstream LibRaw files remain under their existing licenses. Retain corresponding source and all component notices with a binary release.
