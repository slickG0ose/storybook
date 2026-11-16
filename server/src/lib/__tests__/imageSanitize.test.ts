import { describe, it, expect } from 'vitest';
import { ImageSanitizeError, sniffImageType, stripImageMetadata } from '../imageSanitize';

function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** A little-endian EXIF block: orientation, plus a GPS-looking string to look for afterwards. */
function exif(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from('GPS:51.5007N,0.1246W iPhone', 'latin1')]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const JFIF = segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
const DQT = segment(0xdb, Buffer.alloc(65, 1));
const ICC = segment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.alloc(8, 7)]));
// Entropy data with a stuffed 0xFF00 and a restart marker, both of which must survive.
const SCAN = Buffer.concat([segment(0xda, Buffer.alloc(10, 2)), Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33])]);

function jpeg(...middle: Buffer[]): Buffer {
  return Buffer.concat([SOI, JFIF, ...middle, DQT, SCAN, EOI]);
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, data, Buffer.alloc(4)]); // CRC is not checked by the stripper
}

describe('sniffImageType', () => {
  it('reads the type from the bytes', () => {
    expect(sniffImageType(jpeg())).toBe('image/jpeg');
    expect(sniffImageType(PNG_1PX)).toBe('image/png');
  });

  it('rejects everything else, whatever it is called', () => {
    expect(sniffImageType(Buffer.from('<svg onload="alert(1)"/>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('stripImageMetadata — JPEG', () => {
  it('removes EXIF, comments, other APPn segments and anything after EOI', () => {
    const src = Buffer.concat([
      jpeg(segment(0xe1, exif(1)), segment(0xfe, Buffer.from('shot by Nick')), segment(0xed, Buffer.from('Photoshop IPTC'))),
      Buffer.from('MotionPhoto_Data trailing video'),
    ]);
    const out = stripImageMetadata(src, 'image/jpeg');
    const text = out.toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('Exif');
    expect(text).not.toContain('shot by Nick');
    expect(text).not.toContain('IPTC');
    expect(text).not.toContain('MotionPhoto');
    expect(out.subarray(-2)).toEqual(EOI);
  });

  it('leaves a metadata-free file byte-identical', () => {
    const src = jpeg(ICC);
    expect(stripImageMetadata(src, 'image/jpeg')).toEqual(src);
  });

  it('keeps the image data, including stuffed bytes and restart markers', () => {
    const out = stripImageMetadata(jpeg(segment(0xe1, exif(1))), 'image/jpeg');
    expect(out).toEqual(jpeg());
  });

  it('carries the orientation over and nothing else from EXIF', () => {
    const out = stripImageMetadata(jpeg(segment(0xe1, exif(6))), 'image/jpeg');
    expect(out.toString('latin1')).not.toContain('GPS');
    // Re-reading the output must find the same orientation in a fresh, minimal block.
    const again = stripImageMetadata(out, 'image/jpeg');
    expect(again).toEqual(out);
    expect(out.length).toBe(jpeg().length + 36);
    expect(out.readUInt16BE(SOI.length + 4 + 6 + 18)).toBe(6);
  });

  it('rejects a truncated file rather than storing it', () => {
    const src = jpeg(segment(0xe1, exif(1)));
    expect(() => stripImageMetadata(src.subarray(0, src.length - 6), 'image/jpeg')).toThrow(ImageSanitizeError);
    expect(() => stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), 'image/jpeg')).toThrow(
      ImageSanitizeError,
    );
  });
});

describe('stripImageMetadata — PNG', () => {
  it('drops text, EXIF and time chunks and any trailer; keeps the image', () => {
    const iend = PNG_1PX.subarray(PNG_1PX.length - 12);
    const body = PNG_1PX.subarray(0, PNG_1PX.length - 12);
    const src = Buffer.concat([
      body,
      pngChunk('tEXt', Buffer.from('Author\0Nick')),
      pngChunk('eXIf', Buffer.from('GPS:51.5N')),
      pngChunk('tIME', Buffer.alloc(7)),
      iend,
      Buffer.from('trailer'),
    ]);
    expect(stripImageMetadata(src, 'image/png')).toEqual(PNG_1PX);
  });

  it('rejects a truncated file', () => {
    expect(() => stripImageMetadata(PNG_1PX.subarray(0, 40), 'image/png')).toThrow(ImageSanitizeError);
  });
});
