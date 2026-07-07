/**
 * Raster import helpers — read intrinsic pixel size and DPI straight from PNG /
 * JPEG headers (no image decode, so it runs in node tests too) and build the
 * data URL an {@link ImageShape} stores. Physical size on import is px / dpi.
 */

export interface ImageInfo {
  width: number;
  height: number;
  /** Dots per inch; 96 when the file carries no density metadata. */
  dpi: number;
}

const DEFAULT_DPI = 96;

function pngInfo(b: Uint8Array): ImageInfo | null {
  // Signature + IHDR: width/height are big-endian at bytes 16 and 20.
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  let dpi = DEFAULT_DPI;
  // Walk chunks from offset 8 looking for pHYs (pixels-per-unit, unit 1 = metre).
  let off = 8;
  while (off + 8 <= b.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    if (type === 'pHYs' && off + 8 + 9 <= b.length) {
      const ppuX = dv.getUint32(off + 8);
      const unit = b[off + 8 + 8];
      if (unit === 1 && ppuX > 0) dpi = Math.round(ppuX * 0.0254);
      break;
    }
    if (type === 'IDAT') break; // pHYs precedes image data
    off += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }
  return { width, height, dpi };
}

function jpegInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let dpi = DEFAULT_DPI;
  let off = 2;
  while (off + 4 < b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1];
    const len = dv.getUint16(off + 2);
    // APP0/JFIF density.
    if (marker === 0xe0 && off + 4 + 12 <= b.length) {
      const id = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
      if (id === 'JFIF') {
        const units = b[off + 4 + 7];
        const xd = dv.getUint16(off + 4 + 8);
        if (units === 1 && xd > 0) dpi = xd; // dots per inch
        else if (units === 2 && xd > 0) dpi = Math.round(xd * 2.54); // per cm
      }
    }
    // SOF markers carry the frame dimensions (skip DHT/DAC/RST/SOS ranges).
    const isSOF =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF && off + 9 <= b.length) {
      const height = dv.getUint16(off + 5);
      const width = dv.getUint16(off + 7);
      return { width, height, dpi };
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS
    off += 2 + len;
  }
  return null;
}

/** Read width/height/dpi from PNG or JPEG bytes; throws if unrecognised. */
export function imageInfo(bytes: Uint8Array): ImageInfo {
  const info = pngInfo(bytes) ?? jpegInfo(bytes);
  if (!info) throw new Error('Unsupported image (expected PNG or JPEG)');
  return info;
}

const MM_PER_INCH = 25.4;

/** Physical size (mm) of an image at its metadata DPI. */
export function physicalSizeMm(info: ImageInfo): { widthMm: number; heightMm: number } {
  return {
    widthMm: (info.width / info.dpi) * MM_PER_INCH,
    heightMm: (info.height / info.dpi) * MM_PER_INCH,
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64-encode bytes (portable across node and the browser). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${toBase64(bytes)}`;
}

export function mimeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}
