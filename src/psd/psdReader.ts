// src/psd/psdReader.ts
//! High-Performance Clean PSD Binary Reader (Phase 6 MVP)
//! Parses Photoshop PSD files into EditDocument layer trees with RLE PackBits channel decoding.

import { ParsedPsd, PsdHeader, PsdLayerRecord, PSD_BLEND_MODE_MAP } from './types';
import { EditDocument, Layer } from '../types/edit';
import { createImageLayer, createEditDocument } from '../document/EditDocument';
import { IAssetManager } from '../types/asset';

export class PsdReader {
  private view!: DataView;
  private offset: number = 0;
  private bytes!: Uint8Array;

  /**
   * Decompresses Apple PackBits RLE byte stream.
   */
  static decodePackBits(input: Uint8Array, outputLength: number): Uint8ClampedArray {
    const output = new Uint8ClampedArray(outputLength);
    let inPos = 0;
    let outPos = 0;

    while (inPos < input.length && outPos < outputLength) {
      let n = input[inPos++];
      // Convert unsigned byte to signed int8
      if (n > 127) n -= 256;

      if (n >= 0 && n <= 127) {
        // Copy next n + 1 bytes literally
        const count = n + 1;
        for (let i = 0; i < count && outPos < outputLength && inPos < input.length; i++) {
          output[outPos++] = input[inPos++];
        }
      } else if (n >= -127 && n <= -1) {
        // Repeat next byte 1 - n times
        const count = 1 - n;
        const val = inPos < input.length ? input[inPos++] : 0;
        for (let i = 0; i < count && outPos < outputLength; i++) {
          output[outPos++] = val;
        }
      }
      // n === -128 is a no-op
    }

    return output;
  }

  parse(buffer: ArrayBuffer): ParsedPsd {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.offset = 0;

    // 1. Header (26 bytes)
    const header = this.readHeader();
    if (header.signature !== '8BPS') {
      throw new Error(`Invalid PSD signature: expected '8BPS', got '${header.signature}'`);
    }

    // 2. Color Mode Data Section
    const colorModeLength = this.readUint32();
    this.offset += colorModeLength;

    // 3. Image Resources Section
    const imageResourcesLength = this.readUint32();
    this.offset += imageResourcesLength;

    // 4. Layer and Mask Information Section
    const layerMaskSectionLength = this.readUint32();
    const layerSectionEnd = this.offset + layerMaskSectionLength;

    const layers: PsdLayerRecord[] = [];

    if (layerMaskSectionLength > 0 && this.offset < buffer.byteLength) {
      const layerInfoLength = this.readUint32();

      if (layerInfoLength > 0) {
        let layerCount = this.readInt16();
        // Negative layer count indicates first alpha channel contains absolute transparency
        layerCount = Math.abs(layerCount);

        // Read layer records
        for (let i = 0; i < layerCount; i++) {
          const top = this.readInt32();
          const left = this.readInt32();
          const bottom = this.readInt32();
          const right = this.readInt32();
          const numChannels = this.readUint16();

          const channels: Array<{ id: number; length: number }> = [];
          for (let c = 0; c < numChannels; c++) {
            const id = this.readInt16();
            const length = this.readUint32();
            channels.push({ id, length });
          }

          // Blend mode signature ('8BIM')
          this.readString(4);
          const blendKey = this.readString(4);
          const opacity = this.readUint8() / 255.0;
          const clipping = this.readUint8() === 1;
          const flags = this.readUint8();
          const visible = (flags & (1 << 1)) === 0; // bit 1: 0 = visible, 1 = hidden
          this.readUint8(); // filler

          // Extra data length
          const extraLength = this.readUint32();
          const extraEnd = this.offset + extraLength;

          // Mask data length
          const maskLength = this.readUint32();
          this.offset += maskLength;

          // Layer blending ranges length
          const blendRangeLength = this.readUint32();
          this.offset += blendRangeLength;

          // Layer name: Pascal string padded to multiple of 4 bytes
          const nameLength = this.readUint8();
          const name = this.readString(nameLength) || `Layer ${i + 1}`;
          const pad = (4 - ((nameLength + 1) % 4)) % 4;
          this.offset += pad;

          // Skip remaining extra data
          if (this.offset < extraEnd) {
            this.offset = extraEnd;
          }

          const width = Math.max(0, right - left);
          const height = Math.max(0, bottom - top);

          layers.push({
            top,
            left,
            bottom,
            right,
            width,
            height,
            channels,
            blendModeKey: blendKey,
            blendMode: PSD_BLEND_MODE_MAP[blendKey] || 'normal',
            opacity,
            clipping,
            visible,
            name,
            channelData: new Map(),
          });
        }

        // Read channel image data for each layer
        for (const layer of layers) {
          const pixelCount = layer.width * layer.height;
          for (const ch of layer.channels) {
            if (this.offset + ch.length > buffer.byteLength) break;

            if (pixelCount === 0 || ch.length === 0) {
              this.offset += ch.length;
              continue;
            }

            const compression = this.readUint16();
            const dataBytesToRead = ch.length - 2;

            if (compression === 0) {
              // Raw data
              const raw = this.bytes.subarray(this.offset, this.offset + pixelCount);
              layer.channelData.set(ch.id, new Uint8ClampedArray(raw));
              this.offset += dataBytesToRead;
            } else if (compression === 1) {
              // RLE PackBits
              // Skip byte count table: 2 bytes per scanline
              const scanlineTableBytes = layer.height * 2;
              this.offset += scanlineTableBytes;
              const rleData = this.bytes.subarray(this.offset, this.offset + dataBytesToRead - scanlineTableBytes);
              const decoded = PsdReader.decodePackBits(rleData, pixelCount);
              layer.channelData.set(ch.id, decoded);
              this.offset += dataBytesToRead - scanlineTableBytes;
            } else {
              // Unsupported compression, advance offset
              this.offset += dataBytesToRead;
            }
          }
        }
      }

      this.offset = layerSectionEnd;
    }

    return {
      header,
      layers,
      hasMergedComposite: this.offset < buffer.byteLength,
    };
  }

