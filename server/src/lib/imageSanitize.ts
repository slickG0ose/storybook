/**
 * Upload hygiene for user-supplied images: decide what a file IS from its bytes, and
 * rewrite it without the metadata a phone camera attaches.
 *
 * Why this exists: parents upload photos here, and a phone JPEG carries EXIF — GPS
 * coordinates, capture time, device model, an embedded thumbnail. The upload route
 * used to write the bytes to a publicly served directory untouched, and trusted the
 * multipart `Content-Type` (which the client sets) for what the file was.
 *
 * Hand-written rather than `sharp`/`exifr`: both formats are simple containers and
 * dropping segments needs no pixel decoding, while a native image dependency is a
 * design-gate decision (CLAUDE.md §Size gate). The trade: this strips metadata but
 * does not re-encode, so it is not a defence against a decoder exploit hidden in
 * pixel data. Browsers decode these, the server never does.
 */

export type SniffedImageType = 'image/jpeg' | 'image/png';

export class ImageSanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSanitizeError';
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The type the BYTES claim, or null. Never consults a filename or a Content-Type. */
export function sniffImageType(bytes: Buffer): SniffedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  return null;
}

/**
 * Returns a copy with metadata removed. Throws ImageSanitizeError when the container
 * is malformed — a file we cannot walk is a file we cannot vouch for, so it is
 * rejected rather than stored as-is.
 */
export function stripImageMetadata(bytes: Buffer, type: SniffedImageType): Buffer {
  return type === 'image/jpeg' ? stripJpeg(bytes) : stripPng(bytes);
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const APP15 = 0xef;

const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');
const ICC_HEADER = Buffer.from('ICC_PROFILE\0', 'latin1');

/**
 * Keeps: JFIF (APP0), ICC colour profile (APP2 "ICC_PROFILE"), Adobe (APP14 — it
 * carries the colour transform flag, dropping it mis-colours some JPEGs), and every
 * non-APP segment (tables, frame headers, scans).
 *
 * Drops: EXIF and XMP (APP1), MPF and other APP2 payloads, IPTC/Photoshop (APP13),
 * every other APPn, comments, and anything after the first EOI — phones append
 * trailers there, including the video half of a "motion photo".
 *
 * EXIF orientation is the one tag carried over (re-emitted as a 34-byte EXIF block
 * holding nothing else), because without it a portrait phone photo renders sideways.
 */
function stripJpeg(src: Buffer): Buffer {
  const out: Buffer[] = [Buffer.from([0xff, SOI])];
  let orientation: number | null = null;
  let orientationSlot = -1;
  let pos = 2;

  for (;;) {
    if (pos + 1 >= src.length) throw new ImageSanitizeError('JPEG ended before its EOI marker');
    if (src[pos] !== 0xff) throw new ImageSanitizeError('JPEG marker expected');
    // Any number of 0xFF fill bytes may precede a marker.
    while (pos + 1 < src.length && src[pos + 1] === 0xff) pos += 1;
    const marker = src[pos + 1];
    pos += 2;

    if (marker === EOI) {
      out.push(Buffer.from([0xff, EOI]));
      break;
    }
    // Standalone markers carry no length. None is valid between segments in a
    // well-formed file, but tolerating them is cheaper than rejecting a real photo.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === SOI || marker === 0x00) throw new ImageSanitizeError('JPEG marker out of place');

    if (pos + 2 > src.length) throw new ImageSanitizeError('JPEG segment truncated');
    const length = src.readUInt16BE(pos);
    if (length < 2 || pos + length > src.length) throw new ImageSanitizeError('JPEG segment truncated');
    const payload = src.subarray(pos + 2, pos + length);
    const segment = src.subarray(pos - 2, pos + length);
    pos += length;

    if (marker === APP1) {
      if (orientation === null && startsWith(payload, EXIF_HEADER)) {
        orientation = readExifOrientation(payload.subarray(EXIF_HEADER.length));
        if (orientation !== null) orientationSlot = 1;
      }
      continue;
    }
    if (marker === APP2) {
      if (startsWith(payload, ICC_HEADER)) out.push(segment);
      continue;
    }
    if (marker === COM) continue;
    if (marker >= APP0 && marker <= APP15 && marker !== APP0 && marker !== APP14) continue;

    out.push(segment);

    if (marker === SOS) {
      // Entropy-coded data runs until the next real marker. Inside it 0xFF00 is a
      // stuffed 0xFF and 0xFFD0-D7 are restart markers; both belong to the scan.
      const start = pos;
      for (;;) {
        const ff = src.indexOf(0xff, pos);
        if (ff === -1 || ff + 1 >= src.length) throw new ImageSanitizeError('JPEG scan never ends');
        const next = src[ff + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          pos = ff + 2;
          continue;
        }
        if (next === 0xff) {
          pos = ff + 1;
          continue;
        }
        pos = ff;
        break;
      }
      out.push(src.subarray(start, pos));
    }
  }

  if (orientation !== null && orientation >= 2 && orientation <= 8) {
    out.splice(orientationSlot, 0, orientationOnlyExif(orientation));
  }
  return Buffer.concat(out);
}

function startsWith(buf: Buffer, prefix: Buffer): boolean {
  return buf.length >= prefix.length && buf.subarray(0, prefix.length).equals(prefix);
}

/** Tag 0x0112 from IFD0 of a TIFF block, or null. Never throws: bad EXIF is just dropped. */
function readExifOrientation(tiff: Buffer): number | null {
  if (tiff.length < 14) return null;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** An APP1 EXIF segment whose only content is the orientation tag. */
function orientationOnlyExif(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 offset
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // count
  tiff.writeUInt16BE(orientation, 18); // value, left-justified in the 4-byte slot
  tiff.writeUInt32BE(0, 22); // no next IFD
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = APP1;
  header.writeUInt16BE(2 + EXIF_HEADER.length + tiff.length, 2);
  return Buffer.concat([header, EXIF_HEADER, tiff]);
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/**
 * An allowlist, not a denylist: the chunks needed to decode and colour the image.
 * Everything else goes — tEXt/zTXt/iTXt (free text, XMP), eXIf, tIME, and any private
 * chunk. Output stops at IEND, so appended trailers go too.
 */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs']);

function stripPng(src: Buffer): Buffer {
  const out: Buffer[] = [PNG_SIGNATURE];
  let pos = PNG_SIGNATURE.length;
  let sawHeader = false;

  for (;;) {
    if (pos + 12 > src.length) throw new ImageSanitizeError('PNG ended before its IEND chunk');
    const length = src.readUInt32BE(pos);
    const end = pos + 12 + length;
    if (end > src.length) throw new ImageSanitizeError('PNG chunk truncated');
    const type = src.toString('latin1', pos + 4, pos + 8);
    if (!sawHeader && type !== 'IHDR') throw new ImageSanitizeError('PNG does not start with IHDR');
    sawHeader = true;
    if (PNG_KEEP.has(type)) out.push(src.subarray(pos, end));
    pos = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}