  /**
   * Converts parsed PSD layers into an EditDocument and stores raster assets in AssetManager.
   */
  async convertToEditDocument(
    parsed: ParsedPsd,
    assetManager: IAssetManager,
    documentName: string = 'Imported PSD'
  ): Promise<EditDocument> {
    const docLayers: Layer[] = [];

    for (let i = 0; i < parsed.layers.length; i++) {
      const rec = parsed.layers[i];
      if (rec.width === 0 || rec.height === 0) continue;

      const rCh = rec.channelData.get(0); // Red
      const gCh = rec.channelData.get(1); // Green
      const bCh = rec.channelData.get(2); // Blue
      const aCh = rec.channelData.get(-1); // Alpha

      const rgba = new Uint8ClampedArray(rec.width * rec.height * 4);
      for (let p = 0; p < rec.width * rec.height; p++) {
        rgba[p * 4] = rCh ? rCh[p] : 0;
        rgba[p * 4 + 1] = gCh ? gCh[p] : (rCh ? rCh[p] : 0);
        rgba[p * 4 + 2] = bCh ? bCh[p] : (rCh ? rCh[p] : 0);
        rgba[p * 4 + 3] = aCh ? aCh[p] : 255;
      }

      const buffer = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
      const blob = new Blob([buffer], { type: 'image/png' });
      const assetHandle = await assetManager.registerBlob(blob, 'image', rec.name, {
        width: rec.width,
        height: rec.height,
      });

      const layer = createImageLayer({
        id: `layer_psd_${Date.now()}_${i}`,
        name: rec.name,
        sourceAssetId: assetHandle.id,
        naturalWidth: rec.width,
        naturalHeight: rec.height,
        x: rec.left,
        y: rec.top,
        opacity: rec.opacity,
      });

      layer.blendMode = rec.blendMode;
      layer.visible = rec.visible;
      docLayers.push(layer);
    }

    const doc = createEditDocument({
      name: documentName,
      width: parsed.header.width,
      height: parsed.header.height,
      layers: docLayers,
    });

    return doc;
  }

  // --- Internal Binary Helpers ---

  static readHeader(view: DataView): PsdHeader {
    const signature = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    if (signature !== '8BPS') {
      throw new Error(`Invalid PSD signature: expected '8BPS', got '${signature}'`);
    }
    const version = view.getUint16(4, false);
    const channels = view.getUint16(12, false);
    const height = view.getUint32(14, false);
    const width = view.getUint32(18, false);
    const depth = view.getUint16(22, false);
    const colorMode = view.getUint16(24, false);

    return { signature, version, channels, height, width, depth, colorMode };
  }

  private readHeader(): PsdHeader {
    const signature = this.readString(4);
    const version = this.readUint16();
    this.offset += 6; // Reserved 6 bytes
    const channels = this.readUint16();
    const height = this.readUint32();
    const width = this.readUint32();
    const depth = this.readUint16();
    const colorMode = this.readUint16();

    return {
      signature,
      version,
      channels,
      height,
      width,
      depth,
      colorMode,
    };
  }

  private readUint8(): number {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  private readInt16(): number {
    const val = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return val;
  }

  private readUint16(): number {
    const val = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return val;
  }

  private readInt32(): number {
    const val = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return val;
  }

  private readUint32(): number {
    const val = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return val;
  }

  private readString(length: number): string {
    let str = '';
    for (let i = 0; i < length; i++) {
      str += String.fromCharCode(this.bytes[this.offset + i]);
    }
    this.offset += length;
    return str;
  }
}

export const defaultPsdReader = new PsdReader();
